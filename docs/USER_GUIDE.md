# User guide

## Open and navigate

Choose **Open document** in the hamburger menu or drop a `.noteful`, `.nfedit`, PDF, PNG, JPEG or WebP file into the reader. PDF pages scroll continuously; the Pages panel shows previews. The UI is English; note content, saved layer names and recording names retain their original text. Pages scroll continuously and only nearby pages render. **Page** jumps to a page. **Fit** adapts its width; **− / +** change zoom by ten percentage points, from 10% to 400%.

The toolbar compacts when scrolling down and returns when scrolling up. Its arrow provides a manual override. On phones, compact mode keeps playback and seeking available while hiding secondary controls.

## Open from Google Drive

Choose **☰ → Google Drive** in the browser or an installed NoteComplete build, connect your account, find the Noteful folder and select a file to download and open. Subfolders, Refresh and paginated listings are supported. Local edits are never uploaded to Drive. Unsaved edits are checked before opening a downloaded document. See [Google Drive setup and platform support](GOOGLE_DRIVE.md).

## Display quality

Open **☰ → Display quality**. Choose **Performance** (1×, 4 MP/page), **Balanced** (2×, 12 MP/page), or **Sharp** (3×, 20 MP/page, slightly stronger contrast). Adjust any slider to customize the preset:

- **PDF resolution**: raster pixels per displayed pixel, from 1× to 3×. Vector ink remains sharp independently.
- **Page pixel budget**: 4–24 megapixels per PDF page. This caps resolution on large pages to control memory.
- **Page contrast / brightness**: tune the page and preview appearance; the sample updates inside the dialog.

**Apply** saves locally and redraws nearby PDF pages only when resolution changes. **Cancel** or Escape discards changes. Presets also restore their brightness and contrast. Original image detail cannot be recovered by increasing resolution. Exported colors and document edits are unaffected; these preferences are not saved inside projects. Thumbnails remain small bitmaps to keep long notes responsive. On a slow device, start with Performance and collapse the transcript when unused.

## Draw and edit

| Tool | Behavior |
|---|---|
| Pan | Drag with a mouse or scroll with touch. |
| Select | Select existing ink, supported shapes, images or text placement; drag to move, use four corners to resize, or the upper handle to rotate. The inspector changes dimensions/angle and ink/shape stroke color and width. |
| Pen | Fixed-width freehand ink; no pressure input required. |
| Highlight | Straight segment by default; choose Freehand for sampled ink. Multiply at 50% preserves the appearance over images. |
| Erase | Remove whole strokes and supported line objects. Other selected objects can be deleted with Select. |
| Image | Import PNG, JPEG or WebP onto the current page, then move or resize with Select. |
| Shapes | Draw a bounding box or use Insert for a line, rectangle, ellipse, triangle or arrow. New shapes are editable outlines. |

Arrow keys on selection handles adjust geometry; Shift uses larger steps. Right-click an element on the page to remove it directly; Ctrl/Cmd Z restores it. Undo/redo are global across pages (Ctrl/Cmd Z and Shift Z). Escape or a cancelled pointer gesture discards its unfinished preview. Text-content/font editing and separate shape fill-color editing are not currently provided.

**Layers** selects where to draw, creates/renames layers, controls visibility/opacity and locks them. Hidden or locked layers cannot be edited. New strokes inherit the selected layer.

## Audio

Select a recording in the single player, then play, pause or seek. Nonempty recording names are shown unchanged; otherwise the UI generates a recording number/date. **Recording & sync** shrinks the bar back to the player even after the recording controls, handwriting options or transcript were opened, and expands them again. **Show handwriting** jumps to the first associated page. **Dim future handwriting** shows strokes at 20% opacity before pen-down and normally afterwards; seeking backwards restores dimming. This is whole-stroke timing, not point-by-point replay. Unrelated/untimed ink remains visible. Each recording retains its own playback position.

The supplied native audio example contains one recording. Multiple-recording behavior is tested using an explicitly synthetic fixture. Codec support varies by browser/device; **Download** remains available when playback is unsupported.

### On-device transcripts

For notes with audio, expand **Transcript** in the playback controls and choose
**Transcribe recording**. Whisper runs in a local WASM worker and detects
the spoken language when **Detect language** is selected. A progress bar shows
the model download and each transcription chunk while it runs. Castellano is the
default, with Galego and English available alongside other language options.
Expand **Language, model & audio** to select Tiny (fastest), Base (default) or
Small (higher accuracy, more memory). Gain and the voice filter affect playback
and transcription; normalization applies to transcription only. Processing never
overwrites the original recording. Changes take effect on the next transcription.
The cache distinguishes the model, language and audio settings.
The first run downloads model weights from Hugging Face; audio is never uploaded.
Downloaded weights are browser-cached when storage is available.

Words follow playback and clicking a word seeks the same clock used for timed
handwriting. Ink synchronization requires the note's original recording timestamps.
With **Pan** selected, click a timed stroke to seek its recording; dragging still
scrolls the page. The correct recording is selected automatically.
Automatic transcription and word boundaries can be inaccurate, especially for
noise or quiet speech. Processing speed and memory depend on the device.

Transcripts are cached by audio content in this browser on secure origins
(including localhost), and can be exported as JSON with word timestamps.
They are not included in `.nfedit` or `.noteful` exports. On LAN HTTP without
SubtleCrypto, transcripts remain available for the session and can be exported.
Use **Hide transcript** or its disclosure to collapse it. Long transcripts display
100 words at a time, with section arrows and optional automatic following. Hidden
transcripts perform no word highlight updates. Speech workers terminate after
completion or cancellation; page thumbnails retain small bitmaps only.

## Save and export

- **Save project .nfedit** keeps unchanged source bytes, edits and undo/redo history.
- **Export .noteful** flattens applied edits into a new native archive. It is experimental; see [writer limitations](../spec/nfedit-v1.md#native-export).
- **Export page SVG** includes the rendered PDF background and current layers/audio appearance. Wait for the PDF page to finish rendering.

Files download as new files; originals are not overwritten. Replacing a dirty document prompts before discarding edits. Native export does not mark the richer project as saved. Fonts resolve from the device; Apple fonts are not bundled. Exact native ink smoothing, advanced text layout and some object variants remain incomplete.

## Mobile and Android file opening

The Expo wrapper uses SDK 57 and the same browser/WASM engine. Install dependencies and start it as shown in the [README](../README.md#expo-go). The launcher serves web assets on LAN port 8768 and Metro on 8081. It does not serve the original corpus. Files selected on the phone are not uploaded. A Metro tunnel alone does not expose the separate reader server.

Use an Expo Go client compatible with the SDK 57 dependencies pinned in this repository. See [mobile setup](../README.md#expo-go).

For an existing hosted reader, set `EXPO_PUBLIC_READER_URL` before starting or building the wrapper. A standalone build needs that reachable HTTP(S) URL; the development LAN host is not available when Metro is absent. The browser reader can also be installed to the home screen over HTTPS. Its application cache supports offline use after assets have been cached; opened notes are never stored in that cache.

Exports in the wrapper open the OS share sheet. Select Save to Files or another destination. Dismissing a share sheet does not prove a file was saved, so unsaved-change protection remains active. Large exports temporarily require base64 copies in memory; there is no fixed MB ceiling.

Android default-file handling requires an installed NoteComplete build. Expo Go cannot register this project's own file associations. See the Android build instructions below; default selection remains an Android/user decision. Physical-device URI permissions, file-manager behavior, codecs and sharing require device validation.

### Android installed build

The Android app ID is `com.notecomplete.viewer`. Its manifest registers ACTION_VIEW for `.noteful` file/content URIs, the `application/x-noteful` MIME type, and generic `application/octet-stream` content-provider files. The generic fallback is needed for providers that hide the filename; it can also offer NoteComplete for other binary files, which the decoder will reject if unsupported. Some file managers use other MIME types or do not offer persistent defaults.

For local builds or GitHub Actions APK artifacts, follow [Installable builds](BUILDS.md#android-apk). That guide covers the hosted-reader URL, preview signing and build prerequisites.

In Android Files, choose a `.noteful` file, select **Open with → NoteComplete**, then **Always** if offered. Android controls that choice; the application cannot silently make itself the default. A running app receives new file intents too. The file is read using the provider's URI grant, queued until the reader is ready, and passed to the normal local decoder. Existing unsaved edits still require confirmation before replacement. This is file opening, not an ACTION_SEND share target.

Manifest generation and JavaScript bridge tests are validated. No Android SDK/device was available on the development host for APK compilation or an actual default-handler test. Physical-device validation is still required, particularly with opaque `content://` URIs and different file managers.
