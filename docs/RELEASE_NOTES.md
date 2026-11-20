## What's new in 1.2.62

- **View → Pinyin over characters (拼) restored.** Added the Pinyin overlay toggle back to the **View** menu (`#viewRubyToggle`), synced live with the Text format bar and Markdown Pinyin controls.
- **Fixed moving text boxes from the `⋮⋮` grab handle (including with Pinyin overlay) & direct move in Text mode.** Moving a text box from its `⋮⋮` grab handle no longer passes an item patch through `edited()` (which previously threw `Cannot read properties of undefined (reading '0')` and broke the page/box) and now accumulates existing translation/scale/rotation cleanly across repeated moves without re-querying Pinyin on every drag pixel. You can also move text boxes directly without switching to Select: **hold left-click (or drag)** on an existing box in Text mode to move it instead of entering edit mode, or while editing, **drag outside the box without selecting text** to reposition it.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
