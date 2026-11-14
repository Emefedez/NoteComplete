//! Browser adapter; decoding remains in the platform-independent core.
use noteful_core::{ink, Field, Package, WireValue};
use serde_json::json;
use wasm_bindgen::prelude::*;

/// Each browser editor owns its source, scene and undo history in Rust.
#[wasm_bindgen]
pub struct EditorSession {
    inner: noteful_core::Editor,
}
/// Why a call failed. JavaScript receives the message as a string; `?` turns the core's
/// and the JSON parser's errors into it.
#[derive(Debug)]
pub struct Failure(String);
impl From<noteful_core::Error> for Failure {
    fn from(e: noteful_core::Error) -> Self {
        Self(e.to_string())
    }
}
impl From<serde_json::Error> for Failure {
    fn from(e: serde_json::Error) -> Self {
        Self(e.to_string())
    }
}
impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        Self(message.to_owned())
    }
}
impl From<Failure> for JsValue {
    fn from(e: Failure) -> Self {
        JsValue::from_str(&e.0)
    }
}
// JavaScript addresses pages by display position; the core edits stable slots.
// Item payloads name their page, so they are reported back as the display position.
fn on_page(mut v: serde_json::Value, display: usize) -> serde_json::Value {
    if v.get("page").is_some_and(|p| p.is_u64()) {
        v["page"] = json!(display);
    }
    v
}
fn compact_report(done: noteful_core::Compacted) -> String {
    json!({
        "edits_before": done.edits_before,
        "edits_after": done.edits_after,
        "bytes_before": done.bytes_before,
        "bytes_after": done.bytes_after,
    })
    .to_string()
}
impl EditorSession {
    /// The core's slot of the page at display position `page`.
    fn slot(&self, page: usize) -> Result<usize, Failure> {
        Ok(self.inner.slot(page)?)
    }
    /// The item under a point, as JSON (`null` for none); `lockable` includes locked ones.
    fn pick(
        &self,
        page: usize,
        point: [f64; 2],
        tolerance: f64,
        lockable: bool,
    ) -> Result<String, Failure> {
        let slot = self.slot(page)?;
        let picked = if lockable {
            self.inner.pick_lockable(slot, point, tolerance)?
        } else {
            self.inner.pick_item(slot, point, tolerance)?
        };
        Ok(serde_json::to_string(&picked.map(|v| on_page(v, page)))?)
    }
    /// What `adjust_item` and `crop_item` answer with: the changed item alone.
    fn item_patch(&self, page: usize, slot: usize, id: &str) -> Result<String, Failure> {
        Ok(on_page(self.inner.item_patch(slot, id)?, page).to_string())
    }
}
#[wasm_bindgen]
impl EditorSession {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<EditorSession, Failure> {
        Ok(Self {
            inner: noteful_core::Editor::open(data)?,
        })
    }
    pub fn load_project(data: &str) -> Result<EditorSession, Failure> {
        Ok(Self {
            inner: noteful_core::Editor::open_project(data)?,
        })
    }
    pub fn create_document(title: &str, sizes: &str, pdf: &[u8]) -> Result<EditorSession, Failure> {
        let sizes: Vec<[f64; 2]> = serde_json::from_str(sizes)?;
        Ok(Self {
            inner: noteful_core::Editor::create_document(title, &sizes, pdf)?,
        })
    }
    /// A new A4 notebook written in handwriting from Markdown (see the ink
    /// dialect); `options` is JSON (paper, theme, look, accent, font, hand,
    /// pen, size, seed).
    pub fn create_handwritten(
        title: &str,
        markdown: &str,
        options: &str,
    ) -> Result<EditorSession, Failure> {
        let (pages, _) = compose_with(title, markdown, options)?;
        Ok(Self {
            inner: ink::new_notebook(title, &pages)?,
        })
    }
    /// Handwritten pages inserted before display position `at`; returns
    /// JSON {pages: [display positions], warnings}.
    pub fn insert_handwritten(
        &mut self,
        at: usize,
        markdown: &str,
        options: &str,
    ) -> Result<String, Failure> {
        let (pages, warnings) = compose_with(&self.inner.scene.title, markdown, options)?;
        let shown = ink::insert_pages(&mut self.inner, at, &pages)?;
        Ok(json!({"pages":shown,"warnings":warnings}).to_string())
    }
    pub fn add_image(&mut self, page: usize, image: &str) -> Result<(), Failure> {
        let page = self.slot(page)?;
        let image: noteful_core::Image = serde_json::from_str(image)?;
        // An infinite canvas grows first, so the undo of the picture leaves the size.
        self.inner.grow_canvas_for(image.bounds)?;
        Ok(self.inner.add_image(page, image)?)
    }
    pub fn view(&self, page: usize) -> Result<String, Failure> {
        Ok(self.inner.view(self.slot(page)?)?.to_string())
    }
    /// Adds a line and answers, as JSON, with its `id` and, when the page changed by that
    /// line alone, what a reader holding the page's view needs to bring it up to date
    /// (`Editor::drawn`: `item` and the fields beside it). With only `id`, the reader asks
    /// for the view: an infinite canvas grew, which is a second edit and another page size.
    pub fn draw(&mut self, page: usize, line: &str) -> Result<String, Failure> {
        let slot = self.slot(page)?;
        let line: noteful_core::Line = serde_json::from_str(line)?;
        let mut grew = false;
        if self.inner.is_canvas() {
            let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
            for p in &line.points {
                for i in 0..2 {
                    lo[i] = lo[i].min(p[i]);
                    hi[i] = hi[i].max(p[i]);
                }
            }
            if lo[0] <= hi[0] {
                let pad = line.width / 2.;
                grew = self.inner.grow_canvas_for([
                    lo[0],
                    lo[1],
                    hi[0] - lo[0] + pad,
                    hi[1] - lo[1] + pad,
                ])?;
            }
        }
        self.inner.add_line(slot, line)?;
        let drawn = on_page(self.inner.drawn(slot)?, page);
        Ok(if grew {
            json!({"id": drawn["id"]}).to_string()
        } else {
            drawn.to_string()
        })
    }
    /// Make this one-page note an infinite canvas (it grows as you write).
    pub fn set_canvas(&mut self, on: bool) -> Result<(), Failure> {
        Ok(self.inner.set_canvas(on)?)
    }
    pub fn is_canvas(&self) -> bool {
        self.inner.is_canvas()
    }
    pub fn pick_item(
        &self,
        page: usize,
        x: f64,
        y: f64,
        tolerance: f64,
    ) -> Result<String, Failure> {
        self.pick(page, [x, y], tolerance, false)
    }
    /// The item under a point for the Lock tool, locked ones included.
    pub fn pick_lockable(
        &self,
        page: usize,
        x: f64,
        y: f64,
        tolerance: f64,
    ) -> Result<String, Failure> {
        self.pick(page, [x, y], tolerance, true)
    }
    /// Replace a text box's content; `text` is a TextBox, `size` its new [w, h].
    pub fn edit_text(
        &mut self,
        page: usize,
        id: &str,
        text: &str,
        width: f64,
        height: f64,
    ) -> Result<(), Failure> {
        let page = self.slot(page)?;
        let text = serde_json::from_str(text)?;
        Ok(self.inner.edit_text(page, id, text, [width, height])?)
    }
    /// Resize a page (display position); `pdf_rect` (JSON [x, y, w, h]) moves its PDF.
    pub fn resize_page(
        &mut self,
        page: usize,
        width: f64,
        height: f64,
        pdf_rect: Option<String>,
    ) -> Result<(), Failure> {
        let page = self.slot(page)?;
        let rect = pdf_rect.map(|r| serde_json::from_str(&r)).transpose()?;
        Ok(self.inner.resize_page(page, [width, height], rect)?)
    }
    /// Resize several pages (display positions) as one undoable edit: JSON
    /// [{"page", "size": [w, h], "pdf_rect": [x, y, w, h] | null}]. Returns how many changed.
    pub fn resize_pages(&mut self, pages: &str) -> Result<usize, Failure> {
        let wanted: Vec<serde_json::Value> = serde_json::from_str(pages)?;
        let mut list = Vec::with_capacity(wanted.len());
        let bad = || Failure::from("Invalid page size");
        for w in wanted {
            let page = w["page"].as_u64().ok_or_else(bad)? as usize;
            let size: [f64; 2] = serde_json::from_value(w["size"].clone()).map_err(|_| bad())?;
            let rect: Option<[f64; 4]> =
                serde_json::from_value(w["pdf_rect"].clone()).map_err(|_| bad())?;
            list.push((self.slot(page)?, size, rect));
        }
        Ok(self.inner.resize_pages(&list)?)
    }
    /// Open a `.notecomplete` archive: the note and its Markdown notes.
    pub fn open_notecomplete(data: &[u8]) -> Result<EditorSession, Failure> {
        Ok(Self {
            inner: noteful_core::Editor::open_notecomplete(data)?,
        })
    }
    pub fn markdown(&self) -> String {
        self.inner.markdown().to_owned()
    }
    pub fn set_markdown(&mut self, markdown: &str) -> Result<(), Failure> {
        Ok(self.inner.set_markdown(markdown)?)
    }
    /// `audio_data` holds the recordings added in NoteComplete one after another; `audio_layout`
    /// lists them in order (`id`, `name`, `mime`, `created`, `length`).
    pub fn export_notecomplete(
        &self,
        audio_data: &[u8],
        audio_layout: &str,
    ) -> Result<Vec<u8>, Failure> {
        let layout: Vec<serde_json::Value> = if audio_layout.is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(audio_layout)?
        };
        let mut audio = Vec::with_capacity(layout.len());
        let mut at = 0usize;
        for item in layout {
            let length = item["length"].as_u64().unwrap_or(0) as usize;
            let end = at
                .checked_add(length)
                .filter(|end| *end <= audio_data.len())
                .ok_or("Recording data is shorter than its layout")?;
            let text = |key: &str| item[key].as_str().unwrap_or("").to_owned();
            let meta = noteful_core::AddedAudio {
                id: text("id"),
                name: text("name"),
                mime: text("mime"),
                created: item["created"].as_f64().unwrap_or(0.0),
            };
            audio.push((meta, &audio_data[at..end]));
            at = end;
        }
        Ok(self.inner.export_notecomplete_with(&audio)?)
    }
    pub fn set_locked(&mut self, page: usize, id: &str, locked: bool) -> Result<(), Failure> {
        let page = self.slot(page)?;
        Ok(self.inner.set_locked(page, id, locked)?)
    }
    pub fn selection(&self, page: usize, id: &str) -> Result<String, Failure> {
        let slot = self.slot(page)?;
        Ok(on_page(self.inner.selection(slot, id)?, page).to_string())
    }
    pub fn adjust_item(
        &mut self,
        page: usize,
        id: &str,
        adjustment: &str,
    ) -> Result<String, Failure> {
        let slot = self.slot(page)?;
        self.inner
            .adjust_item(slot, id, serde_json::from_str(adjustment)?)?;
        self.item_patch(page, slot, id)
    }
    /// Show only `[x0, y0, x1, y1]` (JSON, in the image's native size) of an image.
    pub fn crop_item(&mut self, page: usize, id: &str, rect: &str) -> Result<String, Failure> {
        let slot = self.slot(page)?;
        let rect: [f64; 4] = serde_json::from_str(rect)?;
        self.inner.crop_item(slot, id, rect)?;
        self.item_patch(page, slot, id)
    }
    /// Several items in one edit (JSON list of ids); `joined` undoes it with the edit before.
    pub fn remove_items(&mut self, page: usize, ids: &str, joined: bool) -> Result<(), Failure> {
        let page = self.slot(page)?;
        let ids: Vec<String> = serde_json::from_str(ids)?;
        Ok(self.inner.remove_items(page, &ids, joined)?)
    }
    pub fn remove_item(&mut self, page: usize, id: &str) -> Result<(), Failure> {
        let page = self.slot(page)?;
        Ok(self.inner.remove_item(page, id)?)
    }
    pub fn erase(&mut self, page: usize, path: &str, radius: f64) -> Result<usize, Failure> {
        let page = self.slot(page)?;
        let path: Vec<[f64; 2]> = serde_json::from_str(path)?;
        Ok(self.inner.erase_path(page, &path, radius)?)
    }
    /// Insert pages before display position `at`; `pdf` adds its resource in the same step.
    pub fn insert_pages(
        &mut self,
        at: usize,
        pages: &str,
        pdf: Option<String>,
    ) -> Result<(), Failure> {
        let pages = serde_json::from_str(pages)?;
        let pdf = pdf.map(|p| serde_json::from_str(&p)).transpose()?;
        Ok(self.inner.insert_pages(at, pages, pdf)?)
    }
    pub fn undo(&mut self) {
        self.inner.undo();
    }
    pub fn redo(&mut self) {
        self.inner.redo();
    }
    pub fn resize_shape(&mut self, page: usize, id: &str, shape: &str) -> Result<(), Failure> {
        let page = self.slot(page)?;
        Ok(self
            .inner
            .resize_shape(page, id, serde_json::from_str(shape)?)?)
    }
    pub fn set_layer(&mut self, layer: &str) -> Result<(), Failure> {
        Ok(self.inner.set_layer(serde_json::from_str(layer)?)?)
    }
    pub fn export_noteful(&self) -> Result<Vec<u8>, Failure> {
        Ok(self.inner.export_noteful()?)
    }
    pub fn save_project(&self) -> Result<String, Failure> {
        Ok(self.inner.save_project()?)
    }
    /// Keeps text recognized in the handwriting (OCR) of page slots, so it is saved with
    /// the note: `pages` is JSON {slot: [{text, bounds}]}. A page the note refuses (a slot
    /// it does not have, or words that are not valid) is skipped and the others are kept;
    /// returns how many pages were kept.
    pub fn set_recognized_text(&mut self, pages: &str) -> Result<usize, Failure> {
        Ok(keep_recognized_text(&mut self.inner, pages)?)
    }
    pub fn history_digest(&self) -> Result<String, Failure> {
        Ok(self.inner.history_digest()?)
    }
    /// Where the history is now, as JSON {edits, digest} (an automatic save keeps it).
    pub fn history_mark(&self) -> Result<String, Failure> {
        let (edits, digest) = self.inner.history_mark()?;
        Ok(json!({ "edits": edits, "digest": digest }).to_string())
    }
    /// A digest of the first `edits` edits ("" when the history is shorter).
    pub fn prefix_digest(&self, edits: usize) -> String {
        self.inner.prefix_digest(edits).unwrap_or_default()
    }
    /// Compacts the history up to `upto` edits (compact.rs), as JSON
    /// {edits_before, edits_after, bytes_before, bytes_after}.
    pub fn compact_history(&mut self, upto: usize) -> Result<String, Failure> {
        Ok(compact_report(self.inner.compact_history(upto)?))
    }
    /// The same report without compacting: the sizes a cut up to `upto` edits would give.
    pub fn compact_preview(&self, upto: usize) -> Result<String, Failure> {
        Ok(compact_report(self.inner.compact_preview(upto)?))
    }
    pub fn pdf_bytes(&self, id: &str) -> Result<Vec<u8>, Failure> {
        Ok(self.inner.pdf_bytes(id)?.to_vec())
    }
    pub fn audio_bytes(&self, id: &str) -> Result<Vec<u8>, Failure> {
        Ok(self.inner.audio_bytes(id)?.to_vec())
    }
}

/// Sets the recognized text of every page in `pages` (JSON {slot: [word…]}) that the
/// note accepts, and returns how many it accepted. Only JSON that is not such a map fails.
fn keep_recognized_text(
    editor: &mut noteful_core::Editor,
    pages: &str,
) -> serde_json::Result<usize> {
    let pages: std::collections::BTreeMap<String, serde_json::Value> = serde_json::from_str(pages)?;
    let mut kept = 0;
    for (slot, words) in pages {
        let (Ok(slot), Ok(words)) = (slot.parse::<usize>(), serde_json::from_value(words)) else {
            continue;
        };
        if editor.set_recognized_words(slot, words).is_ok() {
            kept += 1;
        }
    }
    Ok(kept)
}

fn get(fields: &[Field], tag: u16) -> Option<&WireValue> {
    fields.iter().find(|f| f.tag == tag).map(|f| &f.value)
}
fn summary(data: &[u8]) -> noteful_core::Result<String> {
    let package = Package::parse(data)?;
    let mut title = String::new();
    let mut pages = 0;
    let mut objects = 0;
    let mut strokes = 0;
    let mut warnings = Vec::new();
    let mut resources = Vec::new();
    for block in &package.blocks {
        if let Some(fields) = &block.fields {
            if block.kind == "note_metadata" {
                title = get(fields, 3)
                    .and_then(WireValue::as_text)
                    .unwrap_or("")
                    .to_owned();
            }
            if block.kind == "drawing_metadata" {
                pages += get(fields, 2)
                    .and_then(WireValue::as_fields)
                    .and_then(|fs| get(fs, 0))
                    .and_then(WireValue::as_array)
                    .map_or(0, |v| v.len());
            }
            if block.kind == "stroke_object_set" {
                objects += get(fields, 5)
                    .and_then(WireValue::as_fields)
                    .and_then(|fs| get(fs, 0))
                    .and_then(WireValue::as_array)
                    .map_or(0, |v| v.len());
            }
        }
        strokes += block.strokes.as_ref().map_or(0, |v| v.len());
        if let Some(e) = &block.stroke_error {
            warnings.push(format!("{}: {e}", block.id));
        }
        if matches!(block.kind, "pdf" | "png" | "jpeg") {
            resources.push(json!({"id":block.id,"kind":block.kind,"bytes":block.size}));
        }
    }
    // Only bounded counts and byte lengths cross as numbers. IDs remain strings.
    Ok(
        json!({"schema_version":1,"title":title,"bytes":data.len(),"pages":pages,
        "strokes":strokes,"objects":objects,"resources":resources,"warnings":warnings})
        .to_string(),
    )
}

/// Markdown composed into handwritten pages with their warnings; `options` is the JSON
/// of `create_handwritten` (empty for the defaults).
fn compose_with(
    title: &str,
    markdown: &str,
    options: &str,
) -> Result<(Vec<ink::InkPage>, Vec<String>), Failure> {
    let v: serde_json::Value = if options.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(options)?
    };
    let o = ink::ComposeOptions::from_json(&v, ink::seed_of(&format!("{title}\n{markdown}")))?;
    Ok(ink::compose(markdown, &o)?)
}
/// How Markdown will look in handwriting: JSON {pages: [svg…] (at most
/// `max_pages`), total, warnings}, each page an SVG with its paper.
#[wasm_bindgen]
pub fn compose_preview(markdown: &str, options: &str, max_pages: usize) -> Result<String, Failure> {
    let (pages, warnings) = compose_with("Preview", markdown, options)?;
    let shown: Vec<ink::InkPage> = pages.iter().take(max_pages.max(1)).cloned().collect();
    let editor = ink::new_notebook("Preview", &shown)?;
    let svgs = (0..shown.len())
        .map(|i| ink::page_svg(&editor, i).map(|(svg, _)| svg))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"pages":svgs,"total":pages.len(),"warnings":warnings}).to_string())
}
/// Preview HTML for Markdown notes (raw HTML shown as text; see markdown.rs).
#[wasm_bindgen]
pub fn markdown_html(src: &str) -> String {
    noteful_core::markdown_html(src)
}
/// Notes as a plain .md file, page markers turned into visible breaks.
#[wasm_bindgen]
pub fn markdown_export(src: &str, title: &str) -> String {
    noteful_core::markdown_export(src, title)
}
/// Pages drawn as JPEGs, packed one after another, bound into one PDF (see page_pdf.rs).
#[wasm_bindgen]
pub fn jpeg_pages_pdf(data: &[u8], layout: &str, title: &str) -> Result<Vec<u8>, Failure> {
    noteful_core::jpeg_pages_pdf(data, layout, title).map_err(Failure)
}
/// The Markdown dialect the handwriting engine writes (what an AI tool is asked to write).
#[wasm_bindgen]
pub fn handwriting_dialect() -> String {
    noteful_core::ink::DIALECT.to_owned()
}
/// MD5 hex of a file, to match it with Google Drive's md5Checksum.
#[wasm_bindgen]
pub fn md5_hex(data: &[u8]) -> String {
    noteful_core::md5_hex(data)
}
/// Recordings added in NoteComplete inside a `.notecomp` file: JSON list with byte ranges of `data`.
#[wasm_bindgen]
pub fn notecomplete_audio(data: &[u8]) -> Result<String, Failure> {
    Ok(serde_json::to_string(&noteful_core::notecomplete_audio(
        data,
    )?)?)
}
#[wasm_bindgen]
pub fn is_notecomplete(data: &[u8]) -> bool {
    noteful_core::is_notecomplete(data)
}
/// Versioned, JavaScript-safe summary. Input is a Uint8Array; result is JSON text.
#[wasm_bindgen]
pub fn inspect_document(data: &[u8]) -> Result<String, Failure> {
    Ok(summary(data)?)
}

/// Full wire re-encoding in WebAssembly, without exporting 64-bit numbers to JS.
#[wasm_bindgen]
pub fn verify_document(data: &[u8]) -> Result<bool, Failure> {
    Ok(Package::parse(data)?.rebuild()? == data)
}

#[cfg(test)]
mod tests {
    #[test]
    fn summary_contains_only_browser_safe_values() {
        let data = include_bytes!("../../../samples/Examen wuolah.noteful");
        let value: serde_json::Value =
            serde_json::from_str(&super::summary(data).unwrap()).unwrap();
        assert_eq!(value["schema_version"], 1);
        assert_eq!(value["pages"], 3);
        assert_eq!(value["strokes"], 2008);
        assert_eq!(value["objects"], 74);
        assert_eq!(value["title"], "Examen wuolah");
    }
    #[test]
    fn errors_keep_the_cores_message_and_items_name_their_display_page() {
        let data = include_bytes!("../../../samples/Examen wuolah.noteful");
        let mut session = super::EditorSession::new(data).unwrap();
        let core = noteful_core::Editor::open(data).unwrap();
        assert_eq!(
            session.view(99).unwrap_err().0,
            core.view(99).unwrap_err().to_string()
        );
        assert!(session.draw(0, "{").is_err());
        // A page inserted first moves the exam's first page to display position 1, slot 0.
        session
            .insert_pages(0, r#"[{"size":[600,800]}]"#, None)
            .unwrap();
        let picked: serde_json::Value =
            serde_json::from_str(&session.selection(1, "stroke:0").unwrap()).unwrap();
        assert_eq!(picked["page"], 1);
        let b = &picked["bounds"];
        let at = |i: usize| b[i].as_f64().unwrap();
        let (x, y) = (at(0) + at(2) / 2., at(1) + at(3) / 2.);
        let reach = at(2).max(at(3));
        for found in [
            session.pick_item(1, x, y, reach).unwrap(),
            session.pick_lockable(1, x, y, reach).unwrap(),
        ] {
            let found: serde_json::Value = serde_json::from_str(&found).unwrap();
            assert_eq!(found["page"], 1, "{found}");
        }
        assert_eq!(session.pick_item(0, 5., 5., 1.).unwrap(), "null");
        let report: serde_json::Value =
            serde_json::from_str(&session.compact_preview(1).unwrap()).unwrap();
        assert_eq!(report["edits_before"], 1);
    }
    #[test]
    fn a_refused_page_does_not_drop_the_recognized_text_of_the_others() {
        let mut e = noteful_core::Editor::create_document(
            "Text",
            &[[600., 800.], [600., 800.], [600., 800.]],
            &[],
        )
        .unwrap();
        let word = |x: f64| serde_json::json!({"text": "mitosis", "bounds": [x, 10., 60., 20.]});
        // Slot 9 is not a page, slot 1 has a word with no text, "x" is not a slot and
        // slot 0's words are not a list: the good page among them is still kept.
        let pages = serde_json::json!({
            "0": "words",
            "1": [{"text": "", "bounds": [0., 0., 60., 20.]}],
            "2": [word(10.), word(80.)],
            "9": [word(10.)],
            "x": [word(10.)],
        });
        e.set_recognized_words(1, vec![serde_json::from_value(word(5.)).unwrap()])
            .unwrap();
        assert_eq!(
            super::keep_recognized_text(&mut e, &pages.to_string()).unwrap(),
            1
        );
        assert_eq!(e.recognized_words(2).len(), 2);
        assert_eq!(
            e.recognized_words(1).len(),
            1,
            "a refused page keeps what it had"
        );
        let all = serde_json::json!({"0": [word(1.)], "1": [], "2": [word(2.)]});
        assert_eq!(
            super::keep_recognized_text(&mut e, &all.to_string()).unwrap(),
            3
        );
        assert!(
            e.recognized_words(1).is_empty(),
            "an empty list clears a page"
        );
        assert_eq!(e.recognized_words(0).len(), 1);
        // JSON that is not a map of pages is still an error, and changes nothing.
        assert!(super::keep_recognized_text(&mut e, "[1, 2").is_err());
        assert!(super::keep_recognized_text(&mut e, "[]").is_err());
        assert_eq!(e.recognized_words(2).len(), 1);
    }
}
