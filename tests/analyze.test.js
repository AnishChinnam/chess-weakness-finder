import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "../static/vendor/chess.js";
import { analyze, getPhase, clocksByPosition, renderReport, renderBoardSvg, shareUrl, paramsFromQuery } from "../static/app.js";
import { Engine } from "../static/engine.js";

// Fake engine that returns scripted white-POV evals, one per analysed position.
function scriptedEngine(evals) {
  return () => {
    let i = 0;
    return {
      init: async () => {},
      newGame() {},
      quit() {},
      analyse: async () => ({ whiteCp: evals[i++], bestUci: null }),
    };
  };
}
// start, e4, e5, Qh5, Nf6, Qxf7+ (drops the queen), Kxf7
const QUEEN_DROP_EVALS = [20, 30, 30, 0, 0, -700, -700];

const hooks = () => ({ onProgress() {}, cancelled: () => false });

// White ("alice") leaves the queen en prise on h5 and Black takes it.
const HUNG_QUEEN = `[White "alice"]
[Black "bob"]
[Result "0-1"]
[Opening "Test Opening"]

1. e4 { [%clk 0:02:50] } e5 { [%clk 0:02:50] } 2. Qh5 { [%clk 0:02:40] } Nf6 { [%clk 0:02:40] } 3. Qxf7+ { [%clk 0:00:30] } Kxf7 { [%clk 0:02:30] } 0-1`;

test("getPhase splits on full move numbers", () => {
  assert.equal(getPhase(12), "opening");
  assert.equal(getPhase(13), "middlegame");
  assert.equal(getPhase(31), "endgame");
});

test("clocksByPosition maps each position to the mover's remaining clock", () => {
  const c = new Chess();
  c.load_pgn(HUNG_QUEEN, { sloppy: true });
  const clocks = clocksByPosition(c);
  assert.equal(clocks.get(c.fen()), 150);
  assert.equal([...clocks.values()].filter(v => v === 30).length, 1);
});

test("analyze flags a hung queen as a mistake in time trouble", async () => {
  const report = await analyze(
    { username: "Alice", site: "lichess", timeControl: "both", numGames: 5 },
    hooks(),
    { engineFactory: scriptedEngine(QUEEN_DROP_EVALS), fetchGames: async () => [HUNG_QUEEN] },
  );
  assert.equal(report.games_analyzed, 1);
  assert.equal(report.total_mistakes, 1);
  assert.equal(report.weaknesses[0].key, "hung");
  assert.deepEqual(report.time_trouble, { count: 1, pct: 100, sampled: 1 });
  assert.equal(report.key_mistakes[0].move_label, "3.");
  assert.deepEqual(report.losing_openings, [["Test Opening", 1]]);
});

test("analyze skips games the user did not play", async () => {
  await assert.rejects(
    analyze({ username: "carol", site: "lichess", timeControl: "both", numGames: 5 }, hooks(),
      { engineFactory: scriptedEngine(QUEEN_DROP_EVALS), fetchGames: async () => [HUNG_QUEEN] }),
    /No blitz & rapid games found/,
  );
});

test("renderReport produces well-formed mistake cards", async () => {
  const report = await analyze(
    { username: "alice", site: "lichess", timeControl: "both", numGames: 5 },
    hooks(),
    { engineFactory: scriptedEngine(QUEEN_DROP_EVALS), fetchGames: async () => [HUNG_QUEEN] },
  );
  const html = renderReport(report);
  assert.match(html, /Game 1 · move 3\. · Hanging pieces<\/span>/);
  assert.equal((html.match(/<span/g) || []).length, (html.match(/<\/span>/g) || []).length);
});

test("board SVGs use unique arrow marker ids", () => {
  const fen = new Chess().fen();
  const arrows = [{ from: "e2", to: "e4", color: "red" }];
  const a = renderBoardSvg(fen, true, arrows), b = renderBoardSvg(fen, true, arrows);
  assert.notEqual(a.match(/marker id="([^"]+)"/)[1], b.match(/marker id="([^"]+)"/)[1]);
});

test("Engine converts mate scores and ignores bound-only lines", async () => {
  let worker;
  const engine = new Engine(undefined, {
    workerFactory: () => (worker = { sent: [], postMessage(m) { this.sent.push(m); }, terminate() {} }),
  });
  const ready = engine.init();
  assert.deepEqual(worker.sent, ['uci\n']);
  worker.onmessage({ data: "uciok" });
  await ready;

  const search = engine.analyse("8/8/8/8/8/8/8/K6k b - - 0 1", 100);
  assert.ok(worker.sent.every(command => command.endsWith('\n')));
  worker.onmessage({ data: "info depth 5 score cp 50\ninfo depth 6 score cp 900 lowerbound\nbestmove h1g1" });
  assert.deepEqual(await search, { whiteCp: -50, bestUci: "h1g1" });

  const mate = engine.analyse("8/8/8/8/8/8/8/K6k w - - 0 1", 100);
  worker.onmessage({ data: "info depth 9 score mate 2\nbestmove a1b1" });
  assert.equal((await mate).whiteCp, 9998);
  engine.quit();
});

test("share links round-trip and cap shared runs at 25 games", () => {
  const url = shareUrl({ username: "Magnus C", site: "chesscom", timeControl: "rapid", numGames: 25 }, "https://example.com/app/?old=1#x");
  assert.equal(url, "https://example.com/app/?u=Magnus+C&site=chesscom&tc=rapid&n=25");
  assert.deepEqual(paramsFromQuery(new URL(url).search), { username: "Magnus C", site: "chesscom", timeControl: "rapid", numGames: 25 });
  assert.deepEqual(paramsFromQuery("?u=x&site=evil&tc=bullet&n=100"), { username: "x", site: "lichess", timeControl: "both", numGames: 10 });
  assert.equal(paramsFromQuery("?site=lichess"), null);
});

test("big eval drops in already-won positions are not mistakes", async () => {
  // Same game, but White is +9 throughout and Qxf7+ only drops to +7.
  const report = await analyze(
    { username: "alice", site: "lichess", timeControl: "both", numGames: 5 },
    hooks(),
    { engineFactory: scriptedEngine([900, 900, 900, 900, 900, 700, 700]), fetchGames: async () => [HUNG_QUEEN] },
  );
  assert.equal(report.total_mistakes, 0);
  assert.equal(report.total_inaccuracies, 0);
});

test("playing the engine's best move is never flagged", async () => {
  const engineFactory = () => {
    const evals = [20, 30, 30, 0, 0, -700, -700];
    let i = 0;
    return { init: async () => {}, newGame() {}, quit() {},
      analyse: async () => ({ whiteCp: evals[i], bestUci: i++ === 4 ? "h5f7" : null }) };
  };
  const report = await analyze(
    { username: "alice", site: "lichess", timeControl: "both", numGames: 5 },
    hooks(), { engineFactory, fetchGames: async () => [HUNG_QUEEN] },
  );
  assert.equal(report.total_mistakes, 0);
});
