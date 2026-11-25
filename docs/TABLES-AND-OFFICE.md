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
  rectangular grid of strings, equal row heights, relative column widths, up to 30 × 12.
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
- Open question: per-cell alignment, row heights that follow content, header column.

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

- [ ] Context menus (Library, Home recents, Drive, Dropbox, archive browser): **Open with ▸
      Text view (Markdown) / Euro-Office**.
- [ ] Settings ▸ Files: default per group (documents, spreadsheets, presentations, e-books) and
      per extension, plus "Ask each time". Default stays the text view; when the module is not
      installed (or not reachable) everything opens natively, with no error.
- [ ] A tab opened one way offers the other in its bar ("Open in Euro-Office" / "Open as text").
- [ ] Saving: the text view stays read-only (with its "save as Markdown"). Euro-Office saves
      OOXML and ODF back to the same file; legacy binary formats (.doc .xls .ppt) and the
      e-book/viewer formats save as a new .docx/.xlsx/.pptx beside the original, never over it.
      Library and Drive versions record the save like any other.

### The module

Euro-Office is the ONLYOFFICE Document Server codebase: browser editors (`sdkjs`, `web-apps`),
a Node `docservice`, and the native C++ `x2t` converter. AGPL-3.0, so it is a separate install
that NoteComplete (MIT) talks to over HTTP, with its source offered; never bundled in the
AppImage.

- [ ] Spike first: build or obtain an aarch64 build (Asahi) of docservice + x2t and open one
      .xlsx in a plain page. Everything below waits on this.
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

## Phase 5: Textual Analysis prefab

Owner's request (2026-11-25): a prefab like Visual Paradigm's *Textual Analysis*: a problem
statement written in a Markdown-like editor, words and phrases highlighted and classified as
candidates (class, actor, use case, attribute, operation, …), and a candidate table built from
them, which can go on to UML elements. Reuse NoteComplete's text and highlighting pieces
(`rich-text.js`, `rich-spans.js`, `text-highlight.js`, the Markdown editor, the prefab kit) rather
than writing new ones.

- [ ] Highlighting in Markdown, extended: several colours and an underline style, kept in the
      Markdown (`==text=={.colour}` or a `<mark data-kind>` form, to choose), shown in the text view
      and the Markdown editor. Useful on its own for any Markdown note.
- [ ] Textual Analysis mode: the Markdown viewer with a classify bar (candidate kinds with their
      colours), select text → classify; a side table of candidates (name, kind, occurrences,
      description), duplicates merged, order editable.
- [ ] A prefab module (`prefabs/textual-analysis/`, module.json, ai.md) so it goes on pages,
      saves its spec, and AI can write one through `add_prefab`.
- [ ] "Create UML elements": candidates of kind class / actor / use case become elements of a new
      UML prefab (`uml.js` kinds).

## Sprints

1. **Merged cells** (phase 1): model, drawing, editor, MCP docs, tests.
2. **Setup wizard** (phase 4) with the steps that exist today; the Office step shows the
   open-with default (text view only).
3. **Tables in documents** (phase 2): merges kept on import, filter / sort bar, sheet range to
   page table.
4. **Open with** (phase 3a): menus, per-type defaults, switch button in the tab bar.
5. **Euro-Office spike** (phase 3b): aarch64 build, one .xlsx opened.
6. **Euro-Office module** (phase 3c): install from the wizard and the modules UI, launcher,
   editor tab, save-back.
7. **Textual Analysis** (phase 5): Markdown highlighting first, then the mode and the prefab.

Sprints 2, 3, 5 and 7 run in parallel (subagents, one worktree each); 4 follows 2; 6 follows 5.
