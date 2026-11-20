## What's new in 1.2.66

- **Simplified Chinese IME: removed standalone Pinyin-typing mode (`ā`) & keep-marked-Pinyin Enter modes.** The `中` toggle and `Ctrl+Shift+Space` now switch directly between **Off ↔ Hanzi**, since Pinyin over characters is already handled cleanly by **View → Pinyin over characters (`拼`)**. Removed all dead `pinyin`-mode, `Enter = Auto / Convert to tone-marked Pinyin`, `lineBefore`, `hasMarkedPinyin`, and `.zh-ime-py` code paths while migrating any legacy stored preferences cleanly.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
