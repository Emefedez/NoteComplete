## What's new in 2.0.11

- **Bundled skills in desktop installers & Modules card.** Fixed `apps/desktop/package.json` so `skills/notecomplete-*` and `noteful` share a single `extraResources` array in every desktop installer, and added one-click **Install skills** support to the Setup Wizard → Modules **AI tools connection** card when harnesses are already connected.
- **Math Mode hidden on Home & error-safe.** Math Mode no longer opens or toggles on the Home screen, hides automatically when returning to Home, and safely guards plot/insert actions against missing pages.
- **New R Script or Workspace dialog polish.** Fixed the oversized header SVG icon (now neatly aligned at 18×18 px) and removed the non-functional "zero-bloat embedded" selector from the New R dialog and R Bridge settings.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
