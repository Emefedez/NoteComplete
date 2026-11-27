## What's new in 2.0.26

- **Fixed Moodle Grades (`moodle:grades` `TypeError: fetch failed`).** Course-overview grades now use the Moodle Mobile REST API (`gradereport_overview_get_course_grades`) with automatic `userId` lookup, and HTML fallbacks handle network/redirect errors gracefully without crashing.
- **Interactive Moodle MCP tab.** The Moodle Tools → MCP tab now displays live connection status, includes a **Test Moodle API** health check (courses, deadlines, grades, forums + latency), **Copy live Moodle context (MD)**, and MCP JSON cards with Docs links.
- **Optional Cloud Providers card in the Setup Wizard.** Configure Google Drive, Dropbox, Moodle, GitHub, and Nextcloud/WebDAV keys, tokens, and URLs directly from the Setup Wizard.

Detailed change history: [CHANGELOG.md](https://github.com/Emefedez/NoteComplete/blob/main/docs/CHANGELOG.md). Preview installers for Android, Linux (AppImage), macOS and Windows; `SHA256SUMS.txt` has the checksums. Not signed or notarized; see `docs/BUILDS.md`.
