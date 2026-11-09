# AI in the app (WebLLM)

Status 2026-11-08, second pass: page images (vision) and small-model mode. Design and implementation of an AI provider that runs a small language model inside the reader itself, with [WebLLM](https://github.com/mlc-ai/web-llm) (`@mlc-ai/web-llm` 0.2.87) on the device's GPU through WebGPU. The website gets quizzes, flashcards, Ask AI, explanations and handwriting conversion without installing anything; the desktop app gets the same as one more choice beside the user's own AI tools.

## Why WebLLM

- **No install, no account, no key.** The website had no AI at all: every AI feature needs `window.notecompleteAI`, which only the desktop app provides (it runs Claude Code, Codex, Antigravity or OpenCode). A model in the page needs nothing but a browser.
- **The same request interface.** WebLLM speaks the OpenAI chat-completions API, streams, and constrains output with JSON Schema or grammars (xgrammar), which quizzes and flashcards need.
- **A Web Worker engine.** `WebWorkerMLCEngine` runs the model in a worker, so the reader keeps drawing while it writes.
- **Prebuilt models.** WebLLM 0.2.87 lists 165 compiled models (Qwen3, Llama 3.2, Phi 3.5, Gemma 2, SmolLM2…), with GPU memory needs and the compiled WebGPU code hosted by the MLC project. Nothing has to be compiled here.
- **Alternatives considered.** Transformers.js (already used for Whisper) runs text generation on WebGPU too, but has no constrained JSON output and is slower for chat-size models. Chrome's built-in Prompt API is Chrome-only and its model cannot be chosen. A local server (Ollama, llama.cpp) is an install, which is what this avoids.

## Requirements

- **WebGPU.** Chrome and Edge 113+ on Windows, macOS and ChromeOS; Chrome on Android 121+ (recent GPUs); Safari 26 (macOS, iOS, iPadOS). On Linux, Chrome enables WebGPU only on some GPUs; elsewhere it needs `chrome://flags/#enable-unsafe-webgpu` (and Vulkan). Firefox has WebGPU on Windows from version 141; on other systems it is still behind a flag. Electron 44 (desktop app) follows Chromium: available on Windows and macOS, on Linux only where Chromium enables it.
- **GPU memory and storage.** The default model needs about 2 GB of GPU memory and downloads about 1 GB once. Phones and old integrated GPUs may run out of memory; the error says so and suggests a smaller model.
- **When WebGPU is missing** (`navigator.gpu` undefined: Firefox on Linux, older Safari, iOS before 26, a webview without it), the provider is not offered. On the website the AI commands then say: "…available in the desktop app, or in this browser with WebGPU (recent Chrome, Edge or Safari)". When `navigator.gpu` exists but no adapter is found (blocklisted GPU), the website still lists the provider so that using it explains why it cannot run; the desktop app leaves it out of its list.

## Provider design

One module, `apps/reader/local-ai.js`, used unchanged by the website and the desktop app. Its only platform question is "is there already a native `notecompleteAI`?".

```
window.notecompleteAI (desktop preload, or nothing on the web)
        │
        ▼
withLocalAI(native) ──► { providers(), models(provider, {fresh}), run(request, onDelta), cancel(tag),
                          canManage(provider), manage(), capabilities(provider, model), smallByDefault(provider) }
        │                   │
        │                   ├─ provider "webllm" ─► local runtime ─► WebWorkerMLCEngine ─► local-ai-worker.js
        │                   └─ any other id ──────► native.run / native.models (desktop CLIs)
        ▼
app.js: const ai = sharedAI();   (and the two other places that read window.notecompleteAI)

small-model.js (one shared module, pure parts unit-tested): the Small model setting per provider,
the page-reading step, per-page prompts and schemas, packing, merge / de-duplicate / trim;
runAI(ai, request, onDelta, options) for questions, smallStudy(...) for cards, quizzes, fact checks.
```

- **The interface is the desktop one.** `providers()` returns `[{ id, label, available }]`; `models(provider, { fresh })` returns `[{ id, label }]`; `run({ provider, prompt, images, model, notePath, tag, schema? }, onDelta)` resolves to `{ text }`; `cancel(tag)` stops requests with that tag (all of them without a tag). Consumers (study.js, quiz.js, chat.js, explain.js, convert.js, transcript.js, the double check in app.js) are unchanged except where noted below.
- **Merging.** On the desktop the list is the native providers, then `{ id: 'webllm', label: 'In this app (WebLLM)' }`; on the web it is the only one. `cancel(tag)` goes to both, because tags (`study`, `chat`…) are shared by feature, not by provider.
- **Extra fields, ignored by the desktop runner.** A provider entry may carry `contextTokens` (WebLLM's window). A request may carry `schema` (a JSON Schema object that WebLLM constrains its output to) and `maxTokens` (the answer's cap); the desktop runner destructures the fields it knows and ignores them.
- **`capabilities(provider, model)`** (synchronous): `{ vision, contextTokens }`. The desktop tools read images and have large windows: `{ vision: true, contextTokens: 0 }`, 0 meaning "large". **`smallByDefault(provider)`** is true only for `webllm`.
- **`sharedAI()`** builds the merged object once, so the three places that read the bridge (`app.js` twice, `transcript.js`) share one engine and one queue.

## Loading the library: fetched on first use, not vendored

Decision: `local-ai.js` downloads `lib/index.js` of the pinned npm release from jsDelivr (`https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/lib/index.js`, 6.8 MB, 2.3 MB compressed) the first time a local model is used, checks its SHA-256 against the hash pinned in the code, keeps it in its own Cache Storage entry (`notecomplete-webllm`), and imports it from a `blob:` URL in the page and in the worker.

Why not vendor it into `vendor/webllm/` like KaTeX or Transformers.js:

- **The desktop installer would grow.** `apps/desktop/stage.mjs` copies every file listed in `precache.json` `files`, LAZY ones included (LAZY only keeps the service worker from caching them at install). A vendored copy would ship in every AppImage, DMG and NSIS installer, for a feature that also needs a 0.3–2.3 GB download before it does anything. Leaving it out of the desktop stage would make the desktop load it from somewhere else: two code paths.
- **One source, identical code and bytes everywhere.** Web, desktop and the Android build fetch the same file and verify the same hash. jsDelivr serves the npm tarball's bytes unchanged (checked: the hash of the npm file and of the jsDelivr response are the same, `3bff4c55…a674`), and the hash pin means a changed or compromised CDN file is refused, not run.
- **The feature needs the network on first use anyway.** Model weights come from Hugging Face (`huggingface.co/mlc-ai/…`) and the compiled model code from GitHub (`raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs`), as WebLLM's prebuilt list says. After the first use, library, weights and code are all in Cache Storage and the feature works offline.
- **Precedent.** OCR language data and dictionaries are already fetched from jsDelivr on first use (`ocr.js`, `ocr-dictionary.js`).

The npm dependency stays in `apps/reader/package.json`: unit tests import its prebuilt model list, and `tools/build_web.py` checks that the pinned hash in `local-ai.js` matches `node_modules/@mlc-ai/web-llm/lib/index.js`, so upgrading is: bump the version in `package.json` and the URL, run the build, copy the hash it prints. The service worker does not cache cross-origin requests, so nothing is added to the offline install.

## Model catalogue

A short, curated list (`CATALOGUE` in `local-ai.js`). The engine gets our own `appConfig.model_list`: WebLLM's prebuilt records plus records of ours (`CUSTOM_RECORDS`), so a model can be added or its settings changed (context window, compiled code) without waiting for a WebLLM release.

What could be added, checked 2026-11-08: WebLLM 0.2.87 turns images into model input only for Phi 3.5 Vision's architecture (`phi3_v`) or for models packaged with an image adapter in an `mlc-model-manifest.json`. Gemma 4 E2B is packaged that way, but its manifest declares text and audio, not images. The Gemma 3 4B MLC build on Hugging Face is text-only (`is_text_model`) and has no compiled WebGPU code in `binary-mlc-llm-libs`. No Qwen-VL or SmolVLM MLC builds are published. So the only vision model is Phi 3.5 Vision; our own record gives it a larger window (below), and it is measured below. Compiling another vision model ourselves (MLC-LLM, with an image adapter manifest) is a task in the table. Each entry names two compiled variants: `q4f16_1` (half-precision shaders, smaller and faster, needs the `shader-f16` GPU feature) and `q4f32_1` (any WebGPU device); the adapter's features pick one. Download sizes are the sum of each model's `tensor-cache.json` records on Hugging Face; GPU memory is WebLLM's `vram_required_MB` for the f16 variant.

| Choice | Model | Download | GPU memory | Notes |
|---|---|---|---|---|
| Default | Qwen3 1.7B | 1.0 GB | 2.0 GB | Text only. Multilingual (Spanish is fine), good JSON. Thinking is turned off. Reads handwriting through the app's OCR (below). |
| Fastest | Qwen3 0.6B | 0.3 GB | 1.4 GB | For phones and old GPUs; weaker questions. |
| | Llama 3.2 1B | 0.7 GB | 0.9 GB | Small; English is its strongest language. |
| | Llama 3.2 3B | 1.8 GB | 2.3 GB | |
| Best | Qwen3 4B | 2.3 GB | 3.4 GB | Slower; for laptops with a discrete or Apple GPU. |
| Reads images | Phi 3.5 Vision | 2.8 GB | about 5.3 GB | Our record `Phi-3.5-vision-instruct-q4f16_1-MLC-6k`: the prebuilt model and compiled code with a 6,144-token window instead of 4,096, so one page image (up to about 2,400 tokens), the instructions and a transcription fit; the extra KV cache is about 0.8 GB (32 layers × 32 heads × 96 × 2 × 2 bytes per token). Optional: see the measurements below. |

"Other…" in the model dropdown accepts any `model_id` from WebLLM's prebuilt list (for example `Phi-3.5-mini-instruct-q4f16_1-MLC`); an unknown name is refused with a message.

## Reading handwriting: OCR first, vision optional

Handwritten notes are the main content, so what is on the page must reach the model. Two ways were built and measured on the sample note *Examen wuolah* (page 1: a handwritten row reduction of a 3 × 3 matrix with a parameter *a*, the minors Δ1, Δ2, Δ3 and "Se puede factorizar si a ≠ 0"), on an Apple M1 Max in Chromium 156 with WebGPU:

- **Phi 3.5 Vision reading the page image** (the reading step below, our 6k record): about 4 minutes to load the model from the cache, then **240 s to the first word** of the first reading and about 30 s per page once loaded. The reading was wrong: it described "geometry and calculus" or "group theory", invented formulas ("A = 1/2(bh)"), copied the example box from the prompt into every point and repeated points until the answer was cut. A lighter build (the 2,048-token prefill code, pages padded to cost 1,357 tokens) was slightly faster (31 s to the first word) and worse ("Examen Wulah", the same point repeated twenty times); it was removed.
- **The app's own OCR** (Tesseract, as Find → Recognize handwriting) reads that page into words with boxes in about 6 s (DEVELOPMENT.md, item 1), and a text model then works from the words.

Decision (the owner's): **OCR first, a small text model by default.** In small-model mode, a page with handwriting and no recognized text yet is recognized when it is first needed (`find.js` `pageText(page, { recognize: true })`: the normal passes in the languages chosen for Recognize handwriting, kept with the note and searchable, exactly as from the dialog). Quiz hints come from the OCR word boxes (below). Phi 3.5 Vision stays in the list for pages OCR cannot read, such as diagrams; everything below about images applies to it.

- **Format.** One user message whose content is `[{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,…' } }, { type: 'text', text }]`, as WebLLM expects (only `data:image…` or `http…` URLs, no `detail`).
- **One image per request.** WebLLM resizes a `phi3_v` image to at most 16 crops of 336 px plus a global view, so its token count depends only on the aspect ratio: a portrait A4 page becomes 1008 × 1440 px and 2,377 tokens, a 4:3 slide 1344 × 1008 and 1,921, a long narrow page 672 × 1344 and 1,357 (`visionSize`, `visionTokens`, unit-tested against WebLLM's formula). Two pages never fit; extra images are left out and the prompt says so.
- **Downscaled to what the model uses.** The reader renders pages 1400 px wide; before sending, the image is scaled down (never up) to the size the model resizes it to and re-encoded as JPEG. The model sees the same pixels; the worker decodes less.
- **Budget.** The text gets what is left: window − image tokens − answer − margin; if that is under about 600 characters the answer cap is lowered (not below 512 tokens).
- **Text-only models.** Images are dropped and the model is told so; it reads the text Find extracted (typed, PDF, OCR, transcripts), with handwriting recognized on demand in small-model mode. The model list marks each model "reads pages" or "text only", and a **Text only** badge beside the dropdown says that page images are not sent.
- `notePath` (the note server for the desktop CLIs) does not apply.

## Small-model mode

Small models answer well when each request is small and asks one thing. Asked for twenty quiz questions over six pages of handwriting plus instructions, they lose the thread, overflow the window or stop early. Big models do better with the whole picture: splitting costs them quality (no cross-page view) and time (one CLI start per request). So splitting is a per-provider choice, not a property of the code path.

- **The setting.** Every AI dialog and panel has a **Small model** checkbox beside the model list: study (flashcards, quiz, fact check), Ask AI, the explanation boxes (quiz Clarify, card Ask AI and double check) and handwriting conversion. The model picker (`model-picker.js`) adds it, so every picker has it without markup of its own. It is remembered per provider (`notecomplete-small-model:<provider>`), on by default for `webllm` and off for the desktop tools, and can be changed either way. Transcript revision has no dialog and uses the remembered setting of the provider it runs with.
- **One module.** `apps/reader/small-model.js` holds all of it. Consumers call `runAI(ai, request, onDelta, { small, vision })` instead of `ai.run` for questions, and `smallStudy({...})` for study generation. Nothing in it depends on WebLLM: with the box ticked, Claude Code gets the same steps.

### The pipeline: read each page, then work on each page alone

1. **Read the page.** With a text model (the default): its text (typed, PDF, recognized handwriting, transcripts), its handwriting recognized first if needed; no model request. With a vision model: one request with the page image, answering `{ content, points: [{ text, box }] }` (everything on the page as Markdown, and up to eight key points with their regions as fractions of the page); the extracted text goes with it as a hint, readings are kept per page image for the session, a repeated point is kept once, and a box given to three or more points is a placeholder and dropped (Phi did exactly that).
2. **Work on the page with nothing else in context**: its content (and key points, if read by a vision model), a short single-purpose prompt (make *k* flashcards; write *k* questions; list errors), and a schema whose `page` is an `enum` of the request's pages. Each quiz question also gives `quote`: 3–12 words copied from the page that show the answer.
3. **Hint regions from the page's words.** `locateQuote` finds the quote among the page's word boxes (`find.js` `pageWords`: OCR, PDF and typed words with their boxes): words in order, OCR's one-letter misreadings tolerated (edit distance 1), accents and case ignored, at least 60% of the quote's words found; the region is their bounding box with a small margin. The quiz hint (H) outlines it. A question whose quote is not found falls back to its key point's region (vision), or has no region.
4. **Merge in JS.** Items from all pages are de-duplicated (same normalised text, or word overlap ≥ 0.8; numbers always count, so "page 1" and "page 3" differ) and trimmed to the requested number per page. Flashcards and quizzes ask for one more per page than requested, so de-duplication still leaves enough.

- **Questions** (Ask AI, Clarify, card Ask AI, double checks): the page's text (Ask AI recognizes the current page's handwriting first); with a vision model, step 1 for the first image (the page or a grabbed region); then the question with that content alone. Ask AI also cuts the conversation to its last four turns and the student's notes to 2,000 characters.
- **Fact check:** each page alone (no cross-page comparison in this mode).
- **Handwriting conversion:** the dialect reference is cut to its core (headings, emphasis, lists, cards, colours; no drawings, columns, maps or options).
- **Transcript revision:** 3 segments per request instead of 25.
- **Progress, cancel, partial results.** The job chip shows "page 3 of 12 · reading" / "· writing questions"; Stop cancels the running request and skips the rest; a page that fails is counted and skipped, and the others' results are kept ("2 pages failed").

### One page per request, or more?

Considered: (a) strictly one page per request; (b) packing consecutive pages up to a budget from the model's window. Recommendation and implementation: **(a) for reading, and (a) for generation except near-empty pages.** A page whose content is under 400 characters (a title slide, a heading, a page with one line) is packed with its neighbours, up to 3 pages and the model's prompt budget; every other page goes alone. Reasons:

- Reading with a vision model must be one page per request: one image fits the window, two never do.
- For generation, a single page keeps the request single-purpose and its point numbers unambiguous, which is what makes a small model reliable. Answer time depends on the number of items, not of requests, so one page per request costs little: the fixed part is a short prompt.
- Near-empty pages are the exception: one request each asks a small model for four cards from one line, and it invents them. Packed, they share the material and the item count.

When the box is ticked for a desktop tool, the window is unknown and packing uses a 12,000-character budget.

## Download, progress and cancel

- **Idle unloading.** A loaded model holds its GPU memory (2 GB for Qwen3 1.7B, about 5 GB for Phi 3.5 Vision), which on Apple and integrated GPUs is the computer's own RAM. It is unloaded after 3 minutes without requests and loads again from the cache in seconds.

- The first request with a model downloads it. Progress is a job chip in the command bar (`jobs.js`): "Downloading Qwen3 1.7B · 42% · 1 of 2 GB", then "loading into the GPU". **Stop** on the chip ends the download: the worker is terminated and the waiting request fails with "The AI request was stopped." Shards already fetched stay cached, so the next try resumes.
- A model already downloaded still takes a few seconds to load into GPU memory; the chip shows that too. The engine and model stay loaded for later requests; choosing another model replaces it.
- Before the first download the provider asks for persistent storage (`navigator.storage.persist()`), so the browser does not evict a gigabyte under storage pressure.

## Storage and deleting models

- WebLLM keeps weights, model config and compiled code in Cache Storage (`webllm/model`, `webllm/config`, `webllm/wasm`, its default `cacheBackend: "cache"`). The library itself is in `notecomplete-webllm`. Nothing is written outside the reader's origin.
- **Downloaded models…**: a button beside the model dropdown when "In this app" is the chosen tool. The dialog lists the catalogue with download size and whether each is downloaded, the storage used by the site (`navigator.storage.estimate()`), and Delete per model (`deleteModelAllInfoInCache`) and for everything (all WebLLM caches and the library). Deleting the loaded model unloads it first.
- Which models are downloaded is remembered in `localStorage` (`notecomplete-local-models`), so the dropdown can say "downloaded" without loading 6.8 MB of library; the dialog checks the caches themselves and corrects that record.

## Running in a worker

`local-ai-worker.js` is a module worker. The page loads the verified library, creates the worker and sends it the library's `blob:` URL; the worker imports it, starts `WebWorkerMLCEngineHandler` and answers `ready`. The page then creates `WebWorkerMLCEngine(worker)` from the same library. Only the page talks to the GPU through the worker; the page thread only parses the library once.

Requests are queued and run one at a time (one GPU, one loaded model). Study's three parallel lanes therefore wait their turn; cancelling a tag removes its queued requests and interrupts the running one (`interruptGenerate`).

## Turning requests into chat messages

`requestToMessages(request, model)` (pure, tested):

- One user message, no system message (some prebuilt templates reject a custom system prompt). It starts with a short note: the model runs on the student's device and cannot see images, and, when images were attached, that they were left out and only the text is given.
- The prompt is fitted to the context window: `context_window_size` (4096 tokens for the catalogue) minus the answer's budget (1536 tokens for JSON, 1024 otherwise) minus a margin, at three characters per token. A longer prompt keeps its beginning (the instructions) and its end (the question, the last pages) and replaces the middle with "[… N characters of the notes were left out: the model in this app reads about M characters at a time]". If the engine still reports `ContextWindowSizeExceededError`, the request is retried once with 60% of the budget.
- Qwen3 models get `enable_thinking: false` (faster, and no `<think>` text in answers); any `<think>…</think>` block that still appears is removed from the answer and from what is streamed.

## JSON output

- When the request has `schema`, the request uses `response_format: { type: "json_object", schema }`: the grammar makes the model write exactly that shape. study.js sends schemas for flashcards (`{cards:[{front, back, page}]}`) and quiz questions (`{questions:[{question, options, answer, source:{page}}]}`).
- Other prompts that end with "Reply with ONLY JSON" / "Reply with ONLY this JSON" (card double check, fact check, quiz double check, transcript revision) get `json_object` with the schema `{"type":"object"}`: valid JSON, shape as the prompt describes. A schema is always sent because WebLLM 0.2.87 compiles `json_object` through its JSON Schema path and fails without one (`GrammarMatcherInitError: … Cannot pass non-string to std::string`, seen in the browser run).
- The consumers keep parsing with `jsonFrom` and their own cleaners (`cleanCards`, `prepareQuestions`), so a model that adds text around the JSON still works.

## Limits

- **Context.** 4096 tokens is about 8–10 pages of handwriting-sized text in total, prompt and answer together. Small-model mode therefore works page by page; Ask AI with page, notes and a long conversation is trimmed in the middle and says so. A whole-note quiz of 200 pages is 200 requests: slow (tens of seconds per page on a laptop GPU), but it runs in the background and Stop keeps what came back.
- **Quality.** A 1.7B model writes simpler, sometimes wrong questions; the fact check and double check are less reliable than with the desktop tools. The provider's label says where it runs; the user guide says what to expect.
- **Vision.** One image per request, 1,300–2,400 tokens of the window. Phi 3.5 Vision is a 2.8 GB download and needs about 5.3 GB of GPU memory with our 6k window (about 7.8 GB without `shader-f16`); on handwritten notes it misread pages (measured above).
- **The desktop while a model runs.** On a GPU that also drives the screen (Apple, integrated), long GPU jobs can delay frames. During the first Phi run on the owner's machine the desktop was unresponsive for a moment. It was not memory: that browser's cgroup peaked at 2.6 GB of RAM and 160 MB of swap, with 11 s of CPU in 4 min 35 s. In the second run Hyprland's IPC answered within 42 ms throughout (a probe every 100 ms; no gap over 157 ms), so the compositor's loop was never blocked; dropped frames were not measured.
- **OCR quality** bounds what a text model can do with handwriting: misread words become misread cards. Hints need the quote's words to be recognized.
- **Answer length.** Answers stop at 1024 tokens (about 700 words), JSON at 1536. Handwriting conversion of a long prompt can therefore end early.
- **One model at a time**, and only while the tab is open. Another tab loads its own copy (each desktop tab is its own reader).

## Privacy

Everything runs on the device: the notes, prompts and answers never leave it. The network is used only to download the library (jsDelivr) and the model (Hugging Face, GitHub), once; those requests carry no note content.

## Testing plan

- **Unit (`apps/reader/small-model.test.mjs`):** setting defaults and memory, packing, reading-step parsing and box validation, prompts and schemas, merge/de-duplicate/trim, `runAI` and `smallStudy` with a fake `ai` (steps, regions mapped to questions, per-page failure, cancel, progress).
- **Unit (`apps/reader/local-ai.test.mjs`, `node --test`):** vision size and tokens against WebLLM's `phi3_v` formula, image content parts and budget, capabilities, provider merging (desktop + local, web only, no WebGPU, adapter missing), model list and variant choice by GPU features, typed model ids against the real prebuilt list of the installed package, request → messages (image note, fitting, budget), JSON mode choice, thinking removal and streamed diffs, the queue and cancel by tag with a fake engine, and the pinned hash matching `node_modules`.
- **Build:** `python3 tools/build_web.py` fails if the hash pin is stale; `node apps/reader/test.mjs` after it.
- **Browser (manual or Playwright with WebGPU):** Chromium with `--enable-unsafe-webgpu --enable-features=Vulkan`; open a note, Study → Generate flashcards with "In this app": the chip shows the download, then cards appear; Stop during download; Ask AI streams; Downloaded models… deletes and the next request downloads again; reload offline and generate again.
- **Desktop:** the tool list shows the CLIs and "In this app (WebLLM)"; a quiz with each.

## Tasks

| Task | Status |
|---|---|
| This document, DEVELOPMENT.md map and next steps, USER_GUIDE section | Done |
| `local-ai.js` provider (merge, catalogue, messages, JSON, queue, cancel, progress, manage dialog) | Done |
| `local-ai-worker.js` (WebLLM worker handler) | Done |
| Wiring: `sharedAI()` in app.js (three reads of the bridge) and transcript.js | Done |
| study.js: JSON schemas for cards and quizzes | Done |
| Model picker: "Downloaded models…" button for providers that can manage models | Done |
| "Unavailable" messages mention WebGPU | Done |
| `tools/build_web.py`: check the pinned library hash | Done |
| Unit tests | Done |
| End-to-end run in Chromium with WebGPU (download, flashcards, chat, cancel, models dialog) | Done on Linux (Asahi, M1 Max); Electron, Windows, macOS, phones not run |
| Workaround: WebLLM 0.2.87 fails on `json_object` without a schema, so `{"type":"object"}` is sent | Done |
| Vision: Phi 3.5 Vision with our 6k record (optional), image_url parts, downscaling, Text only badge | Done |
| Measure Phi 3.5 Vision on a handwritten page; lighter build tried and removed | Done (results above) |
| Reading with OCR: recognize handwriting on demand, quotes located in OCR word boxes for hints; Qwen3 1.7B default | Done |
| Small-model mode: `small-model.js` (reading, per-page prompts, packing, merge, quote location), checkbox in every picker, all consumers | Done |
| Unload an idle model after 3 minutes | Done |
| Compile another vision model (MLC-LLM with an image-adapter manifest), e.g. a Qwen VL or Gemma 3 vision build | Next |
| Measure dropped frames while a model runs on GPUs that drive the screen; schedule work between frames if needed | Next |
| Run OCR automatically for handwriting-only pages before a local request | Next |
| Desktop on Linux: opt-in WebGPU switch (`--enable-unsafe-webgpu`) where Chromium leaves it off | Next |
| Larger windows for the text models where the GPU can afford the KV cache (same mechanism as the 6k Phi record) | Next |

## Verification

2026-11-08, on the owner's Asahi Linux machine (Apple M1 Max, Mesa Vulkan), Chromium 156 driven by playwright-core with `--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist --enable-gpu`, the reader served by `tools/serve_web.mjs` after `python3 tools/build_web.py`. Chromium reports the adapter as vendor `mesa`, architecture `software`, with `shader-f16`; which Vulkan device it actually used was not established.

- **Unit:** `node --test apps/reader/*.test.mjs apps/desktop/*.test.mjs`: 398 tests, 397 pass, 1 skipped (it was skipped before this change), 0 fail. `local-ai.test.mjs` has 18 tests. `node apps/reader/test.mjs` passes after the build.
- **Library:** downloaded from jsDelivr, hash accepted, imported in the page and in the worker from the `blob:` URL; kept in `notecomplete-webllm`.
- **Qwen3 0.6B** (fresh profile): download and load in about 34 s, shown in the job chip ("AI model Qwen3 0.6B · downloading 29% · 0.1 GB"). A streamed chat answer of 51 pieces took 1.5 s. Its flashcards were poor: one card that copied the whole page. Cancelling a running answer gave "The AI request was stopped.", and the next request ran normally.
- **Qwen3 1.7B (default)** (fresh profile): the 1 GB download took about 68 s. The flashcard request with the cards schema returned three correct cards ("What is a process?" / "A process is a program in execution." …) in 76 s including the download. The chat answer took 1.6 s.
- **Reader UI** (sample `Examen wuolah.noteful`): Ask AI lists only "In this app (WebLLM)", the model list with sizes, the remembered model and the gear; the answer streams into the panel. Study → Generate flashcards (Shift+C) offers the same tool and model, and the background job finished with "1 flashcards ready." in about 5 s. The page is handwriting without OCR text, so the card was made from almost nothing, as described above. This also worked with Ask AI closed while it was still answering.
- **Downloaded models…** lists the downloaded model, the others as not downloaded, and "This site uses 1.0 GB of storage of 12 GB available."; the Delete buttons were not clicked.
- **Second pass (OCR reading and small-model mode), 2026-11-09**, same machine, Qwen3 1.7B, Small model on, page 1 of `Examen wuolah.noteful` (handwritten maths with no OCR text before): the reading step recognized the page with the reader's OCR on demand, then the model worked on it alone. Quiz: done in 18 s, the questions in Spanish, **Hint** showed the page region and the outline was drawn where the quoted words are (located in the OCR word boxes). Flashcards: done in 79 s (model already downloaded), valid cards. **Quality is limited by the OCR**: Tesseract read the handwritten maths as "Exomen Wuolah: a CON 12 3 Se puede ,6 ,=6-9=-2 #0 Jactorizar…", so the cards and questions were about fragments ("¿Qué significa Jactorizar?", "6 - 2 = 4"). The pipeline works; better handwriting/maths recognition is what would improve answers on such pages. Phi 3.5 Vision on the same page described the wrong subject and took about 30 s before its first word (plus about 4 minutes to load), so it is optional, not the default.
- **Not run:** the desktop app (Electron) with its CLI tools beside this provider; Windows, macOS, Android and iOS GPUs; deleting a model and downloading it again; working offline after the first use; the fact check, transcript revision and handwriting conversion through this provider (their JSON mode was checked only with a direct request); Stop during a real download (unit-tested with a fake engine).
