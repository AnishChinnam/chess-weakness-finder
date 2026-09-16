import { Chess } from "./vendor/chess.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SITE_NAMES = { lichess: "Lichess", chesscom: "Chess.com" };
const TC_LABELS = { blitz: "blitz", rapid: "rapid", both: "blitz & rapid" };
const TC_CLASSES = { blitz: ["blitz"], rapid: ["rapid"], both: ["blitz", "rapid"] };
// Stockfish runs client-side (asm.js); a little more time per move than the
// old server build. Bigger batches get less time so totals stay reasonable.
const MOVETIME = { 5: 120, 10: 120, 25: 90, 50: 70, 100: 45 };

// ---------------------------------------------------------------------------
// Stockfish engine wrapper (runs in a Web Worker)
// ---------------------------------------------------------------------------
class Engine {
  constructor() {
    this.worker = new Worker("vendor/stockfish.js");
    this._resolve = null;
    this._lastCp = null;
    this._lastMate = null;
    this._turn = "w";
    this.worker.onmessage = (e) => this._onMessage(e);
  }

  _line(e) {
    if (typeof e.data === "string") return e.data;
    if (e.data && typeof e.data.data === "string") return e.data.data;
    return String(e.data);
  }

  _onMessage(e) {
    const line = this._line(e);
    if (this._readyResolve && line.indexOf("uciok") !== -1) {
      const r = this._readyResolve; this._readyResolve = null; r();
      return;
    }
    if (this._resolve && line.indexOf("info") === 0 && line.indexOf(" score ") !== -1) {
      const sm = line.match(/ score (cp|mate) (-?\d+)/);
      if (sm) {
        if (sm[1] === "cp") { this._lastCp = parseInt(sm[2], 10); this._lastMate = null; }
        else { this._lastMate = parseInt(sm[2], 10); this._lastCp = null; }
      }
    }
    if (this._resolve && line.indexOf("bestmove") === 0) {
      const parts = line.split(/\s+/);
      const bm = parts[1];
      const bestUci = bm && bm !== "(none)" ? bm : null;
      let stmCp;
      if (this._lastMate !== null) {
        stmCp = this._lastMate > 0 ? 10000 - this._lastMate : -10000 - this._lastMate;
      } else if (this._lastCp !== null) {
        stmCp = this._lastCp;
      } else {
        stmCp = 0;
      }
      const whiteCp = this._turn === "w" ? stmCp : -stmCp;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      const r = this._resolve;
      this._resolve = null;
      r({ whiteCp: whiteCp, bestUci: bestUci });
    }
  }

  init() {
    return new Promise((resolve) => {
      this._readyResolve = resolve;
      this.worker.postMessage("uci");
    });
  }

  analyse(fen, movetime) {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._lastCp = null;
      this._lastMate = null;
      this._turn = fen.split(" ")[1] || "w";
      // Watchdog: if the engine never replies (a crashed/stuck worker), don't
      // hang the whole run — resolve with a "no data" result and move on.
      this._timer = setTimeout(() => {
        if (this._resolve) {
          const r = this._resolve;
          this._resolve = null;
          this._timer = null;
          r({ whiteCp: null, bestUci: null, timeout: true });
        }
      }, movetime + 4000);
      this.worker.postMessage("position fen " + fen);
      this.worker.postMessage("go movetime " + movetime);
    });
  }

  async restart() {
    this.quit();
    this.worker = new Worker("vendor/stockfish.js");
    this.worker.onmessage = (e) => this._onMessage(e);
    await this.init();
  }

  quit() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    try { this.worker.terminate(); } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// Fetching games
// ---------------------------------------------------------------------------
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

async function fetchLichess(username, numGames, timeControl) {
  const perf = TC_CLASSES[timeControl].join(",");
  const params = new URLSearchParams({ max: String(numGames), perfType: perf, opening: "true" });
  const url = "https://lichess.org/api/games/user/" + encodeURIComponent(username) + "?" + params;
  const res = await fetch(url, { headers: { Accept: "application/x-chess-pgn" } });
  if (res.status === 429) throw new Error("Lichess rate limit hit. Please wait a minute and try again.");
  const text = await res.text();
  if (!res.ok || !text.trim().startsWith("[")) {
    throw new Error("Could not find Lichess games for '" + username + "'. Check the username and try again.");
  }
  return splitPgns(text);
}

async function fetchChesscom(username, numGames, timeControl) {
  const allowed = TC_CLASSES[timeControl];
  const archRes = await fetch("https://api.chess.com/pub/player/" + encodeURIComponent(username) + "/games/archives");
  if (archRes.status === 404) throw new Error("Could not find Chess.com user '" + username + "'. Check the username and try again.");
  if (archRes.status === 429) throw new Error("Chess.com rate limit hit. Please wait a minute and try again.");
  if (!archRes.ok) throw new Error("Chess.com API error. Please try again in a moment.");
  const archives = (await archRes.json()).archives || [];
  const pgns = [];
  for (let i = archives.length - 1; i >= 0 && pgns.length < numGames; i--) {
    const r = await fetch(archives[i]);
    if (!r.ok) continue;
    const games = (await r.json()).games || [];
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

// To monetize later, swap any `resource.url` below for an affiliate link
// (e.g. a Chessable or Amazon Associates URL) — the UI picks it up automatically.
const THEME_META = {
  hung: {
    name: "Hanging pieces",
    tip: "Before every move, check what your opponent can capture for free — especially on moves that look obvious.",
    resource: { label: "Train board vision & simple tactics →", url: "https://lichess.org/training" },
  },
  missed_tactic: {
    name: "Missed tactics",
    tip: "Scan the forcing moves (checks, captures, threats) before you commit. Daily tactics puzzles help most here.",
    resource: { label: "Do a daily puzzle set on Lichess →", url: "https://lichess.org/training/mix" },
  },
  endgame: {
    name: "Endgame technique",
    tip: "Study core endgames (king-and-pawn, rook endgames) and slow down when converting a winning position.",
    resource: { label: "Practice endgames interactively →", url: "https://lichess.org/practice" },
  },
  opening: {
    name: "Opening mistakes",
    tip: "Learn the first ~8 moves and the plans of one opening as White and one defense as Black.",
    resource: { label: "Learn a repertoire on Chessable →", url: "https://www.chessable.com/" },
  },
  positional: {
    name: "Positional slips",
    tip: "Improve your worst-placed piece and avoid creating weaknesses you can't defend.",
    resource: { label: "Study strategy lessons on Chess.com →", url: "https://www.chess.com/lessons" },
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
function parseClocks(pgn) {
  const re = /%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)/g;
  const out = [];
  let m;
  while ((m = re.exec(pgn))) {
    out.push((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]));
  }
  return out;
}

function formatEval(cp) {
  if (cp >= 9000) return "+M";
  if (cp <= -9000) return "-M";
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
}

function severity(swing) {
  if (swing >= 500) return "Blunder";
  if (swing >= 300) return "Big mistake";
  return "Mistake";
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

function renderBoardSvg(fen, whiteBottom, arrows) {
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
    defs += '<marker id="ah' + i + '" markerWidth="3.5" markerHeight="3.5" refX="1.8" refY="1.75" orient="auto"><path d="M0,0 L3.5,1.75 L0,3.5 z" fill="' + a.color + '"/></marker>';
    arrowSvg += '<line x1="' + p1.x + '" y1="' + p1.y + '" x2="' + p2.x + '" y2="' + p2.y +
      '" stroke="' + a.color + '" stroke-width="' + (sq * 0.17) + '" stroke-linecap="round" marker-end="url(#ah' + i + ')" opacity="0.85"/>';
  });

  return '<svg viewBox="0 0 ' + size + " " + size + '" xmlns="http://www.w3.org/2000/svg"><defs>' + defs + "</defs>" + squares + cells + arrowSvg + "</svg>";
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------
async function analyze(params, hooks) {
  const { username, site, timeControl, numGames } = params;
  const games = site === "chesscom"
    ? await fetchChesscom(username, numGames, timeControl)
    : await fetchLichess(username, numGames, timeControl);

  const parsed = [];
  for (const pgn of games) {
    const c = new Chess();
    if (!c.load_pgn(pgn, { sloppy: true })) continue;
    parsed.push({ header: c.header(), moves: c.history({ verbose: true }), clocks: parseClocks(pgn) });
  }
  if (parsed.length === 0) {
    throw new Error("No " + TC_LABELS[timeControl] + " games found for '" + username + "' on " + SITE_NAMES[site] + ".");
  }

  const movetime = MOVETIME[numGames] || 100;
  const totalPlies = parsed.reduce((s, g) => s + g.moves.length + 1, 0);
  let done = 0;

  const engine = new Engine();
  hooks.onProgress(0, "Starting engine…");
  await engine.init();

  let totalMistakes = 0, totalInaccuracies = 0, gamesAnalyzed = 0;
  const byPhase = {}, byOpening = {}, losingOpenings = {}, keyMistakes = [];
  const byTheme = {};
  let timeTroubleMistakes = 0, mistakesWithClock = 0;
  const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

  try {
    for (let gi = 0; gi < parsed.length; gi++) {
      const g = parsed[gi];
      gamesAnalyzed++;
      const white = g.header.White || "?";
      const result = g.header.Result || "?";
      const opening = openingName(g.header);
      const userIsWhite = white.toLowerCase() === username.toLowerCase();
      const userLost = (userIsWhite && result === "0-1") || (!userIsWhite && result === "1-0");
      if (userLost) bump(losingOpenings, opening);

      const startFen = g.header.SetUp === "1" && g.header.FEN ? g.header.FEN : undefined;
      const board = new Chess(startFen);
      let moveNumber = 0;

      let prev = await engine.analyse(board.fen(), movetime);
      if (prev.timeout) await engine.restart();
      let previousEval = prev.whiteCp === null ? 0 : prev.whiteCp;
      done++;
      hooks.onProgress(done / totalPlies, "Game " + (gi + 1) + "/" + parsed.length);
      if (hooks.cancelled()) throw { cancelled: true };

      for (const mv of g.moves) {
        moveNumber++;
        const fenBefore = board.fen();
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
          if (after.timeout) await engine.restart();
        }
        // A timed-out analysis has no data; treat as "no change" so we neither
        // crash nor invent a mistake.
        const score = after.whiteCp === null ? previousEval : after.whiteCp;
        const evalChange = score - previousEval;
        const whiteJustMoved = board.turn() === "b";

        let isMistake = false, isInaccuracy = false;
        if (whiteJustMoved && userIsWhite) {
          if (evalChange < -200) isMistake = true;
          else if (evalChange < -100) isInaccuracy = true;
        } else if (!whiteJustMoved && !userIsWhite) {
          if (evalChange > 200) isMistake = true;
          else if (evalChange > 100) isInaccuracy = true;
        }

        if (isMistake) {
          totalMistakes++;
          bump(byPhase, getPhase(moveNumber));
          bump(byOpening, opening);
          const sign = userIsWhite ? 1 : -1;
          const playedEval = sign * score;
          const bestEval = sign * previousEval;
          const theme = classifyMistake({ fenAfter: fenAfter, phase: getPhase(moveNumber), playedEval: playedEval, bestEval: bestEval });
          bump(byTheme, theme);

          const clockSec = g.clocks[moveNumber - 1];
          if (typeof clockSec === "number") {
            mistakesWithClock++;
            if (clockSec < 30) timeTroubleMistakes++;
          }

          keyMistakes.push({
            game_num: gamesAnalyzed,
            move_number: moveNumber,
            phase: getPhase(moveNumber),
            theme: theme,
            fen_before: fenBefore,
            played_uci: playedUci,
            best_uci: bestUci,
            played_san: playedSan,
            best_san: sanFromUci(fenBefore, bestUci),
            played_eval: playedEval,
            best_eval: bestEval,
            swing: Math.abs(evalChange),
            orientation: userIsWhite,
          });
        } else if (isInaccuracy) {
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

  keyMistakes.sort((a, b) => b.swing - a.swing);
  const top = keyMistakes.slice(0, 8).map((m) => Object.assign({}, m, {
    svg: renderBoardSvg(m.fen_before, m.orientation, [
      { from: m.played_uci.slice(0, 2), to: m.played_uci.slice(2, 4), color: "#e5534b" },
      m.best_uci ? { from: m.best_uci.slice(0, 2), to: m.best_uci.slice(2, 4), color: "#57ab5a" } : null,
    ]),
    played_eval_str: formatEval(m.played_eval),
    best_eval_str: formatEval(m.best_eval),
    severity: severity(m.swing),
  }));

  const sortEntries = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const weaknesses = sortEntries(byTheme).slice(0, 3).map(([key, count]) => ({
    key: key,
    name: THEME_META[key].name,
    tip: THEME_META[key].tip,
    count: count,
  }));
  const timeTrouble = mistakesWithClock > 0
    ? { count: timeTroubleMistakes, pct: Math.round((timeTroubleMistakes / totalMistakes) * 100) }
    : null;

  return {
    username: username,
    site: SITE_NAMES[site],
    time_control: TC_LABELS[timeControl],
    games_analyzed: gamesAnalyzed,
    total_mistakes: totalMistakes,
    total_inaccuracies: totalInaccuracies,
    avg_mistakes: Math.round((totalMistakes / gamesAnalyzed) * 10) / 10,
    weaknesses: weaknesses,
    time_trouble: timeTrouble,
    phase_breakdown: sortEntries(byPhase),
    worst_openings: sortEntries(byOpening).slice(0, 5),
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
  const maxPhase = r.phase_breakdown.length ? Math.max.apply(null, r.phase_breakdown.map((e) => e[1])) : 0;
  const maxOpen = r.worst_openings.length ? r.worst_openings[0][1] : 0;
  const maxLoss = r.losing_openings.length ? r.losing_openings[0][1] : 0;

  let weaknessHtml = "";
  if (r.weaknesses.length) {
    const maxW = r.weaknesses[0].count;
    weaknessHtml =
      "<h2>Your top recurring weaknesses</h2>" +
      '<div class="section weakness">' +
      r.weaknesses.map((w, i) => {
        const meta = THEME_META[w.key] || {};
        const link = meta.resource
          ? '<a class="weak-link" href="' + meta.resource.url + '" target="_blank" rel="noopener noreferrer">' + esc(meta.resource.label) + "</a>"
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
          ") came with under 30s on the clock — play the opening faster to save time for the moments that decide the game.</div>"
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
        '<span class="mistake-where">Game ' + m.game_num + " · move " + Math.ceil(m.move_number / 2) + " · " + (THEME_META[m.theme] ? THEME_META[m.theme].name : m.phase) + "</span>" +
        '<span class="sev ' + (m.severity === "Blunder" ? "Blunder" : "") + '">' + m.severity + "</span></div>" +
        '<div class="board">' + m.svg + "</div>" +
        '<div class="moves"><div class="m played"><span>You played <span class="san">' + esc(m.played_san) + '</span></span><span class="ev">' + m.played_eval_str + "</span></div>" +
        '<div class="m best"><span>Best was <span class="san">' + esc(m.best_san) + '</span></span><span class="ev">' + m.best_eval_str + "</span></div></div></div>"
      ).join("") +
      "</div>";
  }

  const phaseRows = r.phase_breakdown.length
    ? barRows(r.phase_breakdown, maxPhase, "", "mistakes")
    : '<div class="empty">No mistakes flagged — clean games. ♟️</div>';
  const openRows = r.worst_openings.length
    ? barRows(r.worst_openings, maxOpen, "bad", "mistakes")
    : '<div class="empty">No opening racked up mistakes.</div>';
  const lossRows = r.losing_openings.length
    ? barRows(r.losing_openings, maxLoss, "bad", "losses")
    : '<div class="empty">No losses in this sample. 🎉</div>';

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
    weaknessHtml +
    mistakesHtml +
    "<h2>When mistakes happen</h2><div class=\"section\">" + phaseRows + "</div>" +
    "<h2>Openings with most mistakes</h2><div class=\"section\">" + openRows + "</div>" +
    "<h2>Openings you lose in</h2><div class=\"section\">" + lossRows + "</div>" +
    '<p class="footer"><a class="back" id="back2">← Analyze another player</a></p>'
  );
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
let cancelFlag = false;

function show(view) {
  $("home").classList.toggle("hidden", view !== "home");
  $("progress").classList.toggle("hidden", view !== "progress");
  $("results").classList.toggle("hidden", view !== "results");
}

function goHome() {
  show("home");
  $("results").innerHTML = "";
}

function showError(msg) {
  $("results").innerHTML =
    '<div class="error">' + esc(msg) + "</div>" +
    '<p class="footer" style="text-align:center"><a class="back" id="back">← Try another player</a></p>';
  show("results");
  const b = $("back"); if (b) b.onclick = goHome;
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const params = {
    username: $("username").value.trim(),
    site: $("site").value,
    timeControl: $("time_control").value,
    numGames: parseInt($("num_games").value, 10),
  };
  if (!params.username) return;

  cancelFlag = false;
  show("progress");
  $("bar").style.width = "0%";
  $("progress-text").textContent = "Fetching games…";

  const hooks = {
    onProgress: (frac, text) => {
      $("bar").style.width = Math.min(100, Math.round(frac * 100)) + "%";
      if (text) $("progress-text").textContent = text;
    },
    cancelled: () => cancelFlag,
  };

  try {
    const report = await analyze(params, hooks);
    $("results").innerHTML = renderReport(report);
    show("results");
    const b1 = $("back"), b2 = $("back2");
    if (b1) b1.onclick = goHome;
    if (b2) b2.onclick = goHome;
    window.scrollTo(0, 0);
  } catch (err) {
    if (err && err.cancelled) { goHome(); return; }
    showError((err && err.message) ? err.message : "Something went wrong. Please try again.");
  }
});

$("cancel").addEventListener("click", () => { cancelFlag = true; });
