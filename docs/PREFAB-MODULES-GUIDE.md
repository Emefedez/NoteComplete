# Writing a prefab module

A practical guide to adding a figure to **Insert prefab** without recompiling anything. The design and the reasons behind it are in [PREFAB-MODULES.md](PREFAB-MODULES.md); this file is how to do it. Everything here is checked against the code (api 1).

The short version:

1. Copy `apps/reader/prefabs/_template/` to a new folder, `apps/reader/prefabs/<id>/` (or, in the desktop app, into your modules folder: see *The desktop folder*).
2. In `module.json`, change `id`, `label`, `types`, `names`, the card(s) in `prefabs`, and the group.
3. In `render.js`, draw your spec as SVG. In `editor.js`, build the panel with the kit. In `ai.md`, write one line with an example spec.
4. Run `node tools/prefab_index.mjs` and the tests (shipped modules), or **Reload modules** (desktop folder).

The truth table (`prefabs/truthtable/`) and the number line (`prefabs/numberline/`) were both built this way and are good second examples.

## Contents

- [What a module is](#what-a-module-is)
- [Folder layout](#folder-layout)
- [module.json](#modulejson)
- [render.js](#renderjs)
- [editor.js](#editorjs)
- [The kit](#the-kit)
- [ai.md](#aimd)
- [Tests](#tests)
- [Shipped modules: prefabs/index.js](#shipped-modules-prefabsindexjs)
- [The desktop folder](#the-desktop-folder)
- [Checklist](#checklist)

## What a module is

A folder with a `module.json` (what it is and its cards in the picker) and, for a figure drawn as a picture, a `render.js` (spec → SVG). Optionally an `editor.js` (its own editor), an `ai.md` (how AI tools write its spec) and a `test/` folder.

A figure inserted from a module is a **picture with a frame** on the page. The frame keeps the figure's **spec** (a JSON object, `Part{kind:"prefab", spec}`), so it can be edited again (right-click → *Edit …*), resized (it is drawn again at the new size) and copied. The spec always has a `type` and, from the moment it is placed, the `module` it came from (`prefab-registry.js` `stamp`). A module never sees the note: the app does the inserting, undo, the frame, the context menu and export.

There are three kinds (`module.json` `kind`):

| kind | what it is | can you add one without recompiling? |
|---|---|---|
| `custom` | a picture, edited in the module's own `editor.js` (or, with no `editor.js`, in the app's JSON editor) | **yes**: this is the kind this guide is about |
| `type` | a picture edited by one of the app's base editors (`base`) | **yes**: `base` is `chart-editor`, `uml-editor`, `data`, a design name (`grid-paint`, `bars`, `plot` → chart editor; `diagram` → diagram editor; `json` → JSON editor) or another module's id; it draws with the module that owns its spec's `type` (`editorOf` in prefab-registry.js) |
| `window` | edited in a movable window over the page (the kit's `movableWindow`); the shipped graph and table give ink and text boxes | partly: a window module's own `editor.js` opens in a movable window (size from `manifest.window`), but its output is still a picture; items output is only for the built-in graph and table |

## Folder layout

```
apps/reader/prefabs/
  index.js            generated: the shipped modules (tools/prefab_index.mjs); never edit it
  kit/                the shared kit (not a module)
  _template/          the template (skipped: its name starts with "_")
  truthtable/         one module
    module.json       required
    render.js         spec → SVG, pure (no DOM); needed for a picture
    editor.js         optional: its own editor, built with the kit
    ai.md             optional: one line per spec shape, for MCP add_prefab
    test/             its tests (node --test); not shipped in builds
    model.js …        any other files you import (relative imports work)
```

Folders whose name starts with `_` and the folder `kit` are never modules, for the index (`tools/prefab_index.mjs`), the desktop folder's listing (`apps/desktop/prefab-folder.js`, which also skips names starting with `.`) and the MCP notes (`crates/noteful-cli/src/ink_tools.rs` `module_ai_notes`). Name the folder as the module's `id`: shipped modules' files are found at `prefabs/<folder>/`, folder modules' at `prefabs-user/<folder>/`.

## module.json

The template's, which is a complete working one:

```json
{
  "id": "example",
  "api": 1,
  "version": "1.0.0",
  "order": 1000,
  "label": "Example list",
  "kind": "custom",
  "output": "picture",
  "types": ["example"],
  "names": { "example": "Example list" },
  "editor": "editor.js",
  "groups": { "mine": "My prefabs" },
  "prefabs": [
    { "id": "example", "group": "mine", "label": "Example list", "hint": "A title and a list of lines in a box", "icon": "note",
      "spec": { "type": "example", "title": "Things to remember", "lines": [{ "text": "First" }, { "text": "Second" }] } }
  ]
}
```

Checked when the module is added (`prefab-registry.js` `manifestProblem`; a module that fails is refused with the reason, and **Modules…** lists it with the reason): `id`, `api`, `kind` and `prefabs`. The rest is read where noted.

| field | required | what it does |
|---|---|---|
| `id` | yes | Lower-case letters, digits and dashes, starting with a letter or digit, at most 41 characters (`/^[a-z0-9][a-z0-9-]{0,40}$/`). Stored in every figure's spec as `module`, so never change it once figures exist. A folder module with the id of a shipped one **replaces** it. |
| `api` | yes | Must be `1` (`prefab-registry.js` `API`). A module for another api is refused. |
| `version` | no | Shown in **Modules…**. When a folder module has the id of a shipped one and a different version, the list says "the app has X". |
| `order` | no | Sorts the shipped modules (in `prefabs/index.js`, so in the picker) and the MCP notes. Default 1000; the shipped ones use 10–60. Folder modules come after the shipped ones in the folder's listing order (a replacement keeps the replaced one's place). |
| `label` | no | The module's name in **Modules…** and in "The … editor could not open". |
| `kind` | yes | `"custom"`, `"type"` or `"window"` (see above). Use `"custom"`. |
| `output` | no | `"picture"` (an SVG drawn into a framed picture) or `"items"` (ink and text boxes: window modules only). With `"items"` and no `legacyKind`, the card's kind is the module's `id`, which only `graph` and `table` handle. Use `"picture"`. |
| `legacyKind` | no | The kind the app knew the figure by before modules: `"graph"`, `"table"`, `"prefab"` or `"uml"`. Only the shipped modules need it; leave it out (a picture module is then `"prefab"`). |
| `types` | for pictures | The `spec.type` values the module owns. A spec without `module` (notes from before modules, specs written by hand or by AI without it) finds its module by type. Pick a type no other module uses. |
| `names` | no | `{ type: "Name" }`: the figure's name in menus when `render.js` has no `name()` (or it returns nothing). |
| `groups` | no | `{ groupId: "Label" }`: labels for groups the app does not have. The app's own are `basic` (Tables and graphs), `exam` (Exam figures) and `diagram` (Diagrams); the first label any module gives a new id is used (the shipped `maths` is "Maths"). Groups appear in that order, then new ones in the order their first card comes. |
| `prefabs` | yes | The picker's cards: an array, or `"code"` for cards made by `render.js` `prefabs()` (the uml module does that). |
| `editor` | no | `"editor.js"` (any path ending in `.js`, relative to the module's folder): the module's own editor. `"chart-editor"`, `"uml-editor"`, `"graph"`, `"table"`, `"data"`: those app editors (`editorOf` in prefab-registry.js). Nothing: the app's editors by type (`uml` → diagram editor; `states`, `timeline`, `histogram`, `bar`, `plot` … → chart editor), else the **JSON editor** (title, *Empty, for students to fill in*, the spec as JSON and a preview). |
| `base` | no | For `kind: "type"`: which base editor (`grid-paint`, `bars`, `plot`, `diagram`, `data`). Not read by the app yet. |
| `menu` | no | `[{ "label": "Play…", "icon": "play", "mode": "play" }]`: entries added to its figures' menu, before *Edit …*; each opens the module's `editor.js` with `host.mode` set to its `mode` (the algorithms module: Play…, Edit input…, Edit code…). |
| `capabilities` | no | What the module's editor can do (`exercise`, `notes`, `json`, …), written by the shipped charts and uml modules. Not read by the app yet. |

A card in `prefabs`:

| field | |
|---|---|
| `id` | Unique among all cards of all modules: a later card with an id already taken is dropped. Recent prefabs remember it. |
| `group` | Its group in the picker; default: the module's id. |
| `label`, `hint` | Its title and line in the picker (the search looks in both, the group's label and the card's id). |
| `icon` | A name from `apps/reader/icons.js` (`graph`, `table`, `minus`, `hash`, `note`, `clock`, `share`, `uml`, `check`, `grip` …). An unknown name draws the `note` icon. |
| `spec` | The figure it starts as (cloned for each use). It opens in the editor first; Insert places it. |

## render.js

Plain ES module, **pure**: no `document`, no `window`, nothing at the top level that needs a browser. The shipped modules' `render.js` is imported statically by `prefabs/index.js`, which the registry imports, which `prefabs.js` imports: in the reader, in exams and in **Node** (MCP `add_prefab` runs `node` on `apps/reader/prefabs.js`). One `render.js` that touches the DOM at import breaks all prefabs, so test it in Node (the tests do).

Exports (all optional; without `render` the module draws nothing):

```js
import { escapeHtml } from '../kit/svg.js';

// spec → { svg, width, height }, or null when it draws nothing.
export function render(spec) {
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80" width="300" height="80">…</svg>`, width: 300, height: 80 };
}
// Its name in menus: the context menu says `Edit ${name.toLowerCase()}…`.
export const name = (spec) => 'Truth table';
// Only with "prefabs": "code" in module.json: the cards, built in code.
export function prefabs() { return [{ id: 'x', group: 'mine', label: 'X', hint: '…', icon: 'note', spec: { type: 'x' } }]; }
```

`render(spec)` is called with whatever spec is stored, for:
- the picture placed on the page (and again at each resize),
- the picker's preview of each card,
- the editor host's `host.render`,
- MCP `add_prefab` (shipped modules only: MCP reads `apps/reader/prefabs/`, not your desktop folder).

So: never throw on a spec that is odd, old or written by an AI. The template and the number line start with a `normalize(spec)` that turns anything into a whole spec (numbers where numbers belong, lists capped) and export it for the editor and tests. Return `{ svg, width, height }` with `width`/`height` the SVG's own size: the picture keeps that aspect ratio. Draw with explicit colours on a white or transparent background (the picture is shown on white pages and in the editor on white; no CSS, no `currentColor`), and escape every text with `escapeHtml`.

A spec field the app knows: `title` (the JSON editor shows it as its own field) and `blank` (the JSON editor's *Empty, for students to fill in*). Using them is up to your `render`.

Folder modules: `render.js` is imported when the app starts (and with **Reload modules**). It may import `../kit/…` (served from the app) and files of its own folder.

## editor.js

Opened by the app (`apps/reader/prefab-host.js` `openModuleEditor`) in a modal dialog over the note, when a card of the module is chosen in the picker and when its figure is edited again:

```js
export function open(root, { spec, editing, host }) {
  // fill `root`; call host.done(spec) or host.cancel() once
  return { destroy() { /* undo what open() did outside root */ } };
}
```

- `root`: an empty element filling the dialog (`.pk-host`). Build in it with the kit's `editorShell`.
- `spec`: a copy (`structuredClone`) of the card's spec or of the figure's stored spec (with its `module`).
- `editing`: `true` when editing a figure already on a page.
- `host`:
  - `host.done(spec)`: finish with this spec. The app adds `module: <id>`, draws it with `render`, and places it (or replaces the figure, one undo step). `host.done(null)` is the same as cancel.
  - `host.cancel()`: leave without changing anything.
  - `host.render(spec)`: the module's own `render` (`null` when it has none).
  - `host.applyLabel`: `"Apply"` when editing, else `"Insert"`: give it to `editorShell`.
  - `host.editing`: as above.
  - `host.mode`: `"author"`, or the `mode` of the manifest's `menu` entry it was opened from.
  - `host.kit`: the kit's exports (`kit/index.js`), the same as importing them.
- Returns `{ destroy }`: called once, when it closes. `editorShell(...).destroy()` undoes everything the shell did.
- Keys: the dialog stops key events from reaching the note, and the browser's Esc on the dialog is turned off, so Esc is yours; `editorShell` maps it to `onCancel`, and Ctrl Enter to `onApply`.
- If `open` throws, the dialog closes and the app shows "The <label> editor could not open: <message>".
- Import the kit as `'../kit/index.js'` and your own files relatively (`'./render.js'`): both work for shipped modules and in the desktop folder.
- Folder modules: `editor.js` is imported the first time it opens and then kept by the browser; changes to it (and to files `render.js` imports, other than `render.js` itself) need a restart of the app, not just **Reload modules**.

The pattern the template uses: a `model` (the normalised spec), `past`/`future` stacks of JSON for undo, `change(next)` that pushes, normalises and redraws, and `draw(rebuild)` that sets `shell.canvas.innerHTML = render(model).svg` and rebuilds the panel only after undo/redo (rebuilding while typing would take the focus away from the field).

To show a problem (an expression that does not parse), use `shell.say(text, true)`; the line stays until the next `say`, and `say('')` clears it.

## The kit

`apps/reader/prefabs/kit/index.js`. What the chart and diagram editors are built with. Import from `'../kit/index.js'` (or use `host.kit`).

### Shell and fields (`kit/shell.js`)

**`editorShell(root, options)`** → `{ bar, palette, canvas, panel, status, say(text, error), history(canUndo, canRedo), destroy() }`. The frame: a bar (undo, redo, title, help, Cancel, Insert/Apply), an optional palette on the left, the canvas, the properties panel on the right (both resizable, widths remembered under `id`), and a status line. Options: `id`, `title`, `applyLabel`, `onApply`, `onCancel`, `undo`, `redo` (functions, or leave out for no history buttons), `palette` (default `false`), `panel` (default `true`), `help` (cheat sheet sections, see `cheatSheet`). Keys: Esc → `onCancel`, Ctrl Enter → `onApply`, Ctrl Z / Ctrl Shift Z / Ctrl Y → undo/redo (not while typing in a field), `?` → help. Two- and three-finger taps on the canvas undo and redo. It loads `kit.css` itself.

```js
const shell = editorShell(root, { id: 'truthtable', title: 'Truth table', applyLabel: host.applyLabel,
  onApply: () => host.done(model), onCancel: () => host.cancel(), undo, redo,
  help: [{ title: 'Truth table', icon: 'table', rows: [{ keys: 'Ctrl Enter', does: 'Insert' }] }] });
shell.canvas.innerHTML = render(model).svg;
shell.history(past.length > 0, future.length > 0);
shell.say('Not a valid expression', true);
```

**`make(tag, props, ...children)`**: an element with properties and children (`null`/`false` children are skipped).

```js
make('h4', { textContent: 'Rows' });
make('div', { className: 'pk-row' }, input, button);
```

**`button(iconName, label, { primary, iconOnly, title })`**: a kit button (`.pk-button`).

```js
const add = button('plus', 'Add variable'); add.onclick = () => …;
```

**`field(label, input, hint)`**: a labelled row for the panel.

```js
shell.panel.append(field('Title', textInput(model.title, (title) => change({ title })), 'Shown above the table'));
```

**`textInput(value, change, { placeholder })`**: calls `change(text)` on every keystroke.

**`numberInput(value, change, { step, min, max })`**: calls `change(number)` only for a finite number (an empty or half-typed field calls nothing).

```js
field('Ticks every', numberInput(model.step, (step) => change({ step }), { min: 0 }));
```

**`checkInput(label, checked, change)`**: a checkbox with its label; `change(boolean)`.

```js
checkInput('Show the output column', model.output, (output) => change({ output }));
```

**`selectInput(options, value, change)`**: `options` is `[[value, label], …]`; `change(value)` (a string).

```js
selectInput([['10', '1 and 0'], ['VF', 'V and F']], model.notation, (notation) => change({ notation }));
```

**`listInput(items, { row, blank, change, addLabel })`**: rows that can be added, moved up and removed. `row(item, update, i)` returns the row's inputs (one element or an array); `update(partial)` merges into that item; `blank()` is a new item; `change(list)` gets the whole new list after every change.

```js
listInput(model.points, {
  row: (p, update) => [numberInput(p.x, (x) => update({ x })), textInput(p.label, (label) => update({ label }))],
  blank: () => ({ x: 0, label: '' }),
  change: (points) => change({ points }),
  addLabel: 'Add point',
});
```

**`loadKitStyles()`**: adds `kit.css` once. `editorShell` and the host call it; you need it only for kit elements outside a shell.

### SVG helpers (`kit/svg.js`)

**`escapeHtml(value)`**: `& < > "` escaped, for every text and attribute you put in SVG.

```js
`<text x="10" y="20">${escapeHtml(spec.title)}</text>`
```

**`evalMathExpr(expr, vars)`**: a safe maths evaluator (no `eval`): `+ - * / % ^ **`, parentheses, implicit multiplication (`2x`, `2sin(x)`), `sin cos tan asin acos atan sinh cosh tanh sqrt cbrt abs ln log log10 log2 exp floor ceil round sign min max`, `pi π e tau`. Returns `NaN` for anything it cannot read.

```js
evalMathExpr('x^2 - 1', { x: 3 });   // 8
evalMathExpr('2a + b', { a: 1, b: 4 }); // 6
```

**`sanitizeSvg(raw)`**: keeps only safe SVG (shapes, text, markers; no scripts, `foreignObject`, images, event handlers or URLs). For SVG that comes from a user or an AI.

```js
const svg = sanitizeSvg(spec.svg); // '' when nothing safe is left
```

### Editor parts the chart and diagram editors share

Use these when your editor grows a palette, notes or a JSON mode.

**`icon(name)`**: an SVG icon element from `icons.js`.

```js
make('span', {}, icon('table'), ' Rows');
```

**`cheatSheet(host, { key, title, sections })`** → `{ toggle(), open, destroy() }`: a floating window listing the keys. `sections`: `[{ title, icon, rows: [{ keys: 'Ctrl Z', icon, does: 'Undo' }] }]`; a section's `icon` and a row's `keys` and `icon` are optional (a row with only `does` is a line of text). `editorShell`'s `help` option makes one for you.

**`editorQuickMenu(root, { entries, onReorder })`** → `{ quick, destroy() }`: the Shift S ring at the pointer. `entries()` → `[{ key, label, icon, active(), run() }]`.

```js
const ring = editorQuickMenu(root, { entries: () => tools.map((t) => ({ key: t.id, label: t.label, icon: icon(t.icon), active: () => tool === t.id, run: () => choose(t.id) })), onReorder: (ids) => saveOrder('mytools', ids) });
```

**`orderedIds(name, ids)`**, **`saveOrder(name, ids)`**, **`keyFor(index)`**, **`indexOfKey(key)`**: the palette's order as the person dragged it (kept on this device) and the number keys that follow it.

```js
const order = orderedIds('mytools', ['and', 'or', 'not']); // kept order first
keyFor(0); // "1"   indexOfKey('0'); // 9
```

**`sortable(container, { items, key, onReorder })`**: drag to reorder a row or column of buttons.

```js
sortable(shell.palette, { items: '.my-tool', key: (el) => el.dataset.id, onReorder: (ids) => saveOrder('mytools', ids) });
```

**`figureNotes({ get, set })`** → `{ pane, show(), hide(), sync(), … }`: Markdown notes kept in the spec (`notes`), written or read rendered.

```js
const notes = figureNotes({ get: () => model.notes || '', set: (notes) => change({ notes }) });
shell.panel.append(notes.pane); notes.show();
```

**`resizablePanels(grid, panels)`** → `{ update(), destroy() }`: grips that resize side panels by a CSS variable (`editorShell` already does this for its two).

**`codeBox(textarea)`** → `{ box, paint(), mark(line), go(index) }` and **`jsonErrorAt(text, error)`** → `{ line, column, index, message }`: a JSON box with line numbers and the error's line marked.

```js
const area = make('textarea', { value: JSON.stringify(model, null, 2) });
const code = codeBox(area);
area.oninput = () => { try { change(JSON.parse(area.value)); code.mark(null); } catch (e) { code.mark(jsonErrorAt(area.value, e).line); } };
shell.panel.append(code.box);
```

**`editorTouch(el, { undo, redo, menuAt })`** → `{ destroy() }` and **`fingerTaps()`**: the finger and pen gestures (two-finger tap undo, three-finger redo, hold for a menu). `editorShell` already adds them to its canvas.

**`API`**: `1`, the kit's and host's api version.

## ai.md

One line per spec shape, a Markdown bullet with a complete example spec including `"module"`, and a few words on what is not obvious:

```
- Truth table: {"type":"truthtable","module":"truthtable","title":"","variables":["A","B"],"expr":"A and not B","output":"values"} — operators …
```

The MCP tool `add_prefab` puts these lines in its description (`ink_tools.rs` `add_prefab_description`): it reads every `apps/reader/prefabs/<folder>/ai.md` next to the reader it finds (`NOTEFUL_READER_DIR`, else near the executable, else the source tree it was built from), skipping `_…` and `kit`, in `module.json` `order`. When it finds no reader, it uses `SHIPPED_PREFAB_NOTES`, the shipped ones compiled in with `include_str!`. A new shipped module is therefore usable by AI with no Rust change; adding it to `SHIPPED_PREFAB_NOTES` too keeps the compiled-in fallback complete (the crate's test `shipped_prefab_notes_match_the_modules` fails until you do). Desktop-folder modules are not seen by MCP.

## Tests

Each module tests its `render.js` in Node, in `test/<name>.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, render } from '../render.js';

test('a truth table has 2^n rows', () => {
  const { svg, width, height } = render({ variables: ['A', 'B'], expr: 'A and B' });
  assert.ok(svg.startsWith('<svg') && width > 0 && height > 0);
});
```

Run with the others (as CI does):

```
node --test apps/reader/*.test.mjs apps/reader/prefabs/*/test/*.test.mjs
```

`apps/reader/prefab-registry.test.mjs` lists the shipped modules and the picker's groups: a new shipped module goes into its expected `listModules()` ids (and a new group into `groups()`). It also fails while `prefabs/index.js` is out of date. For the editor in a browser, `tools/prefab_module_e2e.mjs` is the example (Chromium after `python3 tools/build_web.py`): it picks the number line, edits, undoes, inserts and edits it again.

## Shipped modules: prefabs/index.js

The modules in `apps/reader/prefabs/` reach the app through `prefabs/index.js`, generated by

```
node tools/prefab_index.mjs           # write it
node tools/prefab_index.mjs --check   # fail if out of date
```

It lists every folder with a `module.json` (not `_…`, not `kit`), sorted by `order` then `id`, with its manifest inlined and its `render.js` imported statically. `python3 tools/build_web.py` runs it before building, and copies `prefabs/` into the web build without `test/` folders and `*.test.mjs` files (so `_template/` ships too, and **Copy to…** copies it into your folder). Commit the regenerated `index.js` with the module.

## The desktop folder

In the desktop app, **Insert prefab → Modules…** lists the modules in use (kind, app or folder, version) and any refused ones with the reason, and has:

- **Copy to…**: copies the app's modules (not `kit/`, not `index.js`; `_template/` included) into the chosen folder, or into a `prefabs` folder inside it when it is not empty, never over files already there, and uses that folder from then on.
- **Use a folder…**: uses a folder of modules you already have.
- **Open folder**, **Use the app's own** (after a restart), **Reload modules**: read the folder's `module.json` and `render.js` again.

The choice is kept in the app's user data (`prefab-modules.json`). At start the app lists the folder (folders with a `module.json`, not `_…`, `.…` or `kit`), imports each `render.js`, and adds each module; one with the id of a shipped module replaces it.

The folder is served to the reader at `prefabs-user/` (`notecomplete://reader/prefabs-user/<folder>/…`), a sibling of `prefabs/`, so a module's relative imports resolve as for a shipped one: `../kit/…` is always the **app's** kit (a `kit/` in your folder is ignored), and `../../icons.js` the app's file. Paths that leave the folder or contain a part starting with `.` are refused.

To add a module there: copy `_template` to a new folder name, edit, then **Reload modules** (and reopen the picker). A changed `editor.js` needs a restart.

**Trust:** modules in the folder run as the app's own code, with its rights (no sandbox), at the owner's choice. Add only modules you trust.

## Checklist

- [ ] Folder named as the `id`, not starting with `_`.
- [ ] `module.json`: `id`, `api: 1`, `kind: "custom"`, `output: "picture"`, a new `types` entry, `names`, cards with unique ids, `groups` for a new group, `editor: "editor.js"`.
- [ ] `render.js`: pure, never throws, `normalize` exported, texts escaped, explicit colours, returns `{ svg, width, height }`; `name()`.
- [ ] `editor.js`: `open(root, { spec, editing, host })` → `{ destroy }`, built with `editorShell`, finishes with `host.done(model)` / `host.cancel()`.
- [ ] `ai.md`: one line with a full example spec including `"module"`.
- [ ] `test/`: `normalize` and `render` in Node.
- [ ] Shipped: `node tools/prefab_index.mjs`, the module and group in `prefab-registry.test.mjs`, the `ai.md` in `SHIPPED_PREFAB_NOTES` (`cargo fmt`, `cargo clippy`, `cargo test -p noteful-cli`).
