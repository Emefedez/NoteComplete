# Requested changes (owner, 2026-10-27)

The owner's requests from the latest review, in one place, with how each was checked. ✅ done · ⚠️ done, not verified against the real service · ⏳ to do.

## Study: quizzes and flashcards
- ✅ Generated in the background with real progress: a bar chip shows the phase, elapsed time and continuous progress, with Stop. *Browser test with a fake AI bridge.*
- ✅ Quizzes saved per note and resumable (Q). Answers are stored as they are given. *Reopened the note and resumed at question 3 with the score kept.*
- ✅ The quiz panel floats over the pages and minimizes (M) to a pill, so the theory stays readable.
- ✅ Questions about content, not about worked-exercise solutions. Rare new exercises are marked **NUEVO EJERCICIO**. Options of similar length, shuffled locally. *Prompt checked by unit tests.*
- ✅ No explanations. The AI cites a page and box, and the hint is cut from that region at runtime. Scoring: 2 correct, 1 with the hint, 0 wrong. Falls back to the whole page.
- ✅ Clarify (C): asks the chat with that region attached.
- ✅ Dispute (X, press twice): the question stops counting, is left out of retakes, and new quizzes are told to avoid it.
- ✅ Double check (V): asks the AI again. The reply lands in an editable box with the options, and the correction is saved with the note's quizzes.
- ✅ Retake wrong answers (Shift W), gathered from all the note's quizzes.
- ✅ Editable quiz instructions, with Restore default.
- ✅ Keys: 1–4 answer, H hint, C clarify, X dispute, V double check, Enter next, M or Esc minimize.

## AI chat
- ✅ Ask AI in the Study menu as well as the bar (Ctrl+J).
- ✅ The chat panel resizes from its left edge; the width is remembered.
- ✅ Grab tool (G): drag a box to copy its PDF, OCR and typed text in reading order, or add it to the chat. *Copied a Temas1+2 paragraph in the browser.*

## Tools and layout
- ✅ Tool settings are rows of visual choices: highlighter mode, color swatches, widths, tape shape.
- ✅ Tool settings open under the pressed tool button. *Measured: same x as the button.*
- ✅ Rectangle tape (drag a box), besides strips. Tape has square ends and a washi stripe pattern, including Noteful's own tape.
- ✅ Pinch or Ctrl+wheel zooms towards the pointer: a CSS transform during the gesture, then one re-raster. *0 page re-renders mid-gesture.*
- ✅ Type a zoom percentage (or "fit") in the zoom box.
- ✅ Single-key shortcuts for tools, study, quiz and audio, listed in Help → Keyboard shortcuts (?).
- ✅ Audio and transcript in a side panel opened from the headphones icon next to Layers (A): play/pause icons, ±10 s, seek, show the handwriting, dim future ink, download the recording, transcribe with model and language choice, follow along, export, and edit words while keeping their timings (K, J, L).

## Files
- ✅ Remove a note from Recent and the downloads folder (× on its card).
- ⚠️ If it is the open note with unsaved changes, upload them to Drive first. Write access is asked for only then.
- ⚠️ "Also delete it in Google Drive": a red section that needs DELETE typed, and moves the file to Drive's trash, restorable for 30 days. *Both Drive writes are unit-tested against a fake server; they need a real sign-in to confirm.*
- ✅ Enter starts the Drive note search.
- ✅ Progress bar and percentage for Drive downloads.
- ✅ `tools/update_appimage.py` rebuilds everything and replaces the installed AppImage, keeping `.previous`.

## Audio and transcription (second round)
- ✅ Compact transport: square-rounded buttons in one row. "Go to where this recording starts" and "Dim ink not yet written" are two small icon buttons to the right of back/play/forward. The confusing "Show handwriting" label is gone.
- ✅ Dimming checked in the browser with the Practice book recording: all timed ink dimmed at 0 s, two of three strokes shown at 10 s, all shown with dimming off. *If it still looks wrong on one of your notes, tell me which note and page.*
- ✅ Transcription keeps running in the background: switching recordings or closing the panel no longer cancels it, and a bar chip shows its progress. Only Cancel stops it.
- ✅ Text appears while transcribing (greyed until timings are final): Whisper sends each 30 s window, other engines each piece.
- ✅ Engine choice: Whisper on this device; Voxtype (local whisper.cpp, 30 s pieces cut by ffmpeg); Gemini via Antigravity (cloud, 10-minute pieces three at a time, sends audio to Google). *The desktop pieces are tested with the real Voxtype and Antigravity CLIs.*
- ✅ Export as text, SRT, WebVTT or JSON with word times.
- ✅ The audio and Ask AI panels share one look and resize from the left edge, the bottom edge or the corner; sizes are remembered.

## Reader (second round)
- ✅ Dark pages (D, or the moon next to Pages): inverts the document's lightness, keeping hues, including the page previews. Presentation only.
- ✅ Find can be limited to any combination of Text, PDF, OCR and Audio, with a count per source.
- ✅ Recent cards: a ⋯ button in the card's top corner, always visible, opens a menu anchored to it (dropping up when there is no room below); right-clicking the card opens it too. It replaces the hover-only × and the centred dialog. *Removed a note and opened the menu by right-click in the browser.*
- ✅ Background-job chips and "Open …" buttons shrink with the compact bar and truncate on narrow windows.
- ✅ README with a header banner and screenshots (reader, night view, Home, Find, flashcards, key badges), all made from the sample notes in `samples/`.

## Flashcards and keys (third round)
- ✅ The practice card has a fixed size: showing the answer no longer resizes the dialog. *Measured: 513 px before and after every reveal.*
- ✅ Practice text is left-aligned inside a block centred in the card, so lines share one left edge; the hidden answer keeps its space, so the question does not move on reveal. *Question's left edge measured equal before and after.*
- ✅ Cards before export are shown as readable cards (question over answer, page badge, ✕), not two clipped textareas. Click a card to edit it in place with fields that grow to the text; Esc or Ctrl+Enter finishes.
- ✅ Answers keep the model's structure: the prompt asks for one list item per line, and inline enumerations ("1) … 2) … 3) …", "a) … b) …") are split one per line, also in decks saved earlier. Anki export keeps the breaks as `<br>`. *Unit test with the SECDED Hamming (8,4) answer: four lines.*
- ✅ Practice keys: Space shows the answer, 1 not yet, 2 I knew it.
- ✅ Decks deleted themselves when reopened from Study → Saved decks and quizzes. Cause: a style made each row's ✕ as wide as the open button, so the right half of every row deleted it at once. The saved list now has separate **Flashcard decks** and **Quizzes** sections; ✕ is a small separate button that asks "Delete …? Delete / Keep", and a deleted item can be restored with **Undo** until the dialog closes. *Browser test: Keep, Delete, Undo.*
- ✅ Your lost 50-card ACII deck was recovered from the app's storage log and saved as `~/Downloads/ACII-mazo-recuperado.json`; bring it back with the new **Import deck…** button in the same dialog (with the ACII note open). *Import tested: 50 cards.*
- ✅ **?** outside a text box toggles key badges on the buttons: tools, Ask AI, Layers, dark pages, audio transport, the new audio buttons (Shift A: go to the recording's page; I: dim ink), quiz minimize, practice. Labelled buttons show the key after the label, icon buttons a corner badge; Ctrl shortcuts stay in the menus. Help → Keyboard shortcuts still lists everything.

## Fourth round
- ✅ Recent empty with several windows open. Cause: launching NoteComplete again started a second process on the same profile, which cannot open its storage (Recent, decks, settings came up empty). The app is now single-instance: a second launch opens a new window in the running app. *Needs a restart of the installed app to take effect.*
- ✅ Thumbnails that never load (Discover Chinese, Memoria 1). The byte-range cover reader works on both (tested on the real files: 2 small reads each). Cause: covers still loading when you left Home were cancelled and the card was marked "no cover" for good; going back did not ask again. Cancelled or failed covers are now retried each time Home is shown, and a note whose Google thumbnail fails falls back to its own cover. *Unit-tested.*
- ⚠️ Drive Back after a search returns to the view before it. *Unit-tested; not yet checked against your real Drive.*
- ✅ Saved transcripts load when a recording is selected (with the panel open), so **Export** (text, SRT, WebVTT, JSON) is there without transcribing again.
- ✅ **Revise with AI**: after a fast local pass (Voxtype or Whisper), your AI tool corrects misheard words, terms and punctuation in parts of about 120 words; every corrected word keeps the time of the word it replaces. Replies that look like summaries are ignored. **Undo revision** brings back the automatic text. *Browser test with a fake AI.*
- ✅ Voxtype "Invalid UTF-8 detected in a string from Whisper": the selected language is now passed to Voxtype (`--language es`), a failing 30 s piece is cut in two and retried, and a part that still fails is left out (the status says how many) instead of stopping the whole transcription. *Tested with a fake Voxtype that fails like this one.*
- ✅ "Audio for transcription" is a small button with a chevron beside the dim-ink button; gain, voice filter and normalize open below the transport row.
- ✅ Everything that expands shows a small chevron that turns when open (transcript, connection setup, public link, fonts, Drive delete…). The File/Edit/View menubar keeps the native look.
- ✅ Handwriting is recognized on PDF pages: OCR now has a separate pass over the ink alone (PDF, images, typed text and highlighter removed, ink drawn black) at two sizes, merged with the page pass; other readings of the same word stay searchable. *Memoria 1 p. 130: "Sector" is found (read as "Sector" and "Sectov").*
- ✅ Night view (D) now really inverts the pages: white paper turns black and dark ink light, keeping hues (red ink stays red), including strokes while you draw. Cause of "nothing happens": the display-adjustment filter was "none", which made the dark filter invalid CSS.
- ✅ Ctrl+F closes the find bar when it is open, also from inside the box.
- ✅ Eraser sizes: small, medium, large, extra large, remembered; the cursor shows the size.
- ✅ Pages can sit on the left, in the middle or on the right when narrower than the window (three buttons in the page bar, remembered). The page bar is shorter (33 px).
- ✅ View → "Tool settings" was a vague toggle that collapsed the toolbar. It is now two checkable items: **Auto-open tool settings** (on by default; when off, press the selected tool again to see its settings) and **Compact toolbar**. Pressing the selected tool always shows or hides its settings. Open menus now sit above the tool settings popup.
- ✅ Quick list on Home: a Cards / List switch beside Sort. The list shows names, dates and sizes only; no covers are read and nothing is parsed from Drive files, so it appears as soon as Drive answers. Switching back to cards loads the covers. Filters by recordings or tags say they need the cards view. Remembered.
- ✅ The note title is centred on the window, also in the compact bar (it sat between the menus and the buttons, whose widths differ). *Measured: centre at 700 of 1400 px.*
- ✅ The Cards / List switch no longer stretches the filter row; the ⋯ on Recent cards sits small in the bottom-right corner.
- ✅ Free page position: a button beside the left / middle / right buttons leaves the pages wherever the trackpad puts them, sideways too, with no centring. Switching keeps the page where it is on screen. *Measured.*
- ✅ Dimming ink not yet written is off by default (I or the button turns it on).
- ✅ The chat's Ask button is centred beside the question box.
- ⚠️ Recent with several windows: one process now (single-instance), storage holds your 3 Recent notes, and two windows show Recent in the browser test, so I could not reproduce it. If Recent is missing again, a message now says why (storage error or no answer within 6 s) instead of hiding the section silently. Please tell me what it says.

## Fifth round (to do next)
- ⚠️ **Copy text** (Grab → Copy text) said "The clipboard is not available here" in the desktop app. Cause: the app denied every web permission, clipboard writes included. It now allows only writing text to the clipboard (never reading), and only from the reader's own pages. *Fixed in code; not yet checked in the desktop app.*
- ✅ **Lock / unlock tool** (Lock in the toolbar, **O**). Click an item to lock it in place; click again to unlock. While the tool is chosen, locked items show a dashed outline and a padlock. Locked items cannot be selected, moved, erased (eraser and right-click) or resized. As planned, it reuses the Adjust edit with an optional `locked` field, so it is undoable and saved in the project; Noteful's own locks (tag 21) can be lifted the same way. Native export writes the lock as tag 21 on images (and on objects that already carry it). Ink and shapes have no lock field in Noteful's format (other kinds use tag 21 for other values), so their lock stays in the project. *Core tests (lock, undo, reload, export → reopen locked → unlock → export); browser test: lock, select and erase refused, unlock, undo.*
- ✅ **OCR as a background task.** Recognize closes the dialog and runs as a bar chip (language download, page n of m, progress, Stop), like quizzes and transcription. Closing the dialog no longer stops it; reopening it while it runs says so. Pages done before Stop are kept. *Browser test on the scanned Examen page.*
- ✅ **View → Compact toolbar did nothing**: removed. It only hid the tool settings, which the arrow at the end of the toolbar and pressing the selected tool again already do; nothing made the toolbar itself smaller, and icon-only collapsing is what you asked to avoid.
- ✅ **Flashcards through Antigravity were slow.** Each part (6 pages) took about 30 s and they ran one after another, so all of *Memoria 1* (35 parts) took 20–35 minutes. Three parts now run at once, and pages for the next part are prepared while the others wait. The bar also sat near 0 % the whole time (it counted pages prepared before anything else); it now moves with every page prepared and every part answered, and says how many parts are done and running. Stopping a deck no longer stops the chat or a double check. *Browser test with a fake AI: 33 parts, 3 at a time, 31 s; runner tested with real parallel processes.*
- ✅ **Drawing made the PDF blink.** After each stroke every nearby page was redrawn, and each redraw removed the PDF image until it was fetched again. Now only the page you drew on is redrawn, and its PDF image is kept. On zoom, the old image stays until the sharper one is ready. *Measured: 0 of 229 frames without the PDF while drawing three strokes; 0 blank checks while zooming.*
- ✅ **Saved / unsaved** is a floppy disk beside the title instead of text: a dot means unsaved changes, and clicking it saves. The title stays centred.
- ✅ **Select and copy text with the cursor.** PDF text could not be selected either (only Grab copied it), so both now can: with the Pan tool the cursor becomes a text cursor over PDF words and recognized words, a drag selects them (instead of panning; dragging elsewhere still pans), and Ctrl+C copies them in reading order, one line per row. Where PDF text and OCR read the same spot, the PDF text is used. A right-click while text is selected no longer deletes the element under it. Words recognized in the background become selectable as soon as their page is done. *Browser test: 121 PDF words on Practice book p. 1, a two-line drag copied as two lines; 145 words on the scanned Examen page after OCR.*
- ✅ **Text input tool** (Text in the toolbar, **W**). Click on a page and type; Enter starts a new line, Ctrl+Enter or a click outside finishes, Esc cancels. The tool settings choose the size (small to title), bold and the color (the same swatches as the pen). Click a typed box again to edit it; Select moves, resizes and rotates it; it can be locked, removed and undone, and Find and the AI see its text. The box is typed exactly where the text will be drawn (measured: no shift on commit). Native export writes a Noteful text object copied from a real one (samples/texto.noteful); reopened, the same text, size, color, bold and place come back. *Core test with export → reopen; browser test: type, two lines, commit, re-edit, click outside, Esc, undo.* Text that came from Noteful can be moved but not yet edited.
- ⚠️ **Tabs in one window.** Several notes open as tabs in the top bar, in place of the title: + (or **Ctrl+T**, File → New tab) opens a tab on Home, × or a middle click closes one, drag to reorder, **Ctrl+Tab** / **Ctrl+Shift+Tab** (or Ctrl+PageDown/PageUp) switch, **Ctrl+W** closes the current tab. Many tabs scroll sideways (wheel). Unsaved tabs show a dot; closing one asks first, and closing the window lists what is unsaved. With one tab the bar looks as before, with a small + beside the title. Each tab is a reader of its own, so notes, edits, quizzes and transcriptions in different tabs never mix. A second launch opens a tab instead of a window; File → New window still opens a separate window, and Ctrl+K lists every open tab. *Tab strip tested in the browser; the window and tab code was run against a stand-in for Electron (17 checks: open, switch, reorder, close, unsaved prompts, palette, second launch). Not yet seen in the real desktop app: please try it.*
- ✅ **Resize a page** (Pages → Page size…), PDF or not: add writing space on the right (half or full width) or below, a standard size (A4, Letter, slides), the original size, or a custom size in mm. Writing stays where it is; the PDF keeps its size and place unless you tick "Scale the PDF to fill the new size" (then it fills the page as far as its proportions allow, centred). One undo step; saved in the project; native export writes the size and the PDF rectangle the way Noteful's own widened pages do. *Core test: resize, insert + resize, PDF fit, project, export → reopen with the same sizes and PDF rectangles, undo; browser test on the Examen PDF page.*

## Sixth round
- ✅ **Model dropdown** for Ask AI and Study instead of a text box: "Tool default", the models the chosen tool offers, and "Other…" for any name. Antigravity's list comes from the tool itself (`agy models`), so the chat and flashcards can use Google's models (Gemini 4 Argon, Gemini 3.8 Flash) as well as Claude and GPT-OSS through it; Claude Code offers Opus, Sonnet and Haiku; Codex offers the model in its settings. The choice is remembered per tool. Also fixed: opening Ask AI failed before the tool list was filled (a tool that is not installed made it throw). *Browser test with a fake bridge; the real lists were read from the installed tools.*

- ✅ **Resize pages by dragging their borders**: Pages → Resize by dragging the borders (or "Drag the borders instead" in the Page size dialog) puts handles on the current page's right edge, bottom edge and corner. A dashed frame and the size in mm follow the pointer; releasing resizes the page (one undo step), and the handles stay for further changes until Done or Esc. Only the right and bottom borders move, because writing is anchored to the top-left corner. *Browser test: right edge 210 → 268 mm wide, corner shrink, Esc.*

## Seventh round
- ✅ **Formatting text is now done on the text itself.** While you type, and whenever a typed text box is selected with Select, a format bar sits right above it: font (Sans, Serif, Mono, Handwriting), size, **B**, *I* and colour (swatches or any colour). Changes apply at once: live while typing, as one undoable change on a selected box. The last style you used is the one new boxes start with. Double-click a text box with Select to type in it. The Text tool no longer has a settings popup. Fonts and italic are exported to Noteful (the iPad fonts of the same names). *Core test (font, italic through export); browser test: bold and serif while typing without losing the cursor, recolour and resize a selected box, double-click to edit.*

- ✅ **Reorder the tool row** (Pan, Pen, Lock, … and Image): drag a button along the row; it lifts and follows the pointer while the others slide aside. The order is remembered; View → Reset tool order restores it. A drag never counts as a click.
- ✅ **Tab dragging** now works the same way (the tab moves with the pointer and the others make room) instead of lighting up the edge of the tab under it.
- ✅ **Rectangle highlighter**: Highlight has a third mode, Rectangle; drag a box and it is highlighted with square edges. Exported to Noteful as a highlighter band whose round ends stay inside the box. *Core test (square ends, export inset, project); browser test.*
- ✅ **"Text and fonts" bar removed** from the bottom of the page. It listed every text run with its size and font, a leftover inspection aid; a text box's font and size are shown in its format bar when selected.

## Eighth round
- ✅ **Markdown notes beside the pages** (View → Notes, **N**). A panel that docks like Layers (the pages make room; drag its left edge to resize). The editor is TinyMDE: Markdown is formatted and coloured as you type, with a formatting toolbar; **Preview** renders it with pulldown-cmark in the Rust core (raw HTML shown as text, unsafe links dropped). **+ Page** inserts a `<!-- page N -->` marker shown as a chip: click it to go to that page; **Follow** scrolls the notes to the current page's section. Notes autosave per note on the device and travel in projects (.nfedit version 5) and .notecomplete files. To keep the footprint small, the editor script loads only when the panel is first opened and is torn down when it closes.
- ✅ **Exports**: File → Export Noteful (.noteful), Export Noteful + Markdown (the .noteful plus a .md where each marker becomes a visible "Page N" break), Export NoteComplete (.notecomplete: a tar with manifest.json, note.noteful and notes.md, written and read by the Rust core with the `tar` crate). Opening a .notecomplete (or .notecomp) loads the note with its notes. *Core tests (rendering, safety, export text, archive round trip); browser test: lazy loading, formatting while typing, page chip, preview, close, export, reopen with notes.*
- ✅ **Notes toolbar buttons were nearly invisible** (TinyMDE's own fixed light greys, e.g. #f8f8f8 buttons with dark icons, on the dark theme). The buttons, dividers, code, link and marker colours now follow the app's theme in light and dark. *Checked in both.*
- ✅ **Export row**: File → Export is one row of three buttons, **NF** (Noteful), **N+MD** (Noteful + Markdown) and **NC** (NoteComplete), with each full name and description on hover; the command palette still lists them by full name. The NoteComplete file is now **.notecomp** by default (.notecomplete still opens).
- ✅ **OCR could not be stopped, and a new run started over.** Stop now ends the run at once (it had to wait for the page being read, which could hang); pages already recognized are kept after every page and skipped by the next run, so a stopped run continues where it left off (tick "Recognize again" to redo them). For long runs the recognition engine is restarted every 12 pages, so its memory does not keep growing. *Browser test: stopped during page 2 in 54 ms, the next run did only pages 2–3, a third run found everything done.*
- ✅ **README** has a "Notes in Markdown" section (and now mentions text boxes, locking, page resizing, tabs and text selection).

## Ninth round
- ✅ **Ask AI answers stream** as they are written (Claude Code's stream events and Antigravity's step updates; Codex gives its answer at the end). The bubble re-renders at most every 120 ms.
- ✅ **Answers render properly**: Markdown through the Rust renderer (lists, tables, code, headings, quotes) and formulas typeset with KaTeX (`$\rightarrow$` shows as an arrow). KaTeX loads only when an answer or note has math. The Notes preview typesets math too.
- ✅ **T under each answer** puts its text into a text box on the current page (lists keep their bullets, formulas become characters such as →, lines wrap to the page), selected so it can be dragged into place; ⧉ copies the text.
- ✅ **Resize Ask AI and the audio panel vertically**: drag the top edge, the bottom edge (now with a visible handle) or the corner. The audio panel's grips scrolled away with its content; it now scrolls inside, so they stay on the frame. *Browser test: chat top 112 → 234, height 633 → 410; audio height 633 → 482 after scrolling its content.*
- ✅ **The note's MCP tools now reach Antigravity too** (Codex already had them). Antigravity has no flag for it, so each request's temporary workspace carries a NoteComplete plugin (`.agents/plugins/notecomplete/`) with the server; your global Antigravity settings are not changed. *Checked with the real agy: it lists all seven notecomplete tools.*

## Tenth round
- ✅ **Closing a window no longer crashes** with "Object has been destroyed": the window's cleanup read its id after Electron had destroyed it. *Checked in the real app: closed through Hyprland, no error dialog.*
- ⏳ **High power draw**: not found yet. Idle and hidden, the app uses about 1% of a core, even with Memoria 1 (259 MB) open, and loading it takes a few seconds of CPU. Drawing on screen and scrolling are still to be measured with the window visible.
- ✅ **Correct flashcards while practising**, as quizzes allow. After Show answer: Edit (E) corrects the card yourself; Double check (V) has your AI tool check the card against its page (image and text) and puts its suggestion and reason in an editable box; Discard (X, press twice) removes a wrong card. Corrections save to the deck at once. *Browser test with a fake AI bridge: the request carries the card's page, the suggestion lands one item per line, saved and discarded cards are right in storage.*
- ✅ The practice keys (1, 2) work after Show answer again: hiding that button had moved focus out of the dialog.
- ✅ **One design language**: the viewer's look everywhere. 28px buttons with 6px corners, filled light buttons, the pale accent for chosen items and main actions (no solid blue), 8px dialogs and panels, wider dialogs with labels beside their fields, page scope as a row of choices, quiz options as filled rows. Pills stay for secondary things: tags, filters, the job chip, the toast. *Before/after screenshots of every dialog and panel, light and dark.*
- ✅ **Multiple windows**: launching the app again opens a new window (Ctrl+T and + still make tabs). Dragging a tab out of the strip moves it to a window of its own, still loaded, with its edits. *Stub-Electron test of the main process; browser test of the drag.* ⚠️ Not yet tried in the real app. Dropping a tab onto another window's strip is not supported; Wayland doesn't tell the app where the pointer is outside its own windows.
- ✅ **No white flash on new tabs or windows**: they paint the reader's own background colour (light or dark) and the new tab appears once it has drawn, while the previous one stays up.

## Home filters
- ✅ Stackable filters over Recent and Drive: modified date (today, week, month, year), with audio, size (under 10 MB, 10–100 MB, over 100 MB) and Noteful tags. All selected tags must be present.
- ✅ Sort: A–Z by default (natural order: "Tema 2" before "Tema 10"), or newest, oldest, largest, smallest. Drive folders stay on top.
- ✅ Recordings and tags are read with byte ranges, sharing the cover's head and tail reads, and kept per file version. Notes whose pages exceed 3 MB are marked "not yet read for tags" until opened once. *Browser test with four real notes on a simulated Drive.*
- ✅ Releasing a pinch no longer shifts the document: the page point under the pointer is kept (measured drift under 1 px).

## Format
- ✅ "7- ELECTRÓNICA DIGITAL Copiar 2": object kind 19 is a tag ("#SD I"). It renders as a pill and is searchable as text.

## Earlier in this review
- ✅ Tape (kind 3, tool 2) and lock in place (payload tag 21); tap to lift or cover tape.
- ✅ Compact tool row; Ctrl +/−/0 on any keyboard layout.
- ✅ Pages stay put when the bars change height.
- ✅ Shapes as an icon row; File → New window and window switching from Ctrl+K.
