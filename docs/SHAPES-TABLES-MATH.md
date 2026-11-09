# Shapes, tables, graphs and math

Plan and status for drawn-shape recognition, the star shape, tables, function graphs and
LaTeX text boxes (requested 2026-11-08). Each task lists its design, the files it touches and
how it is tested. Status: **done**, **in progress** or **planned**.

Every shape keeps every control it has today: Select moves it, the four corners resize it, the
round handle turns it, and the style row sets colour, width and fill. Nothing here removes or
narrows a control; recognised shapes are ordinary parametric shapes and get them all.

## Overview

| # | Task | Status |
|---|---|---|
| S1 | Star as a parametric shape (core, reader, picker, fill) | done |
| S2 | Shape recognition from a pen stroke (hold to snap, optional on lift) | done |
| S3 | Recognised shapes at an angle (rotation as an adjustment) | done |
| S4 | Two-stroke arrows and other multi-stroke shapes | planned |
| S5 | Settings: shapes from the pen on/off (View menu, Pen settings) | done |
| M1 | Math text boxes: LaTeX typeset by KaTeX (core flag, reader, export) | done |
| M2 | Math text boxes from the MCP (`write_on_page` `textbox` with `math`) | done |
| M3 | Math keypad and structured formula editing (MathLive), arrows | done |
| G0 | Empty graph preset: axes, grid and numbers to draw on (Insert → Graph) | done |
| G1 | Function graphs from LaTeX (`y = f(x)`) from the keypad | done |
| G2 | Editable graph (functions, ranges, grid, numbers; Edit graph) | done |
| P1 | Parts: graphs and tables as one object made of ordinary items | done |
| T1 | Tables: expandable grid of typed cells (Insert table, Edit table) | done |
| T2 | Tables and graphs from the MCP | planned |
| U1 | Text format bar docked in the tool bar (setting) | done |
| U2 | Shortcuts for actions without one | done |
| U3 | Tape stripes on iOS Safari | done (unverified on a device) |

## S1 Star

`ShapeKind::Star` (`crates/noteful-core/src/shape.rs`) is a five-pointed star, point up, that
fills the box from `start` to `end`: the regular pentagram's outline (inner radius 0.382) is
mapped from its own bounding box onto the drag, so its bounds are exactly the box and
resizing by the corners behaves like every other closed shape. It is closed, so it takes a
fill (the even-odd band fill in `ink::shape_fill` handles its concave outline). The reader's
`shapes.js` computes the same points; `CLOSED_SHAPES` there is the one list of shapes with an
inside. It exports as ink, like the other new shapes.

Tests: `crates/noteful-core/tests/filled_shapes.rs` (`a_star_fills_its_box…`),
`apps/reader/shape-recognize.test.mjs` (the JS points match the box).

## S2 Shape recognition

A pen stroke can become a clean shape: **line, arrow, rectangle/square, ellipse/circle,
triangle and star**.

- **Hold to snap** (default): draw the shape and keep the pen (or mouse button) still for
  about half a second before lifting. The stroke is replaced by the recognised shape at once;
  moving on before lifting resizes it from where it was snapped (the far corner follows the
  pen), as in Noteful and GoodNotes. Lifting keeps it.
- **On lift**: every pen stroke that is recognised with high confidence becomes a shape when
  the pen lifts (handwriting is rarely a clean closed shape, but this is opt-in).
- **Off**.

The setting is in the pen's options (beside pressure), remembered on the device
(`notecomplete-shape-snap`). It applies to the Pen tool only; the Shapes tool still draws
shapes by dragging.

Recognition (`apps/reader/shape-recognize.js`, pure and unit-tested) works on the stroke's
points in page units:

1. Too small (bounding box diagonal under 14 units) → nothing.
2. **Line**: end-to-end distance over path length ≥ 0.94. Angles within 6° of a multiple of
   45° snap to it.
3. **Arrow**: the point farthest from the start is the tip; the part up to it is straight
   (≥ 0.9), and the rest of the stroke (the head) is short, stays near the tip and behind it,
   and goes out to the side. One stroke: shaft, then the head without lifting.
4. **Closed shapes** (the ends meet within a quarter of the size): the convex hull's
   minimum-area rectangle gives the orientation and size; the stroke simplified
   (Douglas–Peucker) gives its corners; the turning of the simplified path tells a pentagram.
   - **Star**: a pentagram (corners turn about 720° in all) or an outline with about ten
     corners alternating far and near from the centre.
   - **Triangle**: three corners, or hull area about half its rectangle.
   - **Rectangle**: four corners and the stroke close to its rectangle's edges.
   - **Ellipse**: the stroke close to the ellipse inscribed in the rectangle.
   Rectangles and ellipses whose sides are within 13% of each other become squares and
   circles.

The result is `{kind, start, end, rotation}` in the shape's own frame. The reader draws it as
a normal shape (`line.shape`, pen colour and width, no fill), so it is selectable and
resizable like a shape drawn with the Shapes tool, but it does not switch to Select: writing
goes on.

## S3 Shapes at an angle

Shapes are axis-aligned boxes in the core. A rectangle, ellipse or triangle drawn at an angle
(more than 7° from level) is added level and then turned with an adjustment (`adjust` with
`rotation`, `joined` so one undo removes both). The core turns items about their bounds'
centre, which is the shape's centre, so the result is where it was drawn; the selection box
then shows the angle and the round handle turns it further. A triangle pointing down is drawn
with its box flipped (no rotation needed). Stars stay upright.

## S4 Multi-stroke shapes (planned)

Arrows are often drawn in two strokes (shaft, then head). Plan: when a short stroke ending
near a recent line's end (within 1.5 s and the head's size) is drawn, offer to join them into
an arrow (replace both with one `Arrow` shape, one undo step: an `Erase` and an `Add`,
joined). Same for a rectangle drawn as four lines. Needs `joined` on `Erase`.

## M1 Math text boxes

A typed text box can hold LaTeX: `TextBox.math = true` (`crates/noteful-core/src/imports.rs`,
serialised only when set, so older projects and boxes are unchanged).

- **Text**: the box's text is Markdown-style math: `$…$` inline and `$$…$$` display parts
  among plain words, as AI answers use. Text with no `$` at all is one formula
  (`\frac{a}{b}` alone typesets as a formula).
- **Reader**: the page's SVG has the box's plain text (the core does not typeset); after a
  page is drawn, `math-boxes.js` typesets each math box with KaTeX (already vendored, loaded
  only when a page has math) into a `foreignObject` over the box and hides the plain text. The
  formula is scaled down to fit the box when it is larger, so a box sized by the MCP's
  estimate never spills. Selecting, moving, resizing, rotating, locking, erasing and undo work
  as for any text box (it is one).
- **Editing**: the text format bar has a **∑** toggle; while typing, a live KaTeX preview
  shows under the box. Committing a math box measures the typeset formula and sizes the box
  to it.
- **Export**: Noteful has no math. The native text box gets the LaTeX source (with its `$`),
  so nothing is lost and it stays editable there; `.nfedit` and `.notecomp` keep the flag and
  reopen typeset. Page images made by the core (MCP `page_image`, thumbnails) show the source
  text, which an AI reads fine. A typeset picture in native exports is a possible follow-up
  (rasterise in the reader at export time).

## M2 Math from the MCP

`write_on_page` `textbox` items take `"math": true`: the text is LaTeX as above. The box is
sized from an estimate (formulas are about 0.6 of the text's characters wide) unless `w`/`h`
are given; the reader fits the formula into it. The MCP never draws math as ink: it is always
a typed, typeset text box. Documented in `docs/MCP.md`.

## M3 Math keypad and formula editing (done)

The keypad (`apps/reader/math-keypad.js`) is the app's own: its tokens, radii, menu surface and
shadow, stroke icons in its head, KaTeX-typeset key faces.

Decision changed after use (2026-11-09): editing raw LaTeX in a text box made it hard to change
a value inside a fraction or a power. A box that is one formula is now edited in a **MathLive**
`<math-field>` (`math-field.js`, MathLive 0.111.1, MIT, vendored by `tools/build_web.py`, about
850 KB loaded only when a formula is edited; its fonts are KaTeX's, already vendored): tap any
part to change it, arrows move through the structure, Backspace deletes whole pieces. MathLive's
menu and keyboard are hidden; the keypad sends it commands (`insert` with `#0`/`#?` places,
`moveToPreviousChar`, `moveUp`…). The text box keeps the LaTeX (the field writes it back on each
change). Words mixed with `$…$` stay as LaTeX text with the typeset preview under the box, and
the keypad's arrows step over whole commands there (`\frac` is one step) and jump between
empty places (↑ ↓).

- Shown while a math box (∑) is typed, docked at the bottom of the window and above an
  on-screen keyboard (visual viewport); the page scrolls so the box stays above it.
- Tabs: numbers and operations, functions, Greek letters, calculus and logic. Each key writes
  a template with the cursor in its first empty place; a selection goes inside it.
- Tab / Shift+Tab (and the |→ ←| keys) move between empty `{}`, `[]` and `()`; ⌫ deletes.
- Touch screens: the keypad replaces the system keyboard (`inputmode="none"`) until the
  keyboard key is pressed, as in Photomath. Keys keep the focus in the box (no blur, so the box
  never closes under a key press).
- The graph key: see G1.

## G0 Empty graph preset (done)

**Edit → Insert graph** (Shift X, command palette) puts axes with a grid and numbers in the
middle of the view, square cells, x from −5 to 5, to draw on by hand. The graph key with an
empty math box puts the same under the box.

## G1 Function graphs (done)

Decision: graphs are **ordinary items**, not a new object kind (`apps/reader/graph.js`):
grid lines and axes are `line` and `arrow` shapes, the curve is ink, numbers and axis names
are typed text boxes. They go in as one `drawMany` edit (a worker op: lines, then text boxes,
each `joined` to the one before, so one undo removes the graph; allowed for tablets in a
sharing session). Text boxes gained `joined` in the core for this. Consequences: no new
format to keep in step, every part is editable, and the `.noteful` export looks the same in
Noteful. The cost: changing the function later means drawing a new graph (G2).

Evaluation (`apps/reader/math-eval.js`, about 200 lines, no `eval`): `y = …` / `f(x) = …` /
a bare expression in x; numbers, π, e, + − · × ÷ /, powers (`x^23` is x²·3 as LaTeX sets
it), implied products, `\frac`, `\sqrt`, `\sqrt[n]` (odd roots of negatives are real),
`\sin` … `\tanh` with `^2` and `^{-1}`, `\ln`, `\log`, `\log_b`, `e^x`, `|x|`, `n!`. Other
input (another variable, an equation in x and y, an integral) is refused with a reason and the
box stays open to fix it.

Sampling: 481 points over x ∈ [−5, 5]; the y range covers 92% of the values (so poles do not
flatten the curve), padded, and includes the x axis when it is near; grid steps are 1, 2 or 5
× 10ⁿ. The curve is cut where it leaves the box (ending on its edge) or jumps (poles of
`1/x`, `\tan x`).

## P1 Parts (done)

Graphs and tables stay ordinary items (exported to Noteful as they look) but each item carries
`part: {id, kind, spec?}` (`crates/noteful-core/src/part.rs`, on `Line` and `Image`, serialised
only when set). The frame (a graph's plot rectangle, a table's border) carries the spec, as JSON
written by the reader, and is the object's box. The view lists `parts`; picking any part with
Select selects the whole object as a group (move, resize) titled Graph or Table with **Edit
graph…** / **Edit table…**, and Delete removes it in one step. Editing draws it again where its
frame is now: one `drawMany` with `replace` (an `Erase` of the old parts, then the new ones
joined to it), so one undo brings the old one back. `Erase` gained `joined`.

## G2 Editable graph (done)

The graph editor (`compound-dialogs.js`) has the functions (several, each its colour, typed
with the keypad, typeset beside), x from/to, y fitted to the curves or from/to, grid and numbers
on or off, and a live preview. It opens from Insert graph (Shift X), from the Shapes tool's Graph
(drag the box first), from the keypad's graph key in a math box (with that function), and from
Edit graph.

## T1 Tables (done)

`table.js` draws a table as parts (P1): its border (the frame, with the cells), rules between
rows and columns, a header band (highlighter under the ink, so the header's text shows), and a
typed text box per filled cell (bold in the header, math when it has `$…$`). The table editor is
a grid of cells: Tab and the arrows move, Enter goes down, Tab in the last cell or Enter in the
last row adds a row; buttons insert rows above/below and columns left/right of the cursor, or
delete them; Header row on or off. Up to 30 rows and 12 columns. Opens from Insert table
(Shift Y), the Shapes tool's Table (drag its box), and Edit table. Not yet: dragging a single
column's width on the page (widths are kept in the spec for it).

## T2 Tables and graphs from the MCP (planned)

`write_on_page` items `table` (`rows`: arrays of cell strings, `x`, `y`, optional widths) and
`graph` (`functions`: LaTeX, ranges). For graphs the MCP must sample the functions itself:
either a small LaTeX evaluator in Rust (polynomials, trig, exp/log, sqrt; enough for study
notes) or the MCP passes the sources and the reader samples them when the note opens.
Preferred: the reader samples, the core keeps the sources, so there is one evaluator.

## U1 Text format bar in the tool bar (done)

**View → Text format bar in the tool bar** (`notecomplete-text-format-docked`): the font,
size, bold, italic, ∑ and colour controls go into the tool bar's settings row (shown while a
text box is typed or a typed box is selected) instead of floating over the box. Undocked, the
floating bar now stays inside the window: it moves left near the right edge and wraps onto two
rows on phones.

## U2 Shortcuts (done)

Shift P page list, Shift G go to page, Shift I insert image, Shift B insert blank page,
Shift O OCR, Shift E export to Anki, Shift U lift all tape / cover again, Shift X insert graph.
They are in Help → Keyboard shortcuts, in the menus beside their items, and on the buttons
with **?**.

## U3 Tape stripes on iOS (done, unverified on a device)

The stripes were a pattern with the same id (`ncTape`) in every page's SVG, painted onto each
tape's copy by a CSS rule (`fill: url(#ncTape) !important`). WebKit resolves duplicate ids
and `url()` paints from style sheets unreliably. The reader now gives each page its own
pattern id and sets the copies' `fill`/`stroke` as attributes, and drops the rule
(`paintTapes` in `app.js`; thumbnails too). Checked in Chromium (stripes unchanged); needs a
check on an iPhone or iPad.

## Testing

- `node --test apps/reader/shape-recognize.test.mjs`: synthetic hand-drawn shapes (noise,
  rotation, overshoot) for each kind, and handwriting-like strokes that must stay ink. A sweep
  of 200 random variants per kind (scale 0.5–1.7×, ±30°) recognised 98–100% of each; of 300
  random scribbles one became an arrow (none in strict mode).
- `node --test apps/reader/{math-boxes,math-eval,math-keypad,graph}.test.mjs`.
- `node tools/shapes_e2e.mjs` (Chromium; `CHROMIUM=/path` uses a system browser): pen
  rectangle, turned triangle and its single undo, resize after the snap, scribble kept as ink,
  star with handles.
- `cargo test -p noteful-core --test filled_shapes --test math_text`.
- `cargo test -p noteful-cli` for the MCP `textbox` with `math`.
- In the reader: draw each shape and hold; check the selection handles, rotation, undo (one
  step), export and reopen.
