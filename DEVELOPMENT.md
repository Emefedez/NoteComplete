# Development guide

This is the current development and validation procedure. The [research provenance and history](docs/RESEARCH_HISTORY.md) separately records the owner's prior work, what was supplied, how the assistant used it, and the resulting evidence. The [native format specification](spec/noteful-v0.1.md) documents observed semantics; [`.nfedit`](spec/nfedit-v1.md) documents this project's edit history and writer.

## Architecture

| Component | Responsibility |
|---|---|
| `research/python/` | Independent parser/renderer used as a regression oracle; historical viewer and migration scripts remain research tools. |
| `crates/noteful-core/` | Portable decoding, scene extraction and editing; no filesystem, network or UI APIs, and `forbid(unsafe_code)`. |
| `crates/noteful-cli/`, `crates/noteful-wasm/` | CLI and browser adapters to the shared core. |
| `apps/reader/` | Virtualized pages, SVG ink, PDF rasterization, imports, editing UI, audio and local speech processing. |
| `apps/mobile/` | Expo SDK 57 wrapper: file-intent queue, WebView bridge and OS sharing. Loads a configured hosted/LAN reader. |
| `apps/desktop/` | Electron wrapper: bundled reader assets, sandboxed renderer and restricted custom asset protocol. |
| `tools/`, `.github/workflows/` | Builds, serving, evidence checks, regression checks and installable package workflows. |

Source bytes remain immutable during editing. `.nfedit` stores the original archive plus edit/redo state; native export flattens applied edits while preserving supported unknown fields and original resources. New shapes export as ink; adjusted supported parametric shapes remain objects. Official Noteful import of modified exports is still unverified.

Selection gestures preview one SVG item at most once per animation frame and send one adjustment when the gesture ends. Item patches retain PDF/audio nodes. Hidden and locked layers are excluded from editing.

## Procedure: from supplied evidence to implementation

### 1. Record the handoff and ownership

For each contribution, record who supplied it, its source, whether it is prior research, an original native sample, a native export, a tool-generated result, a synthetic fixture or a product requirement. Record original filename, size and SHA-256 for binary evidence. Preserve the original bytes. Do not infer authorship from a filename or from possession of a file.

Keep prior explanations and hypotheses distinguishable from conclusions reached during the new analysis. Link handoff records from [research history](docs/RESEARCH_HISTORY.md); use `samples/manifest.json` for retained corpus files. Do not retroactively add generated evidence to `research/evidence/initial-inputs.json`, which describes the original handoff.

### 2. Form a testable question

Prefer a native sample with one changed feature and, when available, an independently exported reference or the owner's explicit ground truth. State what the comparison can establish: field boundaries, text traits, geometric position, compositing or timing. Product requests such as a hamburger menu or speech recognition belong in application requirements, not the recovered format specification.

### 3. Analyze without replacing evidence

Use indexed resource extents and the strict parser. Write extractions and reports under ignored `work/`; leave corpus originals and committed measurement baselines unchanged. Use native symbol names and static pseudocode as corroborating leads, interpreted alongside sample bytes. Label provisional interpretations and retain unknown channels without inventing meanings.

For optional Ghidra extraction, use the matching recorded binary and a separate project:

```sh
"$GHIDRA_HOME/support/analyzeHeadless" "$PROJECT_DIRECTORY" "$PROJECT_NAME" \
  -process Noteful -noanalysis -readOnly -scriptPath research/ghidra \
  -postScript NotefulTargets.java work/ghidra-targets
```

Run `NotefulTextTargets.java` with a separate output directory for text. `GHIDRA_HOME` points to the installation's `libexec`; use a supported JDK. Addresses in the scripts are specific to the binary fingerprint in `research/evidence/binary.json`. Ghidra and the historical external database are not required for ordinary builds.

### 4. Validate the interpretation

- **Byte round-trip:** require exact parsing/re-encoding and malformed-input rejection. This validates syntax and preservation.
- **Independent reference:** compare with native thumbnails/PDF exports or supplied ground truth for visual and semantic claims.
- **Implementation parity:** compare Rust with the independent Python oracle. Agreement checks consistency, not official interoperability.
- **Synthetic regression:** isolate corner cases and label generated fixtures explicitly. A synthetic multiple-recording test cannot establish every native pause/splice behavior.
- **Native interoperability:** import modified exports into official Noteful before claiming compatibility. This remains outstanding.

Update the observed format specification only with the supporting evidence and scope of the conclusion. Record superseded hypotheses in research history instead of silently presenting them as facts.

### 5. Implement at the appropriate layer

Put format semantics in the portable core, host integration in adapters/wrappers, and UI/performance behavior in the reader. Preserve opaque fields and resource bytes where supported. Keep new product formats and inferred speech timings distinct from decoded native data. Add focused regressions for correctness risks and use UI checks for layout/interaction changes.

### 6. Build, check and report the actual result

Follow [README build and validation commands](README.md#validate). Web runtime tests require a fresh WASM/web build. Use [BUILDS.md](docs/BUILDS.md) for package workflows, signing and Android's hosted-reader requirement.

Report separately: source changes implemented, automated checks passed, packages actually built, application execution observed, and physical-device/native interoperability still untested. A workflow file, successful target compilation or generated Android project is not a completed device test. Record validation limits beside the claim rather than implying universal support.

## Repository and documentation maintenance

- `README.md`: entry point, build commands and documentation map.
- `docs/RESEARCH_HISTORY.md`: attribution, supplied inputs, derived evidence and development history.
- `DEVELOPMENT.md`: current architecture, contribution procedure and tool inventory.
- `docs/USER_GUIDE.md`: current user-facing behavior.
- `docs/BUILDS.md`: packaging procedure and its validation/signing limits.
- `spec/`: observed native semantics and the project's own editing format.

Keep procedural instructions in their owning document and link to them elsewhere. Preserve corpus manifests and small evidence baselines. Generated media, reports, dependencies, bindings and packages belong in ignored directories. Historical scripts remain explicitly marked; do not run obsolete migration scripts against current source. The [earlier cleanup record](docs/RESEARCH_HISTORY.md#historical-evidence-cleanup) documents retained provenance and the external backup.

## Python tool inventory

All commands below run from the repository root. Core oracle scripts require only Python's standard library; optional evidence tools list their extra dependencies. Generated output belongs under ignored `work/`.

| Script | Purpose / invocation | Dependencies and output |
|---|---|---|
| `research/python/noteful.py` | Strict parser/encoder, semantic inspection; `python3 research/python/noteful.py samples/nota_1linea.noteful --extract work/one-line` | Standard library; extraction refuses an existing destination; preserves original input. `--view` opens the historical viewer. |
| `research/python/render_note.py` | Importable independent SVG scene oracle | Standard library; approximate paper/ink rendering, no production PDF rasterizer. |
| `research/python/rich_text.py` | Importable attributed-text pool decoder and SVG text renderer | Standard library; exercised by text tests and scene parity. |
| `research/python/rust_backend.py` | Historical adapter running the Rust CLI parser through the Python renderer | Built `target/debug/noteful` or release CLI; no silent Python fallback. |
| `research/python/viewer.py` | Optional historical loopback viewer; `python3 research/python/viewer.py --no-browser --port 8770` | Standard library; serves the corpus and independent PDF reference locally. `--engine rust` uses the migration adapter. Not the product app. |
| `tools/build_web.py` | Build WASM bindings and stage browser dependencies | Rust, matching wasm-bindgen CLI, Node/npm, Python 3.11+; no sample notes copied into the app. |
| `tools/build_examples.py` | Optional static research gallery | Standard library; writes `work/examples/`, not app assets. |
| `tools/analyze_corpus.py` | Recreate extracted blocks, diagnostic SVG and corpus comparison | Standard library; writes `work/reports/` and `work/extracted/`. |
| `tools/validate_geometry.py` | Compare decoded initial stroke positions with native JPEG thumbnails | Pillow; reads originals directly, writes `work/reports/geometry-validation.json`. Position evidence only. |
| `tools/validate_variable_width.py` | Independently measure PDF caps against the third coordinate channel | NumPy and pypdf; writes `work/reports/variable-width-validation.json`. Does not overwrite the committed baseline. |
| `tools/check_rust_parity.py` | Compare Rust fields/semantics and round-trip against Python | Rust CLI + standard library; current report under `work/reports/`. |
| `tools/check_scene_parity.py` | Compare ordered native/Python SVG primitives and inherited transforms | Rust CLI + standard library; tolerance 2e-5 internal units; no pixel-equivalence claim. |
| `tools/check_export.py` | Decode native writer output independently and check original media bytes | Rust CLI + standard library; current report under `work/reports/`. |
| `tools/build_audio_fixture.py` | Regenerate the synthetic 0.25-second WAV resource fixture | Standard library; intentionally writes the named test fixture and a scratch report. |
| `tools/build_multi_audio_fixture.py` | Regenerate the synthetic two-recording fixture | Standard library; intentionally writes the named test fixture. |
| `research/python/historical/update_decoder.py` | Preserved one-off early migration script | Historical only: expects obsolete `tools/noteful.py`; do not run against current source. Its replacement logic is already superseded by the maintained parser. |
| `tests/test_noteful.py`, `test_text.py`, `test_viewer.py` | Parser, text, rendering and historical HTTP regression tests | `python3 -m unittest discover -s tests -v`; standard library. |

Optional evidence environment:

```sh
python3 -m venv work/evidence-env
work/evidence-env/bin/pip install Pillow numpy pypdf
work/evidence-env/bin/python tools/validate_geometry.py
work/evidence-env/bin/python tools/validate_variable_width.py
```

The tests cover observed corpus syntax, malformed inputs, scene correspondence, media preservation, timing, edit history and writer output. CI checks desktop operating systems and Android/iOS compilation targets as well as actual WASM runtime behavior. Target compilation and Expo bundles do not prove physical-device file selection, codec playback or sharing.

## Reader rendering and speech settings

`apps/reader/quality.js` validates local display preferences and drives the quality dialog. Raster settings enter the PDF cache key; applying a change invalidates in-flight page tokens and redraws nearby pages without changing document history. PDF canvases have both a pixel budget and an 8192-pixel side limit. Thumbnails remain 256-pixel bitmaps, independent of page quality. CSS contrast/brightness never enter exported SVG. Neutral settings use no CSS filter.

Speech preprocessing lives in `audio-processing.js`, with playback gain/filtering and offline normalization. Whisper runs in a disposable worker; model/language/processing settings enter the transcript cache key. Transcript DOM is bounded to 100 words, hidden panels skip highlighting, and audio updates are throttled. Keep these bounds when adding features; test long transcripts and long PDF documents, including after cancellation and switching recordings.

Run `node --test apps/reader/*.test.mjs apps/mobile/*.test.mjs apps/desktop/*.test.mjs tools/*.test.mjs` and `node apps/reader/test.mjs` after a web build. Browser checks should include a narrow mobile viewport, quality persistence, cancelling settings, fit/zoom, timed word/stroke seeking and page scrolling after transcription. These do not replace physical-device performance measurements.

Build output (`pkg`, `vendor`, `precache.json`), dependencies and scratch reports remain ignored. The web build recreates generated bindings and vendor directories to avoid stale artifacts. Detailed reader instructions are consolidated in `docs/USER_GUIDE.md`; README is the entry point. Original samples and research evidence are retained.

## Mobile and desktop integration

Expo uses the same reader through a WebView. Android ACTION_VIEW filters are generated from `apps/mobile/app.json`; `IncomingFiles` queues cold/warm file intents until the reader is ready, deduplicates delivery and respects unsaved edits. Expo Go cannot register project-specific file handlers. A standalone APK currently needs a reachable configured reader URL; embedded offline reader assets are not implemented. See the [user guide](docs/USER_GUIDE.md#android-installed-build).

The desktop stage copies only assets listed in the web precache manifest. The desktop workflow shares one tested web build across AppImage, macOS ARM64/x64 DMG/ZIP and Windows NSIS jobs. The Android workflow generates the Expo project and builds a release-mode preview using its debug signing key. See [packaging instructions and validation limits](docs/BUILDS.md).

## Next steps

Status 2026-10-27. Done in this sprint: wire type 0x23 (PDF rect on widened pages), flag-0x10 linked strokes and kind-23 groups, so the owner's *Memoria 1* (258 MB, 206 pages, 6 recordings) and *Temas1+2* (215 MB, 47 pages) open warning-free and round-trip byte-exact; widened pages draw the PDF at native scale; home screen (Recent + Drive grid) with range-read native covers (~320 KiB per note instead of the whole file); downloaded notes kept in a folder and reused while Drive's version matches; global command bar with Ctrl/Cmd+K palette replacing the hamburger menu.

1. **Pages menu: insert pages.** `Insert blank page…` (presets + custom size, including widened pages) and `Insert PDF pages…` are in the bar but disabled. Needs a core `Edit::InsertPage` with stable page keys (UI indices map to keys at the API boundary so earlier edits keep their pages), fractional tag-5 order strings, export of new page records/editable sets/PDF resources, and a background tag 9 rect for PDFs placed on larger pages.
2. **Study menu: flashcards and quiz.** Desktop-only bridge spawning the user's own CLIs in print mode (`claude -p --output-format json`, `antigravity -p --output-format json --json-schema`, `codex exec --output-schema`, plus a custom command). The reader renders selected pages to PNG (PDF raster + ink) into a temp dir passed with `--add-dir`; typed text and transcripts go in the prompt. Output: reviewable card list, Anki TSV with `#separator`/`#deck` headers, optional AnkiConnect push from the main process, and an in-app quiz mode. `Review a saved deck…` is wired in markup only.
3. **MCP server.** `noteful mcp` (stdio) on the Rust core: list notes in the library folder, outline (pages, sizes, PDF page, ink counts, typed text, recordings), extract PDF/audio/cover to files, page image (resvg with the PDF page from `pdftoppm` when installed), and an Anki TSV writer. Borrow from MIT noteful-mcp: lenient record tails, tape/highlight semantics.
4. **Pixel-eraser masks (stroke flag 2).** Partially erased strokes still render whole; apply the per-segment mask described by noteful-mcp (12 strokes in *Examen wuolah*, a few in the owner notes).
5. **Desktop bridge.** `window.notecompleteFiles` (folder/choose/read/write/openFile/readRecent) is consumed by the reader but not yet implemented in `apps/desktop/main.js`; until then the desktop build uses browser storage and no local-path Recent entries. Restrict read/write to the chosen folder and paths opened through the main-process dialog.
6. **Drive session persistence.** Tokens stay in memory, so each launch needs Reconnect (one click; the folder reopens). Consider desktop refresh tokens in `safeStorage`.
7. Add the two owner notes' structural facts (not the files) to regression fixtures: a synthetic widened-page archive and linked-stroke blob are in `crates/noteful-core/tests/page_geometry.rs`.

## Remaining validation

Import modified exports into official Noteful; obtain native multiple-recording, pause/splice and decorated-text samples; validate layer merge/tombstone behavior; improve native ink smoothing and advanced text layout; validate file selection, codecs, sharing and performance on physical devices. Unknown auxiliary channels, unsupported object variants, stale exported thumbnails and incomplete CRDT semantics remain explicit limitations. Generated Whisper word boundaries are estimates and need their own accuracy assessment.

Complete the first native package workflow runs and installed-app checks before claiming successful delivery for each target. Packaging automation is distinct from signed production distribution.

## Google Drive reader integration

`drive-client.js` is a GET-only transport with explicit token expiry and paginated folder metadata queries. `drive-auth.js` selects Google Identity Services for web, a restricted Electron bridge to system-browser PKCE for desktop, or a correlated WebView bridge to the mobile Google SDK. Reader tokens stay in memory. `drive-browser.js` owns the modal, cancellation generations and download-before-open flow. It calls the existing open path only after downloading, where busy/unsaved checks still apply. Metadata is rendered through text nodes. The service worker does not cache cross-origin API/auth requests. Configuration, scope and native-wrapper limitations are in [GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md).

The `Release installers` workflow calls the reusable Android/desktop workflows for a tag and publishes only after every job succeeds. The publish job verifies the expected asset types, adds SHA-256 checksums and attaches them to the tagged prerelease. Local protocol/bridge tests and JavaScript bundles do not establish live OAuth success: registered clients, consent and native-device runs are still required.
