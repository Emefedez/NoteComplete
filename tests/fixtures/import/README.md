# Import fixtures (synthetic)

These files are **synthetic**. They were built with the writers in the MIT-licensed
[oblyx](https://github.com/Coobyk/oblyx) crate (rev `bf005d5d6d16ccf116b6766a5ea31a387b6305cf`,
`src/goodnotes_write.rs` and `src/ntb_write.rs`). They are not exports from the Goodnotes or
Notability apps. Each one has been read back with the oblyx readers. Add real app exports next
to these files when we have some.

The generator post-processes the writer output in two ways:

- It pins every zip entry time to 2026-01-01 so the bytes are the same on every run.
- In `goodnotes-basic` it re-encodes the text box and the two shapes as kind-21 records. The oblyx
  writer's own kind-21 text and kind-9 shape records do not read back correctly.

Strokes, images, PDF backgrounds and the whole `.ntb` op log are unchanged writer output.

Coordinates and sizes below are in each file's own units. Goodnotes pages are always
1091.35 x 1543.5. Notability pages are in PDF points.

| File | Page | Size | Contents as read back |
|---|---|---|---|
| `goodnotes-basic.goodnotes` | 1 | 1091.35 x 1543.5 | 3 Stroke (black w2; red w4.5; yellow w18 alpha 0.4 highlighter), 1 Text ("Hello from a synthetic Goodnotes fixture", size 20), 2 Shape (Rect 100,650 300x150 light-blue fill, blue w3 outline; Ellipse centre 700,725 radii 120x75, green w2.5 outline) |
| | 2 | 1091.35 x 1543.5 | 1 Image (8x8 PNG, 98 bytes, at 200,200 160x160), 2 Stroke (blue w3; purple w1.5) |
| `goodnotes-pdf.goodnotes` | 1 | 1091.35 x 1543.5 | 1 PdfBackground (attached 2-page Letter PDF, page 1), 1 Stroke (red w2.5) |
| | 2 | 1091.35 x 1543.5 | 1 PdfBackground (same PDF, page 2), 1 Stroke (blue w2.5) |
| `notability-basic.ntb` | 1 | 595.28 x 841.89 (A4) | 3 Stroke (black w1.5; red w3; yellow w12 alpha 0x6B highlighter), 1 Shape (Rect 80,400 200x120 green fill, w2 outline), plus the reader's default grid Background |
| | 2 | 595.28 x 841.89 (A4) | 2 Stroke (blue w2; purple w4), plus the default grid Background |
| `notability-pdf.ntb` | 1 | 612 x 792 | 1 PdfBackground (asset `assets/<sha512>.pdf`, page 1), 1 Stroke (red w2.5) |

Limits of the writers:

- The `.ntb` writer always writes `pageCount = 1`, so a page can only use PDF page 1 as its background.
- The `.ntb` writer does not encode images, text or stickies.
- The `.ntb` reader keeps a stroke colour only when its alpha is 0xFF or 0x6B.
- The Goodnotes reader turns a fill alpha of 0 into 1. That is why the outline-only ellipse has
  no fill record and comes back with a pale tint of its stroke colour as the fill.
