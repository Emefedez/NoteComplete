---
name: notecomplete-markdown-prefabs
description: Create and edit NoteComplete Markdown (.md), HTML, and Euro-Office (.docx, .pptx, .odt, .odp) documents with embedded editable NoteComplete prefabs (charts, timelines, process states, UML diagrams, plots, algorithms, truth tables, number lines, hanzi stroke order, sticky notes, textual analysis). Use when generating study documents, reports, or inserting prefabs into Markdown or Office files via the NoteComplete MCP.
---

# NoteComplete Markdown & Euro-Office Prefabs

Use this workflow when creating Markdown documents or inserting NoteComplete prefabs into Markdown, HTML, Euro-Office (`.docx`, `.pptx`, `.odt`, `.odp`), or notebook Markdown notes.

## Creating a new Markdown document with prefabs (`create_markdown`)

1. Draft clean Markdown with `<!-- PREFAB:key -->` placeholders where each visual figure belongs (e.g. `<!-- PREFAB:schedule -->`, `<!-- PREFAB:uml -->`).
2. Build the `prefabs` JSON object mapping each `key` to its NoteComplete prefab spec (see `add_prefab`'s tool schema for exact spec shapes: `states`, `timeline`, `histogram`, `bar`, `plot`, `uml`, `truthtable`, `numberline`, `algorithms`, `r-math`, `textual-analysis`, `hanzi`, `stickynote`).
3. Call `create_markdown(title, markdown, prefabs)` once.
   - NoteComplete renders every prefab to an SVG data URI carrying `data-nc-prefab-spec`, so the user can **double-click any prefab in NoteComplete** (or right-click → **Edit prefab…** in Euro-Office) to edit it natively.
4. Visually inspect the PNG previews returned by `create_markdown` and fix any cramped labels or clipped axes.

## Inserting prefabs into existing documents (`add_prefab`)

- **Markdown (`.md`, `.markdown`, `.txt`)**:
  - Use `replace_placeholder: "<!-- PREFAB:chart -->"` to replace a marker, OR `after_heading: "Results"` to insert under a heading, OR `position: "start" | "end"`.
  - Pass `in_place: true` to update the file in place (a `.bak` backup is kept automatically), or omit it to write a safe copy.
- **Notebook Markdown notes (`.notecomp`, `.nfedit`)**:
  - Pass `target: "notes"` (and optional `page: N` to tie it under `<!-- page N -->`).
- **Euro-Office (`.docx`, `.pptx`, `.odt`, `.odp`)**:
  - `.docx` / `.odt`: inserts a high-DPI PNG with `notecomplete-prefab:<spec>` preserved in the image description (so NoteComplete's Euro-Office right-click menu offers **Edit prefab…**). Supports `replace_placeholder` and `position`.
  - `.pptx` / `.odp`: pass `page: N` to target a specific slide (defaults to the last slide).
- **HTML (`.html`, `.htm`)**:
  - Embeds `<figure class="nc-prefab">` with the editable SVG data URI.
