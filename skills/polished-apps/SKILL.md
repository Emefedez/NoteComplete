---
name: polished-apps
description: Stack, structure and visual system for lightweight, feature-rich desktop/web apps that render fast and stay easy to look at — editors, analyzers, media tools, dashboards, creative and engineering tools (e.g. a signal analyzer, a video editor, a log viewer, a CAD-like editor). Gives a Rust-core architecture with a choice of frontends (web UI in Tauri/Electron, native egui/Slint, GPU views with wgpu/WebGPU), copyable tokens, component CSS, workspace layout with docked panels, menubar, command palette, layering, accessibility, data-series colours, real-time rendering budgets, AI features and screenshot checks. Use it whenever starting an app, choosing a stack, laying out a workspace, adding panels/dialogs/toolbars, building a plot/timeline/canvas view, adding AI features to an app, or making an existing app consistent or faster — even if the user doesn't say "design".
---

# Polished apps

Target: lightweight, feature-rich, wide and calm, fast to render. One set of decisions (stack, tokens, layout, interaction) applied to every feature. Copy the templates and decide only what's specific to the app.

## Files

| Need | File |
|---|---|
| Stack per app type, crates, shells, data plumbing, repo layout | `references/stack.md` |
| Workspace layout, top bar, docks, command palette, layering | `references/layout.md` |
| Real-time rendering, plots, media, budgets, measuring, tests | `references/performance.md` |
| AI features: providers, prompts, jobs, review actions | `references/ai.md` |
| A full app built this way (NoteComplete): where each rule lives, decisions, bugs | `references/example-notecomplete.md` |
| Tokens: palette, data series, sizes, z-scale, dark, touch | `templates/tokens.css` |
| Components: buttons, fields, menus, toolbars, docks, inspector, dialogs, lists, palette, tags, toasts | `templates/components.css` |
| Workspace skeleton with ARIA | `templates/layout.html` |
| Command palette | `templates/command-palette.js` |
| Drag to reorder / drag out | `templates/reorder.js` |
| Floating windows (drag, resize, _ □ ×, tray) | `templates/floating.js` |
| Electron shell (windows, tabs, guarded IPC, no flash) | `templates/electron/` |
| Screenshots of every state, light + dark | `scripts/cdp-gallery.mjs` |

## Stack (defaults; details in references/stack.md)

- **Core in Rust**: model, formats, processing, undo log, export. No UI, no direct I/O in the core crate; adapters for CLI, MCP, WASM, the shell.
- **Heavy compute** in Rust threads (rayon) or WASM workers; **heavy drawing** on the GPU (wgpu natively, WebGPU/WebGL2 in a web UI).
- **Frontend**, pick one:
  - Web UI (HTML/CSS + TypeScript or plain ES modules, a small reactive lib only if state gets complex) in **Tauri** (light, system WebView) or **Electron** (bundled Chromium: consistent WebGPU, codecs, media APIs).
  - **Native Rust UI** (egui for tools/analyzers with dense controls and live plots; Slint for polished fixed layouts) when everything is Rust or latency is critical.
- **Storage**: project file (versioned, additive) or SQLite; source media/data immutable; edits as a log.
- **Distribution**: Tauri bundler / electron-builder / cargo-dist; CLI and MCP from the same core.

## Visual system

- Tokens first (`templates/tokens.css`); components only use tokens.
- One control height (28px pointer, 36px touch), radius 6px controls, 8px boxes.
- Surfaces: canvas (behind the work), chrome (bars, docks), surface (dialogs, fields), menu (popovers). Borders 1px `--line`, two shadows only.
- **One UI accent** (any hue) with soft + hover tints: selection, chosen tool, focus, main action. Buttons are transparent on bars, lightly filled in panels and dialogs, pale-accent when chosen or primary. Solid accent only for small indicators (progress, playhead, markers).
- **Data colours are separate** from UI colours: a fixed categorical series palette (6–8, colour-blind safe) for channels/tracks/series, a sequential ramp for intensity (spectrograms, heatmaps). The UI stays neutral so data stands out.
- Semantic colours (danger, ok, warning) only for meaning, always paired with text or an icon. Use their **soft** tints for buttons and states: "fix it" actions (double check, report, dispute) are soft red (`.fix`), a correct answer soft green, a wrong one soft red; solid red only for text or a tiny mark. Destructive confirmation = soft red + an explicit label ("Press again to discard").
- Wide and low: controls in rows, labels left of fields, dialogs wider than tall.
- Rounded pills only for secondary status items (tags, filters, background jobs, toasts).
- Numbers: tabular figures, monospace for timecodes/addresses, units always shown.
- Dark mode is the same tokens redefined; many media/analysis tools default to dark.

## Layout (details in references/layout.md)

Top bar (menubar · title/tabs · jobs · assistant · command search) → toolbar → workspace: main view (canvas/plot/timeline) with docked panels (explorer left, inspector right, bottom dock for timeline/console/measurements), all resizable and collapsible, sizes remembered. Floating panels only for transient tools. A status bar only for live readouts (cursor value, timecode, sample rate, CPU/GPU load); transient messages are toasts.

## Arrows, menus and icons

- **Chevrons** on everything that expands: a small 5px chevron pointing down, turning up when open (`details > summary::after`); tree rows point right, then down. Menubar items have none, as in native menus.
- **Carets** on buttons that open a dropdown (`.has-caret` + `aria-expanded`, `aria-haspopup`).
- **Menus**: menubar menus, dropdowns and context menus share one look (menu surface, 8px radius, pop shadow, `<kbd>` shortcuts right-aligned, separators as thin lines). Right-click / long-press opens the context menu for the thing under the pointer, with the same commands as the menubar.
- **Side menus**: docks for things used while working (explorer, inspector), collapsible to an edge with a toggle; drawers (`.drawer`) for occasional things (project, settings, history) and as the navigation on narrow screens, sliding over the workspace with a scrim on small screens only.
- **Tooltips**: native `title` with the shortcut ("Undo (Ctrl Z)"); no custom tooltip widgets.
- **Icons**: one stroke set (24×24, `stroke: currentColor`, 1.65 width, round caps), 16px in bars; icon + short label where space allows. The sparkle (✦) marks every AI action, starting with the "Ask AI" button in the top bar.
- **Close / minimize**: × closes, – minimizes, both top-right of panels; floating panels drag by their head and remember their place.

## Floating windows

Tool windows that sit over the work (assistant, audio, quiz, practice, inspectors that float) use `templates/floating.js`:
- drag by the head; resize from every edge and corner (a small mark on the bottom-right corner);
- always clamped inside the work area, so the head and × stay reachable after any drag, resize or window resize; a narrow head squeezes its selects and titles, never its buttons;
- head buttons `_ □ ×`: `_` puts the window in the **tray** (a pill with a caret at the bottom left listing put-away windows; choosing one brings it back in place), `□` toggles small (head only) / large, `×` closes; closing also removes it from the tray;
- place and size remembered per window; modal dialogs stay modal and fixed;
- `□` collapses under the head: same width, head stays put (place windows by left/top, not bottom); expanding restores the exact size;
- stacking like a desktop: the window pressed last is in front, a window that opens comes in front; a focus mode that dims the background lifts the whole stack above its veil without reordering it.

Optional focus mode: a sun toggle in a study/focus window's head dims everything behind it (remembered; lifted when the window is small, put away or closed).

## Zoom, export, previews

- **Two zooms**: Ctrl + / − / 0 zoom the document; Ctrl Shift + / − / 0 scale the whole interface (all tabs and windows, remembered). Shells without built-in zoom (Electron `BaseWindow`) need it implemented with `setZoomFactor`. Match keys by `key` *and* `code`: Shift changes the key on every layout (US Shift+0 = `)`, Spanish Shift+0 = `=`, Spanish Shift++ = `*`).
- **Export row** in File: `Pages as SVG · PDF · IMG▾` (small filled buttons in one row; IMG opens the formats JPEG · WebP · PNG with a one-word hint each). Multi-page exports run as background jobs with Stop; binding (PDF) happens in the core.
- **Previews open large**: any thumbnail, crop or hint image opens fitted to the window on click/Enter; Esc or a click closes.

## Interaction

- Everything reachable three ways: menu (with shortcut shown), command palette (Ctrl K), keyboard shortcut.
- Direct manipulation on the main view (drag, scrub, zoom to pointer, box select); inspector edits the selection with live preview and one undo step per gesture.
- Long work runs in the background with a job chip (phase, elapsed time, progress, Stop); the UI never blocks.
- Undo instead of confirmation; confirm only before losing data.
- Reserve space for things that appear, so layout never jumps; new windows/views paint the backdrop colour first.
- Spell check off by default (`spellcheck="false"` on `<html>`, Electron `webPreferences.spellcheck: false`): people write in several languages and a single-language checker underlines everything. Offer it as a setting with chosen languages if the app is mostly about writing.

## Accessibility

- Native elements and roles: `button`, `dialog`+`showModal`, menubar/menu/menuitem, tablist/tab, toolbar, combobox+listbox for search, `aria-pressed`, `aria-current`, `aria-live` for jobs and toasts.
- Icon buttons: `aria-label` + `title` with the shortcut. A key-hint overlay (`?`).
- 2px accent focus ring on `:focus-visible`; full keyboard use including the main view (arrow keys move cursor/playhead/selection, +/- zoom).
- Never colour alone (series also differ by label/dash; errors have text). Contrast ≥ 4.5:1 for text.
- Respect `prefers-reduced-motion`, `prefers-contrast`, `pointer: coarse`; scalable UI (no fixed px fonts in canvases: draw at devicePixelRatio).

## Performance (details in references/performance.md)

Idle = zero work. Render loops run only while playing, streaming or animating. Draw at most once per frame, decimate to pixels (min/max per column), level-of-detail caches, GPU for large data, workers for decoding and analysis, bounded DOM, lazy-loaded heavy modules.

## AI (details in references/ai.md)

AI acts on the user's selection with the source attached, returns structured output, and every result can be explained, double-checked, edited or discarded in place. Long requests are background jobs; everything is cancellable.

## Customization

Rearrangeable docks and toolbars (drag), saved workspace layouts, remembered sizes and choices, editable presets and AI instructions with "Restore default", theme follows the system, keyboard shortcuts listed and (ideally) remappable.

## Working method

1. New app: pick the stack row in `references/stack.md`, copy tokens/components/layout, wire the shell.
2. New feature: reuse an existing pattern (dock panel, inspector section, dialog, job); add tokens only if a value truly differs.
3. Existing inconsistent app: measure the best-looking part, turn its values into tokens, replace values where they're defined (not override blocks at the end).
4. Before/after screenshots of every state, light and dark (`scripts/cdp-gallery.mjs`), and look at them.
5. Test pure logic, then flows headless with fake bridges, then the shell against a stub, then the real app; report what wasn't exercised. Verify in the app's default theme only, unless a change is theme-specific.
6. Keep a requests log (`docs/REQUESTS.md`) with bracket states that are easy to edit by hand: `[D]` done, `[!]` done but not verified in the real app or service, `[ ]` to do, each with how it was checked. Keep the README's known issues in step with it.
