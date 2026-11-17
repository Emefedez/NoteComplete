## What's new in 1.2.28

- **Open Goodnotes and Notability notebooks.** Open a .goodnotes or Notability .ntb file and it becomes a note you can edit like any other. Ink, typed text, pictures and shapes come over as editable items. The notebook's PDF pages stay sharp behind the page. Paper templates and fills are drawn into a PDF behind the page. Anything that can't come over is listed when the notebook opens. Save keeps it as a .nfedit with the original notebook inside, so nothing is lost. The MCP tools read notebooks too.
- **A new .nfedit format (version 13).** A .nfedit is now an archive like .notecomp, holding the note as it is instead of as Base64 text, so projects are about a quarter smaller. Older .nfedit files still open, and are saved in the new format.
- **Fixed: a new note's first save could overwrite the note opened before it.** After opening a note and then making a new one, the first save now creates the new note's own file.
- **Duplicate notes are found among new .nfedit files too.**

Earlier versions: [changelog](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; SHA256SUMS.txt has the checksums. Not signed or notarized; see docs/BUILDS.md.
