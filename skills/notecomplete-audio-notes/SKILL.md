---
name: notecomplete-audio-notes
description: Read, correlate, and synthesize NoteComplete notebooks that have audio recordings synced with handwriting ink. Automatically checks ink-to-audio timestamp bursts, reads OCR/typed/PDF text, falls back to page images whenever handwriting OCR is missing, and aligns lecture transcript segments with what was written on each page. Use when working with recorded lectures, timed ink notes, or summarizing NoteComplete notebooks with audio.
---

# Audio-Synced NoteComplete Notes

Use this workflow whenever a user asks you to read, summarize, transcribe-align, or make study material from a NoteComplete / Noteful / Goodnotes / Notability notebook that has audio recordings or handwritten pages.

## Step-by-step workflow

1. **Inspect the notebook structure first**
   - Call `note_outline(path)` to see page count, `recordings`, and per-page `timed_ink`, `typed_text`, and `handwriting_text` snippets.

2. **Map pages to audio timestamps**
   - Call `page_audio_timeline(path)` (or `page_audio_timeline(path, page)` for a single page).
   - It returns each page's `audio_windows` (`recording_id`, `recording_name`, `first_mmss`–`last_mmss`, and contiguous writing `bursts`) plus `needs_page_image`.

3. **Read every target page without missing handwriting**
   - Call `page_text(path, page)` to get `typed_text`, `pdf_text`, `handwriting_text`, `audio_windows`, and `needs_page_image`.
   - **Critical fallback:** whenever `needs_page_image` is `true` (meaning the page has ink that was neither written from Markdown nor OCR'd in NoteComplete), **immediately call `page_image(path, page)`** to visually read the handwriting, diagrams, highlights, and margin notes. Never assume a page is empty just because `handwriting_text` is empty!

4. **Correlate audio recordings / transcripts**
   - If the user provides a transcript or asks to check what the speaker said during a specific writing burst:
     - Match the page's `bursts` (`start_mmss`–`end_mmss`) against the transcript timestamps for that `recording_name`.
     - If you need the raw audio file to run local transcription, call `extract_resource(path, kind="audio")` to list audio indices, then `extract_resource(path, kind="audio", index=N, out_dir=...)`.

5. **Produce the output in the user's preferred format**
   - Check the MCP server's initialization instructions: if **Prefer Markdown (.md)** is enabled (or the user asked for Markdown), use `create_markdown` with `<!-- PREFAB:key -->` placeholders for diagrams/charts.
   - If adding notes to an existing `.notecomp` / `.nfedit`, use `write_notes(path, text, page=N)` with `<!-- page N -->` markers and `[MM:SS]` timestamp references.
   - If the user asked for flashcards, draft them grouped by page + timestamp and save with `write_anki_deck`.
