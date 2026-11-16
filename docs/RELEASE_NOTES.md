## What's new in 1.2.13

- **Long notes open fast again.** Opening a note with a long edit history replayed it in quadratic time. A note with 30,000 edits took 5 seconds to open and now takes a quarter of a second.
- **Trimming history works with tape.** **Cut history** no longer fails with "Compacting would change a page" on notes that have strips of tape, such as taped exams.
- **Lighter pen hover.** The hover ring moves once per screen frame instead of on every pen report (up to 240 a second on an iPad), and it only updates what changed.
- **The pen clicks tool bar buttons.** A long press with the pen used to turn into a drag or a tooltip. Now a pen tap of any length is a click, and a pen drags tools only after it clearly moves.
- **Palm rejection.** A resting palm, recognized by its large contact area, no longer scrolls or draws on the page. After you use the pen, fingers keep panning for 10 minutes (up from 30 seconds).
- **Pen smoothing in the tool bar.** The pen's tool settings now include a smoothing toggle next to pressure.
- **Open & Import and Export.** Import, export and share are now organised into these two tabs, with Notes and Resources subtabs (1.2.12).

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
