import { pipeline, env } from './vendor/transformers/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/transformers/', import.meta.url).href;
// Threads need cross-origin isolation plus SharedArrayBuffer; the app now serves both, older hosts stay single-threaded.
const isolated = self.crossOriginIsolated && typeof SharedArrayBuffer === 'function';
env.backends.onnx.wasm.numThreads = isolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;

const SAMPLE_RATE = 16000, CHUNK_SECONDS = 30, STRIDE_SECONDS = 5;
// Mirrors the pipeline's internal chunk loop so transcription can report real progress.
function chunkCount(samples) {
  const whole = SAMPLE_RATE * CHUNK_SECONDS, stride = SAMPLE_RATE * STRIDE_SECONDS, step = whole - 2 * stride;
  return samples.length <= whole ? 1 : Math.ceil((samples.length - whole) / step) + 1;
}
let transcriber, report = null;
self.onmessage = async ({ data }) => {
  try {
    if (!['tiny', 'base', 'small'].includes(data.model)) throw Error('Unknown Whisper model');
    transcriber ||= await pipeline('automatic-speech-recognition', `Xenova/whisper-${data.model}`, {
      device: 'wasm', dtype: 'q8',
      progress_callback: (progress) => self.postMessage({ type: 'progress', progress }),
    });
    const model = transcriber.model;
    if (model && typeof model.generate === 'function' && !model.noteCompleteProgress) {
      model.noteCompleteProgress = true;
      const generate = model.generate.bind(model);
      model.generate = (...args) => generate(...args).then(result => { report?.(result); return result; });
    }
    let done = 0;
    const total = chunkCount(data.samples);
    // Each finished 30 s window is decoded once so the reader can show text as it comes.
    report = result => {
      let text = '';
      try { text = transcriber.tokenizer.batch_decode(result?.sequences ?? result, { skip_special_tokens: true })[0]?.trim() || ''; } catch { /* Progress only. */ }
      self.postMessage({ type: 'speaking', done: ++done, total, text });
    };
    self.postMessage({ type: 'working' });
    const result = await transcriber(data.samples, {
      task: 'transcribe', return_timestamps: 'word',
      ...(data.language ? { language: data.language } : {}),
      chunk_length_s: CHUNK_SECONDS, stride_length_s: STRIDE_SECONDS,
    });
    report = null;
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    report = null;
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
};
