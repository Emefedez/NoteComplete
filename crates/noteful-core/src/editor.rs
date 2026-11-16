//! Non-destructive edits over an immutable imported archive.
//! `.nfedit` is our project format, not an interoperable Noteful export.
use crate::{scene::line_svg, Error, Result, Scene};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
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
    /// Undone and redone with the edit before it: the lines of one gesture (a highlight over
    /// several lines of text) are one step.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub joined: bool,
    /// One part of a graph or table (part.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<crate::Part>,
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
            joined: false,
            part: None,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        order: Option<Vec<u32>>,
    },
    Add {
        page: usize,
        line: Line,
    },
    Erase {
        page: usize,
        ids: Vec<String>,
        /// Undone and redone with the edit before it… or, first in a replacement, the edits
        /// after it are joined to it (a graph or table drawn again).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        joined: bool,
    },
    /// A page's new size; content keeps its page coordinates (anchored top
    /// left). `pdf_rect` moves or scales its PDF; otherwise the PDF stays put.
    ResizePage {
        page: usize,
        size: [f64; 2],
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pdf_rect: Option<[f64; 4]>,
        /// Undone and redone with the edit before it (every page resized at once).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        joined: bool,
    },
    InsertPages {
        at: usize,
        pages: Vec<crate::NewPage>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pdf: Option<crate::NewPdf>,
    },
    MovePage {
        from: usize,
        to: usize,
    },
    /// Replaces or clears the PDF background on specific page slots.
    SetPageBackground {
        pages: Vec<crate::PageBackground>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pdf: Option<crate::NewPdf>,
    },
    /// Deletes an embedded native Noteful audio recording by asset ID.
    DeleteAudio {
        asset_id: String,
    },
    /// Strips embedded native Noteful audio bytes while keeping its recording timeline as animation.
    StripAudioMedia {
        asset_id: String,
    },
}

/// Added recording bundled inside a `.nfedit` v11 project.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectAddedAudio {
    pub id: String,
    pub name: String,
    pub mime: String,
    #[serde(default)]
    pub created: f64,
    pub bytes_base64: String,
}

/// Options controlling which resources are kept when exporting a filtered `.nfedit`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct ProjectExportOptions {
    pub include_history: bool,
    pub include_pdfs: bool,
    pub include_native_audio: bool,
    pub include_added_audio: bool,
    pub include_markdown: bool,
    pub include_ink_text: bool,
    pub include_recognized_text: bool,
    pub include_study: bool,
    pub include_exam: bool,
}
impl Default for ProjectExportOptions {
    fn default() -> Self {
        Self {
            include_history: true,
            include_pdfs: true,
            include_native_audio: true,
            include_added_audio: true,
            include_markdown: true,
            include_ink_text: true,
            include_recognized_text: true,
            include_study: true,
            include_exam: true,
        }
    }
}

/// Byte footprint of each resource category inside `.nfedit` (total matches full export).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectBreakdown {
    pub base_bytes: usize,
    pub history_bytes: usize,
    pub history_count: usize,
    pub pdf_bytes: usize,
    pub pdf_count: usize,
    pub native_audio_bytes: usize,
    pub native_audio_count: usize,
    pub added_audio_bytes: usize,
    pub added_audio_count: usize,
    pub markdown_bytes: usize,
    pub text_bytes: usize,
    pub study_bytes: usize,
    pub exam_bytes: usize,
    pub total_bytes: usize,
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
    /// Flashcard decks, quizzes, and scratchpad notes kept with the note (project version 10).
    #[serde(default, skip_serializing_if = "ProjectStudy::is_empty")]
    study: ProjectStudy,
    /// Recordings added in NoteComplete bundled with the project (project version 11).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    added_audio: Vec<ProjectAddedAudio>,
    /// Embedded interactive exam HTML and structured metadata kept with the project (project version 12).
    #[serde(default, skip_serializing_if = "ProjectExam::is_empty")]
    exam: ProjectExam,
}

/// Upper bound for the study data serialized inside a project (bytes).
pub const STUDY_LIMIT: usize = 8 << 20;

/// Upper bound for embedded interactive exam HTML/source data serialized inside a project (bytes).
pub const EXAM_LIMIT: usize = 16 << 20;

/// Study sets kept alongside a note inside `.nfedit` projects (version 10).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ProjectStudy {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub decks: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub quizzes: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub scratch: Vec<serde_json::Value>,
}
impl ProjectStudy {
    /// True when no decks, quizzes, or scratchpad entries are stored.
    pub fn is_empty(&self) -> bool {
        self.decks.is_empty() && self.quizzes.is_empty() && self.scratch.is_empty()
    }
}

/// Interactive exam HTML and optional structured exam source kept inside `.nfedit` (version 12).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ProjectExam {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub html: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<serde_json::Value>,
}
impl ProjectExam {
    /// True when neither embedded exam HTML nor structured exam data is stored.
    pub fn is_empty(&self) -> bool {
        self.html.is_empty() && self.source.is_none()
    }
}
fn is_zero(n: &usize) -> bool {
    *n == 0
}
pub(crate) fn apply_layer_edit(
    layers: &mut Vec<crate::Layer>,
    layer: &crate::Layer,
    order: Option<&[u32]>,
) {
    if let Some(l) = layers.iter_mut().find(|l| l.id == layer.id) {
        *l = layer.clone();
    } else {
        layers.push(layer.clone());
    }
    if let Some(order) = order {
        layers.sort_by_key(|l| {
            order
                .iter()
                .position(|&id| id == l.id)
                .unwrap_or(usize::MAX)
        });
    }
}
impl Edit {
    fn joined(&self) -> bool {
        match self {
            Edit::Adjust { joined, .. } | Edit::ResizePage { joined, .. } => *joined,
            Edit::Add { line, .. } => line.joined,
            Edit::Image { image, .. } => image.joined,
            Edit::Erase { joined, .. } => *joined,
            _ => false,
        }
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
    /// Study sets (decks, quizzes, scratchpad) kept with the note; not part of edit history.
    pub(crate) study: ProjectStudy,
    /// Recordings added in NoteComplete kept with the project; not part of edit history.
    pub(crate) added_audio: Vec<(crate::AddedAudio, Vec<u8>)>,
    /// Embedded interactive exam HTML and structured metadata; not part of edit history.
    pub(crate) exam: ProjectExam,
    /// The SVG of added lines, by the place of their `Add` edit in the history, so a view
    /// does not format every line again (view.rs). Emptied from the cursor on by `commit`.
    pub(crate) added_svg: std::cell::RefCell<Vec<Option<Box<str>>>>,
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
            study: ProjectStudy::default(),
            added_audio: Vec::new(),
            exam: ProjectExam::default(),
            added_svg: Default::default(),
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
                Edit::Erase { page: p, ids, .. } if *p == page => {
                    Some(ids.iter().map(String::as_str))
                }
                _ => None,
            })
            .flatten()
            .collect()
    }
    pub(crate) fn deleted_audio(&self) -> HashSet<&str> {
        self.history[..self.cursor]
            .iter()
            .filter_map(|e| match e {
                Edit::DeleteAudio { asset_id } => Some(asset_id.as_str()),
                _ => None,
            })
            .collect()
    }
    pub(crate) fn stripped_audio_media(&self) -> HashSet<&str> {
        self.history[..self.cursor]
            .iter()
            .filter_map(|e| match e {
                Edit::StripAudioMedia { asset_id } => Some(asset_id.as_str()),
                _ => None,
            })
            .collect()
    }
    /// Deletes an embedded native Noteful recording or animation (undoable until compacted).
    pub fn delete_audio(&mut self, asset_id: &str) -> Result<()> {
        let known = self.scene.audio.iter().any(|a| a.id == asset_id)
            || self.scene.recordings.iter().any(|r| r.asset_id == asset_id);
        if !known {
            return Err(Error::new(0, "Audio resource not found"));
        }
        if self.deleted_audio().contains(asset_id) {
            return Err(Error::new(0, "Audio recording already deleted"));
        }
        self.commit(Edit::DeleteAudio {
            asset_id: asset_id.to_owned(),
        })
    }
    /// Strips audio bytes from an embedded recording while preserving stroke timings as animation.
    pub fn strip_audio_media(&mut self, asset_id: &str) -> Result<()> {
        if !self.scene.audio.iter().any(|a| a.id == asset_id)
            || self.deleted_audio().contains(asset_id)
        {
            return Err(Error::new(0, "Audio resource not found"));
        }
        if self.stripped_audio_media().contains(asset_id) {
            return Err(Error::new(0, "Audio already converted to animation"));
        }
        self.commit(Edit::StripAudioMedia {
            asset_id: asset_id.to_owned(),
        })
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
        let pages_changed = matches!(
            edit,
            Edit::InsertPages { .. } | Edit::SetPageBackground { .. }
        ) || self.history[self.cursor..]
            .iter()
            .any(|e| matches!(e, Edit::InsertPages { .. } | Edit::SetPageBackground { .. }));
        self.history.truncate(self.cursor);
        // The edits from here on are replaced, and so is what was kept for them.
        self.added_svg.get_mut().truncate(self.cursor);
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
            if let Edit::Layer { layer, order } = edit {
                apply_layer_edit(&mut layers, layer, order.as_deref());
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
        self.commit(Edit::Layer { layer, order: None })
    }
    pub fn reorder_layers(&mut self, order: Vec<u32>) -> Result<()> {
        let layers = self.layers();
        let unique: HashSet<u32> = order.iter().copied().collect();
        if order.len() != layers.len()
            || unique.len() != layers.len()
            || !layers.iter().all(|l| unique.contains(&l.id))
        {
            return Err(Error::new(0, "Invalid layer order"));
        }
        if layers.iter().map(|l| l.id).eq(order.iter().copied()) {
            return Ok(());
        }
        let first_id = order[0];
        let layer = layers
            .into_iter()
            .find(|l| l.id == first_id)
            .ok_or_else(|| Error::new(0, "Invalid layer order"))?;
        self.commit(Edit::Layer {
            layer,
            order: Some(order),
        })
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
        if line.part.as_ref().is_some_and(|p| !p.valid()) {
            return Err(Error::new(0, "Invalid graph, table or prefab part"));
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
            self.commit(Edit::Erase {
                page,
                ids,
                joined: false,
            })?;
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
    fn serialize_project(mut project: Project) -> Result<String> {
        project.format = "noteful-re-project".to_owned();
        project.version = if !project.exam.is_empty() {
            12
        } else if !project.added_audio.is_empty() {
            11
        } else if !project.study.is_empty() {
            10
        } else if project.floor > 0 {
            9
        } else if !project.recognized_text.is_empty() {
            8
        } else if project.canvas {
            7
        } else if !project.ink_text.is_empty()
            || project.history.iter().any(|e| {
                matches!(e, Edit::InsertPages { pages, .. } if pages.iter().any(|p| !p.words.is_empty()))
            })
        {
            6
        } else if !project.markdown.is_empty() {
            5
        } else if project.history.iter().any(|e| {
            matches!(
                e,
                Edit::Retext { .. }
                    | Edit::ResizePage { .. }
                    | Edit::SetPageBackground { .. }
                    | Edit::DeleteAudio { .. }
            ) || matches!(e, Edit::Image { image, .. } if image.text.is_some())
        }) {
            4
        } else if project
            .history
            .iter()
            .any(|e| matches!(e, Edit::InsertPages { .. }))
        {
            3
        } else if project
            .history
            .iter()
            .any(|e| matches!(e, Edit::Image { .. }))
        {
            2
        } else {
            1
        };
        serde_json::to_string(&project).map_err(|e| Error::new(0, e.to_string()))
    }
    fn encode_added_audio(audio: &[(crate::AddedAudio, Vec<u8>)]) -> Vec<ProjectAddedAudio> {
        audio
            .iter()
            .map(|(meta, bytes)| ProjectAddedAudio {
                id: meta.id.clone(),
                name: meta.name.clone(),
                mime: meta.mime.clone(),
                created: meta.created,
                bytes_base64: STANDARD.encode(bytes),
            })
            .collect()
    }
    pub fn save_project(&self) -> Result<String> {
        Self::serialize_project(Project {
            format: String::new(),
            version: 0,
            source_base64: STANDARD.encode(&self.source),
            history: self.history.clone(),
            cursor: self.cursor,
            markdown: self.markdown.clone(),
            ink_text: self.base_words.clone(),
            canvas: self.canvas,
            recognized_text: self.recognized.clone(),
            floor: self.floor,
            study: self.study.clone(),
            added_audio: Self::encode_added_audio(&self.added_audio),
            exam: self.exam.clone(),
        })
    }
    /// Serializes the project keeping only the resource categories chosen in `options`.
    /// Stripping PDFs or native audio flattens edit history onto a compacted `.noteful` base.
    pub fn export_filtered_project(&self, options: ProjectExportOptions) -> Result<String> {
        let flatten =
            !options.include_history || !options.include_pdfs || !options.include_native_audio;
        let (source_bytes, history, cursor, floor, ink_text, recognized_text) = if flatten {
            let source =
                self.noteful_bytes_with(!options.include_pdfs, !options.include_native_audio)?;
            let order = self.page_order();
            let mut ink = std::collections::BTreeMap::new();
            let mut rec = std::collections::BTreeMap::new();
            for (display, &slot) in order.iter().enumerate() {
                if options.include_ink_text {
                    let words = self.ink_words(slot);
                    if !words.is_empty() {
                        ink.insert(display, words.to_vec());
                    }
                }
                if options.include_recognized_text {
                    let words = self.recognized_words(slot);
                    if !words.is_empty() {
                        rec.insert(display, words.to_vec());
                    }
                }
            }
            (source, Vec::new(), 0, 0, ink, rec)
        } else {
            let history = if options.include_ink_text {
                self.history.clone()
            } else {
                self.history
                    .iter()
                    .map(|e| {
                        if let Edit::InsertPages { at, pages, pdf } = e {
                            let pages = pages
                                .iter()
                                .map(|p| crate::NewPage {
                                    size: p.size,
                                    pdf: p.pdf.clone(),
                                    words: Vec::new(),
                                })
                                .collect();
                            Edit::InsertPages {
                                at: *at,
                                pages,
                                pdf: pdf.clone(),
                            }
                        } else {
                            e.clone()
                        }
                    })
                    .collect()
            };
            (
                self.source.clone(),
                history,
                self.cursor,
                self.floor,
                if options.include_ink_text {
                    self.base_words.clone()
                } else {
                    Default::default()
                },
                if options.include_recognized_text {
                    self.recognized.clone()
                } else {
                    Default::default()
                },
            )
        };
        let markdown = if options.include_markdown {
            self.markdown.clone()
        } else {
            String::new()
        };
        let study = if options.include_study {
            self.study.clone()
        } else {
            ProjectStudy::default()
        };
        let added_audio = if options.include_added_audio {
            Self::encode_added_audio(&self.added_audio)
        } else {
            Vec::new()
        };
        let exam = if options.include_exam {
            self.exam.clone()
        } else {
            ProjectExam::default()
        };
        Self::serialize_project(Project {
            format: String::new(),
            version: 0,
            source_base64: STANDARD.encode(&source_bytes),
            history,
            cursor,
            markdown,
            ink_text,
            canvas: self.canvas,
            recognized_text,
            floor,
            study,
            added_audio,
            exam,
        })
    }
    /// Size breakdown of each optional resource category inside a full `.nfedit` export.
    pub fn project_breakdown(&self) -> Result<ProjectBreakdown> {
        let b64_len = |raw: usize| raw.div_ceil(3) * 4;
        let full_bytes = self.save_project()?.len();
        let orig_pdf_raw: usize = self.scene.pdf_assets.iter().map(|a| a.bytes).sum();
        let mut added_pdf_ids: HashSet<String> = HashSet::new();
        let mut added_pdf_b64 = 0usize;
        let mut inserted_words_len = 0usize;
        for edit in &self.history {
            match edit {
                Edit::InsertPages { pdf, pages, .. } => {
                    if let Some(p) = pdf {
                        added_pdf_ids.insert(p.id.clone());
                        added_pdf_b64 += p.base64.len();
                    }
                    for page in pages {
                        if !page.words.is_empty() {
                            inserted_words_len +=
                                serde_json::to_string(&page.words).map_or(0, |s| s.len());
                        }
                    }
                }
                Edit::SetPageBackground { pdf: Some(p), .. } => {
                    added_pdf_ids.insert(p.id.clone());
                    added_pdf_b64 += p.base64.len();
                }
                _ => {}
            }
        }
        let pdf_count = self.scene.pdf_assets.len()
            + added_pdf_ids
                .iter()
                .filter(|id| !self.scene.pdf_assets.iter().any(|a| &a.id == *id))
                .count();
        let pdf_bytes = b64_len(orig_pdf_raw) + added_pdf_b64;
        let deleted_audio = self.deleted_audio();
        let stripped_audio = self.stripped_audio_media();
        let active_audio: Vec<_> = self
            .scene
            .audio
            .iter()
            .filter(|a| {
                !deleted_audio.contains(a.id.as_str()) && !stripped_audio.contains(a.id.as_str())
            })
            .collect();
        let native_audio_count = active_audio.len();
        let native_audio_bytes = b64_len(active_audio.iter().map(|a| a.bytes).sum());
        let added_audio_encoded = Self::encode_added_audio(&self.added_audio);
        let added_audio_count = added_audio_encoded.len();
        let added_audio_bytes = if added_audio_encoded.is_empty() {
            0
        } else {
            serde_json::to_string(&added_audio_encoded)
                .map_err(|e| Error::new(0, e.to_string()))?
                .len()
                + 14
        };
        let history_count = self.history.len();
        let history_bytes = if self.history.is_empty() {
            0
        } else {
            serde_json::to_string(&self.history)
                .map_err(|e| Error::new(0, e.to_string()))?
                .len()
                .saturating_sub(2 + added_pdf_b64 + inserted_words_len)
        };
        let markdown_bytes = if self.markdown.is_empty() {
            0
        } else {
            serde_json::to_string(&self.markdown)
                .map_err(|e| Error::new(0, e.to_string()))?
                .len()
                + 12
        };
        let mut text_bytes = inserted_words_len;
        if !self.base_words.is_empty() {
            text_bytes += serde_json::to_string(&self.base_words)
                .map_err(|e| Error::new(0, e.to_string()))?
                .len()
                + 12;
        }
        if !self.recognized.is_empty() {
            text_bytes += serde_json::to_string(&self.recognized)
                .map_err(|e| Error::new(0, e.to_string()))?
                .len()
                + 19;
        }
        let study_bytes = if self.study.is_empty() {
            0
        } else {
            serde_json::to_string(&self.study)
                .map_err(|e| Error::new(0, e.to_string()))?
                .len()
                + 9
        };
        let exam_bytes = if self.exam.is_empty() {
            0
        } else {
            serde_json::to_string(&self.exam)
                .map_err(|e| Error::new(0, e.to_string()))?
                .len()
                + 8
        };
        let optional = pdf_bytes
            + native_audio_bytes
            + added_audio_bytes
            + history_bytes
            + markdown_bytes
            + text_bytes
            + study_bytes
            + exam_bytes;
        let base_bytes = full_bytes.saturating_sub(optional);
        let total_bytes = base_bytes + optional;
        Ok(ProjectBreakdown {
            base_bytes,
            history_bytes,
            history_count,
            pdf_bytes,
            pdf_count,
            native_audio_bytes,
            native_audio_count,
            added_audio_bytes,
            added_audio_count,
            markdown_bytes,
            text_bytes,
            study_bytes,
            exam_bytes,
            total_bytes,
        })
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
    /// Recordings added in NoteComplete kept with the `.nfedit` project.
    pub fn added_audio(&self) -> &[(crate::AddedAudio, Vec<u8>)] {
        &self.added_audio
    }
    /// Replaces the added recordings bundled inside `.nfedit` projects.
    pub fn set_added_audio(&mut self, audio: Vec<(crate::AddedAudio, Vec<u8>)>) -> Result<()> {
        if audio.iter().any(|(meta, _)| meta.id.is_empty()) {
            return Err(Error::new(0, "Audio entry is missing an id"));
        }
        self.added_audio = audio;
        Ok(())
    }
    /// Study sets (flashcard decks, quizzes, and scratchpad) kept with the note.
    pub fn study(&self) -> &ProjectStudy {
        &self.study
    }
    /// Replaces the study sets kept with the note so `.nfedit` projects carry them.
    pub fn set_study(&mut self, study: ProjectStudy) -> Result<()> {
        if study
            .decks
            .iter()
            .chain(&study.quizzes)
            .chain(&study.scratch)
            .any(|item| !item.is_object())
        {
            return Err(Error::new(0, "Invalid study entry"));
        }
        let encoded_len = serde_json::to_string(&study)
            .map_err(|e| Error::new(0, e.to_string()))?
            .len();
        if encoded_len > STUDY_LIMIT {
            return Err(Error::new(0, "Study data is too large"));
        }
        self.study = study;
        Ok(())
    }
    /// Interactive exam HTML and optional structured exam data kept inside the project.
    pub fn exam(&self) -> &ProjectExam {
        &self.exam
    }
    /// Replaces the interactive exam HTML and structured metadata kept with the project.
    pub fn set_exam(&mut self, exam: ProjectExam) -> Result<()> {
        let encoded_len = serde_json::to_string(&exam)
            .map_err(|e| Error::new(0, e.to_string()))?
            .len();
        if encoded_len > EXAM_LIMIT {
            return Err(Error::new(0, "Exam HTML data is too large"));
        }
        self.exam = exam;
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
        if self.deleted_audio().contains(id) || self.stripped_audio_media().contains(id) {
            return Err(Error::new(0, "Audio resource not found"));
        }
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
            || !matches!(project.version, 1..=12)
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
                Edit::Layer { layer, order } => {
                    editor.set_layer(layer)?;
                    if let Some(order) = order {
                        let layers = editor.layers();
                        let unique: HashSet<u32> = order.iter().copied().collect();
                        if order.len() != layers.len()
                            || unique.len() != layers.len()
                            || !layers.iter().all(|l| unique.contains(&l.id))
                        {
                            return Err(Error::new(0, "Invalid layer order"));
                        }
                        if let Some(Edit::Layer { order: slot, .. }) = editor.history.last_mut() {
                            *slot = Some(order);
                        }
                    }
                }
                Edit::InsertPages { at, pages, pdf } => editor.insert_pages(at, pages, pdf)?,
                Edit::SetPageBackground { pages, pdf } => {
                    editor.set_page_backgrounds(pages, pdf)?
                }
                Edit::DeleteAudio { asset_id } => editor.delete_audio(&asset_id)?,
                Edit::StripAudioMedia { asset_id } => editor.strip_audio_media(&asset_id)?,
                Edit::MovePage { from, to } => editor.move_page(from, to)?,
                Edit::ResizePage {
                    page,
                    size,
                    pdf_rect,
                    joined,
                } => {
                    let before = editor.cursor;
                    editor.resize_page(page, size, pdf_rect)?;
                    if joined && editor.cursor > before {
                        if let Some(Edit::ResizePage { joined: j, .. }) = editor.history.last_mut()
                        {
                            *j = true;
                        }
                    }
                }
                Edit::Add { page, line } => editor.add_line(page, line)?,
                Edit::Erase { page, ids, joined } => {
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
                    editor.commit(Edit::Erase { page, ids, joined })?;
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
        editor.set_study(project.study)?;
        let mut decoded_audio = Vec::with_capacity(project.added_audio.len());
        for item in project.added_audio {
            let bytes = STANDARD
                .decode(&item.bytes_base64)
                .map_err(|e| Error::new(0, e.to_string()))?;
            decoded_audio.push((
                crate::AddedAudio {
                    id: item.id,
                    name: item.name,
                    mime: item.mime,
                    created: item.created,
                },
                bytes,
            ));
        }
        editor.set_added_audio(decoded_audio)?;
        editor.set_exam(project.exam)?;
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
