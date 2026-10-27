# Installable builds

Two GitHub Actions workflows generate downloadable artifacts. Both support **Actions → Run workflow** as artifact-only builds. **Release installers** (`.github/workflows/release.yml`) calls both workflows for pushed `v*` tags. Push the workflow files to the repository before running them; manual dispatch is available once they are on the default branch. The release workflow waits for all builds, verifies the installer set, writes SHA-256 checksums, and attaches the assets to a GitHub prerelease for that tag. Manual release dispatch must select an existing `v*` tag and provide the same tag as input; branch refs are rejected. Uploads are staged in a draft before first publication. Existing tagged releases receive updated assets on rerun. App-store submission is not included. Actions artifacts expire after 30 days; Release assets remain attached to the release.

## Desktop packages

Run **Desktop packages** (`.github/workflows/desktop.yml`). A hosted reader is not required. Google Drive credentials can be bundled using the configuration below, or imported by the desktop user.

| Platform | Architecture | Artifact |
|---|---|---|
| Linux | x86-64 | AppImage |
| macOS | Apple Silicon / ARM64 | DMG and ZIP containing NoteComplete.app |
| macOS | Intel / x86-64 | DMG and ZIP containing NoteComplete.app |
| Windows | x86-64 | NSIS .exe installer |

The reader/WASM is built and tested once on Linux. Separate runners package the same assets using locked Electron and electron-builder dependencies. The package includes PDF rendering and the speech engine; Whisper model weights still download on first use. Original samples, development dependencies and research data are excluded.

The desktop shell uses a private, stable `notecomplete://reader/` origin so local settings and transcript caches survive restarts. Renderer Node integration is disabled, context isolation and sandboxing are enabled, navigation is restricted to the packaged reader, and new windows/permission requests are denied. Open files through the reader's picker or drop zone; OS file associations are not registered.

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
