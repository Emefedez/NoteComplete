# Observed Noteful format, revision 0.1

Scope: ten supplied notes, not every Noteful version. The external container and typed field grammar are decoded with byte-exact round-trip. Semantic interpretations are separate from syntactic coverage. The current corpus spans package versions approximately 1.19 and 1.21.

## Container

All external numeric fields are big-endian:

```text
0                 AA BB CC DE
4                 contiguous resource/metadata/editable blocks
index_offset      typed-field index
file_size - 16    AA BB CC DE
file_size - 12    uint64 index_offset
file_size - 4     uint32 index_size
```

`index_offset + index_size == file_size - 16`. Indexed ranges cover `[4,index_offset)` exactly with no gaps or overlaps. Index order may differ from physical order. Use indexed extents; searching for `%PDF`/`%%EOF` is not a valid archive splitter.

| Index tag | Wire type | Meaning |
|---|---|---|
| 1 | 0x0003 | Package version float32 |
| 2 | 0x0405 | Note IDs |
| 3 | 0x0405 | Resource IDs, including audio and opaque data |
| 4 | 0x0405 | Editable set IDs; absent in the empty original note |
| 10 | 0x0405 | Block keys |
| 11 | 0x0402 | Absolute uint64 offsets |
| 12 | 0x0402 | uint64 lengths |

Arrays 10/11/12 align by index. `n:<ID>` is note metadata, `d:<ID>` drawing metadata. Unprefixed IDs can be media or editable sets. Static `PackageFileReader` at `0x100adf3d8` corroborates the trailer, magic and index; see [static-analysis evidence](https://github.com/Emefedez/noteful-re/tree/reverse-engineering/docs/RESEARCH_HISTORY.md#static-analysis).

Example `nota_1linea.noteful`: note metadata offset 4/505 bytes; JPEG 509/120141; drawing metadata 120650/1042; PDF 121692/4599; editable set 126291/304; index 126595/464; trailer 127059/16.

## Typed fields

A field begins with uint16 tag and uint16 type. Base type is `type & 0xff`. Flag 0x0400 means array with uint32 element count; flag 0x0800 adds a uint64 clock after the complete value. Nested strings/objects keep their own byte lengths inside arrays.

| Base type | Scalar encoding |
|---|---|
| 1 | uint8 |
| 2, 0x13 | uint64; semantic distinction unresolved |
| 3 | float32 |
| 4, 0x20 | float64 |
| 5 | uint32 byte length + UTF-8 |
| 6 | uint32 byte length + opaque bytes |
| 7 | uint32 byte length + nested fields |
| 0x11 | uint16 |
| 0x12, 0x14 | uint32 |
| 0x21 | two float64 values |
| 0x23 | four float64 values; observed as a CGRect `[x, y, width, height]` (owner notes, see below) |

Repeated collections use tag 1 IDs, tag 2 clocks, tag 3 live flags and tag 0 live records. This is consistent with LWW metadata symbols; native conflict resolution is not validated. Signedness distinctions between equal-width integer types remain unresolved. Unknown fields of known wire types survive encoding unchanged.

The parser preserves exact wire variants, types, clocks and raw bytes. It rejects duplicate tags, unsupported types/flags, malformed extents, invalid UTF-8 and nonfinite floats. These are strict implementation policies for the observed grammar, not proof that future versions cannot introduce other variants.

## Note, page, PDF and layer relationships

`n:/1` and `d:/1` are note IDs; `n:/3` is title. Pages live at `d:/2/0[]`, ordered by their tag-5 string. Page tag 1 is ID; `2/0` is editable-set ID; `2/2` lists attachments; tag 4 holds the background and `4/1` the internal page size.

Background variants must be distinguished:

| Background tag 0 | PDF resource | Zero-based PDF page | Other fields |
|---|---|---|---|
| 1, imported PDF | tag 4 string | tag 3 uint64 | tag 1 size |
| 2, observed paper template | tag 3 string | tag 7 uint64 | tag 5 provider, tag 6 paper JSON |

**Page and PDF geometry (owner notes, 2026-10).** Background tag 1 is the page size; pages need not share it. Noteful lets a page be widened beyond its PDF. Background tag 9 (type 0x23) is then the PDF page's rect in page units: in *Temas1+2* all 47 pages are 2242.6×990 with tag 9 `[0,0,1320,990]` for 720×540 pt slides; in *Memoria 1* 19 of 206 pages are 1857.2×1091.4 with tag 9 `[0,0,1543.5,1091.4]` for 841.9×595.3 pt pages. Both rects equal MediaBox × 11/6. Where tag 9 equals the page size or is absent, the PDF fills the page; PDFs with `/Rotate 90` reach the page through the rotated viewport. Tag 10 (same type) appeared once on a paper-template page, equal to tag 9; meaning unresolved. The reader draws the PDF into tag 9 over the paper fill. Both notes are owner files that are not in the corpus.

The Practice book references one PDF across 193 pages. The text sample references an embedded ruled-paper PDF. Its paper JSON omits some colors/type fields; rendering only JSON caused a missing background and has been replaced by actual PDF rendering in the reader.

The seven initial notes have size `[1091.3385826771655,1543.464566929134]`, with PDF size approximately `[595.2756,841.8898]`; ratio 11/6. The grid is ALSO drawn inside the PDF. It contains a white background and horizontal/vertical rectangles at spacing 24 and width 0.5. The JSON describes template settings, not ink. The seven 4599-byte PDFs have two file hashes but identical 3843-byte main graphic streams, SHA-256 `2afa806c3390ef51bccfa986ec1d3c516ed8892318c3b523f510bd874f058fb7`.

Layers live at `d:/3/0[]`: tag 1 name, 2 uint32 ID, 3 order string, 4 hidden flag, 5 lock flag, 6 opacity. Flags and editing semantics remain provisional until controlled native multilayer samples are available. Stroke layer IDs come from F101 +36; object layer IDs from object tag 4.

## Editable sets and objects

Editable tags: 1 encoding version (281 in initial notes, 288 in Practice); 2 freehand blob; 3/4 uint64 ID/time arrays consistent with deletion bookkeeping; 5 object collection. Arrays 3/4 are not counts or IDs of currently visible strokes. Native tombstone/merge behavior needs further validation.

Objects live at `set/5/0[]`. Tag 1 ID, `2/1` placement `[centerX,centerY,width,height,angleRadians]`, 4 layer, 5 z-order, 6 payload, 8 opacity, 9 tool. Payload tag 1 is kind, 2 native size. Image kind 1 uses resource ID tag 10; rich text kind 2 uses tag 4 content. Observed vector kinds 3/6/12/20/21 are described in the object rendering section below. Kind 23 (owner notes) has only native size and tag 22 (uint, 288 observed) in its payload, plus object tag 7 naming another kind-23 object; flag-0x10 strokes reference it by ID (below). It is treated as an ink group without its own drawing and is preserved unchanged. Ink layout follows below.

## Ink

Editable set tag 2 contains a command stream. F102 is 44 bytes: opcode, four f64 RGBA values, u16 tool, eight opaque bytes. Style persists. F101 has a 56-byte header:

| Offset | Value |
|---:|---|
| 0 | F101 |
| 2 | u64 stroke ID |
| 10 | u16 flags |
| 12 | u64 end timestamp, consistent with microseconds in audio corpus |
| 20 | u64 start timestamp |
| 28 | u64 z-order |
| 36 | u32 layer ID |
| 40 | f64 scalar radius |
| 48 | unknown u32 |
| 52 | u32 point count N |

Flag 0x10 (owner notes: 1 stroke in *Memoria 1*, 3 in *Temas1+2*) inserts `[u32 opaque][u32 length][UTF-8 ID]` immediately after the 38-byte header; the ID is a kind-23 object on the same page whose frame contains the stroke, so points stay in page coordinates. Flag 4 (tape revealed, per the MIT-licensed noteful-mcp notes) is accepted without layout change; it is not observed here. Flag 2 adds 8*N auxiliary bytes before geometry; noteful-mcp describes it as a pixel-eraser mask (`u32 0, u32 N-1`, then per segment an f32 pair `(a, b)`: `[0, b]` erased at the start, `[1 - a, 1]` towards the end). All 17 flag-2 strokes in the corpus and owner notes match that shape; the renderer draws only the remaining runs and falls back to the whole stroke for any other shape. D=3 for flag 1, otherwise D=2. N≤4 stores N*D raw f32 values. N>4 stores min/extent f32 pairs per dimension followed by N*D u16 coordinates, decoded as `min + q/65535 * extent`. Dimension three is radius, corroborated against 23 independent PDF endpoints; it does not establish device pressure.

Unsupported flags/commands retain the opaque blob and produce an ink diagnostic. Never scan forward for another signature after an error. Container verification may still succeed without semantic ink support.

## Highlighter over images

Object tag 8 is opacity and tag 9 selects normal ink (0) or highlighter (1) in the corpus. The supplied PDF uses `/BM /Multiply`, fill alpha `/ca 0.5` and stroke alpha `/CA 0.5`. The PDF state excerpt is recorded in [independent visual evidence](https://github.com/Emefedez/noteful-re/tree/reverse-engineering/docs/RESEARCH_HISTORY.md#independent-visual-validation). The page-2 yellow line has width 28 and tool 1, above a JPEG photograph.

Shapes and freehand ink share a single compositing operation per object/stroke: Multiply at 0.5 for highlighter, multiplied by the original object/color alpha. This avoids darkening self-overlapping pieces separately. The actual embedded PDF is inserted as an SVG image below the ink in the product reader. Layer groups compose in order with their opacity.

## Recovered shapes

| Kind | Geometry | Previously missing exam objects |
|---|---|---:|
| 3 | Filled rounded rectangle; payload/20 radius, payload/5 fill | 1 |
| 6 | Ellipse; payload/7 outline | 5 |
| 12 | Closed polygon; payload/13 commands | 3 |
| 21 | Cubic curve; payload/13 commands | 3 |

Kind 20 handles straight lines. Path commands: 0 move (one point), 1 line (one), 3 cubic (three), 4 close (none). Unsupported commands and incomplete coordinates produce diagnostics. Native geometry is scaled into placement dimensions before center translation and rotation; zero width/height is valid for degenerate straight lines. The sample's 74 objects all render, without claiming support for every Noteful object type.

New UI shapes are fixed-width stroke outlines (line, rectangle, ellipse, triangle, arrow). They can be erased, undone, assigned to layers and exported as native ink. They keep editable corner metadata in `.nfedit` and export as native ink, rather than native parametric objects.

## Variable-width ink

For 23 exam strokes with flag 1, the third sample dimension matches the initial circle radius in the independent exported PDF. It is not normalized Apple Pencil pressure. The old diagnostic `pressure_candidate` alias is retained, but `radii` is the supported interpretation.

Independent endpoint comparisons: maximum center error 0.000128113 internal units, maximum radius error 0.000071836. Circle selection used position/circularity, not the candidate radius. See [the retained radius measurements](https://github.com/Emefedez/noteful-re/blob/reverse-engineering/research/evidence/variable-width-validation.json). A prior failed nearest-outline experiment is described in the [research history](https://github.com/Emefedez/noteful-re/tree/reverse-engineering/docs/RESEARCH_HISTORY.md#independent-visual-validation) and does not support the renderer.

Rendering uses a union of sample discs and their external tangents, composed once. It preserves measured endpoints and varying width but does not reproduce the native filtering/Bezier smoothing exactly. Auxiliary channel bytes are preserved without assigning unproven eraser/pressure semantics.

## Text and PDF

Text is decoded into escaped SVG text/tspans; the text section below document approximations. PDF.js reads each page's actual indexed PDF resource and page index, including paper templates. Only nearby pages rasterize; the embedded image participates in the same SVG composition as strokes. SVG export includes that image. The native CLI scene carries a PDF descriptor, leaving rasterization to its host adapter.


## Attributed text and fonts

Source `samples/texto.noteful`, SHA-256 `b9d30b6f89bce4905ac61a9b802b1fb216aac22ffc8fa888a81045bf48ec673b`, contains three type-2 objects. Their content is in payload tag 4. Placement, dimensions, rotation, opacity and z-order use the ordinary object schema.

| Literal text | Family / PostScript name | UI points | Internal size | Traits |
|---|---|---:|---:|---|
| `texto texto ` | Helvetica | 16 | 29.3333333333 | Regular |
| `Bocadillo` | Gill Sans / GillSans-Bold | 16 | 29.3333333333 | Bold |
| `Hola` | Galvji / Galvji-Oblique | 12 | 22 | Italic |

The trailing space is real. U+200B terminal insertion markers are not rendered. Internal units equal UI points × 11/6; the SVG uses the stored size directly.

Content tags: 1 opaque clock/ID; 2 UTF-8 fragments; 3 attribute-change counts per fragment; 4 concatenated attribute keys; pools 5 strings, 6 bool/u8, 7 structured colors, 8 uint64 integers, 9 paragraph objects and 10 float64 values. Each pool has its own cursor. A fragment updates the current style, which carries into later fragments. Counts and pool consumption are checked.

| Wire key | Attribute | Pool |
|---:|---|---:|
| 1 | Legacy font descriptor, partially interpreted | 5 |
| 2 / 3 | Bold / italic | 6 |
| 4 / 5 | Underline / strikethrough integer style | 8 |
| 6 / 7 | Text / background color | 7 |
| 8 / 9 | Alignment / paragraph object | 8 / 9 |
| 10 | Font size | 10 |
| 11 / 12 | Line height / spacing | 10 |
| 13 / 14 | Family / PostScript name | 5 |

Content, size, bold, italic and family are checked against the user's real sample. Underline/strike are supported by static UIKit mappings in [100a485ec.c](https://github.com/Emefedez/noteful-re/blob/reverse-engineering/research/evidence/ghidra-text/100a485ec.c) and [100a49e04.c](https://github.com/Emefedez/noteful-re/blob/reverse-engineering/research/evidence/ghidra-text/100a49e04.c), plus synthetic inheritance tests. No native underlined/struck text sample has been supplied yet.

Rust/Python render escaped SVG text/tspan elements with whitespace, explicit line breaks, size, weight, italic and simple decorations. Unknown attributes retain readable text plus a warning. Fonts resolve from the destination platform, falling back to Arial/sans-serif; Apple fonts are not redistributed.

Baseline placement is approximate (horizontal inset 5, vertical inset 8 plus font size). Soft wrapping, justification, lists, complex paragraphs, background color and exact decoration variants remain incomplete. The actual embedded PDF paper now renders below the text in the product reader; the text is never taken from thumbnail pixels. The metadata panel describes requested fonts, not the actual installed font selected by the browser.

## Audio and writing synchronization

The real source `samples/Practice book (vol. 1).noteful` contains 193 pages, one PDF, one M4A recording and three variable-width strokes on visible page 9. Source hash is recorded in [the corpus manifest](../samples/manifest.json). The index uses package version approximately 1.21.

Recording collection: drawing metadata tag `7`, live records at `7/0[]`. Recording fields:

| Tag | Observed meaning |
|---|---|
| 1 | Recording ID |
| 2 | Name (clocked string) |
| 3 | Playable resource ID (clocked string) |
| 4 | Original resource ID in this sample; same as tag 3 |
| 5 | Recording start, uint64 microseconds |
| 6 | Recorded duration in seconds, float64 |

Observed start: `811003055158749`; metadata duration: `13.395676000000094` seconds. The browser reports about 13.47 seconds for the M4A container. Media padding does not change the stored pen-down offsets.

F101 offsets +12 and +20 are consistent with stroke end/start microseconds, respectively. Subtract the recording start using integer arithmetic before dividing by 1,000,000:

| Stroke | Start seconds | End seconds |
|---|---:|---:|
| 1 | 7.475601 | 8.127483 |
| 2 | 8.818385 | 9.459884 |
| 3 | 10.261083 | 11.052481 |

A stroke is associated with every recording interval containing its pen-down time. Each timing entry retains the recording ID, so multiple recordings are not collapsed into one clock. Absolute clocks are serialized as decimal strings; relative seconds are browser-safe numbers. Invalid reversed intervals are not associated.

The reader applies an additional opacity of 0.2 before pen-down and 1 afterwards to the whole stroke, preserving its original alpha and highlighter blend. Selecting another recording changes the timing set, pauses the previous transport and restores that recording's playback position. Page scrolling and seeking work independently. Unrelated/untimed strokes remain fully visible. Disabling sync restores normal visibility.

This is evidence-based whole-stroke synchronization, not exact native point-by-point replay. No per-point timestamp has been established for these three records; their auxiliary flag is unset. Paused/edited/spliced recording variants and native multiple-recording exports need further corpus validation.

Audio signatures: CAF, WAV, M4A/M4B, ID3 MP3, FLAC and Ogg. Other indexed resources remain opaque bytes. Browser codec support determines playback; extraction/download works independently.

Fixtures: `audio-synthetic.noteful` adds a generated 0.25-second WAV. `multi-audio-synthetic.noteful` duplicates the real recording under a second resource ID, adds a second recording 20 seconds later and shifts only stroke 3 by 20 seconds. It tests independent association and playback selection; it is explicitly synthetic, not a native Noteful multi-recording export.

The player displays a nonempty stored recording name unchanged. Empty names use a clearly generated recording number and date derived from the Apple-epoch start timestamp. The real Practice recording name is empty; its displayed date is a fallback, not a recovered name.

## Implementation limits and conformance

No fixed file MB or note count ceiling. Nested field depth ≤40. Item/point budgets derive from input byte length; every read/array must fit its buffer. Target address space, available memory, uint32 wire lengths and finite coordinate constraints still apply.

Conformance checks: all ten notes parse without ink errors; typed field/index re-emission reproduces exact original bytes; Rust diagnostics and semantics match the independent Python oracle; shared-renderer SVG output matches exactly; ordered SVG primitives match within 2e−5 internal units; malformed cases fail without panics. Native modified export is tested by re-import into our decoders, not yet the official app.

CLI JSON may contain uint64 values beyond JavaScript's exact integer range. The editor/WASM view is a separate DTO with decimal-string absolute audio clocks and relative-second timing. SVG is an output representation, never the editable archive model.
