## What's new in 1.2.16

- **Snappier writing.** The line you draw is updated once per screen refresh and only gets its new points, instead of being rebuilt with every pen sample, so long strokes stay smooth (most noticeable in Safari on iPad).
- **Smoother page list.** Page previews are encoded in the background, so finishing a stroke no longer causes a short pause.
- **Two-finger scrolling is reliable again.** Scrolling or pinching while a page redrew under your fingers could leave the gesture stuck, so the pages stopped gliding on after you lifted.

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
