// The engine (worker.js, the Rust core compiled to WebAssembly) behind a request/reply
// interface. WebAssembly memory can only grow, so a big note leaves its memory taken for
// good; closing one therefore replaces the worker (`release`), and a small one is only
// freed inside the engine.
export const RECYCLE_BYTES = 32 * 1024 * 1024;

export class Engine {
  // create() returns a new worker; onReady(), onFatal(text) and onError(message) report on it.
  constructor({ create, threshold = RECYCLE_BYTES, onReady = () => {}, onFatal = () => {}, onError = () => {} }) {
    Object.assign(this, { create, threshold, onReady, onFatal, onError });
    this.pending = new Map();
    this.request = 0;
    this.size = 0;
    this.spawn();
  }
  spawn() {
    const worker = (this.worker = this.create());
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return;
      if (data.ready) return this.onReady();
      if (data.fatal) return this.onFatal(data.fatal);
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
    };
    worker.onerror = (event) => {
      if (worker !== this.worker) return;
      this.rejectAll(event.message);
      this.onError(event.message);
    };
  }
  rejectAll(message) {
    for (const p of this.pending.values()) p.reject(Error(message));
    this.pending.clear();
  }
  call(message, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.request;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...message }, transfer);
    });
  }
  // A note of `bytes` is now open in the engine.
  opened(bytes) { this.size = bytes; }
  // The note was closed. Returns true when the worker was replaced.
  release() {
    const big = this.size >= this.threshold;
    this.size = 0;
    if (!big) {
      this.call({ op: 'close' }).catch(() => {});
      return false;
    }
    const old = this.worker;
    this.spawn();
    old.terminate();
    this.rejectAll('Document closed');
    return true;
  }
}
