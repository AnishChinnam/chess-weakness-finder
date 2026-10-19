// A single UCI search at a time. Failed searches never become invented scores.
export class Engine {
  constructor(signal, { workerFactory = () => new Worker(new URL('./vendor/stockfish.js', import.meta.url)), startupTimeout = 15000 } = {}) {
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
      const timer = setTimeout(() => this.quit(new Error('Stockfish stopped responding. Please try a smaller game sample.')), timeout);
      this.pending = { kind, resolve, reject, timer, cp: null, mate: null };
      try { commands.forEach(command => this.worker.postMessage(command)); }
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
        p.cp = score[1] === 'cp' ? Number(score[2]) : null;
        p.mate = score[1] === 'mate' ? Number(score[2]) : null;
      }
      if (line.startsWith('bestmove ')) {
        const move = line.trim().split(/\s+/)[1];
        const stm = p.mate !== null ? (p.mate > 0 ? 10000 - p.mate : -10000 - p.mate) : p.cp;
        if (stm === null) { this.quit(new Error('Stockfish returned no evaluation. Please retry.')); continue; }
        this.finish({ whiteCp: this.turn === 'w' ? stm : -stm, bestUci: /^(?:[a-h][1-8]){2}[qrbn]?$/.test(move) ? move : null });
      }
    }
  }
  init() { return this.wait('init', this.startupTimeout, ['uci']); }
  newGame() { this.worker.postMessage('ucinewgame'); }
  analyse(fen, movetime) {
    this.turn = fen.split(' ')[1];
    return this.wait('search', movetime + 5000, ['position fen ' + fen, 'go movetime ' + movetime]);
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
