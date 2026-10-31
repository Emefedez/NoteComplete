# Stack

## By app type

| App | Core (Rust) | Main view | Frontend / shell |
|---|---|---|---|
| Document / structured editor | parser + model + edit log (serde, thiserror) | DOM/SVG, virtualized | Web UI in Tauri or Electron |
| Signal / data analyzer | rustfft/realfft, ndarray, decimation + LOD pyramid, ring buffers; input via cpal (audio), serialport/rusb (devices), arrow/parquet (files) | WebGL2/WebGPU line + spectrogram renderer, or egui_plot | egui (dense, live) or web UI with GPU canvas |
| Video / audio editor | ffmpeg (ffmpeg-next) or GStreamer for decode/encode, symphonia for audio, frame cache, proxy generation, timeline model | wgpu compositor; web: WebCodecs + WebGPU | Electron (WebCodecs/WebGPU everywhere) or native wgpu + egui/Slint |
| Image / creative canvas | image, tiles + mip levels, brush engine | wgpu / WebGPU tiles | Web UI in Electron, or native |
| Monitoring dashboard / log viewer | tokio ingestion, SQLite/DuckDB, indexes | virtualized tables, canvas charts | Web UI in Tauri |
| CAD / node editor | geometry (glam, lyon), solver, graph model | wgpu / WebGPU scene, SVG overlays for handles | Web UI or native |

## Shell choice

| | Tauri | Electron | Native (egui / Slint / iced) |
|---|---|---|---|
| Size / memory | small | large | smallest |
| Web engine | system (WebKitGTK on Linux: weaker WebGL/WebGPU, codecs vary) | bundled Chromium, identical everywhere | none |
| GPU drawing | WebGL2; WebGPU varies | WebGPU, WebCodecs | wgpu directly |
| Backend language | Rust commands | Node main process (spawn Rust CLI/addon) | Rust |
| Pick when | general tools, dashboards, editors | media, heavy GPU in web tech, Chromium APIs | real-time, dense tools, no web needed |

## Layers

```
crates/
  core/        model, formats, processing, undo log, export. No UI, no I/O traits beyond Read/Write.
  engine/      threads, GPU, device and media I/O (optional; keeps core portable)
  cli/         CLI + `app mcp` server (AI tools read the project through it)
  wasm/        wasm-bindgen bindings when the web UI computes locally
apps/
  ui/          web UI: tokens.css, components.css, one module per feature, tests beside each
  desktop/     Tauri (src-tauri) or Electron (main.js, preload.cjs, tabs.js)
  mobile/      optional WebView wrapper
tools/         build, serve (static + COOP/COEP for threads), install
docs/          user guide, REQUESTS.md (each request: state + how it was checked)
```

## Data plumbing

- Large data never as JSON: ArrayBuffer/typed arrays over IPC (Tauri `ipc::Response` / channels, Electron `MessagePort` transfer), or shared memory (SharedArrayBuffer in WASM with COOP/COEP).
- Streaming sources: ring buffer in Rust, the UI pulls the visible window at frame rate; decimate before crossing the boundary.
- Media: decode in Rust or WebCodecs, upload frames as GPU textures; keep a small frame cache around the playhead.
- Long work: a job with id, progress events, cancel token.

## UI code

- TypeScript or plain ES modules; one controller per feature taking its dependencies as arguments; pure helpers exported for unit tests.
- A small reactive library (Solid, Svelte, Preact signals) only when state fan-out gets hard; no heavy framework needed.
- Heavy modules (editors, typesetting, codecs, ML) imported dynamically on first use.
- The UI feature-detects shell bridges (`window.appAI`, `window.appFiles`) so it also runs in a plain browser for tests.

## Security (shells)

- Sandboxed renderer, context isolation, private protocol (`app://`), no navigation off it, no `window.open`.
- Every IPC handler checks the caller and validates arguments; expose narrow bridges per concern.
- Grant only the web permissions used.

## Persistence

- Source files immutable; edits as an operation log; export flattens.
- Project format versioned and additive; unknown fields round-trip.
- Preferences: local storage behind try/catch (may be empty). Per-project data in SQLite or IndexedDB keyed by content hash.
- Save user work immediately; destructive actions undoable.

## Files from cloud sources (Drive, repositories)

- Identify downloads by **content** (the service's checksum, e.g. Drive `md5Checksum`), not by file id or date: many apps re-upload unchanged files as new ones. Reuse the kept copy when the content matches; never download twice.
- Before opening a kept copy, ask the source for the newest file with that name in that folder; if it differs, let the user choose: newer version · my copy · keep both · compare (side by side, aligned like a diff).
- Data keyed by a file version (study material, annotations, caches) must be offered for carry-over when the user takes a new version; copy, never move.
- If the source can't be reached, open the local copy and say it wasn't checked; never silently open a stale copy as if current.

## Windows and tabs

Single instance; relaunch opens a window; tabs are views that can move between windows without reloading; window backdrop = `--chrome`; see `templates/electron/main.js` (Tauri: `WebviewWindow` per window, same rules).
