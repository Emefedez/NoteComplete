//! Browser adapter; decoding remains in the platform-independent core.
use noteful_core::{Field, Package, WireValue};
use serde_json::json;
use wasm_bindgen::prelude::*;

/// Each browser editor owns its source, scene and undo history in Rust.
#[wasm_bindgen]
pub struct EditorSession {
    inner: noteful_core::Editor,
}
fn js_error(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}
// JavaScript addresses pages by display position; the core edits stable slots.
// Item payloads name their page, so they are reported back as the display position.
fn on_page(mut v: serde_json::Value, display: usize) -> serde_json::Value {
    if v.get("page").is_some_and(|p| p.is_u64()) {
        v["page"] = json!(display);
    }
    v
}
#[wasm_bindgen]
impl EditorSession {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &[u8]) -> Result<EditorSession, JsValue> {
        Ok(Self {
            inner: noteful_core::Editor::open(data).map_err(js_error)?,
        })
    }
    pub fn load_project(data: &str) -> Result<EditorSession, JsValue> {
        Ok(Self {
            inner: noteful_core::Editor::open_project(data).map_err(js_error)?,
        })
    }
    pub fn create_document(title: &str, sizes: &str, pdf: &[u8]) -> Result<EditorSession, JsValue> {
        let sizes: Vec<[f64; 2]> = serde_json::from_str(sizes).map_err(js_error)?;
        Ok(Self {
            inner: noteful_core::Editor::create_document(title, &sizes, pdf).map_err(js_error)?,
        })
    }
    pub fn add_image(&mut self, page: usize, image: &str) -> Result<(), JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        self.inner
            .add_image(page, serde_json::from_str(image).map_err(js_error)?)
            .map_err(js_error)
    }
    pub fn view(&self, page: usize) -> Result<String, JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        Ok(self.inner.view(page).map_err(js_error)?.to_string())
    }
    pub fn draw(&mut self, page: usize, line: &str) -> Result<(), JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        let line = serde_json::from_str(line).map_err(js_error)?;
        self.inner.add_line(page, line).map_err(js_error)
    }
    pub fn pick_item(
        &self,
        page: usize,
        x: f64,
        y: f64,
        tolerance: f64,
    ) -> Result<String, JsValue> {
        let display = page;
        let page = self.inner.slot(page).map_err(js_error)?;
        let picked = self
            .inner
            .pick_item(page, [x, y], tolerance)
            .map_err(js_error)?
            .map(|v| on_page(v, display));
        serde_json::to_string(&picked).map_err(js_error)
    }
    /// The item under a point for the Lock tool, locked ones included.
    pub fn pick_lockable(
        &self,
        page: usize,
        x: f64,
        y: f64,
        tolerance: f64,
    ) -> Result<String, JsValue> {
        let display = page;
        let page = self.inner.slot(page).map_err(js_error)?;
        let picked = self
            .inner
            .pick_lockable(page, [x, y], tolerance)
            .map_err(js_error)?
            .map(|v| on_page(v, display));
        serde_json::to_string(&picked).map_err(js_error)
    }
    /// Replace a text box's content; `text` is a TextBox, `size` its new [w, h].
    pub fn edit_text(
        &mut self,
        page: usize,
        id: &str,
        text: &str,
        width: f64,
        height: f64,
    ) -> Result<(), JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        let text = serde_json::from_str(text).map_err(js_error)?;
        self.inner
            .edit_text(page, id, text, [width, height])
            .map_err(js_error)
    }
    /// Resize a page (display position); `pdf_rect` (JSON [x, y, w, h]) moves its PDF.
    pub fn resize_page(
        &mut self,
        page: usize,
        width: f64,
        height: f64,
        pdf_rect: Option<String>,
    ) -> Result<(), JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        let rect = pdf_rect
            .map(|r| serde_json::from_str(&r))
            .transpose()
            .map_err(js_error)?;
        self.inner
            .resize_page(page, [width, height], rect)
            .map_err(js_error)
    }
    pub fn set_locked(&mut self, page: usize, id: &str, locked: bool) -> Result<(), JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        self.inner.set_locked(page, id, locked).map_err(js_error)
    }
    pub fn selection(&self, page: usize, id: &str) -> Result<String, JsValue> {
        let display = page;
        let page = self.inner.slot(page).map_err(js_error)?;
        Ok(on_page(self.inner.selection(page, id).map_err(js_error)?, display).to_string())
    }
    pub fn adjust_item(
        &mut self,
        page: usize,
        id: &str,
        adjustment: &str,
    ) -> Result<String, JsValue> {
        let display = page;
        let page = self.inner.slot(page).map_err(js_error)?;
        self.inner
            .adjust_item(
                page,
                id,
                serde_json::from_str(adjustment).map_err(js_error)?,
            )
            .map_err(js_error)?;
        Ok(on_page(self.inner.item_patch(page, id).map_err(js_error)?, display).to_string())
    }
    pub fn remove_item(&mut self, page: usize, id: &str) -> Result<(), JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        self.inner.remove_item(page, id).map_err(js_error)
    }
    pub fn erase(&mut self, page: usize, path: &str, radius: f64) -> Result<usize, JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        let path: Vec<[f64; 2]> = serde_json::from_str(path).map_err(js_error)?;
        self.inner.erase_path(page, &path, radius).map_err(js_error)
    }
    /// Insert pages before display position `at`; `pdf` adds its resource in the same step.
    pub fn insert_pages(
        &mut self,
        at: usize,
        pages: &str,
        pdf: Option<String>,
    ) -> Result<(), JsValue> {
        let pages = serde_json::from_str(pages).map_err(js_error)?;
        let pdf = pdf
            .map(|p| serde_json::from_str(&p))
            .transpose()
            .map_err(js_error)?;
        self.inner.insert_pages(at, pages, pdf).map_err(js_error)
    }
    pub fn undo(&mut self) {
        self.inner.undo();
    }
    pub fn redo(&mut self) {
        self.inner.redo();
    }
    pub fn resize_shape(&mut self, page: usize, id: &str, shape: &str) -> Result<(), JsValue> {
        let page = self.inner.slot(page).map_err(js_error)?;
        self.inner
            .resize_shape(page, id, serde_json::from_str(shape).map_err(js_error)?)
            .map_err(js_error)
    }
    pub fn set_layer(&mut self, layer: &str) -> Result<(), JsValue> {
        self.inner
            .set_layer(serde_json::from_str(layer).map_err(js_error)?)
            .map_err(js_error)
    }
    pub fn export_noteful(&self) -> Result<Vec<u8>, JsValue> {
        self.inner.export_noteful().map_err(js_error)
    }
    pub fn save_project(&self) -> Result<String, JsValue> {
        self.inner.save_project().map_err(js_error)
    }
    pub fn pdf_bytes(&self, id: &str) -> Result<Vec<u8>, JsValue> {
        Ok(self.inner.pdf_bytes(id).map_err(js_error)?.to_vec())
    }
    pub fn audio_bytes(&self, id: &str) -> Result<Vec<u8>, JsValue> {
        Ok(self.inner.audio_bytes(id).map_err(js_error)?.to_vec())
    }
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

/// Versioned, JavaScript-safe summary. Input is a Uint8Array; result is JSON text.
#[wasm_bindgen]
pub fn inspect_document(data: &[u8]) -> Result<String, JsValue> {
    summary(data).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Full wire re-encoding in WebAssembly, without exporting 64-bit numbers to JS.
#[wasm_bindgen]
pub fn verify_document(data: &[u8]) -> Result<bool, JsValue> {
    let package = Package::parse(data).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(package
        .rebuild()
        .map_err(|e| JsValue::from_str(&e.to_string()))?
        == data)
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
}
