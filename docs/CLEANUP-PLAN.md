# Cleanup plan

Result of the code audit of 2026-11-13: what was found, what to change, and how each change
is checked. States: `[ ]` to do · `[D]` done · `[!]` done, not yet verified in the real app.

Baseline on that day: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` and the
470 JavaScript unit tests pass. Every item below must leave them passing.

## How to work through it

- One item, one commit, on the `cleanup/audit-2026-11` branch. Nothing is pushed to `main`
  until the whole branch is checked: a push to `main` publishes a release.
- After Rust changes that reach the reader: `python tools/build_web.py`, then
  `node apps/reader/test.mjs` and `node --test apps/reader/*.test.mjs apps/mobile/*.test.mjs apps/desktop/*.test.mjs tools/*.test.mjs`.
- Behaviour stays the same unless the item says otherwise. A fix comes with a test that
  fails without it.

## Security and bugs

### S1 Remote file names are written as HTML `[!]`

Done in `8bb0902` (`queue-controls.js`); covered by unit tests, not yet seen in the app.

`renderQueueList` in `apps/reader/app.js` builds each download-queue row with `innerHTML`
and the file's name. The name comes from Google Drive and Internet Archive listings, so a
file named `<img src=x onerror=…>.pdf` runs script in the reader, which on the desktop
holds the file and AI bridges.

- Build the row from elements and text nodes.
- Check every other `innerHTML` that takes a value not written in the source.
- Test: a name with markup appears as text.

### S2 The reader page has no Content-Security-Policy `[ ]`

Second layer for S1. Add a policy to `index.html` and `tabs.html` (and the same header in
the desktop protocol handler and the sharing server) that allows the app's own scripts,
WebAssembly, workers and the hosts it really uses (Google sign-in and Drive, Internet
Archive, jsDelivr, Hugging Face), and refuses inline script. Check in the browser that
OCR, speech, PDF, the local model, Drive and sharing still load.

### S3 `files:download-url` fetches any address `[!]`

Done in `98c51b9` (`archive-download.js`): Internet Archive only, redirects checked, 2 GiB limit, cancel. Tested with a stand-in for Electron's network; a real download and a real cancel are still to try in the app. Left: the download is held in memory and copied twice on its way to the page; writing it to disk would be the real fix.

`apps/desktop/main.js` gives the reader's URL to `net.fetch`, which also reads `file://`.
It keeps the whole answer in memory with no limit, and the reader's abort signal is not
passed on, so an Internet Archive download cannot be cancelled on the desktop.

- Accept only `https://archive.org/` addresses (redirects to `*.archive.org` followed).
- Stop above a size limit; add a cancel message (`preload.cjs`, `archive-client.js`).
- Test the allowlist and the limit as a pure function.

### S4 Automatic saves have no size `[D]`

Done in `c3c1f44`. Slots saved before it have no size and show none.

`autosave.js` stores `project.byteLength`, but the reader passes the project as text, so
the File menu shows "NaN MB". Store the text's length in bytes; test with a string.

### S5 The sharing server accepts 1 GiB messages before hello `[!]`

Done in `cb92395`: only the first loopback connection gets the large limit. Tested over loopback, not with a second device or the tunnel. Left: until the host's reader has connected, a program on the host computer itself still gets the large limit; closing that needs the host token when the connection is made, which changes the protocol.

`collab-server.js` sets `maxPayload` to 1 GiB for every socket; the hub's guest limit only
applies once the message is in memory. Keep a small limit until the peer is the host
(loopback, host token), then raise it for that socket.

### S6 Unknown engine operations answer with a page view `[D]`

Done in `f5f606e`; the old and new worker gave the same replies to 49 messages on a sample note.

`worker.js` falls through to `view` for any name it does not know. Turn the chain into a
table of operations and refuse unknown names.

### S7 One bad page drops the recognized text of the rest `[D]`

Done in `09f71de`.

`set_recognized_text` (`noteful-wasm`) stops at the first page the core refuses, and the
reader ignores the error. Skip the page, keep the others, and report how many were kept.

## Performance

### P1 Every edit re-renders the whole page `[ ]`

Steps 1 and 2 done in `4fc659b` (`view.rs`; the old code stays as a test-only reference and every sample is compared against it). In WebAssembly, with the page already drawn once, `view` after one more stroke went from 21 ms to 2.3 ms at 500 strokes, 34 to 3.1 at 1000 and 138 to 9.2 at 4000. Step 3 is still to do: what is left is copying and parsing the whole page for one stroke.

After each edit the core builds the page's whole SVG (`Editor::view`) and the reader
replaces the page with `innerHTML`. Measured on `samples/Examen wuolah.noteful`, adding
strokes to page 1:

| Strokes added to the page | `view` | Sent to the page |
|---|---|---|
| 1 | 1.7 ms | 0.65 MB |
| 500 | 21 ms | 1.33 MB |
| 1000 | 34 ms | 2.01 MB |
| 4000 | 138 ms | 6.09 MB |

In order:

1. Keep each added line's SVG once it is made (by its place in the history), instead of
   cloning and formatting every line on every view.
2. Walk the history once per view: one pass that collects erased ids, adjustments,
   replacements, additions, images, layers and page sizes, instead of one walk each.
3. For `draw`, answer with the new item and the page's small fields (as `adjust` already
   answers with `item_patch`), and have the reader append it to the layer. The full view
   stays the fallback, and a sharing session must still end with the same page.

Check: the bench above again, `tools/perf_bench.mjs`, and the ink e2e scripts.

### P2 Rotated shapes render the page twice `[ ]`

`draw` with `turn` in `worker.js` parses a whole view to read `edit_count`. Have `draw`
return the new item's id.

### P3 Auto-save serialises the note twice `[ ]`

Each minute with changes: `save` (the whole source as base64) and then `export` only to
hash it. Hash the content in the core without building the export in JavaScript, and skip
the export when the history mark has not moved. Measure on a note of 200 MB or more first.

### P4 pdf.js is shipped unminified `[!]`

Done in `95d8fbb`; the shell went from 8.2 MB to 6.5 MB with P5. Still to do: open a PDF in the rebuilt reader.

`tools/build_web.py` copies `pdf.mjs` and `pdf.worker.mjs` (3.09 MB). The `.min.mjs`
builds are 1.72 MB. Copy those (under the names the reader loads, or change the names in
`pdf-background.js` and wherever the worker is named) and check a PDF opens.

### P5 No release profile for the WebAssembly build `[D]`

Done in `83886dd`: the module is 2.48 MB (was 2.78 MB), the CLI 3.67 MB (was 4.92 MB). A full release build of the CLI now takes about 75 s.

`[profile.release]` with `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`: the module
went from 2.85 MB to 2.56 MB in a trial. Check the CLI still builds and runs as before
(the profile is the workspace's). `wasm-opt` is a further step when the tool is at hand.

## Repetition

### R1 The download-queue button, three times `[!]`

Done in `9a4639e` (`queue-controls.js`); markup unchanged and pinned by tests, not yet seen in the app. The icons stay in that module: `icons.js` cannot draw circles or other stroke widths.

`archive-browser.js` and `drive-browser.js` each write the queue button, its three states,
the selection check box and `updateQueueControls`; `app.js` has the same three icons
again. One module for the button and the controls, icons in `icons.js`.

### R2 The snapshot frame, twice `[D]`

Done in `848d88e`: a test packs with each and unpacks with the other. They were identical.

`packSnapshot`/`unpackSnapshot` are in `apps/reader/sync.js` and
`apps/desktop/collab-hub.js`. It is the wire format, so the two must not drift. Either one
file used by both (the desktop app already ships the reader's files) or a test that packs
with one and unpacks with the other, both ways.

### R3 Small copies `[D]`

Done in `4e149aa`, `e8231a0` and `8427595`. Found on the way: both updaters ignore a fourth version number.

- `terminateProcess` in `ai-runner.js` and `transcriber.js`: one module (add it to
  `build.files` in `apps/desktop/package.json`).
- `parseVersion`/`newer` in `apps/desktop/updater.js` and `apps/reader/android-updates.js`:
  a cross-check test, as they live in different packages.
- `note-cover.js`/`note-facts.js` and the two rasterising paths in `pdf-background.js`.

### R4 The e2e scripts' opening lines `[!]`

Done in `4460762` (`tools/e2e_common.mjs`, 20 scripts). Playwright is not installed on this machine, so the scripts were checked for syntax only: run them once where it is.

About 13 scripts in `tools/` start with the same 8 to 13 lines (server, browser, page).
One `tools/e2e_common.mjs`.

### R5 The WebAssembly adapter `[D]`

Done in `400ce8c`; the generated JavaScript is the same apart from `set_recognized_text` returning a count.

`crates/noteful-wasm/src/lib.rs`: `slot(page).map_err(js_error)?` about 20 times,
`pick_item` and `pick_lockable` alike, two compact reports written by hand. A small error
conversion, one helper for the page, `Serialize` on the report.

## Code quality

### Q1 `Editor::view` ends in one 1,590-character line `[D]`

Done with P1 in `4fc659b`.

`crates/noteful-core/src/editor.rs`: split the final `json!` into named values (shapes,
tapes, page sizes, timings), so `rustfmt` formats them. Goes with P1.

### Q2 `app.js` is 6,114 lines `[ ]`

59 module-level variables, 217 functions, 167 click handlers. Move out, one at a time and
each with its tests, the parts that have a clear edge: auto-save, the download queue's
window, page export wiring, the text box editor. No behaviour change; one commit each.

### Q3 Errors that are dropped `[ ]`

61 `.catch(() => {})` in the reader. Keep those that are truly optional (with the comment
the code already uses, `/* Optional. */`), and report the rest with `console.warn` or the
status line.

### Q4 Stale comments `[D]`

Done in `8d3eb54`.

The two doc lines above `compose_with` in `noteful-wasm` belong to functions that moved.

## Tests

### T1 Fewer test programs, no repeated tests `[D]`

Done in `8ef147a`: one program, samples embedded once. Building the tests after a change to the core went from 2.45 s to 1.58 s, and from nothing from 8.9 s to 7.8 s. No test was removed: every one was read and none repeats another.

`crates/noteful-core/tests/` has 16 files, and Cargo compiles and links each as its own
program against the core, which is most of the time `cargo test` spends building.

- One integration test program: `tests/it/main.rs` with the 16 files as modules.
- Remove tests that check the same thing twice (the same fixture and the same assertion in
  a unit test and an integration test, or in two integration files), keeping the one
  closer to the code. Every removal is listed in the commit message with the test that
  still covers it.
- Large fixtures read with `include_bytes!` in several places are read once from a shared
  helper.
- Measure `cargo test --workspace --no-run` from a clean build before and after.

The JavaScript tests are not compiled; only exact repeats are removed there.

## Housekeeping

### H1 Binaries in the repository `[D]`

`apps/mobile/work/wasm-tools/bin/` held 22 MB of macOS `wasm-bindgen` tools, committed by
accident (the ignore rule covered only the root `work/`). Removed, and `work/` is now
ignored everywhere. They are still in the history: taking them out of it needs a rewrite
and a forced push, which is a separate decision.

### H2 Documents `[D]`

Done in `a68240c`.

- `docs/REQUESTS.md` and the "Next steps" of `DEVELOPMENT.md`: each open item checked
  against the code and the changelog, and marked as it really is.
- `PERFORMANCE-CONCERNS.md`: items 7 and 8 closed when P1 and P3 are.
