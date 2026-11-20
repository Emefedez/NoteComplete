## What's new in 1.2.57

- **Complete Chinese dictionary definitions.** Rebuilt the bundled Chinese dictionary packs to preserve multiple clean English senses per entry without mid-word truncation or classifier noise (for example, `妈` now shows `mom; mother; ma` instead of just `ma`, and `他` shows `he; him; his`), with clean sense splitting and Spanish translation deduplication.
- **Chinese favourites (stars) & Stroke order shortcut in Look up.** Replaced **+ My words** with ★ star toggles in the Look up header and compound-word rows plus a **Favourites** list (with listening, one-click lookup, unstarring, and batch export to flashcards). Renamed **Stroke figure** to **Stroke order** with a pencil icon that opens the Stroke order editor directly.
- **Non-editable scrollable definitions in Stroke order.** Replaced the stray editable text box under Meanings in the Stroke order editor with a clean, read-only scrollable definitions box.
- **Web & mobile layout fixes.** Fixed desktop-site / narrow-desktop global bar overflow (tabs, `+`, Ask AI, and Commands stay visible without clipping), dynamic viewport (`100dvh`) and safe-area insets on mobile web, compact mobile navigation/toolbars, wrapped prefab picker tabs, and mobile Stroke order header/canvas sizing.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
