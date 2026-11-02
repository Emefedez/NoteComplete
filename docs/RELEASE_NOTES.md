## What's new in 1.1.19

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
