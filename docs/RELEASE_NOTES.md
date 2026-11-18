## What's new in 1.2.42

- **Prefab modules.** Every prefab now comes from a module (a folder with `module.json`, a drawing and, if it wants, its own editor). On the desktop, **Insert prefab → Modules…** copies the app's modules to a folder of yours, uses a folder, or reloads it: add or change prefabs without a new version. They run with the app's rights, so add only modules you trust. How to write one: [PREFAB-MODULES-GUIDE.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/PREFAB-MODULES-GUIDE.md).
- **New prefabs: number line and truth table** (group Maths). Points, intervals with open or closed ends; truth tables from an expression (and, or, not, xor, →, ↔), with the result, a blank column to fill in, or none.
- **Graphs and tables in a movable window.** Their editors no longer cover the page: drag them by the title, resize them, and keep scrolling the note behind. They open where you left them.
- **Copy to other apps without losing anything.** Copying items also puts a picture of them on the clipboard for any app; the picture carries the items, so pasting, dropping or inserting it back into NoteComplete gives them back editable (on the desktop; in a browser, the picture only).
- **Open zip and tar files.** Open a .zip, .tar, .tar.gz or .gz to see what is inside, with each file checked (intact, damaged, encrypted), and open notes, PDFs, pictures and documents from it, or save one. A zipped Goodnotes notebook opens as the notebook; a zip with several notebooks opens as a group.
- **Copying PDF text.** Two columns copy one after the other, not mixed line by line; text a PDF draws twice (a fake bold) copies once; words split around ligatures, and spaced-out titles, copy as words.
- **Diagram editor by touch.** Two fingers zoom and move the view, never the selected element; one finger moves an element or the view.
- **Side lists.** The page list resizes from its edge and keeps its width; rows show the real format (PDF, PNG, Goodnotes…), use the space for the name, and a long name slides to its end when you point at it.
- **Fixes.** Copying a UML diagram fills the diagram editor's clipboard again.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
