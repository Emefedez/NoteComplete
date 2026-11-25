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

- [ ] Merges kept on import: SheetJS `!merges`, docx `w:gridSpan` / `w:vMerge`, ODF
      `table:number-columns-spanned` / `number-rows-spanned`. Tables with merges are written as
      HTML `<table>` with `rowspan` / `colspan`; others stay pipe tables. Check that the text view
      renders (and sanitises) that HTML.
- [ ] Filter and sort: a bar on each table in the text view (text filter, per-column value
      filter, sort by header). View only; the file never changes.
- [ ] "Put on page as table": a sheet or table range becomes a page table with its merges
      (limits raised if needed).

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
there is one source for each setting):

1. **Look**: theme (Light / Dark / Follow the system, `theme.js`), dark pages, interface size.
2. **Performance**: the quality presets (Fast / Balanced / Sharp, `quality.js`), fast zoom
   sharpening, with a hint picked from the device (phone or tablet → Fast).
3. **Writing**: pen pressure, smoothing, tool names under icons, new note format.
4. **AI** (Optional): the AI tools found (`notecompleteAI.providers`) plus "In this app
   (WebLLM)"; the chosen one becomes `notecomplete-ai-provider`; connect AI tools to the note
   server (`notecompleteAgents`). "No AI" is a choice.
5. **R** (Optional, desktop): R / R Commander Studio status (`notecompleteRBridge.status`), with
   Install R Commander Studio (`installStudio`, progress shown) and Get R.
6. **Office files** (Optional): default way to open documents, spreadsheets and presentations
   (Text view / Euro-Office / Ask each time); Euro-Office install button once phase 3c exists,
   until then "coming as a separate install".
7. **Modules**: every module that installs separately, each as a card with its icon, a one-line
   description, its state (installed, version / not installed / not available on this device)
   and an **Install** (or Open / Update) button with progress:
   - **R Commander Studio**: "R statistics and graphs in a friendly editor" (`notecompleteRBridge`).
   - **Euro-Office**: "Full office suite: edit Word, Excel and PowerPoint files" (phase 3c; until
     then shown as coming soon).
   - **AI tools**: connect installed AI apps to your notes (`notecompleteAgents`).
   - later modules register a card themselves (`id`, `icon`, `name`, `summary`, `status()`,
     `install(onProgress)`).
   On the web reader the card says it needs the desktop app.
8. **Preferences**: menu bar auto-hide, tool bar side in landscape, page spread, welcome note at
   start, update checks.
9. **All done!** end screen.

- [ ] `setup-wizard.js` + `setup-wizard.css`, steps as small objects (`id`, `label`,
      `optional`, `available()`, `render(section, draft)`), so a module (R, Euro-Office, later
      ones) can add its own step.
- [ ] Opens on first launch (desktop and web), state in `notecomplete-setup`
      (`{ completed, skipped, version, step }`); Skip keeps what was already chosen. Existing
      users get it once too, with their current settings already selected.
- [ ] Reopen from Help ▸ Setup wizard… and the command palette.
- [ ] Tests: step list and availability, state persistence, done screen.

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
5. **Euro-Office spike** (phase 3b): aarch64 build, one .xlsx opened.
6. **Euro-Office module** (phase 3c): install from the wizard and the modules UI, launcher,
   editor tab, save-back.
7. **Textual Analysis** (phase 5): Markdown highlighting first, then the mode and the prefab.

Sprints 2, 3, 5 and 7 run in parallel (subagents, one worktree each); 4 follows 2; 6 follows 5.
