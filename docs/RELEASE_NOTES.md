## What's new in 1.1.73

- **Fixed: AI study dialogs (Fact check, Generate flashcards, Quiz me) layout.** Removed the outer `.ocr-scope` grid from `.ai-fieldset`, wrapped `#studyModel`, its magnifier/manage buttons, `Small model`, `Text only`, and `#studyModelOther` inside `.model-controls`, aligned `Language` and the AI fields to the dialog's label column on desktop, and stacked rows full-width on narrow mobile viewports (`<= 540px`).
- **Fixed: Mobile bottom navigation bar and Ask AI header sizing.** Tightened mobile `.navigation` spacing and button sizes (`<= 520px`) so all action icons (including Find, Layers, and Toolbar toggle) and `Fit` stay visible without horizontal clipping, and gave `.chat-head` selects a readable minimum flex basis alongside the model magnifier controls.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
