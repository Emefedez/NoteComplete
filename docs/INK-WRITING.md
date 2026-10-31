# Writing real Noteful ink from Markdown

Design and implementation plan for turning Markdown, SVG and page designs into editable
Noteful handwriting, and for annotating existing pages, inside NoteComplete's Rust core.

Status: **design, not implemented**. No code in this document has been written yet.
Reference implementation studied: [`openninoor/noteful-mcp`](https://github.com/openninoor/noteful-mcp) (MIT).

---

## 1. What this adds

NoteComplete today can open, edit and export `.noteful` files, and its MCP server can read a
notebook and write Markdown notes beside it. It cannot *write ink*. This plan adds:

| Capability | Result in Noteful |
|---|---|
| Markdown → notebook | New pages whose text is real, editable handwriting strokes |
| Markdown → existing notebook | New pages inserted at the end or after page N |
| Annotate an existing page | Text, ticks, circles, arrows, highlights, tape over existing ink |
| Study look | Titles, cards, columns, colour zones, sticky notes, stats, tree diagrams |
| SVG → ink | Diagrams drawn as pen and highlighter strokes, not pasted images |
| Copy a page design | Layout read from a mockup picture and rewritten in ink |
| In-app conversion | Markdown/`.md` → `.noteful`, then existing export to PDF, PNG, SVG |

Everything is produced as ordinary pen, highlighter and tape strokes. The result stays
editable on the iPad: the user can erase it, recolour it, lasso it and move it.

Non-goals for the first release:

- Typed text boxes instead of ink (Noteful text boxes are a different record type).
- OCR or handwriting recognition.
- Writing into a live iCloud library. NoteComplete has no macOS/Noteful-for-Mac bridge; it
  writes files. MCP tools therefore write **copies**, never the open note.
- Reproducing Noteful's exact pen engine. We reproduce the *wire format* faithfully and
  approximate the hand.

---

## 2. Version baseline (verified 2026-10-31)

This matters because the reference project is a beta and its format target differs from the
files in `samples/`.

### 2.1 The reference snapshot is current

| Item | Value |
|---|---|
| Local snapshot | `work/noteful-mcp-ref` (shallow clone) |
| HEAD | `175e8d7c5389a9505d0b9fca9082e69b0179b648` |
| HEAD date | 2026-10-26 21:03 +03:00 |
| Commit subject | `Read text files as UTF-8 on every platform` |
| GitHub `main` HEAD on 2026-10-31 | same SHA (`175e8d7`) |
| Project version | `1.0.0b1` (`pyproject.toml`, `CHANGELOG.md`) |
| Latest release | `v1.0.0b1`, 2026-10-26 |
| Repository history | 15 commits, all 2026-10-25/26 |

Conclusion: the downloaded copy **is** the latest GitHub build. There is no newer release and
no divergence. Two caveats:

- The clone is **shallow** (`git rev-parse --is-shallow-repository` → `true`). Before relying
  on it again, run `git fetch --depth=1 origin main` and compare `git rev-parse HEAD`.
- Pin the **commit**, not the version. `1.0.0b1` is a single beta tag covering all 15 commits;
  anyone who cloned before `cf3748e` (pressure variation) or `e8008b6` (design tools) has the
  same version number and a different feature set.

### 2.2 Format versions do not match

Three different package versions are in play:

| Source | Index tag 1 (`f32`) | Notes |
|---|---|---|
| `noteful-mcp` writer | **1.2** | `container.py`: "package format version (1.2)"; README targets Noteful 1.4.x |
| NoteComplete samples | **1.19 / 1.21** | `samples/*.noteful`, saved by a recent Noteful |
| NoteComplete `Editor::create_document` | **1.0** | `imports.rs` writes `f(1, 3, V::Float(1.))` |

Our reader accepts all of them, but **we have never verified that Noteful imports a file we
wrote**, and upstream does not claim support for 1.21. Treat this as the first implementation
gate, not an assumption.

Decisions:

1. **Editing an existing file preserves its version.** `export_noteful` already keeps the
   source index; do not rewrite tag 1.
2. **New files get an explicit version.** Add `DocumentOptions::format_version`; keep `1.0`
   as the default until the compatibility spike (Phase 0) says otherwise, then change the
   default to whichever version Noteful accepts. `1.2` is the leading candidate because it is
   the only version with field reports from upstream users.
3. **Never emit a version we have not tested.** The spike matrix is `1.0`, `1.2`, `1.19`,
   `1.21` × paper strategy.

### 2.3 What is portable from the reference

The reference is Python 3.12 with NumPy/Pillow/PyMuPDF. We are **not** shipping it as a
sidecar and not translating it line for line. We port:

- the byte layout of ink (already decoded in `stroke.rs`; writing is new),
- glyph outlines and the handwriting model (pure geometry),
- the Markdown dialect and layout rules,
- the SVG→ink rules,
- the study themes,
- shapes, highlighter and tape geometry.

Fonts are SIL Open Font License 1.1 (`OFL.txt`, `OFL-PatrickHand.txt`, `OFL-Caveat.txt`);
they are redistributable with attribution. Upstream code is MIT; keep its copyright notice in
a `NOTICE`/module header when algorithms are ported.

---

## 3. Where we are, and the gap

| Feature | NoteComplete today | `noteful-mcp` 175e8d7 |
|---|---|---|
| New notebook from Markdown | No (MCP writes `.md` notes only) | `create_notebook` |
| Add handwritten pages | No | `add_pages`, `clean_copy` |
| Annotate existing page | Editor UI can, API only `add_line` | `write_on_page` (13 item types) |
| Pressure strokes | Decodes them; **writes constant width** | Writes per-point pressure |
| Highlighter under ink | Decodes/render order; additions append on top | `under` stroke list |
| Handwriting fonts | None | 7 SVG fonts, 3 hand presets |
| Greek/math glyphs | None | 35 hand-drawn extras + super/subscript |
| Study look | None | Themes, cards, columns, zones, sticky, stats, maps |
| SVG → ink | None | `svgink` (shapes, paths, text, pastel fills) |
| Copy a page design | None | `design_mockup`, `mockup_grid`, `design_page` |
| Raster trace | None | `trace.py` (needs NumPy/OpenCV-ish extras) |
| Live library | No | Yes (macOS) |
| PDF export | Yes (`page_pdf`) | Yes |

The wire-format foundation is in place:

- `Editor::create_document` builds a valid package (title block, document block, page records).
- `Editor::insert_pages` inserts pages with an optional PDF background.
- `Editor::add_line` + `export_noteful` appends strokes and rewrites the page's editable layer.
- `Stroke` already decodes per-point radii, pressure flag, eraser mask and tape flag.
- `scene.rs` already renders variable-width strokes.

The missing pieces are (a) pressure on write, (b) an ordering path for under-ink strokes,
(c) geometry/fonts/layout, (d) MCP contracts.

---

## 4. Architecture

### 4.1 Module layout

New code lives in the core so the desktop app, CLI and WASM all get it:

```
crates/noteful-core/src/ink/
    mod.rs        public options, page specs, composition entry points
    font.rs       SVG font parser -> Font/Glyph, cached
    glyphs.rs     Greek/math extras, fallbacks, super/subscript scripts
    hand.rs       Pen, TextStyle, noise, resample, pressure, text and shapes
    compose.rs    Markdown -> PageSpec (pagination, columns, directives)
    study.rs      study themes and block renderers
    svg.rs        SVG document -> strokes + under-strokes
    paper.rs      generated paper PDF (blank/dot/grid/ruled, light/dark)
    design.rs     optional: mockup spec -> strokes (feature "design")
crates/noteful-core/assets/fonts/
    PatrickHandLine.svg, CaveatLine.svg, PatrickHandBlock.svg,
    EMS*.svg, OFL*.txt
crates/noteful-cli/src/mcp.rs        new write tools (Phase 6)
crates/noteful-cli/src/mockup.rs     optional image grid / image model (Phase 7)
crates/noteful-wasm/src/lib.rs       create_handwritten_document (Phase 8)
docs/MCP.md                          user-facing tool docs (Phase 6)
```

`noteful-core` is `#![forbid(unsafe_code)]` and deliberately has no filesystem, UI, network or
platform APIs. Keep it that way:

- Fonts are embedded with `include_str!`; no runtime file access.
- Paper PDFs and SVG parsing are pure computation.
- The optional image model (`design_mockup`) and PNG grid overlay live in the CLI, not in core.
- Raster tracing is a Cargo feature (`design`) enabled for native builds and **off** for WASM.

### 4.2 New dependencies

| Crate | Use | Size/risk |
|---|---|---|
| `roxmltree` | Parse SVG fonts and SVG drawings | small, pure Rust |
| `svgtypes` | Path data parser (`M L C Q A Z`, relative forms) | small, pure Rust |
| `rand` + `rand_chacha` | Deterministic seeded hand jitter | small; `ChaCha8Rng` is reproducible |
| `image` | Optional: decode mockups, encode grid PNG, raster trace | medium; **CLI/native only** |
| `ureq` | Optional: call the image model for `design_mockup` | CLI only, behind `design-ai` feature |

No PDF crate is needed for paper: `pdf-writer` is already a dependency and can produce vector
pages. A textured/grain paper would need JPEG encoding; skip texture in v1 and use vector
paper (ivory/black fill + dots/lines), which is what a reader sees at normal zoom.

### 4.3 Data-model changes

#### `Line` gains pressure

```rust
pub struct Line {
    pub points: Vec<[f64; 2]>,
    pub width: f64,
    pub rgba: [f64; 4],
    #[serde(default)]
    pub tool: u16,
    #[serde(default)]
    pub layer: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<crate::Shape>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub square: bool,
    /// Pen pressure per point, 0..=1, same length as `points`.
    /// Present only for ballpoint-style strokes; fineliners and highlighters omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pressure: Option<Vec<f32>>,
}
```

Rules:

- Ballpoint: `pressure` present, `width` is the nominal thickness (exported as half-width) and
  is ignored by Noteful's renderer; actual thickness ≈ `2.1 × pressure`.
- Fineliner: `pressure` absent, `width` is the full thickness; Noteful draws `2 × (width / 2)`.
- Highlighter (`tool == 1`): never pressure; `width` is the full band height.
- Tape (`tool == 2`): never pressure; `width` is the full strip width.
- `add_line` rejects `pressure.len() != points.len()`, non-finite values, or values outside
  `0..=1`. Existing `points <= 8192` and width limits stay.

#### Under-ink ordering

Highlights must be drawn before the ink they mark. Put the hint on the line rather than on
`Edit::Add`, so the edit enum (which uses `deny_unknown_fields`) does not change:

```rust
pub struct Line {
    // ...
    /// Draw below the page's other ink. Set by `add_line_under`; highlighter fills only.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub under: bool,
}
```

`Line` does not use `deny_unknown_fields`, so older `.nfedit` readers ignore the new field and
newer readers default it to `false`. Public API:

```rust
pub fn add_line(&mut self, page: usize, line: Line) -> Result<()>;          // unchanged
pub fn add_line_under(&mut self, page: usize, line: Line) -> Result<()>;    // sets under
pub fn add_lines(&mut self, page: usize, lines: Vec<Line>) -> Result<()>;   // one undo step
```

Export partition, per page:

1. under-additions, in insertion order;
2. existing decoded strokes (when inserting into a file);
3. normal additions, in insertion order.

Why not rely on the stroke's `z` header? We do not know whether Noteful sorts by it; upstream
does not, and its rendering matches the app by stream order. Do not invent semantics.

When under-additions exist on a page with existing ink, `export_noteful` must **prepend** a
style record + under strokes before the existing blob, then keep the existing blob and append
the rest. When there are none, keep today's append-only path so untouched ink stays
byte-identical. This is the only place that rewrites existing ink bytes; guard it with a
round-trip test.

#### Pressure encoding in `new_stroke`

```
[f1 01][id u64][flags u16][clock u64][clock2 u64][z u64]
[layer u32][radius f64][0 u32][count u32]
n <= 4:  n × (x f32, y f32[, pressure f32])
n >= 5:  for each dimension: (min f32, range f32)
         then n × (x u16, y u16[, pressure u16])
```

`flags` bit 0 = pressure present. With pressure, `radius` is still written (use `width / 2`)
but ignored by the app. Normalise pressure with the same min/range scheme; an all-equal
pressure column encodes as `range = 0` and zeros, which decodes to the minimum — acceptable,
but avoid it by never emitting a flat pressure profile for a ballpoint.

#### Preview and export

- `scene::line_svg` currently takes one radius. Add `line_svg_variable(points, radii, rgba)`:
  emit a filled variable-width ribbon, or circles at each point when the segment is short.
  Use the same helper for SVG export so the desktop preview and exported SVG agree.
- Decoded strokes already use circles per point (`stroke_svg`/`run_svg`). Leave that path
  alone for now; a ribbon is a later quality improvement.
- `Editor::additions()` order is preserved; the preview already draws additions after
  existing items, so under-additions will preview on top unless the scene layer also
  partitions. Add the same partition in `scene.rs` so preview matches export.

#### Document creation options

```rust
pub enum PaperStyle {
    Blank,
    Dotted { spacing: f64 },
    Grid { spacing: f64 },
    Ruled { spacing: f64 },
    Dark(Box<PaperStyle>),          // black page, light pattern
    Json(PaperTemplate),            // Noteful's own JSON template (pc/lt/lh/lw)
    Pdf { id: String },             // caller-supplied background
}

pub struct DocumentOptions {
    pub title: String,
    pub sizes: Vec<[f64; 2]>,
    pub pdf: Vec<u8>,
    pub paper: PaperStyle,
    pub format_version: f32,
    pub created: Option<i64>,   // Apple epoch µs; None = now
}

pub fn create_document_with(options: &DocumentOptions) -> Result<Self>;
pub fn create_document(title: &str, sizes: &[[f64; 2]], pdf: &[u8]) -> Result<Self>; // wrapper
```

`NewPage` gains `paper: Option<PaperStyle>` so `insert_pages` can give inserted pages a paper
background. The generated paper PDF is added as one `NewPdf` resource with one page per
distinct style, matching the upstream approach (one PDF, `tag 3` = style index).

### 4.4 Paper strategy

Two mechanisms exist:

- **JSON paper** (`background tag 0 = 2`, `tag 6` a JSON string):
  `{"pc":16777215,"lt":2,"lh":24,"lw":0.5,...}` for grid, `{"lh":16,...}` for ruled,
  `{"pc":...}` for blank. This is what Noteful itself stores, it is tiny and editable.
  Our `create_document` writes `{"pc":16777215}` with `tag 0 = 0`.
- **PDF paper** (`background tag 0 = 1`, `tag 3` = page index, `tag 4` = file id): what
  `noteful-mcp` writes. Proven to import, supports dark pages and texture, costs a PDF.

Plan:

1. Implement `paper.rs` to generate vector PDFs for blank/dot/grid/ruled, light and dark,
   A4 at 595.28 × 841.89 pt.
2. Make **PDF paper the default for new notebooks**, because it is the only path with field
   reports.
3. Keep JSON paper as `PaperStyle::Json` for small files and spike it; switch the default if
   it imports reliably (it would make files much smaller and let Noteful restyle them).
4. Never mix: a page has one background record.

### 4.5 Font pipeline

`font.rs` parses SVG fonts (`<font-face>`, `<missing-glyph>`, `<glyph unicode d horiz-adv-x>`):

```rust
pub struct Font {
    pub name: String,
    pub units_per_em: f64,
    pub ascent: f64,
    pub descent: f64,
    pub x_height: f64,
    pub glyphs: HashMap<char, Glyph>,
}
pub struct Glyph { pub advance: f64, pub contours: Vec<Vec<[f64; 2]>> }

pub fn load(font: FontChoice) -> &'static Font;   // LazyLock cache
```

Font choices and intended use:

| Key | File | Use |
|---|---|---|
| `patrick` | `PatrickHandLine.svg` | default body and titles |
| `caveat` | `CaveatLine.svg` | cursive accents, alternate body |
| `block` | `PatrickHandBlock.svg` | caps headings without faking small caps |
| `readability` | `EMSReadability.svg` | very legible |
| `felix`, `allure`, `elfin`, `nixish` | `EMS*.svg` | styles offered to agents |

Path parsing: implement a flattener over `svgtypes::PathParser` supporting `M m L l H h V v
C c S s Q q T t A a Z z`. Convert arcs to cubics, adaptively flatten to ≤ 0.6 page-unit
segments, then resample.

Shaping (`hand.rs`):

- `TextStyle { font, size (x-height in page units), slant, letter_jitter, baseline_drift,
  tracking, line_height, distortion }`.
- Hands: `neat` (0.05/0.04/0.05/0.03), `natural` (0.10/0.08/0.10/0.07), `messy`
  (0.15/0.14/0.20/0.12) for slant/jitter/drift/distortion.
- Per glyph: shear by slant, jitter x/y, apply low-frequency value-noise distortion to
  contour points, rotate slightly around the baseline, advance by `advance × tracking`.
- Fallbacks: substitute `− – ’ ‘ …`, try NFD base letter (so `é` uses `e`), then
  `glyphs.rs` extras, then `missing-glyph`, then skip with a warning.
- Scripts: superscript/subscript are marked with private sentinels by `glyphs::scripts`,
  then written at 0.62× size with a raised/lowered baseline.
- `write_line`, `write_block` (wrapping by measured width), `text_width`.
- Shapes: `line`, `arrow`, `rect(radius)`, `ellipse`, `underline(double)`, `checkmark`,
  `star`, `divider`, `highlight_line`, `highlight_rect`, native `tape_strip`.
- Pen: `width`, `pressure`, `fineliner`, `seed`; `stroke(points, step, smoothing, tremor)`.
  Resample at ~2.2 units, Chaikin smooth, add tremor noise, then:
  - fineliner → no pressure, `width = thickness × 1.05 / 2`;
  - ballpoint → pressure profile with ramp-in/ramp-out, scaled so
    `thickness = width × 1.3` and stored pressure ≈ `thickness / 2.1`.

Determinism: `ChaCha8Rng::seed_from_u64(seed)`; every page records its seed. Same seed and
inputs must produce byte-identical pages (test).

Glyph extras: port the 35 hand-drawn glyphs from `glyphs.py`:
`° ± × Δ Σ Φ Ω α β γ δ ε η θ λ μ π ρ σ τ φ ψ ω ∂ ∑ √ ∝ ∞ ∫ ≈ ≠ ≤ ≥`.
Also add the arrows the Markdown layer needs: `→ ← ⇄ ⇒`.

### 4.6 Composition and pagination

```rust
pub struct ComposeOptions {
    pub paper: PaperStyle,
    pub ink: Rgba,
    pub accent: Accent,
    pub font: FontChoice,
    pub size: f64,
    pub hand: Hand,
    pub pen: PenKind,
    pub look: Look,          // Classic | Study
    pub theme: Theme,        // Light | Dark
    pub seed: u64,
}
pub struct PageSpec {
    pub lines: Vec<Line>,        // normal ink
    pub under: Vec<Line>,        // highlighter / fills
    pub images: Vec<ImageSpec>,  // reserved; v1 emits none
    pub paper: PaperStyle,
    pub warnings: Vec<String>,   // "text overlaps at ...", "unsupported SVG ..."
}
pub fn compose(markdown: &str, options: &ComposeOptions) -> Result<Vec<PageSpec>>;
```

`Composer` keeps `x0/x1/y`, a column stack, and a pagination callback. Blocks are measured
before drawing so a block that does not fit moves to the next page; `\pagebreak` forces a
break. A page is A4 (`1091.34 × 1543.46`), margins ~86 units, baseline grid from the paper
style. `!columns` pushes a column context; each column is a nested composer with its own
cursor and page-height budget; the outer page height is the max of the columns.

Warnings are returned to the agent (and shown in the app) rather than failing: overlapping
text and unsupported SVG features are recoverable.

### 4.7 Study look

Port the two themes and block renderers:

- Light: ink `#1f2233`, grey `#6b6f80`, shadow `#d9cfc0`, accents coral/amber/sky/purple/
  teal/pink.
- Dark: ink `#f4f1ea`, grey `#a3a3ad`, shadow `#3a3a40`, neon accents.

Blocks:

- **Title**: block capitals, optional `**word**` in accent colour, offset shadow strokes,
  stripe bars; `# A // B` for a two-line title on a marker band; `:icon:` doodles
  (heart, sun, star, atom, drop, bolt, cloud, leaf) drawn as strokes.
- **Subtitle**: `_text_`, with a thin rule.
- **Heading (##)**: caps on a rule to the page edge, accent rotates per section, max 3
  accents per page.
- **Label (###)**: small caps.
- **Body**: mixed case, felt-tip (fineliner) by default, `**bold**` in accent,
  `==highlight==` under-ink, `[[tag]]` pill, `((detail))` grey.
- **Cards**: `> [sky] TITLE: text`; fills are highlighter bands, outlines are sketched rects;
  `>> A: ... || B: ...` lays two cards side by side.
- **Columns**: `!columns [60]`, `!col`, `!end`.
- **Zone**: `!zone [sky]` … `!end`, full-width pale band behind the content, drawn under.
- **Sticky**: `!sticky [yellow] TITLE: text`, taped, slightly rotated.
- **Stat**: `!stat 30 reflected (albedo)`, big coloured number and label.
- **Map**: `!map TOPIC | question?` then indented `- BRANCH` / `  - leaf`; draws a tree with
  sketched connectors.
- **Rule**: `---`.
- **Draw**: `!draw [width] <svg>…</svg> !end`; delegates to `svg.rs`.

Do not reproduce the rejected style patterns documented upstream (bubble titles, all-caps
body, a colour per section, pill clutter, stacked full-width boxes).

### 4.8 Touch points in existing files

| File | Change |
|---|---|
| `crates/noteful-core/src/editor.rs` | `Line.pressure`, `Line.under`; `add_line` validates pressure; `add_line_under`, `add_lines`; `additions()` unchanged; replay of `Edit::Add` unchanged |
| `crates/noteful-core/src/export.rs` | `new_stroke` emits 3-value pressure points and `flags = 1`; per-page stable partition; prepend path for under strokes; `create_document` wrapper |
| `crates/noteful-core/src/scene.rs` | Preview partition (under first); `line_svg` variable width for `Line.pressure`; page previews unchanged for decoded strokes |
| `crates/noteful-core/src/imports.rs` | `DocumentOptions`, `create_document_with`, paper PDF block, `format_version`, page record `tag 0 = 1` for PDF paper |
| `crates/noteful-core/src/pages.rs` | `NewPage.paper: Option<PaperStyle>`; `blank_page` writes the paper background |
| `crates/noteful-core/src/manipulation.rs` | `adjusted_line` scales pressures with width (otherwise moving/resizing changes apparent thickness) |
| `crates/noteful-core/src/lib.rs` | `pub mod ink`, re-export `PaperStyle`, `ComposeOptions`, `compose` |
| `crates/noteful-core/Cargo.toml` | `roxmltree`, `svgtypes`, `rand`, `rand_chacha`; optional `image`, `ureq` |
| `crates/noteful-cli/src/mcp.rs` | New tools, schemas, resources, prompts, `page_layout` |
| `crates/noteful-cli/Cargo.toml` | `image` (PNG grid), optional `ureq` |
| `crates/noteful-wasm/src/lib.rs` | `compose_markdown`, `create_handwritten_document` |
| `docs/MCP.md` | Write tools, output folder, safety, examples |
| `spec/noteful-v0.1.md` | Phase 0 compatibility results |

`manipulation.rs` detail: if `a.width` is set and `line.pressure` is present, scale each
pressure by `new_width / old_width` and clamp to `0..=1`; if the line has no pressure, keep
today's width-only behaviour. Point transforms and colours are unchanged.

---

## 5. Markdown dialect

One block per line. This is a superset of CommonMark chosen for handwriting layout, not a
CommonMark parser.

| Input | Result |
|---|---|
| `# TITLE` | study title (caps, shadow, accent word with `**`) |
| `# A // B` | two-line title, second line on a marker band |
| `_subtitle_` | subtitle + rule |
| `## Section` | section heading |
| `### Label` | small label |
| plain line | body paragraph |
| `**term**` | accent-coloured term |
| `==phrase==` | highlighter under the phrase |
| `[[tag]]` | pill |
| `((detail))` | grey secondary text |
| `- item`, `* item`, `1. item` | dot / star / circled-number item |
| `-> item` | arrow item |
| `[ ] item`, `[x] item` | empty / ticked checkbox |
| `> [sky] TITLE: text` | card |
| `>> A: text \|\| B: text` | two cards side by side |
| `!columns [60]`, `!col`, `!end` | columns |
| `!zone [sky]`, `!end` | colour zone |
| `!sticky [yellow] TITLE: text` | sticky note |
| `!stat 30 label` | statistic |
| `!map TOPIC \| question?` | tree diagram |
| `!draw [width] <svg>…</svg> !end` | SVG diagram |
| `!tape [mint]` | tape strip over the next block |
| `---` | thin rule |
| `\pagebreak` | forced page break |
| `{color:red} text` | explicit line colour |

Science: Greek letters, `T^4`, `m^{-2}`, `CO_2`, `→ ⇄ ≈ ± °` are all supported through
glyph fallbacks and scripts. `look: classic` uses a plain notebook layout (headings, bullets,
paragraphs) with none of the study decoration.

---

## 6. SVG → ink

```rust
pub struct Drawing { pub lines: Vec<Line>, pub under: Vec<Line>, pub warnings: Vec<String> }
pub fn drawing(svg: &str, frame: [f64; 4], pen: &Pen) -> Result<Drawing>;
```

Frame is `[x, y, width, height]` in page units; height defaults to width × viewBox aspect.

Supported:

| SVG | Ink |
|---|---|
| `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` | pen outlines |
| `path` (M L H V C S Q T A Z, absolute and relative) | pen polylines |
| `g` with `transform` (translate/scale/rotate/matrix) | inherited transform |
| `viewBox`, `preserveAspectRatio` (default meet) | fitted to frame |
| `fill` (solid colour) | highlighter fill under the outline |
| `stroke`, `stroke-width`, `fill="none"` | pen colour and width |
| `text` | handwriting at `font-size`, mapped to the selected font |
| `style="fill:#...;stroke:#..."` on any element | parsed subset |

Approximated or rejected (with a warning, never silently wrong):

- gradients, patterns, filters, masks, clip paths — ignored;
- embedded `image`, `use`, `marker`, `textPath` — skipped;
- CSS stylesheets/classes — only inline `style` and presentation attributes;
- `stroke-dasharray` — drawn solid;
- opacity — mapped to the pen alpha;
- very large path counts — capped (see limits).

Pastel palette for fills: `#ffb48a #8fc3ff #c9b6ff #9fe3c4 #ffe066 #f4a3a3`, dark outline.

---

## 7. MCP tool contracts

Existing tools (`list_notes`, `note_outline`, `page_text`, `page_image`, `search_note`,
`extract_resource`, `read_notes`, `write_notes`, `write_anki_deck`) stay unchanged — the first
seven are read-only, the last two write Markdown notes and Anki decks. New tools follow the
same stdio JSON-RPC server in `crates/noteful-cli/src/mcp.rs`.

Parity with upstream:

| `noteful-mcp` | Here | Notes |
|---|---|---|
| `create_notebook` | `create_notebook` | same idea; no macOS delivery |
| `add_pages` | `add_pages` | copies the file |
| `clean_copy` | `clean_copy` | wrapper |
| `write_on_page` | `write_on_page` | highlights under existing ink |
| `page_layout` | `page_layout` | read-only aiming |
| `example_pages` | `example_pages` | bundled sources + previews |
| `design_mockup` / `mockup_grid` / `design_page` | same (Phase 7) | image model optional |
| `live_library`, `search_text`, `render_page`, `render_region`, `page_marks`, `export_pdf`, `extract_files` | not ported | our existing readers/exporters cover the local-file cases |
| `notebook_info`, `page_ink` | `note_outline` | equivalent data |
| `rename_notebook`, `output_folder` | not needed | `out` is explicit |

Safety rules for every write tool:

- Never overwrite the input. Write to `out`, or to `~/Documents/NoteComplete/ink/<title>.noteful`
  when `out` is omitted. `overwrite: true` is required to replace an existing output.
- With `in_place: true`, write `<name>.noteful` and keep `<name>.noteful.bak`; refuse for
  `.nfedit` projects unless the caller confirms.
- Validate every path, size, count and string length; return a tool error, not a panic.
- Return text plus a PNG of the first written page (reuse `page_png`), so the agent can check
  its work.

### 7.1 `create_notebook`

```json
{
  "title": "Cell biology",
  "markdown": "# THE CELL\n...",
  "paper": "dot",
  "ink": "ink",
  "accent": "blue",
  "font": "patrick",
  "size": 11,
  "seed": 7,
  "hand": "natural",
  "pen": "fineliner",
  "look": "study",
  "theme": "light",
  "out": "/path/Cell biology.noteful",
  "open_in_noteful": false
}
```

Returns: output path, page count, spill warning, per-page warnings, preview image of page 1.

### 7.2 `add_pages`

Same options plus `path`, `after_page` (1-based, default end). Copies the notebook, inserts
pages, returns the new path and preview of the first inserted page.

### 7.3 `clean_copy`

`path`, `page`, `markdown`, plus the style options; defaults `paper: "ruled"`, `hand: "neat"`.
Inserts after `page`. Thin wrapper over `add_pages`.

### 7.4 `write_on_page`

```json
{
  "path": "...",
  "page": 3,
  "items": [
    {"type": "text", "text": "Good", "x": 700, "y": 420, "color": "green"},
    {"type": "check", "x": 640, "y": 410, "size": 18},
    {"type": "ellipse", "cx": 300, "cy": 500, "rx": 90, "ry": 30, "color": "red"},
    {"type": "highlight", "x": 120, "y": 470, "w": 380, "h": 24, "color": "yellow"},
    {"type": "drawing", "svg": "<svg ...>", "x": 600, "y": 200, "width": 350}
  ],
  "out": "..."
}
```

Item types: `text`, `markdown`, `line`, `arrow`, `rect`, `ellipse`, `underline`, `check`,
`star`, `highlight`, `highlight_line`, `tape`, `drawing`. Coordinates in page units
(A4 = 1091 × 1543, origin top-left). Highlights are inserted under existing ink; everything
else is added on top. Returns the output path, preview and warnings.

### 7.5 `page_layout` (read-only, new)

Numbered items with bounding boxes and a short text snippet, so an agent can aim marks:
`[{n, kind, bbox:[x0,y0,x1,y1], color, text?}]`. This is the missing aiming tool for
`write_on_page` and grading.

### 7.6 `example_pages`

Without `name`: the index of bundled examples and the style guide. With `name`: its Markdown
or SVG source plus a rendered preview. Ship 4–6 examples ported from upstream (cell-biology,
radiation, clean-copy, quiz, answers-tree) with their licence headers.

### 7.7 Design tools (optional, Phase 7)

- `design_mockup(content, look, theme, reference?)` → PNG via an image model. Requires
  `GEMINI_API_KEY` or Vertex config. This is a network call; it lives in the CLI, is off by
  default, and is documented as sending the prompt to Google.
- `mockup_grid(path, step=50, region?)` → the mockup with a labelled pixel grid.
- `design_page(pages, title?, path?, after_page?)` → each spec is a list of blocks in
  mockup pixels: `text`, `card`, `band`, `highlight`, `sticky`, `arrow`, `circled_number`,
  `drawing` (traced from the mockup, labels re-written as text). Returns overlap warnings.
- Raster tracing (`trace.rs`) is only needed for `design_page` drawings; gate it behind the
  `design` feature. Without it, `drawing` accepts SVG only.

### 7.8 Resources and prompts

- `noteful://style` — the style guide.
- `noteful://examples`, `noteful://examples/{name}`, `.../preview`.
- Prompts: `summary_page`, `clean_copy`, `grade_quiz`, plus the existing `flashcards`.
- `initialize` instructions mention the write tools and the output folder.

---

## 8. In-app integration and conversions

### 8.1 WASM surface

Add to `crates/noteful-wasm/src/lib.rs`:

```rust
#[wasm_bindgen]
pub fn compose_markdown(markdown: &str, options_json: &str) -> Result<String, JsValue>;
// -> JSON { pages: [{svg, paper, warnings}], stats }

#[wasm_bindgen]
pub fn create_handwritten_document(title: &str, markdown: &str, options_json: &str)
    -> Result<EditorSession, JsValue>;
```

`EditorSession` then uses the existing `add_line`, `insert_pages`, `export_noteful` and export
paths. The desktop app gets:

- **File → New → From Markdown…**: paste/choose Markdown, pick paper/font/hand/theme, preview
  pages, create a `.noteful`/`.notecomp`.
- **Insert → Handwritten pages…** in an open note.
- **Annotate page** using the same item model as `write_on_page` (the canvas already has a
  selection; reuse it for positions).
- **Export** is unchanged: PDF, PNG, SVG, Noteful. A `.noteful` created from Markdown can be
  exported to any of them immediately.

### 8.2 Other conversions

| From | To | How |
|---|---|---|
| Markdown | `.noteful` | `compose` + `create_document_with` |
| Markdown | PDF/PNG/SVG | compose → `.noteful` → existing exporters |
| `.noteful` | Markdown | existing `markdown_export` (typed text + PDF text; handwriting is not text) |
| SVG | ink on a page | `ink::svg::drawing` |
| Image mockup | ink page | `design_page` (optional) |

Round-tripping ink back to Markdown is **not** possible without OCR; document that plainly.
The converter is one-way for handwriting.

### 8.3 Output format defaults

- Page size: A4 (1091.34 × 1543.46) unless the source notebook or caller says otherwise.
- New notebooks: PDF paper, `format_version` from Phase 0.
- Inserted pages: inherit the notebook's paper mechanism and page size.
- Deterministic seed derived from `title + page index` when the caller omits it, so a retry
  produces the same page.

---

## 9. Phased plan

Effort assumes one developer familiar with the codebase; calendar time may be longer.

### Phase 0 — Compatibility spike (2–3 days) **gate**

Write four minimal packages from a test harness (one page, one ballpoint pressure stroke, one
fineliner, one highlighter under it, one image, one tape):

| Axis | Values |
|---|---|
| Package version | `1.0`, `1.2`, `1.19`, `1.21` |
| Paper | JSON template, generated PDF |
| Page size | A4, letter |

Open each in Noteful on iPad (import via Files) and record: does it open, are pages listed,
is ink visible and editable, is pressure respected, is the highlighter under the ink, does
the paper render, does the image/tape survive, does re-export from Noteful keep working.
Write results into `spec/noteful-v0.1.md` under a "writer compatibility" section.

Exit criteria: one version × paper combination that imports cleanly and is editable.
Everything below assumes that combination.

### Phase 1 — Pressure, ordering, paper, batch API (4–6 days)

- `Line.pressure`, validation, `new_stroke` 3-value encoding, 3D bounds.
- `add_line_under`, `add_lines`, `Line.under`, export partition and prepend path.
- Preview partition in `scene.rs`, variable-width `line_svg`.
- `create_document_with`, `PaperStyle`, `paper.rs`, `NewPage.paper`.
- Tests: byte layout, round-trip existing files, z-order, pressure bounds.

Exit criteria: a page written by the core opens in the reader with visibly varying pen width
and a highlight behind the ink; Noteful import test passes.

### Phase 2 — Handwriting engine (1.5–2 weeks)

- `font.rs` (SVG font parse, path flatten, cache), 3 fonts first.
- `glyphs.rs` (35 extras, scripts, fallbacks).
- `hand.rs` (noise, resample, pen, text style, write_line/block, shapes, highlighter, tape).
- Determinism and performance tests; measure parse and compose time.

Exit criteria: "Hello, Αθήνα — T⁴ ≈ 10⁻⁸ → ∞" renders as smooth editable ink at three hand
settings, with no missing glyphs in the sample alphabet.

### Phase 3 — Markdown composer (1 week)

- `compose.rs`: block parsing, wrapping, pagination, columns, pagebreak, warnings.
- Classic look first, so the pipeline is testable without study decoration.
- Golden pages: stroke counts, bounding boxes, page breaks for a fixed corpus.

Exit criteria: a 3-page Markdown document composes to 3 pages with no text crossing margins
and correct page breaks.

### Phase 4 — Study look (1 week)

- `study.rs`: themes, title/heading/label, cards, columns, zones, sticky, stats, maps,
  dividers, accent rotation, shadows.
- Collision detection and warnings.
- Example pages ported and rendered as regression fixtures.

Exit criteria: the cell-biology and radiation examples look structurally equivalent to the
reference previews (title, diagram, cards, zone, sticky on one page).

### Phase 5 — SVG → ink (5–7 days)

- `svg.rs`: XML, viewBox, transforms, shapes, paths, style, text, fills.
- Warnings for unsupported features; limits.
- `!draw` wired into study look.

Exit criteria: the upstream drawing examples become ink; a labelled diagram keeps its labels
as handwriting and its fills as highlighter.

### Phase 6 — MCP write tools (3–4 days)

- `create_notebook`, `add_pages`, `clean_copy`, `write_on_page`, `page_layout`,
  `example_pages`; resources, prompts, initialize text.
- Protocol tests; `docs/MCP.md` update.

Exit criteria: an agent creates a notebook from Markdown, reads it back with `page_image`,
annotates page 1, and the outputs open in Noteful.

### Phase 7 — Design copy (optional, 1–2 weeks)

- `mockup_grid` (image overlay, CLI `image` crate).
- `design_page` spec renderer, collision warnings.
- `design_mockup` with the optional Google key.
- Raster tracing behind `design`; start with SVG-only drawings.

Exit criteria: a mockup PNG becomes a one-page ink layout with the same block positions and
readable body text.

### Phase 8 — In-app integration (1 week)

- WASM exports, desktop UI (New from Markdown, Insert pages, Annotate), previews.
- Docs and screenshots; end-to-end export tests.

Total: roughly **7–9 weeks** for Phases 0–6 and 8; Phase 7 is additive.

---

## 10. Limits and security

| Item | Limit |
|---|---|
| Markdown input | 1 MiB, 200 pages |
| Lines per page | 5 000 |
| Points per stroke | 8 192 (existing `add_line` limit) |
| SVG input | 256 KiB, 2 000 elements, 20 000 path segments |
| Raster input (design) | 16 MP, decoded dimensions checked before allocation |
| Output notebook | 512 MiB |
| Coordinates | finite, `|v| ≤ 1e6` |
| Strings | title ≤ 512 bytes, item text ≤ 64 KiB |

- No network in core. `design_mockup` is the only network path and is explicit.
- MCP writes only to `out`, the default ink folder, or an in-place copy with `.bak`.
- Never follow symlinks out of the chosen directory; canonicalise and compare prefixes.
- No `unsafe`; fuzz the SVG and font parsers with `cargo-fuzz` (native, not CI-gating at first).
- Reject XML with DTD/entities (roxmltree does not expand external entities; still cap size).
- Do not log note contents; errors carry offsets, not text.

---

## 11. Testing

1. **Unit**: font glyph counts, advances, path flattening, substitutions, scripts, pressure
   encoding (all `n ≤ 4` and `n ≥ 5` cases), bounds with zero range, underline/arrow geometry.
2. **Round-trip**: compose → export → `Package::parse` → `Stroke` radii match within
   quantisation; export again is byte-identical when no edits are added.
3. **Ordering**: highlight under existing ink lands before the existing blob; preview order
   matches export order.
4. **Golden structure**: for each example, assert page count, stroke count ± tolerance, ink
   bounding box, no warning, no point outside the page.
5. **Determinism**: same seed twice → identical bytes; different seed → different jitter.
6. **WASM**: compose and export in a browser test; re-open the result.
7. **MCP**: JSON-RPC tool listing, schema validation, error results, output path safety,
   overwrite refusal, preview image content type.
8. **Compatibility (manual)**: the Phase 0 matrix, repeated before each release that changes
   the writer.
9. **Visual**: render PNGs for the examples and inspect; keep them in `docs/images/` only
   when stable, not as pixel-diff CI (font rasterisation differs by platform).

Performance targets (native, release): font parse ≤ 150 ms once per font, compose a dense
page ≤ 250 ms, export a 10-page notebook ≤ 1 s, WASM compose ≤ 600 ms per page.

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Noteful rejects our package version | Blocks everything | Phase 0 gate; preserve source version on edit; fall back to upstream's 1.2 |
| JSON paper ignored on import | Blank pages in Noteful | Default to PDF paper; keep JSON behind an option |
| Under-ink prepend corrupts existing ink | Data loss | Only prepend when needed; byte-identical round-trip test; keep `.bak` |
| Pressure flag misread as eraser | Garbled strokes | Encode exactly `flags = 1`; test decode of our own output |
| SVG font subset missing glyphs | Boxes/gaps | Fallback chain + warnings; test the full Latin-1 + Greek set |
| WASM size grows past comfort | Slower app load | Include 3 fonts (~800 KB) first; measure; subset at build time if needed |
| Jitter looks "generated" | Low trust | Hand presets, real pressure, upstream style guide, example fixtures |
| Agent writes off-page or overlaps | Ugly pages | Bounds checks, collision warnings, preview returned to the agent |
| Reference project moves | Design drift | Pin `175e8d7`; re-fetch and diff before implementation starts |
| Licence mistake | Legal | OFL notices shipped; MIT notice in ported modules; `NOTICE` file |

---

## 13. Decisions needed before coding

1. **Package version default** for new notebooks after Phase 0: `1.2` (upstream) or the
   version Noteful currently writes (1.21)?
2. **Paper default**: PDF (proven, larger) or JSON (small, unproven)?
3. **Scope of Phase 7**: ship `design_mockup` (network + Google key) or only
   `mockup_grid` + `design_page` with an agent-supplied image?
4. **In-place writes in MCP**: copies only (safest) or allow `in_place` with `.bak`?
5. **Fonts**: bundle all seven (~1.1 MB) or the three used by default (~800 KB)?
6. **Tape**: native tape strokes (editable, no image) or generated washi PNGs (prettier,
   needs an image encoder)?

Recommended defaults: test first, then 1.2 + PDF paper; copies only by default; three fonts;
native tape.

---

## 14. Acceptance for the whole feature

- An agent can call `create_notebook` with Markdown containing a title, headings, bullets,
  a card, a highlight and an SVG diagram, and receive a `.noteful` that opens in Noteful with
  editable handwriting, under-ink highlights and a visible diagram.
- `write_on_page` can add a tick, a circle and a highlight to an existing page without
  disturbing existing ink, and the highlight sits behind it.
- The desktop app can do both without an agent, and export the result to PDF/PNG/SVG.
- Existing read tools and existing edited files are unchanged.
- `cargo test`, WASM tests and MCP protocol tests pass; the Phase 0 compatibility matrix is
  recorded in `spec/noteful-v0.1.md`.

---

## 15. Attribution

- `openninoor/noteful-mcp`, MIT, commit `175e8d7c5389a9505d0b9fca9082e69b0179b648` — format
  notes, layout rules, study themes, SVG and design algorithms.
- Patrick Hand and Caveat fonts, SIL Open Font License 1.1; EMS fonts under the licences in
  their `OFL*.txt` files. Ship the licence files and a `NOTICE` with the fonts.
