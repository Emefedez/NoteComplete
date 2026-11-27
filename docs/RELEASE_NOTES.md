## What's new in 2.0.25

- **Fixed Moodle toolbar buttons.** Removed a stray `connected` reference in `moodle-browser.js` that prevented `Open in browser`, `Moodle tools`, `Queue`, `Back`, `Sign in again`, `Refresh`, `Disconnect`, and search from wiring up.
- **Fixed nested `$...$` in Math Adaptation.** Adapting an expression that already contains adapted math (e.g. `5^(5-43) - 12 + $\binom{5}{3}$`) or selecting inside an existing `$...$` span now merges cleanly into one valid math box instead of creating broken nested `$` delimiters.
- **`Shift + Right-click` instant Math Adaptation.** Highlighting non-Chinese text in any editable field and pressing `Shift + Right-click` immediately converts it to clean LaTeX.
- **Fixed dialog action button wrapping.** Dialog action bars (`.ocr-actions`, `.quality-actions`) now wrap and align cleanly so buttons like **Resize this page** never overflow their dialog.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
