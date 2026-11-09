// AI in the app: a small language model run on this device's GPU with WebLLM
// (docs/LOCAL-AI.md). It is one more provider, "webllm", behind the same
// interface as the desktop bridge (window.notecompleteAI: providers, models,
// run, cancel). On the desktop it joins the user's own AI tools; on the
// website it is the only one. Nothing here differs by platform except whether
// a native bridge exists.
//
// Importing this module costs nothing: the 6.8 MB library, the worker and the
// model are loaded on the first request that uses them.
import { jobChip } from './jobs.js';

export const LOCAL_ID = 'webllm';
export const LOCAL_LABEL = 'In this app (WebLLM)';
// The library comes from the pinned npm release on jsDelivr and is run only if
// its hash matches (tools/build_web.py checks this pin against node_modules).
// It is not vendored: the desktop stage ships every vendored file in the
// installer, and this feature downloads a model of a gigabyte anyway.
export const WEBLLM_VERSION = '0.2.87';
export const WEBLLM_URL = `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/lib/index.js`;
export const WEBLLM_SHA256 = '3bff4c55cd2f0200711517341babcebe7a91a8ef85b983420439fcf26835a674';
const LIBRARY_CACHE = 'notecomplete-webllm';
// WebLLM's own Cache Storage entries (its default "cache" backend).
const MODEL_CACHES = ['webllm/model', 'webllm/config', 'webllm/wasm'];
const DOWNLOADED_KEY = 'notecomplete-local-models';

// A short list of small instruct models. Each has a half-precision build
// (smaller, faster, needs the GPU's shader-f16 feature) and a full-precision one
// for every other WebGPU device. Sizes in GB: download (Hugging Face
// tensor-cache.json) and GPU memory (vram_required_MB). Pages are read with the
// app's own OCR (small-model.js), so the default is a text model; Phi 3.5
// Vision is offered for pages OCR cannot read, but measured on handwritten notes
// it misread them and took ~30 s per page (docs/LOCAL-AI.md).
export const CATALOGUE = [
  { id: 'qwen3-1.7b', label: 'Qwen3 1.7B', f16: 'Qwen3-1.7B-q4f16_1-MLC', f32: 'Qwen3-1.7B-q4f32_1-MLC', download: 1.0, memory: 2.0, thinking: true },
  { id: 'qwen3-0.6b', label: 'Qwen3 0.6B (fastest)', f16: 'Qwen3-0.6B-q4f16_1-MLC', f32: 'Qwen3-0.6B-q4f32_1-MLC', download: 0.3, memory: 1.4, thinking: true },
  { id: 'llama-3.2-1b', label: 'Llama 3.2 1B', f16: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', f32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', download: 0.7, memory: 0.9 },
  { id: 'llama-3.2-3b', label: 'Llama 3.2 3B', f16: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', f32: 'Llama-3.2-3B-Instruct-q4f32_1-MLC', download: 1.8, memory: 2.3 },
  { id: 'qwen3-4b', label: 'Qwen3 4B (best, slower)', f16: 'Qwen3-4B-q4f16_1-MLC', f32: 'Qwen3-4B-q4f32_1-MLC', download: 2.3, memory: 3.4, thinking: true },
  { id: 'phi-3.5-vision', label: 'Phi 3.5 Vision', f16: 'Phi-3.5-vision-instruct-q4f16_1-MLC-6k', f32: 'Phi-3.5-vision-instruct-q4f32_1-MLC-6k', download: 2.8, memory: 5.3, vision: true, context: 6144 },
];
export const DEFAULT_MODEL = 'qwen3-1.7b';
// Our own records beside WebLLM's prebuilt list: the same model files and
// compiled code with other settings. Phi 3.5 Vision with a 6,144-token window
// fits one page image (up to ~2,400 tokens), the instructions and a dense page's
// transcription; the extra KV cache is about 0.8 GB.
// A record may also swap the compiled code (`lib`: [from, to] in its URL).
export const CUSTOM_RECORDS = [
  { base: 'Phi-3.5-vision-instruct-q4f16_1-MLC', id: 'Phi-3.5-vision-instruct-q4f16_1-MLC-6k', context: 6144, extraMB: 800 },
  { base: 'Phi-3.5-vision-instruct-q4f32_1-MLC', id: 'Phi-3.5-vision-instruct-q4f32_1-MLC-6k', context: 6144, extraMB: 800 },
];
// The engine's model list: our records first, then WebLLM's (typed ids still work).
export function appModelList(prebuilt = []) {
  const ours = CUSTOM_RECORDS.flatMap(c => {
    const record = prebuilt.find(r => r.model_id === c.base);
    if (!record || (c.lib && !record.model_lib.includes(c.lib[0]))) return [];
    return [{ ...record, model_id: c.id, model_lib: c.lib ? record.model_lib.replace(c.lib[0], c.lib[1]) : record.model_lib, overrides: { ...record.overrides, context_window_size: c.context }, vram_required_MB: (record.vram_required_MB || 0) + c.extraMB }];
  });
  return [...ours, ...prebuilt.filter(r => !ours.some(o => o.model_id === r.model_id))];
}
// The prebuilt models' context window, prompt and answer together.
export const CONTEXT_TOKENS = 4096;
// Conservative for Spanish and formulas; English is nearer four.
const CHARS_PER_TOKEN = 3;
const ANSWER_TOKENS = { json: 1536, text: 1024 };
const STOPPED = 'The AI request was stopped.';
export const NO_WEBGPU = 'This browser has WebGPU but found no graphics adapter it can use, so the AI in this app cannot run here. Try Chrome or Edge with up-to-date graphics drivers, or the desktop app with an AI tool.';

// ---- Pure parts (unit-tested) ----

// The desktop tools first (they are stronger), then the model in this app.
export function mergeProviders(native = [], local = null) {
  return [...(Array.isArray(native) ? native : []).filter(p => p?.id !== LOCAL_ID), ...(local ? [local] : [])];
}

export const localEntry = () => ({ id: LOCAL_ID, label: LOCAL_LABEL, available: true, contextTokens: CONTEXT_TOKENS });

// The models offered in the dropdown; ids are the catalogue's, so a choice
// survives the GPU picking the other precision.
export function modelList(downloaded = new Set(), f16 = true) {
  return CATALOGUE.map(m => {
    const have = downloaded.has(f16 ? m.f16 : m.f32) || downloaded.has(m.f16) || downloaded.has(m.f32);
    return { id: m.id, label: `${m.label} · ${m.vision ? 'reads pages' : 'text only'} · ${have ? 'downloaded' : `${m.download} GB download`}` };
  });
}

// A choice (catalogue id, a typed WebLLM model_id, or '' for the default) as
// the model to load. `list` is appModelList(WebLLM's prebuilt list).
export function resolveModel(choice, { f16 = true, list = [] } = {}) {
  const wanted = String(choice || '').trim() || DEFAULT_MODEL;
  const entry = CATALOGUE.find(m => m.id === wanted || m.f16 === wanted || m.f32 === wanted);
  const id = entry ? (f16 ? entry.f16 : entry.f32) : wanted;
  const record = list.find(r => r.model_id === id);
  if (!entry && (!record || record.model_type === 1)) throw Error(`"${wanted}" is not a model the AI in this app offers. Choose one from the list, or type a model id from WebLLM's prebuilt list.`);
  if (!entry && !f16 && record.required_features?.includes('shader-f16')) throw Error(`${wanted} needs half-precision shaders (shader-f16), which this GPU does not offer. Choose a q4f32 model.`);
  return {
    id,
    label: entry?.label.replace(/ \(.*\)$/, '') || id,
    thinking: entry ? !!entry.thinking : /qwen3/i.test(id),
    vision: entry ? !!entry.vision : record?.model_type === 2,
    context: Number(record?.overrides?.context_window_size) || CONTEXT_TOKENS,
  };
}
// Without loading the library: whether a choice reads images, and its window.
export function capabilitiesOf(choice) {
  const wanted = String(choice || '').trim() || DEFAULT_MODEL;
  const entry = CATALOGUE.find(m => m.id === wanted || m.f16 === wanted || m.f32 === wanted);
  return entry ? { vision: !!entry.vision, contextTokens: entry.context || CONTEXT_TOKENS } : { vision: /vision/i.test(wanted), contextTokens: CONTEXT_TOKENS };
}

// Phi 3.5 Vision's image size and token count (WebLLM's phi3_v resize: up to 16
// crops of 336 px, plus a 12 × 13 global view): set by the aspect ratio alone.
export function visionSize(width, height) {
  const ratio = width / height;
  let scale = 1;
  while (scale * Math.ceil(scale / ratio) <= 16) scale++;
  scale--;
  const w = scale * 336;
  return [w, Math.floor(w / ratio)];
}
export function visionTokens(width, height) {
  const [w, h] = visionSize(width, height), rows = Math.ceil(h / 336), cols = w / 336;
  return rows * 12 * (cols * 12 + 1) + 1 + 12 * 13;
}
// A page image's size when sent: scaled down (never up) to what the model uses.
// (Padding pages to cost fewer tokens was measured: it read worse; LOCAL-AI.md.)
export function imageLayout(width, height) {
  const [w] = visionSize(width, height), s = Math.min(1, w / width);
  const r = v => Math.max(1, Math.round(v * s));
  return { width: r(width), height: r(height) };
}

// Prompts that ask for JSON only (quiz, cards, checks, transcript revision).
export function wantsJson(request) {
  return !!request?.schema || /reply with only (this )?json/i.test(String(request?.prompt || ''));
}
// WebLLM 0.2.87 compiles `json_object` through its JSON Schema path even without
// a schema, and fails ("Cannot pass non-string to std::string"), so a request
// with none gets "any object": every prompt here asks for one.
export const ANY_OBJECT = '{"type":"object"}';
export function responseFormat(request) {
  if (request?.schema && typeof request.schema === 'object') return { type: 'json_object', schema: JSON.stringify(request.schema) };
  return wantsJson(request) ? { type: 'json_object', schema: ANY_OBJECT } : undefined;
}

// Characters of prompt that fit beside the answer in the context window.
export function promptBudget(context = CONTEXT_TOKENS, json = false) {
  return Math.max(1200, (context - ANSWER_TOKENS[json ? 'json' : 'text'] - 200) * CHARS_PER_TOKEN);
}

// A prompt cut to `limit` characters: its beginning (the instructions) and its
// end (the question, the last pages) stay; the middle is replaced by a note.
// Cuts fall on a line or word break near the edge.
export function fitPrompt(prompt, limit) {
  const text = String(prompt);
  if (text.length <= limit) return { text, cut: 0 };
  const room = Math.max(200, limit - 170);
  let head = Math.floor(room * 0.4), tail = room - head;
  const at = (s, from, to) => { const i = Math.max(s.lastIndexOf('\n', to), s.lastIndexOf(' ', to)); return i > from ? i : to; };
  head = at(text, head - 200, head);
  const start = text.length - tail, next = text.slice(start, start + 200).search(/[\n ]/);
  tail = next >= 0 ? tail - next : tail;
  const cut = text.length - head - tail;
  return { text: `${text.slice(0, head)}\n\n[… ${cut} characters of the notes were left out: the model in this app reads about ${limit} characters at a time]\n\n${text.slice(text.length - tail).replace(/^[\n ]+/, '')}`, cut };
}

// A desktop request as one chat message. No system message: some prebuilt
// chat templates refuse a custom one. A vision model gets the first image (as
// prepared by shrinkImage: { url, width, height }) as an image_url part and
// the text gets what the image leaves of the window; a text-only model is told
// the images were left out. `scale` shrinks the budget for a retry.
export function requestToMessages(request, { context = CONTEXT_TOKENS, scale = 1, vision = false, image = null } = {}) {
  const images = Array.isArray(request?.images) ? request.images.length : 0;
  const json = wantsJson(request);
  const asked = Number(request?.maxTokens) > 0 ? Math.floor(Number(request.maxTokens)) : ANSWER_TOKENS[json ? 'json' : 'text'];
  let answer = Math.min(asked, Math.floor(context / 2)), room = context - 200, lead = '';
  const seen = vision && image;
  if (seen) {
    room -= visionTokens(image.width, image.height);
    if (images > 1) lead = `(Only the first image is attached; ${images - 1} other${images > 2 ? 's were' : ' was'} left out.)\n\n`;
    if ((room - answer) * CHARS_PER_TOKEN < 600) answer = Math.max(256, room - 200);
  } else if (images) {
    lead = `(You cannot see images: ${images === 1 ? 'the attached image was' : `the ${images} attached images were`} left out. Use only the text given here; where it says to read an image, rely on the extracted text.)\n\n`;
  }
  const budget = Math.max(600, (room - answer) * CHARS_PER_TOKEN);
  const { text, cut } = fitPrompt(String(request?.prompt || ''), Math.floor(budget * scale) - lead.length);
  const content = seen ? [{ type: 'image_url', image_url: { url: image.url } }, { type: 'text', text: lead + text }] : lead + text;
  return { messages: [{ role: 'user', content }], json, cut, maxTokens: answer };
}

// Answers without a model's reasoning block (Qwen3 with thinking left on).
export function visibleText(full) {
  return String(full).replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/<think>[\s\S]*$/, '').replace(/^\s+/, '');
}
// The part of the visible answer not streamed yet.
export function nextDelta(sent, full) {
  const visible = visibleText(full);
  return visible.startsWith(sent) ? { delta: visible.slice(sent.length), sent: visible } : { delta: '', sent };
}

// WebLLM's loading messages ("Fetching param cache[3/30]: 120MB fetched. 12%
// completed…") as a short phase for the job chip.
export function phaseOf(report = {}) {
  const text = String(report.text || ''), pct = Math.round((Number(report.progress) || 0) * 100);
  const mb = text.match(/(\d+)\s*MB (fetched|loaded)/);
  if (/fetch/i.test(text) && !/finish/i.test(text)) return `downloading ${pct}%${mb ? ` · ${(Number(mb[1]) / 1000).toFixed(1)} GB` : ''}`;
  if (/loading model from cache/i.test(text)) return `loading ${pct}%`;
  if (/shader|gpu/i.test(text)) return 'preparing the GPU';
  return pct ? `loading ${pct}%` : 'starting';
}

// Engine errors in the reader's words.
export function friendlyError(error) {
  const name = String(error?.name || ''), message = String(error?.message || error || '');
  if (message === STOPPED) return error;
  if (/DeviceLost|out of memory|OOM/i.test(name + message)) return Error('The GPU ran out of memory for this model. Close other tabs or choose a smaller model.');
  if (/ShaderF16/i.test(name)) return Error('This GPU cannot run half-precision models. Choose another model.');
  if (/WebGPUNot/i.test(name)) return Error(NO_WEBGPU);
  if (/NonVLM/i.test(name)) return Error('This model cannot read images. Choose Phi 3.5 Vision, or tick Small model so images are left out.');
  if (/QuotaExceeded|quota/i.test(name + message)) return Error('Not enough storage for this model. Free some space or delete downloaded models (Downloaded models… beside the model list).');
  if (/Failed to fetch|NetworkError|network/i.test(message)) return Error('Could not download the model. Check the connection and try again; what was already downloaded is kept.');
  return Error(`The AI in this app failed: ${message.slice(0, 300) || 'unknown error'}`);
}

// ---- Browser parts ----

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The library, from this browser's cache or jsDelivr, run only if its hash is
// the pinned one. The page and the worker import it from the same blob: URL.
export async function loadWebLLM({ fetchImpl = globalThis.fetch, cacheStorage = globalThis.caches } = {}) {
  const cache = await cacheStorage?.open(LIBRARY_CACHE).catch(() => null);
  let bytes = null;
  const kept = await cache?.match(WEBLLM_URL).catch(() => null);
  if (kept) {
    bytes = new Uint8Array(await kept.arrayBuffer());
    if (await sha256(bytes) !== WEBLLM_SHA256) { bytes = null; await cache.delete(WEBLLM_URL).catch(() => {}); }
  }
  if (!bytes) {
    const response = await fetchImpl(WEBLLM_URL, { mode: 'cors', credentials: 'omit' }).catch(() => null);
    if (!response?.ok) throw Error('Could not download the AI engine (WebLLM). Check the connection and try again.');
    bytes = new Uint8Array(await response.arrayBuffer());
    if (await sha256(bytes) !== WEBLLM_SHA256) throw Error('The downloaded AI engine is not the expected version, so it was not run.');
    await cache?.put(WEBLLM_URL, new Response(bytes, { headers: { 'content-type': 'text/javascript' } })).catch(() => {});
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  return { module: await import(/* @vite-ignore */ url), url };
}

// A page image scaled down (never up) to the size the vision model resizes it
// to, as a JPEG data: URL: the model sees the same pixels, the worker decodes less.
export async function shrinkImage(image) {
  const bitmap = await createImageBitmap(new Blob([image.bytes], { type: image.type }));
  try {
    const { width, height } = imageLayout(bitmap.width, bitmap.height);
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) : await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { url: `data:image/jpeg;base64,${btoa(binary)}`, width, height };
  } finally {
    bitmap.close?.();
  }
}

// The worker imports the library from the page's blob: URL, then answers.
function startWorker(worker, url) {
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data?.notecomplete === 'ready') resolve();
      else if (data?.notecomplete === 'error') reject(Error(data.message || 'The AI worker failed to start.'));
    };
    worker.onerror = event => { event.preventDefault?.(); reject(Error(event.message || 'The AI worker failed to start.')); };
    worker.postMessage({ notecomplete: 'load', url });
  });
}

const readDownloaded = storage => { try { return new Set(JSON.parse(storage?.getItem(DOWNLOADED_KEY) || '[]')); } catch { return new Set(); } };
const writeDownloaded = (storage, set) => { try { storage?.setItem(DOWNLOADED_KEY, JSON.stringify([...set])); } catch { /* Optional: only labels depend on it. */ } };

// Download and loading progress as a chip in the command bar (jobs.js).
function chipProgress() {
  let chips = null;
  return {
    start(title, cancel) {
      chips ||= jobChip({ status: () => {} });
      return chips.start(title, { kind: 'local-model', cancel });
    },
  };
}

// The engine: one worker, one loaded model, requests one at a time.
// Everything that touches the browser is injectable for tests.
export function createLocalRuntime({
  gpu = globalThis.navigator?.gpu,
  loadLibrary = loadWebLLM,
  createWorker = () => new Worker(new URL('./local-ai-worker.js', import.meta.url), { type: 'module' }),
  progress = chipProgress(),
  storage = globalThis.localStorage,
  persist = () => globalThis.navigator?.storage?.persist?.().catch(() => false),
  prepareImage = shrinkImage,
  // A loaded model holds GPU memory (about 5 GB for Phi 3.5 Vision, shared with
  // the rest of the computer on Apple and integrated GPUs): it is unloaded after
  // this long without requests, and loads again from the cache in seconds.
  idleMs = 3 * 60 * 1000,
} = {}) {
  let library = null, engine = null, worker = null, loaded = '', abort = null, probed = null, tail = Promise.resolve();
  const entries = new Set();

  const probe = () => (probed ||= (async () => {
    const adapter = await gpu?.requestAdapter?.().catch(() => null);
    return { adapter: !!adapter, f16: !!adapter?.features?.has?.('shader-f16') };
  })());
  const getLibrary = () => (library ||= loadLibrary().catch(error => { library = null; throw error; }));
  const appConfigOf = lib => ({ ...lib.module.prebuiltAppConfig, model_list: appModelList(lib.module.prebuiltAppConfig?.model_list || []) });

  // Drop the worker and the GPU memory it holds.
  function teardown() {
    worker?.terminate();
    worker = engine = null;
    loaded = '';
  }
  // The same, and a load in progress fails.
  function reset() {
    abort?.(Error(STOPPED));
    abort = null;
    teardown();
  }

  async function ensure(choice, gpuInfo) {
    let chip = null;
    const stopped = new Promise((_, reject) => { abort = reject; });
    stopped.catch(() => {});
    const race = promise => Promise.race([promise, stopped]);
    try {
      if (!library) chip = progress.start('AI engine', () => cancel());
      chip?.set?.(0.02, 'downloading WebLLM');
      const lib = await race(getLibrary());
      const model = resolveModel(choice, { f16: gpuInfo.f16, list: appConfigOf(lib).model_list });
      if (engine && loaded === model.id) return model;
      if (engine) teardown();
      const downloaded = readDownloaded(storage);
      if (!downloaded.has(model.id)) await persist();
      chip?.finish?.('');
      chip = progress.start(`AI model ${model.label}`, () => cancel());
      chip?.set?.(0.01, downloaded.has(model.id) ? 'loading' : 'starting the download');
      worker = createWorker();
      await race(startWorker(worker, lib.url));
      engine = new lib.module.WebWorkerMLCEngine(worker, { appConfig: appConfigOf(lib), initProgressCallback: report => chip?.set?.(Math.min(0.99, Number(report?.progress) || 0), phaseOf(report)) });
      await race(engine.reload(model.id));
      loaded = model.id;
      downloaded.add(model.id);
      writeDownloaded(storage, downloaded);
      chip?.finish?.('');
      chip = null;
      return model;
    } catch (error) {
      chip?.fail?.('');
      if (!loaded) teardown();
      throw error;
    } finally {
      abort = null;
    }
  }

  async function execute(entry, request, onDelta) {
    const check = () => { if (entry.cancelled) throw Error(STOPPED); };
    check();
    if (typeof request?.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 400_000) throw Error('Empty or oversized request.');
    const gpuInfo = await probe();
    if (!gpuInfo.adapter) throw Error(NO_WEBGPU);
    entry.stage = 'loading';
    let model;
    try { model = await ensure(request.model, gpuInfo); } catch (error) { check(); throw friendlyError(error); }
    check();
    // A vision model gets the first page image, prepared once for any retry.
    let image = null;
    const first = model.vision ? (request.images || []).find(i => /^image\/(jpeg|png|webp)$/.test(i?.type || '') && i.bytes) : null;
    if (first) {
      try { image = await prepareImage(first); } catch (error) { throw Error(`Could not prepare the page image: ${error.message}`); }
    }
    check();
    entry.stage = 'writing';
    for (let attempt = 0, scale = 1; ; attempt++, scale = 0.6) {
      const { messages, json, maxTokens } = requestToMessages(request, { context: model.context, scale, vision: model.vision, image });
      try {
        const format = responseFormat(request);
        const chunks = await engine.chat.completions.create({
          messages, stream: true, max_tokens: maxTokens, temperature: json ? 0.3 : 0.6,
          ...(format ? { response_format: format } : {}),
          ...(model.thinking ? { extra_body: { enable_thinking: false } } : {}),
        });
        let full = '', sent = '';
        for await (const chunk of chunks) {
          full += chunk?.choices?.[0]?.delta?.content || '';
          if (!onDelta) continue;
          const next = nextDelta(sent, full);
          sent = next.sent;
          if (next.delta) onDelta(next.delta);
        }
        check();
        const text = visibleText(full).trim();
        if (!text) throw Error('The model in this app returned no answer. Try again, or choose a larger model.');
        return { text };
      } catch (error) {
        check();
        if (!attempt && /ContextWindowSizeExceeded|exceed context window/i.test(`${error?.name} ${error?.message}`)) continue;
        throw /returned no answer/.test(error?.message) ? error : friendlyError(error);
      }
    }
  }

  let idle = 0;
  function run(request, onDelta = null) {
    clearTimeout(idle);
    const entry = { tag: String(request?.tag || ''), cancelled: false, stage: 'queued' };
    entries.add(entry);
    const job = tail.then(() => execute(entry, request, typeof onDelta === 'function' ? onDelta : null));
    tail = job.catch(() => {});
    return job.finally(() => {
      entries.delete(entry);
      if (!entries.size && engine) { clearTimeout(idle); idle = setTimeout(() => { if (!entries.size) teardown(); }, idleMs); idle?.unref?.(); }
    });
  }
  // Requests with this tag (every one without a tag): queued ones fail when
  // their turn comes, a running answer is interrupted, a download is stopped.
  function cancel(tag = '') {
    for (const entry of entries) if (!tag || entry.tag === tag) {
      entry.cancelled = true;
      if (entry.stage === 'loading') reset();
      if (entry.stage === 'writing') engine?.interruptGenerate?.();
    }
    if (!tag) abort?.(Error(STOPPED));
  }

  async function models() {
    const { f16 } = await probe();
    return modelList(readDownloaded(storage), f16);
  }

  // What is actually in the caches; the kept record is corrected from it.
  async function downloadedModels() {
    const known = readDownloaded(storage);
    const hasCache = await globalThis.caches?.has?.(LIBRARY_CACHE).catch(() => false);
    if (!library && !hasCache && !known.size) return known;
    const lib = await getLibrary().catch(() => null);
    if (!lib?.module?.hasModelInCache) return known;
    const config = appConfigOf(lib);
    const ids = new Set([...CATALOGUE.flatMap(m => [m.f16, m.f32]), ...known]);
    const found = new Set();
    for (const id of ids) if (await lib.module.hasModelInCache(id, config).catch(() => false)) found.add(id);
    writeDownloaded(storage, found);
    return found;
  }
  async function remove(ids) {
    const lib = await getLibrary();
    if (ids.includes(loaded)) reset();
    for (const id of ids) await lib.module.deleteModelAllInfoInCache(id, appConfigOf(lib));
    const kept = readDownloaded(storage);
    for (const id of ids) kept.delete(id);
    writeDownloaded(storage, kept);
  }
  async function removeAll() {
    reset();
    for (const name of [...MODEL_CACHES, LIBRARY_CACHE]) await globalThis.caches?.delete(name).catch(() => {});
    writeDownloaded(storage, new Set());
  }

  return { probe, run, cancel, models, reset, capabilities: capabilitiesOf, downloadedModels, remove, removeAll, manage: () => manageDialog({ downloadedModels, remove, removeAll }) };
}

// Downloaded models…: what is kept on this device, and deleting it.
async function manageDialog({ downloadedModels, remove, removeAll }) {
  const make = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  const dialog = make('dialog', { className: 'ocr-dialog local-models' });
  dialog.setAttribute('aria-label', 'Models in this app');
  const usage = make('p', { className: 'muted', textContent: 'Checking storage…' });
  const table = make('table', { className: 'local-models-table' });
  const close = make('button', { type: 'button', className: 'primary', textContent: 'Close' });
  const all = make('button', { type: 'button', textContent: 'Delete everything' });
  dialog.append(
    make('h2', { textContent: 'Models in this app' }),
    make('p', { textContent: 'These models run on this device’s graphics card. Each is downloaded once and kept in this browser’s storage; what you ask never leaves the device.' }),
    table, usage,
    make('div', { className: 'ocr-actions' }, all, make('span', { className: 'spacer' }), close));
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  // Enter on the first button must not delete everything.
  close.focus();
  async function draw() {
    let found = new Set();
    try { found = await downloadedModels(); } catch { /* Shown as not downloaded. */ }
    const rows = CATALOGUE.map(m => {
      const ids = [m.f16, m.f32].filter(id => found.has(id));
      const button = make('button', { type: 'button', textContent: 'Delete', disabled: !ids.length });
      button.onclick = async () => { button.disabled = true; await remove(ids).catch(error => { usage.textContent = error.message; }); draw(); };
      return make('tr', {}, make('th', { textContent: m.label }), make('td', { textContent: `${m.download} GB` }), make('td', { textContent: ids.length ? 'Downloaded' : 'Not downloaded' }), make('td', {}, button));
    });
    for (const id of found) if (!CATALOGUE.some(m => m.f16 === id || m.f32 === id)) {
      const button = make('button', { type: 'button', textContent: 'Delete' });
      button.onclick = async () => { button.disabled = true; await remove([id]).catch(error => { usage.textContent = error.message; }); draw(); };
      rows.push(make('tr', {}, make('th', { textContent: id }), make('td'), make('td', { textContent: 'Downloaded' }), make('td', {}, button)));
    }
    table.replaceChildren(...rows);
    const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => null);
    usage.textContent = estimate?.usage ? `This site uses ${(estimate.usage / 1e9).toFixed(1)} GB of storage${estimate.quota ? ` of ${(estimate.quota / 1e9).toFixed(0)} GB available` : ''}.` : '';
  }
  all.onclick = async () => {
    if (!confirm('Delete every downloaded model? They download again when next used.')) return;
    all.disabled = true; await removeAll(); all.disabled = false; draw(); };
  draw();
}

// ---- The merged bridge ----

// The desktop bridge with the model in this app added, or the model alone on
// the web. Without WebGPU nothing is added (and the web has no AI, as before).
export function withLocalAI(native = null, { gpu = globalThis.navigator?.gpu, runtime = null } = {}) {
  if (!gpu) return native || null;
  const local = runtime || createLocalRuntime({ gpu });
  // Where no adapter is found, the website still lists it so using it explains
  // why; the desktop app just leaves it out.
  const entry = async () => ((await local.probe()).adapter || !native ? localEntry() : null);
  return {
    async providers() {
      const [mine, theirs] = await Promise.all([entry(), native ? native.providers().catch(() => []) : []]);
      return mergeProviders(theirs, mine);
    },
    async models(provider, options) {
      if (provider === LOCAL_ID) return local.models();
      return native?.models ? native.models(provider, options) : [];
    },
    run(request, onDelta) {
      if (request?.provider === LOCAL_ID) return local.run(request, onDelta);
      if (!native) return Promise.reject(Error('No AI tool is available here.'));
      return typeof onDelta === 'function' ? native.run(request, onDelta) : native.run(request);
    },
    cancel(tag) {
      native?.cancel?.(tag);
      local.cancel(typeof tag === 'string' ? tag : '');
    },
    canManage: provider => provider === LOCAL_ID,
    manage: () => local.manage(),
    // Whether a model reads images and its window (0: large, the desktop tools).
    capabilities: (provider, model) => (provider === LOCAL_ID ? (local.capabilities || capabilitiesOf)(model) : { vision: true, contextTokens: 0 }),
    smallByDefault: provider => provider === LOCAL_ID,
    // The dropdown's first entry names the model it stands for.
    defaultLabel: provider => (provider === LOCAL_ID ? `Default: ${CATALOGUE.find(m => m.id === DEFAULT_MODEL).label}` : undefined),
  };
}

// One bridge per reader, so every feature shares one engine and one queue.
let shared;
export function sharedAI() {
  if (shared === undefined) shared = withLocalAI(globalThis.notecompleteAI || null);
  return shared;
}

