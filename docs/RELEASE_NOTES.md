## What's new in 1.2.65

- **Styled Home sort dropdown (`A – Z`, `Last opened`, …, `Smallest`).** Replaced the raw native HTML `<select>` inside the Home sort pill with a custom button & styled radio menu matching `Type`, `Modified`, `Source`, and `Size`—clicking anywhere on the pill (including the arrow caret) now opens and closes the dropdown cleanly, with animated caret rotation and keyboard navigation (`↑`/`↓`/`Esc`).
- **Fixed mid-syllable Chinese tone splitting (e.g. `qi1n`, `q1in`, `qin1g`, `qi1an`).** Tone digits typed anywhere inside a syllable (before vowels, `-n`, `-ng`, or compound finals like `ian`/`uan`/`iang`) now stay attached to the full syllable instead of breaking into two space-separated fragments (`qī n`, `qīn g`, `qī an`), while preserving real multi-syllable boundaries (`ni3hao`, `ma1ne`, `xi1nan`, `qi2ngan`).

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
