## What's new in 1.1.10

- **Auto-save** (File menu, on by default): every minute while a note has changed, and when you leave the app, a copy goes into automatic slots on this device, never over your file. Each note keeps its last five, listed in File; **All automatic saves…** opens or deletes any of them. Opening a note with a newer automatic save asks whether to open the **automatic** or the **manual** save.
- **Auto-save when sharing**: the host's switch applies to everyone. A guest or tablet that is disconnected, or whose session ends, keeps an automatic save of the note and is offered to open it.
- **S Pen in Brave and Chrome**: these browsers drop the button press while the pen hovers, so it is now also caught when the pen comes back into hover range with the button held (lift the pen a little and bring it back). The pen test logs the pen entering and leaving hover range.

### In 1.1.9

- **S Pen button in the browser** (Chrome, Brave and other Chromium browsers on Android): the quick menu now opens when you press the button while the pen **hovers**, or when you **hold it and tap** the page. Chromium reports the button only in those two ways, never while the pen touches the screen ([why](S-PEN-BUTTON.md)).
- **View → Pen button…**: press the button over a box once and NoteComplete learns what your pen sends in this browser. You can also let a pen held still open the menu, or turn the pen button off.
- On Samsung devices, turn off *Open Air command with pen button* (Settings → Advanced features → S Pen → Air command) so the button reaches the page.

### In 1.1.8

- **Quick menu**: hovered and selected items no longer overlap their neighbours. The highlight stays inside each item, and a ring with many settings (Shapes) grows a little so its items keep a gap.

### In 1.1.7

- **Quick menu**: smaller, and only as large as it needs to be. Tools without settings (Pan, Select…) get a small menu with no outer ring. It opens with **Shift + S** (instead of Z), opens and lifts much faster, and holding a tool to move it, or two fingers to open it, takes less time. The S Pen button opens it however Android reports it: pressed while hovering, while touching, or in the middle of a stroke, every time.
- **Help → Test pen and stylus**: shows what your pen reports (its type, buttons and pressure), to check its button and pressure.

### In 1.1.6

- **Quick menu**: a ring of tools around your pen. Tap a tool to choose it, and its settings appear around it (colours, widths, pressure, modes, sizes, shapes and fill). Hold a tool to move it on the ring. Hold **Shift + S** and point, **Shift + pen**, press a pen's side button (S Pen, Wacom), or hold two fingers still on the page (iPad and touch screens). Safari does not give web pages the Apple Pencil Pro squeeze.
- **Keys and gestures page** in the welcome notebook, and two-finger hold, two- and three-finger taps listed in Help → Keyboard shortcuts.
- **Two-finger scrolling starts at once**: the movement made while it tells a scroll from a zoom now counts, so the pages move with the fingers from the start, as they do with Pan.
- **Rearranging the tools with a finger**: hold a tool until it lifts, then drag it along the bar; the bar scrolls when you reach its edge. A quick swipe still scrolls the bar. (Before, the bar's own scrolling took over the drag and stopped it.) Tabs work the same way.

Since 1.1.5: no waiting between Pencil strokes on iPad, the drawing tablet's loading screen, its dock along the long edge of the screen, and the pressure switch in the dock.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
