# Installable builds

Two GitHub Actions workflows generate downloadable artifacts. Both support **Actions → Run workflow** as artifact-only builds. **Release installers** (`.github/workflows/release.yml`) calls both workflows and publishes a release.

**Automatic releases.** Every push to `main` reads the version in `apps/desktop/package.json`. When `v<version>` has no release yet, every package is built and the release is published, with the tag created at that commit once all builds pass; otherwise the run stops after a few seconds. To release, bump the version (keep `apps/mobile/app.json` and `apps/mobile/package.json` in step: the APK takes its version from `app.json`) and merge. A failed build leaves no tag, so the next push to `main` tries again; a re-run of the failed workflow does too. Pushing a `v*` tag by hand still releases that tag. Push the workflow files to the repository before running them; manual dispatch is available once they are on the default branch. The release workflow waits for all builds, verifies the installer set, writes SHA-256 checksums, and attaches the assets to a GitHub prerelease for that tag. Manual release dispatch must select an existing `v*` tag and provide the same tag as input; branch refs are rejected. Uploads are staged in a draft before first publication. Existing tagged releases receive updated assets on rerun. App-store submission is not included. Actions artifacts expire after 30 days; Release assets remain attached to the release.

## Desktop packages

Run **Desktop packages** (`.github/workflows/desktop.yml`). A hosted reader is not required. Google Drive credentials can be bundled using the configuration below, or imported by the desktop user.

| Platform | Architecture | Artifact |
|---|---|---|
| Linux | x86-64 | AppImage |
| Linux | ARM64 | AppImage |
| macOS | Apple Silicon / ARM64 | DMG and ZIP containing NoteComplete.app |
| macOS | Intel / x86-64 | DMG and ZIP containing NoteComplete.app |
| Windows | x86-64 | NSIS .exe installer |

Linux AppImages are recompressed with zstd behind AppImage's own type2 runtime (`tools/repack_appimage.py`, a pinned runtime release checked against its SHA-256): electron-builder's runtime only reads gzip, and decompressing Electron through it cost about 0.8 s per launch (first paint 1.35 s against 0.52 s unpacked). `tools/update_appimage.py` and the desktop workflow both run it; it needs squashfs-tools 4.4 or newer.

The reader/WASM is built and tested once on Linux. Separate runners package the same assets using locked Electron and electron-builder dependencies. The package includes PDF rendering and the speech engine; Whisper model weights still download on first use. Original samples, development dependencies and research data are excluded.

The desktop shell uses a private, stable `notecomplete://reader/` origin so local settings and transcript caches survive restarts. Renderer Node integration is disabled, context isolation and sandboxing are enabled, navigation is restricted to the packaged reader, and new windows/permission requests are denied. Web links open in `<webview>`s that may only load http(s) addresses, without the preload, sandboxed, in their own session (`persist:notecomplete-web`). Files also arrive from the system; see [Opening files from the system](#opening-files-from-the-system).

These are **preview distributions without publisher certificates**, without Developer ID/notarization or Windows Authenticode certificates. OS trust prompts may apply. Production signing requires configuring the appropriate certificates and changing the current unsigned build settings; credentials are never committed. Both macOS architectures are explicitly ad-hoc signed with hardened runtime disabled. CI extracts the ZIP and verifies all bundle signatures before uploading artifacts. Ad-hoc signing fixes bundle integrity; it does not provide Developer ID trust or notarization. Downloaded apps may still need approval in System Settings → Privacy & Security. For a trusted preview that macOS refuses to approve, remove quarantine from that app only with `xattr -dr com.apple.quarantine /Applications/NoteComplete.app`.

Local build (Rust/WASM build prerequisites are described in README):

```sh
python3 tools/build_web.py
npm ci --prefix apps/desktop
npm run stage --prefix apps/desktop
npm start --prefix apps/desktop
# Package on the target OS; macOS can package both Mac architectures.
npm run dist --prefix apps/desktop -- --mac --arm64
# Alternatives: --mac --x64, --linux --x64, --win --x64
```

Outputs are in ignored `apps/desktop/dist/`. Package version comes from `apps/desktop/package.json`, not the Git tag; update versions deliberately before tagging.

### Opening files from the system

The supported types live in `apps/desktop/open-with.js`; `open-with.test.mjs` checks that the package configuration and the Windows installer script list the same ones.

- **Own formats** (`.noteful`, `.nfedit`, `.notecomp`, `.notecomplete`, `.notepart`): `build.fileAssociations` in `apps/desktop/package.json`, role Editor, rank Owner, with a MIME type each. They become the default on every platform. macOS also gets `UTExportedTypeDeclarations` (`com.notecomplete.*`) through `mac.extendInfo`. The app icon is used for documents; there are no per-type icons yet.
- **Common types** (PDF, images, Markdown, text, HTML, Office, CSV, TSV) are offered, never claimed. On macOS they are `mac.fileAssociations` with role Viewer and rank Alternate. On Linux they are `linux.mimeTypes`, which only adds them to the `.desktop` file's `MimeType=` (electron-builder's own associations would also install MIME definitions overriding the system's). The AppImage's `Exec` ends in `%U`. On Windows, electron-builder's `fileAssociations` would set NoteComplete as each extension's default, so `build/installer.nsh` (the NSIS `customInstall` / `customUnInstall` macros) writes only `OpenWithProgids` and `Applications\NoteComplete.exe\SupportedTypes`, and removes them on uninstall.
- **Main process** (`main.js`): file paths from `process.argv` at launch, from the `second-instance` argv (the single-instance lock is already held; Chromium switches are skipped), and from macOS `open-file` (queued until the app is ready). Only absolute paths with a supported extension are accepted; `file://` URLs from `%U` are converted. Each file gets a new tab in the focused window. The tab's reader asks for it through `notecompleteFiles.launched()` (`files:launched`), which reads the bytes in main and adds the path to Recent, as the open dialog does.
- **Installed web app:** `file_handlers` (with `launch_type: multiple-clients`) and a POST `share_target` in `apps/reader/manifest.webmanifest`. `app.js` reads `window.launchQueue`. `sw.js` keeps shared files in the `notecomplete-shared` cache until the page that opens with `?shared=1` takes them and deletes the cache. `node tools/open_with_e2e.mjs` checks both with a mocked `launchQueue`, after a web build.
- **Android:** the intent filters in `apps/mobile/app.json` are kept in step with `OPEN_TYPES` in `incoming-files.mjs` by its tests. The `ReaderServer` module also gives each `content://` URI's display name and type (`describe`) and the `ACTION_SEND` streams (`takeShared`, `onShared`), which React Native's `Linking` does not report.
- **iOS/iPadOS:** no native app, so there is nothing to register; the Safari web app cannot appear in **Open in…**.

## Google Drive build settings

See [Google Drive](GOOGLE_DRIVE.md#native-build-configuration) for creating the platform-specific OAuth clients. Repository configuration:

- `GOOGLE_DESKTOP_CLIENT_ID` (variable) and `GOOGLE_DESKTOP_CLIENT_SECRET` (secret): Desktop OAuth client bundled into all three desktop platforms. Without these, the app offers a Desktop-client JSON picker on first connection.
- `GOOGLE_WEB_CLIENT_ID` (variable): passed to the Android Google SDK when configured. Register the Android package and signer SHA-1 in the same Cloud project.
- `READER_URL` (variable): optional Android override pointing to a hosted reader with native Drive bridge support. Leave unset to use the bundled reader.

Secrets are passed to reusable workflows only for builds; release publishing has a separate job with `contents: write`. Ordinary build jobs keep read-only repository permissions. OAuth tokens are never build inputs.

## Android APK

Android APKs bundle the reader, WASM, PDF renderer and speech runtime. A native module serves these assets on loopback only (`127.0.0.1:8768`), with correct JavaScript/WASM MIME types. No hosted website, Expo account or Metro server is required. Speech model weights and Google Drive still require internet access.

1. Run **Android APK** (`.github/workflows/android.yml`). Leave `reader_url` and repository variable `READER_URL` unset for the bundled reader. An explicit URL overrides it for development/testing.
2. Download **NoteComplete-android-preview** from the run's **Artifacts**, unzip it, and install the APK on a compatible Android device.

The workflow builds and tests the web reader, stages its allowlisted assets, installs locked Expo dependencies, generates Android with Expo prebuild, and runs Gradle `:app:assembleRelease`. It includes ARM64 and x86-64 native libraries. Java 17 and the Android SDK are configured by Actions.

The APK uses the Expo template's **debug signing key**, despite being compiled in release mode. This is for sideload testing, not Play Store distribution. Use a private, stable production keystore before distributing production updates; switching signing keys requires uninstalling the previous app or using a different application ID. Package version and Android application ID remain defined in `apps/mobile/app.json`.

### Local Android build

Install Android Studio's SDK and Java 17, then run from `apps/mobile`:

```sh
npm ci
# From the repository root first: python3 tools/build_web.py && node apps/desktop/stage.mjs
npx expo prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease
```

On Windows use `gradlew.bat`. The APK is written under `app/build/outputs/apk/release/`; the same preview signing limitation applies. For a connected device/emulator, `EXPO_PUBLIC_READER_URL=https://your-reader-host.example/ npm run android` from `apps/mobile` builds and installs the development app. Generated native directories and signing keys are ignored.

## Validation and limitations

`actionlint` validates workflow syntax and expressions. Desktop protocol path tests reject traversal/private paths. Web/WASM tests run before desktop packaging; mobile tests and Expo dependency checks run before Android compilation. Native runner builds and installed-device smoke tests remain necessary, especially for codecs, downloads, audio transcription and platform trust behavior.

References: [Electron custom protocols](https://www.electronjs.org/docs/latest/api/protocol), [electron-builder targets](https://www.electron.build/v26/docs/cli/), [Expo local release builds](https://docs.expo.dev/guides/local-app-production/).

Validation: workflow lint, Node tests, Expo prebuild/bundling and macOS signature verification run locally; GitHub Actions validates native Android compilation and all desktop package targets. Installed-device testing remains necessary.

## Updates

The desktop app checks GitHub Releases for a newer version when it opens (at most every 6 hours; Help → Check for updates on open turns it off) and from Help → Check for updates…. It never installs on its own: a pill in the top bar says which version is available, with Update, Later and Skip.

- **Linux AppImage**: Update downloads the AppImage for this machine (x86-64 or ARM64), checks it against the release's `SHA256SUMS.txt`, keeps the running copy beside it as `NoteComplete.AppImage.previous`, puts the new one in its place and offers Restart now. A download that does not match its checksum is not installed.
- **macOS, Windows, and copies not started as an AppImage**: Download opens that release's page.

To ship an update, raise `version` in `apps/desktop/package.json` (for example 1.0.1), commit, then tag and push the same version (`git tag v1.0.1 && git push origin v1.0.1`). The release workflow builds every installer, writes the checksums and publishes the pre-release the app finds. Local builds from `tools/update_appimage.py` carry the version in `package.json`, so they are offered only releases newer than that.

