## What's new in 1.1.4

- **Apple Pencil draws reliably**: iPadOS no longer takes the Pencil for Scribble (writing into a text box) and cancels the stroke, and a new stroke starts at once, without waiting for the last one to finish.
- **Pen pressure on or off**: the Pen's settings have a pressure switch, *Pressure changes the width* or *Even width*. It is remembered on each device.
- **Smoother handwriting**: strokes are smoothed while drawn and once more when the pen lifts. With no stylus out, a finger draws.
- **Scrolling that glides**: a two-finger flick (or a finger flick while a stylus is in use) keeps scrolling and slows down like native apps. Two fingers scroll or zoom, whichever the gesture starts as. Shift with the wheel or arrow keys scrolls faster.
- **Sharing**: online guests see the whole note live, not only the Markdown notes, and draw on it when the session allows editing. Drawing tablets can join through the online link too. On Linux, the sharing panel names the firewall command when the local link cannot be reached.
- **Fixes**: dropdown menus in the compact layout on Android, the toast no longer covers the toolbars, and touch or stylus no longer selects text by accident.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
