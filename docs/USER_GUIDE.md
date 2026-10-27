# User guide

## Open and navigate

Choose **Open document** in the hamburger menu or drop a `.noteful`, `.nfedit`, PDF, PNG, JPEG or WebP file into the reader. PDF pages scroll continuously; the Pages panel shows previews. The UI is English; note content, saved layer names and recording names retain their original text. Pages scroll continuously and only nearby pages render. **Page** jumps to a page. **Fit** adapts its width; **− / +** change zoom by ten percentage points, from 10% to 400%.

The toolbar compacts when scrolling down and returns when scrolling up. Its arrow provides a manual override. On phones, compact mode keeps playback and seeking available while hiding secondary controls.

## Study with your AI tool

Study and Ask AI use an AI tool already installed and signed in on your computer (Claude Code, Antigravity or Codex) and run in the desktop app. Pages are sent as images with tape lifted, together with their typed, PDF, recognized and transcript text.

- **Study → Quiz me (Shift+Q)** generates multiple-choice questions in the background; the chip in the bar shows progress and has Stop. Quizzes are saved with the note: **Q** resumes the latest, **Study → Saved decks and quizzes (Shift+D)** lists them, **Retake wrong answers (Shift+W)** gathers misses from all of them. In the quiz: 1–4 answer, **H** shows the region of your notes that answers it (a correct answer is then worth 1 point instead of 2), **C** asks the AI to clarify, **X** twice disputes a question that is wrong, **V** asks the AI to double check and lets you save the correct answer yourself, **Enter** next, **M** minimizes. **Edit quiz instructions…** changes what the AI is asked for.
- **Study → Generate flashcards (Shift+C)** makes an editable deck to practise or export to Anki.
- **Ask AI (Ctrl+J)** answers questions about the page, a selected item, or a region grabbed with the **Grab** tool (**G**), which can also copy the text of a region.

## Tape and locked items

Tape (Noteful's *Cinta*) hides parts of a page, typically answers. In Pan mode, tap a tape to lift it and tap again to cover; **View → Lift all tape / Cover with all tape / Tape as saved** applies to the whole note. Tape state is a viewing choice and is not saved. Items locked in place in Noteful cannot be selected, moved or erased. Zoom with <kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>−</kbd>, and <kbd>Ctrl</kbd>+<kbd>0</kbd> fits the page; this works on any keyboard layout.

## Insert pages

**Pages → Insert blank page…** adds white pages after or before the current page, or at the end: the same size as the current page, A4 or Letter in either orientation, 4:3 or 16:9 slides, or a custom size in millimetres. **Pages → Insert PDF pages…** adds a range of pages from another PDF at the note's own scale; *Extra writing space* makes those pages wider (or taller) with blank paper beside the PDF, like widened pages in Noteful. Each insertion is one undo step, and ink drawn earlier stays on its page. Inserted pages are kept in the project and in native `.noteful` exports (experimental, like all native export).

## Audio

The headphones button next to Layers (**A**) opens the recordings: play/pause (**K**), back and forward 10 s (**J**, **L**), seek, show the handwriting written at that moment, dim ink not yet written, and download the recording. **Transcribe** runs Whisper on this device (choose the model and language); the transcript follows the audio, and **Edit** lets you correct words while keeping their timing. Corrections are used by Find and the AI.

## Find in a note

**Edit → Find…** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd>, or type `find word` in the command palette) searches the open note's typed text, the text layer of its PDF pages, recognized text and recording transcripts. Matching ignores case and accents and accepts word beginnings (`memor` finds *memoria*). Recognized text and transcripts also accept one typing error in words of five letters or more, since recognition makes mistakes; for audio, try a couple of variants of the word. Enter/↓ and Shift+Enter/↑ step through matches, ☰ lists them by page with their source (Text, PDF, OCR, Audio), and highlights appear on the page. Audio matches also seek the recording. The PDF text is indexed the first time you search a note and kept for next time.

**Pages → Recognize text (OCR)…** reads handwriting and scanned pages so Find can search them. It never runs on its own: choose the current page, a page range or the whole note, pick the languages (Spanish and English by default) and start it. It runs on this device, about 5–10 seconds per page; the language data (a few MB per language) downloads once on first use. Pages that already have a PDF text layer are skipped unless you untick that option. Results are kept with the note, and Stop keeps the pages finished so far. Recognition of handwriting is approximate.

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

Installed Android builds include the reader and serve it on the device's loopback address, so no hosted website or computer is needed. To use a hosted reader instead, set `EXPO_PUBLIC_READER_URL` before starting or building the wrapper. The browser reader can also be installed to the home screen over HTTPS. Its application cache supports offline use after assets have been cached; opened notes are never stored in that cache.

Exports in the wrapper open the OS share sheet. Select Save to Files or another destination. Dismissing a share sheet does not prove a file was saved, so unsaved-change protection remains active. Large exports temporarily require base64 copies in memory; there is no fixed MB ceiling.

Android default-file handling requires an installed NoteComplete build. Expo Go cannot register this project's own file associations. See the Android build instructions below; default selection remains an Android/user decision. Physical-device URI permissions, file-manager behavior, codecs and sharing require device validation.

### Android installed build

The Android app ID is `com.notecomplete.viewer`. Its manifest registers ACTION_VIEW for `.noteful` file/content URIs, the `application/x-noteful` MIME type, and generic `application/octet-stream` content-provider files. The generic fallback is needed for providers that hide the filename; it can also offer NoteComplete for other binary files, which the decoder will reject if unsupported. Some file managers use other MIME types or do not offer persistent defaults.

For local builds or GitHub Actions APK artifacts, follow [Installable builds](BUILDS.md#android-apk). That guide covers the bundled reader, the optional hosted-reader override, preview signing and build prerequisites.

In Android Files, choose a `.noteful` file, select **Open with → NoteComplete**, then **Always** if offered. Android controls that choice; the application cannot silently make itself the default. A running app receives new file intents too. The file is read using the provider's URI grant, queued until the reader is ready, and passed to the normal local decoder. Existing unsaved edits still require confirmation before replacement. This is file opening, not an ACTION_SEND share target.

Manifest generation and JavaScript bridge tests are validated. No Android SDK/device was available on the development host for APK compilation or an actual default-handler test. Physical-device validation is still required, particularly with opaque `content://` URIs and different file managers.
