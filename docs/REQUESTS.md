# Requested changes (owner, 2026-10-27)

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

## Audio and transcription (second round)
- ✅ Compact transport: square-rounded buttons in one row. "Go to where this recording starts" and "Dim ink not yet written" are two small icon buttons to the right of back/play/forward. The confusing "Show handwriting" label is gone.
- ✅ Dimming checked in the browser with the Practice book recording: all timed ink dimmed at 0 s, two of three strokes shown at 10 s, all shown with dimming off. *If it still looks wrong on one of your notes, tell me which note and page.*
- ✅ Transcription keeps running in the background: switching recordings or closing the panel no longer cancels it, and a bar chip shows its progress. Only Cancel stops it.
- ✅ Text appears while transcribing (greyed until timings are final): Whisper sends each 30 s window, other engines each piece.
- ✅ Engine choice: Whisper on this device; Voxtype (local whisper.cpp, 30 s pieces cut by ffmpeg); Gemini via Antigravity (cloud, 10-minute pieces three at a time, sends audio to Google). *The desktop pieces are tested with the real Voxtype and Antigravity CLIs.*
- ✅ Export as text, SRT, WebVTT or JSON with word times.
- ✅ The audio and Ask AI panels share one look and resize from the left edge, the bottom edge or the corner; sizes are remembered.

## Reader (second round)
- ✅ Dark pages (D, or the moon next to Pages): inverts the document's lightness, keeping hues, including the page previews. Presentation only.
- ✅ Find can be limited to any combination of Text, PDF, OCR and Audio, with a count per source.
- ✅ Recent cards: a ⋯ button in the card's top corner, always visible, opens a menu anchored to it (dropping up when there is no room below); right-clicking the card opens it too. It replaces the hover-only × and the centred dialog. *Removed a note and opened the menu by right-click in the browser.*
- ✅ Background-job chips and "Open …" buttons shrink with the compact bar and truncate on narrow windows.
- ⏸️ README with screenshots and a header graphic, using the sample corpus only (no private notes). **On hold** at the owner's request until the items below are done.

## Flashcards and keys (third round)
- ✅ The practice card has a fixed size: showing the answer no longer resizes the dialog. *Measured: 513 px before and after every reveal.*
- ✅ Practice text is left-aligned inside a block centred in the card, so lines share one left edge; the hidden answer keeps its space, so the question does not move on reveal. *Question's left edge measured equal before and after.*
- ✅ Cards before export are shown as readable cards (question over answer, page badge, ✕), not two clipped textareas. Click a card to edit it in place with fields that grow to the text; Esc or Ctrl+Enter finishes.
- ✅ Answers keep the model's structure: the prompt asks for one list item per line, and inline enumerations ("1) … 2) … 3) …", "a) … b) …") are split one per line, also in decks saved earlier. Anki export keeps the breaks as `<br>`. *Unit test with the SECDED Hamming (8,4) answer: four lines.*
- ✅ Practice keys: Space shows the answer, 1 not yet, 2 I knew it.
- ✅ Decks deleted themselves when reopened from Study → Saved decks and quizzes. Cause: a style made each row's ✕ as wide as the open button, so the right half of every row deleted it at once. The saved list now has separate **Flashcard decks** and **Quizzes** sections; ✕ is a small separate button that asks "Delete …? Delete / Keep", and a deleted item can be restored with **Undo** until the dialog closes. *Browser test: Keep, Delete, Undo.*
- ✅ Your lost 50-card ACII deck was recovered from the app's storage log and saved as `~/Downloads/ACII-mazo-recuperado.json`; bring it back with the new **Import deck…** button in the same dialog (with the ACII note open). *Import tested: 50 cards.*
- ✅ **?** outside a text box toggles key badges on the buttons: tools, Ask AI, Layers, dark pages, audio transport, the new audio buttons (Shift A: go to the recording's page; I: dim ink), quiz minimize, practice. Labelled buttons show the key after the label, icon buttons a corner badge; Ctrl shortcuts stay in the menus. Help → Keyboard shortcuts still lists everything.

## Open issues (reported, not yet fixed)
- ⚠️ Drive: after searching (or filtering a folder), Back showed more folders than at first. Cause: Back always went up one folder, so from a reopened folder it fell to a Drive-wide name search. Back now returns to the view before the last search, filter or folder change. *Unit-tested; not yet checked against your real Drive.*
- ⏳ Recent notes not appearing on Home (desktop app). Not reproduced: your installed app's storage still holds two Recent entries (ACII and AL-lite), and Recent shows in the browser test. A card that fails to render is now skipped instead of emptying the list. Needs: does the "Recent" heading show at all, and does it happen only after a Drive search?
- ⏳ Some notes (for example *Discover Chinese*) never load their thumbnail. To investigate: how the cover is found in that file (byte-range read of the head and tail).

## Home filters
- ✅ Stackable filters over Recent and Drive: modified date (today, week, month, year), with audio, size (under 10 MB, 10–100 MB, over 100 MB) and Noteful tags. All selected tags must be present.
- ✅ Sort: A–Z by default (natural order: "Tema 2" before "Tema 10"), or newest, oldest, largest, smallest. Drive folders stay on top.
- ✅ Recordings and tags are read with byte ranges, sharing the cover's head and tail reads, and kept per file version. Notes whose pages exceed 3 MB are marked "not yet read for tags" until opened once. *Browser test with four real notes on a simulated Drive.*
- ✅ Releasing a pinch no longer shifts the document: the page point under the pointer is kept (measured drift under 1 px).

## Format
- ✅ "7- ELECTRÓNICA DIGITAL Copiar 2": object kind 19 is a tag ("#SD I"). It renders as a pill and is searchable as text.

## Earlier in this review
- ✅ Tape (kind 3, tool 2) and lock in place (payload tag 21); tap to lift or cover tape.
- ✅ Compact tool row; Ctrl +/−/0 on any keyboard layout.
- ✅ Pages stay put when the bars change height.
- ✅ Shapes as an icon row; File → New window and window switching from Ctrl+K.
