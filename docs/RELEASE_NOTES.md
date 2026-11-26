## What's new in 2.0.9

- **MCP prefabs for Markdown, HTML & Euro-Office.** `add_prefab` now inserts NoteComplete prefabs into Markdown (`.md`/`.markdown`/`.txt`), HTML (`.html`/`.htm`), notebook Markdown notes (`target: "notes"`), and Euro-Office documents (`.docx`, `.pptx`, `.odt`, `.odp`), with support for `position`, `after_heading`, and `replace_placeholder`. Markdown and HTML prefabs embed `data-nc-prefab-spec` so they remain double-click editable in NoteComplete.
- **New `create_markdown` MCP tool.** AI agents can create standalone Markdown documents with inline editable prefabs in one step using `<!-- PREFAB:key -->` or `{{prefab:key}}` placeholders.
- **Prefer Markdown (.md) for AI-generated documents setting.** Added a toggle in **Help → Connect AI tools…** and **Help → Setup wizard…** (AI & Modules steps) backed by `mcp-settings.json` so connected MCP agents default to Markdown documents with embedded prefabs instead of handwritten notebooks.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
