<p align="center"><img src="docs/images/banner.svg" alt="NoteComplete: your Noteful notebooks on the desktop, no Mac required" width="100%"></p>

# NoteComplete

**Your Noteful notebooks on the desktop, no Mac required.**

NoteComplete is an independent desktop and web companion for people who take notes in [Noteful](https://noteful.app) on an iPad. It opens `.noteful` notebooks on Linux (the main target today), Windows, macOS or in a browser, so you can read, review, search and study your notes from your computer while the iPad stays your notebook.

> NoteComplete is not affiliated with or endorsed by Noteful. It reads the format through independent reverse engineering; see [How it reads Noteful files](#how-it-reads-noteful-files).

<p align="center"><img src="docs/images/reader.png" alt="A notebook open in NoteComplete with the page list, the tools and the audio panel" width="100%"></p>

## What it does

- **Read and annotate**: PDF and paper backgrounds, handwriting, highlighter, shapes, images, typed text, tape, locked items, tags and recordings. Pen, highlighter, eraser, shapes, tape, text boxes, crop, layers and undo/redo. The original file is never changed. Blank pages of any size, or pages from another PDF.
- **Night view** (<kbd>D</kbd>) inverts the page colours; a **light/dark theme** switch is in View.
- **Notes in Markdown** beside the pages (<kbd>N</kbd>), tied to pages, plus a **Scratchpad** for AI conversations worth keeping.
- **Library**: Google Drive on Home (read-only) with covers, filters and sorting; a copy of each opened note is kept on your device; newer iPad versions can be compared page by page.
- **Find** (<kbd>Ctrl</kbd>+<kbd>F</kbd>) over typed text, PDF text, transcripts and recognized handwriting.
- **Listen along**: recordings with the ink appearing as it was written; record or import audio; on-device transcription.
- **Study with your own AI tool** (Claude Code, Antigravity or Codex): flashcards and quizzes, exported to Anki. See below.
- **Desktop app**: tabs and windows, floating panels, command search (<kbd>Ctrl</kbd>+<kbd>K</kbd>), automatic updates.
- **Export**: the note (`.noteful`, with Markdown, or `.notecomp`), pages as SVG, PDF or images, study material as Anki decks.

### Study with AI

- **Quizzes** and **flashcards** are made in the background from your pages and saved with the note.
- **Clarify** (quiz) and **Ask AI** (cards, or <kbd>Ctrl</kbd>+<kbd>J</kbd> for any page): the answer streams in, and the window grows to fit it.
- **Paste images** (<kbd>Ctrl</kbd>+<kbd>V</kbd>) into any AI question; follow-ups continue in Ask AI.
- Links in answers work: pages jump to the page, images open large, web links open in your browser.
- **Restart** a quiz with the circular arrow (press twice).
- Questions can be dictated with the mic.

<p align="center"><img src="docs/images/quiz-clarify.png" alt="A quiz window grown to fit a streamed answer" width="49%"> <img src="docs/images/card-ask.png" alt="A flashcard window grown to fit an answer" width="49%"></p>
<p align="center"><img src="docs/images/quiz-clarify-light.png" alt="The light theme" width="60%"></p>

Controls, audio and quality settings: [user guide](docs/USER_GUIDE.md).

## Get it

**Installers.** Tagged releases attach Linux AppImages (x86-64 and ARM64), macOS DMG/ZIP (Apple Silicon and Intel), a Windows installer and an Android APK preview. Builds are unsigned previews; Linux is the tested platform for now. See [builds](docs/BUILDS.md).

**Browser.** Build and serve the web app (below), then open it in any modern browser. It also installs as a PWA.

### Getting notes from the iPad

1. In Noteful, back up or export your notebooks to a Google Drive folder (or copy `.noteful` files to your computer any other way).
2. In NoteComplete choose **Connect Google Drive** on Home, allow read-only access, and open that folder. Or use **File → Open…** for a local note, project, PDF or image.
3. Save your work with **File → Save project** (`.nfedit`, keeps the original plus your edits), or export from **File → Export**: `.noteful` (experimental: modified exports have not yet been verified in Noteful itself), the note with its Markdown, or one `.notecomp` file with the note, its notes and added recordings.

AI agents (MCP): [docs/MCP.md](docs/MCP.md). Drive setup for self-hosted builds (OAuth client, API key for public folder links) is in [Google Drive](docs/GOOGLE_DRIVE.md). Controls, audio and quality settings are in the [user guide](docs/USER_GUIDE.md).

## Known issues

- Exports to `.noteful` after editing, crops made in NoteComplete included, have not yet been verified in Noteful itself.
- No release has been published yet, so the update check has nothing to find until one is.
- Uploading a change to Google Drive and deleting a note there are tested against a fake server only.
- A tab dragged out of the tab strip opens in its own window, but cannot be dropped onto another window's strip: Wayland does not tell the app where the pointer is outside its own windows.
- The Google Drive sign-in is not remembered between sessions, so Recent can only check Drive for newer versions after you connect (or for a public folder with an API key).
- Installers are unsigned previews, and Linux is the only tested platform.
- Every request and its state (`[D]` done, `[!]` not yet verified, `[ ]` to do) is in [docs/REQUESTS.md](docs/REQUESTS.md).

## Roadmap

Planned, not started (details in [docs/REQUESTS.md](docs/REQUESTS.md)):
- **The open NoteComplete format**: today `.notecomp` and `.notepart` are an archive of the note, its Markdown and added recordings; the plan is an open, documented ZIP package with pages, resources, notes and study material, chosen on first save for every note (New document already asks). Files saved today keep opening: they are recognised by content.
- **Choose which pages to export**: this page, a range, a list or every page, for SVG, PDF and images.
- **Repositories** as a library source next to Google Drive: GitHub repositories with notes, files and solved exams, browsed from Home.
- **Infinite canvas** in `.notecomplete`, split into sheets of up to Noteful's maximum page size when saved as `.noteful`.

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
| `skills/` | Claude Code skills that came out of this project ([polished-apps](skills/polished-apps/SKILL.md): how apps like this one are built) |

Development procedure and architecture: [DEVELOPMENT.md](DEVELOPMENT.md).
