## What's new in 2.0.15

- **Rnote notes open in NoteComplete.** `.rnote` files open as editable notes like Goodnotes and Notability notebooks: pen strokes stay ink, shapes, text and pictures come along, PDF pages Rnote imported become page backgrounds, and the canvas colour is kept. An infinite canvas is cut into pages, each PDF page together with the notes written beside it.
- **Rnote covers.** Rnote notes get a cover on Home right away: their ink drawn small on the canvas colour, with PDF pages as white sheets (a generic Rnote cover when the note is empty or too large); the real first page replaces it once the note has been opened.
- **Folders show their subfolders and every file.** A folder opened from disk is browsed on Home one level at a time (subfolder cards, the path in the heading, Back goes up). Files NoteComplete can't open are listed too, marked as such; clicking one opens your system's **Open with** app chooser.
- **One of each for Drive and Dropbox.** A new Home filter chip (on by default) shows same-named items, such as the copies Noteful backups leave, as one card with a ×N count; opening it lists every copy, newest first, to choose from.
- **Google Drive tools for AI agents.** The bundled MCP server can search, list, download, upload, move, rename and trash Drive files, find duplicates and merge folders (a dry run first; nothing is deleted, only trashed). Sign in once with `drive_connect` or `noteful drive-login`.
- **Fixed:** imported notebook pages with a coloured background drew a broken background PDF; long names in the Model Explorer were cut off at the panel's edge (they now end in … and slide to show the rest on hover).

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
