## What's new in 1.1.66

- **Fixed: `.notecomp` and `.notepart` files get their cover in Recent.** Opened with File… (or from Drive), these packages showed a blank card; the cover is now read from the note inside the package, without loading the whole file.
- **Fixed: large files from WhatsApp open on Android** (from 1.1.65, which was not published). Shared files are copied to the app's cache a piece at a time instead of being read whole into memory, so big ones no longer fail with *OutOfMemoryError*.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
