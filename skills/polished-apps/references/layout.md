# Layout

## Workspace

```
┌ top bar ───────────────────────────────────────────────────────────────┐
│ ≡ File Edit View Tools Help     Project — tabs •     [job] ✦ Assist ⌘K │ 36px
├ toolbar ───────────────────────────────────────────────────────────────┤
│ [Select] Cut Zoom Measure │ ▶ ■ ● │ 00:01:23.456 │           ↶ ↷  ▾    │ 28px controls
├──────────┬──────────────────────────────────────────────┬──────────────┤
│ explorer │ main view                                    │ inspector    │
│ (files,  │ (canvas / plot / viewer / timeline)          │ (selection   │
│ channels,│                                              │ properties,  │
│ layers)  │                                              │ sections)    │
├──────────┴──────────────────────────────────────────────┴──────────────┤
│ bottom dock: timeline | console | measurements   (tabs, resizable)     │
├ status (only live readouts) ───────────────────────────────────────────┤
│ x 12.300 ms  y −3.2 dB   48 kHz · 2 ch            GPU 4%  ● recording  │ 22px
└────────────────────────────────────────────────────────────────────────┘
```

Examples:
- Signal analyzer: explorer = sources/channels with series colours; main = stacked plots + spectrogram with shared time axis; inspector = channel/filter/trigger settings; bottom = measurements table, markers; status = cursor readout, sample rate, buffer health.
- Video editor: explorer = media bin; main = viewer (source | program); bottom = timeline (tracks, playhead); inspector = clip effects/keyframes; status = timecode, fps, render queue.

Rules:
- Docks are resizable (splitters), collapsible to an edge, and remember size per workspace. Saved layouts ("Edit", "Color", "Measure") for complex apps.
- The main view never moves when docks open or close temporarily: transient tools float over it (find bar, assistant, popover editors); permanent docks resize it once.
- Empty states say what to do and offer the one action (Open / Record / Import).
- Phones/narrow: docks become bottom sheets; menubar scrolls; toolbar wraps into a "more" menu.

## Top bar

- Left: app/home button and a native-style menubar (File, Edit, View, …, Help) holding every action with its shortcut in `<kbd>`.
- Centre: project title + unsaved dot, or a tab strip (drag to reorder, drag out = new window, middle-click closes).
- Right: background job chips, the assistant button, the command search button (`Ctrl K`).
- Can compact (lower height) when the main view scrolls or in focus mode.

## Toolbar

- Groups separated by thin dividers: tools (one chosen, `aria-pressed`), transport/actions, readouts, view controls on the right.
- Icon + short label where space allows; icon-only with tooltip + shortcut otherwise.
- Tool options pop up under the pressed tool, or live in the inspector for persistent tools.

## Inspector

- Sections (collapsible `<details>`), each a property grid: label left (fixed column), control right, unit after.
- Number fields scrub on drag, accept expressions and units, arrow keys step (Shift ×10).
- Mixed values (multi-selection) shown as "—"; edits apply to all.
- Live preview while dragging; one undo step on release.

## Command palette (Ctrl K)

- Every command once: generated from menu items (plus extra labels), grouped by menu when the query is empty, shortcut shown.
- Dynamic entries from the query: recent files, open tabs/windows, "go to 12.5 s" / "frame 340" / "line 80", settings by name.
- Fuzzy subsequence match with word-start bonus (`templates/command-palette.js`).
- `role="combobox"`, `listbox`/`option`, `aria-activedescendant`; arrows + Enter; Esc closes.
- Separate from find (Ctrl F): a floating bar over the main view with scope filters and a result list that jumps to hits.

## Layering

Use the `--z-*` scale (tokens.css): in-view overlays 1–9 (cursors, selections, hit marks, handles), tool options 20, find 25, floating panels 26–27, popovers 28, top bar 40, toast 70, context menus 80, custom select lists 1000. Dialogs use `showModal()` (top layer). Canvas apps: draw data in a canvas, put interactive handles and text in an absolutely positioned DOM/SVG layer above it.

## Dialogs

Wide (~580px), labels left of fields, radio groups as rows of choices, actions bottom-right (secondary filled, primary pale accent). Prefer inspector/inline editing over dialogs; dialogs for one-off tasks (export, new project, preferences).
