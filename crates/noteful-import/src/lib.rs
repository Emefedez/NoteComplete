//! Goodnotes (`.goodnotes`) and Notability (`.ntb`) notebooks made into Noteful notes that
//! NoteComplete edits. The notebook is read with oblyx and rebuilt as a Noteful note: ink as
//! strokes, typed text as text boxes, pictures as images, plain shapes as shapes, and the
//! notebook's own PDF pages as page backgrounds. What Noteful cannot hold as an item (paper
//! templates, filled paths, sticky notes) is drawn into a vector PDF behind the page, so the
//! page still looks as it did; anything else is left out with a warning. The original file is
//! kept with the project as its `origin`.
use base64::{engine::general_purpose::STANDARD, Engine};
use noteful_core::{
    Editor, Image, Line, NewPdf, Origin, PageBackground, PdfPlacement, Shape, ShapeKind, TextBox,
};
use oblyx::doc::{Document, Item, Page, ShapeEl, ShapeKind as Kind};
use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref, TextStr};
use std::collections::BTreeMap;
use std::io::{Cursor, Read};

pub mod pdf_edit;

/// Noteful page units per PDF point.
const UNITS_PER_POINT: f64 = 11. / 6.;

/// A note made from a notebook, with what could not be brought over.
pub struct Imported {
    pub editor: Editor,
    pub warnings: Vec<String>,
}

/// `"goodnotes"` or `"notability"` when `bytes` is a notebook this crate imports.
pub fn format_of(bytes: &[u8]) -> Option<&'static str> {
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

/// A notebook made into a Noteful note: the note's bytes, before any edit.
pub struct Converted {
    pub noteful: Vec<u8>,
    pub format: &'static str,
    pub warnings: Vec<String>,
}

/// Import a Goodnotes or Notability notebook named `name` (its file name) as an editor whose
/// project keeps the notebook as its origin.
pub fn import(name: &str, bytes: &[u8]) -> Result<Imported, String> {
    let converted = convert(name, bytes)?;
    let mut editor = Editor::open(&converted.noteful).map_err(|e| e.message)?;
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

/// The Noteful note a notebook becomes (the browser builds the editor in its own engine).
pub fn convert(name: &str, bytes: &[u8]) -> Result<Converted, String> {
    let format = format_of(bytes).ok_or("Not a Goodnotes or Notability notebook")?;
    let (doc, pages, scale) = match format {
        "goodnotes" => goodnotes(bytes)?,
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
    let mut warnings = Warnings::default();
    let built = build(&title, &doc, &pages, scale, &mut warnings)?;
    Ok(Converted {
        noteful: built.export_noteful().map_err(|e| e.message)?,
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
            doc.decode_page(src, false)
                .unwrap_or_else(|_| Page::new(src.uuid.clone(), Vec::new()))
        })
        .collect();
    // Goodnotes pages are already in Noteful units (A4 points × 11/6).
    Ok((doc, pages, 1.))
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

/// What one page becomes.
#[derive(Default)]
struct PageOut {
    lines: Vec<Line>,
    images: Vec<Image>,
    /// Vector drawing for the paper PDF behind the page, in PDF points.
    paper: Option<Content>,
    /// The notebook's PDF behind the page: attachment, 0-based page, rect in units.
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

fn build(
    title: &str,
    doc: &Document,
    pages: &[Page],
    scale: f64,
    warnings: &mut Warnings,
) -> Result<Editor, String> {
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
    let mut editor = Editor::create_document(title, &sizes, &[]).map_err(|e| e.message)?;
    let mut outs: Vec<PageOut> = pages
        .iter()
        .zip(&sizes)
        .map(|(page, size)| convert_page(doc, page, *size, scale, warnings))
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
        if editor.set_page_backgrounds(changes, Some(pdf)).is_err() {
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
        editor
            .set_page_backgrounds(changes, Some(pdf))
            .map_err(|e| e.message)?;
    }

    for (slot, out) in outs.into_iter().enumerate() {
        for line in out.lines {
            if editor.add_line(slot, line).is_err() {
                warnings.add("Strokes or shapes that could not be read");
            }
        }
        for image in out.images {
            if editor.add_image(slot, image).is_err() {
                warnings.add("Pictures or text that could not be read");
            }
        }
    }
    Ok(editor)
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
        // A page's content: white paper, then what was drawn on it.
        let mut white = Content::new();
        white.set_fill_rgb(1., 1., 1.);
        white.rect(0., 0., size[0], size[1]);
        white.fill_nonzero();
        let mut bytes = white.finish().to_vec();
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
        // An ellipse is its centre and radii.
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

fn convert_page(
    doc: &Document,
    page: &Page,
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
    // Fills drawn into the page's paper PDF, or `false` when the page shows a notebook PDF.
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
    let line = |points: &[[f32; 2]], width: f32, c: [f32; 4]| -> Option<Line> {
        let mut points: Vec<[f64; 2]> = points.iter().map(|p| [s(p[0]), s(p[1])]).collect();
        if points.is_empty() || points.iter().flatten().any(|v| !v.is_finite()) {
            return None;
        }
        if points.len() == 1 {
            points.push(points[0]);
        }
        // Noteful keeps at most 8192 points a stroke: very long ones are thinned.
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
        Some(Line::new(points, width, rgba(c)))
    };

    for item in &page.items {
        match item {
            Item::Stroke(st) => match line(&st.points, st.width, st.rgba) {
                Some(l) => out.lines.push(l),
                None => warnings.add("Strokes that could not be read"),
            },
            Item::Path(p) => {
                if p.points.len() >= 2 && p.width > 0. {
                    out.lines.extend(line(&p.points, p.width, p.rgba));
                }
                if let Some(head) = p.head {
                    let mut contour = head.to_vec();
                    contour.push(head[0]);
                    if !fill(&mut out, &[head.to_vec()], p.rgba) {
                        out.lines.extend(line(&contour, p.width.max(1.), p.rgba));
                    }
                }
            }
            Item::Shape(sh) => {
                let has_fill = sh.fill[3] >= 0.004;
                let has_stroke = sh.stroke[3] >= 0.004 && sh.width > 0.;
                let native = match sh.kind {
                    _ if sh.rotation.abs() > 1e-3 => None,
                    Kind::Rect => Some((
                        ShapeKind::Rectangle,
                        [sh.x, sh.y],
                        [sh.x + sh.w, sh.y + sh.h],
                    )),
                    Kind::Triangle => Some((
                        ShapeKind::Triangle,
                        [sh.x, sh.y],
                        [sh.x + sh.w, sh.y + sh.h],
                    )),
                    Kind::Ellipse => Some((
                        ShapeKind::Ellipse,
                        [sh.x - sh.w, sh.y - sh.h],
                        [sh.x + sh.w, sh.y + sh.h],
                    )),
                    _ => None,
                };
                if let Some((kind, a, b)) = native {
                    // A Noteful shape: its outline (the fill colour when it has none) and its fill.
                    let (c, width) = if has_stroke {
                        (sh.stroke, sh.width)
                    } else {
                        (sh.fill, 1.)
                    };
                    if let Some(mut l) = line(&[a, b], width, c) {
                        l.shape = Some(Shape {
                            kind,
                            start: [s(a[0]), s(a[1])],
                            end: [s(b[0]), s(b[1])],
                            fill: has_fill.then(|| rgba(sh.fill)),
                        });
                        out.lines.push(l);
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
                    out.lines.extend(line(&outline, sh.width.max(0.5), c));
                }
            }
            Item::FillPath(fp) => {
                if fp.rgba[3] >= 0.004 && !fill(&mut out, &fp.contours, fp.rgba) {
                    warnings.add("Filled drawings over a PDF page left out");
                }
            }
            Item::Sticky(st) => {
                let c = [st.rgb[0], st.rgb[1], st.rgb[2], 1.];
                if !fill(&mut out, &[rect(st.x, st.y, st.w, st.h)], c) {
                    if let Some(mut l) = line(&[[st.x, st.y], [st.x + st.w, st.y + st.h]], 1., c) {
                        l.shape = Some(Shape {
                            kind: ShapeKind::Rectangle,
                            start: [s(st.x), s(st.y)],
                            end: [s(st.x + st.w), s(st.y + st.h)],
                            fill: Some(rgba(c)),
                        });
                        out.lines.push(l);
                    }
                }
            }
            Item::Background(bg) => {
                // The paper template; a page showing a PDF shows that instead.
                for (x, y, w, h, rgb) in &bg.rects {
                    fill(
                        &mut out,
                        &[rect(*x, *y, *w, *h)],
                        [rgb[0], rgb[1], rgb[2], 1.],
                    );
                }
            }
            Item::Text(t) => {
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
                // oblyx places text at its baseline.
                let bounds = [
                    s(t.x),
                    s(t.y) - size * 0.95,
                    cols * size * 0.6,
                    rows * size * 1.3,
                ];
                out.images.push(Image {
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
                    }),
                    joined: false,
                    part: None,
                });
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
                out.images.push(Image {
                    base64: STANDARD.encode(bytes.as_slice()),
                    mime: mime.into(),
                    bounds: [s(im.x), s(im.y), s(im.w).max(1.), s(im.h).max(1.)],
                    layer: 0,
                    text: None,
                    joined: false,
                    part: None,
                });
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

    #[test]
    fn other_files_are_not_notebooks() {
        assert_eq!(format_of(b"%PDF-1.7"), None);
        assert_eq!(format_of(b""), None);
        assert!(import("x.goodnotes", b"PK\x03\x04junk").is_err());
    }
}
