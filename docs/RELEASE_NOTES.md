## What's new in 1.1.3

- **Touch everywhere**: two fingers scroll and pinch-zoom, a two-finger tap undoes and three fingers redo, on phones, tablets and touchscreen computers. After a stylus has drawn, one finger scrolls. Stylus strokes keep the width they had while drawn. Long menus scroll on short screens.
- **Groups move together**: the Grab rectangle selects everything inside it, the whole group moves, and one Undo brings it back.
- **New page** below the last page adds a blank page the size of the last one.
- **Links in handwriting**: `[label](url)` in Markdown is written underlined and opens on click.
- **Online access** (sharing): a separate link through Cloudflare lets people on other networks join the notes. Drawing tablets stay on your network.
- **Recognized text travels with the note** (.notecomp, .notepart, projects), so AI tools reading your notes see it too.
- **Tabs in narrow windows**: a tab count opens the list of tabs.
- **Website and web app**: the reader runs in any browser, with tabs and a welcome notebook. On iPhone and iPad, add it to the Home Screen.
- **Fixes**: Internet Archive downloads in the Android app and the browser, undo of pages added at the end, tape drawn over everything, the keyboard focus ring, and an Android app icon.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
