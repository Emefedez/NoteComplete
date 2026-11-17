## What's new in 1.2.31

- **Dialogs open about twice as fast.** On a slow tablet, Import and export, Insert prefab, Find, Go to page, the command palette (Ctrl K) and the Ask AI panel used to take 140 to 220 ms to appear, and now take 60 to 125 ms. Opening one used to restyle every card in the page list, about 3,700 elements in a 193-page note. Cards out of sight now skip that work, which also makes zooming and scrolling a little smoother. Tool buttons answer about a quarter sooner, and menus were already quick.
- **Insert prefab shows at once.** The large preview is drawn just after the picker appears, instead of holding it back.
- **The welcome note and the README** now cover Goodnotes and Notability import and the prefab editors (process states, CPU timelines, trees and UML).
- **A new benchmark**, `tools/ui_latency_bench.mjs`, times menus, tools and dialogs from the tap to the painted answer ([performance](docs/PERFORMANCE.md)).

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
