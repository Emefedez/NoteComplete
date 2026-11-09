// The model in this app runs here, off the page's thread (local-ai.js). The
// page sends the blob: URL of the WebLLM library it has already checked; this
// worker imports that same copy and hands every later message to WebLLM.
self.onmessage = async ({ data }) => {
  if (data?.notecomplete !== 'load') return;
  try {
    const webllm = await import(data.url);
    const handler = new webllm.WebWorkerMLCEngineHandler();
    self.onmessage = event => handler.onmessage(event);
    self.postMessage({ notecomplete: 'ready' });
  } catch (error) {
    self.postMessage({ notecomplete: 'error', message: String(error?.message || error) });
  }
};
