## What's new in 1.1.6

- **Quick menu**: a ring of tools around your pen. Tap a tool to choose it, and its settings appear around it (colours, widths, pressure, modes, sizes, shapes and fill). Hold a tool to move it on the ring. Hold **Z** and point, **Shift + pen**, press a pen's side button (S Pen, Wacom), or hold two fingers still on the page (iPad and touch screens). Safari does not give web pages the Apple Pencil Pro squeeze.
- **Keys and gestures page** in the welcome notebook, and two-finger hold, two- and three-finger taps listed in Help → Keyboard shortcuts.
- **Two-finger scrolling starts at once**: the movement made while it tells a scroll from a zoom now counts, so the pages move with the fingers from the start, as they do with Pan.
- **Rearranging the tools with a finger**: hold a tool until it lifts, then drag it along the bar; the bar scrolls when you reach its edge. A quick swipe still scrolls the bar. (Before, the bar's own scrolling took over the drag and stopped it.) Tabs work the same way.

Since 1.1.5: no waiting between Pencil strokes on iPad, the drawing tablet's loading screen, its dock along the long edge of the screen, and the pressure switch in the dock.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
