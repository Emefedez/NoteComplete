## What's new in 1.2.24

- **Lag log (View → Lag log…).** Turn it on and write as usual. Every moment the app freezes for more than 0.1 s is written down with what was going on: a stroke in progress, engine calls and how long they took, auto-save, PDF pages being drawn, network requests, the number of elements on screen. It also notes when the browser reloaded the page without it being closed, which on iPad usually means it ran out of memory. Copy or save the report to send it. It is off by default and stays on the device.
- **PDF pages that left the screen are not drawn.** A page scrolled away while waiting for its turn is skipped, so the pages you are looking at, and text you just typed on a PDF page, show sooner.
- **Process states: service time.** The number beside each process is its CPU burst time plus its blocked time, now named that way in the help (it was called TRI).

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
