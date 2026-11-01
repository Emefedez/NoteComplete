## What's new in 1.1.2

- **Infinite canvas**: one page that grows downward as you write, keeping all your thoughts in one continuous workspace without needing fixed-size page boundaries.
- **Sharing and device join**: links use the reachable Wi-Fi address, a fixed port, and another address on request; Share stays visible in the top bar across window sizes and badges fit compact bars.

NoteComplete preview installers for Android, Linux x86-64 (AppImage), macOS Intel/Apple Silicon (DMG and ZIP), and Windows x86-64 (EXE). SHA256SUMS.txt contains download checksums.

Google Drive browsing is read-only across the browser and native builds. OAuth configuration is required: see docs/GOOGLE_DRIVE.md in this release's source. Android bundles the reader for offline use; private Drive access needs a Google client registered with the APK signing certificate. macOS packages are ad-hoc signed.

These are preview builds: desktop packages do not have publisher signing/notarization, and Android uses the Expo debug signing key. Native .noteful export remains experimental. See docs/BUILDS.md for build and validation limits.
