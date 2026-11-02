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

## Not measured here

- Safari (iPad, iPhone): not available in this container. WebKit renders, composites and caches pictures differently; the changes keep to standard APIs and fall back where one is missing (`OffscreenCanvas`, `createImageBitmap`, `bitmaprenderer`).
- GPU rendering: devices with a GPU composite and keep decoded pictures on the GPU, so absolute numbers differ.
