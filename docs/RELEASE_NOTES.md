## What's new in 2.0.28

- **Fixed `Ctrl+Click` / middle-click opening a blank Home tab instead of the clicked document.** `tabs:new` in the desktop main process was passing the boolean result of `openablePath(filePath)` instead of the file path string, causing every new-tab document open (from Recents, Folders, Moodle, etc.) to drop the file and open Home. Now opens the exact document (including `.R`, `.Rmd`, `.py`, `.md`, `.pdf`, `.nfedit`, `.noteful`, etc.) in the new tab.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
