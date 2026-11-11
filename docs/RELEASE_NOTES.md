## What's new in 1.1.65

- **Fixed: large files from WhatsApp open on Android.** 1.1.64 read a shared file whole into memory, so big ones (a long PDF, a note with audio) failed with *OutOfMemoryError*. The file is now copied to the app's cache a piece at a time and the reader loads it from there, whatever its size; the copy is deleted once the file is open.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
