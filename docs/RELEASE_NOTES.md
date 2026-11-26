## What's new in 2.0.18

- **Find (Ctrl F) finds formulas.** A search such as `B(n,p)` used to split into the letters b, n and p, each also matching any word that starts with it, so nearly every page came up. A term written without spaces with signs inside (`B(n,p)`, `P(X≤3)`, `x-ray`) is now searched as one, also where the PDF or the handwriting recognition broke it into pieces; a single letter matches only that letter.
- **Match case, whole word and regular expressions, as in VS Code.** The Find field has **Aa**, **ab** and **.\*** toggles on its right (Alt C, Alt W, Alt R), remembered between searches; an invalid regular expression is marked on the field. Accents are still ignored.
- **Fixed:** with Chinese input on, its 中 button sat over the Find field and covered the text; it is now in the field's own row of buttons.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
