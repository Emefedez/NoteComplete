# Development guide

This is the current development and validation guide for the NoteComplete client. Format research and its provenance are on the [`reverse-engineering`](https://github.com/Emefedez/noteful-re/tree/reverse-engineering) branch. The [native format specification](spec/noteful-v0.1.md) documents observed semantics; [`.nfedit`](spec/nfedit-v1.md) documents this project's edit history and writer.

## Architecture

| Component | Responsibility |
|---|---|
| `crates/noteful-core/` | Portable decoding, scene extraction and editing; no filesystem, network or UI APIs, and `forbid(unsafe_code)`. |
| `crates/noteful-cli/`, `crates/noteful-wasm/` | CLI and browser adapters to the shared core. |
| `apps/reader/` | Virtualized pages, SVG ink, PDF rasterization, imports, editing UI, audio and local speech processing. |
| `apps/mobile/` | Expo SDK 57 wrapper: file-intent queue, WebView bridge and OS sharing. Loads a configured hosted/LAN reader. |
| `apps/desktop/` | Electron wrapper: bundled reader assets, sandboxed renderer and restricted custom asset protocol. |
| `tools/`, `.github/workflows/` | Builds, serving, evidence checks, regression checks and installable package workflows. |

Source bytes remain immutable during editing. `.nfedit` stores the original archive plus edit/redo state; native export flattens applied edits while preserving supported unknown fields and original resources. New shapes export as ink; adjusted supported parametric shapes remain objects. Official Noteful import of modified exports is still unverified.

Selection gestures preview one SVG item at most once per animation frame and send one adjustment when the gesture ends. Item patches retain PDF/audio nodes. Hidden and locked layers are excluded from editing.

## Format research

The format work behind the core (Ghidra scripts and static-analysis evidence, the independent Python parser/renderer oracle, the legacy comparison viewer, corpus analysis and Rust/Python parity checks, and the evidence-to-implementation procedure) lives on the [`reverse-engineering`](https://github.com/Emefedez/noteful-re/tree/reverse-engineering) branch. New format variants found in real notes are analysed and documented there first; this branch carries the [specification](spec/noteful-v0.1.md) the core implements and synthetic regression tests for each variant (for example `crates/noteful-core/tests/page_geometry.rs`).

## Documentation map

- `README.md`: entry point, build commands and documentation map.
- `DEVELOPMENT.md`: architecture, next steps and validation limits.
- `docs/USER_GUIDE.md`: current user-facing behavior.
- `docs/GOOGLE_DRIVE.md`, `docs/BUILDS.md`: Drive setup; packaging procedure and its validation/signing limits.
- `spec/`: observed native semantics and the project's own editing format.

Generated media, reports, dependencies, bindings and packages belong in ignored directories (`work/`, `pkg`, `vendor`). The corpus in `samples/` and the synthetic fixtures in `tests/fixtures/` are required by the Rust and WASM tests.

The tests cover observed corpus syntax, malformed inputs, media preservation, timing, edit history and writer output. CI checks desktop operating systems and Android/iOS compilation targets as well as actual WASM runtime behavior. Target compilation and Expo bundles do not prove physical-device file selection, codec playback or sharing.

## Reader rendering and speech settings

`apps/reader/quality.js` validates local display preferences and drives the quality dialog. Raster settings enter the PDF cache key; applying a change invalidates in-flight page tokens and redraws nearby pages without changing document history. PDF canvases have both a pixel budget and an 8192-pixel side limit. Thumbnails remain 256-pixel bitmaps, independent of page quality. CSS contrast/brightness never enter exported SVG. Neutral settings use no CSS filter.

Speech preprocessing lives in `audio-processing.js`, with playback gain/filtering and offline normalization. Whisper runs in a disposable worker; model/language/processing settings enter the transcript cache key. Transcript DOM is bounded to 100 words, hidden panels skip highlighting, and audio updates are throttled. Keep these bounds when adding features; test long transcripts and long PDF documents, including after cancellation and switching recordings.

Run `node --test apps/reader/*.test.mjs apps/mobile/*.test.mjs apps/desktop/*.test.mjs tools/*.test.mjs` and `node apps/reader/test.mjs` after a web build. Browser checks should include a narrow mobile viewport, quality persistence, cancelling settings, fit/zoom, timed word/stroke seeking and page scrolling after transcription. These do not replace physical-device performance measurements.

Build output (`pkg`, `vendor`, `precache.json`), dependencies and scratch reports remain ignored. The web build recreates generated bindings and vendor directories to avoid stale artifacts. Detailed reader instructions are consolidated in `docs/USER_GUIDE.md`; README is the entry point. Original samples and research evidence are retained.

## Mobile and desktop integration

Expo uses the same reader through a WebView. Android ACTION_VIEW filters are generated from `apps/mobile/app.json`; `IncomingFiles` queues cold/warm file intents until the reader is ready, deduplicates delivery and respects unsaved edits. Expo Go cannot register project-specific file handlers. A standalone APK currently needs a reachable configured reader URL; embedded offline reader assets are not implemented. See the [user guide](docs/USER_GUIDE.md#android-installed-build).

The desktop stage copies only assets listed in the web precache manifest. The desktop workflow shares one tested web build across AppImage, macOS ARM64/x64 DMG/ZIP and Windows NSIS jobs. The Android workflow generates the Expo project and builds a release-mode preview using its debug signing key. See [packaging instructions and validation limits](docs/BUILDS.md).

## Next steps

Status 2026-10-27. Done in this sprint: wire type 0x23 (PDF rect on widened pages), flag-0x10 linked strokes and kind-23 groups, so the owner's *Memoria 1* (258 MB, 206 pages, 6 recordings) and *Temas1+2* (215 MB, 47 pages) open warning-free and round-trip byte-exact; widened pages draw the PDF at native scale; home screen (Recent + Drive grid) with range-read native covers (~320 KiB per note instead of the whole file); downloaded notes kept in a folder and reused while Drive's version matches; native-style File/Edit/View/Pages/Study/Help menubar (compacts from 36 to 26 px while scrolling, menu items mirror toolbar state, hover switches menus) with a Ctrl/Cmd+K palette, replacing the hamburger menu; status messages are a transient toast instead of a permanent strip. Electron hides its own duplicate menubar (Alt reveals it).

1. **Search and on-demand OCR (next sprint).** One search box (Pages → Find…, Ctrl+F, and palette `find …`) over three text sources, each indexed lazily and cached per note version in the library store:
   - *PDF text:* pdf.js `getTextContent()` per page, run on first search in a worker; hits are highlighted with the text item boxes mapped through the page's PDF rect (background tag 9) so widened pages line up.
   - *OCR of handwriting and scanned/image pages:* never automatic. **Pages → Recognize text…** asks for current page / page range / whole note and runs Tesseract.js (WASM, lazily loaded like Whisper, `spa+eng` by default, language picker) in a disposable worker over the reader's own page raster (PDF + ink + images at ~2× fit width), with progress and Cancel. Results (words, boxes, confidence) are stored per page; pages already covered by PDF text are skipped unless the user asks. Optional later: ink-only rasterization for handwriting-only passes, and the Study bridge's CLIs as a higher-quality OCR backend on desktop.
   - *Audio:* existing Whisper transcripts (already cached per recording/settings); hits seek the recording and highlight the timed ink.
   - Matching: accent- and case-insensitive normalized tokens (NFD, strip diacritics) with prefix matching; typo tolerance (edit distance ≤1 for words ≥5 letters) for OCR and transcript text where recognition errors are common. Results list grouped by page with source badges (PDF / OCR / Audio) and next/previous navigation. Full phonetic fuzzy search over audio is out of scope; users try a few word variants.
   - Bounds: index stored as compact per-page word arrays; no OCR above the user's selection; memory/time limits reported in the progress UI. MCP `search_note` reuses the cached index.
2. **Pages menu: insert pages.** `Insert blank page…` (presets + custom size, including widened pages) and `Insert PDF pages…` are in the bar but disabled. Needs a core `Edit::InsertPage` with stable page keys (UI indices map to keys at the API boundary so earlier edits keep their pages), fractional tag-5 order strings, export of new page records/editable sets/PDF resources, and a background tag 9 rect for PDFs placed on larger pages.
3. **Study menu: flashcards and quiz.** Desktop-only bridge spawning the user's own CLIs in print mode (`claude -p --output-format json`, `antigravity -p --output-format json --json-schema`, `codex exec --output-schema`, plus a custom command). The reader renders selected pages to PNG (PDF raster + ink) into a temp dir passed with `--add-dir`; typed text and transcripts go in the prompt. Output: reviewable card list, Anki TSV with `#separator`/`#deck` headers, optional AnkiConnect push from the main process, and an in-app quiz mode. `Review a saved deck…` is wired in markup only.
4. **MCP server.** `noteful mcp` (stdio) on the Rust core: list notes in the library folder, outline (pages, sizes, PDF page, ink counts, typed text, recordings), extract PDF/audio/cover to files, page image (resvg with the PDF page from `pdftoppm` when installed), and an Anki TSV writer. Borrow from MIT noteful-mcp: lenient record tails, tape/highlight semantics.
5. **Pixel-eraser masks (stroke flag 2).** Partially erased strokes still render whole; apply the per-segment mask described by noteful-mcp (12 strokes in *Examen wuolah*, a few in the owner notes).
6. **Desktop bridge.** `window.notecompleteFiles` (folder/choose/read/write/openFile/readRecent) is consumed by the reader but not yet implemented in `apps/desktop/main.js`; until then the desktop build uses browser storage and no local-path Recent entries. Restrict read/write to the chosen folder and paths opened through the main-process dialog.
7. **Drive session persistence.** Tokens stay in memory, so each launch needs Reconnect (one click; the folder reopens). Consider desktop refresh tokens in `safeStorage`.
8. Add the two owner notes' structural facts (not the files) to regression fixtures: a synthetic widened-page archive and linked-stroke blob are in `crates/noteful-core/tests/page_geometry.rs`.

## Remaining validation

Import modified exports into official Noteful; obtain native multiple-recording, pause/splice and decorated-text samples; validate layer merge/tombstone behavior; improve native ink smoothing and advanced text layout; validate file selection, codecs, sharing and performance on physical devices. Unknown auxiliary channels, unsupported object variants, stale exported thumbnails and incomplete CRDT semantics remain explicit limitations. Generated Whisper word boundaries are estimates and need their own accuracy assessment.

Complete the first native package workflow runs and installed-app checks before claiming successful delivery for each target. Packaging automation is distinct from signed production distribution.

## Google Drive reader integration

`drive-client.js` is a GET-only transport with explicit token expiry and paginated folder metadata queries. `drive-auth.js` selects Google Identity Services for web, a restricted Electron bridge to system-browser PKCE for desktop, or a correlated WebView bridge to the mobile Google SDK. Reader tokens stay in memory. `drive-browser.js` owns the modal, cancellation generations and download-before-open flow. It calls the existing open path only after downloading, where busy/unsaved checks still apply. Metadata is rendered through text nodes. The service worker does not cache cross-origin API/auth requests. Configuration, scope and native-wrapper limitations are in [GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md).

The `Release installers` workflow calls the reusable Android/desktop workflows for a tag and publishes only after every job succeeds. The publish job verifies the expected asset types, adds SHA-256 checksums and attaches them to the tagged prerelease. Local protocol/bridge tests and JavaScript bundles do not establish live OAuth success: registered clients, consent and native-device runs are still required.
