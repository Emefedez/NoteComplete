## What's new in 1.1.0

- **Share notes and draw on a tablet** (desktop): people on your network write the Markdown notes with you (names, cursors, a copy for everyone when it ends), and a phone or tablet becomes a drawing surface for the note on your computer: QR code or 6-digit code, a tool bar on either side, its own zoom, live strokes with pen pressure, highlighter, eraser and shared undo. Not yet tried on real devices.
- **Handwriting from Markdown**: File → New from Markdown… and Pages → Insert handwritten pages…, with a live preview.
- **Connect AI tools** (Help): registers the bundled note server (MCP) with Claude Code, Codex, Antigravity and OpenCode; the server now ships inside the desktop app.
- **Narrow windows and phones**: every menu and tool stays reachable; dark pages and Fit in the phone page row; the page number fits its box.
- Releases are now published automatically when the version changes.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
