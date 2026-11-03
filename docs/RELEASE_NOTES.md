## What's new in 1.1.31

- **Delete the edit history.** Projects (`.nfedit`) keep every edit for undo and grew without end. In **File**, ✂ beside an automatic save deletes the history up to that save, and **Delete history up to now** deletes all of it: strokes, pictures and text drawn and later erased go with all their edits, as do moves replaced by later ones and what was undone. The note stays exactly as it is (every page is checked to draw the same before anything changes), the file is smaller once saved, and undo stops at that point; later edits still undo.

### In 1.1.30

- **High-quality recognition settles on real words.** Readings that are words count double in the vote between passes, and each word is then corrected as a spelling checker would: the reading, what other passes read there and words one or two changes away are weighed by how common they are and how likely the change (*ce* → *se*, *Lempo* → *tiempo*, *trabjndo* → *trabajando*). In our handwriting tests this reads 79 % of the words right instead of 72 % in a messy hand, and 56 % instead of 45 % in a harder one.
- **Every chosen language counts.** Word lists now cover English, French, German, Italian, Portuguese and Catalan too (all but Chinese), and a word of any chosen language is kept: English terms in Spanish notes are no longer "corrected".
- **Quick result first.** With high quality, a new option (on by default) reads every page as Normal first, so Find has the words at once, then runs the remaining passes and votes them together with that first reading instead of starting over.

### In 1.1.29

- **Chinese text recognition.** Simplified and traditional Chinese are among the languages of **Pages → Recognize text**, and Find matches Chinese character by character (学习 is found wherever recognition split the line).
- **High-quality recognition.** A new **Quality → High** option reads each page more ways (larger, with thicker strokes, line by line and as scattered text) and lets the readings vote; in our tests with messy handwriting it reads three words in four right instead of half (normal quality improved too, to two in three), at about one and a half times the time.
- **Fewer misread Spanish words.** With Spanish chosen, misread words are corrected to the likeliest Spanish word a look-alike letter away (*procecador* → *procesador*), and missing accents come back (*direccion* → *dirección*). Real words, rare ones too, are never changed, and Find still finds what was read.
- Recognition no longer merges two different words of one reading, and words come out line by line in reading order.

### In 1.1.28

- **Move and resize windows from anywhere.** As in a tiling window manager: hold **Ctrl** (**⌘** on a Mac) and drag anywhere on the Ask AI, quiz, flashcard or audio window to move it, or hold **Shift** and drag to resize it from the corner nearest the pointer. The new place and size are remembered.

### In 1.1.27

- **Erase in the Grab menu.** Grab a region and choose the eraser icon to remove all the ink in it at once; one Undo brings it back.
- **The eraser removes shapes.** Rectangles, ellipses, triangles and arrows made in Noteful (such as highlighter circles and Δ marks) used to be skipped by the eraser; it removes them now, like strokes.
- **Resizing a group lands where the preview shows.** Resizing several items at once (for example boxes with highlighter behind them) moved each one away from where it was shown while dragging. They now stay as previewed, the ink keeps its look (thicker when enlarged, so a highlighter still covers what it covered), and the selection box stays around them.

### In 1.1.26

- **A smaller Grab menu.** The buttons under a grabbed region are icons now (Select, Copy text, Ask AI, Add to chat, Cancel), with their names on hover, so the menu covers less of the page.

### In 1.1.25

- **Open with, on every system.** NoteComplete appears in "Open with" menus on Windows, macOS, Linux, Android and the installed web app (Chrome, Edge, ChromeOS). It is the default for its own files (`.noteful`, `.nfedit`, `.notecomp`, `.notepart`); for PDFs, images, Markdown, text, HTML, Word, OpenDocument and spreadsheets it is only offered, and your default app stays as it is.
- On the desktop, files opened from the system open in a new tab of the open window and join Recent, so Save and Rename work as usual.
- On Android, files keep their own names instead of being renamed to `.noteful`, and NoteComplete accepts files shared from other apps. The installed web app accepts shared files too.

### In 1.1.24

- **S Pen button closes the quick menu too**: pressed again while the pen hovers, it closes the menu it opened (holding it does not open it again).

### In 1.1.23

- **Strokes no longer disappear while you write.** A finished stroke stays on screen until the page's new drawing shows it, whatever redraws the page in the meantime (someone else's edit, a zoom, the PDF image arriving).
- **Sharing: no more skipped strokes.** Someone else's stroke stays visible from its live line until it is drawn into the page, instead of vanishing for a moment, and their strokes that were still on the way are no longer dropped.

### In 1.1.22

- **Hold the quick menu's ×** to show or hide the tool bar, like View → Tool bar (Shift + T). The menu stays open; a tap on the × still closes it.

### In 1.1.21

- **Joining a shared note is several times faster.** In tests on a 5 Mbit/s link, a tablet's first join of a 3-page PDF note went from 15.9 s to 4.6 s and from 60 MB to 2.8 MB; joining again takes about 2 s.
  - The computer now compresses what it sends (the app and the note) and lets the device keep the app between sessions instead of downloading it again every time.
  - A device joining over the internet no longer downloads the speech and text-recognition engines (52 MB) while it joins; they come on first use.
  - The sharing address keeps the same port between sessions when it can.
  - A tablet or guest that loses the connection for a moment gets only the edits it missed, not the whole note again.

### In 1.1.20

- **PDF pages stay visible when zoomed in.** Past a size many tablets cannot show (4096 px a side or 16 MP; the Xiaomi Pad 5, for example), a page's PDF was drawn on a canvas the browser left blank. Pages that large now show the PDF as a picture, which is shown in tiles.
- **Adding pages to a PDF note keeps the PDF on its pages.** Rebuilding the pages could let the old ones, still drawing, take a PDF picture away from the new ones.

### In 1.1.19

- **The website shows its real version on Home.** The badge said v1.0.1 on the web; the version is now written in when the app is built, so the website, the desktop app and the pages a computer shares with guests and tablets all show the right one.

### In 1.1.18

- **Open Word, OpenDocument, Excel and CSV files**:
  - Formats: `.docx`, `.odt`, `.xlsx`, `.ods`, `.csv` and `.tsv` open as Markdown, read-only, to read, search and study.
  - What comes through: headings, lists, tables, links, bold, italic and footnotes; pictures show as a placeholder.
  - Spreadsheets: each sheet becomes a table, the first 1000 rows and 50 columns.
  - Saving: *Save* downloads the Markdown and never touches the original. *File → New from Markdown…* turns it into a note.
  - The readers load only when such a file is opened.

### In 1.1.17

- **Text no longer disappears when you finish it.** The typed text stays where it is, as typed, until the page's new drawing shows it. On PDF pages this used to leave a visible gap. It also holds for everyone in a sharing session, and an edited box no longer flashes its old text.
- **Sharing:** someone else's stroke on the same page no longer closes the text box you are typing in.

### In 1.1.16

- **Drawing tablet: new page, tape and text.**
  - The tablet's dock gains **New page** (a blank page after the current one, the same size), **Tape** (with its colours, widths and strip or rectangle) and **Text**.
  - Tapping tape on the tablet lifts it there.
  - Each edit reaches the computer.
- **Text with a finger or pen** opens the box when you lift, and on phones and tablets the keyboard opens with it. The box scrolls above the keyboard while you type. Dragging with the Text tool moves the page.

### In 1.1.15

- **Grab in the quick menu**, last on the ring (key 9). With Grab on, opening the menu (Shift + S, Shift + right-click, Shift + pen, the pen button, two fingers or a pen held still) never starts a grab, and a grabbed region and its menu stay as they were. **Select** from the menu turns a grabbed region into a selection, as the tool bar's Select does.
- **Choosing a tool in the quick menu no longer opens its settings in the tool bar**: the menu shows them itself.
- **iPad: two fingers held open the quick menu again.** Safari reports fingertips in sizes the app took for palms; fingers landing together, a lost touch end, and a Pencil hovering nearby also stopped it. Safari's own pinch is kept off the pages.

### In 1.1.14

- **Guests: notes first, then the note, with each step shown.**
  - A guest's notes now stay the shared ones while the note loads (they were briefly replaced by the note's own).
  - The pages appear as soon as they are made, instead of after the first page's PDF is drawn.
  - A small bar shows *Connecting…* and *Loading the note…*.
- **The notes stay visible for guests** all session long, also when they can only read them.
- **View-only sessions**: a guest who tries to draw is told the note is shared view-only.

### In 1.1.13

- **Guests can draw**: someone who joins a shared note now sees its pages and the tool bar, and draws on it (in sessions that allow editing). The pages and tools were hidden, leaving only the notes panel.
- **The ? beside Export and Save as** is a small blue circle right after the label, instead of a grey button below it.

### In 1.1.12

- **Long notes are much lighter and faster.** On a 193-page PDF, scrolling through every page:
  - peaks at 414 MB instead of 1.2 GB;
  - is three times faster;
  - leaves 309 MB in use instead of 1 GB.

  Drawing on it takes half the work. Pages away from the screen let go of everything (their selectable text used to stay). A thumbnail is drawn when it comes into view and again only when its own page changes. PDF pages are drawn at the size the screen needs. Details and measurements: [PERFORMANCE.md](PERFORMANCE.md).
- **Writing on PDF pages with lots of ink** stays smooth: such pages show the PDF as a picture instead of a canvas.

### In 1.1.11

- **Quick menu, the same everywhere**:
  - Every tool's settings sit in the same places: colours across the top, from 12 o'clock and left to right; sizes along the bottom, from small on the left to large on the right; modes on the left; undo and redo on the right.
  - Hold a colour (or right-click it) to change it with the colour picker. Hold any colour or setting and drag it to reorder.
  - **Shift + right-click** opens the menu too.
- **Widths in px, your own**: each tool's widths (pen, highlighter, tape, shapes) are presets in the tool bar and in the quick menu. Hold one (or right-click it) to set it to any width from 0.5 to 100 px, with a slider and a preview; **Default widths** puts them back.
- **Tools remember their settings**: each tool comes back with the colour and width it was last used with, and the highlighter, tape and shape kinds are kept too.
- **Text boxes**: **Esc** now keeps what you typed. **Shift + Esc**, or the **×** at the box's corner, discards it.
- **View → Tool bar** (**Shift + T**) hides the row of tools for more room; the quick menu has them.
- **Two formats to save in**: a new note is a NoteComplete project (`.nfedit`, the default, also for canvases) or a Noteful file. `.notecomp` and Noteful + Markdown are exports, and a **?** beside *Save as* and *Export* explains each format. `.notecomp` and `.notepart` files keep opening.
- **S Pen**:
  - Holding the button and tapping never erases; it opens the menu every time a pen is in use on Android.
  - On iPad, the menu no longer opens by accident: a long press never opens it, and the two-finger hold ignores palms and the moment right after the Pencil.
  - Pen calibration shows live what the pen sends.

### In 1.1.10

- **Auto-save** (File menu, on by default): every minute while a note has changed, and when you leave the app, a copy goes into automatic slots on this device, never over your file. Each note keeps its last five, listed in File; **All automatic saves…** opens or deletes any of them. Opening a note with a newer automatic save asks whether to open the **automatic** or the **manual** save.
- **Auto-save when sharing**: the host's switch applies to everyone. A guest or tablet that is disconnected, or whose session ends, keeps an automatic save of the note and is offered to open it.
- **S Pen in Brave and Chrome**: these browsers drop the button press while the pen hovers, so it is now also caught when the pen comes back into hover range with the button held (lift the pen a little and bring it back). The pen test logs the pen entering and leaving hover range.

### In 1.1.9

- **S Pen button in the browser** (Chrome, Brave and other Chromium browsers on Android): the quick menu now opens when you press the button while the pen **hovers**, or when you **hold it and tap** the page. Chromium reports the button only in those two ways, never while the pen touches the screen ([why](S-PEN-BUTTON.md)).
- **View → Pen button…**: press the button over a box once and NoteComplete learns what your pen sends in this browser. You can also let a pen held still open the menu, or turn the pen button off.
- On Samsung devices, turn off *Open Air command with pen button* (Settings → Advanced features → S Pen → Air command) so the button reaches the page.

### In 1.1.8

- **Quick menu**: hovered and selected items no longer overlap their neighbours. The highlight stays inside each item, and a ring with many settings (Shapes) grows a little so its items keep a gap.

### In 1.1.7

- **Quick menu**: smaller, and only as large as it needs to be. Tools without settings (Pan, Select…) get a small menu with no outer ring. It opens with **Shift + S** (instead of Z), opens and lifts much faster, and holding a tool to move it, or two fingers to open it, takes less time. The S Pen button opens it however Android reports it: pressed while hovering, while touching, or in the middle of a stroke, every time.
- **Help → Test pen and stylus**: shows what your pen reports (its type, buttons and pressure), to check its button and pressure.

### In 1.1.6

- **Quick menu**: a ring of tools around your pen. Tap a tool to choose it, and its settings appear around it (colours, widths, pressure, modes, sizes, shapes and fill). Hold a tool to move it on the ring. Hold **Shift + S** and point, **Shift + pen**, press a pen's side button (S Pen, Wacom), or hold two fingers still on the page (iPad and touch screens). Safari does not give web pages the Apple Pencil Pro squeeze.
- **Keys and gestures page** in the welcome notebook, and two-finger hold, two- and three-finger taps listed in Help → Keyboard shortcuts.
- **Two-finger scrolling starts at once**: the movement made while it tells a scroll from a zoom now counts, so the pages move with the fingers from the start, as they do with Pan.
- **Rearranging the tools with a finger**: hold a tool until it lifts, then drag it along the bar; the bar scrolls when you reach its edge. A quick swipe still scrolls the bar. (Before, the bar's own scrolling took over the drag and stopped it.) Tabs work the same way.

Since 1.1.5: no waiting between Pencil strokes on iPad, the drawing tablet's loading screen, its dock along the long edge of the screen, and the pressure switch in the dock.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
