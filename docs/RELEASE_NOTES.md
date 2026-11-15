## What's new in 1.1.75

- **Android QR note sharing & camera scanning.** Added a LAN note-sharing HTTP server (`ShareHttpServer`) and WebView/camera-permission bridge on Android so **Export and share → Share note via QR…** and progressive `NCQR1` camera scanning work natively on Android as well as desktop.
- **Automatic `.ncstudy` detection from WhatsApp and Android intents.** Declared `.ncstudy`, `application/x-ncstudy`, and `application/json` Android intent filters (`VIEW`, `SEND`, `SEND_MULTIPLE`), fixed byte/filename detection so `.ncstudy`, JSON decks, and Quiz Toolkit Markdown don't get misclassified as `.nfedit`, and routed native opens/drops through the unified importer.
- **Pick a note or keep as General when importing quizzes and flashcards.** Added the import destination picker (`#importTargetDialog`) so imported `.ncstudy` packs, JSON flashcard decks, and Quiz Toolkit Markdown can be attached to any note on the device or kept as General quizzes/decks.
- **Fixed unclickable General & standalone quizzes.** Standalone and imported quizzes/decks in **Study → All quizzes and decks…** are now always clickable, open directly, and save progress to their own storage keys.
- **Rust CI fixes.** Fixed `rustfmt` and `clippy::collapsible_match` warnings in `noteful-core`.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
