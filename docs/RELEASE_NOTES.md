## What's new in 1.2.16

- **Snappier writing.** The line you draw is updated once per screen refresh and only gets its new points, instead of being rebuilt with every pen sample, so long strokes stay smooth (most noticeable in Safari on iPad).
- **Smoother page list.** Page previews are encoded in the background, so finishing a stroke no longer causes a short pause.
- **Prefabs work on iPad.** Tapping a figure in the prefab picker now picks it the first time (Safari treated the tap as a hover), and prefabs are drawn in a way Safari accepts.
- **Process states editor.** Right-click a cell to erase it, or hold the right button and drag to erase a stretch. Scroll over the grid (or use the new Length buttons) to paint 1, 5 or 10 units per click; an outline shows what a click will paint. On the page, processes are now drawn in the same top-to-bottom order as in the editor.
- **Histogram editor squares.** The editor shows each bar's column, so the grid matches the page.
- **Clearer while an editor is open.** The menu bar above a full-window editor is greyed out, since it can't be used until the editor closes (the tabs still work).
- **Two-finger scrolling is reliable again.** Scrolling or pinching while a page redrew under your fingers could leave the gesture stuck, so the pages stopped gliding on after you lifted.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
