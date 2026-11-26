// The kit's editor shell (docs/PREFAB-MODULES-GUIDE.md): what a custom module's editor is
// built in, the same frame as the chart and diagram editors. A bar (undo, redo, the editor's
// title, help, Cancel and Insert/Apply), an optional palette on the left, the canvas, the
// properties panel on the right (both panels resizable and remembered), and a status line.
// Keys: Esc cancels, Ctrl Enter applies, Ctrl Z / Ctrl Shift Z undo and redo; fingers and pen
// as on the pages (two- and three-finger taps undo and redo; a hovering pen shows a ring).
import { icon } from '../../icons.js';
import { resizablePanels } from '../../panel-resize.js';
import { cheatSheet } from '../../cheat-sheet.js';
import { editorTouch } from '../../editor-touch.js';

// The kit's stylesheet, once (over a note and on an editor's own page alike).
export function loadKitStyles() {
  if (typeof document === 'undefined' || document.querySelector('link[data-prefab-kit]')) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./kit.css', import.meta.url).href });
  link.dataset.prefabKit = '';
  document.head.append(link);
}

export const make = (tag, props = {}, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((c) => c != null && c !== false));
  return el;
};
export function button(iconName, label, { primary = false, iconOnly = false, title = label } = {}) {
  const b = make('button', { type: 'button', className: `pk-button${primary ? ' primary' : ''}${iconOnly ? ' pk-icon' : ''}`, title });
  if (iconName) b.append(icon(iconName));
  if (!iconOnly) b.append(make('span', { textContent: label }));
  b.setAttribute('aria-label', label);
  return b;
}

// `root`: an empty element filling its window. `title`: the editor's name. `applyLabel`:
// "Insert" or "Apply". `onApply()`, `onCancel()`. `undo`/`redo`: functions, or null for no
// history. `palette`/`panel`: whether those columns exist. `help`: cheat sheet sections
// (cheat-sheet.js), or null. `id`: names the remembered panel widths.
export function editorShell(root, { id = 'module', title = '', applyLabel = 'Insert', onApply, onCancel, undo = null, redo = null, palette = false, panel = true, help = null } = {}) {
  loadKitStyles();
  root.classList.add('pk-editor');
  const undoBtn = undo && button('undo', 'Undo (Ctrl Z)', { iconOnly: true });
  const redoBtn = redo && button('redo', 'Redo (Ctrl Shift Z)', { iconOnly: true });
  const helpBtn = help && button('help', 'What the mouse and keys do (?)', { iconOnly: true });
  const cancelBtn = button('close', 'Cancel');
  const applyBtn = button('check', applyLabel, { primary: true });
  if (undoBtn) undoBtn.onclick = () => undo();
  if (redoBtn) redoBtn.onclick = () => redo();
  cancelBtn.onclick = () => onCancel?.();
  applyBtn.onclick = () => onApply?.();
  const bar = make('div', { className: 'pk-bar' }, undoBtn, redoBtn, make('strong', { className: 'pk-title', textContent: title }), make('span', { className: 'pk-spacer' }), helpBtn, cancelBtn, applyBtn);
  const paletteEl = palette ? make('div', { className: 'pk-palette', role: 'toolbar' }) : null;
  const canvas = make('div', { className: 'pk-canvas', tabIndex: 0 });
  const panelEl = panel ? make('div', { className: 'pk-panel' }) : null;
  const main = make('div', { className: `pk-main${palette ? ' with-palette' : ''}${panel ? ' with-panel' : ''}` }, paletteEl, canvas, panelEl);
  const status = make('div', { className: 'pk-status', role: 'status' });
  root.replaceChildren(bar, main, status);
  const sides = resizablePanels(main, [
    ...(paletteEl ? [{ panel: paletteEl, variable: '--pk-left', side: 'left', key: `${id}-left`, min: 110, max: 360 }] : []),
    ...(panelEl ? [{ panel: panelEl, variable: '--pk-right', side: 'right', key: `${id}-right`, min: 200, max: 640 }] : []),
  ]);
  // Collapsible edge tabs (little arrow tabs hugging each sidebar's inner edge, like Pages).
  const collapseTabs = [];
  const makeCollapseTab = (side, cls, targetEl, storeKey, label) => {
    let open = true;
    try { open = localStorage.getItem(`notecomplete-panel-collapsed:${storeKey}`) !== '1'; } catch { /* Optional. */ }
    const tab = make('button', { type: 'button', className: 'panel-collapse-tab' });
    tab.dataset.side = side;
    const place = () => {
      const box = main.getBoundingClientRect();
      if (!box.width || !box.height) return;
      if (open) {
        const r = targetEl.getBoundingClientRect();
        if (side === 'left') tab.style.left = `${Math.max(0, r.right - box.left)}px`;
        else tab.style.left = `${Math.max(0, r.left - box.left - 18)}px`;
      } else {
        tab.style.left = side === 'left' ? '0px' : `${Math.max(0, box.width - 18)}px`;
      }
    };
    const sync = () => {
      main.classList.toggle(cls, open);
      const arrow = side === 'left' ? (open ? 'chevronLeft' : 'chevronRight') : (open ? 'chevronRight' : 'chevronLeft');
      tab.replaceChildren(icon(arrow));
      tab.title = open ? `Hide ${label}` : `Show ${label}`;
      tab.setAttribute('aria-label', tab.title);
      tab.setAttribute('aria-expanded', String(open));
      requestAnimationFrame(() => { sides.update(); place(); });
    };
    tab.onclick = () => {
      open = !open;
      try { localStorage.setItem(`notecomplete-panel-collapsed:${storeKey}`, open ? '0' : '1'); } catch { /* Optional. */ }
      sync();
    };
    main.append(tab);
    collapseTabs.push({ tab, place });
    sync();
  };
  if (paletteEl) makeCollapseTab('left', 'with-palette', paletteEl, `${id}-left`, 'tools sidebar');
  if (panelEl) makeCollapseTab('right', 'with-panel', panelEl, `${id}-right`, 'properties sidebar');
  const tabObserver = typeof ResizeObserver === 'function' && collapseTabs.length ? new ResizeObserver(() => collapseTabs.forEach((t) => t.place())) : null;
  if (tabObserver) {
    tabObserver.observe(main);
    if (paletteEl) tabObserver.observe(paletteEl);
    if (panelEl) tabObserver.observe(panelEl);
  }
  let sheet = null;
  const toggleHelp = () => {
    if (!help) return;
    sheet ||= cheatSheet(root, { key: `prefab-${id}`, title: title || 'Editor', sections: help, button: helpBtn });
    helpBtn.setAttribute('aria-pressed', String(sheet.toggle()));
  };
  if (helpBtn) helpBtn.onclick = toggleHelp;
  const fingers = editorTouch(canvas, { undo: () => undo?.(), redo: () => redo?.(), menuAt: () => {} });
  const typing = (t) => t instanceof HTMLTextAreaElement || t?.isContentEditable || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'color', 'button'].includes(t.type));
  const keys = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); return onCancel?.(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); return onApply?.(); }
    if (typing(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return (e.shiftKey ? redo : undo)?.(); }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo?.(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo?.(); }
    if (e.key === '?' && help) { e.preventDefault(); toggleHelp(); }
  };
  // Keys reach the editor also when the focus fell out of it (a list redrawn under the
  // pointer leaves it on the page): pressed with the focus on the page or on the editor's window.
  const stray = (e) => {
    if (!root.isConnected || root.contains(e.target)) return;
    if (e.target === document.body || e.target === document.documentElement || (e.target instanceof Element && e.target.contains(root))) { keys(e); if (e.defaultPrevented) e.stopPropagation(); }
  };
  root.addEventListener('keydown', keys);
  document.addEventListener('keydown', stray, true);
  requestAnimationFrame(() => canvas.focus({ preventScroll: true }));
  let sayTimer = 0;
  return {
    bar, palette: paletteEl, canvas, panel: panelEl, status, applyBtn,
    // A message in the status line; an error stays until the next one.
    say(text, error = false) {
      clearTimeout(sayTimer);
      status.textContent = text || '';
      status.classList.toggle('error', !!error);
      if (text && !error) sayTimer = setTimeout(() => { status.textContent = ''; }, 6000);
    },
    // Undo/redo buttons follow the history: `canUndo`, `canRedo`.
    history(canUndo, canRedo) { if (undoBtn) undoBtn.disabled = !canUndo; if (redoBtn) redoBtn.disabled = !canRedo; },
    destroy() { clearTimeout(sayTimer); tabObserver?.disconnect(); sheet?.destroy?.(); fingers.destroy(); sides.destroy(); root.removeEventListener('keydown', keys); document.removeEventListener('keydown', stray, true); root.replaceChildren(); root.classList.remove('pk-editor'); },
  };
}

// Properties: a labelled field, and the usual inputs, each calling `change(value)` as it changes.
export const field = (label, input, hint = '') => make('label', { className: 'pk-field' }, make('span', { textContent: label }), input, hint && make('small', { textContent: hint }));
export function textInput(value, change, { placeholder = '' } = {}) {
  const i = make('input', { type: 'text', value: value ?? '', placeholder, spellcheck: false });
  i.oninput = () => change(i.value);
  return i;
}
export function numberInput(value, change, { step = 'any', min = null, max = null } = {}) {
  const i = make('input', { type: 'number', value: value ?? '', step });
  if (min != null) i.min = min;
  if (max != null) i.max = max;
  i.oninput = () => { const n = Number(i.value); if (i.value !== '' && Number.isFinite(n)) change(n); };
  return i;
}
export function checkInput(label, checked, change) {
  const i = make('input', { type: 'checkbox', checked: !!checked });
  i.onchange = () => change(i.checked);
  return make('label', { className: 'pk-check' }, i, ` ${label}`);
}
export function selectInput(options, value, change) {
  const s = make('select', {}, ...options.map(([v, label]) => make('option', { value: v, textContent: label, selected: v === value })));
  s.onchange = () => change(s.value);
  return s;
}
// A list of rows (points, bars…): `row(item, update, i)` builds a row's inputs; rows can be
// added (`blank()` gives a new item), moved and removed. `change(list)` after each change.
export function listInput(items, { row, blank, change, addLabel = 'Add' }) {
  const box = make('div', { className: 'pk-list' });
  let list = structuredClone(items || []);
  // Redrawn after a row is added, moved or removed; the focus goes back to that button's place.
  const draw = (focus = null) => {
    box.replaceChildren(...list.map((item, i) => {
      const update = (next) => { list[i] = { ...list[i], ...next }; change(structuredClone(list)); };
      const up = button('collapse', 'Move up', { iconOnly: true }), del = button('backspace', 'Remove', { iconOnly: true });
      up.disabled = i === 0;
      up.onclick = () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw('add'); change(structuredClone(list)); };
      del.onclick = () => { list.splice(i, 1); draw('add'); change(structuredClone(list)); };
      return make('div', { className: 'pk-row' }, ...[].concat(row(item, update, i)), up, del);
    }), (() => { const add = button('plus', addLabel); add.dataset.listAdd = ''; add.onclick = () => { list.push(blank()); draw('add'); change(structuredClone(list)); }; return add; })());
    if (focus === 'add') box.querySelector('[data-list-add]')?.focus({ preventScroll: true });
  };
  draw();
  return box;
}
