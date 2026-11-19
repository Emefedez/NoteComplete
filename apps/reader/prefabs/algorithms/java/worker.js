// Worker entry for the Java simulator: runs runJava off the UI thread.
//
//   const w = new Worker(new URL('./java/worker.js', import.meta.url), { type: 'module' });
//   w.postMessage({ id, source, options });           // options as runJava's (no functions)
//   w.onmessage = ({ data: { id, trace } }) => …;
//
// Cancel by terminating the worker, or share a cancel flag: pass
// options.cancelBuffer = new SharedArrayBuffer(4) and Atomics.store(new Int32Array(buf), 0, 1).

import { runJava } from './index.js';

self.onmessage = ({ data }) => {
  const { id, source, options = {} } = data || {};
  const opts = { ...options };
  if (opts.cancelBuffer) { opts.cancelFlag = new Int32Array(opts.cancelBuffer); delete opts.cancelBuffer; }
  let trace;
  try {
    trace = runJava(source, opts);
  } catch (e) {
    trace = { structures: {}, steps: [], error: { kind: 'internal', message: String(e && e.message) } };
  }
  self.postMessage({ id, trace });
};
