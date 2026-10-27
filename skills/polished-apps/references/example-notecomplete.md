# Worked example: NoteComplete

A real app built on these rules: a reader/editor for handwritten notes with PDFs, audio, OCR, search, and AI study tools (quizzes, flashcards, chat). Repository: `~/Documents/noteful-re` (GitHub `Emefedez/NoteComplete`). Use it to see how a rule looks when applied to a full app; copy patterns, not note-specific features.

## Where things are

| Rule | NoteComplete |
|---|---|
| Rust core, no UI/I/O | `crates/noteful-core/` (format decoding, scene, editing, export; `forbid(unsafe_code)`) |
| Adapters | `crates/noteful-cli/` (CLI + `noteful mcp`), `crates/noteful-wasm/` (bindings for the UI) |
| Web UI, one module per feature | `apps/reader/*.js` with `*.test.mjs` beside each (study.js, quiz.js, chat.js, find.js, jobs.js, tab-strip.js, command-palette.js…) |
| Tokens + components | top of `apps/reader/style.css` (`:root` tokens: `--control`, `--radius`, `--fill`, `--accent-soft`…) |
| Electron shell | `apps/desktop/main.js` (BaseWindow + WebContentsView tabs, `app://`-style protocol, guarded IPC), `tabs.js`, `preload.cjs` |
| AI through the user's CLIs | `apps/desktop/ai-runner.js` (Claude Code, Codex, Antigravity; streaming, cancel tags, PDF/image attachments, MCP) |
| Command palette | `apps/reader/command-palette.js`, palette built from menu items in `app.js` |
| Background jobs | `apps/reader/jobs.js` (job chip with phase, seconds, creeping progress, Stop) |
| Drag to reorder / drag out | `apps/reader/reorder.js` (tools and tabs), `tabs:detach` in `main.js` |
| Floating panels | quiz panel (`quiz.js`), flashcard practice (non-modal `dialog.floating`, draggable head, `study.js`), Ask AI side panel (`chat.js`) |
| AI review actions | quiz: Clarify C, Dispute X, Double check V; flashcards: Ask AI C (saved explanation, editable), Double check V, Edit E, Discard X |
| Requests log | `docs/REQUESTS.md` (✅/⚠️/⏳ + how each was checked) |

## Screens

- Top bar: home icon · File Edit View Pages Study Help · title or tabs · job chips · ✦ Ask AI · Commands Ctrl K.
- Toolbar: Pan Select Pen Highlight Erase Tape Grab Text Lock Shapes Image (icon + label, chosen = pale accent), undo/redo, layers.
- Context row: pages sidebar toggle, dark pages, page n of N, alignment, zoom.
- Workspace: pages sidebar (thumbnails, current one in the pale accent) | virtualized pages on `--canvas` | floating panels (find, Ask AI, audio, quiz, practice).
- No status bar; toasts and job chips.

## Decisions worth copying

- The document view was designed first as one piece; later dialogs drifted (solid blue buttons, pills, 12–14px radii, stacked labels). Fix: turn the view's measured values into tokens and replace values where they're defined.
- Pills kept only for tags, filters, job chips and the toast.
- AI requests send the minimum by default (the page image at 1400px + its text). The whole document (MCP) is opt-in: when it was always attached, tools explored other pages first and answers took much longer.
- AI explanations are stored with the item and reused, so they aren't paid for twice; the user can edit them.
- Practice and quiz panels float instead of being modal, so the source stays readable.
- New tabs/windows: backdrop colour + show after `dom-ready` (no white flash). Relaunch = new window.

## Bugs that taught a rule

| Bug | Rule |
|---|---|
| Closing a window threw "Object has been destroyed" | read `win.id` once at creation; never touch a destroyed window |
| Practice keys stopped after "Show answer" | hiding the focused button moves focus to `<body>`; route keys from the app's document handler |
| Ask AI "stuck" for minutes | don't attach the whole document by default; show elapsed seconds and Stop |
| Power measured as low while the window was on another workspace | hidden windows aren't drawn; measure on screen |
| Tabs captured their first window in a closure | look up a tab's window at event time |
