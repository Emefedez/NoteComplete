## What's new in 2.0.42

- **Clickable local file links in Ask AI and on notebook pages.** Local `file://` links, bare absolute paths, paths with spaces or parentheses, and `#page=N` jumps now survive Markdown rendering in Ask AI and Scratchpad and open directly at the target page; `file://...#page=N` links on notebook pages open the linked file too.
- **Open notes reload after AI expansion.** Expanding an already-open notebook via AI/MCP now reloads the updated file cleanly from disk when there are no unsaved edits.
- **3-way AI document format setting (`Both` by default).** Reworked *Prefer Markdown* into *Both ink & Markdown (AI chooses)*, *Markdown only (+ prefabs)*, and *Handwritten ink only (+ prefabs)* across Setup, AI tools, MCP instructions, and bundled skills.
- **Noteful ↔ `.nfedit` text box conversion & `.nfedit` default for MCP.** Editing a Noteful-imported text box now converts it in place into an editable `.nfedit` text box (supporting KaTeX math `∑`) in one undo step, and MCP notebooks default to `.nfedit` so interactive prefabs and KaTeX math are preserved.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
