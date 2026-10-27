# NoteComplete

**Your Noteful notebooks on the desktop, no Mac required.**

NoteComplete is an independent desktop and web companion for people who take notes in [Noteful](https://noteful.app) on an iPad. It opens `.noteful` notebooks on Linux, Windows, macOS, in a browser or on Android, so you can read, review and tidy up your notes from your computer while the iPad stays your notebook.

> NoteComplete is not affiliated with or endorsed by Noteful. It reads the format through independent reverse engineering; see [How it reads Noteful files](#how-it-reads-noteful-files).

## What it does

- **Read everything in a notebook**: PDF and paper backgrounds, handwriting, highlighter, shapes, images, typed text and recordings, including pages widened beyond their PDF and notebooks of hundreds of pages and recordings.
- **Your Google Drive library on Home**: connect read-only, open your Noteful backup folder once and it reopens next time. Notes appear as cards with their real covers, read with a few small requests instead of downloading each notebook.
- **Notes kept on this device**: opened notes are saved to a downloads folder you choose and reused until Drive has a newer version. Recent notes open instantly, even offline.
- **Fix things up**: pen, highlighter, eraser, shapes and images; move, resize and restyle existing items; layers; undo/redo. Edits are non-destructive: the original file is never changed.
- **Listen along**: play recordings with handwriting that appears as it was written, seek by tapping ink, and transcribe on-device with Whisper.
- **Feels like a desktop app**: a native-style File / Edit / View menubar that shrinks while you scroll, and a <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> command search (“page 12”, “export”, “highlight”).
- **Private by default**: everything is processed locally. Drive access is read-only; nothing is uploaded.

Coming next: text search across PDF text, on-demand handwriting OCR and transcripts; inserting pages with custom sizes or PDFs; flashcards and quizzes generated with your own Claude Code / Antigravity / Codex subscription; an MCP server for AI agents. See [next steps](DEVELOPMENT.md#next-steps).

## Get it

**Installers.** Tagged releases attach a Linux AppImage, macOS DMG/ZIP (Apple Silicon and Intel), a Windows installer and an Android APK preview. Builds are unsigned previews; see [builds](docs/BUILDS.md).

**Browser.** Build and serve the web app (below), then open it in any modern browser. It also installs as a PWA.

### Getting notes from the iPad

1. In Noteful, back up or export your notebooks to a Google Drive folder (or copy `.noteful` files to your computer any other way).
2. In NoteComplete choose **Connect Google Drive** on Home, allow read-only access, and open that folder. Or use **File → Open…** for a local `.noteful`, `.nfedit`, PDF or image.
3. Save your work with **File → Save project** (`.nfedit`, keeps the original plus your edits) or export a `.noteful` with **File → Export** (experimental: modified exports have not yet been verified in Noteful itself).

Drive setup for self-hosted builds (OAuth client, API key for public folder links) is in [Google Drive](docs/GOOGLE_DRIVE.md). Controls, audio and quality settings are in the [user guide](docs/USER_GUIDE.md).

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
