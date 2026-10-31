# NoteComplete for AI agents (MCP)

`noteful mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io) server. It lets an agent you already pay for, such as Claude Code, Antigravity or Codex, read your notes, turn them into study material, and synthesize real editable Noteful handwriting ink. Everything runs on your computer. Existing notes are never modified unless explicitly requested via backup-guarded tools.

Detailed technical design, wire-format analysis, and phased implementation plans are specified in [docs/INK-WRITING.md](file:///home/m1-max/Documents/noteful-re/docs/INK-WRITING.md).

## Set up

Build the CLI once (`cargo build --release -p noteful-cli`), then register the binary:

```sh
claude mcp add -s user notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
antigravity mcp add notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
codex mcp add notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
```

Page images and PDF text use poppler (`pdftoppm`, `pdftotext`) and librsvg (`rsvg-convert`); on Arch: `pacman -S poppler librsvg`. Without them the text tools still work and image tools explain what is missing. By default the agent looks for notes in NoteComplete's downloads folder (`~/Documents/NoteComplete`); set `NOTECOMPLETE_LIBRARY` to use another folder, or give any path.

## Tools Overview

### Reading & Study Tools (Current)

| Tool | What it returns |
|---|---|
| `list_notes` | Notes in a folder with title, page count and size (read from the index, without loading the note). |
| `note_outline` | Title, every page's size, PDF background, ink/object count and typed-text snippet, and the recordings. |
| `page_text` | A page's typed text and PDF text. |
| `page_image` | A PNG of the page as the reader draws it: PDF, handwriting, highlights, images and typed text. This is how the agent reads handwriting. |
| `search_note` | Pages whose typed or PDF text contains every query word, ignoring case and accents. |
| `extract_resource` | Lists or writes the note's embedded PDFs, recordings or cover image. |
| `read_notes` | The Markdown notes kept with a `.notecomp`, `.notepart` or `.nfedit` note, and which pages they are tied to. |
| `write_notes` | Appends to (or replaces) those Markdown notes. With `page`, the text goes under a `<!-- page N -->` marker so it follows that page. Pages, ink and recordings are untouched, the file is replaced atomically and the previous version is kept as `<name>.bak`. A plain `.noteful` file has no notes; save it as `.notecomp` first. |
| `write_anki_deck` | Saves flashcards as an Anki text file with `#separator`, `#deck` and `#tags` headers (Anki → File → Import). It does not overwrite a file unless asked to. |

### Ink Writing & Page Generation Tools (Planned Specification)

Modeled on the proven algorithms of `openninoor/noteful-mcp` (pinned commit `175e8d7`), these tools synthesize real editable vector ink directly inside NoteComplete's Rust core:

| Tool | Capability |
|---|---|
| `create_notebook` | Synthesizes a new `.noteful` notebook with handwritten pages composed from Markdown. Supports paper styles, fonts, hands, pens, and study themes. |
| `add_pages` | Composes Markdown into handwritten pages and appends or inserts them after a specified page in an existing notebook. |
| `clean_copy` | Re-writes lecture notes or messy drafts into a neat, structured study page immediately following the original. |
| `write_on_page` | Places vector ink annotations or native Noteful typed text boxes onto an existing page (handwritten comments, typed text boxes, checkmarks, arrows, circles, tape, and SVG diagrams). Highlighter strokes are automatically positioned *under* existing ink. |
| `page_layout` | Inspects bounding boxes of existing handwriting clusters, highlights, images, and typed text boxes so an agent can aim marks without collisions. |
| `example_pages` | Returns golden study-note templates, style guides, and SVG examples with previews. |
| `mockup_grid` | *(Optional Phase 7)* Overlays a coordinate pixel grid onto layout mockup images. |
| `design_page` | *(Optional Phase 7)* Transcribes visual layout grid blocks into ink on a page. |
| `design_mockup` | *(Optional Phase 7)* Invokes an image model to draft a visual study-note layout. |

### Safety & Output Rules for Write Tools

- **No Destructive Overwriting:** By default, write tools write to an explicit `out` path or save copies into `~/Documents/NoteComplete/ink/<title>.noteful`.
- **In-place Edits Require Flag:** If `in_place: true` is passed, the original file is preserved as `<path>.bak`.
- **Immediate Visual Feedback:** Every write tool returns both metadata (path, page count, warnings) and a base64-encoded PNG preview of the first rendered page.

---

## Handwriting Markdown Dialect

When sending Markdown to `create_notebook`, `add_pages`, or `clean_copy`, agents use a specialized handwriting dialect designed for note composition:

| Dialect Syntax | Visual Ink Output |
|---|---|
| `# TITLE` | Study title in bold caps with soft shadow and accent styling |
| `# TOP // BOTTOM` | Two-line header with bottom text on an accent highlighter marker band |
| `## Section` | Section heading with accent rule running to margin |
| `### Label` | Small-caps topic tag |
| `**word**` | Word emphasized in primary accent color |
| `==phrase==` | Text with translucent highlighter stroke placed *under* the letters |
| `[[tag]]` | Sketched pill badge |
| `((detail))` | Dimmed secondary margin note |
| `> [sky] Title: Text` | Structured card with pastel background and sketched outline |
| `>> A: ... \|\| B: ...` | Two side-by-side cards |
| `!columns [60]` … `!col` … `!end` | Multi-column layout with customizable column split |
| `!zone [mint]` … `!end` | Full-width soft-tint background zone |
| `!sticky [yellow] Note` | Sketched sticky note with simulated washi tape |
| `!stat 42 label` | Large prominent numeral stat with label |
| `!draw [300] <svg>...</svg> !end` | Draws vector diagram directly into vector ink strokes |
| Greek & Math: `α, β, θ, λ, ∂, ∑, √, ≈, ≤, →, T^4, CO_2` | Hand-drawn scientific glyphs, arrows, and superscripts/subscripts |

---

## In-App Conversion & Format Export Chaining

The same handwriting engine powering MCP tools also enables direct conversion within the app and CLI:

1. **Markdown → `.noteful`**: Compiles Markdown to natural vector ink and generates crisp background paper PDFs.
2. **Markdown → `.noteful` → Export**:
   - **PDF:** Vector PDF export preserving pen thickness, colors, and paper grid at print resolution.
   - **PNG / SVG:** Rendered page images.
3. **CLI usage:**
   ```bash
   noteful convert lecture.md -o lecture.noteful --paper dot --hand natural
   noteful convert lecture.md --export pdf -o lecture.pdf
   ```

---

## MCP Prompts & Resources

- `noteful://style`: Machine-readable guidelines on spacing, margins, color palettes, and layout patterns.
- `noteful://examples`: Golden reference templates (`cell-biology`, `radiation`, `clean-copy`, `quiz`).
- Prompts:
  - `/mcp__notecomplete__summary_page`: Synthesizes an outline or notes into a one-page visual study sheet.
  - `/mcp__notecomplete__clean_copy`: Transcribes messy handwriting into a clean, legible study note.
  - `/mcp__notecomplete__grade_quiz`: Corrects student exercise sheets with ticks, circled errors, and feedback ink.
  - `/mcp__notecomplete__flashcards`: Existing prompt for generating Anki decks from notes.

For the complete architectural design, data models, and phased implementation schedule, consult [docs/INK-WRITING.md](file:///home/m1-max/Documents/noteful-re/docs/INK-WRITING.md).
