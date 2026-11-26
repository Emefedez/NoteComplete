## What's new in 2.0.10

- **Edit prefab… in Euro-Office right-click menu.** Right-clicking a NoteComplete prefab image inside Euro-Office (whether inserted via MCP or converted from Markdown) now offers **Edit prefab…**, opens NoteComplete's native prefab editor, and updates the image in place inside Euro-Office.
- **Audio-to-ink timestamp exposure in MCP.** Added `page_audio_timeline` (and `audio_windows` + `needs_page_image` on `page_text`) so AI agents can correlate ink writing bursts with audio recording timestamps and automatically fall back to `page_image` when OCR text is absent.
- **Bundled agent skills & Connect AI harnesses in Setup Wizard.** NoteComplete now bundles three agent workflow skills (`notecomplete-audio-notes`, `notecomplete-markdown-prefabs`, `notecomplete-handwriting-study`) and installs them automatically when connecting Claude Code, Codex, Antigravity, or OpenCode. The **Setup wizard → AI** step now includes the Connect AI harnesses & skills controls directly alongside the default assistant and Markdown preference.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
