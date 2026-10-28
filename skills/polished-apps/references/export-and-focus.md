# Export rows, downloads and focus dimming

Two small patterns that make an app feel finished: getting things out (export rows in a menu, a single download path) and staying on one thing (a window that can dim everything behind it). Code: `templates/export-row.js`, `templates/focus-dim.js`; styles in `templates/components.css` (`.menu-row`, `.menu-sub`, `body.focus-dim`).

## Export rows

Put every way of getting a file out in File, as **rows of small buttons**, one row per *what* you export, instead of a long list of "Export as X…" items or a dialog for every format.

```
File
  Open…                      Ctrl O
  Save project               Ctrl S
  Export          [NF] [N+MD] [NC]       ← the whole project, per target format
  Pages as        [SVG] [PDF] [IMG ▾]    ← what is on screen, per file type
     JPEG   small, photos and scans      ← IMG's formats, indented under the row
     WebP   smallest
     PNG    lossless, larger
  ─────────
  Downloads folder…
```

Rules:
- **Label left, buttons right**: the label says *what* is exported ("Export", "Pages as", "Selection as", "Measurements as"); each button says *which format*. Two to four buttons per row; more means a second row or a caret.
- **Short names on the button, full names elsewhere**: buttons show the extension or a 2–4 letter code (SVG, PDF, CSV, WAV, NF). `title` gives the full name and what you get ("Every page as one PDF, as shown (runs in the background)"); `data-palette` gives the command palette entry ("Export pages as PDF"), so each format is reachable by typing.
- **Look**: small filled buttons (`--fill`, 26px high, min 44px wide, 12px semibold, 6px radius), hover = pale accent with accent text. They sit in the menu's normal padding, so the row lines up with ordinary items. No icons, no solid colour.
- **A family of formats gets one caret button** (`IMG▾`): it opens an indented list under the row (`.menu-sub`, left rule, not a flyout) where each format has a one-word hint on the right (smallest / lossless, larger). The menu stays open while the list is open; choosing a format closes everything.
- **Disabled until there is something to export**: all export buttons start `disabled` and are enabled together when a document opens (one list of ids, one place).
- **Group in a `role="group"` with `aria-label`** ("Export pages as"); caret buttons get `aria-haspopup="menu"` and `aria-expanded`; format items are `role="menuitem"`.
- **Fast formats run at once; slow ones are jobs**: a single page or a small file downloads immediately with a status line ("Page 3 exported as WebP (412 KB)"); multi-page or large exports run as a background job with phase, progress and Stop. Expensive assembly (PDF binding, encoding, archives) happens in the core.
- **Which part** (pages, range, selection) is asked only when it matters: one page → just export; a document → a compact chooser with Current · Range (3–7) · List (1, 4, 9–12) · All, remembering the last choice. Several files from one export go into one archive in the browser, or into a folder the user picks on desktop.
- **Report the result**: file name, size, where it went. Fail with the reason ("WebP images are not supported here"), never silently — e.g. check that the encoded blob's type is the one asked for, since some engines fall back to PNG.
- **Export what is shown**: exports match the view (tape, layers, theme of the document, not of the interface) unless the format says otherwise.

### One download path

All exports call one `download(data, name, type)`, which picks the right way out for the platform. Exporters never touch `<a download>`, IPC or share sheets themselves.

| Platform | `download` does |
|---|---|
| Browser / PWA | object URL + `<a download>`; revoke the URL after a moment |
| Desktop shell (Electron/Tauri) | write into the app's files folder through a guarded IPC that only takes plain file names; folder chosen once with **File → Downloads folder…** (main-process dialog), remembered, default under Documents/AppName |
| Mobile WebView | hand the bytes to the native side (base64 message with an id, answered when done), which opens the system share sheet |

Downloaded sources the app keeps (synced files, imports) go to the same folder and are matched by content checksum, so nothing is downloaded or listed twice.

## Focus dimming

Study, review and presentation windows (quiz, flashcard practice, a measurement or a review pass) get an optional **dim** that darkens everything behind them, so the window is the only bright thing on screen.

- **Toggle**: a sun icon button in the window head, left of `_ □ ×`, `aria-pressed`, `aria-label="Dim the background"`, title "Dim everything behind the quiz". Pressed = pale accent, like a chosen tool.
- **One preference** shared by every window that has the sun, remembered (localStorage or settings). Turning it on in the quiz also dims behind flashcards next time.
- **Applied only while a focus window is really shown**: not when it is small (□), put away (_), closed, or docked instead of floating. The preference stays; the veil comes back when the window does. Watch the windows' `hidden`/`open`/`class` with a `MutationObserver` instead of calling an update from every place that changes them.
- **The veil**: `body.focus-dim::after`, fixed, full screen, about 70% of the canvas's darkest colour (`#0b0d11b3`), fading in over 0.2s (no animation with reduced motion). `pointer-events: none`, so the work underneath still scrolls and can be clicked when the user needs to look something up.
- **Every floating window stays above the veil, in the same order**: windows stack from a `--window-z` variable (`z-index: calc(var(--window-z) + i)`); `body.focus-dim` raises the variable above the veil, so the whole stack moves up without reordering, and a helper window opened from the focus window (the assistant, from "ask a follow-up") is usable too. Menus, toasts and context menus sit higher still.
- **Bars and docks stay under the veil**: the point is to hide them. The menubar and shortcuts keep working.

### Checking it

Screenshots shrunk for viewing look lighter than the real veil. Measure a pixel instead of eyeballing (`magick shot.png -format '%[pixel:p{x,y}]' info:`): white under a 70% veil reads about `rgb(84,85,88)`. Check: veil on with the window large, off when small/put away/closed, back when restored, the window order unchanged with and without, and the page underneath still scrolls.
