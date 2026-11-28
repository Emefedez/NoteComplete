## What's new in 2.0.43

- **Reorder notebook pages from AI/MCP (`move_page`).** The NoteComplete MCP can now move any page to a new display position (`move_page(path, from_page, to_page)`), keeping a backup when editing in place and returning a preview of the page in its new place. AI study workflows can restructure or rebalance crowded notes instead of rebuilding them from scratch.
- **Stricter layout rules for AI-generated handwritten notes.** The bundled skills now require a `page_layout` check before placing prefabs or text boxes, with 24–32 page units of clearance from every existing box, and document how to reorder pages, use pre-run editable R prefabs, and keep KaTeX math boxes pure LaTeX at size 20–22 with prose labels in ink.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
