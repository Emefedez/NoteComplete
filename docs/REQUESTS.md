# Requested changes (owner, 2026-10-27 → 28)

The owner's requests from the latest review, in one place. Each item is marked when it lands, with how it was checked. ✅ done · 🔧 in progress · ⏳ to do.

## Study: quizzes and flashcards
- 🔧 Generate in the background with real progress: a bar chip with phase, elapsed time and continuous progress, plus Stop. Previously the bar jumped once per batch.
- 🔧 Quizzes saved per note and resumable. Answers are stored as they are given.
- 🔧 Quiz panel can be minimized, so you can read the theory while answering.
- 🔧 Questions about content, not about worked-exercise solutions. At most one in ten is a new exercise, marked **NUEVO EJERCICIO**.
- 🔧 No "longest answer wins": the prompt asks for options of similar length and detail, and the client shuffles them.
- 🔧 No per-answer explanations. The AI gives the page and box where the notes answer it.
- 🔧 Hint: that region is captured when the question is shown, so no image is stored. Scoring: 2 points correct, 1 if the hint was used, 0 if wrong. Falls back to the whole page when there is no box.
- 🔧 Clarify button: asks the AI about that question with the hint region as context.
- 🔧 Editable quiz instructions (system prompt), with Restore default.
- 🔧 Keys in the quiz: 1–4 answer, H hint, C clarify, Enter next, M minimize, Esc minimize.

## AI chat
- ⏳ Ask AI also in the Study menu (kept in the bar).
- ⏳ Resizable chat panel.
- ⏳ Grab tool: drag a box on the page to add that region to the chat, or copy its text (PDF, OCR and typed).

## Tools and layout
- 🔧 All tool settings as horizontal rows of visual choices (like Shapes): highlighter mode, color swatches, width, tape shape.
- 🔧 Tool settings open under the pressed tool button, not always in the same place.
- 🔧 Rectangle tape (drag a box), besides strips; tape has square ends.
- 🔧 Trackpad pinch / Ctrl+wheel zoom towards the pointer. Only a CSS transform runs during the gesture, then one re-raster.
- ⏳ Type a zoom percentage in the zoom box.
- ⏳ Keyboard shortcuts for everything (tools, study, quiz), listed in Help.
- ⏳ Audio and transcription as a vertical side panel opened from an icon next to Layers: play/pause icons, seek, transcribe with model choice, edit the transcript, follow along with the ink, download the recording.

## Files
- ⏳ Remove notes from Recent and the downloads folder, with the option to update the Drive copy first.
- ⏳ Enter starts the Drive note search.
- ⏳ Progress bar for Drive downloads.

## Format
- ⏳ "7-electronica digital copiar 2": `Unsupported object type 19`.

## Earlier in this review (done)
- ✅ Tape (kind 3, tool 2) and lock in place (payload tag 21); tap to lift or cover tape.
- ✅ Compact tool row; Ctrl +/−/0 on any keyboard layout.
- ✅ Pages stay put when the bars change height.
- ✅ Shapes as an icon row; File → New window and window switching from Ctrl+K.
