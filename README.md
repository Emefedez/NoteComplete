<p align="center"><img src="docs/images/banner.svg" alt="NoteComplete: your Noteful notebooks on the desktop, no Mac required" width="100%"></p>

# NoteComplete

**Your Noteful notebooks on the desktop, no Mac required.**

NoteComplete is an independent desktop and web companion for people who take notes in [Noteful](https://noteful.app) on an iPad. It opens `.noteful` notebooks on Linux (the main target today), Windows, macOS or in a browser, so you can read, review, search and study your notes from your computer while the iPad stays your notebook.

> NoteComplete is not affiliated with or endorsed by Noteful. It reads the format through independent reverse engineering; see [How it reads Noteful files](#how-it-reads-noteful-files).

<p align="center"><img src="docs/images/reader.png" alt="A notebook open in NoteComplete with the page list, the tools and the audio panel" width="100%"></p>

## What it does

### Read and annotate
- **Everything in a notebook**: PDF and paper backgrounds, handwriting, highlighter, shapes, images, typed text, tape, locked items, tags and recordings, including widened pages and notebooks of hundreds of pages.
- **Fix things up**: pen, highlighter (straight, freehand or rectangle), eraser (four sizes), shapes, tape (strips or rectangles, with washi patterns), text boxes with a format bar (font, size, bold, italic, colour) and images; move, resize, restyle and lock items in place; layers; undo/redo. Drag the tool buttons into the order you like. Edits are non-destructive: the original file is never changed.
- **Pages your way**: add blank pages of any size or pages from another PDF at the note's scale; resize any page from a menu or by dragging its borders, with the PDF kept in place.
- **Select and copy text** from PDFs and from recognized handwriting, straight from the page.
- **Night view** (<kbd>D</kbd>): white paper turns black and ink turns light, colours keep their hue. Pages can sit left, centred, right or wherever you leave them.

<p align="center"><img src="docs/images/night.png" alt="Night view: a handwritten exam page with black paper and light ink" width="100%"></p>

### Notes in Markdown
A **Notes** panel (<kbd>N</kbd>) sits beside the pages: Markdown that is formatted and coloured as you type, with a formatted preview. **+ Page** ties a section to the page you are on; clicking it jumps there, and the notes follow you as you turn pages. Notes are kept with each note on the device and saved in projects. Export the note on its own (.noteful), with its notes as a Markdown file whose page breaks are marked (.noteful + .md), or as one **.notecomp** file that holds both and opens in NoteComplete with its notes. The editor loads only when the panel is opened; rendering and the archive format are in the Rust core.

### Your library
- **Google Drive on Home**: connect read-only, open your Noteful backup folder once and it reopens next time. Notes appear as cards with their real covers, read with a few small requests instead of downloading each notebook, or as a quick list that reads nothing at all.
- **Filters and sorting**: by date, size, recordings and Noteful tags; natural A–Z order.
- **Kept on this device**: opened notes are saved to a folder you choose and reused until Drive has a newer version.

<p align="center"><img src="docs/images/home.png" alt="Home with recent notes, sort, view switch and filters" width="100%"></p>

### Find anything
One search (<kbd>Ctrl</kbd>+<kbd>F</kbd>) over typed text, PDF text, transcripts and recognized handwriting, limited to any mix of sources. Handwriting recognition runs on this device on request, in a separate pass over the ink, so it also works on PDF pages.

<p align="center"><img src="docs/images/find.png" alt="Find with source chips: Text, PDF, OCR and Audio" width="100%"></p>

### Listen along
Play recordings with the handwriting appearing as it was written, tap ink to seek, and transcribe with Whisper on the device, Voxtype (local whisper.cpp) or Gemini through Antigravity. Text appears while it is transcribed; your AI tool can then revise it while every word keeps its time. Export as text, SRT, WebVTT or JSON.

### Study with your AI subscription
Flashcards and quizzes are generated in the background by the AI tool you already use (Claude Code, Antigravity or Codex), from page images with tape lifted and the page text. Practise flashcards and export them to Anki; quizzes are saved, resumable and point to the part of your notes that answers each question. **Ask AI** (<kbd>Ctrl</kbd>+<kbd>J</kbd>) answers questions about a page or a region you grab. The bundled MCP server lets agents read your notebooks directly ([AI agents](docs/MCP.md)).

<p align="center"><img src="docs/images/flashcards.png" alt="An example flashcard deck, question over answer" width="70%"></p>

### Feels like a desktop app
Tabs for several notes in one window (<kbd>Ctrl</kbd>+<kbd>T</kbd>, drag to reorder), a native-style File / Edit / View menubar that shrinks while you scroll, a <kbd>Ctrl</kbd>+<kbd>K</kbd> command search, single-key shortcuts for every tool, and <kbd>?</kbd> to show each button's key on the button itself.

<p align="center"><img src="docs/images/keys.png" alt="Key badges on the toolbar buttons after pressing ?" width="100%"></p>

**Private by default**: everything is processed locally. Drive access is read-only unless you choose to upload a change or delete a note there. AI features run through your own tools; only Gemini transcription sends audio off the device.

Screenshots use the sample notes in [`samples/`](samples/).

## Get it

**Installers.** Tagged releases attach a Linux AppImage, macOS DMG/ZIP (Apple Silicon and Intel), a Windows installer and an Android APK preview. Builds are unsigned previews; Linux is the tested platform for now. See [builds](docs/BUILDS.md).

**Browser.** Build and serve the web app (below), then open it in any modern browser. It also installs as a PWA.

### Getting notes from the iPad

1. In Noteful, back up or export your notebooks to a Google Drive folder (or copy `.noteful` files to your computer any other way).
2. In NoteComplete choose **Connect Google Drive** on Home, allow read-only access, and open that folder. Or use **File → Open…** for a local `.noteful`, `.nfedit`, PDF or image.
3. Save your work with **File → Save project** (`.nfedit`, keeps the original plus your edits) or export a `.noteful` with **File → Export** (experimental: modified exports have not yet been verified in Noteful itself).

AI agents (MCP): [docs/MCP.md](docs/MCP.md). Drive setup for self-hosted builds (OAuth client, API key for public folder links) is in [Google Drive](docs/GOOGLE_DRIVE.md). Controls, audio and quality settings are in the [user guide](docs/USER_GUIDE.md).

## Known issues

- Some notes (for example *Discover Chinese*) never loaded their thumbnail on Home until reloaded; fixed in the latest build (covers are now retried).
- Pages cannot be resized yet, and there is no tool to lock items in place yourself (items locked in Noteful are respected).
- Exports to `.noteful` after editing have not yet been verified in Noteful itself.
- More open items are tracked in [docs/REQUESTS.md](docs/REQUESTS.md).

## Build from source

Requirements: Rust 1.93+, Node 22.13+ and Python 3.11+.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked --root work/wasm-tools
python3 tools/build_web.py
node tools/serve_web.mjs 8767          # http://127.0.0.1:8767/
```

Desktop: `cd apps/desktop && npm ci && npm run stage && npm start` (or `npm run dist` for a package). Mobile (Expo Go, SDK 57): `cd apps/mobile && npm ci && npm start`. Package workflows and signing limits: [builds](docs/BUILDS.md).

Checks:

```sh
cargo fmt --all --check && cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
node --test apps/reader/*.test.mjs apps/mobile/*.test.mjs apps/desktop/*.test.mjs tools/*.test.mjs
node apps/reader/test.mjs              # after a web build
```

## How it reads Noteful files

Noteful's format is undocumented. NoteComplete's Rust core comes from the noteful-re reverse-engineering effort. Its tools and evidence (Ghidra scripts, the independent Python oracle, the legacy viewer and the parity checks) are kept on the [`reverse-engineering`](https://github.com/Emefedez/noteful-re/tree/reverse-engineering) branch of this repository, where a short writeup of how the format was worked out will be published. The resulting [format specification](spec/noteful-v0.1.md) is kept here.

Related work: [noteful-mcp](https://github.com/openninoor/noteful-mcp) (MIT) independently reads and writes Noteful notebooks for AI agents.

## Repository

| Directory | Purpose |
|---|---|
| `apps/reader/` | The NoteComplete app (web, and the UI of every build) |
| `apps/desktop/`, `apps/mobile/` | Electron desktop shell and Expo wrapper |
| `crates/` | Rust core (format, scene, editing, export), CLI and WASM adapter |
| `docs/` | User guide, Google Drive, builds, release notes |
| `spec/`, `samples/`, `tests/fixtures/` | Format specification the core implements, sample corpus and synthetic fixtures |
| `tools/` | Web build, local server and Expo helpers |

Development procedure and architecture: [DEVELOPMENT.md](DEVELOPMENT.md).
