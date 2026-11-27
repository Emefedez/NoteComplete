## What's new in 2.0.29

- **Apple Notes import (`Import, export and share…` → `Import Apple Notes…` or Command Palette).**
  - **Direct `NoteStore.sqlite` database import** (macOS 1-click from this Mac, or pick a copied `NoteStore.sqlite` on Linux/Windows/macOS) using Node's built-in `node:sqlite` + pure-JS protobuf decoder (`NoteStoreProto` & `MergableDataProto` CRDT tables, headings, bold/italic/strikethrough, macOS Sequoia highlights, superscript/subscript, checklists, numbered/bullet lists, blockquotes, links, hashtags, and nested folders — read-only temp copy so live Apple Notes is never locked).
  - **`.zip` & exported files import** (iCloud Data & Privacy Takeout, `Exporter.app`, macOS Export as Markdown, or HTML/Markdown/TXT files) on both Desktop and Web, automatically organizing imported notes into matching NoteComplete folders.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
