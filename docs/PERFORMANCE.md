# Performance and memory

How NoteComplete's page view keeps long notes light, and how to measure it.

## Measuring

`node tools/perf_bench.mjs` (after a web build, with Playwright's Chromium) opens a note in the web app and:

1. scrolls through every page, waiting at each step for the pages in view to be drawn with their PDF;
2. waits 3 s for work left over from scrolling;
3. draws 20 strokes on the first page.

It reports:

- **Time and main-thread work** (Chrome's `TaskDuration`) for each phase.
- **Page elements**: the number of DOM nodes.
- **Memory**: the proportional set size (PSS) of every Chromium process together, so the engine's worker, pdf.js and the compositor all count. It is measured three times:
  - at its peak while scrolling;
  - after scrolling;
  - after a simulated memory-pressure signal, which is what stays once the browser drops its caches.

Options:

- `--runs N`: medians of N runs (default 3).
- `--dpr 2`: a 2× screen, like tablets, phones and most laptops.
- `--json file`: also save the results.

The default notes are:

- `samples/Practice book (vol. 1).noteful`: 193 PDF pages.
- `samples/Examen wuolah.noteful`: 3 PDF pages with several hundred strokes each.
- `tests/fixtures/multi-audio-synthetic.noteful`.

### How quickly the interface answers

`node tools/ui_latency_bench.mjs` (after a web build) opens the same 193-page note at a slow tablet's speed (Chrome's CPU throttling, 4× by default), then taps menus, tool buttons, dialogs, the right-click menu and a colour, and times each from the moment the pointer goes down to the frame that shows the answer painted. Each tap is repeated (`--runs N`, default 3) and the median is reported, slowest first. `--only text` measures only the steps whose name contains it, and `--json file` saves the results.

## What keeps it light

- **Pages away from the view are placeholders.** A page more than 600 px outside the view keeps only its size. Its drawing, PDF raster, selectable-text layer and search highlights go. Before 1.1.12 the text and search layers stayed referenced, about 520 elements per PDF page; a 193-page PDF held more than 100,000 nodes and about 1 GB after one scroll through.
- **The PDF under the ink.** pdf.js draws the page into a canvas, which is then shown in one of two ways (`pdf-background.js`):
  - **Pages with little ink** show the canvas itself, as a still bitmap (`bitmaprenderer`). Its memory goes the moment the page leaves the view.
  - **Pages with more than 100 ink elements** show a PNG inside the page's SVG. A canvas is a compositing layer of its own, and while a stroke is drawn over it Chromium checks every ink element against that layer each frame: about 10 ms a frame with a few hundred strokes, against 2 ms for a picture. The PNG is encoded in a worker (`raster-encoder.js`); `toDataURL` on the main thread took 60–100 ms per page.

  - **Rasters larger than 4096 px a side (or 16 MP)**, as on a page zoomed in, are also a PNG, whatever the ink. A canvas reaches the screen as one GPU texture, and many Android tablets (Xiaomi Pad 5) take none that large: the canvas was not drawn at all. A picture is drawn in tiles.

  Either way, the last 3 rasters are kept for scrolling back. When pages are added or removed and the page list is rebuilt, the old pages let go of their rasters as pages leaving the view do, and stop drawing: the new pages take the kept rasters.
- **Rasters as large as the screen needs.** The quality setting's scale is for a 2× screen. A 1× screen gets half as many pixels per side (Balanced 2× becomes 1×), never fewer than it shows. Moving the window to another screen, or changing the browser zoom, draws the PDF again.
- **Thumbnails** are drawn when they come into view in the pages panel, and again only when their own page changes, once the pen pauses. Before 1.1.12, every page scrolled past drew its thumbnail, and after any edit every page drew it again. The thumbnails' small PDF images are kept least-recently-used, so the page being written on keeps its own.
- **Search words** read while scrolling are saved once scrolling settles. They used to be written for every page shown, each write copying every page read so far.
- **Text layers** are reused when a stroke redraws a page, instead of hundreds of text elements made again for every stroke.
- **No identity filter**: at 100 % contrast and brightness, pages have no CSS filter (it made each page a filtered layer).

## Results

A 1× screen, on a 4-core cloud container running Chromium headless with software rendering. "Before" is 1.1.11 (medians of 3 runs), "after" is 1.1.12 (one run of the final code).

**Practice book (vol. 1).noteful** (193 pages)

| | Before | After | Change |
|---|---:|---:|---:|
| Memory, peak while scrolling every page | 1183 MB | 414 MB | -65 % |
| Memory after scrolling | 1050 MB | 309 MB | -71 % |
| Memory once the browser drops its caches | 584 MB | 268 MB | -54 % |
| Memory after drawing 20 strokes | 615 MB | 166 MB | -73 % |
| Time to scroll every page (PDF drawn) | 38.3 s | 13.0 s | -66 % |
| Main-thread work while scrolling | 32.5 s | 9.6 s | -71 % |
| Work left over after scrolling (3 s) | 2.2 s | 73 ms | -97 % |
| Main-thread work for 20 strokes | 5.6 s | 2.6 s | -53 % |

**Examen wuolah.noteful** (3 pages)

| | Before | After | Change |
|---|---:|---:|---:|
| Memory, peak while scrolling every page | 146 MB | 120 MB | -17 % |
| Memory after scrolling | 126 MB | 109 MB | -14 % |
| Memory once the browser drops its caches | 85 MB | 92 MB | +8 % |
| Memory after drawing 20 strokes | 100 MB | 103 MB | +3 % |
| Time to scroll every page (PDF drawn) | 324 ms | 250 ms | -23 % |
| Main-thread work while scrolling | 292 ms | 231 ms | -21 % |
| Work left over after scrolling (3 s) | 160 ms | 108 ms | -33 % |
| Main-thread work for 20 strokes | 2.5 s | 2.2 s | -12 % |

Long notes gain the most: memory and work there grew with the pages visited, and now stay flat. A short note was already small. On a 2× screen, the PDF raster sizes are as before, so the memory saved on a long PDF comes from the other changes.

### Menus, tools and dialogs (1.2.31)

Opening a dialog makes the rest of the window inert, and Chrome restyles every element under an inert one. Most of the window's elements were the page list's cards (about 19 per page; 3,700 for this note), so every dialog paid for every card. The cards out of sight now skip their styling and layout (`content-visibility: auto`), which also helps anything else that restyles the whole window. The root's `--modal-top` is set only when it changes, since setting it restyled everything too. The prefab picker draws its large preview after the frame that shows it, and the command palette (Go to page too) no longer measures the window to scroll a list that is already at its top.

`tools/ui_latency_bench.mjs`, 4× CPU throttling, medians of 5 runs, milliseconds from the tap to the painted answer:

| | 1.2.30 | 1.2.31 | Change |
|---|---:|---:|---:|
| Command palette | 224 | 94 | -58 % |
| Lag log | 219 | 91 | -58 % |
| Go to page | 211 | 105 | -50 % |
| Insert prefab | 208 | 124 | -40 % |
| Import, export and share | 202 | 116 | -43 % |
| Display quality | 165 | 90 | -45 % |
| Ask AI panel | 157 | 61 | -61 % |
| Find | 138 | 59 | -57 % |
| Home | 110 | 72 | -35 % |
| Tool buttons (9 tools, median of medians) | 78 | 58 | -26 % |
| Menus (File to Help) | 27 to 40 | 33 to 45 | noise |

At full CPU speed the times are about a quarter of these: dialogs go from 40 to 55 ms to 15 to 30 ms. Menus, a colour tap (25 ms) and the right-click menu (about 60 ms) were already within a few frames.

## Euro-Office editor frame rate (1.2.93)

Euro-Office's Word, Slides and Visio editors (sdkjs) draw from `AscCommon.PaintMessageLoop`. On desktop it runs on `requestAnimationFrame` but only paints when 40 ms have passed since the last paint (`isUseInterval`; the mobile editor turns it off), so scrolling, zoom and the caret ran at 20 frames a second on a 60 Hz screen and about 24 on 120 Hz, while the toolbar, being plain DOM, felt quick. The desktop preload (`officePaintHook` in `apps/desktop/preload.cjs`) runs in the DocumentServer's frames before the editor's scripts and makes `isUseInterval` false for one second after each wheel, key, pointer press, drag or touch move, then true again. `nodeIntegrationInSubFrames` lets the preload reach those frames; sub-frames get no bridge (`office-paint.test.mjs`). The editor's bundle keeps property names (sdkjs `build/webpack.sdk.factory.mjs`, `mangle: false`), so the hook finds them by name.

Measured with sdkjs 9.3.8's own `WorkEvents.js` in an iframe of an Electron 44 window (xvfb, 60 Hz): idle 20 paints a second before and after; while scrolling 20 before, 59 after. Spreadsheets paint synchronously on scroll and were not capped.

## Not measured here

- Safari (iPad, iPhone): not available in this container. WebKit renders, composites and caches pictures differently; the changes keep to standard APIs and fall back where one is missing (`OffscreenCanvas`, `createImageBitmap`, `bitmaprenderer`).
- GPU rendering: devices with a GPU composite and keep decoded pictures on the GPU, so absolute numbers differ.
- Switching tabs in the desktop app: each tab is its own web view, shown and hidden by Electron, which this container cannot run with a display.
