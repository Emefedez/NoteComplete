//! Goodnotes and Notability notebooks made into Noteful notes, for the reader. A module of its
//! own (pkg/import), so the engine stays small for everyone who never opens a notebook.
use wasm_bindgen::prelude::*;

thread_local! {
    static WARNINGS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
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
    Ok(converted.noteful)
}

/// What the last `convert_notebook` could not bring over, as a JSON list of strings.
#[wasm_bindgen]
pub fn notebook_warnings() -> String {
    WARNINGS.with(|w| serde_json::to_string(&*w.borrow()).unwrap_or_default())
}
