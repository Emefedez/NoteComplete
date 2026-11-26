//! Goodnotes and Notability notebooks made into Noteful notes, for the reader. A module of its
//! own (pkg/import), so the engine stays small for everyone who never opens a notebook.
use wasm_bindgen::prelude::*;

thread_local! {
    static WARNINGS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
    static CANVAS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// `"goodnotes"` or `"notability"` when bytes are a notebook `convert_notebook` reads.
#[wasm_bindgen]
pub fn notebook_format(data: &[u8]) -> Option<String> {
    noteful_import::format_of(data).map(str::to_owned)
}

/// The Noteful note a notebook becomes; the engine opens it with `EditorSession.open_imported`.
#[wasm_bindgen]
pub fn convert_notebook(name: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    let converted = noteful_import::convert(name, data)?;
    WARNINGS.with(|w| *w.borrow_mut() = converted.warnings);
    CANVAS.with(|c| c.set(converted.canvas));
    Ok(converted.noteful)
}

/// Whether the last `convert_notebook` made infinite canvases (an Rnote infinite canvas).
#[wasm_bindgen]
pub fn notebook_is_canvas() -> bool {
    CANVAS.with(|c| c.get())
}

/// What the last `convert_notebook` could not bring over, as a JSON list of strings.
#[wasm_bindgen]
pub fn notebook_warnings() -> String {
    WARNINGS.with(|w| serde_json::to_string(&*w.borrow()).unwrap_or_default())
}

// Edit PDF mode (docs/PDF-EDITOR.md). The last PDF read is kept, keyed by the reader (its
// resource id and size), so moving between its pages does not read it again.
thread_local! {
    static PDF: std::cell::RefCell<Option<(String, noteful_import::pdf_edit::PdfEdit)>> = const { std::cell::RefCell::new(None) };
}
fn with_pdf<T>(
    key: &str,
    f: impl FnOnce(&mut noteful_import::pdf_edit::PdfEdit) -> Result<T, String>,
) -> Result<T, String> {
    PDF.with(|p| match &mut *p.borrow_mut() {
        Some((k, pdf)) if k == key => f(pdf),
        _ => Err("PDF not open".into()),
    })
}

/// Whether the PDF `key` is the one kept (then `pdf_edit_open` is not needed).
#[wasm_bindgen]
pub fn pdf_edit_has(key: &str) -> bool {
    PDF.with(|p| p.borrow().as_ref().is_some_and(|(k, _)| k == key))
}

/// Reads a PDF for Edit PDF mode and keeps it as `key`, dropping the one kept before.
#[wasm_bindgen]
pub fn pdf_edit_open(key: &str, data: &[u8]) -> Result<(), String> {
    PDF.with(|p| *p.borrow_mut() = None);
    let pdf = noteful_import::pdf_edit::PdfEdit::load(data)?;
    PDF.with(|p| *p.borrow_mut() = Some((key.to_owned(), pdf)));
    Ok(())
}

/// The printed text of a page (0-based) as blocks, in JSON (`PdfEdit::blocks`).
#[wasm_bindgen]
pub fn pdf_edit_blocks(key: &str, page: u32) -> Result<String, String> {
    with_pdf(key, |pdf| pdf.blocks(page).map(|v| v.to_string()))
}

/// The page alone as a new PDF, without the marks of the operators listed and the
/// annotations listed (JSON arrays of indices; `annots` may be empty).
#[wasm_bindgen]
pub fn pdf_edit_without(key: &str, page: u32, ops: &str, annots: &str) -> Result<Vec<u8>, String> {
    let ops: Vec<usize> = serde_json::from_str(ops).map_err(|e| e.to_string())?;
    let annots: Vec<usize> = if annots.is_empty() {
        vec![]
    } else {
        serde_json::from_str(annots).map_err(|e| e.to_string())?
    };
    with_pdf(key, |pdf| pdf.without(page, &ops, &annots))
}

/// The page alone with only the marks of the operators and the annotations listed: one object,
/// for the reader to draw as a picture.
#[wasm_bindgen]
pub fn pdf_edit_isolate(key: &str, page: u32, ops: &str, annots: &str) -> Result<Vec<u8>, String> {
    let ops: Vec<usize> = serde_json::from_str(ops).map_err(|e| e.to_string())?;
    let annots: Vec<usize> = if annots.is_empty() {
        vec![]
    } else {
        serde_json::from_str(annots).map_err(|e| e.to_string())?
    };
    with_pdf(key, |pdf| pdf.isolate(page, &ops, &annots))
}

/// An embedded font program (TrueType or OpenType) of page `page` (0-based), by hash.
#[wasm_bindgen]
pub fn pdf_edit_font(key: &str, page: u32, hash: &str) -> Result<Vec<u8>, String> {
    with_pdf(key, |pdf| {
        pdf.font_on_page(page, hash)
            .ok_or_else(|| "No such font".to_owned())
    })
}

/// The characters of `text` the font program has no glyph for.
#[wasm_bindgen]
pub fn pdf_edit_font_missing(key: &str, hash: &str, text: &str) -> Result<String, String> {
    with_pdf(key, |pdf| Ok(pdf.font_missing(hash, text)))
}

/// Drops the kept PDF (Edit PDF mode left, or the note closed).
#[wasm_bindgen]
pub fn pdf_edit_close() {
    PDF.with(|p| *p.borrow_mut() = None);
}
