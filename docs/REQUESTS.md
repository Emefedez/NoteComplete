# NoteComplete Feature Requests & Implementation Status

`[!]` Verification pending on real app/device · `[ ]` Planned / In progress · `[D]` Completed

---

## 1. Active Implementation Priorities

### 1.1 Text Box Parity (`[ ]` Partly built)
- **Detailed Specification:** See [`docs/INK-WRITING.md` Section 8](INK-WRITING.md).
- **Built:** `TextBox` keeps font, size, bold, italic, colour, `align`, `underline`, `strikethrough` and `math` (`crates/noteful-core/src/imports.rs`); text boxes made here are edited in place (`Edit::Retext`, `edit_text`); the format bar `#textFormat` has font, size, bold, italic, math, swatches and a custom colour, and can dock in the tool bar; `write_on_page` takes `"type": "textbox"` with those styles and `page_layout` returns text boxes with bounds and text (`crates/noteful-core/src/ink/annotate.rs`, `layout.rs`).
- **Missing:**
  - Editing text that came from Noteful: `openTextEditor` in `apps/reader/app.js` still answers "Text from Noteful cannot be edited here yet", and the core has no edit that rewrites a native kind-2 object.
  - Several styles in one box: `TextBox` has one style; runs (`TextRun`) are only decoded.
  - Underline, strikethrough, alignment and a box background in the format bar, and `Ctrl+B` / `Ctrl+I` / `Ctrl+U`.
  - Side handles that change the wrap width: there is no `wrap_width` in the core and the editor does not wrap.
  - `noteful convert --mode typed` (typed text boxes instead of handwriting).

### 1.2 Shapes Fill (`[!]` Built 2026-11-01; native filled objects pending)
- **Built:** `Shape.fill` (rectangle, ellipse, triangle, star), validated and kept on resize; Fill picker `#shapeFill` (outline / tint 25% / solid) in the shape settings and the tablet dock, **F** cycles it; live filled preview; projects keep it; `.noteful` export writes the inside as highlighter bands under the outline.
- **Pending:** export as native Kind-3/Kind-6 filled objects ([`docs/INK-WRITING.md` Section 8.7](INK-WRITING.md)) and a custom fill swatch.

### 1.3 MCP Vector Ink Writing & Page Generation (`[!]` Implemented; `design_mockup` not yet run with a real key)
- **Detailed Specification:** See [`docs/INK-WRITING.md`](INK-WRITING.md) and [`docs/MCP.md`](MCP.md).
- **Done:** pressure and under-ink in the core, handwriting engine, classic and study looks, SVG → ink, paper, `create_notebook`, `add_pages`, `clean_copy`, `write_on_page` (including native text boxes), `page_layout`, `example_pages`, resources, prompts, design copy (`design_mockup`, `mockup_grid`, `design_page` with tracing), `noteful convert` with `--export pdf|png|svg`, the in-app converter (File → New from Markdown, Pages → Insert handwritten pages), and Help → Connect AI tools (the server ships with the desktop app).
- **Pending:** `design_mockup` with a real Gemini key.

### 1.4 Infinite Canvas (`[D]` First slice)
- **Done:** File → New document → *Canvas*: one page that grows right and down (800-unit steps) when ink, pictures or text boxes come within 300 units of its edge. Each growth is its own undo step, under the stroke that caused it, and the page keeps its place on screen. Kept as a flag in projects (version 7) and `.notecomp`/`.notepart` (`"canvas": true` in the manifest). The flag survives sharing and tablets, because every copy grows the same way from the same edits.
- **Never a `.noteful` file:** Noteful has no infinite page. The core refuses `export_noteful` for a canvas, so the app, the CLI and the MCP tools all refuse it. New document turns off Noteful for a canvas, and the NF and N+MD exports are off. A canvas takes no inserted pages.
- **Pending:** growing to the left and up, an overview zoom, and a canvas from the MCP tools.

---

## 2. Pending Verification on Real App / Device (`[!]`)

- [!] **Google Drive Writes:** Upload unsaved changes before removing a note; move note to Drive trash (tested against fake Drive server; needs physical sign-in test).
- [!] **Desktop Grab & Clipboard:** Copy text from Grab tool in desktop Electron app.
- [!] **Interface Scaling & Floating Windows:** Scaling with `Ctrl+Shift+-/+/0` across all windows; tray minimization (`_`), maximize (`□`), close (`×`) on floating Ask AI / Quiz / Audio windows.
- [!] **Drive Version Comparison:** Newer-version check on open and side-by-side comparison with study material migration.
- [!] **Desktop Audio Recording:** Real microphone recording in Electron desktop app; type filter on live Google Drive.
- [!] **Sharing and drawing tablets:** shared Markdown notes (Yjs) with guest names, presence, cursors and ending; a phone or tablet as the computer's drawing surface (QR or 6-digit code, tool dock left/right with pen, highlighter, shapes and fill, own zoom, live strokes with pen pressure, shared undo). Tested in Node and headless Chromium (`tools/collab_e2e.mjs`); still to try on real devices, a real stylus, a real Wi-Fi network and the packaged apps ([COLLABORATION.md](COLLABORATION.md#not-yet-verified)).
- [!] **Handwriting text and New note with AI:** handwriting written from Markdown keeps its words with their boxes (projects version 6, `ink-text.json` in `.notecomp`), so Find searches it at once without OCR; File → New note with AI… has the user's AI tool write the Markdown (streamed into the preview). Tested with a stand-in AI tool (`tools/ink_features_e2e.mjs`); still to try with the real CLIs. `.noteful` files do not carry the text.
- [!] **Narrow windows and phones:** the menubar, tools and page row scroll sideways with the mouse wheel and a faded edge instead of hiding buttons; dark pages and Fit stay in the phone page row; the page number box fits its digits; opened menus look as on the desktop. Checked in Chromium at 320–480 px, not yet on a phone.

---

## 3. Planned Future Roadmap (`[ ]`)

- [ ] **Reorder Pages in Any Note:** Drag thumbnails in Pages panel, keyboard commands (*Move page up/down*), automatic reference renumbering (flashcards, quizzes, page markers, audio). Not started: the core has `InsertPages` and `ResizePage` but no edit that moves or removes a page.
- [ ] **Collaborative Notes, remaining:** linked documents (download, changed copies, per-page merge, proposing versions) and resuming sessions ([COLLABORATION.md](COLLABORATION.md), Phases 1, 4–8).
- [ ] **Document Format Tiers:** Three distinct formats (`.noteful` for iPad parity, `.notepart` for partial patches, `.notecomp` for complete bundles). Today `.notecomp` holds the note, notes, added recordings and the text of written handwriting ([layout](../spec/nfedit-v1.md#notecomp-archives)); `.notepart` is still written the same way; study material is not packed yet.
- [ ] **Multi-Page Export Selector:** SVG, PDF, and image export with page range picker (single, range, list, or all). Today PDF is every page, image and SVG the current page (`apps/reader/page-export.js`).
- [ ] **Library Sources:** GitHub Repositories (with Git LFS support) on Home. Recent, Google Drive and Internet Archive are there; GitHub is not started.
- [ ] **Ask AI on HTML Pages:** Extract text and run study/quiz generation on opened HTML documents. Text and Markdown documents have it (`apps/reader/text-study.js`); HTML pages do not.

---

## 4. Completed Delivery Summary (Rounds 1–13 Archive)

| Topic | Completed Highlights (`[D]`) |
|---|---|
| **Study & Quizzes** | Background generation with progress bar chip, floating minimizable quiz window, dispute (X), double check (V), hint clipping from page region, Anki export. |
| **AI Chat & Flashcards** | Streaming responses, KaTeX math typesetting, Ask AI on cards with tool/model selector, scratchpad per note, follow-up retention; Claude Code, Antigravity, Codex and OpenCode. |
| **Audio & Transcription** | Floating audio panel, timed ink dimming, background Whisper/Voxtype/Gemini transcription, word-level timestamps, SRT/WebVTT export. |
| **Tools & Canvas** | Pan, Pen, Highlighter (straight/freehand/rectangle), Eraser (4 sizes), Tape (strips & rectangles with washi pattern), Lock/unlock tool (`O`), Crop tool for images. |
| **Reader & Files** | Single-instance app, tabs strip with drag reorder, Dark pages (D) with Dark Reader engine, zoom to fit/percent, recent notes management, folders on Home. |
| **Notes & Markdown** | TinyMDE docked Notes panel (`N`), LaTeX preview, `<!-- page N -->` markers, `.notecomp` archive export, HTML/plain text editing. |
