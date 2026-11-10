<!-- page 1 -->
# Welcome to NoteComplete

This tab is a NoteComplete note. Its pages are handwriting the app wrote from Markdown ([the source](https://github.com/Emefedez/NoteComplete/blob/main/docs/site/welcome.md)), and these are its **Markdown notes**, which follow you as you turn pages. Write on it, search it (Ctrl F), or start your own note in the **Home** tab.

## Download

- **All installers**: [latest release](https://github.com/Emefedez/NoteComplete/releases/latest)
  - Linux: AppImage (x86-64 and ARM64), updates itself
  - Windows: installer (.exe)
  - macOS: DMG or ZIP (Apple Silicon and Intel)
  - Android: APK, with **Help → Check for updates…**
- **iPhone and iPad**: this web app. In Safari, Share → *Add to Home Screen*.
- **Any browser**: you are using it. It works offline once loaded.

Builds are unsigned previews; Linux is the most tested.

<!-- page 2 -->
## Your notes and files

New notes are saved as a **project (`.nfedit`)**: the pages, every edit with its undo history, the Markdown notes and the text of your handwriting. **Save as** can also write a Noteful file (`.noteful`) for Noteful on the iPad. Everything else is an **Export**: `.notecomp` (the note, its notes and recordings, without the undo history), Noteful + Markdown, PDF, SVG, images, and Anki decks.

NoteComplete also opens PDFs, images, HTML, Markdown and text, and Word, OpenDocument, Excel and CSV files as Markdown you can edit (Save writes a copy beside the original).

- [User guide](https://github.com/Emefedez/NoteComplete/blob/main/docs/USER_GUIDE.md)
- [The file formats](https://github.com/Emefedez/NoteComplete/blob/main/docs/FILE-FORMATS.md) and [the .nfedit specification](https://github.com/Emefedez/NoteComplete/blob/main/spec/nfedit-v1.md)

<!-- page 3 -->
## Writing and drawing

The Pen, Highlighter, Eraser, Tape, Shapes, Text, Select and Grab tools share one **quick menu** (Shift S, a pen's side button, or two fingers held still). Hold an item in it for its colour, width or to hide it.

- **Shapes from the pen**: keep the pen still at the end of a line, arrow, rectangle, circle, triangle or star and it becomes a clean shape. It can be turned off or set to act when you lift.
- **Pen hover preview** (View menu) draws a ring where an Apple Pencil will write; it is off by default on Android because the system already shows a pointer.
- Pages can be inserted, resized (one or all) and added from a PDF; an **infinite canvas** has no page edges.
- [Draw and edit in the user guide](https://github.com/Emefedez/NoteComplete/blob/main/docs/USER_GUIDE.md#draw-and-edit)

<!-- page 4 -->
## Formulas, graphs and tables

- **Math text boxes** use LaTeX: `\frac{a}{b}`, `x^2`, `\sqrt{x}`, `\int`, or `$...$` between words. The keypad writes them and moves the cursor to the next empty place; arrows step over whole commands.
- **Graphs** plot `y = \sin x`, `\frac{1}{x}`, polynomials, roots, logarithms and absolute values, several at once. The graph editor sets the x range, fits or fixes y, and turns the grid and numbers on or off.
- **Tables** keep a bold header row, and `$...$` in a cell is math.
- **Fact check** looks for wrong calculations too.
- [Shapes, tables and math](https://github.com/Emefedez/NoteComplete/blob/main/docs/SHAPES-TABLES-MATH.md)

<!-- page 5 -->
## Reading, finding and your library

**Find** searches typed text, PDF text, handwriting that has been recognized (Pages → Recognize text) and transcripts. Recognition runs on this device and has a **High** quality setting that reads each page several ways.

On Home, notes can be filtered by type, date, source, size and tags, sorted, starred and put into folders. **Google Drive** and **Internet Archive** appear under *Cloud*: search names, queue downloads, and open or export from each file's menu.

- [Google Drive setup](https://github.com/Emefedez/NoteComplete/blob/main/docs/GOOGLE_DRIVE.md)

<!-- page 6 -->
## Study

Flashcards, quizzes, fact check and Ask AI use the AI tool you already have (Claude Code, Codex, Antigravity or OpenCode) on the desktop, or a model that runs in the browser on your graphics card in the web app. Study → *All quizzes and decks…* lists everything, and **Share study material…** sends it to another NoteComplete with a QR code and PIN, or as a file.

- [AI tools and the note server (MCP)](https://github.com/Emefedez/NoteComplete/blob/main/docs/MCP.md)
- [AI in the browser](https://github.com/Emefedez/NoteComplete/blob/main/docs/LOCAL-AI.md)

<!-- page 7 -->
## Audio and transcripts

Recordings belong to a note and play with its ink. Transcripts are made on this device (Whisper in the app and the browser, Voxtype on the desktop) and every word has a time. Edit words by hand or **Revise with AI**; the timings are kept.

<!-- page 8 -->
## Sharing and drawing tablets

Sharing starts in the desktop app (Share in the top bar). **Local** works on the same Wi-Fi: a QR code, a link, or a 6-digit PIN. **Online** is for other networks: the app opens a temporary Cloudflare link with no account, separate links for guests and for tablets, and it stops when you turn it off. A note shared from the web app cannot start one yet.

- [How sharing works](https://github.com/Emefedez/NoteComplete/blob/main/docs/COLLABORATION.md)

<!-- page 9 -->
## Keys

Help → Keyboard shortcuts lists every key. On a phone or tablet most tools are in the quick menu.

<!-- page 10 -->
## Source

- [Source code on GitHub](https://github.com/Emefedez/NoteComplete)
- [This notebook's Markdown](https://github.com/Emefedez/NoteComplete/blob/main/docs/site/welcome.md) and [these notes](https://github.com/Emefedez/NoteComplete/blob/main/docs/site/welcome-notes.md): the website rebuilds the notebook from them
- [Report a problem](https://github.com/Emefedez/NoteComplete/issues)
