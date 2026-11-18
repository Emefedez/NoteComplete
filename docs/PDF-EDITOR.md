# PDF editor mode

Owner's idea (2026-11-18): an **Edit PDF** mode like Master PDF Editor 4's *Edit Document*. Clicking a block of printed text in a PDF turns it into an editable text box, the same kind as the text boxes typed into notes today. It works in PDF-only documents and in mixed notes (PDF pages with ink, inserted pages and so on), without slowing the reader down.

**Status 2026-11-18:** Phases 0–2 are built and checked in Chromium (`tools/pdf_edit_e2e.mjs`), and the owner's choices are in: a double-click converts, the embedded font is used when possible, inserted PDF pages work too, and Save as PDF waits. What was built differs from the plan below in two places; see *As built*. Not yet tried in the installed desktop app.

## As built (2026-11-18)

- **Where the code is.** `crates/noteful-import/src/pdf_edit.rs` (interpreter, blocks, one-page copy, font programs and their cmaps). It lives in the importer module (`pkg/import`), which already carried `lopdf` for Goodnotes and is loaded only on first use. The engine everyone loads is unchanged; the importer grew from 2.0 to 3.1 MB. The reader side is in `apps/reader/pdf-edit.js` (tool, outlines, conversion) and `apps/reader/fonts.js` (registering PDF and imported fonts). The worker operations are `pdfBlocks`, `pdfWithout`, `pdfFont`, `pdfFontMissing`, `pdfEditClose` and the edit `replacePdfText`.
- **No new edit kind; the page gets a new background.** Instead of `Edit::HidePdfRuns` plus an incremental update at export, a conversion makes a **one-page copy of the PDF page without the block's text** and sets it as that page's background (`SetPageBackground` with the new PDF), followed by the text box with `joined`, so one undo takes back both. Raster, Find, thumbnails, collaboration and native export then work unchanged, and the original asset stays byte-exact for every other page. The cost is one small PDF per conversion: about 50 KB on the ISI statement, holding that page's fonts and images.
- **Fonts.** A block's font is used when the PDF embeds it as TrueType or OpenType, the program has every table a browser's sanitizer needs and a Unicode cmap, and every character of the block has a glyph (checked in Rust). The text box's font is then `<BaseFont> pdf<hash>`, and the reader registers that program under the name from the page's PDF whenever such a box is drawn, also after reopening the note. Otherwise the nearest built-in family is used (Helvetica, Times New Roman, Courier New). Type 1 and bare CFF programs use the nearest family.
- **Line spacing.** `TextBox.line_height` (native key 11, pool 10) carries the PDF's leading, and the core draws a line with its own line height at its true size and spacing. Lines without one keep Noteful's 15-unit minimum and 8-unit gap, so native notes draw as before.
- **Grouping.** Lines join a block when they have the same size and left edge (or centre, or right edge) and a steady leading. A gap of up to 2.3× the size is accepted only below a line that fills its column (book layouts); a line that ends short closes its paragraph.
- **Measured** (native build; the reader adds WASM overhead): ISI statement, 2 ms to read, 2 ms per page of blocks, 2 ms for the copy. STM32 book (9 732 objects), 21 ms to read. In the reader on the practice book: outlines in 92 ms, conversion in 84 ms.
- **Limits now.** A text box has one style, so bold or italic words inside a paragraph become the paragraph's style. Lines keep the PDF's line breaks (no reflow while typing). Rotated pages, rotated text, text in form XObjects and invisible OCR text are not offered. Encrypted PDFs that need a password are refused. Cover and retype (Phase 5) is not built.

`[D]` done · `[!]` done, not yet verified against the real app · `[ ]` to do

## What Master PDF 4 does, and what we take from it

Master PDF's edit mode outlines every text block and every object on the page. Clicking a block puts a caret into the PDF's own text. Saving rewrites the page's content stream, so the result is still a real PDF with real text. Objects (images, vector paths) can be selected, moved and deleted the same way.

For NoteComplete:

- **Take:** blocks outlined on hover; click to edit; the edited text ends up where it was, looking about the same; undo; and the result can be saved back as a PDF for PDF-only documents.
- **Change:** an edited block does not stay PDF text while you edit it. It becomes a normal NoteComplete **text box** (`crate::Image` with `text: Some(TextBox)`, `crates/noteful-core/src/imports.rs`), and the original glyphs are **hidden** in the PDF. Select, move, the format bar, undo, collaboration, native export and the Noteful app on the iPad then already work on it. The PDF changes only in one narrow way: text runs are taken out.
- **Later:** images and vector paths as objects (Phase 5).

## How the reader shows PDFs today (checked 2026-11-18)

- An opened `.pdf` becomes a native document (`Editor::create_document`, `imports.rs`): one page per PDF page, each with a PDF **background** (resource id + page index, tag 9) placed by `backgroundPlacement` (`apps/reader/pdf-background.js`). In mixed notes, any page can have such a background, at any scale and offset (`Edit::ResizePage` / `pdf_rect`).
- The reader rasterizes only visible PDF pages with pdf.js 6.3 (`pdf-background.js`, with a pixel budget and cache). Ink and items are SVG above it.
- `PdfBackgrounds.words()` already reads `getTextContent()` and maps each word into page coordinates for Find, the selectable text layer (`text-layer.js`) and AI context. `source-extract.js` already reads `getOperatorList()`.
- The Rust core runs in `worker.js` (WebAssembly) behind `engine.js`. It uses `pdf-writer` 0.15 to write PDFs (`page_pdf.rs`, raster export only). **`lopdf` 0.45 is already in `Cargo.lock`** (through `oblyx`, the Goodnotes import), so reading and changing PDFs adds no new dependency.
- Text boxes are drawn by the core (`text.rs`, `text_svg`) and edited in `text-box.js` (five font families, sizes, bold/italic/underline, colour, alignment, math).

## Spike (2026-11-18, native release build, M1 Max)

A throwaway program (`lopdf` 0.45, no default features) loads a PDF, decodes page 1's content stream, removes every text-showing operator (`Tj`/`TJ`), and writes the change as an **incremental update**: new objects plus a new xref appended after the original bytes, which stay untouched.

| PDF | Size | Objects | Load | Page 1 ops / text shows | Incremental save |
|---|---|---|---|---|---|
| Formula Student rules (text) | 7 MB | 960 | 3.7 ms | 1662 / 165 | 0.9 ms, +17 KB |
| STM32 book (text) | 2 MB | 9 732 | 21 ms | 366 / 24 | 0.3 ms, +4.6 KB |
| R Commander handout | 2 MB | 446 | 1.8 ms | 226 / 55 | 0.3 ms, +2 KB |
| Scanned (Fichero1) | 15 MB | 31 | 1.4 ms | 4 / 0 | 1.5 ms |
| "Examen wuolah" | 2 MB | 30 | 0.3 ms | 33 984 / **0** | 13 ms, +1.5 MB |

On the Formula Student page, `qpdf --check` passes on the result and `pdftoppm` draws it with the text gone and the logo kept. So the whole approach (find runs, drop them, append) works and costs milliseconds. Two lessons:

1. **Not every PDF has text to edit.** Scans have none, and some (the Wuolah exam) draw their text as vector outlines: 34 k path operators and no text operators. These need the fallback (OCR plus cover, below).
2. WebAssembly will be slower than these native numbers (likely 2–4×), and `lopdf` parses every object up front. This is still well within budget, but it must be measured in the worker on the owner's biggest note (Phase 0).

## Design

### 1. The mode

- A new **Edit PDF** tool beside Select and Text (toolbar, *Edit* menu, command palette, shortcut). It is enabled only on pages with a PDF background, so in mixed notes the blank pages and pages of only ink ignore it.
- While it is on, hovering a page shows faint outlines around its text blocks (one SVG layer per visible page, rectangles only). Clicking a block **converts** it: the text box appears in its place with the caret in it, and the format bar shows the detected font, size and colour. Esc or another tool leaves the mode. Converted blocks stay converted after that; they are ordinary text boxes.
- Text boxes the user converted are drawn by the normal item renderer, so leaving the mode changes nothing visually.

### 2. Finding text blocks (core, `pdf_text.rs`)

A new core module runs a small **content-stream interpreter** for one page. It follows the graphics and text state (`q`/`Q`, `cm`, `BT`/`ET`, `Tf`, `Tm`/`Td`/`TD`/`T*`, `Tc`/`Tw`/`Tz`/`TL`/`Ts`/`Tr`, fill colour operators) and emits a **run** for each text-showing operator (`Tj`, `TJ`, `'`, `"`):

```
Run { stream: u16, op: u32, origin: [f64;2], advance: f64, size: f64,
      font: String /* BaseFont */, rgba: [f64;4], render_mode: u8, matrix: [f64;6] }
```

- Advance widths come from the font's `/Widths` (simple fonts) or `/W` (CID fonts), with `Tc`/`Tw`/`Tz` and `TJ` kerning applied. This gives each run a box in PDF user space without rasterizing anything.
- **Text strings come from pdf.js**, which already handles every encoding, CMap and ToUnicode table. A pdf.js `getTextContent()` item's `transform` gives the same origin in the same user space, so runs and items are matched by origin (within half a point) and order. If nothing matches, `lopdf`'s own decoding is the fallback.
- Runs are grouped into **lines** (same baseline, same size, gaps under about one space), then **blocks** (lines with the same left edge or centre, the same font and a regular leading under 1.6× the size). This is the grouping `textLines` already does for the text layer, with the font and colour as extra conditions.
- Runs that cannot be seen are left out: render mode 3 (the invisible OCR text in scanned PDFs, which would hide nothing) and runs clipped away entirely.
- Runs inside **Form XObjects** (`Do` on a form) are reported but marked not editable in v1 (Phase 5 clones the form).

The worker returns only blocks for the requested page: `{ id, bbox, lines, text, font, size, rgba, runs: [stream, op][] }`. Blocks are cached per (PDF asset, page index). Nothing is computed until Edit PDF is on, and only for the visible page and the next one.

### 3. Converting a block

A new edit, committed **joined** with the text box it creates, so one undo takes back both:

```rust
Edit::HidePdfRuns { resource_id: String, page_index: u64, runs: Vec<(u16, u32)>, joined: bool }
```

- The text box gets the block's bounds, mapped through the page's PDF placement (the same mapping as `backgroundPlacement`), and:
  - **font:** the BaseFont name mapped to the nearest family, with weight and slant taken from the name (`Arial-BoldMT` → Helvetica, bold; `TimesNewRomanPS-ItalicMT` → Times New Roman, italic; `CMR10`… → see below). The subset prefix (`ABCDEF+`) is dropped.
  - **size:** the run's size × the text matrix scale, in page units.
  - **colour:** the fill colour (RGB, gray, CMYK converted).
  - **alignment:** left, or centre when the lines are centred.
  - **text:** the block's lines; wrapped lines of one paragraph are joined so the box wraps them again (`wrapText`).
- Editing part of a line converts the whole block, as Master PDF does. Narrower pieces (one word) are possible later, by splitting runs with `Tj`.
- **Font fidelity** is the visible weak point: the reader has five families. Add two cheaply: **Arial/Liberation Sans** (metric-compatible with Helvetica) and **Latin Modern / KaTeX Main**. KaTeX's fonts are already vendored, so LaTeX PDFs (`CMR`, `LMRoman`) look right. Using the PDF's **embedded** font (pdf.js loads it as a `FontFace`) is tempting, but embedded fonts are usually subsets missing the glyphs a user types. It is a later option, used only when every typed character exists in the subset.

### 4. Drawing the page with runs hidden

pdf.js keeps drawing the original PDF. For a page with hidden runs, the worker builds a **one-page PDF** from the asset: the page, its resources and a rewritten content stream without those operators. pdf.js draws that instead. It is small (that page's fonts and images only), cached by (asset, page, set of hidden runs), and rebuilt only when that page's conversions change. Other pages never notice.

This adds a variant to the raster cache key in `pdf-background.js`; quality, pixel budget and thumbnails work as they do now. Text search and the text layer must also skip hidden runs. Otherwise Find would hit words that are no longer drawn, and the text box's own text is already indexed as typed text.

### 5. Saving

- **`.nfedit`**: the edits are stored in history like any other (project version bump). They hold only run indices, not PDF bytes.
- **Native `.noteful` export**: an asset with hidden runs is written as **original bytes + incremental update** (new content streams for the changed pages, the changed page objects, an xref section and a trailer with `/Prev`). Untouched assets stay byte-exact, as now. Converted text boxes export as native kind-2 text, so the Noteful app shows and edits them too.
- **Save as PDF** (the Master PDF workflow, for PDF-only documents): a new *File → Save as PDF…* writes the source PDF + an incremental update in which:
  - hidden runs are removed (as above);
  - each text box becomes real PDF text (`BT … Tf … Tj … ET`) appended to the page's content. v1 uses the standard 14 fonts with WinAnsi encoding, which covers Spanish and Western European text. A box with other characters, or a non-standard family, gets an embedded TrueType subset (the `subsetter` crate with `pdf-writer`), which Phase 4 adds;
  - ink, shapes and images **optionally** go in as vector paths and image XObjects (a checkbox; off means a clean edited PDF and the notes stay in `.nfedit`).
  The current *Export pages as PDF* (JPEG pages, `page_pdf.rs`) remains for "what I see, flattened".

### 6. PDFs without editable text

Scans, text drawn as outlines (the Wuolah case) and Type 3 bitmap fonts: the mode says *"This page has no editable text"*. It offers **Cover and retype**, which uses the existing OCR (`ocr.js`, which already gives word boxes) to propose blocks. Converting one places a filled rectangle in the sampled background colour, plus the text box. Nothing is removed from the PDF, so the cover is an ordinary item that can be undone and moved. Master PDF does the same with its "white-out" when it cannot find text.

### 7. Performance budget

| Cost | When | Bound |
|---|---|---|
| `lopdf` parse of one PDF asset | first entry into the mode on a page of that asset; kept until the mode ends or the note closes | ms per MB (spike); measure on Memoria 1 in WASM |
| Interpreter + block grouping | per visible page, cached | < 10 ms on a dense page (target) |
| pdf.js text items | already fetched for Find when indexed; otherwise one `getTextContent` per page | as today |
| Hover outlines | one SVG `<g>` of rectangles per visible page; no per-frame work | — |
| One-page PDF + re-raster | only after a conversion, only that page | one extra pdf.js render |
| Export | incremental append per changed asset | spike: ~1 ms per page |

With the mode off, the only cost is code size. The new module is in the core, about 600–900 lines of Rust; `lopdf` is already compiled in for the importer, so the extra WASM is the interpreter.

### 8. Edge cases to handle explicitly

- Encrypted PDFs (owner password, no user password): reading works. Writing an incremental update must re-encrypt the new streams. In v1, conversion is refused with a clear message.
- Several pages that share one content stream, and pages with several content streams: runs are addressed as (stream, op), and the update writes a new stream per page.
- Rotated pages (`/Rotate`) and pages placed rotated in a note: blocks map through the same placement as the raster.
- Text clipped by a clip path, text in annotations (form fields), tagged PDFs (`BDC`/`EMC` around runs keep balanced when runs are dropped), `TJ` arrays that hold a whole line.
- `.nfedit` produced by collaboration: the new edit goes through `mutate()` like the others; guests receive the run list, and their reader builds the same one-page PDF.

## Phases

### Phase 0: spike in the app `[D]`
- [ ] Build the interpreter enough to list runs with boxes; expose `pdf_runs(asset, page)` from `noteful-wasm`.
- [ ] Measure parse + interpret in the worker on: Memoria 1, Temas1+2, the Formula Student rules, the STM32 book, a LaTeX PDF and a Word export.
- [ ] Check matching against pdf.js items on those PDFs (share of runs matched, by origin).
- **Go/no-go:** under 150 ms to the first outlines on the biggest asset; at least 98 % of visible text matched.

### Phase 1: outlines, read-only `[!]`
- [ ] Edit PDF tool, menu, palette entry; enabled only on PDF pages.
- [ ] Blocks (lines → blocks, font/size/colour) and hover outlines; a block's details in a tooltip (font, size).
- [ ] Tests: core unit tests on synthetic PDFs written with `pdf-writer` (simple font, CID font, `TJ` kerning, rotated page, form XObject, render mode 3); reader test for the outline layer.

### Phase 2: convert and edit `[!]` (a one-page background, not `HidePdfRuns`)
- [ ] `Edit::HidePdfRuns` (core, history, undo/redo joined, project version).
- [ ] Font/size/colour mapping; Arial/Liberation and Latin Modern families in `FONT_STACKS` and in the core's text measurement.
- [ ] One-page PDF rendering of pages with hidden runs; Find/text layer skip hidden runs.
- [ ] Browser check: convert a paragraph in a PDF-only document and in a mixed note (PDF page with ink, widened page), edit it, undo, redo, save `.nfedit`, reopen.

### Phase 3: native export `[!]` (the one-page PDF is an ordinary added PDF; not opened in Noteful yet)
- [ ] Incremental update of changed assets in `.noteful` export; byte-exact for untouched ones.
- [ ] Reopen the export in the reader; ideally confirm in the Noteful app on the iPad (owner).

### Phase 4: Save as PDF `[ ]`
- [ ] *File → Save as PDF…* for documents opened from a PDF: hidden runs removed, text boxes written as text (standard 14, then embedded subsets).
- [ ] Optional ink/shapes/images as vectors.
- [ ] Check with `qpdf --check`, pdf.js, Poppler and Master PDF 4 itself (open, select the new text).

### Phase 5: beyond text `[ ]`
- [ ] Cover and retype for PDFs without text (OCR blocks).
- [ ] Images (`Do` on image XObjects): select, move, delete, replace, as Master PDF's object mode.
- [ ] Text inside Form XObjects (clone the form per page).
- [ ] Embedded-font display when the subset has every glyph.
- [ ] Redact: the same removal, without a replacement text box, for blacking out text for real.

## Owner's answers (2026-11-18)

1. A **double-click** converts a block.
2. **Save as PDF** is not needed in the first version.
3. **Fonts:** ideally the embedded one; the nearest family is acceptable.
4. **Inserted PDF pages:** yes.
