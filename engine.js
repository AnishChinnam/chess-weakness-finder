// A single UCI search at a time. Failed searches never become invented scores.
export class Engine {
  constructor(signal, { workerFactory = () => {
    const wasm = typeof WebAssembly === 'object' && WebAssembly.validate(Uint8Array.of(0,97,115,109,1,0,0,0));
    return new Worker(new URL(wasm ? './vendor/stockfish.wasm.js' : './vendor/stockfish.js', import.meta.url));
  }, startupTimeout = 15000 } = {}) {
    this.signal = signal;
    this.startupTimeout = startupTimeout;
    this.worker = workerFactory();
    this.pending = null;
    this.closed = false;
    this.worker.onmessage = e => this.onMessage(typeof e.data === 'string' ? e.data : e.data?.data || '');
    this.worker.onerror = () => this.quit(new Error('Stockfish could not run. Reload the page and try again.'));
    this.onAbort = () => this.quit(new DOMException('Analysis cancelled', 'AbortError'));
    signal?.addEventListener('abort', this.onAbort, { once: true });
    if (signal?.aborted) this.onAbort();
  }
  wait(kind, timeout, commands) {
    if (this.closed) return Promise.reject(new Error('The engine has stopped. Start a new analysis.'));
    if (this.pending) return Promise.reject(new Error('An engine search is already running.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.quit(new Error('Stockfish stopped responding. Keep this tab active and try again.')), timeout);
      this.pending = { kind, resolve, reject, timer, cp: null, mate: null };
      // The bundled engine reads a line-oriented stream; terminate queued input.
      try { commands.forEach(command => this.worker.postMessage(command + '\n')); }
      catch (error) { this.quit(error); }
    });
  }
  finish(value) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(value);
  }
  onMessage(data) {
    for (const line of data.split('\n')) {
      const p = this.pending;
      if (!p) continue;
      if (p.kind === 'init' && line.trim() === 'uciok') { this.finish(); continue; }
      if (p.kind !== 'search') continue;
      const score = line.match(/^info .*\bscore (cp|mate) (-?\d+)/);
      // Bounds are not exact evaluations and must not replace the last score.
      if (score && !/\b(lowerbound|upperbound)\b/.test(line)) {
        p.depth = Number(line.match(/\bdepth (\d+)/)?.[1] || 0);
        p.pv = line.match(/\bpv (.+)$/)?.[1]?.trim().split(/\s+/) || [];
        p.cp = score[1] === 'cp' ? Number(score[2]) : null;
        p.mate = score[1] === 'mate' ? Number(score[2]) : null;
      }
      if (line.startsWith('bestmove ')) {
        const move = line.trim().split(/\s+/)[1];
        const stm = p.mate !== null ? (p.mate > 0 ? 10000 - p.mate : -10000 - p.mate) : p.cp;
        if (stm === null) { this.quit(new Error('Stockfish returned no evaluation. Please retry.')); continue; }
        const result = { whiteCp: this.turn === 'w' ? stm : -stm, bestUci: /^(?:[a-h][1-8]){2}[qrbn]?$/.test(move) ? move : null };
        if (p.details) Object.assign(result, {depth:p.depth || 0, pv:p.pv || [], whiteMate:p.mate === null ? null : (this.turn === 'w' ? p.mate : -p.mate)});
        this.finish(result);
      }
    }
  }
  init() { return this.wait('init', this.startupTimeout, ['uci']); }
  newGame() { this.worker.postMessage('ucinewgame\n'); }
  analyse(fen, movetime, { nodes = 5000, details = false } = {}) {
    this.turn = fen.split(' ')[1];
    // Browser throttling can make a short search take much longer in wall time.
    // Bound both work and time; a slow search must still fail rather than invent a score.
    const promise = this.wait('search', movetime + 30000, ['position fen ' + fen, 'go movetime ' + movetime + ' nodes ' + nodes]);
    if (this.pending) this.pending.details = details;
    return promise;
  }
  quit(error = new DOMException('Analysis stopped', 'AbortError')) {
    if (this.closed) return;
    this.closed = true;
    this.signal?.removeEventListener('abort', this.onAbort);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    this.worker.terminate();
  }
}
