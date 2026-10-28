<p align="center"><img src="docs/images/banner.svg" alt="NoteComplete: your Noteful notebooks on the desktop, no Mac required" width="100%"></p>

# NoteComplete

**Your Noteful notebooks on the desktop, no Mac required.**

NoteComplete is an independent desktop and web companion for people who take notes in [Noteful](https://noteful.app) on an iPad. It opens `.noteful` notebooks on Linux (the main target today), Windows, macOS or in a browser, so you can read, review, search and study your notes from your computer while the iPad stays your notebook.

> NoteComplete is not affiliated with or endorsed by Noteful. It reads the format through independent reverse engineering; see [How it reads Noteful files](#how-it-reads-noteful-files).

<p align="center"><img src="docs/images/reader.png" alt="A notebook open in NoteComplete with the page list, the tools and the audio panel" width="100%"></p>

## What it does

### Read and annotate
- **Everything in a notebook**: PDF and paper backgrounds, handwriting, highlighter, shapes, images (cropped ones show only the part you kept), typed text, tape, locked items, tags and recordings, including widened pages and notebooks of hundreds of pages.
- **Fix things up**: pen, highlighter (straight, freehand or rectangle), eraser (four sizes), shapes, tape (strips or rectangles, with washi patterns), text boxes with a format bar (font, size, bold, italic, colour) and images; move, resize, restyle and lock items in place; layers; undo/redo. Drag the tool buttons into the order you like. **Crop images** in place: select one and press Crop (or double-click it), drag the frame, Enter to apply; the crop is saved the way Noteful stores it. Edits are non-destructive: the original file is never changed.
- **New documents** (<kbd>Ctrl</kbd>+<kbd>N</kbd>): blank pages of any size, saved as NoteComplete (`.notecomp`), NotePart (`.notepart`) or Noteful (`.noteful`).
- **Pages your way**: add blank pages of any size or pages from another PDF at the note's scale; resize any page from a menu or by dragging its borders, with the PDF kept in place.
- **Select and copy text** from PDFs and from recognized handwriting, straight from the page.
- **Night view** (<kbd>D</kbd>): white paper turns black and ink turns light, colours keep their hue. Pages can sit left, centred, right or wherever you leave them.
- **Export** from File, one row per kind: the note (Noteful, Noteful + Markdown, NoteComplete), **Pages as** SVG, PDF (every page as shown, made in the background) or IMG (JPEG, WebP or PNG), and **Study as** Anki (every flashcard deck and quiz of the note).

<p align="center"><img src="docs/images/night.png" alt="Night view: a handwritten exam page with black paper and light ink" width="100%"></p>

### Notes in Markdown
A **Notes** panel (<kbd>N</kbd>) sits beside the pages: Markdown that is formatted and coloured as you type, with a formatted preview. **+ Page** ties a section to the page you are on; clicking it jumps there, and the notes follow you as you turn pages. Notes are kept with each note on the device and saved in projects, and **Ask AI** can read them. A **Scratchpad** (View → Scratchpad…) keeps AI conversations you want with the note: press Scratchpad under any answer to keep the conversation up to there (pressing it again in the same conversation rewrites it), then add it to your notes when you like. Export the note on its own (.noteful), with its notes as a Markdown file whose page breaks are marked (.noteful + .md), or as one **.notecomp** file that holds both and opens in NoteComplete with its notes. The editor loads only when the panel is opened; rendering and the archive format are in the Rust core.

### Your library
- **Google Drive on Home**: connect read-only, open your Noteful backup folder once and it reopens next time. Notes appear as cards with their real covers, read with a few small requests instead of downloading each notebook, or as a quick list that reads nothing at all.
- **Filters and sorting**: by type (PDF, Noteful, NotePart, NoteComp, any mix), date, size, recordings and Noteful tags; natural A–Z order. Folders always stay visible.
- **Opens what you have**: `.noteful`, `.notepart`, `.notecomp` / `.notecomplete`, `.nfedit` projects, PDFs and images, from Drive or your computer.
- **Kept on this device**: opened notes are saved to a folder you choose. A note is never downloaded twice: Noteful backups upload unchanged notes again as new files, and NoteComplete recognises them by content.
- **Newer versions**: opening a Drive note from Recent checks Drive first. If the iPad saved a newer version, choose it, keep your copy, keep both, or **compare** them page by page side by side. Taking the new version offers to bring its flashcards, quizzes, Markdown notes and recordings along. When two files are the same note but weren't matched, **Migrate content to file…** in a note's ⋯ menu moves that material by hand, and can then remove the old file here, in Drive or both.

<p align="center"><img src="docs/images/home.png" alt="Home with recent notes, sort, view switch and filters" width="100%"></p>

### Find anything
One search (<kbd>Ctrl</kbd>+<kbd>F</kbd>) over typed text, PDF text, transcripts and recognized handwriting, limited to any mix of sources. Handwriting recognition runs on this device on request, in a separate pass over the ink, so it also works on PDF pages.

<p align="center"><img src="docs/images/find.png" alt="Find with source chips: Text, PDF, OCR and Audio" width="100%"></p>

### Listen along
Play recordings with the handwriting appearing as it was written, tap ink to seek, **record** new ones from the microphone (the headphones button lights up while recording) or **import** audio files into any note (kept with the note and inside `.notecomp` files), and transcribe with Whisper on the device, Voxtype (local whisper.cpp) or Gemini through Antigravity. Text appears while it is transcribed; your AI tool can then revise it while every word keeps its time. Export as text, SRT, WebVTT or JSON.

### Study with your AI subscription
Flashcards and quizzes are generated in the background by the AI tool you already use (Claude Code, Antigravity or Codex), from page images (tape lifted, so covered answers are readable) and the page text, covering each page evenly.
- **Quizzes** are saved and resumable, with a quiet progress bar in the window's head (green right, accent with the hint, red wrong). A hint (<kbd>H</kbd>) shows the part of your notes that answers the question (click it to see it large). **Clarify** (<kbd>C</kbd>) opens a box for your question (Enter alone asks for an explanation), answers right in the quiz and keeps the answer with the question, reopened later from **Explanation ▾** (never giving the answer away before you answer). **Dispute** (<kbd>X</kbd>) and **Double check** (<kbd>V</kbd>) let you question every answer, wrong answers can be retaken, and any quiz exports to Anki.
- **Flashcards** are practised in a window that floats beside your pages, with formulas (LaTeX) and lists rendered, and export to Anki. While practising, **Ask AI** (<kbd>C</kbd>) answers your question about a card using its page, the page's source PDF, your notes or the whole note, with the tool and model you pick; what it says is kept with the card (**Explanation ▾**) and you can edit it. Follow-up questions, from cards or quizzes, continue in the Ask AI panel with the whole conversation, and every answer there is still saved with the card or question. **Edit** (<kbd>E</kbd>), **Double check** (<kbd>V</kbd>) and **Discard** (<kbd>X</kbd>) fix a card on the spot.
- **Study material** (Study → All quizzes and decks…): every quiz and deck on this device in two lists under their documents, opened from there (the note first if needed) or exported to Anki; opened from a note it starts with that note's material.
- A sun in the quiz and flashcard windows **dims everything behind them** while you study.
- **Restart** a quiz with the circular arrow in its head (press twice: it clears your answers).
- The quiz and flashcard windows **grow to fit** the Ask box and the answer as it streams in, up to the screen's edges.
- **Paste images** (<kbd>Ctrl</kbd>+<kbd>V</kbd>) into any AI question (Ask AI, Clarify, flashcard Ask AI); they go with the question and into Ask AI if you continue there. In the Ask box, **↵** asks, the spark asks again and **×** closes.
- Links in AI answers work: a page link jumps to that page, an attached image opens large, a web link opens in your browser.
- **Ask AI** (<kbd>Ctrl</kbd>+<kbd>J</kbd>) answers questions about a page, a region you grab or your notes. Every question field has a **mic**: speak, and the words are typed in for you to edit before sending (transcribed on this device by default). The bundled MCP server lets agents read your notebooks directly ([AI agents](docs/MCP.md)).

<p align="center"><img src="docs/images/quiz-clarify.png" alt="Quiz window grown to fit a streamed Clarify answer, with the restart arrow in its head" width="49%"> <img src="docs/images/card-ask.png" alt="Flashcard window grown to fit an Ask AI answer" width="49%"></p>

<p align="center"><img src="docs/images/flashcards.png" alt="An example flashcard deck, question over answer" width="70%"></p>

### Feels like a desktop app
- **Light or dark**: View → Dark theme switches at once (or Ctrl+K → "theme"); by default it follows the system.

<p align="center"><img src="docs/images/quiz-clarify-light.png" alt="The light theme with a quiz window open" width="80%"></p>

- **Tabs and windows**: several notes in one window (<kbd>Ctrl</kbd>+<kbd>T</kbd>, drag to reorder); drag a tab out to give it a window of its own; opening the app again opens a new window.
- **Floating windows**: Ask AI, audio, quizzes and flashcards can be dragged anywhere below the top bar (over the toolbar and page list too) and resized from any edge or corner; **_** puts one away in a tray at the bottom left, **□** makes it small or large, **×** closes it.
- **Narrow windows and phones**: two bars at the bottom (page row with undo and the panels; one row of tools), and tools turn into icons before the toolbar would wrap.
- **Updates**: the desktop app checks for a new release when it opens and asks before installing; Linux AppImages update in place (checked against the release's checksums) and restart on request.
- A native-style File / Edit / View menubar that shrinks while you scroll, a <kbd>Ctrl</kbd>+<kbd>K</kbd> command search, single-key shortcuts for every tool, and <kbd>?</kbd> to show each button's key on the button itself.
- **Interface size** with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>−</kbd> / <kbd>+</kbd> / <kbd>0</kbd> (the page zoom stays on <kbd>Ctrl</kbd>+<kbd>−</kbd> / <kbd>+</kbd> / <kbd>0</kbd>). No spell-check underlines: notes are written in many languages.

<p align="center"><img src="docs/images/keys.png" alt="Key badges on the toolbar buttons after pressing ?" width="100%"></p>

**Private by default**: everything is processed locally. Drive access is read-only unless you choose to upload a change or delete a note there. AI features run through your own tools and send only what you choose (by default the page you are on); only Gemini transcription sends audio off the device.

Screenshots use the sample notes in [`samples/`](samples/).

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
