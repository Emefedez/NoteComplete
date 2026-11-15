// The model in this app runs here, off the page's thread (local-ai.js). The
// library has already been verified against its pinned SHA-256 on the main
// thread; passing its bytes lets us create the module Blob URL inside this
// worker realm (avoiding cross-context blob: restrictions on iOS WebKit).
const RETRYABLE_NETWORK_ERROR = /Failed to fetch|Load failed|NetworkError|network/i;

function installConstrainedFetch(maxConcurrent = 2) {
  const nativeFetch = self.fetch?.bind(self);
  if (typeof nativeFetch !== 'function') return;
  let active = 0;
  const queue = [];
  const acquire = () => (active < maxConcurrent
    ? (active++, Promise.resolve())
    : new Promise((resolve) => queue.push(resolve)));
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active = Math.max(0, active - 1);
  };
  self.fetch = async (input, init) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
    await acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await nativeFetch(input, init);
        } catch (error) {
          const canRetry = method === 'GET' && !signal?.aborted && attempt < 2
            && RETRYABLE_NETWORK_ERROR.test(String(error?.message || error));
          if (!canRetry) throw error;
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        }
      }
    } finally {
      release();
    }
  };
}

self.onmessage = async ({ data }) => {
  if (data?.notecomplete !== 'load') return;
  let localUrl = null;
  try {
    if (data.throttleDownloads) installConstrainedFetch(2);
    const targetUrl = data.bytes
      ? (localUrl = URL.createObjectURL(new Blob([data.bytes], { type: 'text/javascript' })))
      : data.url;
    const webllm = await import(targetUrl);
    const handler = new webllm.WebWorkerMLCEngineHandler();
    self.onmessage = (event) => handler.onmessage(event);
    self.postMessage({ notecomplete: 'ready' });
  } catch (error) {
    self.postMessage({ notecomplete: 'error', message: String(error?.message || error) });
  } finally {
    if (localUrl) {
      try { URL.revokeObjectURL(localUrl); } catch { /* Optional cleanup. */ }
    }
  }
};
