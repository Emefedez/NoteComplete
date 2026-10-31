# NoteComplete for AI agents (MCP)

`noteful mcp` is a local [Model Context Protocol](https://modelcontextprotocol.io) server. It lets an agent you already pay for, such as Claude Code, Antigravity or Codex, read your notes and turn them into study material. Everything runs on your computer. Pages, ink and recordings are never modified. Files are written only when the agent extracts a resource, saves a flashcard deck or writes Markdown notes, to the path it names.

## Set up

Build the CLI once (`cargo build --release -p noteful-cli`), then register the binary:

```sh
claude mcp add -s user notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
antigravity mcp add notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
codex mcp add notecomplete -- ~/path/to/noteful-re/target/release/noteful mcp
```

Page images and PDF text use poppler (`pdftoppm`, `pdftotext`) and librsvg (`rsvg-convert`); on Arch: `pacman -S poppler librsvg`. Without them the text tools still work and image tools explain what is missing. By default the agent looks for notes in NoteComplete's downloads folder (`~/Documents/NoteComplete`); set `NOTECOMPLETE_LIBRARY` to use another folder, or give any path.

## Tools

| Tool | What it returns |
|---|---|
| `list_notes` | Notes in a folder with title, page count and size (read from the index, without loading the note). |
| `note_outline` | Title, every page's size, PDF background, ink/object count and typed-text snippet, and the recordings. |
| `page_text` | A page's typed text and PDF text. |
| `page_image` | A PNG of the page as the reader draws it: PDF, handwriting, highlights, images and typed text. This is how the agent reads handwriting. |
| `search_note` | Pages whose typed or PDF text contains every query word, ignoring case and accents. |
| `extract_resource` | Lists or writes the note's PDFs, recordings or cover image. |
| `read_notes` | The Markdown notes kept with a `.notecomp`, `.notepart` or `.nfedit` note, and which pages they are tied to. |
| `write_notes` | Appends to (or replaces) those Markdown notes. With `page`, the text goes under a `<!-- page N -->` marker so it follows that page. Pages, ink and recordings are untouched, the file is replaced atomically and the previous version is kept as `<name>.bak`. A plain `.noteful` file has no notes; save it as `.notecomp` first. |
| `write_anki_deck` | Saves flashcards as an Anki text file with `#separator`, `#deck` and `#tags` headers (Anki → File → Import). It does not overwrite a file unless asked to. |

The `flashcards` prompt (`/mcp__notecomplete__flashcards` in Claude Code) asks the agent to:
1. read the pages you name;
2. weigh your handwriting and highlights heavily, since they mark what you emphasised;
3. draft cards in the note's language and show them to you;
4. write the deck when you confirm, then offer a short quiz.

Recognized text (OCR) and transcripts made in the reader stay in its browser storage, so the server doesn't see them yet. The agent reads handwriting from page images instead.
