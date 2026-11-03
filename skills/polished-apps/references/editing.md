# Editing: the undo log, previews and region tools

Edits live in an operation log over immutable source data (see `stack.md`, Persistence). These rules keep that log honest, the screen steady and the file from growing without end.

## One action, one undo step

- A command that changes many things at once (move a group, resize every page, insert pages with their text) is **one** undo step. Commit one edit per item and mark the rest `joined` to the first; undo and redo walk over joined edits together. Keep the flag in the project file (absent = false) so the join survives reopening.
- Check every item before committing any: either all change or none ("page 2 cannot take that size"). Skip items already in the target state and say so when nothing changed ("Every page already has that size").
- Relative options follow each item's own reference ("add half a width" doubles each page from *its* original size; "Original" means each one's own), so mixed documents get what the user meant.
- Offer the batch where the single action lives: the same dialog, a second button ("Resize this page" · "Resize all pages").

## The preview is the result

- What the user sees while dragging is exactly what lands on release. Compute the commit from the same transform as the preview: for a group, each member moves by where the group's matrix takes **its own centre**, not by the matrix's offset (that only holds at scale 1).
- Visual properties scale with the geometry as the preview shows them: stroke width × √(sx·sy) when ink is resized, so an enlarged highlighter still covers what it covered. Clamp to the model's limits.
- After the commit, the selection box goes around the result (corners of the new matrix), not the old box moved.
- Test it: record element boxes during the drag and after the commit; they must match within a pixel or two.

## Nothing blinks

- A finished stroke, a typed box, another person's live line stays on screen as drawn until a render that **contains its edit** replaces it (track edits by revision; hand the overlay over to the new render, never clear it first). Redraws for other reasons (zoom, a new raster, someone else's edit) keep what is still pending.
- In a shared session, a peer's live line is handed to the page when their edit arrives, not dropped early.

## Region tools

- Dragging out a region (grab, lasso) shows a small **icon menu** at its edge: select what is inside, copy its text, ask AI, attach to chat, erase, cancel. Icons with titles and `aria-label`s, 30px buttons, one row (`.region-menu` in components.css); the main action pale accent.
- Region erase sweeps the eraser through the region in rows two radii apart (one undo step), so it erases exactly what the eraser tool would: make sure every kind of item the eraser can't reach is fixed at the source (give shapes hit outlines), not special-cased in the region tool.

## Keeping the log small

A log that keeps every edit grows forever. Let the user **delete the history** up to a point:

- Points: every automatic save remembers `{edits, digest of the first edits}`; a save is offered as a point only while the current history still starts with it. Plus "up to now".
- Compaction keeps only what shapes the document now: items added and later erased go with all their edits; of an item's adjustments only the last of each run that doesn't change a lock (absolute values, not steps); the last reshape and the last text; to now, also the redo branch. Positional ids are renumbered everywhere.
- Undo stops at a **floor** saved in the project; edits after the point still undo and redo.
- **Verify before replacing**: reopen the compacted project from its serialized form and compare every page's rendering (without ids) with the document before; any difference fails and changes nothing.
- Report what it did ("57 edits fewer, 340 KB smaller. Save to keep it.") and ask once before ("You will not be able to undo past this point"). Not while a shared session needs every copy's history identical.
- UI: a small ✂ beside each save in the File menu's list, and "Delete history up to now" below it.

## Automatic saves

Copies every minute while changed, never over the user's file; a few per document, oldest dropped; offered on open when newer than the last manual save. Each is a full lossless project; they double as the points to compact to.
