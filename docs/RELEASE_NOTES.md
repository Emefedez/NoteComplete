## What's new in 1.2.23

- **Smoother scrolling and zooming on tablets.** PDF pages are drawn once scrolling or zooming pauses, and one at a time, so pages flying past are no longer drawn for nothing. Measured at tablet speed on a 193-page note: zooming does about 4× less work and its longest stall is 20–30% shorter, and the longest stall while scrolling is about 20% shorter. A new benchmark (tools/jank_bench.mjs) measures this.
- **Process states by touch.** Rows are taller for a finger or the Pencil. Two fingers scroll and pinch the time axis. Once a pen has been used on the device, one finger scrolls instead of painting.
- **JSON errors show where they are.** The JSON view of the chart editors now has line numbers, marks the line with the error, and "Line 3, column 12" takes you there. This also works in Safari, whose own messages don't say where.
- **Diagrams: Clear all.** Every diagram editor has a Clear all button (trash icon); one undo brings the diagram back. Removing one item now uses the delete icon.
- **Diagrams: middle-click pans**, over elements too, as on the note's pages.
- **Trees and node graphs:** a line without arrows no longer offers Swap direction.
- **Sequence diagrams:** the starter has activation bars. A selected bar has handles at both ends to make it longer or shorter, and messages stop at its edge.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
