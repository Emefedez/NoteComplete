## What's new in 1.1.1

- **New note with AI** (File → New note with AI…, desktop): one dialog with two tabs.
  - *From a prompt*: describe a topic or paste your data, and your AI tool (Claude Code, Codex…) writes the note as Markdown, then as handwriting.
  - *From Markdown*: paste or open your own Markdown, and *Make it richer with AI* adds highlights, colors, boxes and drawings.
  - What the AI writes lands in the Markdown tab, ready to edit, with Undo and Redo buttons.
- **Handwriting from Markdown is searchable at once**: Find finds its words without running OCR. This works in .notecomp files and projects.
- **Filled shapes**: rectangles, ellipses and triangles can be filled with a tint or solid color. Press F to switch.
- **Shapes on a drawing tablet**: the tablet's tool bar has Shapes, with their kinds and fill.
- **Update checks** find a new release within the hour and keep looking while the app stays open. Before, a check that found nothing silenced the next ones for six hours.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
