# NoteComplete Feature Requests & Implementation Status

`[!]` Verification pending on real app/device · `[ ]` Planned / In progress · `[D]` Completed

---

## 1. Active Implementation Priorities

### 1.1 Text Box Parity with Full GUI Implementation (`[ ]` In Progress)
- **Detailed Specification:** See [`docs/INK-WRITING.md` Section 8](file:///home/m1-max/Documents/noteful-re/docs/INK-WRITING.md).
- **Core Engine & Wire Format:**
  - Full reverse-engineered support for Noteful native Kind-2 objects in `set/5/0[]`.
  - Attributed rich text (`payload tag 4`) encoding/decoding: run strings, attribute counts, delta keys, and pools 5–10 (family, bold/italic, color RGBA, underline/strikethrough/alignment, font size/line spacing).
  - Rich text data model in `crates/noteful-core`: `TextBox` with `runs: Vec<TextRun>`, `alignment: u64`, `underline: bool`, `strikethrough: bool`, `wrap_width: Option<f64>`.
  - In-place kind-2 object modification via `Edit::RetextObject` in `crates/noteful-core/src/export.rs`.
- **Reader GUI & Canvas Overlay (`apps/reader/app.js` & `index.html`):**
  - **Unblock Imported Text:** Remove the restriction blocking edits on imported `object:N` text boxes. Double-click or single-click with Text tool (`W`) enters inline editing.
  - **Floating Format Bar (`#textFormatBar`):**
    - Font Family picker (`Helvetica`, `Times New Roman`, `Courier New`, `Noteworthy`).
    - Font Size stepper / dropdown (8 to 72 pt).
    - Style buttons: Bold (`Ctrl+B`), Italic (`Ctrl+I`), Underline (`Ctrl+U`), Strikethrough.
    - Alignment group: Left, Center, Right (`align: 0, 1, 2`).
    - Swatches + custom hex color picker for text color and optional box background fill.
  - **Interactive Transform & Reflow Handles:**
    - Corner handles (`nw`, `ne`, `se`, `sw`): Proportional geometric scaling.
    - Top rotation handle (`rot`): Rotates text box.
    - Horizontal side handles (`e`, `w`): Adjusts `wrap_width` with automatic soft line wrapping without changing font size.
- **MCP Integration & Markdown Converter:**
  - `write_on_page` supports item `"type": "textbox"` with full styling attributes.
  - `page_layout` returns existing typed text boxes with bounds and text content.
  - `compose_markdown` / `noteful convert` adds `--mode typed` to generate native typed text boxes instead of handwriting.

### 1.2 Shapes Auto-Fill Toggle (`[ ]` In Progress)
- **Detailed Specification:** See [`docs/INK-WRITING.md` Section 8.7](file:///home/m1-max/Documents/noteful-re/docs/INK-WRITING.md).
- **Reader GUI (`apps/reader/`):**
  - Add `#shapeAutoFill` toggle button to `#shapeOptions` with pale accent highlight when active.
  - Keyboard shortcut **F** toggles auto-fill when Shape tool (`R`) is active.
  - Fill options dropdown: Tint (25% opacity matching stroke), Solid (100%), or custom swatch.
  - Real-time 60fps canvas preview rendering both stroke and fill during interactive dragging.
- **Core Data Model & Export Parity (`crates/noteful-core`):**
  - `Shape` and `Line` structs extended with `fill: Option<[f64; 4]>`.
  - Stored in `.nfedit` edit history and project state.
  - Export parity with native Noteful Kind-3 (rounded rectangle) and Kind-6 (ellipse) objects where `payload["5"]["1"]["0"] = [r, g, b, a]`.
  - Reopened in iPad Noteful as native filled shapes editable via Noteful's shape tool.

### 1.3 MCP Vector Ink Writing & Page Generation (`[ ]` In Progress)
- **Detailed Specification:** See [`docs/INK-WRITING.md`](file:///home/m1-max/Documents/noteful-re/docs/INK-WRITING.md) and [`docs/MCP.md`](file:///home/m1-max/Documents/noteful-re/docs/MCP.md).
- **Core Engine:**
  - Vector ink synthesis engine in Rust core modeled on `openninoor/noteful-mcp` (pinned commit `175e8d7`).
  - True 3-value per-point pressure encoding (`new_stroke` flags = 1).
  - Under-ink highlight placement (`add_line_under`) that preserves existing handwriting.
  - Greek letters, super/subscripts, mathematical symbols, and calligraphic hands.
  - Study-note layout generator (titles, cards, multi-columns, sticky notes, SVG diagrams).
- **MCP Tools:**
  - `create_notebook`, `add_pages`, `clean_copy`, `write_on_page`, `page_layout`, `example_pages`.
  - Safe export workflows (writes to copies by default; `.bak` for in-place edits).
  - Multi-format export chaining (Markdown → `.noteful` → PDF / PNG / SVG).

---

## 2. Pending Verification on Real App / Device (`[!]`)

- [!] **Google Drive Writes:** Upload unsaved changes before removing a note; move note to Drive trash (tested against fake Drive server; needs physical sign-in test).
- [!] **Desktop Grab & Clipboard:** Copy text from Grab tool in desktop Electron app.
- [!] **Interface Scaling & Floating Windows:** Scaling with `Ctrl+Shift+-/+/0` across all windows; tray minimization (`_`), maximize (`□`), close (`×`) on floating Ask AI / Quiz / Audio windows.
- [!] **Drive Version Comparison:** Newer-version check on open and side-by-side comparison with study material migration.
- [!] **Desktop Audio Recording:** Real microphone recording in Electron desktop app; type filter on live Google Drive.
- [!] **Image Crop Export:** Validate imported image crops in physical iPad Noteful.

---

## 3. Planned Future Roadmap (`[ ]`)

- [ ] **Reorder Pages in Any Note:** Drag thumbnails in Pages panel, keyboard commands (*Move page up/down*), automatic reference renumbering (flashcards, quizzes, page markers, audio).
- [ ] **Collaborative Notes:** Real-time Yjs CRDT notes sharing with linked documents ([COLLABORATION.md](COLLABORATION.md)).
- [ ] **Document Format Tiers:** Three distinct formats (`.noteful` for iPad parity, `.notepart` for partial patches, `.notecomp` for complete bundles with notes and audio).
- [ ] **Multi-Page Export Selector:** SVG, PDF, and image export with page range picker (single, range, list, or all).
- [ ] **Library Sources:** Home switch for Recent · Google Drive · GitHub Repositories (with Git LFS support).
- [ ] **Infinite Canvas:** Unbounded canvas mode that exports to Noteful by tiling into sheets.
- [ ] **Ask AI on HTML Pages:** Extract text and run study/quiz generation on opened HTML documents.

---

## 4. Completed Delivery Summary (Rounds 1–13 Archive)

| Topic | Completed Highlights (`[D]`) |
|---|---|
| **Study & Quizzes** | Background generation with progress bar chip, floating minimizable quiz window, dispute (X), double check (V), hint clipping from page region, Anki export. |
| **AI Chat & Flashcards** | Streaming responses, KaTeX math typesetting, Ask AI on cards with tool/model selector, scratchpad per note, follow-up retention. |
| **Audio & Transcription** | Floating audio panel, timed ink dimming, background Whisper/Voxtype/Gemini transcription, word-level timestamps, SRT/WebVTT export. |
| **Tools & Canvas** | Pan, Pen, Highlighter (straight/freehand/rectangle), Eraser (4 sizes), Tape (strips & rectangles with washi pattern), Lock/unlock tool (`O`), Crop tool for images. |
| **Reader & Files** | Single-instance app, tabs strip with drag reorder, Dark pages (D) with Dark Reader engine, zoom to fit/percent, recent notes management, folders on Home. |
| **Notes & Markdown** | TinyMDE docked Notes panel (`N`), LaTeX preview, `<!-- page N -->` markers, `.notecomp` archive export, HTML/plain text editing. |
