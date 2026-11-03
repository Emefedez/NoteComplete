//! Non-destructive edits over an immutable imported archive.
//! `.nfedit` is our project format, not an interoperable Noteful export.
use crate::{scene::line_svg, Error, Result, Scene};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
    /// Square ends (a highlighter rectangle): the band ends exactly at its points.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub square: bool,
    /// Pen pressure per point (a ballpoint stroke), as Noteful stores it: the
    /// drawn radius at each point, about 1.05 × pressure in the app. `width`
    /// is then only the nominal width. Fineliners, highlighters and tape omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pressure: Option<Vec<f64>>,
    /// Drawn below the page's other ink (a highlighter under handwriting).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub under: bool,
}
impl Line {
    /// A plain stroke: the given points, full width and colour, on layer 0.
    pub fn new(points: Vec<[f64; 2]>, width: f64, rgba: [f64; 4]) -> Self {
        Self {
            points,
            width,
            rgba,
            tool: 0,
            layer: 0,
            shape: None,
            square: false,
            pressure: None,
            under: false,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum Edit {
    Image {
        page: usize,
        image: crate::Image,
    },
    Retext {
        page: usize,
        id: String,
        image: crate::Image,
    },
    Adjust {
        page: usize,
        id: String,
        adjustment: crate::Adjustment,
        /// Undone and redone with the edit before it (a group moved as one).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        joined: bool,
    },
    Replace {
        page: usize,
        id: String,
        line: Line,
    },
    Layer {
        layer: crate::Layer,
    },
    Add {
        page: usize,
        line: Line,
    },
    Erase {
        page: usize,
        ids: Vec<String>,
    },
    /// A page's new size; content keeps its page coordinates (anchored top
    /// left). `pdf_rect` moves or scales its PDF; otherwise the PDF stays put.
    ResizePage {
        page: usize,
        size: [f64; 2],
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pdf_rect: Option<[f64; 4]>,
    },
    InsertPages {
        at: usize,
        pages: Vec<crate::NewPage>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pdf: Option<crate::NewPdf>,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Project {
    format: String,
    version: u32,
    source_base64: String,
    pub(crate) history: Vec<Edit>,
    pub(crate) cursor: usize,
    /// Markdown notes kept with the note (project version 5).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    markdown: String,
    /// Words of handwriting written from Markdown on original pages (project version 6).
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    ink_text: std::collections::BTreeMap<usize, Vec<crate::InkWord>>,
    /// An infinite canvas (project version 7).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    canvas: bool,
    /// Text recognized in the handwriting (OCR in the reader), by page slot (project version 8).
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    recognized_text: std::collections::BTreeMap<usize, Vec<crate::InkWord>>,
    /// Edits before this one were compacted and cannot be undone (project version 9).
    #[serde(default, skip_serializing_if = "is_zero")]
    floor: usize,
}
fn is_zero(n: &usize) -> bool {
    *n == 0
}
impl Edit {
    fn joined(&self) -> bool {
        matches!(self, Edit::Adjust { joined: true, .. })
    }
}
pub struct Editor {
    pub(crate) source: Vec<u8>,
    pub scene: Scene,
    pub(crate) history: Vec<Edit>,
    pub(crate) cursor: usize,
    /// Pages and PDFs added by InsertPages edits, rebuilt by `sync_inserted`.
    pub(crate) inserted: Vec<crate::Page>,
    pub(crate) added_pdfs: Vec<(String, Vec<u8>)>,
    /// Markdown notes (see markdown.rs); not part of the edit history.
    pub(crate) markdown: String,
    /// Words of handwriting written from Markdown: on original pages (by slot),
    /// and on inserted pages (with their InsertPages edit, so undo keeps them in step).
    pub(crate) base_words: std::collections::BTreeMap<usize, Vec<crate::InkWord>>,
    pub(crate) inserted_words: Vec<Vec<crate::InkWord>>,
    /// An infinite canvas (canvas.rs): one page that grows as you write.
    pub(crate) canvas: bool,
    /// Text a host recognized in the handwriting (OCR), by page slot; not part of the
    /// edit history, like the Markdown notes.
    pub(crate) recognized: std::collections::BTreeMap<usize, Vec<crate::InkWord>>,
    /// Undo stops here: the edits before it were compacted (compact.rs).
    pub(crate) floor: usize,
}

fn points_valid(points: &[[f64; 2]]) -> bool {
    !points.is_empty()
        && points.len() <= 8192
        && points
            .iter()
            .flatten()
            .all(|v| v.is_finite() && v.abs() <= 1e6)
}
pub(crate) fn point_distance(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let d = [b[0] - a[0], b[1] - a[1]];
    let len = d[0] * d[0] + d[1] * d[1];
    let t = if len > 0. {
        ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len
    } else {
        0.
    };
    (p[0] - a[0] - t.clamp(0., 1.) * d[0]).hypot(p[1] - a[1] - t.clamp(0., 1.) * d[1])
}
fn cross(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
fn segments_hit(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2], radius: f64) -> bool {
    // Reject separated bounding boxes before the more expensive distance tests.
    if (0..2).any(|i| {
        a[i].max(b[i]) + radius < c[i].min(d[i]) || c[i].max(d[i]) + radius < a[i].min(b[i])
    }) {
        return false;
    }
    let crosses = cross(a, b, c) * cross(a, b, d) < 0. && cross(c, d, a) * cross(c, d, b) < 0.;
    crosses
        || [
            point_distance(a, c, d),
            point_distance(b, c, d),
            point_distance(c, a, b),
            point_distance(d, a, b),
        ]
        .iter()
        .any(|v| *v <= radius)
}
fn hits(path: &[[f64; 2]], ink: &[[f64; 2]], radius: f64) -> bool {
    for (i, a) in path.iter().enumerate() {
        let b = path.get(i + 1).unwrap_or(a);
        for (j, c) in ink.iter().enumerate() {
            let d = ink.get(j + 1).unwrap_or(c);
            if segments_hit(*a, *b, *c, *d, radius) {
                return true;
            }
        }
    }
    false
}
impl Editor {
    pub fn open(source: &[u8]) -> Result<Self> {
        let scene = Scene::parse(source)?;
        Ok(Self {
            source: source.to_vec(),
            scene,
            history: Vec::new(),
            cursor: 0,
            inserted: Vec::new(),
            added_pdfs: Vec::new(),
            markdown: String::new(),
            base_words: Default::default(),
            inserted_words: Vec::new(),
            canvas: false,
            recognized: Default::default(),
            floor: 0,
        })
    }
    /// A page by slot (see pages.rs); hosts map display positions with `slot`.
    pub(crate) fn page(&self, page: usize) -> Result<&crate::Page> {
        self.scene
            .pages
            .get(page)
            .or_else(|| self.inserted.get(page.checked_sub(self.scene.pages.len())?))
            .ok_or_else(|| Error::new(0, "Page outside document"))
    }
    pub(crate) fn deleted(&self, page: usize) -> HashSet<&str> {
        self.history[..self.cursor]
            .iter()
            .filter_map(|e| match e {
                Edit::Erase { page: p, ids } if *p == page => Some(ids.iter().map(String::as_str)),
                _ => None,
            })
            .flatten()
            .collect()
    }
    pub(crate) fn additions(&self, page: usize) -> impl Iterator<Item = (String, &Line)> {
        let mut replacements = HashMap::new();
        for edit in &self.history[..self.cursor] {
            if let Edit::Replace { page: p, id, line } = edit {
                if *p == page {
                    replacements.insert(id.as_str(), line);
                }
            }
        }
        self.history[..self.cursor]
            .iter()
            .enumerate()
            .filter_map(move |(i, e)| match e {
                Edit::Add { page: p, line } if *p == page => {
                    let id = format!("new:{i}");
                    let line = replacements.get(id.as_str()).copied().unwrap_or(line);
                    Some((id, line))
                }
                _ => None,
            })
    }
    pub(crate) fn commit(&mut self, edit: Edit) -> Result<()> {
        self.history
            .try_reserve(1)
            .map_err(|e| Error::new(0, e.to_string()))?;
        let pages_changed = matches!(edit, Edit::InsertPages { .. })
            || self.history[self.cursor..]
                .iter()
                .any(|e| matches!(e, Edit::InsertPages { .. }));
        self.history.truncate(self.cursor);
        self.history.push(edit);
        self.cursor += 1;
        if pages_changed {
            self.sync_inserted()?;
        }
        Ok(())
    }
    pub fn layers(&self) -> Vec<crate::Layer> {
        let mut layers = self.scene.layers.clone();
        for edit in &self.history[..self.cursor] {
            if let Edit::Layer { layer } = edit {
                if let Some(l) = layers.iter_mut().find(|l| l.id == layer.id) {
                    *l = layer.clone();
                } else {
                    layers.push(layer.clone());
                }
            }
        }
        layers
    }
    pub fn set_layer(&mut self, layer: crate::Layer) -> Result<()> {
        if layer.name.trim().is_empty()
            || !layer.opacity.is_finite()
            || !(0.0..=1.0).contains(&layer.opacity)
        {
            return Err(Error::new(0, "Invalid layer"));
        }
        self.commit(Edit::Layer { layer })
    }
    pub fn add_line(&mut self, page: usize, line: Line) -> Result<()> {
        self.add_lines(page, vec![line])
    }
    /// Like `add_line`, under the page's other ink (a highlighter fill).
    pub fn add_line_under(&mut self, page: usize, mut line: Line) -> Result<()> {
        line.under = true;
        self.add_lines(page, vec![line])
    }
    /// Many strokes on one page (written handwriting): checked once against
    /// the layers, then added in order. Nothing is added when one is invalid.
    pub fn add_lines(&mut self, page: usize, mut lines: Vec<Line>) -> Result<()> {
        self.page(page)?;
        let layers = self.layers();
        for line in &mut lines {
            if let Some(shape) = &line.shape {
                line.points = shape.points();
            }
            if !layers
                .iter()
                .any(|l| l.id == line.layer && l.visible && !l.locked)
            {
                return Err(Error::new(0, "Invalid fixed-width line"));
            }
            Self::check_line(line)?;
        }
        self.history
            .try_reserve(lines.len())
            .map_err(|e| Error::new(0, e.to_string()))?;
        for line in lines {
            self.commit(Edit::Add { page, line })?;
        }
        Ok(())
    }
    fn check_line(line: &Line) -> Result<()> {
        if line.shape.as_ref().is_some_and(|s| !s.fill_valid()) {
            return Err(Error::new(0, "Invalid shape fill"));
        }
        let pressure_ok = line.pressure.as_ref().is_none_or(|p| {
            line.tool == 0
                && p.len() == line.points.len()
                && p.iter().all(|v| v.is_finite() && (0.0..=50.).contains(v))
        });
        // Tools: 0 pen, 1 highlighter, 2 tape (exported as native tape ink).
        if line.tool > 2
            || !pressure_ok
            || !points_valid(&line.points)
            || !line.width.is_finite()
            // Tape strips can cover a whole block of text; ink stays thin.
            || !(0.1..=if line.tool == 2 || line.square { 2000. } else { 100. }).contains(&line.width)
            || line
                .rgba
                .iter()
                .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
        {
            return Err(Error::new(0, "Invalid fixed-width line"));
        }
        Ok(())
    }
    pub fn resize_shape(&mut self, page: usize, id: &str, shape: crate::Shape) -> Result<()> {
        let mut line = self
            .additions(page)
            .find(|(key, _)| key == id)
            .map(|(_, l)| l.clone())
            .ok_or_else(|| Error::new(0, "Shape not found"))?;
        if self.deleted(page).contains(id)
            || self.is_locked(page, id)
            || line.shape.as_ref().is_none_or(|s| s.kind != shape.kind)
            || !self
                .layers()
                .iter()
                .any(|l| l.id == line.layer && l.visible && !l.locked)
        {
            return Err(Error::new(0, "Shape cannot be resized"));
        }
        line.points = shape.points();
        if !points_valid(&line.points) {
            return Err(Error::new(0, "Invalid shape coordinates"));
        }
        // Resizing keeps the inside colour (the handles send only the geometry).
        let mut shape = shape;
        shape.fill = shape.fill.or(line.shape.as_ref().and_then(|s| s.fill));
        if !shape.fill_valid() {
            return Err(Error::new(0, "Invalid shape fill"));
        }
        line.shape = Some(shape);
        self.commit(Edit::Replace {
            page,
            id: id.to_owned(),
            line,
        })
    }
    /// Sweep a round eraser; remove each touched whole stroke in one undo action.
    /// Imported images and text boxes are not eraser targets; shapes are, by their outline.
    pub fn erase_path(&mut self, page: usize, path: &[[f64; 2]], radius: f64) -> Result<usize> {
        let p = self.page(page)?;
        if !points_valid(path) || !radius.is_finite() || !(0.1..=100.).contains(&radius) {
            return Err(Error::new(0, "Invalid eraser path"));
        }
        let deleted = self.deleted(page);
        let adjustments = self.adjustments(page);
        let layers = self.layers();
        let editable = |id| layers.iter().any(|l| l.id == id && l.visible && !l.locked);
        // Items locked in place are not eraser targets.
        let locked =
            |id: &str, native: bool| adjustments.get(id).and_then(|a| a.locked).unwrap_or(native);
        let mut ids = Vec::new();
        for item in &p.items {
            if !item.hit_points().is_empty()
                && editable(item.layer)
                && !locked(&item.id, item.locked())
                && !deleted.contains(item.id.as_str())
                && if let Some(a) = adjustments.get(item.id.as_str()) {
                    let points = if let Some(s) = &item.stroke {
                        crate::manipulation::adjusted_stroke(s, a).points
                    } else {
                        crate::scene::object(
                            &crate::manipulation::adjusted_object(item, a),
                            None,
                            0,
                        )?
                        .hit
                    };
                    hits(
                        path,
                        &points,
                        radius + a.width.unwrap_or(item.radius * 2.) / 2.,
                    )
                } else {
                    hits(path, item.hit_points(), radius + item.radius)
                }
            {
                ids.push(item.id.clone());
            }
        }
        for (id, line) in self.additions(page) {
            if editable(line.layer)
                && !locked(&id, false)
                && !deleted.contains(id.as_str())
                && if let Some(a) = adjustments.get(id.as_str()) {
                    let line = crate::manipulation::adjusted_line(line, a);
                    hits(path, &line.points, radius + line.width / 2.)
                } else {
                    hits(path, &line.points, radius + line.width / 2.)
                }
            {
                ids.push(id);
            }
        }
        let count = ids.len();
        if count > 0 {
            self.commit(Edit::Erase { page, ids })?;
        }
        Ok(count)
    }
    /// Undo the last edit, and the edits joined to it (a group moved as one).
    pub fn undo(&mut self) {
        while self.cursor > self.floor {
            self.cursor -= 1;
            if !self.history[self.cursor].joined() {
                break;
            }
        }
    }
    pub fn redo(&mut self) {
        if self.cursor < self.history.len() {
            self.cursor += 1;
            while self.cursor < self.history.len() && self.history[self.cursor].joined() {
                self.cursor += 1;
            }
        }
    }
    pub fn view(&self, page: usize) -> Result<Value> {
        let p = self.page(page)?;
        let deleted = self.deleted(page);
        let adjustments = self.adjustments(page);
        let additions: Vec<_> = self.additions(page).collect();
        let mut content = p.background.clone();
        let mut imported = 0;
        let mut added = 0;
        let layers = self.layers();
        // Tape covers whatever is under it, so it is drawn after every layer's content
        // (keeping its own layer's opacity).
        let mut tapes = String::new();
        for layer in &layers {
            if !layer.visible {
                continue;
            }
            let mut layer_tapes = String::new();
            content.push_str(&format!(
                "<g data-layer=\"{}\" opacity=\"{}\">",
                layer.id, layer.opacity
            ));
            // Under-ink additions (highlighter fills) go below the layer's ink.
            let added_in_layer = |under: bool| {
                additions
                    .iter()
                    .filter(move |(_, l)| l.layer == layer.id && l.under == under)
            };
            for (id, line) in added_in_layer(true) {
                if !deleted.contains(id.as_str()) {
                    content.push_str(&format!(
                        "<g data-item=\"{id}\">{}</g>",
                        added_svg(
                            &adjustments
                                .get(id.as_str())
                                .map(|a| crate::manipulation::adjusted_line(line, a))
                                .unwrap_or_else(|| (*line).clone())
                        )
                    ));
                    added += 1;
                }
            }
            for item in p.items.iter().filter(|i| i.layer == layer.id) {
                if !deleted.contains(item.id.as_str()) {
                    let target = if item.tape().is_some() {
                        &mut layer_tapes
                    } else {
                        &mut content
                    };
                    target.push_str(&format!(
                        "<g data-item=\"{}\">{}</g>",
                        item.id,
                        crate::manipulation::item_svg(
                            item,
                            adjustments.get(item.id.as_str()).copied()
                        )?
                    ));
                    imported += 1;
                }
            }
            for (id, image) in self
                .images(page)
                .filter(|(_, image)| image.layer == layer.id)
            {
                if !deleted.contains(id.as_str()) {
                    let item = image.item(id.clone());
                    content.push_str(&format!(
                        "<g data-item=\"{id}\">{}</g>",
                        crate::manipulation::item_svg(
                            &item,
                            adjustments.get(id.as_str()).copied()
                        )?
                    ));
                    added += 1;
                }
            }
            for (id, line) in added_in_layer(false) {
                if !deleted.contains(id.as_str()) {
                    let target = if line.tool == 2 {
                        &mut layer_tapes
                    } else {
                        &mut content
                    };
                    target.push_str(&format!(
                        "<g data-item=\"{id}\"{}>{}</g>",
                        if line.tool == 2 {
                            format!(" data-tape=\"{id}\" data-revealed=\"0\" opacity=\"1\"")
                        } else {
                            String::new()
                        },
                        {
                            let svg = added_svg(
                                &adjustments
                                    .get(id.as_str())
                                    .map(|a| crate::manipulation::adjusted_line(line, a))
                                    .unwrap_or_else(|| (*line).clone()),
                            );
                            if line.tool == 2 {
                                crate::scene::tape_with_pattern(&svg)
                            } else {
                                svg
                            }
                        }
                    ));
                    added += 1;
                }
            }
            content.push_str("</g>");
            if !layer_tapes.is_empty() {
                tapes.push_str(&format!(
                    "<g data-tapes=\"{}\" opacity=\"{}\">{layer_tapes}</g>",
                    layer.id, layer.opacity
                ));
            }
        }
        content.push_str(&tapes);
        let (size, pdf_background) = self.page_geometry(page)?;
        let [w, h] = size;
        let texts: Vec<_> = p
            .items
            .iter()
            .filter(|i| !deleted.contains(i.id.as_str()))
            .filter_map(|i| {
                // Bounds let search highlight typed text like PDF and OCR words.
                let mut t = serde_json::to_value(i.text.as_ref()?).ok()?;
                t["bounds"] = json!(i.bounds);
                Some(t)
            })
            .chain(
                self.images(page)
                    .filter(|(id, image)| image.text.is_some() && !deleted.contains(id.as_str()))
                    .filter_map(|(id, image)| {
                        let item = image.item(id.clone());
                        let mut t = serde_json::to_value(item.text.as_ref()?).ok()?;
                        t["bounds"] = json!(self.current_bounds(page, &id).ok()?);
                        t["id"] = json!(id);
                        Some(t)
                    }),
            )
            .collect();
        let order = self.page_order();
        // Recording page lists are slots; the host navigates by display position.
        let recordings: Vec<_> = self
            .scene
            .recordings
            .iter()
            .map(|r| {
                let mut r = serde_json::to_value(r).unwrap_or(Value::Null);
                if let Some(pages) = r["pages"].as_array_mut() {
                    for p in pages.iter_mut() {
                        if let Some(d) = p.as_u64().and_then(|s| self.display_index(s as usize)) {
                            *p = json!(d);
                        }
                    }
                }
                r
            })
            .collect();
        let defs = if content.contains("nc-tape-pattern") {
            crate::scene::TAPE_DEFS
        } else {
            ""
        };
        let svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\" style=\"isolation:isolate\">{defs}{content}</svg>");
        Ok(
            json!({"title":self.scene.title,"pages":order.len(),"page":self.display_index(page),"slot":page,"size":size,"base_size":p.size,"svg":svg,"warnings":p.warnings,"texts":texts,"audio":self.scene.audio,"recordings":recordings,"layers":layers,"shapes":self.additions(page).filter(|(id,l)| l.shape.is_some()&&!deleted.contains(id.as_str())&&layers.iter().any(|layer|layer.id==l.layer&&layer.visible)).map(|(id,l)|json!({"id":id,"line":l})).collect::<Vec<_>>(),"page_sizes":order.iter().map(|s| self.page_geometry(*s).map(|g| g.0)).collect::<Result<Vec<_>>>()?,"pdf_background":pdf_background,"tapes":p.items.iter().filter(|i| !deleted.contains(i.id.as_str())).filter_map(|i| i.tape().map(|open| json!({"id":i.id,"bounds":i.bounds,"revealed":open}))).chain(additions.iter().filter(|(id, l)| l.tool == 2 && !deleted.contains(id.as_str())).map(|(id, l)| { let [x, y, w, h] = crate::manipulation::bounds(&l.points); let r = l.width / 2.; json!({"id":id,"bounds":[x - r, y - r, w + 2. * r, h + 2. * r],"revealed":false}) })).collect::<Vec<_>>(),"locked":self.locked_items(page),"timings":p.timings.iter().filter(|t| !deleted.contains(t.item_id.as_str())).collect::<Vec<_>>(),"visible_imported":imported,"visible_added":added,"erased":deleted.len(),"can_undo":self.cursor>self.floor,"history_floor":self.floor,"can_redo":self.cursor<self.history.len(),"edit_count":self.cursor,"ink_text":self.ink_words(page),"recognized_text":self.recognized_words(page),"canvas":self.canvas}),
        )
    }
    /// Items locked in place on a page, with their current bounds.
    fn locked_items(&self, page: usize) -> Vec<Value> {
        let deleted = self.deleted(page);
        let adjustments = self.adjustments(page);
        let Ok(p) = self.page(page) else {
            return vec![];
        };
        p.items
            .iter()
            .map(|i| (i.id.clone(), i.locked()))
            .chain(self.additions(page).map(|(id, _)| (id, false)))
            .chain(self.images(page).map(|(id, _)| (id, false)))
            .filter(|(id, native)| {
                !deleted.contains(id.as_str())
                    && adjustments
                        .get(id.as_str())
                        .and_then(|a| a.locked)
                        .unwrap_or(*native)
            })
            .filter_map(|(id, _)| {
                Some(json!({"id": id, "bounds": self.current_bounds(page, &id).ok()?}))
            })
            .collect()
    }
    pub fn save_project(&self) -> Result<String> {
        let data = serde_json::to_string(&Project {
            format: "noteful-re-project".to_owned(),
            version: if self.floor > 0 {
                9
            } else if !self.recognized.is_empty() {
                8
            } else if self.canvas {
                7
            } else if !self.base_words.is_empty()
                || self.history.iter().any(|e| {
                    matches!(e, Edit::InsertPages { pages, .. } if pages.iter().any(|p| !p.words.is_empty()))
                }) {
                6
            } else if !self.markdown.is_empty() {
                5
            } else if self.history.iter().any(|e| {
                matches!(e, Edit::Retext { .. } | Edit::ResizePage { .. })
                    || matches!(e, Edit::Image { image, .. } if image.text.is_some())
            }) {
                4
            } else if self
                .history
                .iter()
                .any(|e| matches!(e, Edit::InsertPages { .. }))
            {
                3
            } else if self.history.iter().any(|e| matches!(e, Edit::Image { .. })) {
                2
            } else {
                1
            },
            source_base64: STANDARD.encode(&self.source),
            history: self.history.clone(),
            cursor: self.cursor,
            markdown: self.markdown.clone(),
            ink_text: self.base_words.clone(),
            canvas: self.canvas,
            recognized_text: self.recognized.clone(),
            floor: self.floor,
        })
        .map_err(|e| Error::new(0, e.to_string()))?;
        Ok(data)
    }
    /// A short digest of the edit history and its undo position (not the source
    /// or the notes). Replicas that applied the same edits in the same order (a
    /// shared drawing session) have the same digest, so a copy that diverged can
    /// be noticed and reloaded.
    pub fn history_digest(&self) -> Result<String> {
        let history =
            serde_json::to_vec(&self.history).map_err(|e| Error::new(0, e.to_string()))?;
        let mut data = Vec::with_capacity(history.len() + 8);
        data.extend((self.cursor as u64).to_le_bytes());
        data.extend(history);
        Ok(crate::md5_hex(&data))
    }
    /// The words of handwriting written from Markdown on page `slot` (empty for
    /// other pages): hosts index them like recognized text.
    pub fn ink_words(&self, slot: usize) -> &[crate::InkWord] {
        let base = self.scene.pages.len();
        if slot < base {
            self.base_words.get(&slot).map_or(&[], Vec::as_slice)
        } else {
            self.inserted_words
                .get(slot - base)
                .map_or(&[], Vec::as_slice)
        }
    }
    /// Text recognized in the handwriting of page `slot` (OCR in the reader).
    pub fn recognized_words(&self, slot: usize) -> &[crate::InkWord] {
        self.recognized.get(&slot).map_or(&[], Vec::as_slice)
    }
    /// Keeps the text recognized on page `slot`, so it travels with the note (projects
    /// and `.notecomp`) and tools that read the note (the MCP server) see it. Empty clears it.
    pub fn set_recognized_words(&mut self, slot: usize, words: Vec<crate::InkWord>) -> Result<()> {
        if !self.page_order().contains(&slot) || !crate::pages::words_valid(&words) {
            return Err(Error::new(0, "Invalid page text"));
        }
        if words.is_empty() {
            self.recognized.remove(&slot);
        } else {
            self.recognized.insert(slot, words);
        }
        Ok(())
    }
    /// Keeps the words written on an original page (a notebook made from Markdown).
    pub fn set_ink_words(&mut self, slot: usize, words: Vec<crate::InkWord>) -> Result<()> {
        if slot >= self.scene.pages.len() || !crate::pages::words_valid(&words) {
            return Err(Error::new(0, "Invalid page text"));
        }
        if words.is_empty() {
            self.base_words.remove(&slot);
        } else {
            self.base_words.insert(slot, words);
        }
        Ok(())
    }
    pub fn pdf_bytes(&self, id: &str) -> Result<&[u8]> {
        if let Some(bytes) = self.added_pdf(id) {
            return Ok(bytes);
        }
        let asset = self
            .scene
            .pdf_assets
            .iter()
            .find(|a| a.id == id)
            .ok_or_else(|| Error::new(0, "PDF resource not found"))?;
        Ok(&self.source[asset.offset..asset.offset + asset.bytes])
    }
    pub fn audio_bytes(&self, id: &str) -> Result<&[u8]> {
        let asset = self
            .scene
            .audio
            .iter()
            .find(|a| a.id == id)
            .ok_or_else(|| Error::new(0, "Audio resource not found"))?;
        Ok(&self.source[asset.offset..asset.offset + asset.bytes])
    }
    pub fn open_project(data: &str) -> Result<Self> {
        let project: Project =
            serde_json::from_str(data).map_err(|e| Error::new(0, e.to_string()))?;
        if project.format != "noteful-re-project"
            || !matches!(project.version, 1..=9)
            || project
                .ink_text
                .values()
                .chain(project.recognized_text.values())
                .any(|w| !crate::pages::words_valid(w))
            || project.markdown.len() > crate::markdown::MARKDOWN_LIMIT
            || project.cursor > project.history.len()
            || project.floor > project.cursor
        {
            return Err(Error::new(0, "Unsupported or invalid project"));
        }
        let source = STANDARD
            .decode(project.source_base64)
            .map_err(|e| Error::new(0, e.to_string()))?;
        let mut editor = Self::open(&source)?;
        for edit in project.history {
            match edit {
                Edit::Image { page, image } => editor.add_image(page, image)?,
                Edit::Retext { page, id, image } => {
                    let text = image
                        .text
                        .ok_or_else(|| Error::new(0, "Missing edited text"))?;
                    editor.edit_text(page, &id, text, [image.bounds[2], image.bounds[3]])?
                }
                Edit::Adjust {
                    page,
                    id,
                    mut adjustment,
                    joined,
                } => {
                    adjustment.joined = joined;
                    editor.adjust_item(page, &id, adjustment)?
                }
                Edit::Replace { page, id, line } => {
                    let previous = editor
                        .additions(page)
                        .find(|(key, _)| *key == id)
                        .map(|(_, l)| l)
                        .ok_or_else(|| Error::new(0, "Invalid replaced shape"))?;
                    if line.width != previous.width
                        || line.rgba != previous.rgba
                        || line.tool != previous.tool
                        || line.layer != previous.layer
                    {
                        return Err(Error::new(0, "Resize cannot change style"));
                    }
                    let shape = line
                        .shape
                        .ok_or_else(|| Error::new(0, "Missing replacement shape"))?;
                    editor.resize_shape(page, &id, shape)?;
                }
                Edit::Layer { layer } => editor.set_layer(layer)?,
                Edit::InsertPages { at, pages, pdf } => editor.insert_pages(at, pages, pdf)?,
                Edit::ResizePage {
                    page,
                    size,
                    pdf_rect,
                } => editor.resize_page(page, size, pdf_rect)?,
                Edit::Add { page, line } => editor.add_line(page, line)?,
                Edit::Erase { page, ids } => {
                    let p = editor.page(page)?;
                    let deleted = editor.deleted(page);
                    let valid: HashSet<String> = p
                        .items
                        .iter()
                        .map(|i| i.id.clone())
                        .chain(editor.additions(page).map(|(id, _)| id))
                        .chain(editor.images(page).map(|(id, _)| id))
                        .collect();
                    let unique: HashSet<_> = ids.iter().collect();
                    if ids.is_empty()
                        || unique.len() != ids.len()
                        || ids
                            .iter()
                            .any(|id| !valid.contains(id) || deleted.contains(id.as_str()))
                    {
                        return Err(Error::new(0, "Invalid erased item IDs"));
                    }
                    editor.commit(Edit::Erase { page, ids })?;
                }
            }
        }
        editor.cursor = project.cursor;
        editor.floor = project.floor;
        editor.markdown = project.markdown;
        for (slot, words) in project.ink_text {
            editor.set_ink_words(slot, words)?;
        }
        editor.set_canvas(project.canvas)?;
        for (slot, words) in project.recognized_text {
            editor.set_recognized_words(slot, words)?;
        }
        Ok(editor)
    }
}

pub(crate) fn added_svg(line: &Line) -> String {
    // A filled shape: its inside first, then the outline over it.
    if let Some(fill) = line
        .shape
        .as_ref()
        .filter(|s| s.closed())
        .and_then(|s| s.fill)
    {
        let points: Vec<String> = line
            .points
            .iter()
            .map(|[x, y]| format!("{x:.2},{y:.2}"))
            .collect();
        let rgb = |v: f64| (v.clamp(0., 1.) * 255.).round() as u8;
        let mut outline = line.clone();
        if let Some(s) = outline.shape.as_mut() {
            s.fill = None;
        }
        return format!(
            "<polygon points=\"{}\" fill=\"rgb({},{},{})\" fill-opacity=\"{}\" stroke=\"none\"/>{}",
            points.join(" "),
            rgb(fill[0]),
            rgb(fill[1]),
            rgb(fill[2]),
            fill[3].clamp(0., 1.),
            added_svg(&outline)
        );
    }
    // A ballpoint stroke draws its stored pressure as the radius, as decoded ink does.
    if let Some(pressure) = line.pressure.as_ref().filter(|_| line.tool == 0) {
        let mut rgba = line.rgba;
        rgba[3] = 1.;
        return format!(
            "<g opacity=\"{}\">{}</g>",
            line.rgba[3],
            crate::scene::run_svg(&line.points, pressure, line.width / 2., &rgba)
        );
    }
    let mut svg = line_svg(&line.points, line.width / 2., &line.rgba);
    // Tape is a strip, and a highlighter rectangle a band: square ends, so a
    // drag can lay a rectangle.
    if (line.tool == 2 || line.square) && line.points.len() > 1 {
        svg = svg.replacen(
            "stroke-linecap=\"round\" stroke-linejoin=\"round\"",
            "stroke-linecap=\"butt\" stroke-linejoin=\"miter\"",
            1,
        );
    }
    if line.tool == 2 {
        return svg;
    }
    if line.tool == 1 {
        format!("<g opacity=\"0.5\" style=\"mix-blend-mode:multiply\">{svg}</g>")
    } else {
        svg
    }
}
