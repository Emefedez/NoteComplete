## What's new in 1.1.70

- **Audio volume slider and mute button.** The audio window now has a volume slider (`0%` to `100%`) and a mute/unmute button below the position bar, remembered across recordings and sessions.
- **Faster auto-save hashing on large notes.** Auto-save now computes content digests directly in the Rust/WASM core (sampling large embedded PDFs and audio while hashing all structured and stroke blocks in full) and reuses the digest when the edit history mark has not moved, avoiding a second `.noteful` export and 250 MB buffer transfer on every auto-save tick.
- **Reader cleanup.** Split auto-save, the download queue window, page/note export wiring and the text box editor out of `app.js` into dedicated tested modules, and audited promise rejection handling across the reader.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
