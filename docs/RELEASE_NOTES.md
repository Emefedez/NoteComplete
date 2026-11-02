## What's new in 1.1.5

- **No more waiting between strokes**: after each stroke the page used to be rebuilt (and its thumbnail redrawn) before the next stroke could start, which on iPad made quick handwriting wait. Now strokes stay on screen as drawn and the page is redrawn once the pen pauses; thumbnails follow a moment later. Pages with a PDF behind them no longer re-render it for the thumbnail. A new stroke starts in a few milliseconds instead of up to a second on slower devices.
- **iPad**: a drawing tool never starts a text selection or the press-and-hold callout, and Pencil movement is kept from iPadOS Scribble for the whole stroke.
- **Drawing tablet mode**:
  - A loading screen shows "Connecting…" and "Loading the note…" with a moving bar, and has a Cancel button.
  - The dock is a row at the top or bottom when the device is held upright, and a column at the left or right when it is held sideways.
  - The dock has the pen pressure switch.
  - Messages appear above the dock, also after the screen turns.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
