# Performance and checks

## Budgets

| What | Target |
|---|---|
| Idle (nothing playing/streaming) | 0 ms script, 0 layouts over 10 s; ~0–1% CPU for the app |
| Playing / streaming | one draw per display frame, < 8 ms of main-thread work per frame |
| Pan / zoom / drag | transform or GPU uniform update during the gesture; full redraw once on release (or at most once per frame) |
| Input → visible change | < 50 ms (< 16 ms for drawing and scrubbing) |
| Live text (logs, streamed AI) | batched, re-rendered ≤ every 100–120 ms |
| DOM | bounded: virtualize tables/lists; cap transcripts/consoles |
| Startup | first paint < 1 s; heavy modules (codecs, ML, typesetting) on first use |
| New window / tab | no white frame: backdrop colour + show after first draw |

## Rendering data

- Decimate to the screen: per pixel column keep min/max (and first/last) — draw ≤ 2 points per column whatever the zoom.
- Precompute a level-of-detail pyramid (min/max per 2^n samples) in the core; pick the level for the current zoom.
- Spectrograms/heatmaps: compute in a worker or Rust (FFT with a window, overlap), upload as a texture, colour with the sequential ramp in a shader.
- Lines: GPU (instanced quads or line strips in WebGL2/WebGPU/wgpu); Canvas 2D is fine up to ~10k segments per frame.
- Draw at devicePixelRatio; snap 1px lines to half pixels; keep text in DOM/SVG overlays or a glyph atlas.
- Video: decode ahead into a small frame ring around the playhead; scrubbing uses nearest keyframe + proxies; render effects on the GPU; export in a background job.
- Audio: playback clock is the master; the UI follows it (never the reverse).

## Memory in long documents

- Items far from the view keep only their size: drop their drawing, rasters, text layers and search highlights (left-over text layers held 100k+ nodes and ~1 GB in a 193-page PDF).
- Keep the last few rasters (an LRU of 3) for scrolling back; release them when the page list is rebuilt, and let new pages take them.
- Rasters as large as the screen needs: scale by `devicePixelRatio` (a quality setting for 2× screens halves per side at 1×); redraw when the window moves to another screen.
- One GPU texture per canvas: above ~4096 px a side or 16 MP many tablets draw nothing; use an image (drawn in tiles) there.
- A canvas is a compositing layer: drawing over one with hundreds of SVG strokes costs ~10 ms a frame in overlap tests; show a PNG inside the SVG for ink-heavy items. Encode PNGs in a worker (`OffscreenCanvas.convertToBlob`), not `toDataURL` on the main thread.
- Thumbnails redraw when *their* item changes (count edits per item), once the pen pauses; never all of them after any edit.
- Debounce persisting derived data (search words) until scrolling settles; reuse layers a redraw doesn't change.
- Measure memory as PSS of the whole browser process tree (workers and GPU included), peak while scrolling, after scrolling, and after a memory-pressure signal; medians of several runs (`tools/perf_bench.mjs`).

## Joining over a network fast

- Serve the app with content hashes: a precache list of `{path: hash}` plus the shell; the service worker is cache-first while a file's hash is current; heavy engines cached on first use, not at install.
- `ETag`/`Last-Modified` with `Cache-Control: no-cache` (a 304 on the next join), gzip or brotli compressed once and kept; a stable port so the cache stays valid.
- Send the document snapshot compressed; a peer that reconnects gets only the edits it missed.
- Measure through a throttled link (5 Mbit/s): time and bytes for a cold and a warm join.

## Loops

- Run `requestAnimationFrame` (or the native frame callback) only while something moves: playing, streaming, animating, dragging. Stop when it settles.
- Throttle input-driven work to one per frame; debounce search/filter input (~120 ms).
- Hidden windows/tabs: pause drawing; keep data ingestion bounded.

## Measuring

- Renderer: CDP `Performance.getMetrics` before/after 10 s (`TaskDuration`, `ScriptDuration`, `LayoutCount`, `RecalcStyleCount`); `Tracing` for frame timings.
- Per process: `utime+stime` from `/proc/<pid>/stat` (fields 14–15) over the app's process tree, labelled by `--type=`; on macOS `top -pid`.
- Power: battery `power_now` vs a baseline without the app.
- GPU path: no software rendering (swiftshader, `--disable-gpu`) in the GPU process flags.
- A window on a hidden workspace isn't drawn; measure on screen for drawing costs.
- Native: `cargo flamegraph`, `tracy`; count allocations in the frame loop (should be ~0).

## Test order

1. Unit tests of the core and pure UI helpers (`cargo test`, `node --test`/vitest): parsers, decimation, scoring, tab model, prompt builders.
2. Headless browser (CDP or Playwright) on the web UI with fake bridges injected before load; `Emulation.setFocusEmulationEnabled` so keys work; drive real flows (file input, drag, keys); assert DOM and request payloads.
3. Shell main process against a stub host module that throws like the real one (destroyed windows).
4. Packaged artefact: unpack and check the changed files are inside.
5. Screenshots of every state in the app's default theme, before and after (`scripts/cdp-gallery.mjs`); look at them.
6. Real app on real data (long files, many channels, 4K video); report what was not exercised.

## Test harness pitfalls

- Pick a free port for the test server and the browser (random, or check `ss -ltn`): another app on the port silently serves its own page.
- Each run gets its own browser profile and debugging port; a browser left over from a previous run keeps its storage and answers on the old port.
- `Runtime.evaluate` runs in the page's global scope: `const x` twice fails the second call; wrap snippets in `(() => { … })()`.
- Wait for the condition (a request arriving, a button showing), not a fixed sleep.
- `Page.addScriptToEvaluateOnNewDocument` needs `Page.enable` first; key events need `Emulation.setFocusEmulationEnabled`.

## Focus pitfalls

- Hiding the focused control moves focus to `<body>`: listen for shortcuts on `document`, scoped by which dialog/panel is open.
- Escape closes a modal dialog by default; `preventDefault` when an inner box should close first.
- Canvases need `tabindex="0"` and their own key handling to be keyboard-usable.
