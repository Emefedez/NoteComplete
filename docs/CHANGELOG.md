# Changelog

Every version's changes before the latest one, newest first. The latest release's own notes are
in [RELEASE_NOTES.md](RELEASE_NOTES.md), which is the text of the GitHub release: when a new
version comes out, move that file's version section here and write the new one in its place.

## 1.2.44

- **Animated algorithms.** **Insert prefab → Algorithms**: 69 algorithms, step by step, grouped by topic and named like "Greedy: Dijkstra" (recursion, trees and AVL, general trees, heaps, maps and hashing, graphs, greedy, backtracking, divide and conquer, dynamic programming, sorting), including every algorithm of the AED II activities. The player shows the structures as they change (graph, heap as tree and array, queue, priority queue, hash table with its buckets, map, set, tables, boards), the Java code with the current line, the variables, the call stack and what changed in each step; play, step, drag the timeline, change the speed. Give your own input (arrays, edge lists or a graph you draw, presets, random), and put any step on the page: its menu has Play…, Edit input… and Edit code….
- **Your own Java.** **New from Java…** runs a class you write, with the course's structures (Graph, Vertex, Map, Set, List, Queue, Stack, BinaryTree, Tree, BinaryMaxHeap) and java.util, step by step in the same player; errors show with their line when you press Run. Many built-in algorithms can also run their Java version, or open as Java code to change.

## 1.2.43

- **Colours by number.** With the Pen, Highlighter, Shapes or Tape, keys **1–9** pick the colour with that number (written inside each colour circle); with a text box selected they pick its colour. Digits still type in text boxes and fields, and they do nothing while a quiz or flashcards are in front.
- **Import, export and share by keyboard.** Export opens on **Notes**; **Tab** and **Shift Tab** move between Open & Import, Export: Notes and Export: Resources; **1–9** choose an item (its number is shown), arrows and Enter work too, Esc closes.
- **Coloured code.** Code blocks in Markdown (notes, documents, chat answers, study) are coloured by their language, with its name and a copy button; code files (.java, .c, .py, .sh, .js…) open coloured, and editing them indents for you (Tab, Shift Tab, Enter, closing brackets). About 35 languages, offline. The figure editors' JSON and the UML editor's PlantUML text are coloured too.
- **Goodnotes notebooks.** Ink is drawn over pictures, as in Goodnotes (handwriting over a pasted photo shows again), and strokes keep the order they were written in. Goodnotes and Notability notebooks get a cover in Recent: the notebook's own picture at once, then its first page.

## 1.2.42

- **Prefab modules.** Every prefab now comes from a module (a folder with `module.json`, a drawing and, if it wants, its own editor). On the desktop, **Insert prefab → Modules…** copies the app's modules to a folder of yours, uses a folder, or reloads it: add or change prefabs without a new version. They run with the app's rights, so add only modules you trust. How to write one: [PREFAB-MODULES-GUIDE.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/PREFAB-MODULES-GUIDE.md).
- **New prefabs: number line and truth table** (group Maths). Points, intervals with open or closed ends; truth tables from an expression (and, or, not, xor, →, ↔), with the result, a blank column to fill in, or none.
- **Graphs and tables in a movable window.** Their editors no longer cover the page: drag them by the title, resize them, and keep scrolling the note behind. They open where you left them.
- **Copy to other apps without losing anything.** Copying items also puts a picture of them on the clipboard for any app; the picture carries the items, so pasting, dropping or inserting it back into NoteComplete gives them back editable (on the desktop; in a browser, the picture only).
- **Open zip and tar files.** Open a .zip, .tar, .tar.gz or .gz to see what is inside, with each file checked (intact, damaged, encrypted), and open notes, PDFs, pictures and documents from it, or save one. A zipped Goodnotes notebook opens as the notebook; a zip with several notebooks opens as a group.
- **Copying PDF text.** Two columns copy one after the other, not mixed line by line; text a PDF draws twice (a fake bold) copies once; words split around ligatures, and spaced-out titles, copy as words.
- **Diagram editor by touch.** Two fingers zoom and move the view, never the selected element; one finger moves an element or the view.
- **Side lists.** The page list resizes from its edge and keeps its width; rows show the real format (PDF, PNG, Goodnotes…), use the space for the name, and a long name slides to its end when you point at it.
- **Fixes.** Copying a UML diagram fills the diagram editor's clipboard again.

## 1.2.41

- **Updates keep your documents open.** After **Restart now** for an update, the same windows and tabs open again, each on its document and page. Unsaved changes come back as they were (still unsaved), and so does a new note you never saved. Any other launch starts as before. This takes effect from the next update on.
- **Paste from other apps.** **Ctrl V** with a picture in the clipboard puts it on the page where the pointer is, selected so you can move it, with any tool, Edit PDF included. Plain text from another app becomes a text box there.
- **Edit PDF, easier to reach and to use.** **E** turns it on (the eraser moved to **B**), and its button sits next to the page list and dark pages. The text format bar never covers the text you are editing: it goes above the box, or below it, or into the tool bar when neither fits. Letter-spaced PDF text keeps its real spaces.
- **Text in front of ink.** A text box or picture you add after drawing is drawn over that ink, and ink drawn later goes over it. In Noteful too, with no extra size in the file.
- **Text size, typed.** The size in the text format bar is a field: type any number, or use the arrows inside it (or ↑ ↓).
- **Side panels from the keyboard.** **Ctrl B** hides or shows the notes, **Ctrl Alt B** the page list, and a small tab on the window's edge brings back a hidden one.
- **Full UML editor.** Every element and connector of every UML diagram in one editor, for a drawing that fits none of them. It is marked not recommended, since such a diagram exports only as a picture or a NoteComplete diagram.
- **Fixes.** Shortcuts and **Ctrl Z** work again after choosing a pen colour. For a selected image, Crop and Done are now icons and Done sits before Delete. The selection's ⋯ circle is the size of the corner handles, and the UML editor's delete icon is tidier.

## 1.2.40

- **Bold words stay bold in Edit PDF.** When you double-click a paragraph of a PDF, its bold, italic and coloured words keep their style, each in the PDF's own font (a bold word in the PDF's bold font). Before, the whole paragraph took one style.
- **Text boxes with styled parts.** A text box can have parts in another style (bold, italic, font, colour), and `.noteful` files keep them as Noteful's own styled text. Typing keeps them: new letters take the style of the letter before them. While you type, the box shows in one style, and the parts come back when you finish. Changing bold, italic, the font or the colour from the format bar applies it to the whole box.

## 1.2.39

- **Edit PDF.** A new **Edit PDF** tool, next to Text. On any page from a PDF (a PDF you opened, or PDF pages in a note), the PDF's text shows as outlined blocks. **Double-click** a block and it becomes a text box in the same place, size, colour and line spacing, ready to type in: in the PDF's own font when the PDF includes it with every letter, else the nearest of Sans, Serif or Mono. The PDF's copy of that text is removed from the page, so nothing shows through, and one undo puts it back. It also works after saving and reopening. Scans and PDFs whose letters are drawn as shapes have no text to edit, and it says so. For now a text box has one style, so bold or italic words inside a paragraph take the paragraph's style.
- **Move a PDF's images, drawings and fields.** In **Edit PDF**, images, drawings (lines and shapes that touch, such as a diagram or a table's rules), form fields and annotations are outlined in green. Double-click one and it becomes a picture in the same place, selected, so you can drag, resize or delete it; undo puts it back in the PDF. Drawings become pictures at high resolution, not editable lines.
- **Import fonts.** The text format bar's font menu ends with **Import font…**: choose a TTF, OTF, WOFF or WOFF2 file and it joins the menu on this device.
- **Comic Sans and Handwriting text always look the part.** Where those fonts are not installed (Linux, Android) the text fell back to a plain or random cursive face. NoteComplete now includes Comic Neue for them.
- **Text highlights cover the words.** Highlighting the text of a PDF placed each word by counting letters, so in most fonts the band started and ended a few letters off. Words are now measured in their own font.
- **Prefab editors take less room.** Lower toolbars, smaller buttons, panel headers on one line, and side panels you can drag wider or narrower (double-click the edge for the usual width). The **Insert prefab** list shows its cards as compact rows, and the process states and CPU timeline editors keep their long help in the **?** sheet instead of the side panel.
- **Ctrl + 1–9 switch tabs** (Cmd on a Mac): 1 to 8 by position, 9 the last one.
- **Messages.** The message at the bottom has rounded corners like the rest of the app, and clicking it copies its text.

## 1.2.38

- **PlantUML files use the whole window.** A `.puml` file open in the UML editor had a dark margin on both sides and at the bottom, and two toolbars stacked: the document's bar and the editor's. The editor's tools now sit in the document bar after the file name, in one row (on a narrow window it scrolls sideways). The editor's own zoom replaces the document's, and its messages float over the drawing instead of keeping an empty strip under it.
- **Middle-button drag moves the diagram.** Holding the mouse wheel and dragging pans a use case, class or package diagram in a `.puml` file, also over its elements. The document view caught the middle button first and tried to scroll itself, so nothing moved.

## 1.2.37

- **New note with AI, rebuilt like Create exam with AI.** **File → New note with AI…** now has **Documents to base it on**: the same picker as the exam (Recents, folders, Drive, local files, or the open note with a page range), so the note is written from your notes, PDFs or Office files instead of only a typed topic. Leave the request empty to write about the documents, and tick **Only facts from these documents** to keep the AI to them.
- **Choose the kind of note.** **Length** (one page, 1–2 pages, 3–5 pages or as long as needed), **Focus** (overview, exam prep, worked examples, formulas and methods, compare and contrast), **Level**, **Language**, whether to draw diagrams, and **Extra instructions**. The choices are remembered.
- **Continue writing.** If you stop the AI tool, it fails or you close the dialog half-way, what it wrote is kept: **Continue writing** picks up from there, as the exam generator does.
- **Save to a folder.** **Save to** (next to Create note) keeps the new note in Recent or one of your folders and opens it; **Not yet** opens it unsaved as before.
- **Tidier dialog.** Icons on the tabs, options and buttons, a close button, the look settings folded under **Page look**, and one main button at a time.

## 1.2.36

- **Package diagrams and PlantUML rendering toggle.** Package diagrams are now a diagram kind of their own in **Insert prefab**, the UML editor and `.puml` files (alongside class and use case diagrams). Inside the UML editor and opened `.puml` files, a new **PlantUML drawing** toggle switches between NoteComplete's editable visual diagram and PlantUML's own styled rendering (`!include` / `skinparam`).
- **PlantUML positioning kept everywhere.** The PlantUML code pane now keeps the `' notecomplete-layout` positioning comment, SVG arc paths on PlantUML packages and `GMN` notes are laid out at their real coordinates, and importing `.puml` inside the UML editor uses PlantUML's layout automatically.
- **Insert `.puml` into notes and cross-editor UML copy-paste.** Opened `.puml` files have **Insert into note…** to place them into your open, recent, or new notes (editable for class, package and use case diagrams; rendered picture for activity/sequence/state), **Insert prefab** has **Import .puml / diagram…**, and `Ctrl C` / `Ctrl V` shares UML selections and whole diagrams (with positioning) across `.puml` files, UML editors and note pages.

## 1.2.35

- **The editor choice in Insert prefab is readable.** The step after Insert on a class or use case diagram showed its icons at full size, which pushed the two editors out of view. Each editor now shows its icon small, with the drawing or the PlantUML code and its description underneath, as 1.2.34 intended.

## 1.2.34

- **Choosing the UML editor is a step of Insert prefab.** After you press Insert on a class or use case diagram, the dialog shows the two editors side by side, each with its description and a picture: the drawing for the visual editor, the code for PlantUML. **Back** returns to the list, and **Don't ask again** skips the step. If you turn it off, a chip next to the preview brings the step back. This replaces the pop-up menu.
- **PlantUML files open from the Open dialog.** The desktop Open dialog and the reader's file picker accept `.puml`, `.plantuml`, `.pu`, `.iuml` and `.wsd`.
- **Open with… for PlantUML.** The installers list NoteComplete as an option for PlantUML files, without making it the default.

## 1.2.33

- **Activity nodes look as in Visual Paradigm again.** In the palette, decision and merge are a plain diamond and fork and join a plain bar, without lines attached to a corner. As on the canvas, they are nodes you bring the flows to. The initial node keeps its larger dot.
- **Any arrow from a line.** Right-click a connector to change its type, the head at each end (none, open or filled arrow, triangle, hollow or filled diamond, each with its icon) and whether the line is solid or dashed. **Default heads** goes back to the type's own. Swap direction swaps the heads too, and PlantUML files keep the choice.

## 1.2.32

- **PlantUML files open in the UML editor.** A class, package or use case diagram (`.puml`, `.plantuml`, `.pu`, `.iuml`, `.wsd`) opens in the same editor as the UML prefabs, with its palette, menus and keys. Every change is written back as PlantUML (Ctrl S saves it), and where each box sits is kept in one comment line that PlantUML ignores. The desktop app places the boxes where PlantUML draws them the first time. Activity, sequence and other diagrams show as PlantUML's own drawing. **UML** in the bar switches to the source.
- **Drawn with the PlantUML on your computer.** The desktop app uses the PlantUML you have installed (it needs Java) and sends nothing anywhere. `!include` reads only from the file's folder. Without PlantUML, the file shows its source and says what to install.
- **Visual, code or both.** The UML editor has a PlantUML view beside the drawing: typing redraws it and drawing rewrites it. A new class or use case diagram asks which one you want, with **Ask every time** in the same menu. Import and Export also read and write PlantUML, besides Visual Paradigm XML and XMI.
- **Lines you can shape.** Drag a line to bend it, drag the hollow dot in a stretch for another bend, and drag a selected line's end onto another element to reconnect it. A bend lines up with its neighbour when it is nearly level or upright. **Make rectilinear** gives a line right angles.
- **Connect by pointing.** Point at an element and its arrow handle appears, without selecting it first.
- **Association classes and reading direction.** The **Association class** connector draws a dashed line from a class to the middle of its association. An association's name can show which way it reads (▸ or ◂).
- **Keys as in drawing programs.** The arrow keys move the selection (Shift: ten times as far). Enter renames. Ctrl + / − / 0 zoom and show the whole diagram. Shift F10 or the menu key opens the selection's menu.
- **Cheat sheets.** A round **?** in the UML and chart editors opens a floating sheet of what the mouse and the keys do. You can move it, resize it or put it away like Ask AI.
- **Clearer activity icons.** Decision and merge, and fork and join, showed the flows going in and out of each (replaced in 1.2.33).

## 1.2.31

- **Dialogs open about twice as fast.** On a slow tablet, Import and export, Insert prefab, Find, Go to page, the command palette (Ctrl K) and the Ask AI panel used to take 140 to 220 ms to appear, and now take 60 to 125 ms. Opening one used to restyle every card in the page list, about 3,700 elements in a 193-page note. Cards out of sight now skip that work, which also makes zooming and scrolling a little smoother. Tool buttons answer about a quarter sooner, and menus were already quick.
- **Insert prefab shows at once.** The large preview is drawn just after the picker appears, instead of holding it back.
- **The welcome note and the README** now cover Goodnotes and Notability import and the prefab editors (process states, CPU timelines, trees and UML).
- **A new benchmark**, `tools/ui_latency_bench.mjs`, times menus, tools and dialogs from the tap to the painted answer ([performance](docs/PERFORMANCE.md)).

## 1.2.30

- **Length per tap on a phone held upright.** The 1, 5 and 10 buttons in the process states and CPU timeline editors (how much one tap paints) were pushed off the edge of the screen in portrait, and a phone has no wheel to switch them. They now sit on their own row under the brushes. With the phone on its side they come first in the brush column.
- **Chart editors fit a phone better.** The toolbar is a single row of icons, and Insert keeps its name when there is room. The figure takes the height it needs, so the fields below it are no longer cut off under an empty band. The empty strip above plots and histograms is gone, and the name for a new process shares the lengths' row.

## 1.2.29

- **Android updates install again.** Every APK so far carried the same internal build number, so some phones (Samsung among them) refused a newer one with "App not installed". Each release now has a higher build number (1.2.29 is 10229), so it installs over the one you have.

## 1.2.28

- **Open Goodnotes and Notability notebooks.** Open a .goodnotes or Notability .ntb file and it becomes a note you can edit like any other. Ink, typed text, pictures and shapes come over as editable items. The notebook's PDF pages stay sharp behind the page. Paper templates and fills are drawn into a PDF behind the page. Anything that can't come over is listed when the notebook opens. Save keeps it as a .nfedit with the original notebook inside, so nothing is lost. The MCP tools read notebooks too.
- **A new .nfedit format (version 13).** A .nfedit is now an archive like .notecomp, holding the note as it is instead of as Base64 text, so projects are about a quarter smaller. Older .nfedit files still open, and are saved in the new format.
- **Fixed: a new note's first save could overwrite the note opened before it.** After opening a note and then making a new one, the first save now creates the new note's own file.
- **Duplicate notes are found among new .nfedit files too.**

## 1.2.27

- **Figure notes can be read rendered.** The notes beside a chart now have Write and Read tabs. Read shows the Markdown as the notes panel does, with headings, lists, tables and maths. Double-click it to write again.
- **Diagrams have notes too.** The diagram editor (UML, trees, node graphs) has a Notes button, or press N. The notes are saved inside the diagram on the page, in the .nfedit and in an exported NoteComplete diagram. They are never drawn. The .nfedit spec now describes compound objects and their notes.
- **To look at: zoom and move.** A picture, PDF or note under To look at zooms with Ctrl + wheel or a pinch, around the pointer. Drag with the mouse, the middle button, the pen or one finger to move it. Double-click to fit the width again.

## 1.2.26

- **Audio speed arrows together.** The faster (up) and slower (down) arrows now sit side by side at the right of the speed box, up first.

## 1.2.25

- **Process states: service time before the letter.** The CPU + blocked number now sits to the left of each process letter.
- **Middle-click drag in the chart editors.** Hold the middle button and drag to scroll the process states, CPU timeline and chart canvas sideways or up and down, as on the note's pages. It works anywhere on the canvas, also around and under the grid.
- **Ctrl + wheel zooms anywhere on the canvas**, not only with the pointer over the timeline. The menus and the side and bottom bars are left alone.

## 1.2.24

- **Lag log (View → Lag log…).** Turn it on and write as usual. Every moment the app freezes for more than 0.1 s is written down with what was going on: a stroke in progress, engine calls and how long they took, auto-save, PDF pages being drawn, network requests, the number of elements on screen. It also notes when the browser reloaded the page without it being closed, which on iPad usually means it ran out of memory. Copy or save the report to send it. It is off by default and stays on the device.
- **PDF pages that left the screen are not drawn.** A page scrolled away while waiting for its turn is skipped, so the pages you are looking at, and text you just typed on a PDF page, show sooner.
- **Process states: service time.** The number beside each process is its CPU burst time plus its blocked time, now named that way in the help (it was called TRI).

## 1.2.23

- **Smoother scrolling and zooming on tablets.** PDF pages are drawn once scrolling or zooming pauses, and one at a time, so pages flying past are no longer drawn for nothing. Measured at tablet speed on a 193-page note: zooming does about 4× less work and its longest stall is 20–30% shorter, and the longest stall while scrolling is about 20% shorter. A new benchmark (tools/jank_bench.mjs) measures this.
- **Process states by touch.** Rows are taller for a finger or the Pencil. Two fingers scroll and pinch the time axis. Once a pen has been used on the device, one finger scrolls instead of painting.
- **JSON errors show where they are.** The JSON view of the chart editors now has line numbers, marks the line with the error, and "Line 3, column 12" takes you there. This also works in Safari, whose own messages don't say where.
- **Diagrams: Clear all.** Every diagram editor has a Clear all button (trash icon); one undo brings the diagram back. Removing one item now uses the delete icon.
- **Diagrams: middle-click pans**, over elements too, as on the note's pages.
- **Trees and node graphs:** a line without arrows no longer offers Swap direction.
- **Sequence diagrams:** the starter has activation bars. A selected bar has handles at both ends to make it longer or shorter, and messages stop at its edge.

## 1.2.22

- **Stylus Pan on iPad.** The hand tool moves the page with the Apple Pencil again; before, only a finger worked.
- **Prefabs on iPad.** A short "Opening the editor…" note shows while an editor loads the first time, only one picker or editor opens at a time (taps during a slow load no longer stack several), and the picker draws its thumbnails bit by bit so it opens at once.
- **Process states: end of a process.** With Arrival, a second dot on the same row marks where that process ends: nothing can be painted past it until you move or remove it. Click a dot to remove it. A row with one dot works as before.
- **TRI per process.** Beside each process letter, the sum of CPU and blocked time as a whole number.
- **"To look at" shows PDFs and notes.** PDFs are shown as page pictures (they were blank on iPad), and you can open a note file or pick one from the new "A recent note…" list to see its pages.
- **Moving a prefab between pages.** Dragging an item to another page and back onto its first one no longer leaves it invisible.
- **Fewer sudden lag spikes.** Auto-save waits for a pause in your writing before copying the note, so it no longer stalls a stroke.

## 1.2.21

- **Notes in the chart editors.** In the process states, CPU timeline and chart editors, press N (or click Notes at the bottom) to open a Markdown notes pane. It sits beside "On the page", the two share the bottom area, and its top edge can be dragged to resize it. Notes are saved with the figure.

## 1.2.20

- **Reference pictures while drawing.** The process states, timeline and chart editors now have a "To look at" section in Editor mode too, not only when filling in an exercise. Open a picture or PDF, or paste a snippet with Ctrl V.
- **Cleaner mode switch.** Editor, Fill in and JSON at the top of the chart editor are now one segmented control, with no overlapping edges.

## 1.2.19

- **Tool settings stay in the tool bar.** Clicking the selected tool again opens the full settings panel, and the strip in the tool bar now stays visible under it. Both work.
- **Zoom the time axis.** In the process states and CPU timeline editors, Ctrl + scroll (or a trackpad pinch) zooms the timeline in and out around the pointer. Scrolling still changes the painted length.

## 1.2.18

- **Painting follows you both ways.** In the process states and CPU timeline editors, dragging back (before letting go) shortens the stretch you're painting, and the cells you pass over go back to how they were.
- **Slide a row in process states.** The new Shift brush moves everything from the cell you press onwards left or right as you drag, so a skipped time unit no longer means redrawing. Hold Shift to slide every row. New process-state diagrams start with three processes.
- **Insert a blank page before or after.** Right-click a page, or a page in the Pages sidebar.
- **Moving things to another page.** What you drag stays visible over the next page until you let go.
- **Double-click a text box to edit it.** It opens where the box is now (not where it was first typed), and you're back in Select when you finish.
- **Tool settings on every screen.** The settings strip shows under the tools when they don't fit beside them, on phones too, without pushing the page down. Clicking the selected tool again still opens the full panel.
- **Comic Sans** is a text box font.

## 1.2.17

- **Tool settings panel is back on wide screens.** With the settings shown inline in the tool bar, press the selected tool again to open its full panel underneath. Press anywhere else to close it.
- **The menu bar works while a chart or diagram editor is open.** File, Edit, View and the rest stay usable above the editor, and their menus open over it. If another note is opened in the meantime, the editor's result is not put on it.
- **Diagram connectors.** «extend» now points from the extension to the base use case by default, and its icon points that way too. Hold Shift when letting go of a new connection to pick its type and direction. Right-click a connector to change its type, or swap its direction.
- **Diagram text size and colour.** Right-click an element or connector and choose **Text size** or **Colour**.
- **More diagram elements.** Decision, merge and choice nodes can have a name (shown above them). New: activation bars for sequence diagrams, plus input and output pins and interruptible regions for activity diagrams.
- **Copy, cut and paste in the diagram editor**, with Ctrl C, Ctrl X and Ctrl V, from the right-click menu, or with **Paste here**. On the page, Ctrl C and Ctrl X now work with whatever tool is active.
- **Process states editor.** Every time cell now has its own line, with stronger lines and labels at each "Ticks every" interval and a little more room per process.
- **JSON tab.** The JSON text now fills the editor's width instead of a narrow strip.

## 1.2.16

- **Snappier writing.** The line you draw is updated once per screen refresh and only gets its new points, instead of being rebuilt with every pen sample, so long strokes stay smooth (most noticeable in Safari on iPad).
- **Smoother page list.** Page previews are encoded in the background, so finishing a stroke no longer causes a short pause.
- **Prefabs work on iPad.** Tapping a figure in the prefab picker now picks it the first time (Safari treated the tap as a hover), and prefabs are drawn in a way Safari accepts.
- **Process states editor.** Right-click a cell to erase it, or hold the right button and drag to erase a stretch. Scroll over the grid (or use the new Length buttons) to paint 1, 5 or 10 units per click; an outline shows what a click will paint. On the page, processes are now drawn in the same top-to-bottom order as in the editor.
- **Histogram editor squares.** The editor shows each bar's column, so the grid matches the page.
- **Clearer while an editor is open.** The menu bar above a full-window editor is greyed out, since it can't be used until the editor closes (the tabs still work).
- **Two-finger scrolling is reliable again.** Scrolling or pinching while a page redrew under your fingers could leave the gesture stuck, so the pages stopped gliding on after you lifted.

## 1.2.15

- **Copy, cut and paste.** With Select, use **Ctrl C**, **Ctrl X** and **Ctrl V** (⌘ on a Mac), or **Cut** and **Copy** in an item's right-click menu. To paste on any page, right-click and choose **Paste here**, or press Ctrl V. Strokes, shapes, pictures, text boxes and prefabs are copied as they are drawn now. A copied prefab can still be edited.
- **Drag items onto another page.** With Select, let go of an item over another page and it moves there. One undo moves it back.
- **Clearer diagram labels.** A connector's label sits beside its line, can be dragged anywhere, and is always drawn over the lines on its own background. Right-click → **Label back beside the line** resets it. The «include», «extend» and «create» tools now show their letter.
- **Move the tool settings anywhere.** Drag them by their grip and they stay there. Double-click the grip, or use **View → Reset tool settings position**, to put them back.

## 1.2.14

- **One view in the chart editor.** The figure "as on the page" is now a panel under the canvas. Fold it away with its arrow, or drag its top edge to resize it. Both choices are remembered on this device.
- **JSON is back, inside the editor.** An **Editor | Fill in | JSON** switch lets you edit the figure's data directly. A valid change shows straight away, and invalid JSON can't be applied. **Edit its data as JSON…** opens this view too.
- **Solve any premade chart.** Process states, CPU timelines and bar charts offer **Solve…** in their right-click menu. The figure becomes the solution and you fill in your answer.
- **Look at the exercise while you fill it in.** In Fill in mode, the side panel shows the page the exercise is on. You can also open a picture or a PDF there, paste a snippet, or keep regions with the Grab tool's new **Keep for exercises** button.
- **The editors follow the app's theme**, including dark mode, and their buttons have icons. Process rows can be moved down as well as up.

## 1.2.13

- **Long notes open fast again.** Opening a note with a long edit history replayed it in quadratic time. A note with 30,000 edits took 5 seconds to open and now takes a quarter of a second.
- **Trimming history works with tape.** **Cut history** no longer fails with "Compacting would change a page" on notes that have strips of tape, such as taped exams.
- **Lighter pen hover.** The hover ring moves once per screen frame instead of on every pen report (up to 240 a second on an iPad), and it only updates what changed.
- **The pen clicks tool bar buttons.** A long press with the pen used to turn into a drag or a tooltip. Now a pen tap of any length is a click, and a pen drags tools only after it clearly moves.
- **Palm rejection.** A resting palm, recognized by its large contact area, no longer scrolls or draws on the page. After you use the pen, fingers keep panning for 10 minutes (up from 30 seconds).
- **Pen smoothing in the tool bar.** The pen's tool settings now include a smoothing toggle next to pressure.
- **Open & Import and Export.** Import, export and share are now organised into these two tabs, with Notes and Resources subtabs (1.2.12).

## 1.2.0

1.2.0 gathers everything since 1.1.75 into one release.

- **Chart editor for process states, CPU timelines and charts.** Exam prefabs that used to be JSON-only now open in an editor, over the note or in their own window (**Tools → Charts**). You paint the grid, drag the bars or fill in a plot form, with a live preview. Each prefab can also be imported or exported as SVG, PNG or JSON.
- **Exercises to fill in.** Any timeline or chart can be turned into an exercise with **Fill in …**. The student paints the answer, then uses **Check** or **Show solution**. The **Editor** tab keeps the author's answer. There is also a new *Scheduling exercise* prefab.
- **Number keys and a Shift S ring in the editors.** In the chart and diagram editors, 1–9 pick the palette's brushes and tools, and the numbers follow the order you give them by dragging. Shift S opens a ring at the pointer where you can point and let go.
- **Dialogs no longer lock the app.** While a dialog or editor is open, the tabs stay clickable and the window isn't greyed out.
- **Prefabs and UML diagrams.** You can now place prefabs from a picker, edit UML diagrams in a diagram editor, open VP 16 projects and arrange the page menu. A menu also opens at the pointer.
- **Tools and layout.** The tool bar can sit at the bottom, and tool settings show as compact cards. Columns can be reordered, the menu bar can hide itself, and a shape's fill can be changed from its right-click menu.
- **Speed.** PDF pages sharpen quickly when zoomed (on by default), and desktop zoom no longer lays out the note once per page.
- **Recent and welcome note.** Saved notes stay in Recent on every device, and the welcome note can be turned off.
- **Pen.** The hover ring goes away when the pen leaves, and fingers pan while the pen hovers. Android pen hover and floating-drag bugs are also fixed.
- **AI and exams.** This release adds AI batch note-taking, a taped exam generator that draws on several sources, parallel exam creation and solving, and interactive exam HTML inside `.nfedit`. Expand with AI is now reliable, and there are exam visuals, solutions and state diagrams, KaTeX MathML, a live AI inspector, JSON repair and a duplicate finder.
- **Sharing and files.** You can share notes peer to peer with WebRTC QR, and the QR stream no longer deadlocks. Google Drive stays signed in, formats are unified on `.nfedit` with selective resource export, and Ctrl+S overwrites the file in place. Other additions are a spread view, an HTML viewer and auto-covers.

## 1.1.75

- **Android QR note sharing & camera scanning.** Added a LAN note-sharing HTTP server (`ShareHttpServer`) and WebView/camera-permission bridge on Android so **Export and share → Share note via QR…** and progressive `NCQR1` camera scanning work natively on Android as well as desktop.
- **Automatic `.ncstudy` detection from WhatsApp and Android intents.** Declared `.ncstudy`, `application/x-ncstudy`, and `application/json` Android intent filters (`VIEW`, `SEND`, `SEND_MULTIPLE`), fixed byte/filename detection so `.ncstudy`, JSON decks, and Quiz Toolkit Markdown don't get misclassified as `.nfedit`, and routed native opens/drops through the unified importer.
- **Pick a note or keep as General when importing quizzes and flashcards.** Added the import destination picker (`#importTargetDialog`) so imported `.ncstudy` packs, JSON flashcard decks, and Quiz Toolkit Markdown can be attached to any note on the device or kept as General quizzes/decks.
- **Fixed unclickable General & standalone quizzes.** Standalone and imported quizzes/decks in **Study → All quizzes and decks…** are now always clickable, open directly, and save progress to their own storage keys.
- **Rust CI fixes.** Fixed `rustfmt` and `clippy::collapsible_match` warnings in `noteful-core`.

## 1.1.74

- **`.nfedit` v10 persists quizzes, flashcards, and scratchpad notes.** `.nfedit` projects now save and restore each note's flashcard decks, quizzes, and scratchpad conversations alongside the source archive, undo history, Markdown notes, and recognized handwriting text (while preserving versions `1..=9` when empty and keeping audio recordings on-device / in `.notecomp`), and every menu item, export row, new-note format picker, and File Formats help dialog documents what `.nfedit` keeps.
- **Share note via QR in exports.** Added **Export and share → Share note via QR…** to host `.nfedit`, `.notecomp`, or `.noteful` files with tokenized LAN/Cloudflare links and QR codes on desktop, plus direct system share/save and study QR actions on browsers and mobile.
- **Offline progressive QR transfer for quizzes and flashcards.** Added animated multi-frame `NCQR1` QR code streaming (`deflate-raw` + CRC-32) with play/pause/speed/progress controls and camera stream scanning (`BarcodeDetector`) across **Share study material**, **Export → Share quizzes & decks via QR…**, individual flashcards decks, and saved quizzes.
- **Android stylus hover detection & finger-panning while hovering.** Added a native Android `Window.Callback` stylus hover forwarder and DOM `PointerEvent` bridge (`__notecompleteNativeHover`), enabled pen hover preview by default on Android alongside iOS, allowed finger panning while hovering, and labeled hover vs contact events explicitly in **Help → Test pen and stylus**.

## 1.1.73

- **Fixed: AI study dialogs (Fact check, Generate flashcards, Quiz me) layout.** Removed the outer `.ocr-scope` grid from `.ai-fieldset`, wrapped `#studyModel`, its magnifier/manage buttons, `Small model`, `Text only`, and `#studyModelOther` inside `.model-controls`, aligned `Language` and the AI fields to the dialog's label column on desktop, and stacked rows full-width on narrow mobile viewports (`<= 540px`).
- **Fixed: Mobile bottom navigation bar and Ask AI header sizing.** Tightened mobile `.navigation` spacing and button sizes (`<= 520px`) so all action icons (including Find, Layers, and Toolbar toggle) and `Fit` stay visible without horizontal clipping, and gave `.chat-head` selects a readable minimum flex basis alongside the model magnifier controls.

## 1.1.72

- **One-tap Find button on mobile and desktop.** Added a search icon (`#findToggle`) to the toolbar actions (which moves into the mobile navigation strip) and a search toggle (`#textFindToggle`) to the text viewer bar so `Ctrl+F` find is one tap away without opening Home or menus.
- **Undoable page reordering.** Pages can now be reordered by dragging page cards or clicking Up/Down arrows in the Pages sidebar, or from `Move page up` / `Move page down` in the Pages menu, with full undo/redo, `.nfedit` project persistence, and `.noteful` export support.
- **Icons in the Share / Export dialog.** Every option in the Share / Export dialog now displays a matching icon alongside its title and description.
- **Study export actions in the File menu.** Added `Share or export study material…` and `Export study to Anki` directly to the File menu and Command Palette.

## 1.1.71

- **Redesigned Layers sidebar with clear lock/visibility icons and reordering.** Clicking anywhere on a layer card selects it with the accent color; Lock and Visibility use clear padlock and eye icons with an amber `"Locked"` badge and toolbar indicator when a layer is locked; locking or hiding the active layer automatically switches tools to an editable layer so drawing and text tools never silently stall; and layers can be reordered by dragging or with Up/Down arrow buttons.
- **Fixed: Tap on stroke to jump to audio/transcript time across layers.** Tapping a timed stroke with `Audio tap` (or `Pan` / `Select`) now jumps to its recording timestamp even when the timed stroke's layer is locked, when an item is locked, or when another layer or shape sits above it.
- **Hold Forward or Back in audio to skip faster.** Pressing and holding the Forward (`+10s`) or Back (`-10s`) transport buttons (or holding `L` / `J`) continuously repeats and accelerates skipping through recordings.
- **Random order (Shuffle) toggle for Anki flashcards and quizzes.** Both the Quiz window and the Flashcards study dialog now have a Shuffle toggle button in their header to ask questions and cards in random order or in note/deck order.

## 1.1.70

- **Audio volume slider and mute button.** The audio window now has a volume slider (`0%` to `100%`) and a mute/unmute button below the position bar, remembered across recordings and sessions.
- **Faster auto-save hashing on large notes.** Auto-save now computes content digests directly in the Rust/WASM core (sampling large embedded PDFs and audio while hashing all structured and stroke blocks in full) and reuses the digest when the edit history mark has not moved, avoiding a second `.noteful` export and 250 MB buffer transfer on every auto-save tick.
- **Reader cleanup.** Split auto-save, the download queue window, page/note export wiring and the text box editor out of `app.js` into dedicated tested modules, and audited promise rejection handling across the reader.

## 1.1.69

- **Mouse Back and Forward buttons.** Mouse buttons 4 and 5 (plus `BrowserBack` / `BrowserForward` and `Alt+←` / `Alt+→`) navigate back and forward across page jumps, between an open document and Home, across grouped documents, inside Home, Google Drive and Internet Archive folders, and in web links (which also gain a Forward button in their bar).
- **Fixed: Home and the current tab on desktop.** Opening Home while a document is open highlights the Home button and unselects the tab; clicking the tab, clicking Home again, switching back from another tab, or clicking the open document's card in Recent returns to the open document without reloading it, and keyboard scrolling works on Home while a note is loaded.
- **Consistent `h:mm:ss` audio times and cut-audio transcripts.** Audio times are shown as hours, minutes and seconds (`0:00:00`) in both the position bar and the segment cutter, and text transcribed from a cut audio segment is also placed into the Transcript dropdown (`#transcriptPanel`) with click-to-seek.

## 1.1.68

- **Fast drawing on pages with many strokes.** Added lines keep their formatted SVG in the engine, the edit history is read in a single pass, and drawing a stroke sends and inserts only the new element into the page on screen instead of rebuilding the whole page SVG after every stroke.
- **Audio playback speed, smoother seeking and lighter ink sync.** A speed control in the audio bar (0.5× to 3×, `[` and `]` step it, remembered across launches, pitch preserved), dragging the position bar seeks at most once a frame, timed ink is dimmed only on pages in view (and not at all while sync is off), and the transcript panel names its backend.
- **Smaller builds and fixes from the November audit.** Release builds use fat LTO and minified `pdf.js` (about 1.7 MB smaller in the app shell); automatic saves made from text show their size instead of `NaN MB`; recognized text on valid pages is kept if one page is refused; desktop Internet Archive downloads can be cancelled and enforce a 2 GiB limit; and the reader pages carry a Content-Security-Policy.

## 1.1.67

- **Fixed: Restart now reopens the app after an update** on Linux. The app closed and stayed closed; it now comes back on the new version. (The restart is run by the version you update *from*, so this takes effect on the update after this one.)
- **Home polish.** The File, Folder and Back to document buttons are no longer cut off by the filter bar; section titles line up with their content; Sort is a chip like the filters (A – Z); filters, Favourites, With audio, Back to document and Change folder… have icons.

## 1.1.66

- **Fixed: `.notecomp` and `.notepart` files get their cover in Recent.** Opened with File… (or from Drive), these packages showed a blank card; the cover is now read from the note inside the package, without loading the whole file.
- **Fixed: large files from WhatsApp open on Android** (from 1.1.65, which was not published). Shared files are copied to the app's cache a piece at a time instead of being read whole into memory, so big ones no longer fail with *OutOfMemoryError*.

## 1.1.65

- **Fixed: large files from WhatsApp open on Android.** 1.1.64 read a shared file whole into memory, so big ones (a long PDF, a note with audio) failed with *OutOfMemoryError*. The file is now copied to the app's cache a piece at a time and the reader loads it from there, whatever its size; the copy is deleted once the file is open.

## 1.1.64

- **Fixed: files from WhatsApp open on Android.** Opening a `.notecomplete` (or any note, PDF or image) that WhatsApp, Gmail or Drive hands over failed with *Unsupported scheme*; the app now reads those files through Android's own content provider, for both Open with and Share.

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
