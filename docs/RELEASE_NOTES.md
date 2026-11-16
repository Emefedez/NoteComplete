## What's new in 1.2.0

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

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
