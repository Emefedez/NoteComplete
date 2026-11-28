## What's new in 2.0.33

- **Animated GIFs stay animated.** A GIF opened as a document, imported onto a page (Insert, paste, drop) or saved in a Noteful note keeps its own bytes instead of becoming a still PNG; WebP and animated PNG (APNG) are kept as they are too.
- **HEIC/HEIF photos open and import.** iPhone photos (`.heic`, `.heif`) open as documents and go onto pages, decoded to JPEG; `.jfif` and `.apng` are recognized as well, and every image format is listed in Open with, the file pickers, Drive, Dropbox and the Android/web share targets.
- **Pictures in Markdown documents and Notes.** Paste or drop a picture file into a Markdown document being edited or the Notes (`N`) panel, or use the new picture button in its bar: it goes in as an embedded `![name](data:…)` picture, so the file keeps it wherever it is opened (GIFs still move).

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
