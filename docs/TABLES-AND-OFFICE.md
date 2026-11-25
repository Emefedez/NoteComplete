# Tables and office documents

Owner's plan (2026-11-25): richer page tables (cells spanning several spots), tables in
documents kept and filterable, and a choice for every office file: open it the native
NoteComplete way (converted to Markdown, `office.js`) or in Euro-Office, added as an optional
module that gives NoteComplete a full office suite.

`[D]` done · `[!]` done, not yet verified against the real app · `[ ]` to do

Status: sprint 1 done on branch feat/tables-office (editor checked in headless Chromium, not yet
in the desktop app); sprints 2 onwards in progress.

## Today

- Page tables: `table.js` (spec + drawing as ink and text boxes), editor `editTable` in
  `compound-dialogs.js`, stored as items with `Part{kind:"table"}` (`part.rs`). A spec is a
  rectangular grid of strings, equal row heights, relative column widths, up to 30 × 12
  (sprint 1b: 50 × 20, row heights, cell looks; see Phase 1).
- Office files: `media-import.js` sends `isOfficeName` / `isTableName` files to
  `office.js` `officeDocument`, which writes Markdown (+ a `<name>_files` picture folder) for the
  text view. Merged cells, formulas and layout are lost; the result is read-only.

## Phase 1: cells across several spots (page tables)

- [!] Spec `v: 2`: `merges: [[row, col, rowSpan, colSpan], …]`. `tableSpec` checks them (in the
      grid, no overlaps, at least 2 cells); `v: 1` specs read unchanged. Covered cells keep their
      text in the spec but are not drawn.
- [!] `tableItems`: inner rules drawn as segments that skip merged areas; one text box per merged
      area, placed in the whole area. Background bands stay per row.
- [!] `resized` and the editor's row/column insert and delete grow, shrink or drop the merges
      they cross.
- [!] Editor: range selection (Shift + click, Shift + arrows, drag), **Merge** and **Split**
      buttons; the grid shows spans with CSS `grid-row` / `grid-column`.
- [ ] MCP: page tables are not in `add_prefab` yet (SHAPES-TABLES-MATH.md T2); when T2 is done,
      its spec text documents `merges`.
- [D] Tests in `table.test.mjs` (model, drawing, resize with merges, v1 compatibility).
- Answered in sprint 1b: per-cell alignment, row heights that follow content, header column.

### Sprint 1b: a better table and editor (branch feat/table-editor-plus)

Spec `v: 3` only when one of the new fields is used; v1 and v2 specs read and draw exactly as
before (`table.golden.json`, drawn by the 6fa98cc table.js, pins it). `tableSpec`, `MAX_ROWS`,
`MAX_COLUMNS` and `mergeCells` keep their behaviour.

- [D] Rows: `fit: true` (rows as tall as their text; new tables start with it) or `heights`
      (relative, like `widths`). A table grows on the page with the rows and lines added in the
      editor (`tableNaturalSize`, figures.js). Inserted and deleted rows and columns keep the
      widths and heights (`insertLines` / `deleteLines`); the editor no longer resets widths.
- [D] Cell looks, sparse: `format: { "r,c": { bold, italic, align, valign, fill } }`, a merge
      under its first cell. Fills are highlighter bands under the ink (the row's band leaves the
      cell out); align also sets the text box's own `align` (Noteful keeps it). Merged cells stay
      centred by default.
- [D] `headerColumn`: the first column bold and tinted, with a thicker rule.
- [D] `borders`: all, outline, rows only, none (the frame stays, clear, so the table can be
      selected); the header row's and column's rules stay in all of them.
- [D] `size`: auto (as before), small 10, medium 13, large 17.
- [!] Editor format bar: bold (Ctrl+B), italic (Ctrl+I), align left / centre / right and top /
      middle / bottom, fill, clear looks, on the chosen cells or the cursor's. Delete or
      Backspace clears several chosen cells.
- [!] Paste a range (`table-paste.js`): an HTML table (with colspan / rowspan as merges), TSV,
      or CSV of two or more consistent lines, from the cursor; the table grows up to the limits.
- [!] Column letters and row numbers: drag their edges for widths and heights (arrow keys on
      the focused edge; double-click: all equal); a click chooses the whole column or row.
- [!] Undo / redo in the editor (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, and buttons) over the whole table.
- [!] Live preview of the table as drawn (`previewSvg` of `tableItems`), toggled with the eye
      button and remembered on the device.
- [!] Sort rows by the cursor's column, up or down; the header row stays; off when a merge spans
      body rows (`sortRows`, `canSort`).
- [D] Limits 50 rows × 20 columns (a 50 × 20 table: about 1,070 items, drawn by the core in
      ~10 ms, page view ~100 ms; the editor opens it in ~60 ms).
- [D] Tests: `table.test.mjs` (golden, v3 fields, ops, sort, paste, 50 × 20 through the WASM core
      and Noteful export), `table-paste.test.mjs`.
- Not done: text in a cell does not wrap on the page (as before); a long line runs past its cell.

## Phase 2: tables in the native (Markdown) path

- [!] Merges kept on import: SheetJS `!merges` (xlsx, xls, ods), docx `w:gridSpan` / `w:vMerge`
      (mammoth's colspan/rowspan and the built-in reader), ODF `table:number-columns-spanned` /
      `number-rows-spanned` (odt, ods, odp), pptx `gridSpan` / `rowSpan`. Tables with merges are
      written as HTML `<table>` with `rowspan` / `colspan` (`office.js` `tableBlock`); others stay
      pipe tables. The core still shows raw HTML as text: `html-table.js` turns such a block back
      into a pipe table the core renders, then gives it its spans (structure and the two span
      attributes only; cells are Markdown, rendered like any table's).
- [!] Filter and sort (`table-filter.js`): a bar on each table with 4+ body rows in the text view
      (text filter, "n of m rows", Clear), sort by header click (up, down, as written; numbers
      by value, words by locale; empty last), per-column value filter (▾, check boxes). View
      only; rows sharing a rowspan hide together and such tables do not sort (tooltip says so).
- [!] "Put on page as table": Put on page in the bar, or right-click any table: the rows shown,
      in their order, with merges, go to a note picked like "Insert diagram into note"; the
      table editor opens with them. Over 30 × 12, the menu says what is taken (header + first
      rows/columns) and offers to choose rows with the filter first. Limits not raised.
- [!] Right-click on a table: a table menu (context-menu.js): Copy selection (when text in it
      was selected), Copy table (HTML + TSV), Copy as Markdown / CSV, Copy cell / row, Sort by
      this column ▸ (off with the reason when rows share merged cells), Only rows with this value,
      Clear filters and sorting, Show filter bar (small tables), Put on page ▸, Select table.

## Phase 3: open with NoteComplete or Euro-Office

### The choice

Every file type that both NoteComplete and Euro-Office read can be opened either way:

| Group | Extensions | NoteComplete (Markdown) | Euro-Office |
|---|---|---|---|
| Both | docx docm dotx doc rtf odt fodt · xlsx xlsm xlsb xls ods fods csv tsv · pptx pptm ppt odp · epub | yes | yes |
| Euro-Office only | e.g. dotm ott · xltx ots · ppsx potx otp fodp · fb2 xps djvu (exact list from the module) | no | yes, once installed |
| NoteComplete only | ipynb; PDF stays a note (optionally a later "Fill form in Euro-Office") | yes | no |

The Euro-Office list is not hard-coded: the installed module declares the formats it views and
edits (its manifest), and the menus are built from it, so a newer Euro-Office adds formats
without a NoteComplete release.

- [!] Context menus (Home recents, Drive, Dropbox, GitHub, WebDAV, Internet Archive): right-click
      an office file for **Open / Open with ▸ Text view (Markdown) / Euro-Office** (Home adds
      More… for its ⋯ popup). Euro-Office shows disabled, "(not installed)", with **Install from
      Setup ▸ Modules…** (opens the wizard at Modules). `open-with-ui.js` `attachOpenWithMenu`;
      the choice applies to that one opening (`openOnceWith`). Checked headless on a harness list,
      not on real Drive/Dropbox listings.
- [!] Every way in (Library/Home, Drive, Dropbox, archive browser, drag and drop, file pickers,
      files from the OS) goes through `load()` in app.js, which asks `chooseOpener` first: the
      kind's default from `openWith(kind)` (Setup ▸ Modules ▸ Office suite: documents,
      spreadsheets, presentations; Text view / Euro-Office / Ask each time), falling back to the
      text view when Euro-Office is not installed or cannot open the file, with no error. "Ask
      each time" shows a chooser with **Remember for <kind>**; Cancel leaves the open document.
      The side-by-side document panel (`side-document.js`) stays text only.
- [ ] Per-extension defaults and an e-books group (Settings ▸ Files): not done; kinds only.
- [!] The text tab of an office file has **Open in Euro-Office** in its bar (dimmed while not
      installed; a click says so and offers Install from Setup ▸ Modules…). The way back,
      "Open as text", is for Sprint 6's editor tab: it calls `reopenWith(file, 'text')`
      (`open-with-ui.js`).
- [D] `open-with.js` (+ tests): kind by extension, openers per file (text = exactly what
      `office.js` converts; Euro-Office = edit / lossy-edit / convert on open / view from the
      format list), the default with fallback, "ask". Formats: `office-formats.js`, a trimmed copy
      of the module's manifest (75 rows: extension, editor type, open actions, MIME; source noted),
      the built-in fallback until the installed module gives its own. PDF, txt, md, xml and html
      are never sent to Euro-Office. The module hook is `office-module.js` (`status()` says not
      installed; Sprint 6 fills it and `open()`).
- [D] Files only Euro-Office opens (.ppsx .potx .xltx .djvu .xps .vsdx …) stay unsupported while
      it is not installed (not added to `isOfficeName`); the message says they open in the
      Office suite module (Help ▸ Setup wizard ▸ Modules), and Drive/Dropbox cards say "Needs the
      Office suite module" instead of "Unsupported format".
- [ ] Saving: the text view stays read-only (with its "save as Markdown"). Euro-Office saves
      OOXML and ODF back to the same file; legacy binary formats (.doc .xls .ppt) and the
      e-book/viewer formats save as a new .docx/.xlsx/.pptx beside the original, never over it.
      Library and Drive versions record the save like any other.

### The module

Euro-Office is the ONLYOFFICE Document Server codebase: browser editors (`sdkjs`, `web-apps`),
a Node `docservice`, and the native C++ `x2t` converter. AGPL-3.0, so it is a separate install
that NoteComplete (MIT) talks to over HTTP, with its source offered; never bundled in the
AppImage.

- [D] Spike (2026-11-25, report in `~/Work/euro-office-spike/REPORT.md`): feasible with caveats.
      The official `ghcr.io/euro-office/documentserver:v9.3.8-arm64` image ran rootless
      (`unshare --map-auto` + `pasta`, no docker, no sudo) on 127.0.0.1 with JWT; DocsAPI opened an
      .xlsx and .docx (dark, es/en, desktop/mobile/embedded) and the save callbacks (forcesave
      status 6, close status 2) returned files with the edits. Cost: 989 MB download, 3.2 GB on
      disk, ~750 MB RAM idle with one converter worker, 27 s first start / 7.7 s warm. The server
      exists only for Linux (amd64 + arm64): Windows x64 needs WSL2 (`wsl --import`, no Docker),
      macOS arm64 needs a container runtime. Pin v9.3.8+ (NOTICE per the licence terms). Formats
      come from the module's own manifest (86 entries).
      Decision: phase 3c builds Linux x64 + arm64 first; Windows and macOS shown as
      "requires WSL2 / a container runtime" until tested on real machines.
- [ ] Desktop main starts and stops it on localhost on demand (like `r-bridge.js`), with a
      random port and a JWT secret it generates.
- [ ] Editor tab: `DocsAPI.DocEditor` in a NoteComplete tab, themed light/dark, language from
      the app; the document is served from a one-time local URL, and the save callback writes
      the file back through the Library / Drive / Dropbox save paths.
- [ ] Registered as an "app module" in the prefab-modules UI (`docs/PREFAB-MODULES.md`):
      install, update, remove, show version and licence and a source link.
- [ ] iPad / web PWA: optional, through the desktop's collab / tunnel server while the desktop
      is on.
- Licence note: ONLYOFFICE disputed the fork's compliance at launch; Nextcloud updated the
  licence headers afterwards. Pin a release after that change.

## Phase 4: setup wizard (onboarding)

Owner's request (2026-11-25): a first-run setup for the whole app, lifted from R Commander
Studio's (`~/Work/r-commander-studio/renderer/setup-wizard.js`): the same shape (title and
subtitle, a stepper of numbered tabs that tick when passed, one section per step, Skip / Back /
Step n of N / Next, "(Optional)" on optional steps) and the same end screen (green tick badge,
"All done!", how to reopen it, a green **OK** and **More of my projects on GitHub**). Optional
installs (R, Euro-Office, AI tools) are offered here instead of when first needed.

Steps, in this order (everything is also in the menus; the wizard calls the same setters, so
there is one source for each setting, and each choice applies at once):

1. **Look**: theme (Light / Dark / Follow the system, `theme.js`), dark pages, interface size.
2. **Performance**: the quality presets (Performance / Balanced / Sharp, `quality.js`), fast zoom
   sharpening, with a hint picked from the device (phone or tablet → Performance).
3. **Writing**: pen pressure, smoothing, tool names under icons, new note format.
4. **AI** (Optional): the AI tools found (`notecompleteAI.providers`) plus "In this app
   (WebLLM)"; the chosen one becomes `notecomplete-ai-provider`. "No AI" is a choice.
5. **Modules**: the one place for optional features (owner, 2026-11-25: Office and Math are
   modules, not steps). One registry (`setup-modules.js`), two kinds of card: built-in features
   turned on with a switch, and separate installs with an **Install** (or Open / Update) button
   and progress. Each card: icon, one-line description, state, action; its few settings open
   inside it when it is on or installed. On the web reader the install cards say they need
   the desktop app.
   - **Math & R** (feature): "Calculator bar, formulas and R statistics in your notes". Switch =
     Math Mode (`math/settings.js` `mathSettings({ enabled })`); inside: angle unit, precision,
     "use R on this computer when R Commander Studio is not running" (`rAutoFallback`), and the
     **R Commander Studio** row with its icon, status and Install (`notecompleteRBridge`).
   - **Office suite (Euro-Office)** (install): "Edit Word, Excel and PowerPoint files". Coming
     soon (disabled) until phase 3c; inside, always: the default way to open documents,
     spreadsheets and presentations (Text view / Euro-Office, once installed / Ask each time),
     in `notecomplete-open-with`, read with `openWith(kind)` (`open-with-pref.js`). Unchanged,
     files open in the text view as today.
   - **Chinese** (feature): "Type Chinese with pinyin, with Pinyin over characters and a
     dictionary". Switch = the 中 buttons in every field (`setZhEverUsed`); inside: what new
     fields start in, simplified or traditional.
   - **AI tools connection** (install): connect installed AI apps to your notes
     (`notecompleteAgents`).
   - later modules register a card themselves (`id`, `kind`, `icon`, `name`, `summary`,
     `status()`, `install(onProgress)` or `setEnabled(on)`, optional `settings(el, ui)`);
     Sprint 6 fills in Euro-Office's `status()` and `install()`.
6. **Preferences**: menu bar auto-hide, tool bar side, page spread, welcome note at start (the
   website), update checks (desktop).
7. **All done!** end screen.

- [D] `setup-wizard.js` + `setup-wizard.css`, steps as small objects (`id`, `label`,
      `optional`, `available()`, `render(section, draft)`); modules in `setup-modules.js`.
- [D] Opens on first launch (desktop and web), state in `notecomplete-setup`
      (`{ completed, skipped, version, step }`); Skip keeps what was already chosen. Existing
      users get it once too, with their current settings already selected. Only the tab in
      front opens it; never in automated browsers (`navigator.webdriver`); `?setup=1` (or
      `?setup=<step>`) opens it at once.
- [!] Reopen from Help ▸ Setup wizard… (reader menu and the desktop app's native Help menu)
      and the command palette (native menu not tried in Electron yet).
- [D] Tests: step list and availability, state persistence, module states, done screen
      (`setup-wizard.test.mjs`); headless screenshots of every step and the end screen.

## Phase 6: Euro-Office on every desktop platform (sprint 6 design, owner 2026-11-25)

Licence caveats accepted (NoteComplete stays open source; the module is downloaded unmodified).
One install path per platform, all driven from the Office module card:

- **Linux x64 / arm64**: the rootless runner proven in the spike (`unshare --map-auto` + `pasta`,
  official image unpacked to a rootfs); podman/docker used instead when present. Ubuntu's AppArmor
  userns restriction → fall back to podman/docker or explain the one-line fix.
- **Windows x64**: an install script NoteComplete runs (PowerShell): checks/enables WSL2 (asks for
  admin once, may need a reboot), downloads the image layers, `wsl --import NoteComplete-EuroOffice`,
  then NoteComplete starts it with `wsl -d … /entrypoint.sh`. No Docker Desktop needed.
- **macOS arm64**: a script that uses the container runtime found (Apple `container`, Podman,
  Docker, OrbStack, Colima) to pull the pinned image and run it on 127.0.0.1; if none is installed,
  the card offers to install Podman (or explains Apple `container` on macOS 26+).
- Shared: pinned tag + digest, start on demand, stop when idle (~10 min) and on quit, one converter
  worker, `data/` kept across updates, uninstall removes everything (inside the user namespace on
  Linux). Nothing of the module runs while no document is open in it.

## Phase 7: prefabs as packs you choose

Owner's idea (2026-11-25): prefab groups are no longer all preinstalled.

- [ ] The prefab menu shows every pack; packs not installed have a cloud icon to download them, an
      eye button hides the ones not installed, and installed packs can be removed (their figures
      already on pages keep showing — they are drawn items — and editing them asks to reinstall).
- [ ] Setup wizard: a "Prefabs" choice with a tree view: a check for Everything, then one per group
      (charts, UML, maths, algorithms, Chinese, textual analysis …), then individual prefabs.
- [ ] Where packs come from: the release's assets (or the repo) by version, checked by hash, cached
      for offline use; the core set (sticky note, table, graph) always installed.
      Today on desktop/Android the shipped packs live inside the app bundle (instant enable/hide);
      on the web PWA, `tools/build_web.py` + `tools/prefab_packs.mjs` exclude non-core packs from
      the service worker's install `shell` and record each pack's file list, byte size and SHA-256
      hash in `precache.json`, so `prefab-packs.js` fetches them on demand into Cache Storage (with
      progress) and drops them on remove.
      **Future remote release packs (not yet wired):** a release workflow can publish each optional
      pack as a versioned tarball (`prefab-pack-<id>-v<version>.tar.gz` + manifest with SHA-256
      hashes) on the GitHub release for that app version; the desktop app downloads and verifies
      the archive by hash into its writable modules folder (`prefabs-user/`), keeping the installer
      smaller without changing the pack registry or UI.
- [ ] `add_prefab` (MCP) and AI features say when a pack is missing instead of failing.

## Phase 8: Model Explorer and connectivity across the project

Owner's request (2026-11-25): like Visual Paradigm, "la conectividad punta a punta del proyecto es
importante".

- [ ] A project model: model elements (classes, actors, use cases, activities, states, candidates …)
      with stable ids, shared by every UML prefab and Textual Analysis in a note (or a folder of
      notes), so the same class can appear in several diagrams.
- [ ] Model Explorer panel: tree of elements by kind/package (like VP's "Candidate Items",
      "Clases" › "Cliente"), with where each one appears.
- [ ] Right-click an element in any diagram → "Show in…" lists the other diagrams/prefabs where it
      appears (class diagram, activity, use case, textual analysis) and jumps there; rename once,
      updated everywhere (or asks).
- [ ] Textual Analysis candidates link to the elements they became.

## Phase 5: Textual Analysis prefab

Owner's request (2026-11-25): a prefab like Visual Paradigm's *Textual Analysis*: a problem
statement written in a Markdown-like editor, words and phrases highlighted and classified as
candidates (class, actor, use case, attribute, operation, …), and a candidate table built from
them, which can go on to UML elements. Reuse NoteComplete's text and highlighting pieces
(`rich-text.js`, `rich-spans.js`, `text-highlight.js`, the Markdown editor, the prefab kit) rather
than writing new ones.

- [!] Highlighting in Markdown, extended: several colours and an underline style, kept in the
      Markdown (`==text=={.colour}` or a `<mark data-kind>` form, to choose), shown in the text view
      and the Markdown editor. Useful on its own for any Markdown note.

      **Syntax chosen** (`apps/reader/md-highlight.js`): `==text==` (yellow), `=={pink}text==`
      (a colour: yellow, pink, mint, lavender, peach, blue, red, their other names green, teal,
      purple, orange, sky, amber, coral, or `#rrggbb`), `=={_blue}text==` (an underline in that
      colour: `_` = underline) and `=={.red}text==` (the text itself in that colour, no fill:
      `.` = text colour, for remarks such as "(la aplicación NO es una clase)"). Why the tag goes *before* the
      text: it is the form the handwriting pages already read (`crates/noteful-core/src/ink`,
      `=={pink}phrase==`, and `convert.js`'s cheat sheet), so notes and ink pages share one
      dialect and AI already writes it; a reader that does not know it shows the words with `==`
      around them; it cannot clash with links, footnotes or attributes (`{…}` right after `==`
      means nothing else in CommonMark/GFM); and a trailing `=={…}` would be read as the start of
      the next highlight. Rules as Obsidian/Pandoc `==mark==`: no space just inside the
      delimiters, `===` is never one, no blank line or code inside. The core renders Markdown
      without it (raw text), and the reader marks it after (`rich-text.js` → `highlightElement`),
      so the wasm core is unchanged and Markdown without `==x==` renders byte for byte as before
      (tested on every doc in `docs/`). TinyMDE shows it through its `customInlineGrammar`, and
      the format bar has a Highlight button (colours, Underline ▸, Text colour ▸, Remove highlight).
- [!] Textual Analysis mode: the Markdown viewer with a classify bar (candidate kinds with their
      colours), select text → classify; a side table of candidates (name, kind, occurrences,
      description), duplicates merged, order editable.

      **Design after the owner's Visual Paradigm screenshot (2026-11-25)**: the colour belongs to
      the *candidate*, not the kind (each new candidate takes the next colour of a palette;
      editable), and every place its extracted text appears is highlighted and counted
      automatically (whole words, any case; plurals -s/-es and accent-insensitive matching are
      options, off by default; where two overlap the longer text wins). So the statement stays
      the owner's own Markdown: candidates are *found* in it, not marked in it, and no candidate
      syntax is needed (the text's own `==highlights==` and `=={.red}remarks==` are kept and
      drawn). Layout as VP: the text on top (TinyMDE with the format bar: bold, italic, nested
      lists, highlight / underline / text colour; Find, Ctrl F, the app's `text-find.js`), the
      candidate table under it in a resizable split with VP's columns **No. | Candidate Class |
      Extracted Text | Type | Description | Occurrence | Highlight**; the model name is
      suggested from the extracted text (CamelCase for classes, camelCase for attributes and
      operations, articles and prepositions dropped: "Nombre de cliente" → `nombreCliente`) and
      editable. The right panel has the title, what goes on the page, the matching options, the
      candidates' tree by folder (VP's Model Explorer "Candidate Items" > "Clases") and the
      selected candidate's folder, owner (the class of an attribute/operation, the actor of a
      use case) and *Merge into*. Occurrences in the editor are drawn with the CSS Custom
      Highlight API over TinyMDE's own text, so typing and the caret are untouched. Not done:
      text alignment (Markdown has none) and fonts.
- [!] A prefab module (`prefabs/textual-analysis/`, module.json, ai.md) so it goes on pages,
      saves its spec, and AI can write one through `add_prefab`.
- [!] "Create UML elements": candidates of kind class / actor / use case become elements of a new
      UML prefab (`uml.js` kinds).

      Done as *Create UML diagrams* (`prefabs/textual-analysis/uml-from.js`): classes with the
      attributes/operations whose owner they are → a class diagram; actors and use cases → a
      use case diagram (use case → its actor by an association, inside a system boundary named
      after the analysis). The editor hands them to the app through `host.insert` (new in
      `prefab-host.js`, placed by `figures.js` after the analysis: each opens in the diagram
      editor first, then goes on the page, one undo step each). For the later Model Explorer:
      candidates have stable `id`s, each candidate keeps `uml: [{ diagram, element, list? }]`,
      each diagram has its own `id` and `origin: { module, id, candidates: { elementId:
      candidateId } }` (kept by `uml.js normalizeModel`). Limits: a link to a diagram that was
      cancelled in its editor stays dangling; editing the diagram as PlantUML text renews
      element ids.

## Sprints

1. **Merged cells** (phase 1): model, drawing, editor, MCP docs, tests.
2. **Setup wizard** (phase 4) with the steps that exist today; the Office step shows the
   open-with default (text view only).
3. **Tables in documents** (phase 2): merges kept on import, filter / sort bar, sheet range to
   page table.
4. **Open with** (phase 3a): menus, per-type defaults, switch button in the tab bar.
5. **Euro-Office spike** (phase 3b): done, see the phase 3 checklist and REPORT.md.
6. **Euro-Office module** (phases 3c and 6): install scripts per platform, launcher, editor tab,
   save-back.
7. **Textual Analysis** (phase 5): Markdown highlighting first, then the mode and the prefab.

8. **Prefab packs** (phase 7): download / hide / remove, wizard tree.
9. **Model Explorer** (phase 8), after Textual Analysis and the UML additions.

Side work on their own branches from main: UML italic + direction arrow + end texts
(`feat/uml-italic`), pictures over text selection fix + bring to front / send to back
(`fix/image-select-zorder`), CI default targets (`ci/default-desktop-targets`).

Sprints run as subagents, one worktree each; 4 follows 2; 6 follows 5.
