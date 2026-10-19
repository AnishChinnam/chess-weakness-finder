import { Chess } from "./vendor/chess.js";
import { Engine } from "./engine.js";
import { CONFIG } from "./config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SITE_NAMES = { lichess: "Lichess", chesscom: "Chess.com" };
const TC_LABELS = { blitz: "blitz", rapid: "rapid", both: "blitz & rapid" };
const TC_CLASSES = { blitz: ["blitz"], rapid: ["rapid"], both: ["blitz", "rapid"] };
// Stockfish runs client-side (asm.js); a little more time per move than the
// old server build. Bigger batches get less time so totals stay reasonable.
const MOVETIME = { 5: 120, 10: 120, 25: 90, 50: 70, 100: 45 };
// Ignore mistakes made from an already-lost position (player POV, before the
// move): once you're down ~7 pawns, a further slip didn't decide the game.
const LOST_CAUSE_CP = -700;
// Moves are judged by how much they cut the player's winning chances (the
// Lichess model), not raw centipawns: dropping +8 to +5 is harmless, while
// 0.0 to -2.0 often decides the game. Thresholds are on a [-1, 1] scale.
const INACCURACY_DROP = 0.1, MISTAKE_DROP = 0.2, BLUNDER_DROP = 0.3;
function winChances(cp) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 2 / (1 + Math.exp(-0.00368208 * c)) - 1;
}
// A move played with fewer than this many seconds left counts as time trouble.
const TIME_TROUBLE_SEC = 60;

// ---------------------------------------------------------------------------
// Fetching games
// ---------------------------------------------------------------------------
async function fetchRemote(url, options, json = false) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = response.ok ? await (json ? response.json() : response.text()) : null;
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (controller.signal.aborted) throw new Error("The game download timed out. Check your connection and try again.");
    throw new Error("Could not download games. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function splitPgns(text) {
  const lines = text.split("\n");
  const games = [];
  let cur = [];
  const hasContent = (arr) => arr.some((l) => l.trim() !== "");
  for (const line of lines) {
    if (line.indexOf("[Event ") === 0 && hasContent(cur)) {
      games.push(cur.join("\n"));
      cur = [];
    }
    cur.push(line);
  }
  if (hasContent(cur)) games.push(cur.join("\n"));
  return games;
}

async function fetchLichess(username, numGames, timeControl, signal) {
  const perf = TC_CLASSES[timeControl].join(",");
  const params = new URLSearchParams({ max: String(numGames), perfType: perf, opening: "true" });
  const url = "https://lichess.org/api/games/user/" + encodeURIComponent(username) + "?" + params;
  const res = await fetchRemote(url, { headers: { Accept: "application/x-chess-pgn" }, signal });
  if (res.status === 429) throw new Error("Lichess rate limit hit. Please wait a minute and try again.");
  const text = res.body;
  if (!res.ok || !text?.trim().startsWith("[")) {
    throw new Error("Could not find Lichess games for '" + username + "'. Check the username and try again.");
  }
  return splitPgns(text);
}

async function fetchChesscom(username, numGames, timeControl, signal) {
  const allowed = TC_CLASSES[timeControl];
  const archRes = await fetchRemote("https://api.chess.com/pub/player/" + encodeURIComponent(username) + "/games/archives", { signal }, true);
  if (archRes.status === 404) throw new Error("Could not find Chess.com user '" + username + "'. Check the username and try again.");
  if (archRes.status === 429) throw new Error("Chess.com rate limit hit. Please wait a minute and try again.");
  if (!archRes.ok) throw new Error("Chess.com API error. Please try again in a moment.");
  const archives = archRes.body.archives || [];
  const pgns = [];
  for (let i = archives.length - 1; i >= 0 && pgns.length < numGames; i--) {
    const r = await fetchRemote(archives[i], { signal }, true);
    if (r.status === 429) throw new Error("Chess.com rate limit hit. Please wait a minute and try again.");
    if (!r.ok) throw new Error("A Chess.com archive could not be downloaded. Please try again; older games have not been substituted.");
    const games = r.body.games || [];
    for (let j = games.length - 1; j >= 0; j--) {
      const g = games[j];
      if (allowed.indexOf(g.time_class) !== -1 && g.rules === "chess" && g.pgn) {
        pgns.push(g.pgn);
        if (pgns.length >= numGames) break;
      }
    }
  }
  if (pgns.length === 0) {
    throw new Error("No " + TC_LABELS[timeControl] + " games found for Chess.com user '" + username + "'.");
  }
  return pgns;
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------
function openingName(header) {
  const op = header.Opening;
  if (op && op !== "?") return op;
  const eco = header.ECOUrl;
  if (eco) {
    const slug = eco.replace(/\/$/, "").split("/").pop();
    if (slug) return slug.replace(/-/g, " ");
  }
  return header.ECO || "Unknown";
}

function getPhase(moveNumber) {
  if (moveNumber <= 12) return "opening";
  if (moveNumber <= 30) return "middlegame";
  return "endgame";
}

// Eval (white POV) for a finished position, without touching the engine —
// analysing a game-over position (no legal moves) can hang the browser engine.
function terminalWhiteCp(board) {
  if (board.in_checkmate()) return board.turn() === "w" ? -10000 : 10000;
  return 0; // stalemate / other draw
}

// --- Mistake-theme detection: classify WHY a mistake happened -----------------
const PIECE_VAL = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

// Training links for each theme live in config.js (CONFIG.resources) so they
// can be swapped for affiliate URLs without touching this file.
const THEME_META = {
  hung: {
    name: "Hanging pieces",
    tip: "Before every move, check what your opponent can capture for free — especially on moves that look obvious.",
  },
  missed_tactic: {
    name: "Missed tactics",
    tip: "Scan the forcing moves (checks, captures, threats) before you commit. Daily tactics puzzles help most here.",
  },
  endgame: {
    name: "Endgame technique",
    tip: "Study core endgames (king-and-pawn, rook endgames) and slow down when converting a winning position.",
  },
  opening: {
    name: "Opening mistakes",
    tip: "Learn the first ~8 moves and the plans of one opening as White and one defense as Black.",
  },
  positional: {
    name: "Positional slips",
    tip: "Improve your worst-placed piece and avoid creating weaknesses you can't defend.",
  },
};

// How much material the side to move can win immediately (1-ply exchange guess).
function droppedMaterial(fenAfter) {
  let best = 0;
  let b;
  try { b = new Chess(fenAfter); } catch (e) { return 0; }
  const caps = b.moves({ verbose: true }).filter((m) => m.captured);
  for (const m of caps) {
    const gain = PIECE_VAL[m.captured] || 0;
    const nb = new Chess(fenAfter);
    nb.move({ from: m.from, to: m.to, promotion: m.promotion });
    const recapture = nb.moves({ verbose: true }).some((x) => x.to === m.to && x.captured);
    const net = recapture ? gain - (PIECE_VAL[m.piece] || 0) : gain; // undefended = free
    if (net > best) best = net;
  }
  return best;
}

// Assign one primary theme, concrete labels first.
function classifyMistake(o) {
  if (droppedMaterial(o.fenAfter) >= 200) return "hung";
  if (o.bestEval - o.playedEval >= 300 && o.bestEval >= 150) return "missed_tactic";
  if (o.phase === "endgame") return "endgame";
  if (o.phase === "opening") return "opening";
  return "positional";
}

// Pull per-ply remaining clock (seconds) from PGN %clk comments, in move order.
function clocksByPosition(game) {
  return new Map(game.get_comments().map(({ fen, comment }) => {
    const match = comment.match(/%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
    return [fen, match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null];
  }));
}

function formatEval(cp) {
  if (cp >= 9000) return "+M";
  if (cp <= -9000) return "-M";
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
}

function severity(drop) {
  return drop >= BLUNDER_DROP ? "Blunder" : "Mistake";
}

function sanFromUci(fen, uci) {
  if (!uci) return "—";
  const tmp = new Chess(fen);
  const mv = tmp.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
  return mv ? mv.san : "—";
}

// ---------------------------------------------------------------------------
// Board rendering (self-contained SVG)
// ---------------------------------------------------------------------------
const GLYPH = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚", P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔" };

function squareXY(file, rank, whiteBottom, sq) {
  let col, row;
  if (whiteBottom) { col = file; row = 7 - rank; }
  else { col = 7 - file; row = rank; }
  return { x: col * sq, y: row * sq };
}
function squareCenter(file, rank, whiteBottom, sq) {
  const p = squareXY(file, rank, whiteBottom, sq);
  return { x: p.x + sq / 2, y: p.y + sq / 2 };
}
function uciSquare(s) {
  return { file: s.charCodeAt(0) - 97, rank: parseInt(s[1], 10) - 1 };
}

let boardId = 0;
function renderBoardSvg(fen, whiteBottom, arrows) {
  const prefix = "board-" + (++boardId) + "-";
  const size = 320, sq = size / 8;
  const boardPart = fen.split(" ")[0];
  const rows = boardPart.split("/"); // index 0 = rank 8

  let squares = "";
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const p = squareXY(file, rank, whiteBottom, sq);
      const light = (file + rank) % 2 === 1;
      squares += '<rect x="' + p.x + '" y="' + p.y + '" width="' + sq + '" height="' + sq + '" fill="' + (light ? "#f0d9b5" : "#b58863") + '"/>';
    }
  }

  let cells = "";
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { f += parseInt(ch, 10); continue; }
      const rank = 7 - r;
      const p = squareXY(f, rank, whiteBottom, sq);
      const isWhite = ch === ch.toUpperCase();
      cells += '<text x="' + (p.x + sq / 2) + '" y="' + (p.y + sq * 0.72) +
        '" font-size="' + (sq * 0.82) + '" text-anchor="middle" fill="' + (isWhite ? "#f8f8f8" : "#111") +
        '" stroke="' + (isWhite ? "#333" : "#000") + '" stroke-width="0.6" style="paint-order:stroke">' + GLYPH[ch] + "</text>";
      f++;
    }
  }

  let defs = "", arrowSvg = "";
  arrows.forEach((a, i) => {
    if (!a) return;
    const from = uciSquare(a.from), to = uciSquare(a.to);
    const p1 = squareCenter(from.file, from.rank, whiteBottom, sq);
    const p2 = squareCenter(to.file, to.rank, whiteBottom, sq);
    defs += '<marker id="' + prefix + 'ah' + i + '" markerWidth="3.5" markerHeight="3.5" refX="1.8" refY="1.75" orient="auto"><path d="M0,0 L3.5,1.75 L0,3.5 z" fill="' + a.color + '"/></marker>';
    arrowSvg += '<line x1="' + p1.x + '" y1="' + p1.y + '" x2="' + p2.x + '" y2="' + p2.y +
      '" stroke="' + a.color + '" stroke-width="' + (sq * 0.17) + '" stroke-linecap="round" marker-end="url(#' + prefix + 'ah' + i + ')" opacity="0.85"/>';
  });

  return '<svg viewBox="0 0 ' + size + " " + size + '" xmlns="http://www.w3.org/2000/svg"><defs>' + defs + "</defs>" + squares + cells + arrowSvg + "</svg>";
}

// Add display-ready fields (board SVG, formatted evals, severity) to a mistake.
function decorateMistake(m) {
  return Object.assign({}, m, {
    svg: renderBoardSvg(m.fen_before, m.orientation, [
      { from: m.played_uci.slice(0, 2), to: m.played_uci.slice(2, 4), color: "#e5534b" },
      m.best_uci ? { from: m.best_uci.slice(0, 2), to: m.best_uci.slice(2, 4), color: "#57ab5a" } : null,
    ]),
    played_eval_str: formatEval(m.played_eval),
    best_eval_str: formatEval(m.best_eval),
    severity: severity(m.drop),
  });
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------
async function analyze(params, hooks, { engineFactory = signal => new Engine(signal), fetchGames } = {}) {
  const { username, site, timeControl, numGames } = params;
  const games = fetchGames ? await fetchGames(params) : site === "chesscom"
    ? await fetchChesscom(username, numGames, timeControl, hooks.signal)
    : await fetchLichess(username, numGames, timeControl, hooks.signal);

  const parsed = [];
  for (const pgn of games) {
    const c = new Chess();
    if (!c.load_pgn(pgn, { sloppy: true })) continue;
    const header = c.header();
    if (![header.White, header.Black].some(name => name?.toLowerCase() === username.toLowerCase())) continue;
    if (header.Variant && !["standard", "chess"].includes(header.Variant.toLowerCase())) continue;
    const moves = c.history({ verbose: true });
    if (!moves.length) continue;
    parsed.push({ header, moves, clocks: clocksByPosition(c) });
    if (parsed.length >= numGames) break;
  }
  if (parsed.length === 0) {
    throw new Error("No " + TC_LABELS[timeControl] + " games found for '" + username + "' on " + SITE_NAMES[site] + ".");
  }

  const movetime = MOVETIME[numGames] || 100;
  const totalPlies = parsed.reduce((s, g) => s + g.moves.length + 1, 0);
  let done = 0;

  const engine = engineFactory(hooks.signal);
  hooks.onProgress(0, "Starting engine…");

  let totalMistakes = 0, totalInaccuracies = 0, gamesAnalyzed = 0;
  const byPhase = Object.create(null), byOpening = Object.create(null), losingOpenings = Object.create(null), keyMistakes = [];
  const openingGames = Object.create(null);
  const byTheme = {}, timeTroubleByPhase = {};
  let timeTroubleMistakes = 0, mistakesWithClock = 0;
  const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

  try {
    await engine.init();
    for (let gi = 0; gi < parsed.length; gi++) {
      const g = parsed[gi];
      gamesAnalyzed++;
      const white = g.header.White || "?";
      const result = g.header.Result || "?";
      const opening = openingName(g.header);
      const userIsWhite = white.toLowerCase() === username.toLowerCase();
      const userLost = (userIsWhite && result === "0-1") || (!userIsWhite && result === "1-0");
      if (userLost) bump(losingOpenings, opening);
      bump(openingGames, opening);
      engine.newGame();

      const startFen = g.header.SetUp === "1" && g.header.FEN ? g.header.FEN : undefined;
      const board = new Chess(startFen);
      let moveNumber = 0;

      let prev = await engine.analyse(board.fen(), movetime);

      let previousEval = prev.whiteCp;
      done++;
      hooks.onProgress(done / totalPlies, "Game " + (gi + 1) + "/" + parsed.length);
      if (hooks.cancelled()) throw { cancelled: true };

      for (const mv of g.moves) {
        moveNumber++;
        const fenBefore = board.fen();
        const fullMoveNumber = Number(fenBefore.split(" ")[5]);
        const bestUci = prev.bestUci;
        const playedSan = mv.san;
        const playedUci = mv.from + mv.to + (mv.promotion || "");

        board.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
        const fenAfter = board.fen();

        let after;
        if (board.game_over()) {
          // Don't ask the engine about a finished position — compute directly.
          after = { whiteCp: terminalWhiteCp(board), bestUci: null };
        } else {
          after = await engine.analyse(board.fen(), movetime);

        }
        // A timed-out analysis has no data; treat as "no change" so we neither
        // crash nor invent a mistake.
        const score = after.whiteCp;
        if (!Number.isFinite(score)) throw new Error("Engine evaluation is missing. Please retry the analysis.");
        const whiteJustMoved = board.turn() === "b";

        const sign = userIsWhite ? 1 : -1;
        const bestEvalPlayer = sign * previousEval; // how good the position was before the move

        const userMoved = whiteJustMoved === userIsWhite;
        const drop = winChances(bestEvalPlayer) - winChances(sign * score);
        // Playing the engine's own choice is never an error, whatever the
        // eval noise between two short searches says.
        const playedBest = playedUci === bestUci;
        const isMistake = userMoved && !playedBest && drop >= MISTAKE_DROP;
        const isInaccuracy = userMoved && !playedBest && !isMistake && drop >= INACCURACY_DROP;

        // Lost-cause filter: a slip from an already-lost position didn't decide
        // anything, so it shouldn't dilute the report.
        const lostCause = bestEvalPlayer <= LOST_CAUSE_CP;

        if (isMistake && !lostCause) {
          const phase = getPhase(fullMoveNumber);
          totalMistakes++;
          bump(byPhase, phase);
          bump(byOpening, opening);
          const playedEval = sign * score;
          const bestEval = bestEvalPlayer;
          const theme = classifyMistake({ fenAfter: fenAfter, phase: phase, playedEval: playedEval, bestEval: bestEval });
          bump(byTheme, theme);

          const clockSec = g.clocks.get(fenAfter);
          if (typeof clockSec === "number") {
            mistakesWithClock++;
            if (clockSec < TIME_TROUBLE_SEC) {
              timeTroubleMistakes++;
              bump(timeTroubleByPhase, phase);
            }
          }

          keyMistakes.push({
            game_num: gamesAnalyzed,
            move_number: fullMoveNumber,
            move_label: fullMoveNumber + (userIsWhite ? "." : "…"),
            phase: phase,
            theme: theme,
            opening: opening,
            fen_before: fenBefore,
            played_uci: playedUci,
            best_uci: bestUci,
            played_san: playedSan,
            best_san: sanFromUci(fenBefore, bestUci),
            played_eval: playedEval,
            best_eval: bestEval,
            drop: drop,
            orientation: userIsWhite,
          });
        } else if (isInaccuracy && !lostCause) {
          totalInaccuracies++;
        }

        previousEval = score;
        prev = after;
        done++;
        if (moveNumber % 2 === 0) {
          hooks.onProgress(done / totalPlies, "Game " + (gi + 1) + "/" + parsed.length + ", move " + Math.ceil(moveNumber / 2));
        }
        if (hooks.cancelled()) throw { cancelled: true };
      }
    }
  } finally {
    engine.quit();
  }

  keyMistakes.sort((a, b) => b.drop - a.drop);
  const top = keyMistakes.slice(0, 8).map(decorateMistake);

  const sortEntries = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  // For each opening the player errs in most, show a representative (worst)
  // mistake as a board diagram. keyMistakes is sorted worst-first, so the first
  // match per opening is that opening's biggest blunder.
  const openingWeaknesses = sortEntries(byOpening).slice(0, 4).map(([name, count]) => {
    const rep = keyMistakes.find((m) => m.opening === name);
    return rep ? { name: name, count: count, mistake: decorateMistake(rep) } : null;
  }).filter(Boolean);
  const weaknesses = sortEntries(byTheme).slice(0, 3).map(([key, count]) => ({
    key: key,
    name: THEME_META[key].name,
    tip: THEME_META[key].tip,
    count: count,
  }));
  const timeTrouble = mistakesWithClock > 0
    ? { count: timeTroubleMistakes, pct: Math.round((timeTroubleMistakes / mistakesWithClock) * 100), sampled: mistakesWithClock }
    : null;

  return {
    username: username,
    site: SITE_NAMES[site],
    time_control: TC_LABELS[timeControl],
    games_analyzed: gamesAnalyzed,
    requested_games: numGames,
    opening_samples: openingGames,
    total_mistakes: totalMistakes,
    total_inaccuracies: totalInaccuracies,
    avg_mistakes: Math.round((totalMistakes / gamesAnalyzed) * 10) / 10,
    weaknesses: weaknesses,
    time_trouble: timeTrouble,
    has_clock: mistakesWithClock > 0,
    phase_breakdown: sortEntries(byPhase).map(([phase, count]) => ({
      phase: phase, count: count, time_trouble: timeTroubleByPhase[phase] || 0,
    })),
    worst_openings: sortEntries(byOpening).slice(0, 5),
    opening_weaknesses: openingWeaknesses,
    losing_openings: sortEntries(losingOpenings).slice(0, 5),
    key_mistakes: top,
  };
}

// ---------------------------------------------------------------------------
// Rendering the report
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function barRows(entries, max, badClass, unit) {
  if (!entries.length) return '<div class="empty">Nothing to show here.</div>';
  return entries.map(([label, count]) => {
    const pct = max ? (count / max) * 100 : 0;
    return '<div class="rowline"><div class="lbl wide">' + esc(label) + '</div>' +
      '<div class="bar-track"><div class="bar-fill ' + badClass + '" style="width:' + pct + '%"></div></div>' +
      '<div class="count">' + count + " " + unit + "</div></div>";
  }).join("");
}

function renderReport(r) {
  const maxPhase = r.phase_breakdown.length ? Math.max.apply(null, r.phase_breakdown.map((p) => p.count)) : 0;
  const maxOpen = r.worst_openings.length ? r.worst_openings[0][1] : 0;
  const maxLoss = r.losing_openings.length ? r.losing_openings[0][1] : 0;

  let weaknessHtml = "";
  if (r.weaknesses.length) {
    const maxW = r.weaknesses[0].count;
    weaknessHtml =
      "<h2>Your top recurring weaknesses</h2>" +
      '<div class="section weakness">' +
      r.weaknesses.map((w, i) => {
        const res = CONFIG.resources[w.key];
        const link = res && res.url
          ? '<a class="weak-link" data-event="Resource click" data-theme="' + w.key + '" href="' + esc(res.url) + '" target="_blank" rel="noopener sponsored">' + esc(res.label) + "</a>"
          : "";
        return '<div class="weak-row"><div class="weak-head">' +
          '<span class="weak-rank">#' + (i + 1) + "</span>" +
          '<span class="weak-name">' + esc(w.name) + "</span>" +
          '<span class="weak-count">' + w.count + "×</span></div>" +
          '<div class="bar-track"><div class="bar-fill bad" style="width:' + (w.count / maxW * 100) + '%"></div></div>' +
          '<div class="weak-tip">' + esc(w.tip) + "</div>" + link + "</div>";
      }).join("") +
      (r.time_trouble && r.time_trouble.count > 0
        ? '<div class="weak-time">⏱ ' + r.time_trouble.pct + "% of your mistakes (" + r.time_trouble.count +
          ") had a recorded clock under 60s after the move — play the opening faster to save time for the moments that decide the game.</div>"
        : "") +
      "</div>";
  }

  let mistakesHtml = "";
  if (r.key_mistakes.length) {
    mistakesHtml =
      "<h2>Your biggest mistakes</h2>" +
      '<p class="legend"><span class="sw" style="background:#e5534b"></span>move played' +
      '<span class="sw" style="background:#57ab5a"></span>engine\'s best</p>' +
      '<div class="mistakes-grid">' +
      r.key_mistakes.map((m) =>
        '<div class="mistake-card"><div class="mistake-top">' +
        '<span class="mistake-where">Game ' + m.game_num + " · move " + esc(m.move_label || m.move_number) + " · " + (THEME_META[m.theme] ? THEME_META[m.theme].name : m.phase) + "</span>" +
        '<span class="sev ' + (m.severity === "Blunder" ? "Blunder" : "") + '">' + m.severity + "</span></div>" +
        '<div class="board">' + m.svg + "</div>" +
        '<div class="moves"><div class="m played"><span>You played <span class="san">' + esc(m.played_san) + '</span></span><span class="ev">' + m.played_eval_str + "</span></div>" +
        '<div class="m best"><span>Best was <span class="san">' + esc(m.best_san) + '</span></span><span class="ev">' + m.best_eval_str + "</span></div></div></div>"
      ).join("") +
      "</div>";
  }

  const phaseRows = r.phase_breakdown.length
    ? r.phase_breakdown.map((p) => {
        const pct = maxPhase ? (p.count / maxPhase) * 100 : 0;
        const tt = (r.has_clock && p.time_trouble > 0)
          ? '<div class="tt-sub">⏱ ' + p.time_trouble + " of " + p.count + " had a recorded clock under 60s after the move</div>"
          : "";
        return '<div class="phase-row"><div class="rowline">' +
          '<div class="lbl">' + esc(p.phase) + "</div>" +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="count">' + p.count + " mistakes</div></div>" + tt + "</div>";
      }).join("")
    : '<div class="empty">No mistakes flagged — clean games. ♟️</div>';

  let openingVisualHtml = "";
  if (r.opening_weaknesses && r.opening_weaknesses.length) {
    openingVisualHtml =
      "<h2>Openings you go wrong in</h2>" +
      '<p class="legend"><span class="sw" style="background:#e5534b"></span>move played' +
      '<span class="sw" style="background:#57ab5a"></span>engine\'s best</p>' +
      '<div class="mistakes-grid">' +
      r.opening_weaknesses.map((o) => {
        const m = o.mistake;
        return '<div class="mistake-card"><div class="mistake-top">' +
          '<span class="mistake-where">' + esc(o.name) + "</span>" +
          '<span class="weak-count">' + o.count + " mistake" + (o.count === 1 ? "" : "s") + "</span></div>" +
          '<div class="board">' + m.svg + "</div>" +
          '<div class="moves"><div class="m played"><span>e.g. you played <span class="san">' + esc(m.played_san) + '</span></span><span class="ev">' + m.played_eval_str + "</span></div>" +
          '<div class="m best"><span>Best was <span class="san">' + esc(m.best_san) + '</span></span><span class="ev">' + m.best_eval_str + "</span></div></div></div>";
      }).join("") +
      "</div>";
  } else {
    const openRows = r.worst_openings.length
      ? barRows(r.worst_openings, maxOpen, "bad", "mistakes")
      : '<div class="empty">No opening racked up mistakes.</div>';
    openingVisualHtml = '<h2>Openings with most mistakes</h2><div class="section">' + openRows + "</div>";
  }

  const lossRows = r.losing_openings.length
    ? barRows(r.losing_openings, maxLoss, "bad", "losses")
    : '<div class="empty">No losses in this sample. 🎉</div>';

  const top = r.weaknesses[0];
  const newsletterHtml = CONFIG.newsletter.formAction
    ? '<form class="signup" id="signup" method="post" target="_blank" action="' + esc(CONFIG.newsletter.formAction) + '">' +
      '<div class="signup-pitch">' + (top ? "Fix <strong>" + esc(top.name.toLowerCase()) + "</strong>: " : "") + esc(CONFIG.newsletter.pitch) + "</div>" +
      '<div class="signup-row"><input type="email" name="email" required placeholder="you@example.com" aria-label="Email address">' +
      '<button type="submit" class="cta small">Send it</button></div></form>'
    : "";
  const tipHtml = CONFIG.tipUrl
    ? '<a class="tip" data-event="Tip click" href="' + esc(CONFIG.tipUrl) + '" target="_blank" rel="noopener">' + esc(CONFIG.tipLabel) + "</a>"
    : "";

  return (
    '<a class="back" id="back">← Analyze another player</a>' +
    '<div class="rheader"><h1 class="rtitle">Report for <span class="name">' + esc(r.username) + "</span></h1>" +
    '<div class="meta">' + r.games_analyzed + " recent " + r.time_control + " games" +
    '<span class="badge">' + r.site + "</span></div></div>" +
    '<div class="tiles">' +
    '<div class="tile"><div class="big bad">' + r.total_mistakes + '</div><div class="cap">Mistakes</div></div>' +
    '<div class="tile"><div class="big warn">' + r.total_inaccuracies + '</div><div class="cap">Inaccuracies</div></div>' +
    '<div class="tile"><div class="big">' + r.avg_mistakes + '</div><div class="cap">Mistakes / game</div></div>' +
    "</div>" +
    '<p class="note methodology">Sample: ' + r.games_analyzed + ' of ' + r.requested_games + ' requested games. Mistakes cut your winning chances by 10+ points on a 100-point scale (blunders 15+); inaccuracies by 5+, the same model Lichess uses. Phases use full move numbers: opening 1–12, middlegame 13–30, endgame 31+. Themes are estimates, not proven causes. Moves starting at −7 or worse are excluded.</p>' +
    '<div class="actions">' +
    '<button type="button" class="action" id="share-link">🔗 Copy share link</button>' +
    '<button type="button" class="action" id="share-image">🖼 Save share image</button>' +
    '<button type="button" class="action" id="download-json">⬇ Download data</button>' +
    "</div>" +
    weaknessHtml +
    newsletterHtml +
    mistakesHtml +
    "<h2>When mistakes happen</h2><div class=\"section\">" + phaseRows + "</div>" +
    openingVisualHtml +
    "<h2>Openings you lose in</h2><div class=\"section\">" + lossRows + "</div>" +
    '<p class="footer"><a class="back" id="back2">← Analyze another player</a>' + tipHtml + "</p>"
  );
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
export { analyze, getPhase, clocksByPosition, renderReport, renderBoardSvg, fetchLichess, fetchChesscom, shareUrl, paramsFromQuery };

// Analytics is a no-op unless CONFIG.plausibleDomain is set.
function track(name, props) {
  try { if (typeof window !== "undefined" && window.plausible) window.plausible(name, props ? { props } : undefined); } catch (e) {}
}

// A link that reopens the app and re-runs the same analysis.
function shareUrl(params, base) {
  const q = new URLSearchParams({ u: params.username, site: params.site, tc: params.timeControl, n: String(params.numGames) });
  return base.split(/[?#]/)[0] + "?" + q;
}

function paramsFromQuery(search) {
  const q = new URLSearchParams(search);
  const username = (q.get("u") || "").trim();
  if (!username) return null;
  const n = Number(q.get("n"));
  return {
    username,
    site: SITE_NAMES[q.get("site")] ? q.get("site") : "lichess",
    timeControl: TC_LABELS[q.get("tc")] ? q.get("tc") : "both",
    // Shared links cap at 25 so a visitor isn't committed to a 100-game run.
    numGames: [5, 10, 25].includes(n) ? n : 10,
  };
}

// 1200×630 summary card for social posts (the Open Graph image size).
function renderShareImage(r, url) {
  const W = 1200, H = 630;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const font = (w, s) => w + " " + s + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#161b22"); bg.addColorStop(1, "#0e1117");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const accent = x.createLinearGradient(0, 0, W, 0);
  accent.addColorStop(0, "#7c9cff"); accent.addColorStop(1, "#5ce0c6");
  x.fillStyle = accent; x.fillRect(0, 0, W, 8);

  x.fillStyle = "#8b949e"; x.font = font(600, 26);
  x.fillText("♞ CHESS WEAKNESS FINDER", 64, 80);
  x.fillStyle = "#e6edf3"; x.font = font(800, 58);
  x.fillText(r.username.length > 22 ? r.username.slice(0, 21) + "…" : r.username, 64, 160);
  x.fillStyle = "#8b949e"; x.font = font(400, 26);
  x.fillText(r.games_analyzed + " " + r.time_control + " games on " + r.site + " · " + r.avg_mistakes + " mistakes per game", 64, 205);

  x.fillStyle = "#e6edf3"; x.font = font(700, 30);
  x.fillText("Top recurring weaknesses", 64, 285);
  const max = r.weaknesses.length ? r.weaknesses[0].count : 1;
  r.weaknesses.forEach((w, i) => {
    const y = 330 + i * 80;
    x.fillStyle = "#7c9cff"; x.font = font(700, 28); x.fillText("#" + (i + 1), 64, y + 22);
    x.fillStyle = "#e6edf3"; x.font = font(600, 28); x.fillText(w.name, 130, y + 22);
    x.fillStyle = "#8b949e"; x.textAlign = "right"; x.fillText(w.count + "×", W - 64, y + 22); x.textAlign = "left";
    x.fillStyle = "#0d1117"; x.fillRect(130, y + 38, W - 194, 12);
    const bar = x.createLinearGradient(130, 0, W - 64, 0);
    bar.addColorStop(0, "#ff8a5c"); bar.addColorStop(1, "#ff6b6b");
    x.fillStyle = bar; x.fillRect(130, y + 38, (W - 194) * (w.count / max), 12);
  });
  if (!r.weaknesses.length) {
    x.fillStyle = "#5ce0c6"; x.font = font(600, 30); x.fillText("No mistakes flagged — clean games!", 64, 345);
  }

  x.fillStyle = "#8b949e"; x.font = font(400, 24);
  x.fillText("Find yours free → " + url.replace(/^https?:\/\//, "").split(/[?#]/)[0].replace(/\/$/, ""), 64, H - 48);
  return new Promise(resolve => c.toBlob(resolve, "image/png"));
}

const $ = (id) => document.getElementById(id);
let activeRun = null;
let lastReport = null;
let lastParams = null;

function show(view) {
  for (const id of ["home", "progress", "results"]) $(id).classList.toggle("hidden", view !== id);
}
function goHome() {
  show("home"); $("results").innerHTML = ""; $("username").focus();
  if (location.search) history.replaceState(null, "", location.pathname);
}
function showError(msg) {
  $("results").innerHTML = '<div class="error" role="alert">' + esc(msg) + '</div><p class="footer"><button class="back" id="back">← Try another player</button></p>';
  show("results");
  $("back").onclick = goHome;
}
function flash(button, text) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = old; }, 1800);
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bindReport() {
  for (const id of ["back", "back2"]) { if ($(id)) { $(id).href = "#"; $(id).onclick = e => { e.preventDefault(); goHome(); }; } }
  const link = shareUrl(lastParams, CONFIG.siteUrl || location.href);
  const slug = lastReport.username.replace(/[^\w-]/g, "_");
  $("share-link").onclick = async e => {
    track("Share", { kind: "link" });
    try { await navigator.clipboard.writeText(link); flash(e.target, "✓ Link copied"); }
    catch (err) { window.prompt("Copy this link:", link); }
  };
  $("share-image").onclick = async e => {
    track("Share", { kind: "image" });
    const blob = await renderShareImage(lastReport, link);
    const file = new File([blob], slug + "-chess-weaknesses.png", { type: "image/png" });
    // Mobile: hand off to the native share sheet; desktop: download the PNG.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: "My chess weaknesses — find yours: " + link }); return; }
      catch (err) { if (err.name === "AbortError") return; }
    }
    saveBlob(blob, file.name);
    flash(e.target, "✓ Image saved");
  };
  $("download-json").onclick = () => {
    saveBlob(new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" }), slug + "-chess-weaknesses.json");
  };
  if ($("signup")) $("signup").addEventListener("submit", () => track("Newsletter signup"));
}

async function run(params) {
  if (activeRun) return;
  const controller = new AbortController();
  activeRun = controller;
  const start = performance.now();
  show("progress"); $("bar").style.width = "0%"; $("progress-text").textContent = "Fetching games…";
  $("bar-outer").setAttribute("aria-valuenow", "0");
  history.replaceState(null, "", shareUrl(params, location.href));
  track("Analyze", { site: params.site, games: String(params.numGames) });
  const hooks = {
    signal: controller.signal,
    cancelled: () => controller.signal.aborted,
    onProgress: (frac, text) => {
      if (activeRun !== controller) return;
      const percent = Math.min(100, Math.round(frac * 100));
      $("bar").style.width = percent + "%";
      $("bar-outer").setAttribute("aria-valuenow", String(percent));
      $("progress-text").textContent = (text || "Analyzing…") + " · " + percent + "% · " + Math.round((performance.now() - start) / 1000) + "s";
    },
  };
  try {
    const report = await analyze(params, hooks);
    if (activeRun !== controller) return;
    lastReport = report; lastParams = params;
    $("results").innerHTML = renderReport(report);
    bindReport(); show("results"); window.scrollTo(0, 0);
    document.title = report.username + "'s chess weaknesses · Chess Weakness Finder";
  } catch (err) {
    if (activeRun !== controller || controller.signal.aborted) return;
    showError(err?.message || "Something went wrong. Please try again.");
  } finally { if (activeRun === controller) activeRun = null; }
}

if (typeof document !== "undefined") {
  if (CONFIG.plausibleDomain) {
    window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
    const s = document.createElement("script");
    s.defer = true; s.dataset.domain = CONFIG.plausibleDomain; s.src = "https://plausible.io/js/script.outbound-links.js";
    document.head.appendChild(s);
  }
  // Affiliate/tip links carry data-event so every click is counted.
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("[data-event]");
    if (a) track(a.dataset.event, a.dataset.theme ? { theme: a.dataset.theme } : undefined);
  });

  $("form").addEventListener("submit", e => {
    e.preventDefault();
    const params = { username: $("username").value.trim(), site: $("site").value, timeControl: $("time_control").value, numGames: Number($("num_games").value) };
    if (params.username) run(params);
  });
  $("cancel").addEventListener("click", () => {
    const r = activeRun; activeRun = null; r?.abort(); goHome();
  });

  // Shared links (?u=…&site=…) prefill the form and start right away.
  const shared = paramsFromQuery(location.search);
  if (shared) {
    $("username").value = shared.username; $("site").value = shared.site;
    $("time_control").value = shared.timeControl; $("num_games").value = String(shared.numGames);
    run(shared);
  }
}
