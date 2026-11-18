# Prefab modules

Owner's idea (2026-11-18): prefabs as a **modular system**. Each prefab, or each family of them, is a self-contained module. Modules share an editor kit, so a new one is quick to write and documented, and they all live in a `prefabs/` folder that ships next to the executable. No current capability may be lost. **Status:** design only; nothing is built. The owner answered the questions on 2026-11-18 (*Owner's answers*, at the end); the design below follows them.

`[D]` done · `[!]` done, not yet verified against the real app · `[ ]` to do

## How prefabs are built today (2026-11-18)

Four kinds, each wired by hand into several places:

| Kind | Catalogue | Drawing | Editor | Stored as |
|---|---|---|---|---|
| Function graph | `prefabs.js` `PREFABS` | `graph.js` (ink lines + text boxes) | compound dialog in `app.js` | items with `Part{kind:"graph"}` |
| Table | `PREFABS` | `table.js` (ink + text boxes) | compound dialog in `app.js` | items with `Part{kind:"table"}` |
| Exam figures: histogram, bar, process states, scheduling exercise, CPU timeline, exam plot | `PREFABS` (hand-written specs) | `exam-html.js` `renderVisualSvg` (2 663 lines, shared with generated exams) | `chart-editor.js` (1 215) + `chart-model.js` + `chart-editor.css` (255) | a picture + frame with `Part{kind:"prefab", spec}` |
| Diagrams: node graph and every UML kind | `PREFABS`, generated from `uml.js` `DIAGRAMS` | `uml.js` `renderUml` (906) | `uml-editor.js` (1 517) + `uml-plantuml.js`, `uml-xml.js`, `uml-clipboard.js` + `uml.css` (161) | a picture + frame, `spec.type = "uml"` |

What is already shared, but copied between the two editors rather than built on one base:
- the same set of helpers: `cheat-sheet.js`, `editor-quick.js` (the Shift S ring), `palette-order.js` + `reorder.js` (number keys and order), `figure-notes.js` (N), `panel-resize.js`, `json-code.js`, `icons.js`;
- the shell, built twice: the bar, palette, side panel, status line, notes pane and help;
- the CSS, written twice: `chart-editor.css` and `uml.css` repeat the same chrome rules. The compact pass and the panel grips of 1.2.39 had to be added to both.

Knowledge of the kinds is scattered:
- `app.js`: about 90 mentions (insert, edit again, context menus, copy and paste, names);
- `prefabs.js` (`NAMES`, `prefabName`, `prefabSvg`);
- the core (`part.rs` accepts only `graph | table | prefab`);
- the MCP tool `add_prefab` (`crates/noteful-cli/src/ink_tools.rs`), which runs `node` on `apps/reader/prefabs.js` to draw a spec and documents the spec types in its own text;
- the exam generator, whose AI prompts use the same spec types.

## Kinds of module

The owner's split, from how a module edits its figure:

- **Type modules** use one of the kit's **base editors** and only describe their figure: its spec, its palette, its properties, how it draws. The base editors are those NoteComplete already has, made general:
  - *grid paint*: cells painted with brushes over time or categories (today's process states, CPU timeline, scheduling exercise);
  - *bars and values*: values dragged (histogram, bar chart);
  - *plot*: curves, points and areas from a list (exam plot);
  - *diagram*: elements placed and connectors dragged between them (today's UML kinds and node graph);
  - *data*: the JSON editor with a live preview (today's `editPrefab`), for figures with no editor of their own.

  A new figure of a kind that exists (a Gantt chart, a truth table, an automaton) is a type module: a manifest, its spec, its renderer, and no editor code.
- **Custom modules** bring their own editor (`editor.js`), still built with the kit's shell, palette and panels. They are for figures that fit no base editor.
- **Window modules** do not make a picture: their figure is ordinary items on the page (ink and text boxes), so it stays as interoperable as today's function graph and table. These remain items, exported to Noteful as ink. Their editor is a **movable window** over the page, like NoteComplete's floating windows, rather than a full-screen editor: you see the page while editing, and the items update as you change it. The graph and the table move to this kind; nothing about how they are stored changes.

## What a module is

A folder:

```
prefabs/
  index.json              ← generated at build: every module's manifest, for the picker
  kit/                    ← the shared editor kit (below); not a prefab itself
  charts/                 ← one module can hold a family of prefabs
    module.json
    render.js             ← spec → SVG; pure, no DOM (browser, worker and Node for MCP)
    editor.js             ← optional: the editor, built on the kit
    model.js              ← optional: spec helpers (normalise, exercises, checks)
    help.json             ← cheat sheet rows
    ai.md                 ← how the spec is written, for AI prompts and the MCP tool's text
    icon.svg
    test/                 ← the module's own tests (run by the repo's test commands)
  uml/ …  graph/ …  table/ …
```

`module.json`:

```jsonc
{
  "id": "charts",                 // stable; stored with every figure
  "api": 1,                       // the kit/host API version it was written for
  "version": "1.0.0",
  "kind": "type",                 // "type" (a base editor), "custom" (its own editor.js) or "window" (items on the page, edited in a movable window)
  "base": "grid-paint",           // for "type": which base editor
  "output": "picture",            // "picture" (SVG drawn into a framed image) or "items" (ink + text boxes: window modules)
  "types": ["histogram", "bar", "states", "timeline", "plot"],   // spec.type values it owns
  "prefabs": [                    // the picker's cards
    { "id": "histogram", "group": "exam", "label": "Histogram", "hint": "Frequencies of intervals, bars touching", "icon": "graph", "spec": { "type": "histogram", "…": "…" } }
  ],
  "editor": "editor.js",          // omitted: the generic JSON editor with live preview (today's editPrefab)
  "capabilities": ["exercise", "notes", "references", "json", "export"]
}
```

## The host ↔ module contract (api 1)

Only what modules need, so the host stays the one place that knows notes, pages and undo:

- `render(spec, { width?, forExport? }) → { svg, width, height } | null`: pure. It is used for the page picture, the picker's previews, the MCP tool and generated exams.
- `name(spec) → "Histogram"`, used in menus ("Edit histogram…").
- `normalize(spec) → spec`, which also upgrades specs written by an older version.
- `open(root, { spec, editing, host }) → { model(), set(spec), destroy() }`. The editor fills `root`. `host` gives it the kit, `status`, `pick a file / picture / note` (for references), the clipboard, the theme, and `insert(spec)` / `cancel()`.
- Optional hooks, declared in `capabilities`:
  - `exercise`: `emptyAnswer`, `check`, `displaySpec`;
  - `items` (for `output: "items"`): `spec → lines and text boxes`;
  - `import`: file kinds it opens, such as `.puml`, XMI and VP for UML;
  - `clipboard`: its own copy and paste between editors.

The host keeps everything that touches the note:
- inserting and editing with one undo step;
- the frame `Part`, resizing that redraws, the context menu, Recent prefabs, the picker, export as PNG or QR;
- collaboration, autosave and native export.

A module never sees the note.

## The shared kit (`prefabs/kit/`)

This is what makes a new module a small amount of code. It is extracted from what the chart and diagram editors already do the same way:

- **Shell:** bar (undo/redo, modes, help, Cancel/Insert), palette, canvas, properties panel, status line. The side panels are resizable and remembered, and the layout is compact, from one stylesheet (`kit.css`) with the app's tokens, dark and light.
- **Palette:** tools with number keys, a dragged order that is kept, the Shift S ring, and the cheat sheet built from `help.json`.
- **Properties:** field builders (text, number, check, colour, row lists with add, move and delete), which cover today's chart panel.
- **Canvas helpers:** pan and zoom (wheel, Ctrl wheel, middle button, pinch), a grid, hit testing, drag and an undo stack for the model.
- **Figure box:** preview as on the page (folding, height dragged), notes (N, Markdown), JSON mode with line numbers and the error line marked, and the "To look at" references.
- **Testing:** a harness that opens an editor in Chromium against a spec, for each module's own e2e test.

The chart editor and the diagram editor move onto the kit first. That is how the kit is proven against the two hardest editors before anyone writes a new module.

## The folder of modules

- **One folder holds them all.** Every module, the shipped ones included, lives in a `prefabs/` folder. The app finds it inside its own resources at first:
  - Windows: `C:\Program Files\NoteComplete\resources\prefabs\`;
  - macOS: `NoteComplete.app/Contents/Resources/prefabs/`;
  - AppImage: inside the image, read-only;
  - web: `apps/reader/prefabs/`.

  `index.json` lists them for the picker, so opening it reads one small file. A module's code is loaded the first time it draws or edits, and a note's pages never need it, because pictures are pictures.
- **Moved or copied, then the default.** **Settings → Prefab modules** shows the folder in use, with two actions:
  - **Copy to…**: copies the folder somewhere you can write to (next to the AppImage, a portable install, the user's documents);
  - **Use this folder**: makes a chosen folder the default.

  From then on modules are added, changed or removed there, without rebuilding, and a restart (or **Reload modules**) picks them up. When a shipped module is newer than the copy in the chosen folder, the app says so and offers to update it. It never overwrites one you changed.
- **Trust:** modules run as the app's own code, at the owner's choice, since this app has no contributors the owner does not trust. The settings page says so in one line ("Modules can read your notes: add only modules you trust").

## Storage, and old notes

- `Part.kind` stays `"prefab"`, and the spec gains `"module": "charts"`.
- A spec without `module` is mapped from its `type`: `histogram`, `bar`, `states`, `timeline`, `plot` → charts; `uml`, `tree`, `graph_nodes` → uml. Every existing note keeps opening and editing.
- `graph` and `table` keep their kinds, with `module` in their spec. The core's check stays as it is.
- A figure whose module is missing still shows: it is a picture. Its menu says *Edit needs the "charts" prefab module* instead of failing.
- MCP `add_prefab` and the exam generator render through the module's `render.js`, found in the same `prefabs/` folder (`NOTEFUL_READER_DIR` for development). The tool's description of the spec types is assembled from each module's `ai.md`, so a new module is usable by AI without editing Rust.

## Capabilities that must survive (the checklist)

All of these are covered by `prefabs_e2e`, `charts_e2e` and `uml_e2e` today or get a check before the move:

- Picker: groups and search, large preview, Recent first, insert at the pointer (right-click), the UML editor step (Visual or PlantUML, *Don't ask again*), Import .puml / diagram.
- Editing again from right-click / ⋯: *Edit histogram…*, one undo step, resizing redraws cleanly.
- Exercises: fill in, check, solution for states, timeline and bars, and the empty prefab to fill on paper.
- Notes on a figure (N); references to look at (a picture, PDF or note, or a pasted snippet); JSON mode.
- Palettes: number keys, a dragged order that is kept, the Shift S ring, the cheat sheet, resizable panels.
- UML: every diagram kind, PlantUML code beside the drawing (both ways), the PlantUML rendering, `.puml` files opened as documents, XMI and VP import, copy and paste between editors and pages, Insert into note.
- Export as PNG and send by QR; Noteful export as a picture; collaboration; the MCP `add_prefab`; exams generated with these figures.
- Graph and table: ink and text boxes on the page, cells edited in place.

## Phases

1. **Safety net** `[ ]`: run the three e2e suites green on `main`, fixing the flaky ones, and add checks for any item above without one.
2. **Kit** `[ ]`: `prefabs/kit/` with `kit.css`; the chart editor moves onto it, then the diagram editor. Behaviour stays identical, and the e2e suites stay green at each step.
3. **Registry** `[ ]`: manifests for charts, uml, graph and table; the picker, names, `prefabSvg` and `app.js`'s kind switches go through the registry. `PREFABS`, `NAMES` and the kind checks in `app.js` go away.
4. **Renderers into modules** `[ ]`: each figure's renderer moves out of `exam-html.js` into its module's `render.js`; `exam-html.js` imports them, so exams draw the same.
5. **Storage and MCP** `[ ]`: `module` in specs with the fallback by type; `add_prefab` and the exam prompts read the modules.
6. **The folder** `[ ]`: shipped modules in the build and the installers; **Settings → Prefab modules** (the folder in use, **Copy to…**, **Use this folder**, **Reload modules**, newer shipped modules offered).
6b. **Window modules** `[ ]`: the graph and table editors as movable windows over the page (items update as they change); the *window* kind in the contract.
7. **Docs and a proof** `[!]`: [`docs/PREFAB-MODULES-GUIDE.md`](PREFAB-MODULES-GUIDE.md) (writing a module, the contract, the kit, tests, the desktop folder), `prefabs/_template/`, and the truth table module (`prefabs/truthtable/`) built only from the guide and the template.

Phases 1–5 keep the app working as it is at every step and can ship on their own. Phases 6 and 6b are the parts that change what a user sees.

## Owner's answers (2026-11-18)

1. **Folder:** a folder of modules that can be added to without rebuilding. It is the internal one at first, and can be moved or copied to another directory, which then becomes the default.
2. **Trust:** trusted, no sandbox.
3. **Graph and table:** they stay items (ink and text boxes) for interoperability. Their editors become movable windows, and a **window** kind of module covers them and future prefabs of that sort.
4. **Kinds:** modules are **types** (a base editor) or **custom** (their own), plus the **window** kind above.
5. **Scope of the first release:** not decided yet.

## Pending (2026-11-18, for the next sprint)
Done on branch prefab-modules-impl: the registry and four shipped modules; the kit (shell.js, kit.css, index.js); the host for a module's own editor.js; the number line module (built only from the kit); MCP add_prefab text from each module's ai.md; the modules folder (desktop serving, Copy to / Use / Reload, loading at start); PDF copy in reading order without duplicates. Not tested by hand yet.
Done on branch docs/prefab-guide (phase 7): docs/PREFAB-MODULES-GUIDE.md; prefabs/_template/ (a working custom module, skipped by the index, the desktop folder listing and the MCP notes); the truth table module (group Maths) built from the guide and the template, with its test, ai.md (also in SHIPPED_PREFAB_NOTES, checked by the crate test shipped_prefab_notes_match_the_modules) and a pass in tools/prefab_module_e2e.mjs. Building it showed one gap in the guide (cheat sheet rows: `keys` and `icon` are optional), now in it.
Not done:
- Phase 6b: the graph and table editors as movable windows over the page ("window" kind).
- openFigureEditor still picks the chart or UML editor by type; only modules with their own editor.js go through the manifest. A "type" kind with a base editor (grid-paint/bars/plot/diagram/data) is not wired yet.
- The manifest fields `base` and `capabilities` are written but not read; a `type` module falls back to the JSON editor (see the guide).
- Folder modules: Reload modules re-imports render.js only; a changed editor.js (or a file render.js imports) needs a restart. MCP add_prefab sees only the shipped modules, not the desktop folder.
- Try the truth table and the template by hand in the desktop app (Copy to…, copy _template to a new folder, Reload modules).
- Check the PDF copy fix (text-layer.js, PDF_WORDS 3) with spaced-out titles; lavadora.pdf was not compared again after the `space` flag.
- Copying items out of NoteComplete as a PNG: the picture of the selection, with the clip's JSON (lines, images, prefab specs) in an iTXt chunk that other apps ignore; pasting or importing that PNG in NoteComplete would bring back editable items. Chromium re-encodes PNGs written with navigator.clipboard (the chunk would be lost), so the desktop app should write the raw bytes through Electron's clipboard (writeBuffer 'image/png'; test with wl-paste). Also read the chunk in importImages (paste, drop, Insert image).
