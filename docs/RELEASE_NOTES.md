## What's new in 1.1.68

- **Fast drawing on pages with many strokes.** Added lines keep their formatted SVG in the engine, the edit history is read in a single pass, and drawing a stroke sends and inserts only the new element into the page on screen instead of rebuilding the whole page SVG after every stroke.
- **Audio playback speed, smoother seeking and lighter ink sync.** A speed control in the audio bar (0.5× to 3×, `[` and `]` step it, remembered across launches, pitch preserved), dragging the position bar seeks at most once a frame, timed ink is dimmed only on pages in view (and not at all while sync is off), and the transcript panel names its backend.
- **Smaller builds and fixes from the November audit.** Release builds use fat LTO and minified `pdf.js` (about 1.7 MB smaller in the app shell); automatic saves made from text show their size instead of `NaN MB`; recognized text on valid pages is kept if one page is refused; desktop Internet Archive downloads can be cancelled and enforce a 2 GiB limit; and the reader pages carry a Content-Security-Policy.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
