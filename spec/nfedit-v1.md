# Noteful RE Project (.nfedit), versions 1–3

Our non-destructive UTF-8 JSON project format, not an official Noteful format. Required fields; unknown keys are rejected:

```json
{
  "format": "noteful-re-project",
  "version": 1,
  "source_base64": "...",
  "history": [
    {"kind":"Add","page":0,"line":{"points":[[10,10],[100,10]],"width":2,"rgba":[0,0,1,1],"tool":0,"layer":0}},
    {"kind":"Erase","page":0,"ids":["new:0"]}
  ],
  "cursor": 1
}
```

`source_base64` contains the complete, unchanged original archive using padded RFC 4648 Base64. Only history `[0,cursor)` is applied; the rest can be redone. A new action after undo truncates the redo branch. Undo/redo are global across pages.

`Add`: zero-based source page, fixed diameter `width`, normalized sRGB RGBA, page-space points, tool 0 normal or 1 highlighter, layer ID. Missing tool/layer default to zero for older v1 projects. One point is a disc; multiple points form a rounded polyline. The UI's shapes are point paths in this same representation, without pressure.

`Erase`: unique existing IDs supported by the whole-stroke eraser or explicit selected-item removal. Imported IDs are `stroke:N` / `object:N` at original collection indices before z-sorting; `new:N` is the Add action's history index. IDs are page-local. Hidden/locked layers cannot be erased interactively. Images/text/filled shapes are not whole-stroke eraser targets, but selectable objects can be removed explicitly.

`Layer`: `{ "kind":"Layer", "layer":{"id":1,"name":"Highlights","visible":true,"locked":false,"opacity":1} }`. Replaces a matching layer or appends a new layer. Applied in history order before subsequent drawing. Layer edits persist and are undoable. Older clients do not understand this added action and should reject it rather than silently omit it; current clients retain compatibility with earlier projects.

Validation: existing page/layer; 1–8192 finite points per gesture with coordinate absolute value ≤1e6; width 0.1–100; finite RGBA/opacity within 0–1; supported tool; nonempty layer name; valid history cursor and IDs. No global action/point or MB ceiling. Loading validates the entire history including redo before returning a session.

Saving a project never reconstructs the original archive. Native export is a separate flattening operation over applied edits and does not retain redo history. See [native writer](#native-export). No script/HTML from a project is executed.

## Shape metadata and corner edits

A line may have optional `shape` metadata: `{ "kind":"rectangle", "start":[100,100], "end":[200,200] }`. Supported kinds: line, rectangle, ellipse, triangle and arrow. The core derives canonical outline points; projects retain the control corners for later resizing. Older ordinary lines omit this field.

`Replace` is an undoable resize of an existing newly added shape: page, `id` (`new:N`) and replacement line. Kind, color, width, tool and layer must remain unchanged. The latest applied replacement supplies geometry for drawing, hit testing and export. Erased or locked shapes cannot be resized. `.noteful` export emits the current outline as native ink, so project-specific corner metadata is retained only in `.nfedit`.

## Item adjustments

`Adjust` extends v1 history for newly added lines/shapes and supported imported ink, native shapes, images and text placement:

```json
{"kind":"Adjust","page":0,"id":"stroke:0","adjustment":{"translation":[20,30],"scale":[1.5,1],"rotation":30,"width":4,"rgba":[0.2,0.4,0.8,1]}}
```

Translation, scale and rotation are required. `width` and `rgba` may be omitted or null to retain the original style; they apply only to ink and shapes. Translation is in page units, scale is along the original object's local axes, and rotation is in degrees relative to its original orientation. Scale and rotation use the original bounds center as pivot; translation follows. The latest applied adjustment replaces earlier adjustment parameters for that item, rather than accumulating rounded geometry. A previous `Replace` supplies the base geometry for legacy added shapes.

Validation requires finite translation within ±1e6, scale in 0.001–1000, rotation within ±36000, optional width in 0.1–100 and RGBA in 0–1. Target IDs must exist and remain visible, unlocked and undeleted at that point in history. Identity/repeated adjustments do not add an action. Each completed gesture or inspector change is one undo step. Current readers load older v1 histories; older readers must reject the unfamiliar `Adjust` action rather than silently omit it.

`locked` (optional boolean) locks the item in place (the Lock tool): a locked item cannot be picked, adjusted, resized, removed or erased. Omitted, it keeps the previous adjustment's value, else the item's own state (Noteful payload tag 21 for imported objects, unlocked otherwise). A change of `locked` is its own edit and must not change any other parameter. On native export an image's lock is written as payload tag 21 (type 0x801, clocked u8), as are objects that already carry that field; other object kinds use tag 21 for other values, and ink has no lock field, so their lock stays in the project only.

Native export transforms current geometry while retaining original imported IDs, audio timing and auxiliary stroke data. `.nfedit` keeps the unchanged source and complete edit history.

## Inserted pages (project version 3)

`InsertPages` adds pages before display position `at` (the page count appends), optionally with a PDF resource in the same undo step:

```json
{"kind":"InsertPages","at":2,"pages":[{"size":[2640,990],"pdf":{"resource":"pdf-1a2b","page_index":0,"rect":[0,0,1320,990]}}],"pdf":{"id":"pdf-1a2b","base64":"JVBERi0..."}}
```

Pages are addressed by stable **slots**: original pages keep `0..n`, inserted pages take `n, n+1, …` in history order (redo entries included), and every `page` field in the history is a slot. The display order is the original order with the applied insertions replayed, so ink drawn on a page stays on it when pages are inserted before it, and undo removes the inserted slots from the order without renumbering others. Without insertions slot and display position coincide, so v1/v2 projects are unchanged. Hosts convert display positions with `Editor::slot`; the WASM adapter does this for every page argument, and `view` reports both `page` (display) and `slot`.

`size` is in page units; `pdf.resource` names an existing PDF of the note or the edit's own `pdf.id`; `rect` places the PDF page (background tag 9) and defaults to the whole page. Validation: finite sizes of at least 10 units, at most 2000 pages per edit, PDF bytes starting with `%PDF-`, alphanumeric/hyphen IDs not already used. Projects containing `InsertPages` are written as version 3.

Native export writes inserted pages into the page collection (`d:/2`) with an editable-set ID when they have ink, background tag 0 = 1 plus tag 9 for PDF pages (blank pages use this project's paper JSON), and a tag-5 order key strictly between the display neighbours' keys, so sorting by that string reproduces the display order without changing existing page records. Added PDFs become ordinary resources. Official Noteful acceptance of these records is unverified.

## Text boxes (project version 4)

A typed text box is an `Image` edit whose image has empty `base64` and `mime` and a `text` object: `{"text":"Hola\nmundo","font_size":20,"rgba":[0.8,0,0,1],"bold":true}`. Its `bounds` are the box in page units (the reader measures the text: 5 units of left padding, first baseline at 8 + size, line advance size + max(8, size / 5 + 8)). It is drawn, picked, adjusted, locked and removed like an added image, with id `image:<history index>`.

```json
{"kind":"Retext","page":0,"id":"image:3","image":{"base64":"","mime":"","bounds":[100,100,120,40],"layer":0,"text":{"text":"Adiós","font_size":20,"rgba":[0,0,0,1],"bold":false}}}
```

`Retext` replaces a text box's content, style and size (its top-left corner stays). The target must be a live, unlocked text box on a visible, unlocked layer; text must not be blank (removing the box is an `Erase`), at most 20 000 bytes, font size 2–400. Projects using either are version 4.

Native export writes each text box as a kind-2 object with the field layout and wire types of `samples/texto.noteful`: rect `2/1` (float64 ×5), size pair `6/2`, and attributed text in `6/4` with fragments `[text, U+200B]`, counts `[5, 1]`, keys `[13, 10, 6, 2, 9, 10]` and pools 5 (family "Helvetica"), 6 (bold), 7 (color), 9 (paragraph) and 10 (sizes). Reopened, the core decodes the same text, size, color, weight and position.

## Page sizes (project version 4)

```json
{"kind":"ResizePage","page":0,"size":[1637,1543.46],"pdf_rect":[0,0,1091.34,1543.46]}
```

`ResizePage` sets a page slot's size. Ink, objects and text keep their page coordinates (the page grows or shrinks from its top-left corner). The PDF background keeps its rectangle unless `pdf_rect` (optional, only for PDF pages) gives a new one. Sizes must be finite, at least 10 units and within ±1e6; identical sizes add no action. Views report the current `size` and the page's `base_size` before resizes. Native export writes the size in background tag 1 and the PDF rectangle in background tag 9 (type 0x23, as on widened Noteful pages), so the PDF stays in place; inserted pages are written at their final size.

## Native export

`Editor::export_noteful()` and `EditorSession.export_noteful()` flatten the applied `.nfedit` history into a native `.noteful` archive. CLI: `noteful export project.nfedit > edited.noteful`. The source is never changed. With cursor zero, export returns the exact original bytes.

The writer retains unknown fields and every original resource. PDF, image and audio blocks remain byte-exact. Unadjusted surviving F101 records are copied without requantization, with their effective F102 style emitted explicitly. Removed imported ink is excluded from the stroke blob; deletion IDs/times are appended to the observed tombstone arrays. Removed selected objects leave the live object collection and update collection flags/clocks.

New pen/highlighter/shape-outline strokes use fixed width, normalized RGBA, tool 0/1, a collision-checked stroke ID, the selected layer and increasing z-order. Up to four points use direct float32 coordinates; longer strokes use per-axis float32 bounds and uint16 quantization. Maximum observed round-trip tolerance in the tests is 0.002 page units. New timestamps follow original clocks and all recordings, so new untimed strokes are not attached to old audio.

A page without an editable block receives one and its page/index references are updated. Layer metadata is updated with visibility, lock, opacity, name and order. All block offsets, lengths, index and trailer are rebuilt. The output is parsed again before being returned.

Regression coverage includes empty-note creation, imported stroke removal, straight-line object removal, new highlighter ink, five outline shapes, multiple layers, undo/redo cursor handling, preservation of every media resource, and reopening the output through Rust/WASM and the Python oracle.

**Interoperability is experimental.** Modified output has not yet been imported into the official Noteful app. Native CRDT merge behavior, tombstone semantics, layer flags and thumbnail invalidation require controlled native round-trip samples. The existing thumbnail is preserved and may remain stale until another app regenerates it. Newly drawn shapes export as stroke outlines. Adjusted imported shapes remain native parametric objects. No unsupported field is intentionally discarded, but byte preservation alone does not prove every application-specific invariant.

## Adjusted items

Color-only imported ink edits retain exact original F101 bytes and change the effective style. Geometry/thickness edits re-encode positions/radii while preserving the stroke ID, layer, z-order, start/end timestamps, flags and auxiliary data; thickness changes retain relative per-point radii. Existing recordings therefore keep their stroke associations. Imported shapes, images and text placement update their native geometry fields; supported shape stroke style updates in place. New items export their adjusted outline. Tests reopen these exports through the core and WASM and verify original audio/media bytes remain exact.
