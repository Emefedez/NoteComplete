//! Edit PDF mode (docs/PDF-EDITOR.md): the printed text of one PDF page as blocks that the
//! reader turns into text boxes, and the same page without those blocks' text.
//!
//! A small content-stream interpreter follows the graphics and text state of one page and
//! reports every text-showing operator (`Tj`, `TJ`, `'`, `"`) as a run: its index among the
//! page's operators, its box in PDF user space (from the font's widths), font, size and fill
//! colour. Runs are grouped into lines and lines into blocks. A converted block's runs are
//! taken out of a one-page copy of the PDF ([`PdfEdit::without_runs`]); the reader shows that
//! copy as the page's background, so the original file is never changed.
//!
//! Text in form XObjects, rotated or mirrored text and invisible text (render mode 3, the OCR
//! layer of scans) is counted but not offered for editing.
use lopdf::{
    content::{Content, Operation},
    Dictionary, Document, LoadOptions, Object, ObjectId,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Largest content stream (or font program) read, decompressed.
const LIMIT: usize = 64 << 20;
/// Most operators interpreted on one page.
const MAX_OPS: usize = 2_000_000;

/// One PDF, parsed once, for the pages the reader asks about.
pub struct PdfEdit {
    doc: Document,
    /// Font programs seen on interpreted pages, by short hash.
    fonts: HashMap<String, FontProgram>,
}

#[derive(Clone)]
struct FontProgram {
    kind: &'static str,
    bytes: Vec<u8>,
}

type Matrix = [f64; 6];
const IDENTITY: Matrix = [1., 0., 0., 1., 0., 0.];
fn mul(a: &Matrix, b: &Matrix) -> Matrix {
    [
        a[0] * b[0] + a[1] * b[2],
        a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2],
        a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4],
        a[4] * b[1] + a[5] * b[3] + b[5],
    ]
}
fn apply(m: &Matrix, x: f64, y: f64) -> [f64; 2] {
    [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/// What the interpreter knows of a font resource.
struct Font {
    base: String,
    two_byte: bool,
    /// Glyph width in text space units per 1000 (Type 3: in glyph space, see `scale`).
    first: i64,
    widths: Vec<f64>,
    cid_widths: HashMap<u32, f64>,
    default_width: f64,
    scale: f64,
    ascent: f64,
    descent: f64,
    bold: bool,
    italic: bool,
    serif: bool,
    mono: bool,
    /// Short hash of an embedded TrueType or OpenType program a browser can load.
    program: Option<String>,
    /// "truetype", "opentype", "cff", "type1", "type3" or "" (not embedded).
    embedded: &'static str,
}
impl Font {
    fn width(&self, code: u32) -> f64 {
        if self.two_byte {
            return *self.cid_widths.get(&code).unwrap_or(&self.default_width);
        }
        let i = code as i64 - self.first;
        if i >= 0 && (i as usize) < self.widths.len() {
            let w = self.widths[i as usize];
            if w > 0. {
                return w;
            }
        }
        self.default_width
    }
}

#[derive(Clone)]
struct State {
    ctm: Matrix,
    fill: [f64; 4],
    tc: f64,
    tw: f64,
    tz: f64,
    tl: f64,
    ts: f64,
    font: Option<Vec<u8>>,
    size: f64,
    mode: i64,
    /// Line width, in the user space of the moment it was set.
    lw: f64,
}
impl Default for State {
    fn default() -> Self {
        Self {
            ctm: IDENTITY,
            fill: [0., 0., 0., 1.],
            tc: 0.,
            tw: 0.,
            tz: 100.,
            tl: 0.,
            ts: 0.,
            font: None,
            size: 0.,
            mode: 0,
            lw: 1.,
        }
    }
}

/// What the interpreter found on a page: text runs, what was left out, the fonts by resource
/// name, and the things drawn that are not text (paths, images, form XObjects).
struct PageContent {
    runs: Vec<Run>,
    skipped: Skipped,
    fonts: BTreeMap<Vec<u8>, Font>,
    graphics: Vec<Graphic>,
}

/// Something drawn that is not text: its kind ("path", "image", "form"), the operator that
/// paints it, and its box in user space [x0, y0, x1, y1].
#[derive(Clone, Debug)]
struct Graphic {
    kind: &'static str,
    op: usize,
    bbox: [f64; 4],
}

/// Path-painting operators. Removing a path keeps its construction and ends it with `n`
/// (paints nothing), so a clip it also sets (`W`/`W*` before the painter) still applies.
const PATH_PAINT: [&str; 9] = ["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"];
const STROKES: [&str; 6] = ["S", "s", "B", "B*", "b", "b*"];
/// Operators that put marks on the page: text, paths, XObjects, inline images, shadings.
fn paints(op: &str) -> bool {
    PATH_PAINT.contains(&op) || matches!(op, "Tj" | "TJ" | "'" | "\"" | "Do" | "BI" | "sh")
}
fn bbox_of(points: &[[f64; 2]]) -> Option<[f64; 4]> {
    let first = points.first()?;
    Some(
        points
            .iter()
            .fold([first[0], first[1], first[0], first[1]], |b, p| {
                [
                    b[0].min(p[0]),
                    b[1].min(p[1]),
                    b[2].max(p[0]),
                    b[3].max(p[1]),
                ]
            }),
    )
}
fn union(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}
fn area(b: &[f64; 4]) -> f64 {
    (b[2] - b[0]).max(0.) * (b[3] - b[1]).max(0.)
}
/// Boxes that touch or overlap (within `margin`) gathered into groups, by indices: a sweep
/// along x, so a page of thousands of paths stays quick.
fn cluster(boxes: &[[f64; 4]], margin: f64) -> Vec<Vec<usize>> {
    let mut parent: Vec<usize> = (0..boxes.len()).collect();
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    let mut order: Vec<usize> = (0..boxes.len()).collect();
    order.sort_by(|a, b| boxes[*a][0].total_cmp(&boxes[*b][0]));
    let mut active: Vec<usize> = vec![];
    for &i in &order {
        let b = boxes[i];
        active.retain(|&j| boxes[j][2] + margin >= b[0]);
        for &j in &active {
            let o = boxes[j];
            if o[1] - margin <= b[3] && b[1] - margin <= o[3] {
                let (ri, rj) = (root(&mut parent, i), root(&mut parent, j));
                if ri != rj {
                    parent[ri] = rj;
                }
            }
        }
        active.push(i);
    }
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..boxes.len() {
        let r = root(&mut parent, i);
        groups.entry(r).or_default().push(i);
    }
    groups.into_values().collect()
}

/// One text-showing operator: where its glyphs are, horizontally laid out in user space.
#[derive(Clone, Debug)]
struct Run {
    op: usize,
    x0: f64,
    x1: f64,
    base: f64,
    top: f64,
    bottom: f64,
    /// Font size in user space units.
    size: f64,
    font: Vec<u8>,
    rgba: [f64; 4],
    text: String,
    chars: usize,
}

/// Counts of text left out of the blocks, for the reader to explain.
#[derive(Default)]
struct Skipped {
    rotated: usize,
    invisible: usize,
    forms: usize,
}

fn num(o: &Object) -> Option<f64> {
    o.as_float().ok().map(f64::from).filter(|n| n.is_finite())
}
fn nums(ops: &[Object]) -> Vec<f64> {
    ops.iter().filter_map(num).collect()
}

/// The subset prefix ("ABCDEF+") off a BaseFont name.
fn plain_name(base: &str) -> &str {
    match base.split_once('+') {
        Some((tag, rest)) if tag.len() == 6 && tag.bytes().all(|b| b.is_ascii_uppercase()) => rest,
        _ => base,
    }
}

impl PdfEdit {
    pub fn load(bytes: &[u8]) -> Result<Self, String> {
        let options = LoadOptions {
            max_decompressed_size: Some(LIMIT),
            ..LoadOptions::default()
        };
        let doc = Document::load_mem_with_options(bytes, options)
            .map_err(|e| format!("Could not read this PDF: {e}"))?;
        if doc.trailer.get(b"Encrypt").is_ok() && !doc.was_encrypted() {
            return Err("This PDF is protected with a password.".into());
        }
        Ok(Self {
            doc,
            fonts: HashMap::new(),
        })
    }

    fn page_id(&self, index: u32) -> Result<ObjectId, String> {
        self.doc
            .get_pages()
            .get(&(index + 1))
            .copied()
            .ok_or_else(|| format!("The PDF has no page {}.", index + 1))
    }

    fn operations(&self, page: ObjectId) -> Result<Vec<Operation>, String> {
        let bytes = self
            .doc
            .get_page_content_with_limit(page, LIMIT)
            .map_err(|e| format!("Could not read the page: {e}"))?;
        let content =
            Content::decode(&bytes).map_err(|e| format!("Could not read the page's text: {e}"))?;
        if content.operations.len() > MAX_OPS {
            return Err("The page is too complex to edit.".into());
        }
        Ok(content.operations)
    }

    /// A resource of the page (inherited ones too) by category and name.
    fn resource(&self, page: ObjectId, category: &[u8], name: &[u8]) -> Option<&Object> {
        let (direct, ids) = self.doc.get_page_resources(page).ok()?;
        let mut dicts: Vec<&Dictionary> = direct.into_iter().collect();
        dicts.extend(
            ids.iter()
                .filter_map(|id| self.doc.get_dictionary(*id).ok()),
        );
        for d in dicts {
            if let Ok(cat) = d.get_deref(category, &self.doc).and_then(Object::as_dict) {
                if let Ok(o) = cat.get_deref(name, &self.doc) {
                    return Some(o);
                }
            }
        }
        None
    }

    fn font(&mut self, page: ObjectId, name: &[u8]) -> Option<Font> {
        let dict = self.resource(page, b"Font", name)?.as_dict().ok()?.clone();
        let doc = &self.doc;
        let get_name = |d: &Dictionary, k: &[u8]| {
            d.get_deref(k, doc)
                .and_then(Object::as_name)
                .map(|n| String::from_utf8_lossy(n).into_owned())
                .ok()
        };
        let subtype = get_name(&dict, b"Subtype").unwrap_or_default();
        let base = get_name(&dict, b"BaseFont")
            .unwrap_or_else(|| String::from_utf8_lossy(name).into_owned());
        let two_byte = subtype == "Type0";
        let descendant = if two_byte {
            dict.get_deref(b"DescendantFonts", doc)
                .and_then(Object::as_array)
                .ok()
                .and_then(|a| a.first())
                .and_then(|o| doc.dereference(o).ok())
                .and_then(|(_, o)| o.as_dict().ok())
                .cloned()
        } else {
            None
        };
        let described = descendant.as_ref().unwrap_or(&dict);
        let descriptor = described
            .get_deref(b"FontDescriptor", doc)
            .and_then(Object::as_dict)
            .ok()
            .cloned();
        let mut font = Font {
            base: plain_name(&base).to_owned(),
            two_byte,
            first: dict
                .get_deref(b"FirstChar", doc)
                .ok()
                .and_then(|o| o.as_i64().ok())
                .unwrap_or(0),
            widths: dict
                .get_deref(b"Widths", doc)
                .and_then(Object::as_array)
                .map(|a| {
                    a.iter()
                        .map(|o| {
                            doc.dereference(o)
                                .ok()
                                .and_then(|(_, o)| num(o))
                                .unwrap_or(0.)
                        })
                        .collect()
                })
                .unwrap_or_default(),
            cid_widths: HashMap::new(),
            default_width: 500.,
            scale: 0.001,
            ascent: 0.8,
            descent: -0.2,
            bold: false,
            italic: false,
            serif: false,
            mono: false,
            program: None,
            embedded: "",
        };
        if subtype == "Type3" {
            font.scale = dict
                .get_deref(b"FontMatrix", doc)
                .and_then(Object::as_array)
                .ok()
                .and_then(|a| a.first())
                .and_then(num)
                .unwrap_or(0.001);
            font.embedded = "type3";
        }
        if let Some(d) = &descendant {
            font.default_width = d.get_deref(b"DW", doc).ok().and_then(num).unwrap_or(1000.);
            if let Ok(w) = d.get_deref(b"W", doc).and_then(Object::as_array) {
                // [c [w1 w2 …]] or [c_first c_last w].
                let mut i = 0;
                while i < w.len() && font.cid_widths.len() < 200_000 {
                    let Some(start) = num(&w[i]) else { break };
                    match w.get(i + 1).map(|o| doc.dereference(o).map(|(_, o)| o)) {
                        Some(Ok(Object::Array(list))) => {
                            for (k, o) in list.iter().enumerate() {
                                font.cid_widths.insert(
                                    start as u32 + k as u32,
                                    num(o).unwrap_or(font.default_width),
                                );
                            }
                            i += 2;
                        }
                        Some(Ok(end)) => {
                            let (Some(end), Some(width)) = (num(end), w.get(i + 2).and_then(num))
                            else {
                                break;
                            };
                            for c in (start as u32)..=(end as u32).min(start as u32 + 65_535) {
                                font.cid_widths.insert(c, width);
                            }
                            i += 3;
                        }
                        _ => break,
                    }
                }
            }
        }
        let lower = font.base.to_lowercase();
        if let Some(d) = &descriptor {
            let flags = d
                .get_deref(b"Flags", doc)
                .ok()
                .and_then(|o| o.as_i64().ok())
                .unwrap_or(0);
            font.mono = flags & 1 != 0;
            font.serif = flags & 2 != 0;
            font.italic = flags & 64 != 0
                || d.get_deref(b"ItalicAngle", doc)
                    .ok()
                    .and_then(num)
                    .is_some_and(|a| a.abs() > 1.);
            font.bold = flags & (1 << 18) != 0
                || d.get_deref(b"FontWeight", doc)
                    .ok()
                    .and_then(num)
                    .is_some_and(|w| w >= 600.);
            if let Some(a) = d
                .get_deref(b"Ascent", doc)
                .ok()
                .and_then(num)
                .filter(|a| *a > 100. && *a < 1500.)
            {
                font.ascent = a / 1000.;
            }
            if let Some(a) = d
                .get_deref(b"Descent", doc)
                .ok()
                .and_then(num)
                .filter(|a| *a < 0. && *a > -800.)
            {
                font.descent = a / 1000.;
            }
            if let Some(w) = d
                .get_deref(b"MissingWidth", doc)
                .ok()
                .and_then(num)
                .filter(|w| *w > 0.)
            {
                if !two_byte {
                    font.default_width = w;
                }
            }
            for (key, kind) in [
                (&b"FontFile2"[..], "truetype"),
                (b"FontFile3", "cff"),
                (b"FontFile", "type1"),
            ] {
                let Ok(stream) = d.get_deref(key, doc).and_then(Object::as_stream) else {
                    continue;
                };
                let kind = if kind == "cff"
                    && stream
                        .dict
                        .get(b"Subtype")
                        .and_then(Object::as_name)
                        .is_ok_and(|n| n == b"OpenType")
                {
                    "opentype"
                } else {
                    kind
                };
                font.embedded = kind;
                if matches!(kind, "truetype" | "opentype") {
                    if let Ok(bytes) = stream.get_plain_content_with_limit(LIMIT) {
                        if sfnt_loadable(&bytes) {
                            let hash = noteful_core::md5_hex(&bytes)[..8].to_owned();
                            self.fonts
                                .entry(hash.clone())
                                .or_insert(FontProgram { kind, bytes });
                            font.program = Some(hash);
                        }
                    }
                }
                break;
            }
        }
        font.bold |= ["bold", "black", "heavy", "semibold", "demi"]
            .iter()
            .any(|w| lower.contains(w));
        font.italic |= lower.contains("italic") || lower.contains("oblique");
        font.mono |= ["courier", "mono", "cmtt", "consol"]
            .iter()
            .any(|w| lower.contains(w));
        font.serif |= [
            "times", "serif", "roman", "georgia", "garamond", "cambria", "minion", "cmr",
            "lmroman", "palatino", "book",
        ]
        .iter()
        .any(|w| lower.contains(w))
            && !lower.contains("sans");
        if font.widths.is_empty() && !two_byte {
            // A standard 14 font without widths: Courier is fixed; the others average about half an em.
            font.default_width = if font.mono { 600. } else { 520. };
        }
        Some(font)
    }

    /// The page's text runs, in content order, and what was left out.
    fn runs(&mut self, page: ObjectId) -> Result<PageContent, String> {
        let ops = self.operations(page)?;
        let mut fonts: BTreeMap<Vec<u8>, Font> = BTreeMap::new();
        let mut encodings: HashMap<Vec<u8>, Option<lopdf::Encoding>> = HashMap::new();
        let mut skipped = Skipped::default();
        let mut runs = vec![];
        let mut graphics: Vec<Graphic> = vec![];
        // The path being built, in user space (the CTM cannot change while it is built).
        let mut path: Vec<[f64; 2]> = vec![];
        let mut gs = State::default();
        let mut stack: Vec<State> = vec![];
        let (mut tm, mut tlm) = (IDENTITY, IDENTITY);
        // Font dictionaries are read before interpreting, so encodings can borrow the document.
        for op in &ops {
            if op.operator == "Tf" {
                if let Some(Object::Name(n)) = op.operands.first() {
                    if !fonts.contains_key(n) {
                        if let Some(f) = self.font(page, n) {
                            fonts.insert(n.clone(), f);
                        }
                    }
                }
            }
        }
        let doc = &self.doc;
        let resource_font = |name: &[u8]| -> Option<&Dictionary> {
            let (direct, ids) = doc.get_page_resources(page).ok()?;
            let mut dicts: Vec<&Dictionary> = direct.into_iter().collect();
            dicts.extend(ids.iter().filter_map(|id| doc.get_dictionary(*id).ok()));
            dicts.into_iter().find_map(|d| {
                d.get_deref(b"Font", doc)
                    .and_then(Object::as_dict)
                    .ok()?
                    .get_deref(name, doc)
                    .and_then(Object::as_dict)
                    .ok()
            })
        };
        for (index, op) in ops.iter().enumerate() {
            let o = &op.operands;
            match op.operator.as_str() {
                "q" => stack.push(gs.clone()),
                "Q" => gs = stack.pop().unwrap_or_default(),
                "cm" => {
                    let n = nums(o);
                    if n.len() == 6 {
                        gs.ctm = mul(&[n[0], n[1], n[2], n[3], n[4], n[5]], &gs.ctm);
                    }
                }
                "BT" => {
                    tm = IDENTITY;
                    tlm = IDENTITY;
                }
                "Tf" => {
                    if let (Some(Object::Name(n)), Some(s)) = (o.first(), o.get(1).and_then(num)) {
                        gs.font = Some(n.clone());
                        gs.size = s;
                    }
                }
                "Tc" => gs.tc = o.first().and_then(num).unwrap_or(0.),
                "Tw" => gs.tw = o.first().and_then(num).unwrap_or(0.),
                "Tz" => gs.tz = o.first().and_then(num).unwrap_or(100.),
                "TL" => gs.tl = o.first().and_then(num).unwrap_or(0.),
                "Ts" => gs.ts = o.first().and_then(num).unwrap_or(0.),
                "Tr" => gs.mode = o.first().and_then(|o| o.as_i64().ok()).unwrap_or(0),
                "Td" | "TD" => {
                    let n = nums(o);
                    if n.len() == 2 {
                        if op.operator == "TD" {
                            gs.tl = -n[1];
                        }
                        tlm = mul(&[1., 0., 0., 1., n[0], n[1]], &tlm);
                        tm = tlm;
                    }
                }
                "Tm" => {
                    let n = nums(o);
                    if n.len() == 6 {
                        tlm = [n[0], n[1], n[2], n[3], n[4], n[5]];
                        tm = tlm;
                    }
                }
                "T*" => {
                    tlm = mul(&[1., 0., 0., 1., 0., -gs.tl], &tlm);
                    tm = tlm;
                }
                "g" => gs.fill = gray(o),
                "rg" => gs.fill = rgb(o),
                "k" => gs.fill = cmyk(o),
                "cs" => gs.fill = [0., 0., 0., 1.],
                "sc" | "scn" => {
                    let n = nums(o);
                    match n.len() {
                        1 => gs.fill = gray(o),
                        3 => gs.fill = rgb(o),
                        4 => gs.fill = cmyk(o),
                        _ => {}
                    }
                }
                "w" => gs.lw = o.first().and_then(num).unwrap_or(1.),
                "m" | "l" | "c" | "v" | "y" => {
                    let n = nums(o);
                    for [x, y] in n.as_chunks::<2>().0 {
                        path.push(apply(&gs.ctm, *x, *y));
                    }
                }
                "re" => {
                    let n = nums(o);
                    if n.len() == 4 {
                        for (x, y) in [
                            (n[0], n[1]),
                            (n[0] + n[2], n[1]),
                            (n[0], n[1] + n[3]),
                            (n[0] + n[2], n[1] + n[3]),
                        ] {
                            path.push(apply(&gs.ctm, x, y));
                        }
                    }
                }
                "n" => path.clear(),
                p if PATH_PAINT.contains(&p) => {
                    if let Some(mut b) = bbox_of(&path) {
                        if STROKES.contains(&p) {
                            // Half the line width out from the path, in user space.
                            let half = gs.lw.max(0.)
                                * (gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2]).abs().sqrt()
                                / 2.;
                            b = [b[0] - half, b[1] - half, b[2] + half, b[3] + half];
                        }
                        graphics.push(Graphic {
                            kind: "path",
                            op: index,
                            bbox: b,
                        });
                    }
                    path.clear();
                }
                "BI" => {
                    let corners = [
                        apply(&gs.ctm, 0., 0.),
                        apply(&gs.ctm, 1., 0.),
                        apply(&gs.ctm, 0., 1.),
                        apply(&gs.ctm, 1., 1.),
                    ];
                    if let Some(b) = bbox_of(&corners) {
                        graphics.push(Graphic {
                            kind: "image",
                            op: index,
                            bbox: b,
                        });
                    }
                }
                "Do" => {
                    if let Some(Object::Name(n)) = o.first() {
                        if let Some(Object::Stream(s)) = self.resource(page, b"XObject", n) {
                            let subtype = s
                                .dict
                                .get(b"Subtype")
                                .and_then(Object::as_name)
                                .unwrap_or(b"");
                            // An image fills the unit square; a form its BBox through its Matrix.
                            let (kind, rect, matrix) = if subtype == b"Image" {
                                ("image", [0., 0., 1., 1.], IDENTITY)
                            } else {
                                let r = s
                                    .dict
                                    .get(b"BBox")
                                    .and_then(Object::as_array)
                                    .map(|a| nums(a))
                                    .unwrap_or_default();
                                let m = s
                                    .dict
                                    .get(b"Matrix")
                                    .and_then(Object::as_array)
                                    .map(|a| nums(a))
                                    .unwrap_or_default();
                                let rect = if r.len() == 4 {
                                    [r[0], r[1], r[2], r[3]]
                                } else {
                                    [0., 0., 0., 0.]
                                };
                                let matrix = if m.len() == 6 {
                                    [m[0], m[1], m[2], m[3], m[4], m[5]]
                                } else {
                                    IDENTITY
                                };
                                ("form", rect, matrix)
                            };
                            let to = mul(&matrix, &gs.ctm);
                            let corners = [
                                apply(&to, rect[0], rect[1]),
                                apply(&to, rect[2], rect[1]),
                                apply(&to, rect[0], rect[3]),
                                apply(&to, rect[2], rect[3]),
                            ];
                            if let Some(b) = bbox_of(&corners).filter(|b| area(b) > 0.) {
                                graphics.push(Graphic {
                                    kind,
                                    op: index,
                                    bbox: b,
                                });
                            }
                            if kind == "form" {
                                let content =
                                    s.get_plain_content_with_limit(LIMIT).unwrap_or_default();
                                if content.windows(2).any(|w| w == b"BT") {
                                    skipped.forms += 1;
                                }
                            }
                        }
                    }
                }
                "Tj" | "TJ" | "'" | "\"" => {
                    if op.operator == "'" || op.operator == "\"" {
                        if op.operator == "\"" {
                            let n = nums(o);
                            if n.len() >= 2 {
                                gs.tw = n[0];
                                gs.tc = n[1];
                            }
                        }
                        tlm = mul(&[1., 0., 0., 1., 0., -gs.tl], &tlm);
                        tm = tlm;
                    }
                    let Some(name) = gs.font.clone() else {
                        continue;
                    };
                    let Some(font) = fonts.get(&name) else {
                        continue;
                    };
                    let encoding = encodings.entry(name.clone()).or_insert_with(|| {
                        resource_font(&name).and_then(|d| d.get_font_encoding(doc).ok())
                    });
                    let th = gs.tz / 100.;
                    let start = mul(&tm, &gs.ctm);
                    let mut advance = 0.;
                    let mut text = String::new();
                    let mut chars = 0;
                    let parts: Vec<&Object> = match op.operator.as_str() {
                        "TJ" => o
                            .first()
                            .and_then(|a| a.as_array().ok())
                            .map(|a| a.iter().collect())
                            .unwrap_or_default(),
                        "\"" => o.get(2).into_iter().collect(),
                        _ => o.first().into_iter().collect(),
                    };
                    for part in parts {
                        match part {
                            Object::String(bytes, _) => {
                                let step = if font.two_byte { 2 } else { 1 };
                                for chunk in bytes.chunks(step) {
                                    let code =
                                        chunk.iter().fold(0u32, |c, b| (c << 8) | u32::from(*b));
                                    let w = font.width(code) * font.scale;
                                    let space = if !font.two_byte && code == 32 {
                                        gs.tw
                                    } else {
                                        0.
                                    };
                                    advance += (w * gs.size + gs.tc + space) * th;
                                    chars += 1;
                                }
                                if let Some(e) = encoding {
                                    if let Ok(s) = e.bytes_to_string(bytes) {
                                        text.push_str(&s);
                                    }
                                }
                            }
                            other => {
                                if let Some(n) = num(other) {
                                    advance -= n / 1000. * gs.size * th;
                                    if n < -200. && !text.ends_with(' ') {
                                        text.push(' ');
                                    }
                                }
                            }
                        }
                    }
                    tm = mul(&[1., 0., 0., 1., advance, 0.], &tm);
                    if chars == 0 {
                        continue;
                    }
                    if gs.mode == 3 || gs.mode == 7 {
                        skipped.invisible += 1;
                        continue;
                    }
                    // Horizontal, upright text only (in user space).
                    let (xa, ya, xb, yb) = (start[0], start[1], start[2], start[3]);
                    if xa <= 0. || yb <= 0. || ya.abs() > xa * 0.02 || xb.abs() > yb * 0.02 {
                        skipped.rotated += 1;
                        continue;
                    }
                    let size = gs.size.abs() * yb;
                    let a = apply(&start, 0., gs.ts + font.ascent * gs.size);
                    let d = apply(&start, 0., gs.ts + font.descent * gs.size);
                    let base = apply(&start, 0., gs.ts);
                    let end = apply(&start, advance, gs.ts);
                    let (x0, x1) = if end[0] >= base[0] {
                        (base[0], end[0])
                    } else {
                        (end[0], base[0])
                    };
                    runs.push(Run {
                        op: index,
                        x0,
                        x1,
                        base: base[1],
                        top: a[1],
                        bottom: d[1],
                        size,
                        font: name,
                        rgba: gs.fill,
                        text,
                        chars,
                    });
                }
                _ => {}
            }
        }
        Ok(PageContent {
            runs,
            skipped,
            fonts,
            graphics,
        })
    }

    /// The printed text of page `index` (0-based) as blocks, in JSON:
    /// `{ blocks: [{ id, ops, bbox: [x0, y0, x1, y1] (user space, y up), lines: [{ x0, x1,
    /// base, top, bottom, text }], size, font, family, bold, italic, serif, mono, program,
    /// embedded, rgba, align, leading }], skipped: { rotated, invisible, forms } }`.
    pub fn blocks(&mut self, index: u32) -> Result<Value, String> {
        let page = self.page_id(index)?;
        let PageContent {
            runs,
            skipped,
            fonts,
            graphics,
        } = self.runs(page)?;
        let blocks = group(&runs);
        let out: Vec<Value> = blocks
            .iter()
            .enumerate()
            .map(|(i, b)| {
                let all: Vec<&Run> = b.lines.iter().flat_map(|l| l.runs.iter().map(|r| &runs[*r])).collect();
                // The font and colour that most characters have.
                let mut by_font: HashMap<&[u8], usize> = HashMap::new();
                let mut by_color: HashMap<String, ([f64; 4], usize)> = HashMap::new();
                for r in &all {
                    *by_font.entry(&r.font).or_default() += r.chars;
                    by_color.entry(format!("{:?}", r.rgba)).or_insert((r.rgba, 0)).1 += r.chars;
                }
                let font_key = by_font.into_iter().max_by_key(|(_, n)| *n).map(|(k, _)| k.to_vec()).unwrap_or_default();
                let rgba = by_color.into_values().max_by_key(|(_, n)| *n).map(|(c, _)| c).unwrap_or([0., 0., 0., 1.]);
                let font = fonts.get(&font_key);
                // The size most characters have (the median by characters, not by runs).
                let mut sizes: Vec<(f64, usize)> = all.iter().map(|r| (r.size, r.chars)).collect();
                sizes.sort_by(|a, b| a.0.total_cmp(&b.0));
                let half = sizes.iter().map(|s| s.1).sum::<usize>() / 2;
                let mut seen = 0;
                let size = sizes.iter().find(|s| { seen += s.1; seen > half }).map_or(10., |s| s.0);
                let lines: Vec<Value> = b
                    .lines
                    .iter()
                    .map(|l| {
                        let rs: Vec<&Run> = l.runs.iter().map(|r| &runs[*r]).collect();
                        let mut text = String::new();
                        let mut last_x1: Option<f64> = None;
                        for r in &rs {
                            if let Some(x1) = last_x1 {
                                if r.x0 - x1 > r.size * 0.2 && !text.ends_with(' ') && !r.text.starts_with(' ') {
                                    text.push(' ');
                                }
                            }
                            text.push_str(&r.text);
                            last_x1 = Some(r.x1);
                        }
                        json!({ "x0": l.x0, "x1": l.x1, "base": l.base, "top": l.top, "bottom": l.bottom, "text": text.trim() })
                    })
                    .collect();
                let mut ops: Vec<usize> = all.iter().map(|r| r.op).collect();
                ops.sort_unstable();
                ops.dedup();
                let leading = if b.lines.len() > 1 { (b.lines[0].base - b.lines[b.lines.len() - 1].base) / (b.lines.len() - 1) as f64 } else { 0. };
                json!({
                    "id": i,
                    "ops": ops,
                    "bbox": [b.x0, b.bottom, b.x1, b.top],
                    "lines": lines,
                    "size": size,
                    "font": font.map(|f| f.base.clone()).unwrap_or_default(),
                    "bold": font.is_some_and(|f| f.bold),
                    "italic": font.is_some_and(|f| f.italic),
                    "serif": font.is_some_and(|f| f.serif),
                    "mono": font.is_some_and(|f| f.mono),
                    "program": font.and_then(|f| f.program.clone()),
                    "embedded": font.map_or("", |f| f.embedded),
                    "rgba": rgba,
                    "align": b.align,
                    "leading": leading,
                })
            })
            .collect();
        let objects = self.objects(page, &graphics);
        Ok(
            json!({ "blocks": out, "objects": objects, "skipped": { "rotated": skipped.rotated, "invisible": skipped.invisible, "forms": skipped.forms } }),
        )
    }

    /// The page's objects other than text, in JSON: images and form XObjects one by one, paths
    /// gathered into drawings (paths that touch or overlap), and annotations and form fields
    /// that have an appearance. Each: `{ id, kind ("image", "form", "drawing", "field",
    /// "annotation"), ops, annots, bbox, count }`. Fills over half the page (backgrounds)
    /// are left out.
    fn objects(&self, page: ObjectId, graphics: &[Graphic]) -> Vec<Value> {
        let media = self.page_box(page);
        let page_area = area(&media).max(1.);
        let mut out = vec![];
        let mut add = |kind: &str,
                       ops: Vec<usize>,
                       annots: Vec<usize>,
                       bbox: [f64; 4],
                       count: usize| {
            let id = format!("o{}", out.len());
            out.push(json!({ "id": id, "kind": kind, "ops": ops, "annots": annots, "bbox": bbox, "count": count }));
        };
        let paths: Vec<&Graphic> = graphics
            .iter()
            .filter(|g| g.kind == "path" && area(&g.bbox) < page_area * 0.5)
            .collect();
        for group in cluster(&paths.iter().map(|g| g.bbox).collect::<Vec<_>>(), 1.5) {
            let bbox = group
                .iter()
                .map(|i| paths[*i].bbox)
                .reduce(union)
                .unwrap_or_default();
            let mut ops: Vec<usize> = group.iter().map(|i| paths[*i].op).collect();
            ops.sort_unstable();
            add("drawing", ops, vec![], bbox, group.len());
        }
        for g in graphics
            .iter()
            .filter(|g| g.kind != "path" && area(&g.bbox) < page_area * 0.95)
        {
            add(g.kind, vec![g.op], vec![], g.bbox, 1);
        }
        for (i, a) in self.page_annots(page).iter().enumerate() {
            let subtype = a.get(b"Subtype").and_then(Object::as_name).unwrap_or(b"");
            if matches!(subtype, b"Popup" | b"Link") || a.get(b"AP").is_err() {
                continue;
            }
            let r = a
                .get_deref(b"Rect", &self.doc)
                .and_then(Object::as_array)
                .map(|r| nums(r))
                .unwrap_or_default();
            if r.len() != 4 {
                continue;
            }
            let bbox = [
                r[0].min(r[2]),
                r[1].min(r[3]),
                r[0].max(r[2]),
                r[1].max(r[3]),
            ];
            if area(&bbox) <= 0. {
                continue;
            }
            add(
                if subtype == b"Widget" {
                    "field"
                } else {
                    "annotation"
                },
                vec![],
                vec![i],
                bbox,
                1,
            );
        }
        out
    }

    /// The page's MediaBox (inherited from its tree when not on the page), [x0, y0, x1, y1].
    fn page_box(&self, page: ObjectId) -> [f64; 4] {
        let mut node = Some(page);
        let mut seen = HashSet::new();
        while let Some(id) = node.filter(|id| seen.insert(*id)) {
            let Ok(d) = self.doc.get_dictionary(id) else {
                break;
            };
            if let Ok(r) = d
                .get_deref(b"MediaBox", &self.doc)
                .and_then(Object::as_array)
            {
                let n = nums(r);
                if n.len() == 4 {
                    return [
                        n[0].min(n[2]),
                        n[1].min(n[3]),
                        n[0].max(n[2]),
                        n[1].max(n[3]),
                    ];
                }
            }
            node = d.get(b"Parent").and_then(Object::as_reference).ok();
        }
        [0., 0., 612., 792.]
    }

    /// The page's annotations, in the order of its /Annots.
    fn page_annots(&self, page: ObjectId) -> Vec<&Dictionary> {
        let doc = &self.doc;
        let Ok(list) = doc
            .get_dictionary(page)
            .and_then(|d| d.get_deref(b"Annots", doc))
            .and_then(Object::as_array)
        else {
            return vec![];
        };
        list.iter()
            .filter_map(|o| doc.dereference(o).ok()?.1.as_dict().ok())
            .collect()
    }

    /// A font program by hash among all the fonts of page `index`, used or not: the text boxes
    /// made from a page keep their font after the page's copy no longer draws text in it.
    pub fn font_on_page(&mut self, index: u32, hash: &str) -> Option<Vec<u8>> {
        if !self.fonts.contains_key(hash) {
            let page = self.page_id(index).ok()?;
            let names: Vec<Vec<u8>> = self.doc.get_page_fonts(page).ok()?.into_keys().collect();
            for name in names {
                self.font(page, &name);
            }
        }
        self.fonts.get(hash).map(|f| f.bytes.clone())
    }

    /// The bytes and kind ("truetype" or "opentype") of a font program seen on an interpreted page.
    pub fn font_program(&self, hash: &str) -> Option<(&'static str, &[u8])> {
        self.fonts.get(hash).map(|f| (f.kind, f.bytes.as_slice()))
    }

    /// The characters of `text` that the font program `hash` has no glyph for (all of them
    /// when the program has no Unicode cmap).
    pub fn font_missing(&self, hash: &str, text: &str) -> String {
        let Some(font) = self.fonts.get(hash) else {
            return text.to_owned();
        };
        let mut missing = String::new();
        for c in text.chars() {
            if c.is_whitespace() || missing.contains(c) {
                continue;
            }
            if sfnt_glyph(&font.bytes, c).unwrap_or(0) == 0 {
                missing.push(c);
            }
        }
        missing
    }

    /// Page `index` alone, as a new PDF, with the operators at `ops` taken out (a `'` or `"`
    /// keeps its move to the next line). The page keeps its boxes, rotation and resources, so
    /// it looks the same everywhere else.
    pub fn without_runs(&self, index: u32, ops: &[usize]) -> Result<Vec<u8>, String> {
        self.without(index, ops, &[])
    }

    /// Page `index` alone without the marks of `ops` and the annotations `annots` (indices in
    /// its /Annots). Its other annotations stay, cut loose from the rest of the document.
    pub fn without(&self, index: u32, ops: &[usize], annots: &[usize]) -> Result<Vec<u8>, String> {
        let drop: HashSet<usize> = ops.iter().copied().collect();
        let gone: HashSet<usize> = annots.iter().copied().collect();
        self.copy_page(index, |i, _| drop.contains(&i), |i| !gone.contains(&i))
    }

    /// Page `index` alone with nothing on it but the marks of `ops` and the annotations
    /// `annots`: what the reader draws to make one object a picture. Everything that sets the
    /// state (transformations, clips, colours, fonts) is kept, so the object is drawn exactly
    /// as on the page.
    pub fn isolate(&self, index: u32, ops: &[usize], annots: &[usize]) -> Result<Vec<u8>, String> {
        let keep: HashSet<usize> = ops.iter().copied().collect();
        let shown: HashSet<usize> = annots.iter().copied().collect();
        self.copy_page(
            index,
            |i, op| paints(&op.operator) && !keep.contains(&i),
            |i| shown.contains(&i),
        )
    }

    /// The one-page copy behind `without` and `isolate`: operators for which `drop` holds lose
    /// their marks, and the annotations for which `annot` holds are kept.
    fn copy_page(
        &self,
        index: u32,
        drop: impl Fn(usize, &Operation) -> bool,
        annot: impl Fn(usize) -> bool,
    ) -> Result<Vec<u8>, String> {
        let page_id = self.page_id(index)?;
        let operations = self.operations(page_id)?;
        let mut kept = Vec::with_capacity(operations.len());
        for (i, op) in operations.into_iter().enumerate() {
            if !drop(i, &op) {
                kept.push(op);
                continue;
            }
            match op.operator.as_str() {
                "'" => kept.push(Operation::new("T*", vec![])),
                "\"" => {
                    let mut o = op.operands.into_iter();
                    if let (Some(aw), Some(ac)) = (o.next(), o.next()) {
                        kept.push(Operation::new("Tw", vec![aw]));
                        kept.push(Operation::new("Tc", vec![ac]));
                    }
                    kept.push(Operation::new("T*", vec![]));
                }
                p if PATH_PAINT.contains(&p) => kept.push(Operation::new("n", vec![])),
                _ => {}
            }
        }
        let content = Content { operations: kept }
            .encode()
            .map_err(|e| format!("Could not write the page: {e}"))?;
        let mut doc = self.doc.clone();
        // Inherited attributes onto the page itself, before it leaves its tree.
        let mut inherited = vec![];
        for key in [&b"Resources"[..], b"MediaBox", b"CropBox", b"Rotate"] {
            if doc
                .get_dictionary(page_id)
                .map_err(|e| e.to_string())?
                .has(key)
            {
                continue;
            }
            let mut node = doc
                .get_dictionary(page_id)
                .ok()
                .and_then(|d| d.get(b"Parent").and_then(Object::as_reference).ok());
            let mut seen = HashSet::new();
            while let Some(id) = node.filter(|id| seen.insert(*id)) {
                let Ok(d) = doc.get_dictionary(id) else { break };
                if let Ok(v) = d.get(key) {
                    inherited.push((key.to_vec(), v.clone()));
                    break;
                }
                node = d.get(b"Parent").and_then(Object::as_reference).ok();
            }
        }
        let mut stream = lopdf::Stream::new(Dictionary::new(), content);
        let _ = stream.compress();
        let content_id = doc.add_object(stream);
        let pages_id = doc.new_object_id();
        let annots = self.kept_annots(page_id, &annot);
        {
            let page = doc.get_dictionary_mut(page_id).map_err(|e| e.to_string())?;
            for (k, v) in inherited {
                page.set(k, v);
            }
            page.set("Contents", Object::Reference(content_id));
            page.set("Parent", Object::Reference(pages_id));
            for k in [
                &b"Annots"[..],
                b"B",
                b"Thumb",
                b"StructParents",
                b"Tabs",
                b"AA",
            ] {
                page.remove(k);
            }
            if !annots.is_empty() {
                page.set("Annots", Object::Array(annots));
            }
        }
        let mut pages = Dictionary::new();
        pages.set("Type", Object::Name(b"Pages".to_vec()));
        pages.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        pages.set("Count", Object::Integer(1));
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        let mut trailer = Dictionary::new();
        trailer.set("Root", Object::Reference(catalog_id));
        doc.trailer = trailer;
        doc.prune_objects();
        doc.renumber_objects();
        let mut out = Vec::new();
        doc.save_to(&mut out)
            .map_err(|e| format!("Could not write the PDF: {e}"))?;
        Ok(out)
    }

    /// The annotations of the page that `keep` takes, cut loose from the rest of the document:
    /// no reference to the page, a parent field, a popup or a reply; a link stays only when it
    /// goes to a web page. Widgets keep the field values they inherited.
    fn kept_annots(&self, page: ObjectId, keep: &impl Fn(usize) -> bool) -> Vec<Object> {
        let doc = &self.doc;
        self.page_annots(page)
            .into_iter()
            .enumerate()
            .filter(|(i, _)| keep(*i))
            .filter_map(|(_, a)| {
                let subtype = a.get(b"Subtype").and_then(Object::as_name).unwrap_or(b"");
                if subtype == b"Popup" {
                    return None;
                }
                let mut copy = a.clone();
                if subtype == b"Link" {
                    let action = a.get_deref(b"A", doc).and_then(Object::as_dict).ok()?;
                    if !action
                        .get(b"S")
                        .and_then(Object::as_name)
                        .is_ok_and(|s| s == b"URI")
                    {
                        return None;
                    }
                    copy.set("A", Object::Dictionary(action.clone()));
                }
                // A widget's field attributes may live on its parent field.
                if let Ok(parent) = a.get_deref(b"Parent", doc).and_then(Object::as_dict) {
                    for k in [&b"FT"[..], b"Ff", b"V", b"DA", b"T"] {
                        if !copy.has(k) {
                            if let Ok(v) = parent.get(k) {
                                copy.set(k, v.clone());
                            }
                        }
                    }
                }
                for k in [
                    &b"P"[..],
                    b"Parent",
                    b"Popup",
                    b"IRT",
                    b"Dest",
                    b"StructParent",
                    b"AA",
                ] {
                    copy.remove(k);
                }
                if copy.get(b"A").and_then(Object::as_dict).is_ok_and(|a| {
                    !a.get(b"S")
                        .and_then(Object::as_name)
                        .is_ok_and(|s| s == b"URI")
                }) {
                    copy.remove(b"A");
                }
                Some(Object::Dictionary(copy))
            })
            .collect()
    }
}

fn gray(o: &[Object]) -> [f64; 4] {
    let g = o.first().and_then(num).unwrap_or(0.).clamp(0., 1.);
    [g, g, g, 1.]
}
fn rgb(o: &[Object]) -> [f64; 4] {
    let n = nums(o);
    if n.len() < 3 {
        return [0., 0., 0., 1.];
    }
    [
        n[0].clamp(0., 1.),
        n[1].clamp(0., 1.),
        n[2].clamp(0., 1.),
        1.,
    ]
}
fn cmyk(o: &[Object]) -> [f64; 4] {
    let n = nums(o);
    if n.len() < 4 {
        return [0., 0., 0., 1.];
    }
    let k = 1. - n[3].clamp(0., 1.);
    [
        (1. - n[0].clamp(0., 1.)) * k,
        (1. - n[1].clamp(0., 1.)) * k,
        (1. - n[2].clamp(0., 1.)) * k,
        1.,
    ]
}

struct Line {
    runs: Vec<usize>,
    x0: f64,
    x1: f64,
    base: f64,
    top: f64,
    bottom: f64,
    size: f64,
    /// Reaches the right edge of its column: its paragraph may go on below it.
    full: bool,
}
struct Block {
    lines: Vec<Line>,
    x0: f64,
    x1: f64,
    top: f64,
    bottom: f64,
    size: f64,
    align: u8,
}

/// Runs into lines (one baseline, small gaps), lines into blocks (one size, a steady
/// leading, overlapping columns), top to bottom.
fn group(runs: &[Run]) -> Vec<Block> {
    let mut lines: Vec<Line> = vec![];
    for (i, r) in runs.iter().enumerate() {
        if r.text.trim().is_empty() && r.x1 - r.x0 < r.size * 0.05 {
            continue;
        }
        let found = lines.iter_mut().rev().take(64).find(|l| {
            let small = l.size.min(r.size);
            (l.base - r.base).abs() < small * 0.4
                && r.size / l.size < 1.6
                && l.size / r.size < 1.6
                && r.x0 < l.x1 + small * 1.2
                && r.x1 > l.x0 - small * 1.2
        });
        match found {
            Some(l) => {
                l.runs.push(i);
                l.x0 = l.x0.min(r.x0);
                l.x1 = l.x1.max(r.x1);
                l.top = l.top.max(r.top);
                l.bottom = l.bottom.min(r.bottom);
                // A superscript or subscript does not move the line's baseline or size.
                if r.size > l.size {
                    l.size = r.size;
                    l.base = r.base;
                }
            }
            None => lines.push(Line {
                runs: vec![i],
                x0: r.x0,
                x1: r.x1,
                base: r.base,
                top: r.top,
                bottom: r.bottom,
                size: r.size,
                full: false,
            }),
        }
    }
    for l in &mut lines {
        l.runs.sort_by(|a, b| runs[*a].x0.total_cmp(&runs[*b].x0));
    }
    // Whitespace-only lines show nothing.
    lines.retain(|l| {
        l.runs
            .iter()
            .any(|r| !runs[*r].text.trim().is_empty() || runs[*r].text.is_empty())
    });
    lines.sort_by(|a, b| b.base.total_cmp(&a.base).then(a.x0.total_cmp(&b.x0)));
    // A column's right edge: the furthest any line starting where this one starts reaches.
    let reach: Vec<f64> = lines
        .iter()
        .map(|l| {
            lines
                .iter()
                .filter(|o| (o.x0 - l.x0).abs() < l.size)
                .map(|o| o.x1)
                .fold(l.x1, f64::max)
        })
        .collect();
    for (l, edge) in lines.iter_mut().zip(reach) {
        // Within the last word or so of the edge: the next word did not fit, so the
        // paragraph wraps (15% of the column, at least two ems).
        l.full = l.x1 >= edge - (l.size * 2.).max((edge - l.x0) * 0.15);
    }
    let mut blocks: Vec<Block> = vec![];
    for line in lines {
        let fits = |b: &Block| {
            let last = b.lines.last().unwrap();
            let gap = last.base - line.base;
            let size_ok = line.size / b.size < 1.18 && b.size / line.size < 1.18;
            let leading_ok = if b.lines.len() >= 2 {
                let lead = (b.lines[0].base - last.base) / (b.lines.len() - 1) as f64;
                (gap - lead).abs() < b.size * 0.25
            } else {
                // Generous leadings reach twice the size (book layouts), but only below a
                // line that fills its column: a short one with a wide gap under it is a
                // paragraph, a heading or a list's lead-in of its own.
                gap > b.size * 0.6 && gap < b.size * if last.full { 2.3 } else { 1.6 }
            };
            // A line that ends well short of the block's widest one ends its paragraph
            // (unless the block is centred), even when the next starts at the usual leading.
            let ended = b.lines.len() >= 2
                && last.x1 < b.x1 - b.size * 4.
                && ((last.x0 + last.x1) - (b.x0 + b.x1)).abs() > b.size;
            let overlap = line.x0 < b.x1 + b.size && line.x1 > b.x0 - b.size;
            // The same left edge; a second line may start left of an indented first one; or
            // centred or right-aligned lines.
            let dx = line.x0 - b.x0;
            let left =
                dx.abs() < b.size * 1.2 || (b.lines.len() == 1 && dx < 0. && dx > -b.size * 3.);
            let edges = left
                || ((line.x0 + line.x1) - (b.x0 + b.x1)).abs() < b.size
                || (line.x1 - b.x1).abs() < b.size * 0.5;
            size_ok && leading_ok && overlap && edges && !ended
        };
        match blocks.iter_mut().rev().take(12).find(|b| fits(b)) {
            Some(b) => {
                b.x0 = b.x0.min(line.x0);
                b.x1 = b.x1.max(line.x1);
                b.bottom = b.bottom.min(line.bottom);
                b.lines.push(line);
            }
            None => blocks.push(Block {
                x0: line.x0,
                x1: line.x1,
                top: line.top,
                bottom: line.bottom,
                size: line.size,
                align: 0,
                lines: vec![line],
            }),
        }
    }
    for b in &mut blocks {
        if b.lines.len() >= 2 {
            let tol = b.size * 0.5;
            let lefts = b.lines.iter().all(|l| (l.x0 - b.x0).abs() < tol);
            let centres = b
                .lines
                .iter()
                .all(|l| ((l.x0 + l.x1) / 2. - (b.x0 + b.x1) / 2.).abs() < tol);
            let rights = b.lines.iter().all(|l| (l.x1 - b.x1).abs() < tol);
            b.align = if lefts {
                0
            } else if centres {
                1
            } else if rights {
                2
            } else {
                0
            };
        }
    }
    blocks
}

/// A TrueType or OpenType program a browser accepts: the tables its font sanitizer requires
/// (subset fonts in PDFs often lack `name`, `OS/2` or `post`, and are then refused) and a
/// Unicode cmap.
fn sfnt_loadable(font: &[u8]) -> bool {
    let has = |tag: &[u8; 4]| sfnt_table(font, tag).is_some();
    let outlines = (has(b"glyf") && has(b"loca")) || has(b"CFF ");
    outlines
        && [
            b"cmap", b"head", b"hhea", b"hmtx", b"maxp", b"name", b"OS/2", b"post",
        ]
        .iter()
        .all(|t| has(t))
        && sfnt_glyph(font, 'a').is_some()
}
fn be16(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 2)
        .map(|s| u32::from(u16::from_be_bytes([s[0], s[1]])))
}
fn be32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4)
        .map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}
fn sfnt_table<'a>(font: &'a [u8], tag: &[u8; 4]) -> Option<&'a [u8]> {
    let count = be16(font, 4)? as usize;
    for i in 0..count.min(64) {
        let at = 12 + i * 16;
        if font.get(at..at + 4)? == tag {
            let (offset, length) = (be32(font, at + 8)? as usize, be32(font, at + 12)? as usize);
            return font.get(offset..offset.checked_add(length)?);
        }
    }
    None
}
/// The glyph a Unicode cmap (3,1 / 3,10 / 0,x; formats 4 and 12) gives `c`; None without one.
fn sfnt_glyph(font: &[u8], c: char) -> Option<u32> {
    let cmap = sfnt_table(font, b"cmap")?;
    let n = be16(cmap, 2)? as usize;
    let mut best: Option<usize> = None;
    for i in 0..n.min(32) {
        let at = 4 + i * 8;
        let (platform, encoding, offset) = (
            be16(cmap, at)?,
            be16(cmap, at + 2)?,
            be32(cmap, at + 4)? as usize,
        );
        let unicode = platform == 0 || (platform == 3 && (encoding == 1 || encoding == 10));
        if unicode && matches!(be16(cmap, offset), Some(4) | Some(12)) {
            best = Some(offset);
            if be16(cmap, offset) == Some(12) {
                break;
            }
        }
    }
    let t = best?;
    let code = c as u32;
    match be16(cmap, t)? {
        4 => {
            if code > 0xFFFF {
                return Some(0);
            }
            let segs = be16(cmap, t + 6)? as usize / 2;
            let ends = t + 14;
            let starts = ends + segs * 2 + 2;
            let deltas = starts + segs * 2;
            let ranges = deltas + segs * 2;
            for s in 0..segs {
                let end = be16(cmap, ends + s * 2)?;
                if code > end {
                    continue;
                }
                let start = be16(cmap, starts + s * 2)?;
                if code < start {
                    return Some(0);
                }
                let delta = be16(cmap, deltas + s * 2)?;
                let range = be16(cmap, ranges + s * 2)? as usize;
                if range == 0 {
                    return Some((code + delta) & 0xFFFF);
                }
                let at = ranges + s * 2 + range + (code - start) as usize * 2;
                let g = be16(cmap, at)?;
                return Some(if g == 0 { 0 } else { (g + delta) & 0xFFFF });
            }
            Some(0)
        }
        12 => {
            let groups = be32(cmap, t + 12)? as usize;
            for g in 0..groups.min(100_000) {
                let at = t + 16 + g * 12;
                let (start, end, glyph) =
                    (be32(cmap, at)?, be32(cmap, at + 4)?, be32(cmap, at + 8)?);
                if code >= start && code <= end {
                    return Some(glyph + code - start);
                }
            }
            Some(0)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pdf_writer::{Content as C, Finish, Name, Pdf, Rect, Ref, Str};

    /// A one-page PDF (A4) with Helvetica text: a two-line paragraph, a heading, and invisible text.
    fn sample() -> Vec<u8> {
        let mut pdf = Pdf::new();
        let (catalog, tree, page, font, content) = (
            Ref::new(1),
            Ref::new(2),
            Ref::new(3),
            Ref::new(4),
            Ref::new(5),
        );
        pdf.catalog(catalog).pages(tree);
        pdf.pages(tree).kids([page]).count(1);
        let mut p = pdf.page(page);
        p.parent(tree)
            .media_box(Rect::new(0., 0., 595., 842.))
            .contents(content);
        p.resources().fonts().pair(Name(b"F1"), font);
        p.finish();
        pdf.type1_font(font).base_font(Name(b"Helvetica-Bold"));
        let mut c = C::new();
        c.begin_text()
            .set_font(Name(b"F1"), 20.)
            .next_line(72., 760.)
            .show(Str(b"Heading"))
            .end_text();
        c.set_fill_rgb(0.2, 0.4, 0.6);
        c.begin_text()
            .set_font(Name(b"F1"), 11.)
            .set_leading(14.)
            .next_line(72., 700.)
            .show(Str(b"First line of text"));
        c.next_line_show(Str(b"second line here"));
        c.end_text();
        c.begin_text()
            .set_text_rendering_mode(pdf_writer::types::TextRenderingMode::Invisible)
            .set_font(Name(b"F1"), 11.)
            .next_line(72., 400.)
            .show(Str(b"hidden"))
            .end_text();
        pdf.stream(content, &c.finish());
        pdf.finish()
    }

    #[test]
    fn blocks_group_lines_and_skip_invisible_text() {
        let mut e = PdfEdit::load(&sample()).unwrap();
        let v = e.blocks(0).unwrap();
        let blocks = v["blocks"].as_array().unwrap();
        assert_eq!(blocks.len(), 2, "{v}");
        assert_eq!(v["skipped"]["invisible"], 1);
        let heading = &blocks[0];
        assert_eq!(heading["lines"][0]["text"], "Heading");
        assert_eq!(heading["font"], "Helvetica-Bold");
        assert_eq!(heading["bold"], true);
        assert!((heading["size"].as_f64().unwrap() - 20.).abs() < 1e-6);
        let body = &blocks[1];
        assert_eq!(body["lines"].as_array().unwrap().len(), 2);
        assert_eq!(body["lines"][1]["text"], "second line here");
        assert!((body["leading"].as_f64().unwrap() - 14.).abs() < 1e-6);
        assert!((body["rgba"][2].as_f64().unwrap() - 0.6).abs() < 1e-3);
        let bbox: Vec<f64> = body["bbox"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n.as_f64().unwrap())
            .collect();
        assert!((bbox[0] - 72.).abs() < 1e-6 && bbox[2] > 150. && bbox[1] < 686. && bbox[3] > 700.);
    }

    #[test]
    fn without_runs_drops_only_that_text_and_keeps_one_page() {
        let mut e = PdfEdit::load(&sample()).unwrap();
        let v = e.blocks(0).unwrap();
        let ops: Vec<usize> = v["blocks"][1]["ops"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n.as_u64().unwrap() as usize)
            .collect();
        assert_eq!(ops.len(), 2);
        let out = e.without_runs(0, &ops).unwrap();
        let mut again = PdfEdit::load(&out).unwrap();
        assert_eq!(again.doc.get_pages().len(), 1);
        let v = again.blocks(0).unwrap();
        let blocks = v["blocks"].as_array().unwrap();
        assert_eq!(blocks.len(), 1, "{v}");
        assert_eq!(blocks[0]["lines"][0]["text"], "Heading");
        // The ' operator's line move is kept, so text after it would not shift.
        let ops = again.operations(again.page_id(0).unwrap()).unwrap();
        assert!(ops.iter().any(|o| o.operator == "T*"));
        let page = again.doc.get_dictionary(again.page_id(0).unwrap()).unwrap();
        assert!(page.has(b"MediaBox") && page.has(b"Resources"));
    }

    fn run(op: usize, x0: f64, x1: f64, base: f64, size: f64, text: &str) -> Run {
        Run {
            op,
            x0,
            x1,
            base,
            top: base + size * 0.8,
            bottom: base - size * 0.2,
            size,
            font: b"F1".to_vec(),
            rgba: [0., 0., 0., 1.],
            text: text.into(),
            chars: text.len(),
        }
    }

    #[test]
    fn grouping_follows_paragraphs_not_just_gaps() {
        // A book page: 11 pt with a leading of twice the size. A line that fills the column
        // goes on below; a short one ends its paragraph, even at the same leading.
        let runs = vec![
            run(0, 72., 500., 700., 11., "La salida del PLL es SYSCLK, el reloj del sistema. De ahí cuelgan tres ramas, cada una con"),
            run(1, 72., 140., 678., 11., "su divisor:"),
            run(2, 72., 300., 656., 11., "Otro párrafo corto."),
            // A lead-in at 12 pt, then a list indented two ems, 25 below (over twice the size).
            run(3, 72., 330., 600., 12., "Se usará la notación establecida:"),
            run(4, 96., 360., 575., 12., "UR-01, UR-02... para los requisitos."),
            run(5, 96., 370., 561.5, 12., "FR-001, FR-002... para los funcionales."),
        ];
        let blocks = group(&runs);
        let texts: Vec<Vec<usize>> = blocks
            .iter()
            .map(|b| b.lines.iter().flat_map(|l| l.runs.clone()).collect())
            .collect();
        assert_eq!(
            texts,
            vec![vec![0, 1], vec![2], vec![3], vec![4, 5]],
            "{texts:?}"
        );
    }

    /// A page with a box and a line touching it (one drawing), a separate rule, an image and a
    /// word of text.
    fn objects_sample() -> Vec<u8> {
        let mut pdf = Pdf::new();
        let (catalog, tree, page, font, content, image) = (
            Ref::new(1),
            Ref::new(2),
            Ref::new(3),
            Ref::new(4),
            Ref::new(5),
            Ref::new(6),
        );
        pdf.catalog(catalog).pages(tree);
        pdf.pages(tree).kids([page]).count(1);
        let mut p = pdf.page(page);
        p.parent(tree)
            .media_box(Rect::new(0., 0., 595., 842.))
            .contents(content);
        let mut res = p.resources();
        res.fonts().pair(Name(b"F1"), font);
        res.x_objects().pair(Name(b"Im1"), image);
        res.finish();
        p.finish();
        pdf.type1_font(font).base_font(Name(b"Helvetica"));
        let mut im = pdf.image_xobject(image, &[255, 0, 0, 0, 0, 255]);
        im.width(2).height(1).bits_per_component(8);
        im.color_space().device_rgb();
        im.finish();
        let mut c = C::new();
        c.set_fill_rgb(0.9, 0.9, 0.2)
            .rect(100., 600., 80., 40.)
            .fill_nonzero();
        c.set_line_width(2.)
            .move_to(180., 620.)
            .line_to(260., 620.)
            .stroke();
        c.move_to(100., 300.).line_to(400., 300.).stroke();
        c.save_state()
            .transform([50., 0., 0., 25., 300., 600.])
            .x_object(Name(b"Im1"))
            .restore_state();
        c.begin_text()
            .set_font(Name(b"F1"), 12.)
            .next_line(72., 760.)
            .show(Str(b"Hola"))
            .end_text();
        pdf.stream(content, &c.finish());
        pdf.finish()
    }

    #[test]
    fn objects_are_found_moved_out_and_drawn_alone() {
        let mut e = PdfEdit::load(&objects_sample()).unwrap();
        let v = e.blocks(0).unwrap();
        let objects = v["objects"].as_array().unwrap();
        let kinds: Vec<&str> = objects
            .iter()
            .map(|o| o["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["drawing", "drawing", "image"], "{v}");
        let boxed = objects
            .iter()
            .find(|o| o["count"] == 2)
            .expect("the box and its line, one drawing");
        let bbox: Vec<f64> = boxed["bbox"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n.as_f64().unwrap())
            .collect();
        assert_eq!(
            bbox,
            [100., 600., 261., 640.],
            "the line reaches past the box by its half width: x to 261"
        );
        let image = &objects[2];
        assert_eq!(image["bbox"], json!([300., 600., 350., 625.]));
        let ops = |o: &Value| -> Vec<usize> {
            o["ops"]
                .as_array()
                .unwrap()
                .iter()
                .map(|n| n.as_u64().unwrap() as usize)
                .collect()
        };
        // Without the drawing: the rule, the image and the text remain.
        let rest = e.without(0, &ops(boxed), &[]).unwrap();
        let mut again = PdfEdit::load(&rest).unwrap();
        let v2 = again.blocks(0).unwrap();
        assert_eq!(v2["objects"].as_array().unwrap().len(), 2, "{v2}");
        assert_eq!(v2["blocks"].as_array().unwrap().len(), 1);
        // The image alone: nothing else paints.
        let alone = e.isolate(0, &ops(image), &[]).unwrap();
        let mut only = PdfEdit::load(&alone).unwrap();
        let v3 = only.blocks(0).unwrap();
        let kinds: Vec<&str> = v3["objects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["image"], "{v3}");
        assert_eq!(v3["blocks"].as_array().unwrap().len(), 0);
    }

    /// A page with a filled text field (its appearance drawn) and a square annotation; the
    /// field's parent-free widget points back at the page.
    fn form_sample() -> Vec<u8> {
        let stream = |d: &str, data: &str| {
            format!(
                "<< {d} /Length {} >>\nstream\n{data}\nendstream",
                data.len()
            )
        };
        let objs = [
            "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 9 0 R >> >> /Annots [5 0 R 6 0 R] >>".to_owned(),
            stream("", "BT /F1 14 Tf 72 704 Td (Nombre:) Tj ET"),
            "<< /Type /Annot /Subtype /Widget /FT /Tx /T (nombre) /V (Ana) /Rect [150 698 350 722] /P 3 0 R /AP << /N 7 0 R >> >>".to_owned(),
            "<< /Type /Annot /Subtype /Square /Rect [100 500 220 580] /P 3 0 R /AP << /N 8 0 R >> >>".to_owned(),
            stream("/Type /XObject /Subtype /Form /BBox [0 0 200 24]", "0 0 1 RG 0.5 0.5 199 23 re S"),
            stream("/Type /XObject /Subtype /Form /BBox [0 0 120 80]", "1 0 0 RG 3 w 1.5 1.5 117 77 re S"),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
        ];
        let mut out = b"%PDF-1.7\n".to_vec();
        let mut offsets = vec![];
        for (i, o) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n{o}\nendobj\n", i + 1).bytes());
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).bytes());
        for o in offsets {
            out.extend(format!("{o:010} 00000 n \n").bytes());
        }
        out.extend(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objs.len() + 1
            )
            .bytes(),
        );
        out
    }

    #[test]
    fn fields_and_annotations_are_objects_cut_loose_from_the_document() {
        let mut e = PdfEdit::load(&form_sample()).unwrap();
        let v = e.blocks(0).unwrap();
        let objects = v["objects"].as_array().unwrap();
        let kinds: Vec<&str> = objects
            .iter()
            .map(|o| o["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["field", "annotation"], "{v}");
        assert_eq!(objects[0]["annots"], json!([0]));
        assert_eq!(objects[0]["bbox"], json!([150., 698., 350., 722.]));
        // Without the field: the square stays, without its reference to the old page.
        let rest = e.without(0, &[], &[0]).unwrap();
        let again = PdfEdit::load(&rest).unwrap();
        let page = again.page_id(0).unwrap();
        let annots = again.page_annots(page);
        assert_eq!(annots.len(), 1);
        assert_eq!(
            annots[0].get(b"Subtype").unwrap().as_name().unwrap(),
            b"Square"
        );
        assert!(!annots[0].has(b"P"));
        // The field alone: no text, no square, the widget with its value.
        let alone = e.isolate(0, &[], &[0]).unwrap();
        let mut only = PdfEdit::load(&alone).unwrap();
        let v = only.blocks(0).unwrap();
        assert_eq!(v["blocks"].as_array().unwrap().len(), 0, "{v}");
        let kinds: Vec<&str> = v["objects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["field"]);
    }

    #[test]
    fn clusters_join_touching_boxes_only() {
        let boxes = [
            [0., 0., 10., 10.],
            [11., 0., 20., 10.],
            [50., 50., 60., 60.],
            [19., 9., 30., 30.],
        ];
        let mut groups = cluster(&boxes, 1.5);
        groups.sort();
        assert_eq!(groups, vec![vec![0, 1, 3], vec![2]]);
    }

    #[test]
    fn subset_names_and_sfnt_checks() {
        assert_eq!(plain_name("ABCDEF+NotoSans-Bold"), "NotoSans-Bold");
        assert_eq!(plain_name("Arial+Bold"), "Arial+Bold");
        assert!(!sfnt_loadable(b"not a font"));
        assert_eq!(sfnt_glyph(b"", 'a'), None);
    }
}
