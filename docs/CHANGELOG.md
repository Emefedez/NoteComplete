# Changelog

Every version's changes before the latest one, newest first. The latest release's own notes are
in [RELEASE_NOTES.md](RELEASE_NOTES.md), which is the text of the GitHub release: when a new
version comes out, move that file's version section here and write the new one in its place.

## 1.1.63

- **Open with and Share, fixed.** On Linux the app now registers its file types and menu entry on launch, so `.noteful`, `.nfedit`, `.notecomp`, `.notecomplete` and `.notepart` open in NoteComplete by double-click.
- **Android lists NoteComplete in Share and Open with** for the generic types WhatsApp and file managers attach to files (octet-stream, zip, gzip).
- **`.tar` files open too**, since `.notecomplete` packages are tar archives: from the file picker, Open with, and Share.

## 1.1.62

- **Releases are published as the latest release.** Since 1.1.43 they were published as pre-releases, and the links on the website and in the README (`releases/latest`) skip those, so they still led to 1.1.42. The apps' own update check already looked at pre-releases too, and keeps working.
- **Recording says what it is waiting for.** *Record* shows *Waiting for the microphone* at once, explains after a few seconds how to allow it when no question appears (Safari on an iPad, a home screen app), and names the problem when it fails (blocked, no https, no microphone, in use by another app). A browser that rejects the raw-audio settings or the recorder's format is asked again without them, which Safari needed.
- **Shapes from the pen, **On lift**, made clearer and easier to trigger.** Holding the pen still now works in **On lift** as well (in that mode it did nothing, which made the setting look broken), so a stroke the lift test passes over can still be snapped by holding. The message after a lift says what happened (*Rectangle made from your stroke. Undo removes it*) instead of asking you to lift a pen that already has. The test on lift is a little less strict (tolerance 0.026 → 0.03, lines from 120 units instead of 150). Large, clean strokes only: a big O is still an ellipse. The choices say what they do: **Hold**, **On lift** (holding still works too) and **No shapes**.

## 1.1.60

- **Fixed: File → Export no longer crowds its row.** With NFE added the four formats did not fit the menu's 250 px, so the row was squeezed against the label; the File menu is wider on computers (300 px), and the Export, Pages as and Study as chips share one size and end at the same edge.

## 1.1.59

- **The same + in every ring.** Colours show the first three, **Any colour** and the **+** in the Pen, Highlighter, Shapes, Tape and Text rings; the shape kinds start with Rectangle, Ellipse and Triangle; the Pen's modes with pressure and shapes from the pen. The **+** is always last, and what unfolds comes after what is already there, in the same places, so nothing jumps when it opens. The Pen's and Text's rings stay at the base size, the Highlighter's and Shapes' shrink (112 → 101 px of radius). Dragging colours into a new order no longer drops the ones folded behind the **+**.
- **Tools centred in the compact tool bar on phones.** In a phone's tool bar the tools sit in the middle of their bar instead of from one end; if they do not all fit they still scroll from the start.

## 1.1.58

- **New default pen widths: 2, 4, 7 and 11 px** (they were 1, 2, 4 and 8). 4 px is the width that looks right beside Noteful's, so it is the second one and the pen starts at it; the finest is a little thicker and the two above rise gently. Widths you set yourself are kept; a pen still on the old defaults moves to the new ones.

## 1.1.57

- **A **+** in the quick menu opens the other choices.** The Shapes ring shows Rectangle, Ellipse and Triangle, and a tinted **+** (a control, not a choice) unfolds Line, Arrow, Star, **Graph** and **Table** in place; **−** folds them back, and the chosen shape always shows. The Highlighter's colours show three and a **+** for the rest, and the Pen's modes have **Pen smoothing** and **Pen hover preview** behind a **+**. The rings are smaller, and more can be added the same way.

## 1.1.56

- **Pen smoothing on or off.** **View → Pen smoothing**: off, the Pen and the free highlighter follow the pen exactly as it moves. Remembered on this device.
- **What a button does, on a phone or tablet too.** Press and hold an icon for a moment (or hold a pen over it) and its name appears, as the tooltip does with a mouse; that press does not also press the button. The quick menu keeps its own hold.
- **A fuller welcome notebook on the website.** New pages for drawing, calculation (math text boxes, graphs, tables), reading and finding, listening, and study, a corrected explanation of Online sharing (a temporary Cloudflare link, from the desktop app) and of the files, and more keys. Its notes follow each page.

## 1.1.55

- **Pen hover preview.** **View → Pen hover preview** shows a ring at the pen's tip, as wide and as coloured as the stroke it would draw (the eraser's size, dashed, for the eraser), while the pen hovers over a page with the Pen, Highlighter, Eraser or Tape. It is on by default on iPad and Mac with touch (an Apple Pencil shows nothing of its own) and off elsewhere: Samsung and other Android devices already draw a system-wide hover pointer. The choice is remembered per device.
- **Automatic saves are compared by content.** Each automatic save keeps a digest of what the note holds (its .noteful export), and a note opened from a .noteful is compared with it by content, not by undo history, so an automatic save that is the same note is no longer offered. Automatic saves made before this are compared as before.

## 1.1.54

- **Export from the ⋯ menu.** On a Recent note, ⋯ has an **Export** row (NF, N+MD, NFE, NC, PDF) that opens the note and exports it; Google Drive and Internet Archive cards have a ⋯ too, which downloads, opens and exports. The File menu's Export row gains **NFE**, the project (.nfedit) with its whole edit history.
- **Fixed: scrolling a menu with the wheel.** In a narrow window the menu bar scrolled sideways instead of the open menu scrolling down.
- **Fixed: "Delete history up to now".** The size it frees is at the right edge of the row.
- **Fewer recovery questions.** When the automatic save is byte for byte the note just opened, it is not offered.
- The File menu's export rows sit on the same centre line.

## 1.1.53

- **Ask AI and the card practice's AI bar, tidied.** Ask AI's title has the AI spark, New conversation and Close are icons, and what is sent with the question (page, selection, notes) is labelled **Send**. In card practice, the AI tool and model sit in a tinted bar with an AI tag, and the material chips (Page, Source PDF, Notes, Whole note) are on their own row under **Send**; Ask AI has the spark.

## 1.1.52

- **Fixed: the audio window's buttons now stay at the right edge.** Download, minimize, restore and close followed the title and left empty space beside them when the window was made wider; the title now takes the free room.

## 1.1.51

- **Arrow buttons look like the folders' Back.** The text arrows (transcript sections ← →, Find ↑ ↓ in notes and text documents, the web page's Back, Internet Archive's Back to repositories and Up) are round icon buttons on a light fill, with tooltips.
- **Transcript tools are icons.** Edit, Revise with AI, Undo revision and Export sit beside Transcribe as icons (the names show on hover). The audio window's right-hand icons sit as close together as the left-hand ones.
- **AI is set apart in quizzes and dialogs.** In a quiz, Explain (was Clarify), the saved Explanation and Double check form one tinted AI group, apart from Hint and Dispute; Export to Anki is an icon next to Next. In Generate flashcards, the AI tool and model sit in their own AI box.

## 1.1.50

- **Voxtype transcripts keep time with the audio.** Voxtype returns text for each 30-second piece without word times, and the words were spread evenly over the whole piece, so the highlight ran ahead or behind wherever the speaker paused or a piece began or ended in silence. The silent stretches are now found with ffmpeg and the words are placed only on the spoken parts, by length. Transcripts made before need **Shift-click on Transcribe** to be made again with this timing.
- **Audio window.** The transcript heading no longer shows as a lighter box, and the section arrows are proper buttons level with the range and the Follow audio switch.

## 1.1.49

- **Fixed: Restart after an update closed the app without reopening it.** The old window still held the app's single-instance lock, so the new one quit at once; the lock is now released first.
- **Fixed: the filter bar's background.** It is drawn in the page's own colour, with a thin line below, and sits flush at the top of the scroll area.

## 1.1.48

- **Smoother page dragging.** Moving the pages with the wheel button, a finger or the Pan tool writes the scroll position once per frame instead of for every pointer event, working out the current page takes two checks instead of a search through all pages, and changing page no longer walks the whole page list.

## 1.1.47

- **Recent's filters now work on Internet Archive too, and stay in view.** Type, Modified, Size and the sort apply to Internet Archive listings as well as Drive and Recent, and the filter bar stays at the top while you scroll down to the Cloud section.

## 1.1.46

- **Search all of Drive from inside a folder.** In the Google Drive browser, an **All Drive** button next to Search appears once you open a folder. Turn it on and the box finds folders and notes by name anywhere in your Drive, so you no longer have to find the folder first; Back returns to the folder you were in. Off, the box filters the open folder as before.

## 1.1.45

- **Tool bar on the left or right.** **View → Tool bar** puts the page row and the tools at the top (as before) or as two slim columns on the left or right, like the drawing tablet's dock, on computers, tablets and phones held sideways; a phone held sideways gets the pages' full height. The page row has a button for it too: it shows where the bar is and moves it on (top, left, right). Remembered on this device.

## 1.1.44

- **The quick menu has the tool bar's options.** The pen's ring has **Shapes from the pen** (tap it for Hold, On lift, Off), every tool with colours has **Any colour…** after its palette, the Shapes ring has its widths beside undo and redo (2 and 4 px shown, the others hidden at first), and **Lock in place** is among the tools (hidden at first: hold any tool to show it). On phones, where the tool bar's settings do not show, the quick menu was the only way to reach some of them.

## 1.1.43

- **Fixed: phones held sideways.** In landscape on a phone the menubar, tool bar and page row took almost half the screen, the page list stayed open beside the pages and the tool bar pushed the window wider, so the whole page was zoomed out. Now the page row and the tools share one row (tools as icons, scrolling sideways), the page list opens as a drawer, and the pages get the full width and about three quarters of the height.

## 1.1.42

- **Fixed: Ask AI's head in a narrow panel.** On phones (and in the panel's usual width) the AI tool and model lists had shrunk to their arrows beside the search and Small model; they now get a row of their own under the title and the window's buttons.

## 1.1.41

- **Fixed: the layout on phones and in the web app.** In 1.1.40 a broken tag in the shape picker put the page row and the pages inside the tool bar, so phones zoomed the whole page out. A test now checks that rows of buttons close every tag.
- **Updates on Android.** **Help → Check for updates…** now works in the Android app: it compares the app with the newest release, can look by itself when the app opens, and **Download** opens the new APK in the browser to install it over the app. Versions before 1.1.41 cannot check: install this one by hand once.

## 1.1.40

- **Choose what the quick menu shows.** Hold any item of the quick menu (or right-click it) for its settings: change a colour or width, **Hide from this menu**, or tap an item hidden from the same place to show it again. Remembered on this device.
- **A smaller Shapes menu.** Graph and Table start hidden in the quick menu (show them again from any shape's settings), and a crowded ring makes its items a little smaller instead of growing.
- **Tool bar without names:** **View → Tool names in the tool bar** off shows the tools as icons only.
- **Star before Graph and Table** among the shapes.

## 1.1.39

- **Tables.** **Edit → Insert table** (**Shift Y**) or the Shapes tool's **Table** (drag its box): type in a grid of cells, Tab and the arrows move, Tab in the last cell adds a row, and buttons add or delete rows and columns where the cursor is; a bold header row on a tinted band; `$…$` in a cell is math. Select the table to move or resize it, **Edit table…** to change it.
- **Graphs you can edit.** The graph editor has several functions in their own colours, the x range, y fitted to the curves or set by hand, grid and numbers on or off, and a live preview. Select any part of a graph to move the whole graph, **Edit graph…** to change it (one undo brings the old one back), Delete to remove it. Graph and Table are in the Shapes tool and the quick menu too.
- **Edit formulas in place.** A text box that is one formula is edited as a formula: tap a numerator or an exponent to change it, arrows move through it, Backspace removes whole pieces. The math keypad has ← → ↑ ↓; in boxes with words and `$…$` the arrows step over whole commands.
- **Less memory.** The dictation speech model is released two minutes after the last take, and the OCR word lists three minutes after recognition.

## 1.1.38

- **Shapes from the pen.** Draw a line, arrow, rectangle or square, ellipse or circle, triangle or star with the Pen and keep the pen still for a moment: it becomes a clean shape in the pen's colour and width, with all the usual handles (corners, turning, fill). Move before lifting to resize it. Shapes drawn at an angle keep their angle, and one undo removes them. The Pen's settings choose **hold** (default), **on lift** or **off**; **View → Shapes from the pen** turns it on or off.
- **Star** in the Shapes tool, with fill like rectangles, ellipses and triangles.
- **Math in text boxes.** The **∑** button in the format bar makes a text box LaTeX, typeset on the page (`\frac{a}{b}`, or `$…$` parts among words), with a live preview. A **math keypad** at the bottom of the window writes fractions, powers, roots, functions, Greek letters and calculus with the cursor in the right place (Tab goes to the next empty place); on phones and tablets it replaces the system keyboard. AI tools connected through the note server can write math text boxes too.
- **Graphs.** **Edit → Insert graph** (**Shift X**) puts axes and a grid to draw on; the keypad's graph key plots a function of x (`y = \sin x`, `\frac{1}{x}`…) on them. Every part is an ordinary item and one undo removes the graph.
- **Text from part of a recording.** The scissors in the audio panel (**Shift K**) choose a segment by dragging two handles, typing times or marking the playing position, and give only its text: at once from the transcript if there is one, otherwise by transcribing just that part. Copy it, add it to the notes or put it in a text box.
- **AI without installing anything.** The web version gets quizzes, flashcards, Ask AI and explanations from a model that runs in the browser on the graphics card (WebLLM, WebGPU); the desktop app offers it beside your AI tools. Models download once. Pages are read with the app's own handwriting recognition. A **Small model** checkbox beside every model list splits the work page by page (on by default for this model).
- **Text format bar in the tool bar:** **View → Text format bar in the tool bar** puts the font, size, style and colour controls in the tool bar's settings row instead of a bar over the box. The floating bar now stays inside narrow windows.
- **More keys:** Shift P page list, Shift G go to page, Shift I insert image, Shift B blank page, Shift O recognize text, Shift E export to Anki, Shift U lift or cover all tape, Shift X graph, Shift K text from part of a recording.
- **Model search everywhere:** the magnifier for long model lists is in the flashcards, quiz, explain and handwriting dialogs too.
- **Fixes:** the audio window keeps its buttons on one row as it is resized; tape stripes are drawn in a way Safari on iPhone and iPad handles.

## 1.1.37

- **One place for study material.** **Study → Share study material…** replaces the separate Send, Receive and Import items: its **Send** tab sends the note's flashcards, quizzes and notes (or saves a file), and its **Receive** tab shows the QR code and PIN for another NoteComplete to send you some (the desktop app), with **Import a file…**. In the web version, Receive offers the file, and explains that receiving live needs the desktop app.
- **The Online tab's links are set apart:** Guests, Tablets and Study material each have their own block and QR code, with a divider between them.
- **Sending from the web app** says why a plain network address cannot be used from an https page (the browser blocks it) and what to use instead: the other NoteComplete's online link, the desktop app, or a file.

## 1.1.36

- **QR code and PIN for receiving study material.** **Study → Receive study material…** shows a QR code and link (and the address and PIN) for another NoteComplete to send you flashcards, quizzes and notes; with online access on, a second link works from any network. Scan the code with a phone's camera and NoteComplete opens ready to send the newest note's material to that computer, or in **Send study material…** use **Scan its QR code** (browsers that can read QR codes) or type the address and PIN. The link only lets a device send: it cannot join the session as a guest or a tablet.
- **Notes beside text documents, and for guests.** A text or Markdown document now has a **Notes** button in its bar and **N** opens the Markdown notes beside it, as for HTML pages. In a shared session, guests can close and open the notes panel (button and **N**) instead of having it fixed open, and a guest viewing the host's shared text document gets the shared notes beside it.


## 1.1.35

- **Icons in the top menus.** File, Edit, View, Pages, Study and Help have an icon on each action, related actions grouped between rules, toggles and tools marked with a ✓ at the right edge, and shortcut keys in one column.
- **Joining a big note shows how far it is.** The tablet or guest sees the stages (the computer preparing the note, receiving it with megabytes, speed and time left, opening it) on a bar that fills, and the computer's bar shows who is receiving the note and how far ("Tablet · 43 %"). The note is sent in parts, compressed as it goes (above 32 MB with a fast setting that is four times quicker and 1% larger), so it no longer waits for the whole compression before the first byte.
- **Sharing keeps copies in step.** Every 10 seconds, if there were edits, every copy checks that it matches the computer's; one that drifted is reloaded and the computer says which. A connection that went quiet (Wi-Fi power saving, a link that dropped without telling anyone) is noticed within 30 seconds and resumed with only the missed edits.
- **Tildes, accents and dots keep their shape.** A small mark is followed more closely by the line and not rounded when the pen lifts (a tilde lost a third of its height before), and a stylus' pressure changes the width of a small mark less, so accents no longer turn into needles. Long strokes are smoothed and pressure-drawn as before.
- **Sharing a text or Markdown document shows its content.** Guests of a session see the host's open `.txt`, Markdown or converted file as text (read-only), and it follows the host's typing. Until now they saw nothing.
- **A new Sharing dialog.** **Local**, **Online** and **Fixes** tabs. Local has the address and a 6-digit PIN (with Copy, the time left, and New PIN) that now works for **guests as well as tablets**, plus copyable links with QR codes for the tablet and for notes guests. Online keeps the internet links. Fixes lists what to try when a device does not connect, with the firewall command and the choice of network address. **Join as drawing tablet** and **Join shared notes** both accept an address and PIN.
- **The highlighter looks final as you draw it.** It blends with what is under it (multiply) while it is drawn, as the page's render does, so the colour and the text under it no longer change when the render arrives (a live line differed from the final one on 1.7% of the pixels in a test; now none).
- **Folders:** the Back button is an icon at the right end of the folder's heading, and headings (Folders, Recent, Cloud) are centred on their arrow.
- **The Sharing dialog explains Tablets and Guests.** One address and PIN, then a section for each kind of device saying what it gets.
- **Highlight PDF text by dragging across it.** The highlighter has a new **Text** mode (in the tool bar's highlighter settings and in the hover menu): drag from one word to another and the words in between are highlighted, one band per line, as in a PDF reader; a click highlights a word. A multi-line selection is one undo step. The bands are the highlighter's own lines, so they can be moved, recoloured and erased like any other. On a page with no text (a scan) it draws a straight highlight and says so.
- **Send study material to another NoteComplete.** **Study → Send study material…** sends the open note's flashcard decks, quizzes and Markdown notes (your choice) to another NoteComplete that is sharing: type its address and PIN (same network) or paste its online link (any network, from the app or a browser). The other side is asked first; the material is added to the same note when it has it, else kept as a note of its own in **All quizzes and decks**. It can also be saved as a `.ncstudy` file and opened with **Study → Import study material…**.

## 1.1.34

- **Google Drive stays connected in new tabs.** The Drive sign-in is shared by every tab and window, so opening a tab no longer unlinks Drive; Disconnect applies to all of them.
- **Check Drive for a newer version.** The **⋯** menu of a Drive note in Recent can check Drive on demand. It always answers (up to date, not found, or not connected) and compares file contents, not only dates.
- **Fewer "which save?" questions.** Opening a note no longer asks between the automatic and manual save when they are the same, and a manual save no longer leads to an identical automatic copy.
- **Automatic save pills** in File have one size.
- **The ⋯ menu of a note** has an icon on each action, shorter labels, a darker outline and rules between groups; Drive's **Back**, **Refresh** and **Disconnect** are icons.
- **Filters are dropdowns.** On Home, Type, Modified, Source, Size and Tags are one dropdown each, with checkboxes (Modified takes one value), showing what is picked; Favourites and With audio stay as toggles.
- **Cut history.** The ⋯ menu of a project (.nfedit) in Recent has **Cut history…**, which opens it and deletes its whole undo history. Hovering ✂ in File → automatic saves says how much space the cut frees, and the confirmation says it too.
- **Text and Markdown documents stay in the page.** Long words and links break, code wraps, wide tables scroll in their own box and pictures shrink to fit. The folder ⋯ menu wraps long names and paths.
- **Edit Word, OpenDocument, Excel and CSV files as Markdown.** They open as Markdown as before, now with an **Edit** button. **Save** writes a copy (`Name.md`, or `Name (2).md`) beside the original and never changes it; saving again updates that copy.
- **Pictures.** Pictures in `.docx` and `.odt` files now show, kept in a `<name>_files` folder that the saved copy links to (a browser download is a `.zip` of both). Markdown files show pictures linked from beside them in the desktop app, and a missing picture shows its description.
- **Search models.** In Ask AI, a magnifier beside the model list opens a search box over the tool's models, for long lists such as OpenCode's.
- **Resize windows with Ctrl + right button.** Holding **Ctrl** and dragging with the right mouse button resizes Ask AI, quiz, flashcard and audio windows from the nearest corner (it was Shift + drag). Ctrl + drag still moves them.
- **New folder** is now a folder-with-plus icon, and the arrow beside **Recent** is centered with its title.

## 1.1.33

- **Resize all pages.** The **Page size** dialog has **Resize all pages** next to **Resize this page**: every page takes the chosen size in one step (space added and Original follow each page's own size), and one Undo restores them all.

## 1.1.32

- **AI fact check.** **Study → Fact check…** (**Shift+F**) has your AI tool check the current page, some pages or the whole note for errors, inconsistencies (also between pages), unclear and missing points. The findings, each with a correction, are added to your Markdown notes under each page's badge, with the pages that need nothing listed too.

## 1.1.31

- **Delete the edit history.** Projects (`.nfedit`) keep every edit for undo and grew without end. In **File**, ✂ beside an automatic save deletes the history up to that save, and **Delete history up to now** deletes all of it: strokes, pictures and text drawn and later erased go with all their edits, as do moves replaced by later ones and what was undone. The note stays exactly as it is (every page is checked to draw the same before anything changes), the file is smaller once saved, and undo stops at that point; later edits still undo.

## 1.1.30

- **High-quality recognition settles on real words.** Readings that are words count double in the vote between passes, and each word is then corrected as a spelling checker would: the reading, what other passes read there and words one or two changes away are weighed by how common they are and how likely the change (*ce* → *se*, *Lempo* → *tiempo*, *trabjndo* → *trabajando*). In our handwriting tests this reads 79 % of the words right instead of 72 % in a messy hand, and 56 % instead of 45 % in a harder one.
- **Every chosen language counts.** Word lists now cover English, French, German, Italian, Portuguese and Catalan too (all but Chinese), and a word of any chosen language is kept: English terms in Spanish notes are no longer "corrected".
- **Quick result first.** With high quality, a new option (on by default) reads every page as Normal first, so Find has the words at once, then runs the remaining passes and votes them together with that first reading instead of starting over.

## 1.1.29

- **Chinese text recognition.** Simplified and traditional Chinese are among the languages of **Pages → Recognize text**, and Find matches Chinese character by character (学习 is found wherever recognition split the line).
- **High-quality recognition.** A new **Quality → High** option reads each page more ways (larger, with thicker strokes, line by line and as scattered text) and lets the readings vote; in our tests with messy handwriting it reads three words in four right instead of half (normal quality improved too, to two in three), at about one and a half times the time.
- **Fewer misread Spanish words.** With Spanish chosen, misread words are corrected to the likeliest Spanish word a look-alike letter away (*procecador* → *procesador*), and missing accents come back (*direccion* → *dirección*). Real words, rare ones too, are never changed, and Find still finds what was read.
- Recognition no longer merges two different words of one reading, and words come out line by line in reading order.

## 1.1.28

- **Move and resize windows from anywhere.** As in a tiling window manager: hold **Ctrl** (**⌘** on a Mac) and drag anywhere on the Ask AI, quiz, flashcard or audio window to move it, or hold **Shift** and drag to resize it from the corner nearest the pointer. The new place and size are remembered.

## 1.1.27

- **Erase in the Grab menu.** Grab a region and choose the eraser icon to remove all the ink in it at once; one Undo brings it back.
- **The eraser removes shapes.** Rectangles, ellipses, triangles and arrows made in Noteful (such as highlighter circles and Δ marks) used to be skipped by the eraser; it removes them now, like strokes.
- **Resizing a group lands where the preview shows.** Resizing several items at once (for example boxes with highlighter behind them) moved each one away from where it was shown while dragging. They now stay as previewed, the ink keeps its look (thicker when enlarged, so a highlighter still covers what it covered), and the selection box stays around them.

## 1.1.26

- **A smaller Grab menu.** The buttons under a grabbed region are icons now (Select, Copy text, Ask AI, Add to chat, Cancel), with their names on hover, so the menu covers less of the page.

## 1.1.25

- **Open with, on every system.** NoteComplete appears in "Open with" menus on Windows, macOS, Linux, Android and the installed web app (Chrome, Edge, ChromeOS). It is the default for its own files (`.noteful`, `.nfedit`, `.notecomp`, `.notepart`); for PDFs, images, Markdown, text, HTML, Word, OpenDocument and spreadsheets it is only offered, and your default app stays as it is.
- On the desktop, files opened from the system open in a new tab of the open window and join Recent, so Save and Rename work as usual.
- On Android, files keep their own names instead of being renamed to `.noteful`, and NoteComplete accepts files shared from other apps. The installed web app accepts shared files too.

## 1.1.24

- **S Pen button closes the quick menu too**: pressed again while the pen hovers, it closes the menu it opened (holding it does not open it again).

## 1.1.23

- **Strokes no longer disappear while you write.** A finished stroke stays on screen until the page's new drawing shows it, whatever redraws the page in the meantime (someone else's edit, a zoom, the PDF image arriving).
- **Sharing: no more skipped strokes.** Someone else's stroke stays visible from its live line until it is drawn into the page, instead of vanishing for a moment, and their strokes that were still on the way are no longer dropped.

## 1.1.22

- **Hold the quick menu's ×** to show or hide the tool bar, like View → Tool bar (Shift + T). The menu stays open; a tap on the × still closes it.

## 1.1.21

- **Joining a shared note is several times faster.** In tests on a 5 Mbit/s link, a tablet's first join of a 3-page PDF note went from 15.9 s to 4.6 s and from 60 MB to 2.8 MB; joining again takes about 2 s.
  - The computer now compresses what it sends (the app and the note) and lets the device keep the app between sessions instead of downloading it again every time.
  - A device joining over the internet no longer downloads the speech and text-recognition engines (52 MB) while it joins; they come on first use.
  - The sharing address keeps the same port between sessions when it can.
  - A tablet or guest that loses the connection for a moment gets only the edits it missed, not the whole note again.

## 1.1.20

- **PDF pages stay visible when zoomed in.** Past a size many tablets cannot show (4096 px a side or 16 MP; the Xiaomi Pad 5, for example), a page's PDF was drawn on a canvas the browser left blank. Pages that large now show the PDF as a picture, which is shown in tiles.
- **Adding pages to a PDF note keeps the PDF on its pages.** Rebuilding the pages could let the old ones, still drawing, take a PDF picture away from the new ones.

## 1.1.19

- **The website shows its real version on Home.** The badge said v1.0.1 on the web; the version is now written in when the app is built, so the website, the desktop app and the pages a computer shares with guests and tablets all show the right one.

## 1.1.18

- **Open Word, OpenDocument, Excel and CSV files**:
  - Formats: `.docx`, `.odt`, `.xlsx`, `.ods`, `.csv` and `.tsv` open as Markdown, read-only, to read, search and study.
  - What comes through: headings, lists, tables, links, bold, italic and footnotes; pictures show as a placeholder.
  - Spreadsheets: each sheet becomes a table, the first 1000 rows and 50 columns.
  - Saving: *Save* downloads the Markdown and never touches the original. *File → New from Markdown…* turns it into a note.
  - The readers load only when such a file is opened.

## 1.1.17

- **Text no longer disappears when you finish it.** The typed text stays where it is, as typed, until the page's new drawing shows it. On PDF pages this used to leave a visible gap. It also holds for everyone in a sharing session, and an edited box no longer flashes its old text.
- **Sharing:** someone else's stroke on the same page no longer closes the text box you are typing in.

## 1.1.16

- **Drawing tablet: new page, tape and text.**
  - The tablet's dock gains **New page** (a blank page after the current one, the same size), **Tape** (with its colours, widths and strip or rectangle) and **Text**.
  - Tapping tape on the tablet lifts it there.
  - Each edit reaches the computer.
- **Text with a finger or pen** opens the box when you lift, and on phones and tablets the keyboard opens with it. The box scrolls above the keyboard while you type. Dragging with the Text tool moves the page.

## 1.1.15

- **Grab in the quick menu**, last on the ring (key 9). With Grab on, opening the menu (Shift + S, Shift + right-click, Shift + pen, the pen button, two fingers or a pen held still) never starts a grab, and a grabbed region and its menu stay as they were. **Select** from the menu turns a grabbed region into a selection, as the tool bar's Select does.
- **Choosing a tool in the quick menu no longer opens its settings in the tool bar**: the menu shows them itself.
- **iPad: two fingers held open the quick menu again.** Safari reports fingertips in sizes the app took for palms; fingers landing together, a lost touch end, and a Pencil hovering nearby also stopped it. Safari's own pinch is kept off the pages.

## 1.1.14

- **Guests: notes first, then the note, with each step shown.**
  - A guest's notes now stay the shared ones while the note loads (they were briefly replaced by the note's own).
  - The pages appear as soon as they are made, instead of after the first page's PDF is drawn.
  - A small bar shows *Connecting…* and *Loading the note…*.
- **The notes stay visible for guests** all session long, also when they can only read them.
- **View-only sessions**: a guest who tries to draw is told the note is shared view-only.

## 1.1.13

- **Guests can draw**: someone who joins a shared note now sees its pages and the tool bar, and draws on it (in sessions that allow editing). The pages and tools were hidden, leaving only the notes panel.
- **The ? beside Export and Save as** is a small blue circle right after the label, instead of a grey button below it.

## 1.1.12

- **Long notes are much lighter and faster.** On a 193-page PDF, scrolling through every page:
  - peaks at 414 MB instead of 1.2 GB;
  - is three times faster;
  - leaves 309 MB in use instead of 1 GB.

  Drawing on it takes half the work. Pages away from the screen let go of everything (their selectable text used to stay). A thumbnail is drawn when it comes into view and again only when its own page changes. PDF pages are drawn at the size the screen needs. Details and measurements: [PERFORMANCE.md](PERFORMANCE.md).
- **Writing on PDF pages with lots of ink** stays smooth: such pages show the PDF as a picture instead of a canvas.

## 1.1.11

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

## 1.1.10

- **Auto-save** (File menu, on by default): every minute while a note has changed, and when you leave the app, a copy goes into automatic slots on this device, never over your file. Each note keeps its last five, listed in File; **All automatic saves…** opens or deletes any of them. Opening a note with a newer automatic save asks whether to open the **automatic** or the **manual** save.
- **Auto-save when sharing**: the host's switch applies to everyone. A guest or tablet that is disconnected, or whose session ends, keeps an automatic save of the note and is offered to open it.
- **S Pen in Brave and Chrome**: these browsers drop the button press while the pen hovers, so it is now also caught when the pen comes back into hover range with the button held (lift the pen a little and bring it back). The pen test logs the pen entering and leaving hover range.

## 1.1.9

- **S Pen button in the browser** (Chrome, Brave and other Chromium browsers on Android): the quick menu now opens when you press the button while the pen **hovers**, or when you **hold it and tap** the page. Chromium reports the button only in those two ways, never while the pen touches the screen ([why](S-PEN-BUTTON.md)).
- **View → Pen button…**: press the button over a box once and NoteComplete learns what your pen sends in this browser. You can also let a pen held still open the menu, or turn the pen button off.
- On Samsung devices, turn off *Open Air command with pen button* (Settings → Advanced features → S Pen → Air command) so the button reaches the page.

## 1.1.8

- **Quick menu**: hovered and selected items no longer overlap their neighbours. The highlight stays inside each item, and a ring with many settings (Shapes) grows a little so its items keep a gap.

## 1.1.7

- **Quick menu**: smaller, and only as large as it needs to be. Tools without settings (Pan, Select…) get a small menu with no outer ring. It opens with **Shift + S** (instead of Z), opens and lifts much faster, and holding a tool to move it, or two fingers to open it, takes less time. The S Pen button opens it however Android reports it: pressed while hovering, while touching, or in the middle of a stroke, every time.
- **Help → Test pen and stylus**: shows what your pen reports (its type, buttons and pressure), to check its button and pressure.

## 1.1.6

- **Quick menu**: a ring of tools around your pen. Tap a tool to choose it, and its settings appear around it (colours, widths, pressure, modes, sizes, shapes and fill). Hold a tool to move it on the ring. Hold **Shift + S** and point, **Shift + pen**, press a pen's side button (S Pen, Wacom), or hold two fingers still on the page (iPad and touch screens). Safari does not give web pages the Apple Pencil Pro squeeze.
- **Keys and gestures page** in the welcome notebook, and two-finger hold, two- and three-finger taps listed in Help → Keyboard shortcuts.
- **Two-finger scrolling starts at once**: the movement made while it tells a scroll from a zoom now counts, so the pages move with the fingers from the start, as they do with Pan.
- **Rearranging the tools with a finger**: hold a tool until it lifts, then drag it along the bar; the bar scrolls when you reach its edge. A quick swipe still scrolls the bar. (Before, the bar's own scrolling took over the drag and stopped it.) Tabs work the same way.

Since 1.1.5: no waiting between Pencil strokes on iPad, the drawing tablet's loading screen, its dock along the long edge of the screen, and the pressure switch in the dock.
