## What's new in 1.2.32

- **PlantUML files open in the UML editor.** A class, package or use case diagram (`.puml`, `.plantuml`, `.pu`, `.iuml`, `.wsd`) opens in the same editor as the UML prefabs, with its palette, menus and keys. Every change is written back as PlantUML (Ctrl S saves it), and where each box sits is kept in one comment line that PlantUML ignores. The desktop app places the boxes where PlantUML draws them the first time. Activity, sequence and other diagrams show as PlantUML's own drawing. **UML** in the bar switches to the source.
- **Drawn with the PlantUML on your computer.** The desktop app uses the PlantUML you have installed (it needs Java) and sends nothing anywhere. `!include` reads only from the file's folder. Without PlantUML, the file shows its source and says what to install.
- **Visual, code or both.** The UML editor has a PlantUML view beside the drawing: typing redraws it and drawing rewrites it. A new class or use case diagram asks which one you want, with **Ask every time** in the same menu. Import and Export also read and write PlantUML, besides Visual Paradigm XML and XMI.
- **Lines you can shape.** Drag a line to bend it, drag the hollow dot in a stretch for another bend, and drag a selected line's end onto another element to reconnect it. A bend lines up with its neighbour when it is nearly level or upright. **Make rectilinear** gives a line right angles.
- **Connect by pointing.** Point at an element and its arrow handle appears, without selecting it first.
- **Association classes and reading direction.** The **Association class** connector draws a dashed line from a class to the middle of its association. An association's name can show which way it reads (▸ or ◂).
- **Keys as in drawing programs.** The arrow keys move the selection (Shift: ten times as far). Enter renames. Ctrl + / − / 0 zoom and show the whole diagram. Shift F10 or the menu key opens the selection's menu.
- **Cheat sheets.** A round **?** in the UML and chart editors opens a floating sheet of what the mouse and the keys do. You can move it, resize it or put it away like Ask AI.
- **Clearer activity icons.** Decision and merge, and fork and join, no longer share an icon: each shows its flows going in and out, as in Visual Paradigm.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
