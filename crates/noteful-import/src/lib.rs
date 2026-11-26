//! Goodnotes (`.goodnotes`) and Notability (`.ntb`) notebooks made into Noteful notes that
//! NoteComplete edits. The notebook is read with oblyx and rebuilt as a Noteful note: ink as
//! strokes (smoothed curves, highlighters under ink with multiply blend), typed text as text
//! boxes, pictures as images, shapes as real editable shapes, sticky notes as editable
//! sticky-note prefabs with owned ink/text on top, and the notebook's own PDF pages as page
//! backgrounds. What Noteful cannot hold as an item (paper templates, arbitrary filled paths)
//! is drawn into a vector PDF behind the page, so the page still looks as it did; anything else
//! is left out with a warning. The original file is kept with the project as its `origin`.
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::{write::ZlibEncoder, Compression};
use noteful_core::{
    Adjustment, Editor, Image, Line, NewPdf, Origin, PageBackground, Part, PdfPlacement, Shape,
    ShapeKind, TextBox,
};
use oblyx::doc::{Document, Item, Page, ShapeEl, ShapeKind as Kind};
use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref, TextStr};
use std::collections::{BTreeMap, HashSet};
use std::io::{Cursor, Read, Write};

pub mod pdf_edit;
pub mod rnote;

/// Noteful page units per PDF point.
const UNITS_PER_POINT: f64 = 11. / 6.;
/// Default translucent fill alpha Goodnotes 6 applies to shape boxes whose proto3 fill omits `a`.
const GOODNOTES_SHAPE_FILL_ALPHA: f32 = 0.18;

/// A note made from a notebook, with what could not be brought over.
pub struct Imported {
    pub editor: Editor,
    pub warnings: Vec<String>,
}

/// `"goodnotes"`, `"notability"` or `"rnote"` when `bytes` is a notebook this crate imports.
pub fn format_of(bytes: &[u8]) -> Option<&'static str> {
    if rnote::is_rnote(bytes) {
        return Some("rnote");
    }
    if !bytes.starts_with(b"PK\x03\x04") {
        return None;
    }
    let zip = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
    let mut names = zip.file_names();
    let (mut goodnotes, mut notability) = (false, false);
    for name in &mut names {
        notability |= name == "noteBundle";
        goodnotes |= name == "index.notes.pb" || name == "schema.pb";
    }
    if notability {
        Some("notability")
    } else if goodnotes {
        Some("goodnotes")
    } else {
        None
    }
}

/// A notebook made into a Noteful note (or a v13 `.nfedit` project archive when the notebook
/// contains preserved native shapes or sticky-note prefabs), before any user edit.
pub struct Converted {
    pub noteful: Vec<u8>,
    pub format: &'static str,
    pub warnings: Vec<String>,
}

/// Import a Goodnotes or Notability notebook named `name` (its file name) as an editor whose
/// project keeps the notebook as its origin.
pub fn import(name: &str, bytes: &[u8]) -> Result<Imported, String> {
    let converted = convert(name, bytes)?;
    let mut editor = if noteful_core::is_project_archive(&converted.noteful) {
        Editor::open_project_bytes(&converted.noteful)
    } else {
        Editor::open(&converted.noteful)
    }
    .map_err(|e| e.message)?;
    editor.set_origin(Some(Origin {
        format: converted.format.into(),
        name: name.into(),
        bytes: bytes.to_vec(),
    }));
    Ok(Imported {
        editor,
        warnings: converted.warnings,
    })
}

/// The Noteful note (or `.nfedit` project archive with preserved editable shapes and sticky
/// notes) a notebook becomes (the browser builds the editor in its own engine).
pub fn convert(name: &str, bytes: &[u8]) -> Result<Converted, String> {
    let format = format_of(bytes).ok_or("Not a Goodnotes, Notability or Rnote notebook")?;
    let mut warnings = Warnings::default();
    let (doc, pages, scale) = match format {
        "goodnotes" => goodnotes(bytes)?,
        "rnote" => {
            let (doc, pages) = rnote::pages(bytes, &mut |w| warnings.add(w))?;
            (doc, pages, UNITS_PER_POINT)
        }
        _ => notability(bytes)?,
    };
    if pages.is_empty() {
        return Err("The notebook has no pages".into());
    }
    let title = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .rsplit_once('.')
        .map_or(name, |(stem, _)| stem);
    let title: String = title.chars().take(200).collect();
    let stacking = if format == "goodnotes" {
        Stacking::PicturesUnderInk
    } else {
        Stacking::AsDrawn
    };
    let noteful = build_bytes(&title, &doc, &pages, scale, stacking, &mut warnings)?;
    Ok(Converted {
        noteful,
        format,
        warnings: warnings.finish(),
    })
}

fn goodnotes(bytes: &[u8]) -> Result<(Document, Vec<Page>, f64), String> {
    let doc = Document::from_bytes(bytes.to_vec()).map_err(|e| format!("Goodnotes: {e}"))?;
    let pages = doc
        .pages
        .iter()
        .map(|src| {
            // A page oblyx cannot read stays as a blank page, so the others keep their places.
            let ordered = chronological(src);
            let source = ordered.as_ref().unwrap_or(src);
            let mut page = doc
                .decode_page(source, false)
                .unwrap_or_else(|_| Page::new(src.uuid.clone(), Vec::new()));
            normalize_k21_shape_fills(source, &mut page);
            page
        })
        .collect();
    // Goodnotes pages are already in Noteful units (A4 points × 11/6).
    Ok((doc, pages, 1.))
}

/// Goodnotes 6 filled shape boxes (kind 21) store `{r, g, b}` in field 30 and omit field 4 (`a`)
/// when using Goodnotes' default translucent fill tint (~18% opacity). `oblyx::decode_rgba`
/// defaults an absent field 4 to `1.0` (solid opaque fill); normalize those shapes to
/// `GOODNOTES_SHAPE_FILL_ALPHA` so the background tint shows cleanly without hiding ink.
fn normalize_k21_shape_fills(src: &oblyx::doc::PageSource, page: &mut Page) {
    use oblyx::pb::{bytes_of, fixed32_of, parse, records, varint_of};
    let Ok(recs) = records(&src.data) else {
        return;
    };
    let mut translucent = HashSet::new();
    for rec in recs {
        let Ok(fs) = parse(rec) else { continue };
        if fs.len() != 1 || fs[0].num != 21 {
            continue;
        }
        let Some(payload) = bytes_of(&fs, 21) else {
            continue;
        };
        let Ok(f) = parse(payload) else { continue };
        let Some(uuid) = bytes_of(&f, 1).and_then(|b| std::str::from_utf8(b).ok()) else {
            continue;
        };
        let Some(f30) = bytes_of(&f, 30).and_then(|b| parse(b).ok()) else {
            continue;
        };
        let Some(one) = bytes_of(&f30, 1).and_then(|b| parse(b).ok()) else {
            continue;
        };
        let color = bytes_of(&one, 1).and_then(|b| parse(b).ok()).unwrap_or(one);
        let alpha_bits = fixed32_of(&color, 4).or_else(|| varint_of(&color, 4).map(|v| v as u32));
        let omitted = alpha_bits.is_none_or(|bits| {
            let a = f32::from_bits(bits);
            !a.is_finite() || a <= 0.0
        });
        if omitted {
            translucent.insert(uuid.to_owned());
        }
    }
    if translucent.is_empty() {
        return;
    }
    for item in &mut page.items {
        if let Item::Shape(sh) = item {
            if sh.uuid.as_deref().is_some_and(|u| translucent.contains(u)) {
                sh.fill[3] = GOODNOTES_SHAPE_FILL_ALPHA;
            }
        }
    }
}

/// Whether a Goodnotes page record is an element's header (oblyx's `is_wrapper`): its id, its
/// replica and clock (fields 8 and 9), and the element's own record after it.
fn is_header(keys: &[u32]) -> bool {
    keys.contains(&8)
        && keys
            .iter()
            .all(|k| matches!(k, 1 | 2 | 3 | 4 | 8 | 9 | 14 | 16 | 20 | 22 | 23))
}

/// A Goodnotes page with its elements in the order they were last written.
fn chronological(src: &oblyx::doc::PageSource) -> Option<oblyx::doc::PageSource> {
    use oblyx::pb::{field_nums, parse, records, varint_of};
    let recs = records(&src.data).ok()?;
    let mut units: Vec<(u64, &[&[u8]])> = Vec::new();
    let (mut i, mut last) = (0, 0);
    while i < recs.len() {
        let fields = parse(recs[i]).ok()?;
        let header = is_header(&field_nums(&fields));
        let paired = header
            && recs
                .get(i + 1)
                .is_some_and(|next| parse(next).is_ok_and(|f| !is_header(&field_nums(&f))));
        if header {
            last = varint_of(&fields, 9).unwrap_or(last);
        }
        let n = if paired { 2 } else { 1 };
        units.push((last, &recs[i..i + n]));
        i += n;
    }
    if units.windows(2).all(|w| w[0].0 <= w[1].0) {
        return None;
    }
    units.sort_by_key(|(clock, _)| *clock);
    let mut data = Vec::with_capacity(src.data.len());
    for rec in units.iter().flat_map(|(_, recs)| recs.iter()) {
        push_record(&mut data, rec);
    }
    Some(oblyx::doc::PageSource {
        uuid: src.uuid.clone(),
        data,
    })
}

/// A page record as Goodnotes frames it: its length (a varint), then its bytes.
fn push_record(data: &mut Vec<u8>, rec: &[u8]) {
    let mut n = rec.len() as u64;
    loop {
        let byte = (n & 0x7f) as u8;
        n >>= 7;
        if n == 0 {
            data.push(byte);
            break;
        }
        data.push(byte | 0x80);
    }
    data.extend_from_slice(rec);
}

/// The `.ntb` path of oblyx's web build: the bundle, its assets, and the worksheet PDFs.
fn notability(bytes: &[u8]) -> Result<(Document, Vec<Page>, f64), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut bundle = Vec::new();
    zip.by_name("noteBundle")
        .map_err(|e| e.to_string())?
        .read_to_end(&mut bundle)
        .map_err(|e| e.to_string())?;
    let mut assets = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.starts_with("assets/") && !entry.is_dir() {
            let mut data = Vec::new();
            entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
            assets.push((name, data));
        }
    }
    let (meta, strokes, pages, texts, shapes) =
        oblyx::ntb::parse_bundle_public(&bundle).map_err(|e| format!("Notability: {e}"))?;
    let ntb = oblyx::ntb::NtbDocument {
        meta,
        strokes,
        pages,
        texts,
        shapes,
        manifest: Vec::new(),
        thumbnail: None,
        assets,
    };
    let mut pages = oblyx::ntb::to_pages(&ntb, oblyx::ntb::NTB_PAGE_H);
    let mut doc = Document::empty();
    let mut by_hash = BTreeMap::new();
    for (name, data) in ntb.assets {
        let key = name.rsplit('/').next().unwrap_or(&name).to_string();
        if let Some(hex) = key
            .split('.')
            .next()
            .filter(|h| h.len() == 128 && h.chars().all(|c| c.is_ascii_hexdigit()))
        {
            by_hash.insert(hex.to_ascii_lowercase(), key.clone());
        }
        doc.insert_attachment(key, data);
    }
    for page in &pages {
        let background = page.uuid.split_once('#').and_then(|(_, rest)| {
            let (hash, n) = rest.split_once(':')?;
            Some((
                by_hash.get(&hash.to_ascii_lowercase())?.clone(),
                n.parse().ok()?,
            ))
        });
        if let Some((key, n)) = background {
            doc.set_page_cfg(&page.uuid, key, Some(n));
        }
    }
    doc.inject_pdf_backgrounds(&mut pages);
    Ok((doc, pages, UNITS_PER_POINT))
}

/// Warnings counted by kind, written once each.
#[derive(Default)]
struct Warnings(BTreeMap<&'static str, usize>);
impl Warnings {
    fn add(&mut self, what: &'static str) {
        *self.0.entry(what).or_default() += 1;
    }
    fn finish(self) -> Vec<String> {
        self.0
            .into_iter()
            .map(|(what, n)| format!("{what} ({n})"))
            .collect()
    }
}

/// One drawn base element baked into the `.noteful` archive: ink, a picture or a text box.
enum Element {
    Line(Line),
    Image(Image),
}

impl Element {
    /// Stacking rank for Goodnotes: 0 = picture, 1 = highlighter stroke, 2 = opaque ink & text.
    fn stack_rank(&self) -> u8 {
        match self {
            Element::Image(image) if image.text.is_none() => 0,
            Element::Line(line) if line.tool == 1 => 1,
            _ => 2,
        }
    }
}

/// An editable NoteComplete overlay kept above the base `.noteful` (locked under the undo floor)
/// so native shapes stay real resizable shapes and sticky notes stay editable prefabs with their
/// own strokes and text sitting cleanly on top of the card.
#[allow(clippy::large_enum_variant)]
enum Overlay {
    Shape {
        line: Line,
        adjustment: Option<Adjustment>,
    },
    Sticky {
        id: String,
        bounds: [f64; 4],
        frame: Line,
        picture: Image,
        owned_texts: Vec<Image>,
        owned_lines: Vec<Line>,
    },
}

/// What one page becomes.
#[derive(Default)]
struct PageOut {
    elements: Vec<Element>,
    overlays: Vec<Overlay>,
    paper: Option<Content>,
    pdf: Option<(String, u64, [f64; 4])>,
}

fn rgba(c: [f32; 4]) -> [f64; 4] {
    c.map(|v| f64::from(v).clamp(0., 1.))
}

/// A colour with its alpha over white paper (the paper PDF has no transparency).
fn over_white(c: [f32; 4]) -> [f32; 3] {
    let a = c[3].clamp(0., 1.);
    [0, 1, 2].map(|i| c[i].clamp(0., 1.) * a + (1. - a))
}

/// Smooths sparse Goodnotes stroke control points using quadratic midpoint subdivision so curved
/// handwriting (e.g. parentheses, letters) renders cleanly instead of polygonal straight segments,
/// while preserving sharp corners and keeping total point counts well below Noteful's 8192 limit.
fn smooth_stroke_points(pts: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    let n = pts.len();
    if !(3..=2000).contains(&n) {
        return pts;
    }
    let mut out = Vec::with_capacity(n * 3);
    out.push(pts[0]);
    for i in 1..n - 1 {
        let p0 = pts[i - 1];
        let p1 = pts[i];
        let p2 = pts[i + 1];
        let m0 = if i == 1 {
            p0
        } else {
            [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5]
        };
        let m1 = if i == n - 2 {
            p2
        } else {
            [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5]
        };
        let v1 = [p1[0] - p0[0], p1[1] - p0[1]];
        let v2 = [p2[0] - p1[0], p2[1] - p1[1]];
        let l1 = v1[0].hypot(v1[1]);
        let l2 = v2[0].hypot(v2[1]);
        // Keep genuine sharp corners crisp (e.g. acute cusps) and avoid subdividing tiny micro-steps.
        let sharp = l1 > 1e-4 && l2 > 1e-4 && ((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)) < -0.2;
        let span = (m1[0] - m0[0]).hypot(m1[1] - m0[1]);
        if sharp || span < 0.6 {
            out.push(p1);
            continue;
        }
        let steps = if span > 8.0 {
            4usize
        } else if span > 2.5 {
            3usize
        } else {
            2usize
        };
        for s in 1..=steps {
            let t = s as f64 / steps as f64;
            let u = 1.0 - t;
            out.push([
                u * u * m0[0] + 2.0 * u * t * p1[0] + t * t * m1[0],
                u * u * m0[1] + 2.0 * u * t * p1[1] + t * t * m1[1],
            ]);
        }
    }
    if let Some(&last) = pts.last() {
        if out
            .last()
            .is_none_or(|p| (p[0] - last[0]).hypot(p[1] - last[1]) > 1e-4)
        {
            out.push(last);
        }
    }
    out
}

/// How a notebook stacks pictures, highlighters and ink on a page.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stacking {
    /// Goodnotes: pictures under highlighters under opaque pen ink & typed text.
    PicturesUnderInk,
    /// Highlighters under opaque ink; otherwise in notebook order.
    AsDrawn,
}

fn build_bytes(
    title: &str,
    doc: &Document,
    pages: &[Page],
    scale: f64,
    stacking: Stacking,
    warnings: &mut Warnings,
) -> Result<Vec<u8>, String> {
    let sizes: Vec<[f64; 2]> = pages
        .iter()
        .map(|p| {
            let size = [f64::from(p.width) * scale, f64::from(p.height) * scale];
            size.map(|v| {
                if v.is_finite() {
                    v.clamp(10., 1e5)
                } else {
                    1000.
                }
            })
        })
        .collect();
    let mut base = Editor::create_document(title, &sizes, &[]).map_err(|e| e.message)?;
    let mut outs: Vec<PageOut> = pages
        .iter()
        .zip(&sizes)
        .enumerate()
        .map(|(slot, (page, size))| convert_page(doc, page, slot, *size, scale, warnings))
        .collect();

    // The notebook's own PDFs, one background change per PDF.
    let mut by_pdf: BTreeMap<&str, Vec<PageBackground>> = BTreeMap::new();
    for (slot, out) in outs.iter().enumerate() {
        if let Some((att, n, rect)) = &out.pdf {
            by_pdf.entry(att).or_default().push(PageBackground {
                page: slot,
                size: sizes[slot],
                pdf: Some(PdfPlacement {
                    resource: String::new(),
                    page_index: *n,
                    rect: Some(*rect),
                }),
            });
        }
    }
    for (i, (att, mut changes)) in by_pdf.into_iter().enumerate() {
        let Some(bytes) = doc.attachments.get(att) else {
            warnings.add("PDF pages that were missing from the notebook");
            continue;
        };
        let id = format!("notebook-pdf-{i}");
        for change in &mut changes {
            change.pdf.as_mut().expect("set above").resource = id.clone();
        }
        let pdf = NewPdf {
            id,
            base64: STANDARD.encode(bytes.as_slice()),
        };
        if base.set_page_backgrounds(changes, Some(pdf)).is_err() {
            warnings.add("PDF pages that could not be read");
        }
    }

    // Paper templates and fills, one generated PDF for every page that has them.
    let paper: Vec<(usize, Vec<u8>)> = outs
        .iter_mut()
        .enumerate()
        .filter_map(|(slot, out)| out.paper.take().map(|c| (slot, c.finish().to_vec())))
        .collect();
    if !paper.is_empty() {
        let sizes_pt: Vec<[f32; 2]> = paper
            .iter()
            .map(|(slot, _)| sizes[*slot].map(|v| (v / UNITS_PER_POINT) as f32))
            .collect();
        let pdf = paper_pdf(&sizes_pt, paper.iter().map(|(_, c)| c.as_slice()));
        let changes = paper
            .iter()
            .enumerate()
            .map(|(i, (slot, _))| PageBackground {
                page: *slot,
                size: sizes[*slot],
                pdf: Some(PdfPlacement {
                    resource: "notebook-paper".into(),
                    page_index: i as u64,
                    rect: None,
                }),
            })
            .collect();
        let pdf = NewPdf {
            id: "notebook-paper".into(),
            base64: STANDARD.encode(pdf),
        };
        base.set_page_backgrounds(changes, Some(pdf))
            .map_err(|e| e.message)?;
    }

    let mut page_overlays: Vec<Vec<Overlay>> = Vec::with_capacity(outs.len());
    for (slot, mut out) in outs.into_iter().enumerate() {
        page_overlays.push(std::mem::take(&mut out.overlays));
        if stacking == Stacking::PicturesUnderInk {
            // Stable sort: pictures first, then highlighters (tool 1), then opaque pen ink & text.
            out.elements.sort_by_key(Element::stack_rank);
        } else {
            // Even in AsDrawn notebooks, highlighters stay underneath opaque pen ink.
            out.elements.sort_by_key(|e| match e {
                Element::Line(l) if l.tool == 1 => 0u8,
                _ => 1u8,
            });
        }
        for element in out.elements {
            match element {
                Element::Line(line) => {
                    if base.add_line(slot, line).is_err() {
                        warnings.add("Strokes or shapes that could not be read");
                    }
                }
                Element::Image(image) => {
                    if base.add_image(slot, image).is_err() {
                        warnings.add("Pictures or text that could not be read");
                    }
                }
            }
        }
    }

    let base_noteful = base.export_noteful().map_err(|e| e.message)?;
    if page_overlays.iter().all(Vec::is_empty) {
        return Ok(base_noteful);
    }

    // Reopen the base .noteful and attach real shapes and sticky-note prefabs (plus sticky-owned
    // ink/text right on top of each sticky note) as locked-floor project items.
    let mut editor = Editor::open(&base_noteful).map_err(|e| e.message)?;
    for (slot, overlays) in page_overlays.into_iter().enumerate() {
        for overlay in overlays {
            match overlay {
                Overlay::Shape { line, adjustment } => {
                    let next_id = format!("new:{}", editor.history_mark().map_or(0, |(c, _)| c));
                    if editor.add_line(slot, line).is_err() {
                        warnings.add("Strokes or shapes that could not be read");
                    } else if let Some(adj) = adjustment {
                        let _ = editor.adjust_item(slot, &next_id, adj);
                    }
                }
                Overlay::Sticky {
                    frame,
                    picture,
                    owned_texts,
                    owned_lines,
                    ..
                } => {
                    if editor.add_line(slot, frame).is_err()
                        || editor.add_image(slot, picture).is_err()
                    {
                        warnings.add("Sticky notes that could not be read");
                        continue;
                    }
                    // Highlighters written on the sticky note go before opaque strokes on the sticky.
                    let mut lines = owned_lines;
                    lines.sort_by_key(|l| if l.tool == 1 { 0u8 } else { 1u8 });
                    for l in lines {
                        let _ = editor.add_line(slot, l);
                    }
                    for txt in owned_texts {
                        let _ = editor.add_image(slot, txt);
                    }
                }
            }
        }
    }
    editor.lock_history_floor();
    editor.save_project_archive().map_err(|e| e.message)
}

fn paper_pdf<'a>(sizes: &[[f32; 2]], contents: impl Iterator<Item = &'a [u8]>) -> Vec<u8> {
    let mut pdf = Pdf::new();
    let (catalog, tree, info) = (Ref::new(1), Ref::new(2), Ref::new(3));
    let mut next = 4;
    let mut kids = Vec::new();
    for (size, content) in sizes.iter().zip(contents) {
        let (page_id, content_id) = (Ref::new(next), Ref::new(next + 1));
        next += 2;
        kids.push(page_id);
        let mut page = pdf.page(page_id);
        page.media_box(Rect::new(0., 0., size[0], size[1]));
        page.parent(tree);
        page.contents(content_id);
        page.finish();
        let mut white = Content::new();
        white.set_fill_rgb(1., 1., 1.);
        white.rect(0., 0., size[0], size[1]);
        white.fill_nonzero();
        let mut bytes = white.finish().to_vec();
        // The page's own drawing follows on its own line ("f" + "0 0 0 rg" read as "f0 …").
        if !bytes.ends_with(b"\n") {
            bytes.push(b'\n');
        }
        bytes.extend_from_slice(content);
        pdf.stream(content_id, &bytes);
    }
    pdf.catalog(catalog).pages(tree);
    pdf.pages(tree)
        .kids(kids.iter().copied())
        .count(kids.len() as i32);
    pdf.document_info(info)
        .producer(TextStr("NoteComplete"))
        .pair(Name(b"Title"), TextStr("Notebook paper"));
    pdf.finish()
}

/// A shape's outline in notebook coordinates, closed.
fn shape_outline(sh: &ShapeEl) -> Vec<[f32; 2]> {
    let (cs, sn) = (sh.rotation.cos(), sh.rotation.sin());
    let turn = |p: [f32; 2], o: [f32; 2]| {
        let (dx, dy) = (p[0] - o[0], p[1] - o[1]);
        [o[0] + dx * cs - dy * sn, o[1] + dx * sn + dy * cs]
    };
    let (x, y, w, h) = (sh.x, sh.y, sh.w, sh.h);
    let mut pts: Vec<[f32; 2]> = match sh.kind {
        Kind::Rect => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
            .map(|p| turn(p, [x, y]))
            .to_vec(),
        Kind::Triangle => [[x + w / 2., y], [x + w, y + h], [x, y + h]]
            .map(|p| turn(p, [x, y]))
            .to_vec(),
        Kind::Diamond => [
            [x + w / 2., y],
            [x + w, y + h / 2.],
            [x + w / 2., y + h],
            [x, y + h / 2.],
        ]
        .map(|p| turn(p, [x, y]))
        .to_vec(),
        Kind::Ellipse => (0..48)
            .map(|i| {
                let a = i as f32 * std::f32::consts::TAU / 48.;
                turn([x + w * a.cos(), y + h * a.sin()], [x, y])
            })
            .collect(),
        Kind::Polygon => sh.points.clone(),
    };
    if let Some(&first) = pts.first() {
        pts.push(first);
    }
    pts
}

fn rotation_around(
    pivot: [f64; 2],
    start: [f64; 2],
    end: [f64; 2],
    rot_rad: f64,
) -> Option<Adjustment> {
    if !rot_rad.is_finite() || rot_rad.abs() <= 1e-4 {
        return None;
    }
    let cx = (start[0] + end[0]) * 0.5;
    let cy = (start[1] + end[1]) * 0.5;
    let (dx, dy) = (cx - pivot[0], cy - pivot[1]);
    let (sn, cs) = rot_rad.sin_cos();
    let rcx = pivot[0] + dx * cs - dy * sn;
    let rcy = pivot[1] + dx * sn + dy * cs;
    Some(Adjustment {
        translation: [rcx - cx, rcy - cy],
        rotation: rot_rad.to_degrees(),
        ..Default::default()
    })
}

fn polygon_as_rect(
    points: &[[f32; 2]],
    s: impl Fn(f32) -> f64,
) -> Option<([f64; 2], [f64; 2], Option<Adjustment>)> {
    let mut pts: Vec<[f64; 2]> = points.iter().map(|p| [s(p[0]), s(p[1])]).collect();
    if pts.len() >= 2 {
        let last = *pts.last().unwrap();
        if (pts[0][0] - last[0]).hypot(pts[0][1] - last[1]) < 1.0 {
            pts.pop();
        }
    }
    if pts.len() != 4 || pts.iter().flatten().any(|v| !v.is_finite()) {
        return None;
    }
    let edge = |a: [f64; 2], b: [f64; 2]| [b[0] - a[0], b[1] - a[1]];
    let e0 = edge(pts[0], pts[1]);
    let e1 = edge(pts[1], pts[2]);
    let e2 = edge(pts[2], pts[3]);
    let e3 = edge(pts[3], pts[0]);
    let l0 = e0[0].hypot(e0[1]);
    let l1 = e1[0].hypot(e1[1]);
    let l2 = e2[0].hypot(e2[1]);
    let l3 = e3[0].hypot(e3[1]);
    if l0 < 1e-2 || l1 < 1e-2 || l2 < 1e-2 || l3 < 1e-2 {
        return None;
    }
    if (l0 - l2).abs() > l0.max(l2) * 0.04 + 2.0 || (l1 - l3).abs() > l1.max(l3) * 0.04 + 2.0 {
        return None;
    }
    let cos01 = (e0[0] * e1[0] + e0[1] * e1[1]).abs() / (l0 * l1);
    let cos12 = (e1[0] * e2[0] + e1[1] * e2[1]).abs() / (l1 * l2);
    if cos01 > 0.07 || cos12 > 0.07 {
        return None;
    }
    if (e0[1].abs() / l0 < 0.03) || (e0[0].abs() / l0 < 0.03) {
        let min_x = pts.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
        let max_x = pts.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max);
        let min_y = pts.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
        let max_y = pts.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max);
        return Some(([min_x, min_y], [max_x, max_y], None));
    }
    let cx = pts.iter().map(|p| p[0]).sum::<f64>() * 0.25;
    let cy = pts.iter().map(|p| p[1]).sum::<f64>() * 0.25;
    let w = (l0 + l2) * 0.5;
    let h = (l1 + l3) * 0.5;
    let angle = e0[1].atan2(e0[0]);
    Some((
        [cx - w * 0.5, cy - h * 0.5],
        [cx + w * 0.5, cy + h * 0.5],
        Some(Adjustment {
            rotation: angle.to_degrees(),
            ..Default::default()
        }),
    ))
}

#[allow(clippy::type_complexity)]
fn native_shape(
    sh: &ShapeEl,
    s: impl Fn(f32) -> f64 + Copy,
) -> Option<(ShapeKind, [f64; 2], [f64; 2], Option<Adjustment>)> {
    let rot = f64::from(sh.rotation);
    match sh.kind {
        Kind::Rect => {
            let a = [s(sh.x), s(sh.y)];
            let b = [s(sh.x + sh.w), s(sh.y + sh.h)];
            Some((ShapeKind::Rectangle, a, b, rotation_around(a, a, b, rot)))
        }
        Kind::Triangle => {
            let a = [s(sh.x), s(sh.y)];
            let b = [s(sh.x + sh.w), s(sh.y + sh.h)];
            Some((ShapeKind::Triangle, a, b, rotation_around(a, a, b, rot)))
        }
        Kind::Ellipse => {
            let pivot = [s(sh.x), s(sh.y)];
            let a = [s(sh.x - sh.w), s(sh.y - sh.h)];
            let b = [s(sh.x + sh.w), s(sh.y + sh.h)];
            Some((ShapeKind::Ellipse, a, b, rotation_around(pivot, a, b, rot)))
        }
        Kind::Diamond if (sh.w - sh.h).abs() <= sh.w.max(sh.h) * 0.05 && sh.w > 0. => {
            let pivot = [s(sh.x), s(sh.y)];
            let cx = s(sh.x + sh.w * 0.5);
            let cy = s(sh.y + sh.h * 0.5);
            let half = s((sh.w + sh.h) * 0.25) / std::f64::consts::SQRT_2;
            let a = [cx - half, cy - half];
            let b = [cx + half, cy + half];
            let mut adj = rotation_around(pivot, a, b, rot).unwrap_or_default();
            adj.rotation += 45.0;
            Some((ShapeKind::Rectangle, a, b, Some(adj)))
        }
        Kind::Polygon => {
            let (a, b, adj) = polygon_as_rect(&sh.points, s)?;
            Some((ShapeKind::Rectangle, a, b, adj))
        }
        _ => None,
    }
}

/// Renders a crisp 2×2 supersampled anti-aliased RGBA PNG for a Sticky Note prefab, anchored
/// flush at top-left (0, 0) with a soft bottom-right shadow, subtle darker top adhesive strip,
/// and smooth folded bottom-right corner.
fn sticky_note_png(width: f64, height: f64, rgb: [f32; 3], fold: bool) -> Vec<u8> {
    let w_u = width.clamp(60., 800.);
    let h_u = height.clamp(60., 800.);
    let scale = (512.0 / w_u.max(h_u)).clamp(1.0, 2.0);
    let pw = (w_u * scale).round().clamp(96., 512.) as usize;
    let ph = (h_u * scale).round().clamp(96., 512.) as usize;
    let sh_pad = 4.0 * scale;
    let bw = (pw as f64 - sh_pad).max(24.0);
    let bh = (ph as f64 - sh_pad).max(24.0);
    let fold_px = if fold {
        (bw.min(bh) * 0.115).round()
    } else {
        0.0
    };
    let strip_h = (bh * 0.095).clamp(12.0 * scale, 26.0 * scale);
    let border_w = (1.1 * scale).max(1.0);

    let base = [
        (rgb[0].clamp(0., 1.) * 255.),
        (rgb[1].clamp(0., 1.) * 255.),
        (rgb[2].clamp(0., 1.) * 255.),
    ];
    let darken = |c: [f32; 3], amt: f32| -> [f64; 3] {
        [0, 1, 2].map(|i| f64::from((c[i] * (1. - amt)).clamp(0., 255.)))
    };
    let c_base = darken(base, 0.0);
    let c_header = darken(base, 0.065);
    let c_border = darken(base, 0.18);
    let c_fold = darken(base, 0.12);
    let c_fold_sh = darken(base, 0.21);

    let in_body = |x: f64, y: f64, ox: f64, oy: f64| -> bool {
        let lx = x - ox;
        let ly = y - oy;
        if lx < 0.0 || ly < 0.0 || lx > bw || ly > bh {
            return false;
        }
        if fold_px > 0.0 && lx > bw - fold_px && ly > bh - fold_px {
            (lx - (bw - fold_px)) + (ly - (bh - fold_px)) <= fold_px
        } else {
            true
        }
    };

    let fx = bw - fold_px;
    let fy = bh - fold_px;
    let sh_ox = 2.2 * scale;
    let sh_oy = 3.0 * scale;

    let sample = |sx: f64, sy: f64| -> [f64; 4] {
        let mut px = [0.0, 0.0, 0.0, 0.0];
        if in_body(sx, sy, sh_ox, sh_oy) {
            px = [15.0, 23.0, 42.0, 30.0];
        }
        if in_body(sx, sy, 0.0, 0.0) {
            let diag_dist = if fold_px > 0.0 && sx >= fx && sy >= fy {
                (fold_px - ((sx - fx) + (sy - fy))) * std::f64::consts::FRAC_1_SQRT_2
            } else {
                999.0
            };
            let on_edge = sx < border_w
                || sy < border_w
                || sx > bw - border_w
                || sy > bh - border_w
                || diag_dist < border_w;
            let c = if on_edge {
                c_border
            } else if fold_px > 0.0 && sx >= fx && sy >= fy {
                if sx - fx < border_w * 0.9 || sy - fy < border_w * 0.9 {
                    c_border
                } else {
                    c_fold
                }
            } else if fold_px > 0.0
                && sy >= fy
                && sx < fx
                && sx >= fx - 3.2 * scale
                && (sy - fy) * (3.2 * scale) >= (fx - sx) * fold_px
            {
                c_fold_sh
            } else if sy < strip_h {
                c_header
            } else {
                c_base
            };
            px = [c[0], c[1], c[2], 255.0];
        }
        px
    };

    // 2×2 supersampling for crisp anti-aliased folded corner and borders.
    let offsets = [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)];
    let mut raw = Vec::with_capacity(ph * (1 + pw * 4));
    for y in 0..ph {
        raw.push(0);
        for x in 0..pw {
            let (mut r, mut g, mut b, mut a) = (0.0, 0.0, 0.0, 0.0);
            for (ox, oy) in offsets {
                let s = sample(x as f64 + ox, y as f64 + oy);
                let sa = s[3] / 255.0;
                r += s[0] * sa;
                g += s[1] * sa;
                b += s[2] * sa;
                a += sa;
            }
            let out_a = (a * 0.25).clamp(0.0, 1.0);
            let (or, og, ob) = if a > 1e-6 {
                (
                    (r / a).clamp(0., 255.),
                    (g / a).clamp(0., 255.),
                    (b / a).clamp(0., 255.),
                )
            } else {
                (0.0, 0.0, 0.0)
            };
            raw.push(or.round() as u8);
            raw.push(og.round() as u8);
            raw.push(ob.round() as u8);
            raw.push((out_a * 255.0).round() as u8);
        }
    }

    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    let _ = encoder.write_all(&raw);
    let compressed = encoder.finish().unwrap_or_default();

    let mut png = Vec::with_capacity(compressed.len() + 64);
    png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&(pw as u32).to_be_bytes());
    ihdr.extend_from_slice(&(ph as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    write_png_chunk(&mut png, b"IHDR", &ihdr);
    write_png_chunk(&mut png, b"IDAT", &compressed);
    write_png_chunk(&mut png, b"IEND", &[]);
    png
}

fn write_png_chunk(out: &mut Vec<u8>, tag: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(tag);
    out.extend_from_slice(data);
    let crc = crc32(tag, data);
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32(tag: &[u8; 4], data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in tag.iter().chain(data.iter()) {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn rgb_to_hex(rgb: [f32; 3]) -> String {
    let c = |v: f32| (v.clamp(0., 1.) * 255.).round() as u8;
    format!("#{:02x}{:02x}{:02x}", c(rgb[0]), c(rgb[1]), c(rgb[2]))
}

fn point_in_rect(p: [f64; 2], r: [f64; 4], pad: f64) -> bool {
    p[0] >= r[0] - pad
        && p[0] <= r[0] + r[2] + pad
        && p[1] >= r[1] - pad
        && p[1] <= r[1] + r[3] + pad
}

fn convert_page(
    doc: &Document,
    page: &Page,
    slot: usize,
    size: [f64; 2],
    scale: f64,
    warnings: &mut Warnings,
) -> PageOut {
    let mut out = PageOut::default();
    let s = |v: f32| f64::from(v) * scale;
    let pt = |v: f32| (f64::from(v) * scale / UNITS_PER_POINT) as f32;
    let page_h = (size[1] / UNITS_PER_POINT) as f32;
    let has_pdf = page
        .items
        .iter()
        .any(|it| matches!(it, Item::PdfBackground(_)));
    let fill = |out: &mut PageOut, contours: &[Vec<[f32; 2]>], c: [f32; 4]| -> bool {
        if has_pdf {
            return false;
        }
        let content = out.paper.get_or_insert_with(Content::new);
        let [r, g, b] = over_white(c);
        content.set_fill_rgb(r, g, b);
        for contour in contours {
            for (i, p) in contour.iter().enumerate() {
                let (x, y) = (pt(p[0]), page_h - pt(p[1]));
                if i == 0 {
                    content.move_to(x, y);
                } else {
                    content.line_to(x, y);
                }
            }
            content.close_path();
        }
        content.fill_nonzero();
        true
    };
    let rect =
        |x: f32, y: f32, w: f32, h: f32| vec![[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    let make_line = |points: &[[f32; 2]], width: f32, c: [f32; 4], smooth: bool| -> Option<Line> {
        let mut points: Vec<[f64; 2]> = points.iter().map(|p| [s(p[0]), s(p[1])]).collect();
        if points.is_empty() || points.iter().flatten().any(|v| !v.is_finite()) {
            return None;
        }
        if points.len() == 1 {
            points.push(points[0]);
        } else if smooth {
            points = smooth_stroke_points(points);
        }
        if points.len() > 8192 {
            let step = points.len().div_ceil(8000);
            let last = *points.last().expect("not empty");
            points = points.into_iter().step_by(step).collect();
            points.push(last);
        }
        let width = s(width);
        let width = if width.is_finite() {
            width.clamp(0.1, 100.)
        } else {
            1.
        };
        let mut col = rgba(c);
        let is_highlighter = col[3] < 0.95 && col[3] >= 0.01;
        let mut l = Line::new(points, width, col);
        if is_highlighter {
            // Noteful highlighter (`tool = 1`) renders with `mix-blend-mode: multiply` and
            // halves stored alpha (`scene::composite`), so double alpha up to 1.0 to match.
            l.tool = 1;
            col[3] = (col[3] * 2.0).min(1.0);
            l.rgba = col;
        }
        Some(l)
    };

    // Pass 1: create sticky note overlays first so we can bind their author text and `parented`
    // handwritten strokes directly onto them.
    let mut sticky_indices: Vec<usize> = Vec::new();
    let mut consumed_texts: HashSet<usize> = HashSet::new();
    let mut sticky_idx = 0usize;
    for (idx, item) in page.items.iter().enumerate() {
        let Item::Sticky(st) = item else { continue };
        let (x, y, w, h) = (s(st.x), s(st.y), s(st.w).max(20.), s(st.h).max(20.));
        if ![x, y, w, h].iter().all(|v| v.is_finite()) {
            continue;
        }
        let id = format!("sticky-{slot}-{sticky_idx}");
        let ink_part_id = format!("{id}:ink");
        sticky_idx += 1;
        let mut owned_texts = Vec::new();
        let mut author_name = String::new();
        // Goodnotes/oblyx emits the sticky note's author footer as the Item::Text right after it.
        if let Some(Item::Text(t)) = page.items.get(idx + 1) {
            let tx = s(t.x);
            let ty = s(t.y);
            if point_in_rect([tx, ty], [x, y, w, h], 10.) && t.size <= 14.5 {
                let text: String = t.text.trim().chars().take(200).collect();
                if !text.is_empty() {
                    consumed_texts.insert(idx + 1);
                    author_name = text.clone();
                    let size = s(t.size).clamp(8., 16.);
                    // Place cleanly inside the bottom-left padding so it never clips the border.
                    let pad_x = 12.0_f64.min(w * 0.12);
                    let box_h = size * 1.45;
                    let box_y = (y + h - box_h - 8.0).max(y + 18.0);
                    let box_w = (w - pad_x * 2.0 - 24.0).max(40.0);
                    owned_texts.push(Image {
                        base64: String::new(),
                        mime: String::new(),
                        bounds: [x + pad_x, box_y, box_w, box_h],
                        layer: 0,
                        text: Some(TextBox {
                            text,
                            font_size: size,
                            rgba: [t.rgb[0], t.rgb[1], t.rgb[2], 0.78]
                                .map(|v| f64::from(v).clamp(0., 1.)),
                            bold: t.bold,
                            italic: false,
                            font: "Helvetica".into(),
                            align: 0,
                            underline: false,
                            strikethrough: false,
                            math: false,
                            line_height: None,
                            spans: vec![],
                        }),
                        joined: false,
                        part: Some(Part {
                            id: ink_part_id.clone(),
                            kind: "prefab".into(),
                            spec: None,
                        }),
                        under: false,
                    });
                }
            }
        }
        let hex = rgb_to_hex(st.rgb);
        let spec = serde_json::json!({
            "module": "stickynote",
            "type": "stickynote",
            "color": hex,
            "title": "",
            "text": "",
            "author": author_name,
            "fontSize": 15,
            "fold": true,
            "lines": false,
            "width": w.round().clamp(120., 800.) as i64,
            "height": h.round().clamp(120., 800.) as i64,
        })
        .to_string();
        let png = sticky_note_png(w, h, st.rgb, true);
        let mut frame = Line::new(vec![[x, y], [x + w, y + h]], 0.5, [0., 0., 0., 0.]);
        frame.shape = Some(Shape {
            kind: ShapeKind::Rectangle,
            start: [x, y],
            end: [x + w, y + h],
            fill: None,
        });
        frame.part = Some(Part {
            id: id.clone(),
            kind: "prefab".into(),
            spec: Some(spec),
        });
        let picture = Image {
            base64: STANDARD.encode(&png),
            mime: "image/png".into(),
            bounds: [x, y, w, h],
            layer: 0,
            text: None,
            joined: true,
            part: Some(Part {
                id: id.clone(),
                kind: "prefab".into(),
                spec: None,
            }),
            under: false,
        };
        let overlay_pos = out.overlays.len();
        out.overlays.push(Overlay::Sticky {
            id,
            bounds: [x, y, w, h],
            frame,
            picture,
            owned_texts,
            owned_lines: Vec::new(),
        });
        sticky_indices.push(overlay_pos);
    }

    // Pass 2: convert all other items, attaching `parented` strokes to their sticky note overlay.
    for (idx, item) in page.items.iter().enumerate() {
        match item {
            Item::Stroke(st) => match make_line(&st.points, st.width, st.rgba, true) {
                Some(mut l) => {
                    if st.parented && !sticky_indices.is_empty() {
                        // Find the sticky note containing this parented stroke (or the only sticky).
                        let mid = l.points[l.points.len() / 2];
                        let target = sticky_indices
                            .iter()
                            .copied()
                            .find(|&oi| match &out.overlays[oi] {
                                Overlay::Sticky { bounds, .. } => point_in_rect(mid, *bounds, 12.),
                                _ => false,
                            })
                            .or_else(|| (sticky_indices.len() == 1).then_some(sticky_indices[0]));
                        if let Some(oi) = target {
                            if let Overlay::Sticky {
                                id, owned_lines, ..
                            } = &mut out.overlays[oi]
                            {
                                l.part = Some(Part {
                                    id: format!("{id}:ink"),
                                    kind: "prefab".into(),
                                    spec: None,
                                });
                                owned_lines.push(l);
                                continue;
                            }
                        }
                    }
                    out.elements.push(Element::Line(l));
                }
                None => warnings.add("Strokes that could not be read"),
            },
            Item::Path(p) => {
                if p.points.len() >= 2 && p.width > 0. {
                    out.elements
                        .extend(make_line(&p.points, p.width, p.rgba, false).map(Element::Line));
                }
                if let Some(head) = p.head {
                    let mut contour = head.to_vec();
                    contour.push(head[0]);
                    if !fill(&mut out, &[head.to_vec()], p.rgba) {
                        out.elements.extend(
                            make_line(&contour, p.width.max(1.), p.rgba, false).map(Element::Line),
                        );
                    }
                }
            }
            Item::Shape(sh) => {
                let has_fill = sh.fill[3] >= 0.004;
                let has_stroke = sh.stroke[3] >= 0.004 && sh.width > 0.;
                if let Some((kind, a, b, adjustment)) = native_shape(sh, s) {
                    let (c, width) = if has_stroke {
                        (sh.stroke, sh.width)
                    } else {
                        (sh.fill, 1.)
                    };
                    let width = s(width);
                    let width = if width.is_finite() {
                        width.clamp(0.1, 100.)
                    } else {
                        1.
                    };
                    if a.iter().chain(&b).all(|v| v.is_finite()) {
                        let mut l = Line::new(vec![a, b], width, rgba(c));
                        l.shape = Some(Shape {
                            kind,
                            start: a,
                            end: b,
                            fill: has_fill.then(|| rgba(sh.fill)),
                        });
                        // Filled shapes sit cleanly below imported ink so handwriting stays legible.
                        l.under = has_fill;
                        out.overlays.push(Overlay::Shape {
                            line: l,
                            adjustment,
                        });
                    }
                    if sh.radius > 0.01 {
                        warnings.add("Rounded corners drawn square");
                    }
                    continue;
                }
                let outline = shape_outline(sh);
                if has_fill && !fill(&mut out, std::slice::from_ref(&outline), sh.fill) {
                    warnings.add("Shape fills over a PDF page left out");
                }
                if has_stroke || !has_fill {
                    let c = if has_stroke { sh.stroke } else { sh.fill };
                    out.elements.extend(
                        make_line(&outline, sh.width.max(0.5), c, false).map(Element::Line),
                    );
                }
            }
            Item::FillPath(fp) => {
                if fp.rgba[3] >= 0.004 && !fill(&mut out, &fp.contours, fp.rgba) {
                    warnings.add("Filled drawings over a PDF page left out");
                }
            }
            Item::Sticky(_) => {
                // Already handled in Pass 1.
            }
            Item::Background(bg) => {
                for (x, y, w, h, rgb) in &bg.rects {
                    fill(
                        &mut out,
                        &[rect(*x, *y, *w, *h)],
                        [rgb[0], rgb[1], rgb[2], 1.],
                    );
                }
            }
            Item::Text(t) => {
                if consumed_texts.contains(&idx) {
                    continue;
                }
                let text: String = t.text.chars().take(20_000).collect();
                if text.trim().is_empty() {
                    continue;
                }
                let size = s(t.size).clamp(2., 400.);
                let rows = text.lines().count().max(1) as f64;
                let cols = text
                    .lines()
                    .map(|l| l.chars().count())
                    .max()
                    .unwrap_or(1)
                    .max(1) as f64;
                let bounds = [
                    s(t.x),
                    s(t.y) - size * 0.95,
                    cols * size * 0.6,
                    rows * size * 1.3,
                ];
                out.elements.push(Element::Image(Image {
                    base64: String::new(),
                    mime: String::new(),
                    bounds,
                    layer: 0,
                    text: Some(TextBox {
                        text,
                        font_size: size,
                        rgba: [t.rgb[0], t.rgb[1], t.rgb[2], 1.]
                            .map(|v| f64::from(v).clamp(0., 1.)),
                        bold: t.bold,
                        italic: false,
                        font: "Helvetica".into(),
                        align: 0,
                        underline: false,
                        strikethrough: false,
                        math: false,
                        line_height: None,
                        spans: vec![],
                    }),
                    joined: false,
                    part: None,
                    under: false,
                }));
            }
            Item::Image(im) => {
                let bytes = im
                    .bytes
                    .clone()
                    .or_else(|| doc.attachments.get(&im.attachment).cloned());
                let Some(bytes) = bytes else {
                    warnings.add("Pictures missing from the notebook");
                    continue;
                };
                let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    "image/png"
                } else if bytes.starts_with(b"\xff\xd8\xff") {
                    "image/jpeg"
                } else {
                    warnings.add("Pictures in a format other than PNG or JPEG left out");
                    continue;
                };
                out.elements.push(Element::Image(Image {
                    base64: STANDARD.encode(bytes.as_slice()),
                    mime: mime.into(),
                    bounds: [s(im.x), s(im.y), s(im.w).max(1.), s(im.h).max(1.)],
                    layer: 0,
                    text: None,
                    joined: false,
                    part: None,
                    under: false,
                }));
            }
            Item::PdfBackground(bg) => {
                out.pdf = Some((
                    bg.attachment.clone(),
                    bg.pdf_page.saturating_sub(1),
                    [s(bg.x), s(bg.y), s(bg.w), s(bg.h)],
                ));
            }
            Item::Connector(_) => warnings.add("Connectors left out"),
        }
    }
    if has_pdf {
        out.paper = None;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stroke_order(doc: &Document, src: &oblyx::doc::PageSource) -> Vec<f32> {
        let page = doc.decode_page(src, false).unwrap();
        page.items
            .iter()
            .filter_map(|it| match it {
                Item::Stroke(s) => Some(s.points[0][0]),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn goodnotes_records_are_read_in_clock_order() {
        use oblyx::doc::{PageSource, Stroke};
        let strokes = [10., 20., 30., 40.].map(|x| {
            Item::Stroke(Stroke {
                points: vec![[x, 10.], [x, 50.]],
                width: 2.,
                rgba: [0., 0., 0., 1.],
                dash: None,
                parented: false,
            })
        });
        let page = Page::new("page", strokes.to_vec());
        let bytes =
            oblyx::goodnotes_write::write_goodnotes_to_vec(&[page], &Document::empty()).unwrap();
        let doc = Document::from_bytes(bytes).unwrap();
        let src = &doc.pages[0];
        assert!(chronological(src).is_none());
        assert_eq!(stroke_order(&doc, src), [10., 20., 30., 40.]);
        let recs = oblyx::pb::records(&src.data).unwrap();
        let mut data = Vec::new();
        for unit in recs.chunks(2).rev() {
            for rec in unit {
                push_record(&mut data, rec);
            }
        }
        let shuffled = PageSource {
            uuid: src.uuid.clone(),
            data,
        };
        assert_eq!(stroke_order(&doc, &shuffled), [40., 30., 20., 10.]);
        let ordered = chronological(&shuffled).unwrap();
        assert_eq!(stroke_order(&doc, &ordered), [10., 20., 30., 40.]);
    }

    #[test]
    fn polygon_rectangles_and_rotated_shapes_stay_native() {
        let poly = ShapeEl {
            kind: Kind::Polygon,
            x: 58.6,
            y: 116.3,
            w: 556.4,
            h: 58.8,
            points: vec![
                [615.069, 116.255],
                [615.069, 175.105],
                [58.635, 174.905],
                [58.635, 116.255],
            ],
            rotation: 0.0,
            fill: [0.1, 0.2, 0.7, 0.25],
            stroke: [0.1, 0.2, 0.7, 1.0],
            width: 1.56,
            dash: None,
            radius: 0.0,
            uuid: None,
            from_f9: false,
        };
        let (kind, a, b, adj) = native_shape(&poly, f64::from).expect("polygon rect");
        assert_eq!(kind, ShapeKind::Rectangle);
        assert!(adj.is_none());
        assert!((a[0] - 58.635).abs() < 0.01 && (b[0] - 615.069).abs() < 0.01);

        let rotated = ShapeEl {
            kind: Kind::Rect,
            x: 100.,
            y: 100.,
            w: 80.,
            h: 40.,
            points: vec![],
            rotation: std::f32::consts::FRAC_PI_4,
            fill: [0.2, 0.6, 0.2, 0.3],
            stroke: [0.2, 0.6, 0.2, 1.0],
            width: 2.0,
            dash: None,
            radius: 0.0,
            uuid: None,
            from_f9: false,
        };
        let (kind, _, _, adj) = native_shape(&rotated, f64::from).expect("rotated rect");
        assert_eq!(kind, ShapeKind::Rectangle);
        assert!((adj.unwrap().rotation - 45.0).abs() < 1e-4);
    }

    #[test]
    fn sticky_note_png_is_valid_rgba_png() {
        let png = sticky_note_png(256., 256., [0.98, 0.91, 0.47], true);
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(png.len() > 100 && png.len() < 65_536);
    }

    #[test]
    fn sticky_notes_cover_page_ink_and_own_their_parented_strokes() {
        use oblyx::doc::{Sticky, Stroke};
        let page = Page::new(
            "page",
            vec![
                // Background page stroke underneath the sticky note (not parented)
                Item::Stroke(Stroke {
                    points: vec![[80., 280.], [160., 280.]],
                    width: 2.,
                    rgba: [0.1, 0.1, 0.1, 1.],
                    dash: None,
                    parented: false,
                }),
                Item::Sticky(Sticky {
                    x: 60.,
                    y: 80.,
                    w: 256.,
                    h: 256.,
                    rgb: [0.98, 0.91, 0.47],
                }),
                // Author text immediately following sticky
                Item::Text(oblyx::doc::TextBox {
                    x: 68.,
                    y: 324.,
                    size: 12.,
                    text: "Ana".into(),
                    font: None,
                    rgb: [0.3, 0.15, 0.0],
                    bold: false,
                }),
                // Stroke written ON TOP of the sticky note (parented)
                Item::Stroke(Stroke {
                    points: vec![[100., 120.], [140., 140.], [180., 130.]],
                    width: 2.,
                    rgba: [0.1, 0.1, 0.1, 1.],
                    dash: None,
                    parented: true,
                }),
            ],
        );
        let mut warnings = Warnings::default();
        let bytes = build_bytes(
            "Sticky",
            &Document::empty(),
            &[page],
            1.,
            Stacking::PicturesUnderInk,
            &mut warnings,
        )
        .unwrap();
        assert!(warnings.finish().is_empty());
        assert!(noteful_core::is_project_archive(&bytes));
        let editor = Editor::open_project_bytes(&bytes).unwrap();
        let view = editor.view(0).unwrap();
        let parts = view["parts"].as_array().unwrap();
        assert_eq!(
            parts.len(),
            4,
            "frame + picture + owned stroke + author text"
        );
        let sticky_parts: Vec<_> = parts.iter().filter(|p| p["id"] == "sticky-0-0").collect();
        let owned_parts: Vec<_> = parts
            .iter()
            .filter(|p| p["id"] == "sticky-0-0:ink")
            .collect();
        assert_eq!(sticky_parts.len(), 2);
        assert_eq!(owned_parts.len(), 2);
        let svg = view["svg"].as_str().unwrap();
        let bg_stroke_at = svg.find("data-item=\"stroke:").unwrap();
        let img_at = svg.find("<image").unwrap();
        let owned_stroke_at = svg.find("data-item=\"new:2\"").unwrap();
        assert!(
            bg_stroke_at < img_at && img_at < owned_stroke_at,
            "page ink < sticky card < owned sticky ink"
        );
        assert_eq!(view["can_undo"], false);
    }

    #[test]
    fn highlighters_render_under_opaque_ink_with_multiply_and_curves_smooth() {
        use oblyx::doc::Stroke;
        let page = Page::new(
            "page",
            vec![
                Item::Stroke(Stroke {
                    points: vec![[40., 60.], [80., 80.], [120., 60.], [160., 80.]],
                    width: 2.,
                    rgba: [0.1, 0.1, 0.1, 1.0],
                    dash: None,
                    parented: false,
                }),
                // Translucent highlighter drawn AFTER the pen stroke
                Item::Stroke(Stroke {
                    points: vec![[35., 70.], [165., 70.]],
                    width: 18.,
                    rgba: [1.0, 0.9, 0.2, 0.4],
                    dash: None,
                    parented: false,
                }),
            ],
        );
        let mut warnings = Warnings::default();
        let bytes = build_bytes(
            "HL",
            &Document::empty(),
            &[page],
            1.,
            Stacking::PicturesUnderInk,
            &mut warnings,
        )
        .unwrap();
        let editor = Editor::open(&bytes).unwrap();
        let svg = editor.view(0).unwrap()["svg"].as_str().unwrap().to_owned();
        let hl_at = svg
            .find("mix-blend-mode:multiply")
            .expect("highlighter multiply");
        let pen_at = svg.rfind("data-item=\"stroke:").unwrap();
        assert!(
            hl_at < pen_at,
            "highlighter must sit underneath opaque pen ink"
        );
        let smoothed = smooth_stroke_points(vec![[0., 0.], [10., 10.], [20., 0.]]);
        assert!(
            smoothed.len() > 3,
            "curved strokes should be subdivided smoothly"
        );
    }
}
