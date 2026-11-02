# `.nfedit` and `.notecomp`: why both

NoteComplete saves a note in two formats of its own. This page records why both exist, what each loses, and the decision taken (November 2026, version 1.1.6).

## What each holds

| | `.nfedit` (project) | `.notecomp` (package) |
| --- | --- | --- |
| Layout | One JSON file ([spec](../spec/nfedit-v1.md)) | A tar archive ([layout](../spec/nfedit-v1.md#notecomp-archives)) |
| The note | The **original file, untouched** (Base64), plus every edit as a list | The note **flattened** into one Noteful file by the native writer |
| Undo and redo | Kept, including redo after reopening | Not kept: the note reopens as it was saved |
| Drawn shapes | Keep their corners, so they resize as shapes later | Become outlines (filled ones become highlighter bands) |
| Locks on ink | Kept | Locked ink is unlocked (Noteful ink has no lock field) |
| Markdown notes | Kept (`markdown`) | Kept (`notes.md`) |
| Text of handwriting (written or recognized) | Kept | Kept |
| Recordings added in NoteComplete | **Not kept** (they stay on the device) | Kept (`audio/`) |
| Opens elsewhere | NoteComplete only | Any tar tool; `note.noteful` opens in Noteful |
| Size | Original × 1.33 (Base64) plus the edits | About the size of the note, plus audio |

## The assessment

- `.nfedit` is the only format that never re-encodes the original. Every other save goes through the native Noteful writer, which is still experimental: edited exports have not been verified in Noteful itself.
- `.notecomp` is the one to share and keep everyday notes in: one file, with notes, recordings and handwriting text, readable by other tools.
- Neither replaces the other today. A user who wants their undo history, or wants a copy that cannot be harmed by a writer bug, needs `.nfedit`; a user who wants one file with everything needs `.notecomp`.

### Merging them was considered

Carrying the edit history inside `.notecomp` (the original note plus `edits.json` next to the flattened `note.noteful`) would make one file both lossless and shareable. It would also roughly double the size of notes with large PDFs, because the original and the flattened note would both be stored, unless the archive layout changed to keep only one of them.

## Decision

`.nfedit` stays as it is: offered by **File → Save project**, opened everywhere, and unchanged in format. `.notecomp` remains the everyday format. This page should be revisited if the native writer is verified against Noteful, since that removes the main reason a lossless copy is needed.
