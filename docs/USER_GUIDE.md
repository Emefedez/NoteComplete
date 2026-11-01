# User guide

## Open and navigate

Choose **Open document** in the hamburger menu or drop a `.noteful`, `.nfedit`, PDF, PNG, JPEG or WebP file into the reader. PDF pages scroll continuously; the Pages panel shows previews. The UI is English; note content, saved layer names and recording names retain their original text. Pages scroll continuously and only nearby pages render. **Page** jumps to a page. **Fit** adapts its width; **− / +** change zoom by ten percentage points, from 10% to 400%.

The toolbar compacts when scrolling down and returns when scrolling up. Its arrow provides a manual override. On phones, compact mode keeps playback and seeking available while hiding secondary controls. In a narrow window or on a phone, the menus, the tools and the page row scroll sideways when they do not fit (swipe, or use the mouse wheel over them); a faded edge shows there is more. The phone page row keeps dark pages and **Fit**; the zoom steps are in **View**.

Press **?** (outside a text box) to show each button's key on the button itself; press it again to hide them. **Help → Keyboard shortcuts** lists every key, Ctrl ones included. The moon next to **Pages** (**D**) is a night view: white paper turns black and dark ink light, colours keep their hue (red ink stays red), also in the page previews and while drawing. It only changes the display. The three buttons beside the zoom place the pages on the left, in the middle or on the right when they are narrower than the window; the button next to them leaves the pages wherever you scroll them. **Ctrl+F** opens Find and closes it again. Choosing a tool opens its settings under it; press the tool again to hide or show them. **View → Auto-open tool settings** turns the automatic opening off; the arrow at the end of the toolbar hides or shows the settings too. The floppy disk beside the note title shows whether the project is saved: a dot means unsaved changes, and clicking it saves (**Ctrl S**).

## Study with your AI tool

Study and Ask AI use an AI tool already installed and signed in on your computer (Claude Code, Antigravity, Codex or OpenCode) and run in the desktop app. Pages are sent as images with tape lifted, together with their typed, PDF, recognized and transcript text.

- **Study → Quiz me (Shift+Q)** generates multiple-choice questions in the background; the chip in the bar shows progress and has Stop. Quizzes are saved with the note: **Q** resumes the latest, **Study → Saved decks and quizzes (Shift+D)** lists them, **Retake wrong answers (Shift+W)** gathers misses from all of them. In the quiz: 1–4 answer, **H** shows the region of your notes that answers it (a correct answer is then worth 1 point instead of 2), **C** asks the AI to clarify, **X** twice disputes a question that is wrong, **V** asks the AI to double check and lets you save the correct answer yourself, **Enter** next, **M** minimizes. **Edit quiz instructions…** changes what the AI is asked for.
- **Study → Generate flashcards (Shift+C)** makes a deck shown as cards, question over answer. Click a card to edit it in place (Esc or Ctrl+Enter to finish); the page badge shows its page and ✕ deletes it. Lists the AI writes on one line ("1) … 2) …") are put one item per line. **Practise** flips cards in a fixed-size card: **Space** shows the answer, **1** not yet, **2** I knew it. **Export to Anki…** keeps line breaks.
- **Ask AI (Ctrl+J)** answers questions about the page, a selected item, or a region grabbed with the **Grab** tool (**G**), which can also copy the text of a region.
- **Help → Connect AI tools…** lets those tools work with your notes outside the app too (summary pages written in handwriting, clean copies, grading a quiz, flashcards). NoteComplete comes with the note server they use; **Connect** registers it with each installed tool, and *Run it yourself* shows the command instead. The desktop app offers this once by itself when it finds a tool that is not connected. Restart the tool afterwards. See [AI agents](MCP.md).

## Tape and locked items

Tape (Noteful's *Cinta*) hides parts of a page, typically answers. In Pan mode, tap a tape to lift it and tap again to cover; **View → Lift all tape / Cover with all tape / Tape as saved** applies to the whole note. Tape state is a viewing choice and is not saved. Items locked in place in Noteful cannot be selected, moved or erased. Zoom with <kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>−</kbd>, and <kbd>Ctrl</kbd>+<kbd>0</kbd> fits the page; this works on any keyboard layout.

## Infinite canvas

**File → New document… → Canvas** makes one page that grows as you write. When ink, a picture or a text box comes near its right or bottom edge, the page gets bigger, and the view stays where it is. Undo removes the stroke first and then the growth. A canvas is saved as `.notecomp` or `.notepart` (or a project). It is never a `.noteful` file, because Noteful has no infinite page: the Noteful format and the NF exports are off for it. Pages cannot be inserted into a canvas. PDF, SVG and image exports show it as one large page.

## Insert pages

Scroll past the last page and **New page** adds a blank page the size of the last one (one Undo takes it away).

**Pages → Insert blank page…** adds white pages after or before the current page, or at the end: the same size as the current page, A4 or Letter in either orientation, 4:3 or 16:9 slides, or a custom size in millimetres. **Pages → Insert PDF pages…** adds a range of pages from another PDF at the note's own scale; *Extra writing space* makes those pages wider (or taller) with blank paper beside the PDF, like widened pages in Noteful. Each insertion is one undo step, and ink drawn earlier stays on its page. Inserted pages are kept in the project and in native `.noteful` exports (experimental, like all native export).

## Handwriting from Markdown

**File → New from Markdown…** writes Markdown as real handwriting: pen and highlighter strokes on dotted, squared, ruled or blank paper, that you can erase, recolour and move here and in Noteful. **Pages → Insert handwritten pages…** adds such pages to the open note. The dialog shows a live preview; choose *Study notes* (titles, coloured sections, cards, columns, colour zones, sticky notes, diagrams) or *Plain notebook*, an ivory or black page, the handwriting, how neat it is, and a fineliner or a ballpoint with pressure. Opening a Markdown file first fills the dialog with it. The syntax (titles with `#`, `**term**`, `==highlight==`, `> [sky] CARD: text`, `!columns`, `!zone`, `!sticky`, `!stat`, SVG drawings with `!draw`) is listed in the dialog and in [AI agents](MCP.md#handwriting-markdown). Export the result as usual (PDF, images, `.noteful`). From a terminal, `noteful convert notes.md -o notes.noteful` does the same, and `--export pdf|png|svg` writes the pages directly.

## Audio

The headphones button next to Layers (**A**) opens the recordings in a side panel that resizes from its left edge, bottom edge or corner: play/pause (**K**), back and forward 10 s (**J**, **L**), seek, go to the page where the recording starts (**Shift+A**), dim ink not yet written at this point (**I**, off by default), and download the recording. The transcript follows the audio, and **Edit** lets you correct words while keeping their timing. Corrections are used by Find and the AI.

**Transcribe** offers the engines found on this computer:
- **Whisper on this device** (choose the model and language). Runs in the reader; the model downloads once.
- **Voxtype** (desktop app, when `voxtype` and `ffmpeg` are installed): local whisper.cpp, in 30-second pieces.
- **Gemini via Antigravity** (desktop app, when Antigravity is installed and signed in): ten-minute pieces, three at a time. The audio is sent to Google.

A transcript made earlier for the selected recording and engine appears on its own, with **Export**. **Revise with AI** (desktop app) lets your AI tool correct misheard words, terms and punctuation; every word keeps its time, and **Undo revision** brings back the automatic text. A quick local Voxtype pass followed by a revision is a good combination. The sliders button beside the dim-ink button holds gain, voice filter and normalize for transcription.

Text appears while it is transcribed, greyed until the timings are final. Transcription runs in the background with a chip in the bar: switching recordings or closing the panel does not stop it, only **Cancel** or the chip's Stop does. Export the transcript as text, SRT, WebVTT or JSON with word times.

## Sort and filter notes

On Home, **Sort** orders Recent and Drive notes A–Z (default), by date or by size. The switch beside it shows notes as cards with covers or as a quick list that reads nothing from the files, for when you only want the list fast. The chips filter by modification date, notes with audio, size and Noteful tags. Filters stack, and selecting several tags keeps notes that have all of them. Recordings and tags are read from each note without downloading it. Tags of very large notes appear once they have been opened.

## Remove a note

On Home, each Recent card has a **⋯** button in its top corner (or right-click the card). **Remove from this device** drops it from Recent; for Drive notes it also deletes the copy kept on this device, and Drive is not changed. If the note is open with unsaved changes, you can upload them to Drive first. **Also delete it in Google Drive** needs `DELETE` typed and moves the file to Drive's trash, where it can be restored for 30 days.

In the Drive section, **Back** returns to the view you had before the last search, filter or folder change.

## Find in a note

**Edit → Find…** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>, or type `find word` in the command palette) searches the open note's typed text, the text layer of its PDF pages, recognized text and recording transcripts. Matching ignores case and accents and accepts word beginnings (`memor` finds *memoria*). Recognized text and transcripts also accept one typing error in words of five letters or more, since recognition makes mistakes; for audio, try a couple of variants of the word. Enter/↓ and Shift+Enter/↑ step through matches, ☰ lists them by page with their source (Text, PDF, OCR, Audio), and highlights appear on the page. The source chips under the box limit the search to any combination of Text, PDF, OCR and Audio, with a count for each; the choice is remembered. Audio matches also seek the recording. The PDF text is indexed the first time you search a note and kept for next time.

**Pages → Recognize text (OCR)…** reads handwriting and scanned pages so Find can search them. Handwriting is read in a separate pass over the ink alone, so it is found on PDF pages too, even when their printed text is skipped. It never runs on its own: choose the current page, a page range or the whole note, pick the languages (Spanish and English by default) and start it. It runs on this device, about 5–10 seconds per page; the language data (a few MB per language) downloads once on first use. Pages that already have a PDF text layer are skipped unless you untick that option. It then runs in the background with a chip in the bar (progress and **Stop**), so the dialog can close and you can keep reading. Results are kept with the note, and Stop keeps the pages finished so far. Saving as `.notecomp`, `.notepart` or a project also writes them into the file, so the text comes with it to other devices and to AI tools connected to the note server (`page_text`, `search_note`). Recognition of handwriting is approximate.

**Tool row.** Drag the tool buttons to put them in the order you like; **View → Reset tool order** puts them back. The highlighter has three modes: straight, freehand and rectangle (drag a box).

**Notes in Markdown.** **View → Notes** (**N**) opens a panel beside the pages for your own notes in Markdown. Headings, bold, lists, code and links are formatted as you type; the toolbar above has the usual formatting buttons; **Preview** shows the result. **+ Page** inserts a page marker for the page you are reading: what follows belongs to that page, the marker jumps to it when clicked, and with **Follow** the notes scroll to the section of the page you turn to. Notes save themselves as you type (on this device, and in the project when you save it). **File → Export** has three buttons (hover for their full names): **NF** writes the .noteful file; **N+MD** writes it and a .md file with the page breaks spelled out; **NC** writes one .notecomp file with both, which NoteComplete opens with its notes (.notecomplete files open too).

**Ask AI answers** appear while they are written and are formatted (lists, tables, formulas). Under each answer, **T** puts its text in a text box on the current page, and **⧉** copies it. Drag the panel's top or bottom edge to change its height.

**Tabs (desktop).** Open several notes in one window: **+** in the top bar or **Ctrl+T** opens a tab, **Ctrl+Tab** switches, **Ctrl+W** or × closes (asking if there are unsaved changes), and tabs can be dragged to reorder. Each tab is independent.

**Page size.** **Pages → Page size…** changes the current page: extra writing space on the right or below, a standard size, the original size or a custom size in millimetres. Writing stays in place and the PDF keeps its size unless you choose to scale it to the new page. Undo restores the previous size. **Pages → Resize by dragging the borders** does the same by hand: drag the handle on the right edge, the bottom edge or the corner; the size in millimetres follows the pointer. **Done** or **Esc** hides the handles.

**Text boxes.** The Text tool (**W**) types a text box where you click; Enter starts a new line, **Ctrl+Enter** or a click outside finishes, **Esc** cancels. A format bar above the box sets the font, size, bold, italic and colour while you type; select a typed box with Select to change them later, or double-click it to type. Click a box you typed to edit it (emptying it removes it); move or resize it with Select. Text boxes are searchable and are exported as Noteful text.

**Lock in place.** The Lock tool (**O**) locks or unlocks the item you click. Locked items show a dashed outline and a padlock while the tool is chosen, and cannot be selected, moved or erased. Locks are undoable and saved in the project; on export an image's lock becomes Noteful's own (strokes and shapes keep theirs in the project only).

**Selecting text.** With the Pan tool, the cursor turns into a text cursor over printed PDF text and over recognized words; drag to select and press **Ctrl+C** to copy, line by line in reading order. Dragging anywhere else still moves the page.

## Share notes and draw on a tablet

In the desktop app, **Share** in the top bar (or **File → Share and draw on a tablet…**) starts sharing the note open in this tab with people and devices on the same network. Choose whether guests can edit the notes, only view them, or whether only drawing tablets join; **Start sharing** shows:

- **Drawing tablet**: a QR code, the computer's address and a 6-digit code (valid 10 minutes; **New code** makes another).
- **Notes invite**: a link (and its QR code) to send to people; **Copy link**.
- **People**: who joined, with **Remove**.

The connection is meant for a trusted network (home, school): it is not encrypted, and the invite holds a secret. Coloured chips beside the note's name show who is connected; the first one is you (click it to change your name), and clicking someone scrolls the notes to their cursor. **Sharing** next to them reopens the dialog; **Stop sharing** ends the session for everyone. Closing the window while people are connected asks first: **Minimize** keeps the session running, **End session and close** ends it after everyone has saved.

**Handwriting from Markdown.** **File → New from Markdown…** and **Pages → Insert handwritten pages…** write Markdown as real handwriting ink, with a preview. The dialog has two tabs for how you start, and both fill the same Markdown box, so you can always edit the result before creating the note:
- **From Markdown**: type or paste your Markdown, or **Open a Markdown file…**. In the desktop app, **Make it richer with AI** has your AI tool rewrite it with highlights, cards, colours and drawings while keeping what it says.
- **From a prompt** (desktop app; **File → New note with AI…** opens here): describe the topic (“the cardiac cycle for a first-year exam”) or paste data, notes or a text, and press **Write the note** (Ctrl Enter). The Markdown and the preview fill in as it writes; **Stop** cancels.

Choose the AI tool and model under the tabs. When the AI has written the note, the dialog shows it under **From Markdown**, ready to edit or make richer. **Undo** and **Redo** above the Markdown step through its versions: each AI write, opened file and pause in your typing. Handwriting written this way keeps its text: Find searches it at once (as OCR) without recognizing anything, also after saving as a project or `.notecomp` file. A `.noteful` export does not carry it, so run **Recognize text** on such a file.

While a session runs, Share reads *Sharing* and opens it again, with the people's initials beside it (in every window size, phones included). In a browser or on a phone, Share offers the two ways to join.

**Use a phone or tablet as a drawing tablet.** Scan the QR code with the device's camera (the note opens in its browser), or in NoteComplete on the device choose **File → Join as drawing tablet…** and type the address and code. The device shows only the note and a tool bar: pen, highlighter, shapes (with their kinds and fill while Shapes is chosen), eraser, move, colours, widths, undo, redo, fit, the ⇄ button that moves the bar to the other side, and disconnect. Zoom and scroll it as you like: the computer keeps its own view and tools. After the stylus has drawn once, fingers move the page and two fingers zoom. What you draw appears on the computer as you draw, and is saved there with the note: save or export on the computer. Undo on the tablet undoes the note's last edit, whoever made it. Opening another note on the computer opens it on the tablet too.

**Write shared notes.** Open the invite link in a browser, or use **File → Join shared notes…** and paste it. Type your name (or keep *Guest N*) and press Enter or **OK**. Everyone's cursors show in the notes with their names; Ctrl Z undoes only your own typing. When the host ends the session, your copy of the notes is saved as a Markdown file and **Open my copy** opens it. If the connection drops, NoteComplete reconnects and your edits merge; if the host stays unreachable, your copy is saved the same way.

**People on other networks.** In the sharing dialog, **Turn on online access** gives a second link that works from anywhere, through a temporary Cloudflare address. The first time, NoteComplete downloads Cloudflare's small `cloudflared` program (checked before it runs). The online link is for the notes only: drawing tablets stay on your network, and guests can edit or only view as you chose. **Turn off**, or stopping the session, ends it and disconnects the people who joined online. Cloudflare's free tunnels have no uptime guarantee.

**The device does not connect?**
- The device must be on the same Wi-Fi as the computer, and not on a guest network.
- If the computer also has a VPN, Docker or virtual machines, choose another address under the QR code.
- The computer must accept connections on TCP port 41237. It changes only when that port is taken.
  - On Windows, allow NoteComplete when the firewall asks.
  - On Fedora and other firewalld systems: `sudo firewall-cmd --add-port=41237/tcp`.
  - With ufw: `sudo ufw allow 41237/tcp`.

Not yet tried on real phones, tablets or styluses: see [Collaboration](COLLABORATION.md#not-yet-verified).

## Open from Google Drive

Choose **☰ → Google Drive** in the browser or an installed NoteComplete build, connect your account, find the Noteful folder and select a file to download and open. Subfolders, Refresh and paginated listings are supported. Local edits are never uploaded to Drive. Unsaved edits are checked before opening a downloaded document. See [Google Drive setup and platform support](GOOGLE_DRIVE.md).

## Display quality

Open **☰ → Display quality**. Choose **Performance** (1×, 4 MP/page), **Balanced** (2×, 12 MP/page), or **Sharp** (3×, 20 MP/page, slightly stronger contrast). Adjust any slider to customize the preset:

- **PDF resolution**: raster pixels per displayed pixel, from 1× to 3×. Vector ink remains sharp independently.
- **Page pixel budget**: 4–24 megapixels per PDF page. This caps resolution on large pages to control memory.
- **Page contrast / brightness**: tune the page and preview appearance; the sample updates inside the dialog.

**Apply** saves locally and redraws nearby PDF pages only when resolution changes. **Cancel** or Escape discards changes. Presets also restore their brightness and contrast. Original image detail cannot be recovered by increasing resolution. Exported colors and document edits are unaffected; these preferences are not saved inside projects. Thumbnails remain small bitmaps to keep long notes responsive. On a slow device, start with Performance and collapse the transcript when unused.

## Draw and edit

**Touch** (phones, tablets and touchscreen computers):
- One finger does what the tool does: it draws, selects and moves, or scrolls with Pan.
- Two fingers move the page and pinch to zoom; a second finger cancels a stroke the first one had just begun.
- Tap with two fingers to undo, and with three fingers to redo.
- Once a stylus has drawn on a device, one finger scrolls the page with drawing tools too, as in drawing apps. The stylus draws with its pressure, and the line keeps the width it had while you drew it.
- Long menus scroll inside the window.

| Tool | Behavior |
|---|---|
| Pan | Drag with a mouse or scroll with touch. |
| Select | Select existing ink, supported shapes, images or text placement; drag to move, use four corners to resize, or the upper handle to rotate. The inspector changes dimensions/angle and ink/shape stroke color and width. |
| Pen | Freehand ink. With a stylus that reports pressure, pressing harder draws wider (about a third of the width when light, 1.7× when firm); a mouse or finger draws the chosen width. |
| Highlight | Straight segment by default; choose Freehand for sampled ink. Multiply at 50% preserves the appearance over images. |
| Erase | Remove whole strokes and supported line objects the eraser touches; choose its size (small to extra large) in the tool settings. Other selected objects can be deleted with Select. |
| Image | Import PNG, JPEG or WebP onto the current page, then move or resize with Select. |
| Shapes | Draw a bounding box or use Insert for a line, rectangle, ellipse, triangle or arrow. Rectangles, ellipses and triangles can be filled: choose outline, tint (a pale fill in the pen colour) or solid in the shape settings, or press **F** to cycle. Resizing keeps the fill. In `.noteful` exports the fill becomes highlighter colouring under the outline. |

Arrow keys on selection handles adjust geometry; Shift uses larger steps. Right-click an element on the page to remove it directly; Ctrl/Cmd Z restores it. Undo/redo are global across pages (Ctrl/Cmd Z and Shift Z). Escape or a cancelled pointer gesture discards its unfinished preview. Text-content/font editing and separate shape fill-color editing are not currently provided.

**Layers** selects where to draw, creates/renames layers, controls visibility/opacity and locks them. Hidden or locked layers cannot be edited. New strokes inherit the selected layer.

## Audio details

Nonempty recording names are shown unchanged; otherwise the UI generates a recording number and date. Dimming shows strokes at 20% opacity before they were written and normally afterwards; seeking backwards restores dimming. This is whole-stroke timing, not point-by-point replay, and untimed ink remains visible. Each recording keeps its own playback position. Codec support varies by browser and device; **Download** remains available when playback is unsupported.

### On-device transcripts

With **Whisper on this device**, Whisper runs in a local WASM worker and detects
the spoken language when **Detect language** is selected. A progress bar shows
the model download and each transcription chunk while it runs. Castellano is the
default, with Galego and English available alongside other language options.
The model list offers Tiny (fastest), Base (default) or
Small (higher accuracy, more memory). Under **Audio for transcription**, gain and the voice filter affect playback
and transcription; normalization applies to transcription only. Processing never
overwrites the original recording. Changes take effect on the next transcription.
The cache distinguishes the model, language and audio settings.
The first run downloads model weights from Hugging Face; Whisper never uploads audio (only the Gemini engine does).
Downloaded weights are browser-cached when storage is available.

Words follow playback and clicking a word seeks the same clock used for timed
handwriting. Ink synchronization requires the note's original recording timestamps.
With **Pan** selected, click a timed stroke to seek its recording; dragging still
scrolls the page. The correct recording is selected automatically.
Automatic transcription and word boundaries can be inaccurate, especially for
noise or quiet speech. Processing speed and memory depend on the device.

Transcripts are cached by audio content in this browser on secure origins
(including localhost), separately for each engine.
They are not included in `.nfedit` or `.noteful` exports. On LAN HTTP without
SubtleCrypto, transcripts remain available for the session and can be exported.
Long transcripts display
100 words at a time, with section arrows and optional automatic following. Hidden
transcripts perform no word highlight updates. Speech workers terminate after
completion or cancellation; page thumbnails retain small bitmaps only.

## Save and export

- **Save project .nfedit** keeps unchanged source bytes, edits and undo/redo history.
- **Export .noteful** flattens applied edits into a new native archive. It is experimental; see [writer limitations](../spec/nfedit-v1.md#native-export).
- **Export page SVG** includes the rendered PDF background and current layers/audio appearance. Wait for the PDF page to finish rendering.

Files download as new files; originals are not overwritten. Replacing a dirty document prompts before discarding edits. Native export does not mark the richer project as saved. Fonts resolve from the device; Apple fonts are not bundled. Exact native ink smoothing, advanced text layout and some object variants remain incomplete.

## Mobile and Android file opening

The Expo wrapper uses SDK 57 and the same browser/WASM engine. Install dependencies and start it as shown in the [README](../README.md#expo-go). The launcher serves web assets on LAN port 8768 and Metro on 8081. It does not serve the original corpus. Files selected on the phone are not uploaded. A Metro tunnel alone does not expose the separate reader server.

Use an Expo Go client compatible with the SDK 57 dependencies pinned in this repository. See [mobile setup](../README.md#expo-go).

Installed Android builds include the reader and serve it on the device's loopback address, so no hosted website or computer is needed. To use a hosted reader instead, set `EXPO_PUBLIC_READER_URL` before starting or building the wrapper. The browser reader can also be installed to the home screen over HTTPS. Its application cache supports offline use after assets have been cached; opened notes are never stored in that cache.

Exports in the wrapper open the OS share sheet. Select Save to Files or another destination. Dismissing a share sheet does not prove a file was saved, so unsaved-change protection remains active. Large exports temporarily require base64 copies in memory; there is no fixed MB ceiling.

Android default-file handling requires an installed NoteComplete build. Expo Go cannot register this project's own file associations. See the Android build instructions below; default selection remains an Android/user decision. Physical-device URI permissions, file-manager behavior, codecs and sharing require device validation.

### Android installed build

The Android app ID is `com.notecomplete.viewer`. Its manifest registers ACTION_VIEW for `.noteful` file/content URIs, the `application/x-noteful` MIME type, and generic `application/octet-stream` content-provider files. The generic fallback is needed for providers that hide the filename; it can also offer NoteComplete for other binary files, which the decoder will reject if unsupported. Some file managers use other MIME types or do not offer persistent defaults.

For local builds or GitHub Actions APK artifacts, follow [Installable builds](BUILDS.md#android-apk). That guide covers the bundled reader, the optional hosted-reader override, preview signing and build prerequisites.

In Android Files, choose a `.noteful` file, select **Open with → NoteComplete**, then **Always** if offered. Android controls that choice; the application cannot silently make itself the default. A running app receives new file intents too. The file is read using the provider's URI grant, queued until the reader is ready, and passed to the normal local decoder. Existing unsaved edits still require confirmation before replacement. This is file opening, not an ACTION_SEND share target.

Manifest generation and JavaScript bridge tests are validated. No Android SDK/device was available on the development host for APK compilation or an actual default-handler test. Physical-device validation is still required, particularly with opaque `content://` URIs and different file managers.
