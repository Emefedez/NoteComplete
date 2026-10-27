# Requested changes (owner, 2026-10-27 → 28)

The owner's requests from the latest review, in one place, with how each was checked. ✅ done · ⚠️ done, not verified against the real service · ⏳ to do.

## Study: quizzes and flashcards
- ✅ Generated in the background with real progress: a bar chip shows the phase, elapsed time and continuous progress, with Stop. *Browser test with a fake AI bridge.*
- ✅ Quizzes saved per note and resumable (Q). Answers are stored as they are given. *Reopened the note and resumed at question 3 with the score kept.*
- ✅ The quiz panel floats over the pages and minimizes (M) to a pill, so the theory stays readable.
- ✅ Questions about content, not about worked-exercise solutions. Rare new exercises are marked **NUEVO EJERCICIO**. Options of similar length, shuffled locally. *Prompt checked by unit tests.*
- ✅ No explanations. The AI cites a page and box, and the hint is cut from that region at runtime. Scoring: 2 correct, 1 with the hint, 0 wrong. Falls back to the whole page.
- ✅ Clarify (C): asks the chat with that region attached.
- ✅ Dispute (X, press twice): the question stops counting, is left out of retakes, and new quizzes are told to avoid it.
- ✅ Double check (V): asks the AI again. The reply lands in an editable box with the options, and the correction is saved with the note's quizzes.
- ✅ Retake wrong answers (Shift W), gathered from all the note's quizzes.
- ✅ Editable quiz instructions, with Restore default.
- ✅ Keys: 1–4 answer, H hint, C clarify, X dispute, V double check, Enter next, M or Esc minimize.

## AI chat
- ✅ Ask AI in the Study menu as well as the bar (Ctrl+J).
- ✅ The chat panel resizes from its left edge; the width is remembered.
- ✅ Grab tool (G): drag a box to copy its PDF, OCR and typed text in reading order, or add it to the chat. *Copied a Temas1+2 paragraph in the browser.*

## Tools and layout
- ✅ Tool settings are rows of visual choices: highlighter mode, color swatches, widths, tape shape.
- ✅ Tool settings open under the pressed tool button. *Measured: same x as the button.*
- ✅ Rectangle tape (drag a box), besides strips. Tape has square ends and a washi stripe pattern, including Noteful's own tape.
- ✅ Pinch or Ctrl+wheel zooms towards the pointer: a CSS transform during the gesture, then one re-raster. *0 page re-renders mid-gesture.*
- ✅ Type a zoom percentage (or "fit") in the zoom box.
- ✅ Single-key shortcuts for tools, study, quiz and audio, listed in Help → Keyboard shortcuts (?).
- ✅ Audio and transcript in a side panel opened from the headphones icon next to Layers (A): play/pause icons, ±10 s, seek, show the handwriting, dim future ink, download the recording, transcribe with model and language choice, follow along, export, and edit words while keeping their timings (K, J, L).

## Files
- ✅ Remove a note from Recent and the downloads folder (× on its card).
- ⚠️ If it is the open note with unsaved changes, upload them to Drive first. Write access is asked for only then.
- ⚠️ "Also delete it in Google Drive": a red section that needs DELETE typed, and moves the file to Drive's trash, restorable for 30 days. *Both Drive writes are unit-tested against a fake server; they need a real sign-in to confirm.*
- ✅ Enter starts the Drive note search.
- ✅ Progress bar and percentage for Drive downloads.
- ✅ `tools/update_appimage.py` rebuilds everything and replaces the installed AppImage, keeping `.previous`.

## Format
- ✅ "7- ELECTRÓNICA DIGITAL Copiar 2": object kind 19 is a tag ("#SD I"). It renders as a pill and is searchable as text.

## Earlier in this review
- ✅ Tape (kind 3, tool 2) and lock in place (payload tag 21); tap to lift or cover tape.
- ✅ Compact tool row; Ctrl +/−/0 on any keyboard layout.
- ✅ Pages stay put when the bars change height.
- ✅ Shapes as an icon row; File → New window and window switching from Ctrl+K.
