# noteful-re: reverse engineering the Noteful format

> **This branch is the research record.** It keeps everything used to work out the `.noteful` format: the Ghidra scripts and static-analysis evidence (`research/ghidra`, `research/evidence`), the independent Python parser/renderer oracle (`research/python`), the legacy comparison viewer, the corpus analysis and validation tools, and the Rust/Python parity checks. The format itself is described in [spec/noteful-v0.1.md](spec/noteful-v0.1.md) and the provenance in [docs/RESEARCH_HISTORY.md](docs/RESEARCH_HISTORY.md). A short writeup will be added here.
>
> The NoteComplete app built on these findings lives on [`main`](https://github.com/Emefedez/noteful-re/tree/main). Format discoveries land here first (with evidence and oracle parity) and are then ported to the client's core.

## NoteComplete at the time of this snapshot

*a RE noteful viewer*

A local-first reader and editor for Noteful notes, powered by a portable Rust core. The web app runs in desktop and mobile browsers. Expo Go provides the Android/iOS development entry point using the same reader.

Read embedded PDF pages, images, ink, text and synchronized audio; draw, highlight, erase, edit object geometry/style, manage layers and save projects. Native `.noteful` export is experimental: modified files have not yet been validated in official Noteful. No fixed note-size or note-count cap is imposed.

## Run the web reader

Requirements: Rust 1.93+, Node 22.13+ and Python 3.11+. Install the WASM target and a wasm-bindgen CLI matching `Cargo.lock`:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked --root work/wasm-tools
python3 tools/build_web.py
node tools/serve_web.mjs 8767
```

Open [localhost:8767](http://127.0.0.1:8767/) and choose **Open document**. Files are processed in the browser. No Noteful installation or decoding server is needed. The build stages WASM and PDF.js in `apps/reader/`; serve that directory with a static HTTP server. Original test notes are not copied into the app.

## Google Drive

Browse your Noteful folder and download selected files with read-only Google Drive access in the web reader and installed Android/desktop builds. Configure the appropriate Google OAuth client for each platform. See [setup and platform support](docs/GOOGLE_DRIVE.md). No changes are uploaded back to Drive.

## Reader settings

Open the hamburger menu → **Display quality** for Performance, Balanced or Sharp presets and sliders for PDF resolution, pixel budget, contrast and brightness. Settings stay on this device. Use Balanced first; Performance reduces memory use on phones.

The collapsible transcript supports on-device Whisper Tiny, Base and Small, language selection, gain, voice filtering and timed word/ink navigation. See the [user guide](docs/USER_GUIDE.md) for imports, audio, quality settings and exports.

## Expo Go

After building the web reader:

```sh
cd apps/mobile
npm ci
npm start
```

Use Expo Go compatible with SDK 57 and scan the QR on the same Wi-Fi. The command owns both Metro and the LAN reader server; Ctrl-C stops both. See [mobile setup and Android file opening](docs/USER_GUIDE.md#mobile-and-android-file-opening).

## Installable packages

GitHub Actions workflows build Android APK previews and desktop packages: Linux AppImage, macOS DMG/ZIP (Apple Silicon and Intel), and Windows installers. Run them manually from **Actions** for artifacts, or push a `v*` tag to build all platforms and attach installers plus checksums to a GitHub prerelease. See [build instructions](docs/BUILDS.md) for artifacts, Android's required hosted-reader URL, and signing limitations.

## Documentation

- [User guide](docs/USER_GUIDE.md): controls, files, playback, exports and mobile setup.
- [Research provenance and history](docs/RESEARCH_HISTORY.md): your starting RE work, supplied material, how Codex used it, and derived findings.
- [Development](DEVELOPMENT.md): current architecture, evidence-to-implementation procedure, tools and remaining validation.
- [Builds](docs/BUILDS.md): package workflows, artifacts, configuration and signing limits.
- [Native format](spec/noteful-v0.1.md): observed byte grammar, objects, text, audio and rendering semantics.
- [Project format and native writer](spec/nfedit-v1.md): edit history, validation and export behavior.

## Repository

| Directory | Purpose |
|---|---|
| `crates/` | Rust core, CLI and WASM adapter |
| `apps/reader/`, `apps/mobile/`, `apps/desktop/` | Browser UI, Expo wrapper and Electron desktop shell |
| `samples/` | One unchanged corpus: ten native notes, 204 pages, one independent PDF reference; hashes in `manifest.json` |
| `tests/` | Python regressions and explicitly synthetic fixtures |
| `research/python/`, `research/legacy-viewer/` | Preserved independent oracle and historical comparison UI |
| `research/ghidra/`, `research/evidence/` | Static-analysis scripts and small retained evidence baselines |
| `tools/` | Build, serve, fixture generation and evidence checks |
| `work/` | Ignored reports, optional galleries, extracted blocks and local tooling |

The corpus is required by tests; it is not a demo bundle. Generated WASM/vendor files and installed dependencies are ignored. Large process extractions and caches are not versioned.

## Validate

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
python3 -m unittest discover -s tests -v
python3 tools/check_rust_parity.py
python3 tools/check_scene_parity.py
python3 tools/check_export.py
node apps/reader/test.mjs
node --test apps/reader/*.test.mjs apps/mobile/*.test.mjs apps/desktop/*.test.mjs tools/*.test.mjs
```

WASM runtime tests require the web build above. Python checks write current reports under `work/reports/`. In `apps/mobile`, run `npm run check`, `npm test` and `npm run export`. CI runs desktop conformance, Android/iOS core target checks, WASM execution and Expo bundling. Device execution remains separate from compilation.

## CLI

```sh
cargo run -p noteful-cli -- inspect 'samples/Practice book (vol. 1).noteful'
cargo run -p noteful-cli -- verify 'samples/Examen wuolah.noteful'
cargo run -p noteful-cli -- render 'samples/texto.noteful' > scene.json
cargo run -p noteful-cli -- export project.nfedit > edited.noteful
```

`render` emits SVG with PDF descriptors for the host adapter. `verify` checks binary round-trip, not complete visual equivalence. Export writes binary bytes to stdout; use a new filename.
