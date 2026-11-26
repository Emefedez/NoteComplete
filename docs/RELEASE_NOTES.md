## What's new in 2.0.3

- **Typing in a UML diagram no longer opens the notes.** Pressing N (or ?, or a tool's number) while typing a name, an attribute, the PlantUML text or the diagram's notes now just types the letter.
- **Click a relation to write on it.** A click on the middle of a relation starts renaming it. A click near either end lets you type the text at that end, such as a multiplicity like `1..n`, which is saved and drawn by that end. Right-click also offers **Multiplicity at the start / end**.
- **Edit a class right on the diagram.** Double-click a class's name to rename it, or an attribute or operation line to edit just that line (as `- name: String`). Enter keeps it and starts a new line below, an emptied line is removed, and a double-click under the last line adds one.
- **Relations are easier to catch.** Clicking or right-clicking a few pixels from a line inside a system boundary or package now takes the line, not the box behind it.
- **One Path choice instead of Straighten and Make rectilinear.** Right-click a relation, then **Path**: a straight line, right angles, or **Around other boxes and lines**, which finds a right-angled way that goes around the other elements and crosses as few other lines as it can.
- **Cleaner bends.** A bend dragged onto the point next to it, or onto the straight line between its neighbours, goes away. Bends also snap to 45°, as well as to level and upright.
- **Move lines without bending them.** Drag a level or upright stretch between two bends to slide it sideways while its corners stay square. Hold Shift and drag a line to move all of its bends together.
- **A search box for the tools.** Type in the left sidebar to show only the tools whose name matches, and press Enter to take the first one.
- **The connect arrow sits at the top right corner**, just outside the element, as in Visual Paradigm.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
