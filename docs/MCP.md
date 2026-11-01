# NoteComplete for AI agents (MCP)

`noteful mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io) server. It lets an agent you already pay for, such as Claude Code, Antigravity, Codex or OpenCode, read your notes, turn them into study material, and write real, editable Noteful handwriting: new notebooks, added pages, clean copies and marks on existing pages. Everything runs on your computer. Notes are changed only when the agent asks for it explicitly, and then the previous file is kept as `<name>.bak`.

The design, wire-format notes and remaining phases are in [INK-WRITING.md](INK-WRITING.md).

## Set up

Build the CLI once (`cargo build --release -p noteful-cli`), then register the binary:

```sh
claude mcp add -s user notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
antigravity mcp add notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
codex mcp add notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
opencode mcp add   # interactive; or add to ~/.config/opencode/opencode.json:
                   # "mcp": { "notecomplete": { "type": "local", "command": ["~/path/to/noteful-re/target/release/noteful", "mcp"], "enabled": true } }
```

The desktop app's Ask AI, Study and transcript revision already pass this server to whichever tool you pick (Claude Code, Antigravity, Codex or OpenCode) for the open note; no setup is needed there.

Page images use librsvg (`rsvg-convert`), and imported PDFs need poppler (`pdftoppm`, `pdftotext`); on Arch: `pacman -S poppler librsvg`. Without them the text tools still work and image tools explain what is missing. Generated paper is drawn without poppler. By default the agent looks for notes in NoteComplete's downloads folder (`~/Documents/NoteComplete`); set `NOTECOMPLETE_LIBRARY` to use another folder, or give any path.

## Reading and study tools

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

## Handwriting tools

Text becomes real pen strokes (a fineliner, or a ballpoint with per-point pressure), highlighter is written *under* the page's ink, tape is native Noteful tape, and SVG diagrams become pen outlines with pastel highlighter fills. The result stays editable on the iPad: erase it, recolour it, lasso it.

| Tool | What it does |
|---|---|
| `create_notebook` | A new A4 notebook from Markdown (`title`, `markdown`), on generated paper. |
| `add_pages` | Handwritten pages added to a note, at the end or after page N (`after_page`, 0 = at the start). Paper follows the page before them when it is generated paper. |
| `clean_copy` | A neat rewrite inserted right after `page` (defaults: ruled paper, neat hand). The agent reads the messy page first with `page_image`. |
| `write_on_page` | Marks on an existing page: `text` (handwriting), `markdown`, `textbox` (a native typed Noteful text box, with font, size, colour, bold, italic, underline, strikethrough, alignment), `line`, `arrow`, `rect`, `ellipse`, `underline`, `check`, `cross`, `star`, `highlight`, `highlight_line`, `tape` and `drawing` (SVG). Coordinates are page units, origin top-left; A4 is 1091 × 1543. |
| `page_layout` | Where things are on a page, to aim marks: the handwriting grouped into numbered items (words and phrases on one line) in reading order, highlighted regions, text boxes (with their text), images, shapes and tape, each with a bbox `[x0, y0, x1, y1]`, and the page with each item outlined and numbered. |
| `example_pages` | The example pages and drawings to imitate, with their source and a preview; without a name, the list and the style guide. |

Shared options for the Markdown tools: `paper` (`dot`, `grid`, `ruled`, `blank`, or `dark-…`), `theme` (`light` ivory page with pastel washes, `dark` black page with neon ink), `look` (`study` composed study notes, or `classic` plain notebook), `accent` (`coral`, `amber`, `sky`, `purple`, `teal`, `pink`), `ink`, `font` (`patrick`, `caveat`, `readability`, `felix`, `allure`, `elfin`, `nixish`), `hand` (`neat`, `natural`, `messy`), `pen` (`fineliner`, `ballpoint`), `size` (body x-height, default 11) and `seed` (same seed, same strokes).

### Where written notes go

- Without `out`, a copy is written to the NoteComplete folder's `ink/` subfolder, under a free name (`Title.noteful`, `Title (2).noteful`, …). The source note is never touched.
- `out` names the file (`.noteful`, `.notecomp` or `.nfedit`); an existing file is replaced only with `overwrite: true`, and `out` cannot be the source note.
- `in_place: true` changes the source note itself and keeps the previous file as `<name>.bak`.
- A `.notecomp` keeps its Markdown notes and recordings; an `.nfedit` keeps its edit history.
- Every write returns what was written (path, new pages, warnings such as unknown colours or skipped SVG features, and a note when the content spilled onto more pages) and a picture of the first written page, so the agent can check its work.

### Handwriting Markdown

One block per line.

| Markdown | On the page |
|---|---|
| `# THE **CARDIAC** CYCLE` | Title in thick capitals with a soft shadow; the `**word**` in the accent. End with `:heart:` (sun, star, atom, drop, bolt, cloud, leaf) for a doodle. |
| `# TOP // BOTTOM` | Two-line title, the second line big on a marker band. |
| `_subtitle_` | Subtitle line and a thin rule. |
| `## Section`, `### Label` | Coloured capitals on a rule to the margin; a small label. Each section takes the next accent. |
| `**term**`, `==phrase==`, `=={pink}phrase==`, `[[tag]]`, `((detail))` | Accent colour, highlighter under the words, pill, grey detail. |
| `- item`, `* item`, `-> item`, `1. item`, `[ ] item`, `[x] item` | Dot, star, hook arrow, circled number, open/ticked box. |
| `> [sky] TITLE: text` | Card with a pastel fill and sketched outline. |
| `>> A: text \|\| B: text` | Cards side by side. |
| `!columns 55` … `!col` … `!end` | Columns (the first 55 % wide). |
| `!zone [mint]` … `!end` | A pale full-width band behind a topic. |
| `!sticky [yellow] TITLE: text` | A taped sticky note, slightly turned. |
| `!stat 42 label` | A big number with its meaning. |
| `!map TOPIC \| question?` then `- BRANCH` / `  - leaf` | A tree diagram (best on dark pages). |
| `!draw 480` `<svg …>…</svg>` `!end` | A diagram drawn in ink. |
| `!tape [mint]`, `---`, `\pagebreak` | Washi tape, a thin rule, a new page. |

Science: Greek letters, `T^4`, `m^{-2}`, `CO_2`, `λ_{max}`, `→ ⇄ ≈ ± ° √ ∞ ≤ ≥` are drawn by hand. Accented letters (á é í ó ú ñ ü ç …) and `¿ ¡` keep their accents even where the handwriting font lacks them.

Drawings: plain SVG with a viewBox 400–650 wide. Outlines become pen strokes, fills become pastel highlighter under the ink (later shapes cover earlier ones), and `<text>` becomes handwriting. Gradients, patterns, masks, clip paths, images and `<use>` are skipped with a warning.

### From the terminal

The same engine writes notebooks without an agent:

```sh
noteful convert lecture.md -o lecture.noteful --paper ruled --look classic
noteful convert summary.md -o summary.notecomp --theme dark --accent pink
```

Open the result in NoteComplete to export it as PDF, PNG or SVG.

## Resources and prompts

- `noteful://style`: the style guide and the Markdown dialect.
- `noteful://examples`, `noteful://examples/{name}`, `noteful://examples/{name}/preview`: the example index, each example's source, and how it looks (PNG). Examples: `cell-biology`, `radiation`, `clean-copy`, `quiz`, `answers-tree` (pages) and `heart`, `cell`, `graph`, `diagram`, `probability-tree` (drawings).
- Prompts (`/mcp__notecomplete__<name>` in Claude Code):
  - `flashcards`: Anki flashcards (and a short quiz) from a note's pages.
  - `summary_page`: a one-page handwritten study summary of a topic or a note.
  - `clean_copy`: a neat step-by-step rewrite inserted after a messy page.
  - `grade_quiz`: ticks, circles, corrections and a score on a quiz answered by hand.
  - `quiz`: a handwritten multiple-choice quiz from notes.
  - `tree_page`: a topic classified as a tree diagram on black paper.

Recognized text (OCR) and transcripts made in the reader stay in its browser storage, so the server doesn't see them yet. The agent reads handwriting from page images instead.

## Not yet

- Files written here have not yet been imported on an iPad (the compatibility check in INK-WRITING.md, Phase 0). They open in NoteComplete; text boxes keep the layout confirmed from Noteful's own files, and alignment, underline and strikethrough use attribute keys read from the decompiled app.
- Copying a page design from a picture (`design_mockup`, `mockup_grid`, `design_page`) and the desktop app's Markdown converter are planned.
