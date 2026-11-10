## What's new in 1.1.62

- **Releases are published as the latest release.** Since 1.1.43 they were published as pre-releases, and the links on the website and in the README (`releases/latest`) skip those, so they still led to 1.1.42. The apps' own update check already looked at pre-releases too, and keeps working.
- **Recording says what it is waiting for.** *Record* shows *Waiting for the microphone* at once, explains after a few seconds how to allow it when no question appears (Safari on an iPad, a home screen app), and names the problem when it fails (blocked, no https, no microphone, in use by another app). A browser that rejects the raw-audio settings or the recorder's format is asked again without them, which Safari needed.
- **Shapes from the pen, **On lift**, made clearer and easier to trigger.** Holding the pen still now works in **On lift** as well (in that mode it did nothing, which made the setting look broken), so a stroke the lift test passes over can still be snapped by holding. The message after a lift says what happened (*Rectangle made from your stroke. Undo removes it*) instead of asking you to lift a pen that already has. The test on lift is a little less strict (tolerance 0.026 → 0.03, lines from 120 units instead of 150). Large, clean strokes only: a big O is still an ellipse. The choices say what they do: **Hold**, **On lift** (holding still works too) and **No shapes**.

Earlier versions are in the [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md).

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
