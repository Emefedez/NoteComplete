import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  LOCAL_ID, CATALOGUE, DEFAULT_MODEL, WEBLLM_SHA256, WEBLLM_VERSION, WEBLLM_URL, NO_WEBGPU,
  mergeProviders, localEntry, modelList, resolveModel, wantsJson, responseFormat, promptBudget,
  fitPrompt, requestToMessages, visibleText, nextDelta, phaseOf, friendlyError,
  withLocalAI, createLocalRuntime, appModelList, capabilitiesOf, visionSize, visionTokens, CUSTOM_RECORDS, imageLayout,
} from './local-ai.js';
import { studySchema } from './study.js';

const webllm = await import('@mlc-ai/web-llm');
const prebuilt = appModelList(webllm.prebuiltAppConfig.model_list);

test('the pinned library is the installed npm package, byte for byte', async () => {
  const url = new URL('./node_modules/@mlc-ai/web-llm/', import.meta.url);
  const { version } = JSON.parse(await readFile(new URL('package.json', url), 'utf8'));
  assert.equal(version, WEBLLM_VERSION);
  assert.ok(WEBLLM_URL.includes(`@mlc-ai/web-llm@${version}/lib/index.js`));
  assert.equal(createHash('sha256').update(await readFile(new URL('lib/index.js', url))).digest('hex'), WEBLLM_SHA256);
});

test('our records are WebLLM’s with other settings, ahead of the prebuilt list', () => {
  const raw = webllm.prebuiltAppConfig.model_list;
  for (const c of CUSTOM_RECORDS) {
    const ours = prebuilt.find(r => r.model_id === c.id), base = raw.find(r => r.model_id === c.base);
    assert.equal(ours.model, base.model, 'same weights');
    assert.equal(ours.model_lib, c.lib ? base.model_lib.replace(c.lib[0], c.lib[1]) : base.model_lib);
    assert.equal(ours.model_type, 2);
    assert.equal(ours.overrides.context_window_size, c.context);
  }
  assert.equal(prebuilt.length, raw.length + CUSTOM_RECORDS.length);
});

test('every catalogue model is in the engine’s list, in both precisions', () => {
  for (const m of CATALOGUE) for (const id of [m.f16, m.f32]) {
    const record = prebuilt.find(r => r.model_id === id);
    assert.ok(record, id);
    assert.notEqual(record.model_type, 1, `${id} is an embedding model`);
    assert.ok(!record.required_features?.includes('shader-f16') || id === m.f16, `${id} needs shader-f16`);
  }
  assert.ok(CATALOGUE.some(m => m.id === DEFAULT_MODEL));
  // Pages are read with the app's OCR: the default is a text model; one model reads images.
  assert.ok(!CATALOGUE.find(m => m.id === DEFAULT_MODEL).vision);
  assert.ok(CATALOGUE.some(m => m.vision));
  for (const m of CATALOGUE) assert.equal(prebuilt.find(r => r.model_id === m.f16).model_type === 2, !!m.vision, m.id);
});

test('the desktop tools come first, then the model in this app; the web has only it', () => {
  const desktop = [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex', available: false }];
  assert.deepEqual(mergeProviders(desktop, localEntry()).map(p => p.id), ['claude', 'codex', LOCAL_ID]);
  assert.deepEqual(mergeProviders([], localEntry()).map(p => p.id), [LOCAL_ID]);
  assert.deepEqual(mergeProviders(desktop, null).map(p => p.id), ['claude', 'codex']);
  assert.equal(mergeProviders([...desktop, { id: LOCAL_ID }], localEntry()).filter(p => p.id === LOCAL_ID).length, 1);
});

// A fake runtime is enough to check the bridge's routing.
const fakeRuntime = ({ adapter = true } = {}) => {
  const calls = [];
  return {
    calls,
    probe: async () => ({ adapter, f16: true }),
    run: async (request, onDelta) => { calls.push(['run', request.provider, typeof onDelta]); return { text: 'local' }; },
    cancel: tag => calls.push(['cancel', tag]),
    models: async () => [{ id: 'qwen3-1.7b', label: 'Qwen3 1.7B' }],
    manage: () => calls.push(['manage']),
  };
};
const fakeNative = () => {
  const calls = [];
  return {
    calls,
    providers: async () => [{ id: 'claude', label: 'Claude Code', available: true }],
    models: async provider => [{ id: `${provider}-model`, label: 'm' }],
    run: (...args) => { calls.push(['run', args.length]); return Promise.resolve({ text: 'native' }); },
    cancel: tag => calls.push(['cancel', tag]),
  };
};

test('without WebGPU the bridge is unchanged: the desktop one, or none on the web', () => {
  const native = fakeNative();
  assert.equal(withLocalAI(native, { gpu: undefined }), native);
  assert.equal(withLocalAI(null, { gpu: undefined }), null);
});

test('with WebGPU, requests go to the provider they name', async () => {
  const native = fakeNative(), runtime = fakeRuntime();
  const ai = withLocalAI(native, { gpu: {}, runtime });
  assert.deepEqual((await ai.providers()).map(p => p.id), ['claude', LOCAL_ID]);
  assert.deepEqual(await ai.models('claude'), [{ id: 'claude-model', label: 'm' }]);
  assert.equal((await ai.models(LOCAL_ID))[0].id, 'qwen3-1.7b');
  assert.equal((await ai.run({ provider: 'claude', prompt: 'x' })).text, 'native');
  await ai.run({ provider: 'claude', prompt: 'x' }, () => {});
  // The desktop preload streams only when it is given a callback, so none is invented.
  assert.deepEqual(native.calls, [['run', 1], ['run', 2]]);
  assert.equal((await ai.run({ provider: LOCAL_ID, prompt: 'x' }, () => {})).text, 'local');
  ai.cancel('study');
  assert.deepEqual(native.calls.at(-1), ['cancel', 'study']);
  assert.deepEqual(runtime.calls.at(-1), ['cancel', 'study']);
  assert.ok(ai.canManage(LOCAL_ID) && !ai.canManage('claude'));
});

test('no GPU adapter: the desktop leaves the model out, the web lists it to explain', async () => {
  assert.deepEqual((await withLocalAI(fakeNative(), { gpu: {}, runtime: fakeRuntime({ adapter: false }) }).providers()).map(p => p.id), ['claude']);
  assert.deepEqual((await withLocalAI(null, { gpu: {}, runtime: fakeRuntime({ adapter: false }) }).providers()).map(p => p.id), [LOCAL_ID]);
  await assert.rejects(withLocalAI(null, { gpu: {}, runtime: fakeRuntime() }).run({ provider: 'claude', prompt: 'x' }), /No AI tool/);
});

test('the model list says what is downloaded and what it would cost', () => {
  const list = modelList(new Set(['Qwen3-1.7B-q4f32_1-MLC']), false);
  assert.equal(list.length, CATALOGUE.length);
  assert.match(list.find(m => m.id === 'qwen3-1.7b').label, /downloaded/);
  assert.match(list.find(m => m.id === 'qwen3-4b').label, /text only · 2\.3 GB download/);
  assert.match(list.find(m => m.id === 'phi-3.5-vision').label, /reads pages · 2\.8 GB download/);
});

test('a choice resolves to the precision the GPU can run', () => {
  assert.equal(resolveModel('', { f16: true, list: prebuilt }).id, 'Qwen3-1.7B-q4f16_1-MLC');
  const phi = resolveModel('phi-3.5-vision', { f16: true, list: prebuilt });
  assert.deepEqual([phi.id, phi.vision, phi.context], ['Phi-3.5-vision-instruct-q4f16_1-MLC-6k', true, 6144]);
  assert.equal(resolveModel('phi-3.5-vision', { f16: false, list: prebuilt }).id, 'Phi-3.5-vision-instruct-q4f32_1-MLC-6k');
  assert.equal(resolveModel('qwen3-1.7b', { f16: false, list: prebuilt }).id, 'Qwen3-1.7B-q4f32_1-MLC');
  assert.equal(resolveModel('qwen3-1.7b', { list: prebuilt }).vision, false);
  // A typed prebuilt vision model is known to read images from its record.
  assert.equal(resolveModel('Phi-3.5-vision-instruct-q4f16_1-MLC', { list: prebuilt }).vision, true);
  assert.deepEqual(capabilitiesOf(''), { vision: false, contextTokens: 4096 });
  assert.deepEqual(capabilitiesOf('phi-3.5-vision'), { vision: true, contextTokens: 6144 });
  assert.deepEqual(capabilitiesOf('llama-3.2-3b'), { vision: false, contextTokens: 4096 });
  const llama = resolveModel('llama-3.2-3b', { f16: true, list: prebuilt });
  assert.equal(llama.thinking, false);
  assert.equal(llama.context, 4096);
  assert.ok(resolveModel('qwen3-0.6b', { list: prebuilt }).thinking);
  // Any prebuilt chat model can be typed under Other…
  assert.equal(resolveModel('Phi-3.5-mini-instruct-q4f16_1-MLC-1k', { list: prebuilt }).context, 1024);
  assert.throws(() => resolveModel('gpt-5', { list: prebuilt }), /not a model/);
  assert.throws(() => resolveModel('snowflake-arctic-embed-s-q0f32-MLC-b4', { list: prebuilt }), /not a model/);
  assert.throws(() => resolveModel('gemma-2-2b-it-q4f16_1-MLC', { f16: false, list: prebuilt }), /shader-f16/);
});

test('JSON prompts are constrained; a schema is passed as WebLLM wants it', () => {
  assert.ok(wantsJson({ prompt: 'Check it.\nReply with ONLY JSON: {"answer": 1}' }));
  assert.ok(wantsJson({ prompt: '… Reply with ONLY this JSON, no prose: {"cards":[]}' }));
  assert.ok(!wantsJson({ prompt: 'Explain this page.' }));
  assert.deepEqual(responseFormat({ prompt: 'Reply with ONLY JSON: {}' }), { type: 'json_object', schema: '{"type":"object"}' });
  assert.equal(responseFormat({ prompt: 'Explain.' }), undefined);
  const format = responseFormat({ prompt: 'x', schema: studySchema('cards') });
  assert.equal(format.type, 'json_object');
  assert.deepEqual(JSON.parse(format.schema).required, ['cards']);
  assert.deepEqual(studySchema('quiz').properties.questions.items.required, ['question', 'options', 'answer', 'source']);
  assert.equal(studySchema('check'), undefined);
});

test('a long prompt keeps its instructions and its end, and says what was left out', () => {
  assert.deepEqual(fitPrompt('short', 100), { text: 'short', cut: 0 });
  const prompt = `INSTRUCTIONS ${'intro '.repeat(50)}\n${'page text '.repeat(2000)}\nStudent: what is a mutex?`;
  const { text, cut } = fitPrompt(prompt, 3000);
  assert.ok(text.startsWith('INSTRUCTIONS'));
  assert.ok(text.endsWith('Student: what is a mutex?'));
  assert.ok(text.length <= 3000, `${text.length}`);
  assert.ok(cut > 10000);
  assert.match(text, /characters of the notes were left out/);
});

test('a request becomes one user message that fits the context window', () => {
  const budget = promptBudget(4096, true);
  assert.equal(budget, (4096 - 1536 - 200) * 3);
  const page = { bytes: new Uint8Array(1), type: 'image/jpeg', label: 'page-3' };
  const out = requestToMessages({ prompt: `Make cards. Reply with ONLY this JSON: {"cards":[]}\n${'x '.repeat(20000)}`, images: [page, page] });
  assert.equal(out.messages.length, 1);
  assert.equal(out.messages[0].role, 'user');
  assert.match(out.messages[0].content, /^\(You cannot see images: the 2 attached images were left out/);
  assert.ok(out.messages[0].content.length <= budget);
  assert.equal(out.json, true);
  assert.equal(out.maxTokens, 1536);
  assert.ok(out.cut > 0);
  const retry = requestToMessages({ prompt: 'y '.repeat(20000) }, { scale: 0.6 });
  assert.ok(retry.messages[0].content.length <= promptBudget(4096, false) * 0.6);
  assert.equal(requestToMessages({ prompt: 'Hi' }).messages[0].content, 'Hi');
});

test('reasoning blocks never reach the answer or the stream', () => {
  assert.equal(visibleText('<think>\nhmm\n</think>\n\nAnswer'), 'Answer');
  assert.equal(visibleText('<think>still going'), '');
  let state = { sent: '' }, streamed = '';
  for (const full of ['<think>', '<think>a</think>', '<think>a</think>\nHel', '<think>a</think>\nHello']) {
    state = nextDelta(state.sent, full);
    streamed += state.delta;
  }
  assert.equal(streamed, 'Hello');
});

test('loading messages become a short phase; engine errors read plainly', () => {
  assert.equal(phaseOf({ progress: 0.4, text: 'Fetching param cache[12/30]: 389MB fetched. 40% completed, 25 secs elapsed.' }), 'downloading 40% · 0.4 GB');
  assert.equal(phaseOf({ progress: 0.5, text: 'Loading model from cache[15/30]: 500MB loaded. 50% completed' }), 'loading 50%');
  assert.equal(phaseOf({ progress: 0, text: '' }), 'starting');
  assert.match(friendlyError(Object.assign(Error('x'), { name: 'DeviceLostError' })).message, /ran out of memory/);
  assert.match(friendlyError(Error('Failed to fetch')).message, /Could not download the model/);
  assert.equal(friendlyError(Object.assign(Error('x'), { name: 'WebGPUNotFoundError' })).message, NO_WEBGPU);
});

// A runtime over a fake WebLLM: worker handshake, engine, streamed chunks.
function fakeLibrary({ answer = () => ['Hel', 'lo'], failFirst = null } = {}) {
  const log = [];
  let failed = false;
  class WebWorkerMLCEngine {
    constructor(worker, config) { this.config = config; log.push(['engine']); }
    async reload(id) {
      log.push(['reload', id]);
      this.config.initProgressCallback({ progress: 0.5, text: 'Fetching param cache[1/2]: 10MB fetched.' });
      if (this.hold) await this.hold;
    }
    interruptGenerate() { log.push(['interrupt']); this.interrupted = true; }
    get chat() {
      return { completions: { create: async request => {
        log.push(['create', request]);
        if (failFirst && !failed) { failed = true; throw failFirst; }
        const engine = this;
        return (async function* () {
          for (const piece of answer(request)) {
            await new Promise(r => setTimeout(r, 1));
            if (engine.interrupted) { engine.interrupted = false; return; }
            yield { choices: [{ delta: { content: piece } }] };
          }
        })();
      } } };
    }
  }
  return { log, library: { module: { prebuiltAppConfig: { model_list: prebuilt }, WebWorkerMLCEngine }, url: 'blob:fake' } };
}
const fakeWorker = () => ({ terminated: false, postMessage(message) { queueMicrotask(() => this.onmessage({ data: message.notecomplete === 'load' ? { notecomplete: 'ready' } : {} })); }, terminate() { this.terminated = true; } });
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const quiet = { start: () => ({ set() {}, finish() {}, fail() {} }) };
const gpu = (f16 = true) => ({ requestAdapter: async () => ({ features: new Set(f16 ? ['shader-f16'] : []) }) });

test('the runtime loads the model once, streams, and records it as downloaded', async () => {
  const { log, library } = fakeLibrary();
  const storage = memory(), workers = [];
  const runtime = createLocalRuntime({ gpu: gpu(), loadLibrary: async () => library, createWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, progress: quiet, storage, persist: () => {} });
  const deltas = [];
  assert.deepEqual(await runtime.run({ provider: LOCAL_ID, prompt: 'Explain.', model: 'qwen3-1.7b' }, d => deltas.push(d)), { text: 'Hello' });
  assert.deepEqual(deltas, ['Hel', 'lo']);
  await runtime.run({ provider: LOCAL_ID, prompt: 'Again. Reply with ONLY JSON: {}', model: 'qwen3-1.7b' });
  assert.equal(log.filter(([k]) => k === 'reload').length, 1);
  const json = log.filter(([k]) => k === 'create').at(-1)[1];
  assert.deepEqual(json.response_format, { type: 'json_object', schema: '{"type":"object"}' });
  assert.deepEqual(json.extra_body, { enable_thinking: false });
  assert.equal(json.max_tokens, 1536);
  assert.match((await runtime.models()).find(m => m.id === 'qwen3-1.7b').label, /downloaded/);
  // Another model replaces the loaded one (and its worker).
  await runtime.run({ provider: LOCAL_ID, prompt: 'x', model: 'llama-3.2-1b' });
  assert.deepEqual(log.filter(([k]) => k === 'reload').map(([, id]) => id), ['Qwen3-1.7B-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f16_1-MLC']);
  assert.ok(workers[0].terminated && !workers[1].terminated);
  assert.equal(log.filter(([k]) => k === 'create').at(-1)[1].extra_body, undefined, 'Llama gets no thinking switch');
});

test('requests run one at a time; cancelling a tag stops its own only', async () => {
  const { log, library } = fakeLibrary({ answer: () => ['a', 'b', 'c', 'd', 'e'] });
  const runtime = createLocalRuntime({ gpu: gpu(), loadLibrary: async () => library, createWorker: fakeWorker, progress: quiet, storage: memory(), persist: () => {} });
  const first = runtime.run({ prompt: 'one', tag: 'chat' });
  const second = runtime.run({ prompt: 'two', tag: 'study' });
  const third = runtime.run({ prompt: 'three', tag: 'study' });
  runtime.cancel('study');
  assert.equal((await first).text, 'abcde');
  await assert.rejects(second, /stopped/);
  await assert.rejects(third, /stopped/);
  assert.equal(log.filter(([k]) => k === 'create').length, 1);
  // A running answer is interrupted.
  const running = runtime.run({ prompt: 'four', tag: 'chat' });
  setTimeout(() => runtime.cancel('chat'), 2);
  await assert.rejects(running, /stopped/);
  assert.ok(log.some(([k]) => k === 'interrupt'));
});

test('stopping a download ends the waiting request and frees the worker', async () => {
  const { library } = fakeLibrary();
  let release;
  const hold = new Promise(r => { release = r; });
  const original = library.module.WebWorkerMLCEngine;
  library.module.WebWorkerMLCEngine = class extends original { constructor(...a) { super(...a); this.hold = hold; } };
  const workers = [];
  const runtime = createLocalRuntime({ gpu: gpu(), loadLibrary: async () => library, createWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, progress: quiet, storage: memory(), persist: () => {} });
  const request = runtime.run({ prompt: 'x', tag: 'study' });
  await new Promise(r => setTimeout(r, 5));
  runtime.cancel();
  await assert.rejects(request, /stopped/);
  assert.ok(workers[0].terminated);
  release();
  // The next request starts again with a new worker.
  library.module.WebWorkerMLCEngine = original;
  assert.equal((await runtime.run({ prompt: 'y' })).text, 'Hello');
  assert.equal(workers.length, 2);
});

test('a prompt the engine finds too long is retried once, shorter', async () => {
  const tooLong = Object.assign(Error('Prompt tokens exceed context window size'), { name: 'ContextWindowSizeExceededError' });
  const { log, library } = fakeLibrary({ failFirst: tooLong });
  const runtime = createLocalRuntime({ gpu: gpu(false), loadLibrary: async () => library, createWorker: fakeWorker, progress: quiet, storage: memory(), persist: () => {} });
  assert.equal((await runtime.run({ prompt: 'z '.repeat(9000), model: 'qwen3-1.7b' })).text, 'Hello');
  const sizes = log.filter(([k]) => k === 'create').map(([, r]) => r.messages[0].content.length);
  assert.equal(sizes.length, 2);
  assert.ok(sizes[1] < sizes[0] * 0.7);
  assert.equal(log.find(([k]) => k === 'reload')[1], 'Qwen3-1.7B-q4f32_1-MLC');
});

test('no adapter, unknown models and empty prompts fail with a message', async () => {
  const { library } = fakeLibrary();
  const none = createLocalRuntime({ gpu: { requestAdapter: async () => null }, loadLibrary: async () => library, createWorker: fakeWorker, progress: quiet, storage: memory() });
  await assert.rejects(none.run({ prompt: 'x' }), { message: NO_WEBGPU });
  const runtime = createLocalRuntime({ gpu: gpu(), loadLibrary: async () => library, createWorker: fakeWorker, progress: quiet, storage: memory(), persist: () => {} });
  await assert.rejects(runtime.run({ prompt: 'x', model: 'nope' }), /not a model/);
  await assert.rejects(runtime.run({ prompt: '  ' }), /Empty/);
});

test('page images cost what WebLLM’s phi3_v resize says', () => {
  // A portrait A4 page, a 4:3 slide and a long narrow page.
  assert.deepEqual(visionSize(1400, 1980), [1008, 1425]);
  assert.equal(visionTokens(1400, 1980), 2377);
  assert.deepEqual(visionSize(1400, 1050), [1344, 1008]);
  assert.equal(visionTokens(1400, 1050), 1921);
  assert.equal(visionTokens(700, 1400), 1357);
  // Only the aspect ratio matters.
  assert.equal(visionTokens(1008, 1425), visionTokens(2800, 3960));
});

test('a vision model gets the page as an image_url part, and the text what is left', () => {
  const page = { bytes: new Uint8Array(1), type: 'image/jpeg', label: 'page-1' };
  const image = { url: 'data:image/jpeg;base64,AAAA', width: 1008, height: 1425 };
  const out = requestToMessages({ prompt: `Explain.\n${'w '.repeat(9000)}`, images: [page, page] }, { context: 6144, vision: true, image });
  const [picture, words] = out.messages[0].content;
  assert.deepEqual(picture, { type: 'image_url', image_url: { url: image.url } });
  assert.equal(words.type, 'text');
  assert.match(words.text, /^\(Only the first image is attached; 1 other was left out/);
  assert.ok(words.text.length <= (6144 - 200 - 2377 - 1024) * 3, `${words.text.length}`);
  // The reading step asks for a longer answer; a crowded window lowers it instead of the text.
  assert.equal(requestToMessages({ prompt: 'Read.', images: [page], maxTokens: 1600 }, { context: 6144, vision: true, image }).maxTokens, 1600);
  assert.ok(requestToMessages({ prompt: 'Read.', images: [page], maxTokens: 1600 }, { context: 4096, vision: true, image }).maxTokens < 1600);
  // Without an image the content stays a string, also for a vision model.
  assert.equal(typeof requestToMessages({ prompt: 'Hi' }, { vision: true }).messages[0].content, 'string');
});

test('the runtime prepares the first page image for a vision model only', async () => {
  const { log, library } = fakeLibrary();
  const prepared = [];
  const runtime = createLocalRuntime({ gpu: gpu(), loadLibrary: async () => library, createWorker: fakeWorker, progress: quiet, storage: memory(), persist: () => {},
    prepareImage: async image => { prepared.push(image.label); return { url: 'data:image/jpeg;base64,AA', width: 1008, height: 1425 }; } });
  const pages = [{ bytes: new Uint8Array(2), type: 'application/pdf', label: 'source' }, { bytes: new Uint8Array(2), type: 'image/jpeg', label: 'page-4' }];
  await runtime.run({ prompt: 'What is on this page?', images: pages, model: 'phi-3.5-vision' });
  const sent = log.filter(([k]) => k === 'create').at(-1)[1].messages[0].content;
  assert.equal(sent[0].type, 'image_url');
  assert.deepEqual(prepared, ['page-4']);
  assert.equal(log.find(([k]) => k === 'reload')[1], 'Phi-3.5-vision-instruct-q4f16_1-MLC-6k');
  await runtime.run({ prompt: 'Again', images: pages, model: 'qwen3-1.7b' });
  assert.equal(typeof log.filter(([k]) => k === 'create').at(-1)[1].messages[0].content, 'string');
  assert.equal(prepared.length, 1);
});

test('the bridge says what a model reads and where small-model mode starts on', () => {
  const ai = withLocalAI(fakeNative(), { gpu: {}, runtime: fakeRuntime() });
  assert.deepEqual(ai.capabilities(LOCAL_ID, 'qwen3-0.6b'), { vision: false, contextTokens: 4096 });
  assert.deepEqual(ai.capabilities(LOCAL_ID, ''), { vision: false, contextTokens: 4096 });
  assert.deepEqual(ai.capabilities(LOCAL_ID, 'phi-3.5-vision'), { vision: true, contextTokens: 6144 });
  assert.deepEqual(ai.capabilities('claude', 'opus'), { vision: true, contextTokens: 0 });
  assert.ok(ai.smallByDefault(LOCAL_ID) && !ai.smallByDefault('claude'));
  assert.equal(ai.defaultLabel(LOCAL_ID), 'Default: Qwen3 1.7B');
  assert.equal(ai.defaultLabel('claude'), undefined);
});

test('an idle model is unloaded, freeing its GPU memory, and loads again when asked', async () => {
  const { log, library } = fakeLibrary();
  const workers = [];
  const runtime = createLocalRuntime({ gpu: gpu(), loadLibrary: async () => library, createWorker: () => { const w = fakeWorker(); workers.push(w); return w; }, progress: quiet, storage: memory(), persist: () => {}, idleMs: 20 });
  await runtime.run({ prompt: 'x', model: 'qwen3-1.7b' });
  await runtime.run({ prompt: 'y', model: 'qwen3-1.7b' });
  assert.ok(!workers[0].terminated, 'kept while in use');
  await new Promise(r => setTimeout(r, 40));
  assert.ok(workers[0].terminated, 'unloaded when idle');
  await runtime.run({ prompt: 'z', model: 'qwen3-1.7b' });
  assert.equal(log.filter(([k]) => k === 'reload').length, 2);
  assert.equal(workers.length, 2);
  runtime.reset();
});


test('a page image is scaled down to what the vision model uses, never up', () => {
  assert.deepEqual(imageLayout(1400, 1980), { width: 1008, height: 1426 });
  assert.deepEqual(imageLayout(600, 800), { width: 600, height: 800 });
});
