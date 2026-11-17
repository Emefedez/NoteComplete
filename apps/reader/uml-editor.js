// The UML diagram editor: a palette of the diagram's element and connector types (uml.js),
// a canvas to place, move, resize and connect them, and a property panel built from each
// type's fields. The same editor runs on its own page (uml.html) and in a full-window dialog
// over a note (openUmlEditor), where Apply hands the diagram back to be drawn on the page.
import { imageReady } from './image-ready.js';
import { DIAGRAMS, ELEMENTS, CONNECTORS, ENUMS, LISTS, normalizeModel, starterModel, renderUml, fitBounds, textScale, itemColor, connectorPath, makeElement, makeConnector, parseLine, formatLine, umlIcon, umlName, treeLayout } from './uml.js';
import { importUml, exportXmi, exportVp, detectFormat, vpDiagrams } from './uml-xml.js';
import { parsePlantUml, toPlantUml } from './uml-plantuml.js';
import { download } from './download.js';
import { sortable } from './reorder.js';
import { orderedIds, saveOrder, keyFor, indexOfKey } from './palette-order.js';
import { editorQuickMenu } from './editor-quick.js';
import { icon } from './icons.js';
import { openContextMenu as openMenu, closeContextMenu } from './context-menu.js';
import { figureNotes } from './figure-notes.js';
import { cheatSheet } from './cheat-sheet.js';

const SVG = 'http://www.w3.org/2000/svg';
// Whether a connector's two ends differ (an arrowhead, a diamond, roles at each end).
const directed = (def) => !!def && (def.ends || def.message || def.start !== 'none' || def.end !== 'none' || !!def.keyword);
const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const iconButton = (name, title) => { const b = make('button', { type: 'button', className: 'uml-icon', title }); b.setAttribute('aria-label', title.replace(/ \(.*\)$/, '')); b.append(icon(name)); return b; };
const PANEL_KEY = 'notecomplete.uml.panel';
const NOTES_KEY = 'notecomplete.uml.notes';
// Which way diagrams are edited: drawn (visual), as PlantUML text (code) or both side by side.
export const VIEW_KEY = 'notecomplete.uml.view';
export const ASK_KEY = 'notecomplete.uml.ask';
export const VIEWS = { visual: { label: 'Visual', icon: 'uml' }, code: { label: 'Code', icon: 'code' }, split: { label: 'Both', icon: 'split' } };
const CODE_KINDS = new Set(['class', 'useCase']);
export const codeKinds = CODE_KINDS;
export function savedView() { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS[v] ? v : 'visual'; } catch { return 'visual'; } }
const fileName = (model, ext) => `${(model.name || umlName(model)).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'diagram'}.${ext}`;

// Loads uml.css once (the reader's own page does not carry it).
function ensureStyles() {
  if (document.querySelector('link[data-uml-css]')) return;
  const link = make('link', { rel: 'stylesheet', href: new URL('./uml.css', import.meta.url).href });
  link.dataset.umlCss = '';
  document.head.append(link);
}

// The model as a PNG (a Blob), drawn at `scale`.
export async function umlPng(model, scale = 2) {
  const out = renderUml(model);
  const img = new Image();
  await imageReady(img, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(out.svg)}`);
  const canvas = make('canvas', { width: Math.round(out.width * scale), height: Math.round(out.height * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Mounts the editor in `root`. `apply`/`cancel`: the buttons shown when it edits for a note.
// Returns { model(), set(model), destroy() }.
// `ignoreKey(ev)`: keys the page around the editor keeps for itself (a text document's N
// opens its Notes there); `importAccept` adds file types to Import.
export function mountUmlEditor(root, initial, { onApply = null, onCancel = null, onChange = null, applyLabel = 'Apply', markdown = null, ignoreKey = null, view: startView = null, preamble = [] } = {}) {
  ensureStyles();
  let model = normalizeModel(initial || starterModel('class'));
  let selected = null; // { kind: 'element' | 'connector', id }
  let tool = { kind: 'select' }; // or { kind: 'element' | 'connector', type }
  const undo = [], redo = [];
  let view = null; // [x, y, w, h] in diagram units
  let viewMoved = false; // zoomed or panned by hand: a resize keeps it, otherwise it fits again
  let lastSnap = { key: '', at: 0 };

  // Remembers the state before a change; edits of one field within a moment are one step.
  function snapshot(key = '') {
    const now = Date.now();
    if (key && key === lastSnap.key && now - lastSnap.at < 1200) { lastSnap.at = now; return; }
    lastSnap = { key, at: now };
    undo.push(JSON.stringify(model));
    if (undo.length > 200) undo.shift();
    redo.length = 0;
  }
  function changed({ panel = true } = {}) {
    draw();
    syncCode();
    if (panel && panelOpen) buildPanel();
    updateButtons();
    onChange?.(model);
  }

  // --- Layout -------------------------------------------------------------------------
  root.classList.add('uml-editor');
  root.replaceChildren();
  const kindSelect = make('select', { className: 'uml-kind', title: 'Diagram type' }, ...Object.entries(DIAGRAMS).map(([k, d]) => make('option', { value: k, textContent: d.label })));
  const undoBtn = iconButton('undo', 'Undo (Ctrl Z)');
  const redoBtn = iconButton('redo', 'Redo (Ctrl Y)');
  const delBtn = iconButton('backspace', 'Delete the selection (Delete or Backspace)');
  const clearAllBtn = iconButton('trash', 'Clear all: empty the diagram (one undo brings it back)');
  const zoomOut = iconButton('minus', 'Zoom out (−)');
  const zoomIn = iconButton('plus', 'Zoom in (+)');
  const fitBtn = iconButton('fit', 'Show the whole diagram');
  const importInput = make('input', { type: 'file', accept: '.xml,.xmi,.uml,.json,.puml,.plantuml,.pu,.wsd,application/xml,text/xml,application/json', hidden: true });
  const importBtn = iconButton('import', 'Open a Visual Paradigm XML, XMI, PlantUML or NoteComplete diagram file');
  const exportBtn = iconButton('export', 'Export: Visual Paradigm XML, XMI, PlantUML, a picture or a NoteComplete diagram');
  const panelBtn = iconButton('settings', 'Properties of the selection (or of the diagram)');
  const viewBtns = Object.entries(VIEWS).map(([v, d]) => { const b = iconButton(d.icon, `${d.label}: ${v === 'visual' ? 'the drawing' : v === 'code' ? 'the diagram as PlantUML text' : 'drawing and PlantUML side by side'}`); b.dataset.view = v; return b; });
  const viewGroup = make('div', { className: 'uml-views', role: 'group', ariaLabel: 'View' }, ...viewBtns);
  const notesBtn = iconButton('note', 'Notes on this diagram, in Markdown, kept with it (N)');
  const helpBtn = iconButton('help', 'Cheat sheet: what the mouse and the keys do (?)');
  helpBtn.classList.add('uml-help');
  const gap = () => make('span', { className: 'uml-gap' });
  const spacer = make('span', { className: 'uml-spacer' });
  const cancelBtn = onCancel && make('button', { type: 'button', textContent: 'Cancel' });
  const applyBtn = onApply && make('button', { type: 'button', className: 'primary', textContent: applyLabel });
  const bar = make('div', { className: 'uml-bar' }, kindSelect, gap(), undoBtn, redoBtn, delBtn, clearAllBtn, gap(), zoomOut, zoomIn, fitBtn, gap(), viewGroup, gap(), importBtn, importInput, exportBtn, notesBtn, panelBtn, helpBtn, spacer, cancelBtn, applyBtn);
  const palette = make('div', { className: 'uml-palette', role: 'toolbar', ariaLabel: 'Elements and connectors' });
  const canvas = make('div', { className: 'uml-canvas', tabIndex: 0 });
  const panel = make('div', { className: 'uml-panel' });
  const status = make('div', { className: 'uml-status', role: 'status' });
  // Menus go inside the editor's dialog over a note (the page under a modal one is inert).
  const menu = (x, y, entries, opts = {}) => openMenu(x, y, entries, { ...opts, host: root.closest('dialog') || document.body });
  // Notes beside the diagram (N): Markdown kept with it (`notes`), written or read rendered.
  const notes = figureNotes({
    get: () => model.notes || '',
    set: (text) => { snapshot('notes'); if (text.trim()) model.notes = text; else delete model.notes; updateButtons(); onChange?.(model); },
    toHtml: markdown,
    placeholder: 'Notes on this diagram: what it shows, why it is drawn this way… Markdown: # heading, **bold**, - list.',
    className: 'uml-notes',
  });
  // The PlantUML pane: the diagram as text, both ways (typing redraws it; drawing rewrites it).
  const code = make('textarea', { className: 'uml-code', spellcheck: false, ariaLabel: 'PlantUML' });
  const codeNote = make('p', { className: 'uml-code-note' });
  const codePane = make('div', { className: 'uml-code-pane' }, code, codeNote);
  const work = make('div', { className: 'uml-work' }, canvas, codePane);
  const main = make('div', { className: 'uml-main' }, palette, work, notes.pane, panel);
  root.append(bar, main, status);
  // The properties panel: closed unless asked for (names change in place, on the canvas).
  let panelOpen = false;
  try { panelOpen = localStorage.getItem(PANEL_KEY) === '1'; } catch { /* Optional. */ }
  function showPanel(on) {
    panelOpen = on;
    main.classList.toggle('with-panel', on);
    panelBtn.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(PANEL_KEY, on ? '1' : '0'); } catch { /* Optional. */ }
    if (on) buildPanel();
  }
  let notesOpen = false;
  try { notesOpen = localStorage.getItem(NOTES_KEY) === '1'; } catch { /* Optional. */ }
  function showNotes(on, focus = false) {
    notesOpen = on;
    main.classList.toggle('with-notes', on);
    notesBtn.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(NOTES_KEY, on ? '1' : '0'); } catch { /* Optional. */ }
    if (on) notes.show().then(() => { if (focus) notes.focus(); }); else notes.hide();
  }
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('uml-svg');
  canvas.append(svg);
  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  // --- Views: drawing, PlantUML or both ---------------------------------------------------
  let currentView = 'visual', codeTimer = 0, codeError = '';
  function setView(v) {
    currentView = CODE_KINDS.has(model.diagram) ? v : 'visual';
    main.dataset.view = currentView;
    for (const b of viewBtns) { b.setAttribute('aria-pressed', String(b.dataset.view === currentView)); b.disabled = b.dataset.view !== 'visual' && !CODE_KINDS.has(model.diagram); }
    syncCode(true);
    if (currentView !== 'code') requestAnimationFrame(() => { if (!viewMoved) fit(); else applyView(); });
  }
  for (const b of viewBtns) b.onclick = () => { setView(b.dataset.view); try { localStorage.setItem(VIEW_KEY, b.dataset.view); } catch { /* Optional. */ } };
  // The text follows the drawing, except while it is being typed in.
  function syncCode(force = false) {
    if (currentView === 'visual' || (!force && document.activeElement === code)) return;
    try { code.value = toPlantUml(model, { preamble, layout: false }); codeNote.textContent = ''; codeNote.classList.remove('error'); }
    catch (e) { code.value = ''; codeNote.textContent = e.message; codeNote.classList.add('error'); }
  }
  // Typed PlantUML redraws the diagram after a pause; boxes that were there keep their place.
  code.addEventListener('input', () => {
    clearTimeout(codeTimer);
    codeTimer = setTimeout(() => {
      let next;
      try { next = parsePlantUml(code.value).model; } catch (e) { codeError = e.message; codeNote.textContent = e.message; codeNote.classList.add('error'); return; }
      codeError = ''; codeNote.textContent = ''; codeNote.classList.remove('error');
      const old = new Map(model.elements.map((e) => [e.id, e]));
      for (const e of next.elements) { const was = old.get(e.id); if (was) { e.bounds = [...was.bounds]; e.props = { ...was.props, ...e.props, color: was.props?.color, textScale: was.props?.textScale }; } }
      const ways = new Map(model.connectors.map((c) => [`${c.type}:${c.from}>${c.to}`, c]));
      for (const c of next.connectors) { const was = ways.get(`${c.type}:${c.from}>${c.to}`); if (was) { c.waypoints = was.waypoints; if (was.props?.labelOffset) c.props.labelOffset = was.props.labelOffset; } }
      snapshot('code');
      model = normalizeModel({ ...next, name: model.name || next.name, title: next.title, notes: model.notes, badge: model.badge });
      if (selected && ![...model.elements, ...model.connectors].some((q) => q.id === selected.id)) selected = null;
      draw();
      if (panelOpen) buildPanel();
      updateButtons();
      onChange?.(model);
    }, 450);
  });
  code.addEventListener('keydown', (ev) => { if (ev.key === 'Tab' && !ev.shiftKey) { ev.preventDefault(); code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); } });

  // --- Palette ------------------------------------------------------------------------
  // Elements and connectors in the order the person left them (palette-order.js), 1–9 and 0
  // for the first ten; Select stays first (Escape).
  const orderName = () => `uml-${model.diagram}`;
  function paletteTools() {
    const d = DIAGRAMS[model.diagram];
    const all = [...d.elements.map((t) => ({ kind: 'element', type: t, label: ELEMENTS[t].label })), ...d.connectors.map((t) => ({ kind: 'connector', type: t, label: CONNECTORS[t].label }))];
    return orderedIds(orderName(), all.map((t) => `${t.kind}:${t.type}`)).map((id) => all.find((t) => `${t.kind}:${t.type}` === id));
  }
  function chooseTool(kind, type) { setTool(tool.kind === kind && tool.type === type ? { kind: 'select' } : { kind, type }); }
  function buildPalette() {
    kindSelect.value = model.diagram;
    const button = ({ kind, type, label }, i) => {
      const key = keyFor(i);
      const b = make('button', { type: 'button', className: 'uml-tool', title: `${kind === 'element' ? `${label}: tap the canvas to place it` : `${label}: drag from one element to another`}${key ? ` (${key})` : ''}. Drag it up or down to reorder` }, umlIcon(kind, type), make('span', { textContent: label }), key && make('kbd', { textContent: key }));
      b.dataset.kind = kind; b.dataset.type = type;
      b.onclick = () => chooseTool(kind, type);
      b.ondblclick = () => { if (kind === 'element') place(type, center()); };
      return b;
    };
    const sel = make('button', { type: 'button', className: 'uml-tool', title: 'Select, move and resize (Escape)' }, umlIcon('connector', 'none'), make('span', { textContent: 'Select' }), make('kbd', { textContent: 'Esc' }));
    sel.dataset.kind = 'select';
    sel.querySelector('path').setAttribute('d', 'm6 4 12 7-6 1.5-3 6Z');
    sel.onclick = () => setTool({ kind: 'select' });
    const list = make('div', { className: 'uml-tools' }, ...paletteTools().map(button));
    sortable(list, { items: '.uml-tool', key: (el) => `${el.dataset.kind}:${el.dataset.type}`, axis: 'auto', onReorder: (ids) => { saveOrder(orderName(), ids); buildPalette(); } });
    palette.replaceChildren(sel, make('h4', { textContent: 'Elements and connectors' }), list,
      make('p', { className: 'uml-hint', textContent: 'Keys 1–9 pick one, Shift S opens them at the pointer. Drag one to reorder them.' }));
    markTool();
  }
  // Shift S: the tools in a ring at the pointer (editor-quick.js).
  const ring = editorQuickMenu(root, {
    entries: () => paletteTools().map((t) => ({ key: `${t.kind}:${t.type}`, label: t.label, icon: umlIcon(t.kind, t.type), active: () => tool.kind === t.kind && tool.type === t.type, run: () => setTool({ kind: t.kind, type: t.type }) })),
    onReorder: (ids) => { saveOrder(orderName(), ids); buildPalette(); },
  });
  function setTool(t) {
    tool = t;
    markTool();
    canvas.dataset.tool = t.kind;
    say(t.kind === 'element' ? `Tap the canvas to place a ${ELEMENTS[t.type].label.toLowerCase()} (double-tap its button to place it in the middle).` : t.kind === 'connector' ? `Drag from one element to another to connect them with a ${CONNECTORS[t.type].label.toLowerCase()}.` : '');
  }
  function markTool() {
    for (const b of palette.querySelectorAll('.uml-tool')) b.setAttribute('aria-pressed', String(b.dataset.kind === tool.kind && (tool.kind === 'select' || b.dataset.type === tool.type)));
  }

  // --- Drawing ------------------------------------------------------------------------
  function contentBox() {
    const out = renderUml(model, { badge: false, margin: 40 });
    return out.box;
  }
  function fit() {
    const [x, y, w, h] = contentBox();
    const r = canvas.getBoundingClientRect();
    viewMoved = false;
    const aspect = (r.height || 400) / (r.width || 600);
    const W = Math.min(Math.max(w, h / aspect, 300), 8000), H = W * aspect;
    view = [x + w / 2 - W / 2, y + h / 2 - H / 2, W, H];
    applyView();
  }
  function applyView() {
    if (!view) return;
    const r = canvas.getBoundingClientRect();
    view[3] = view[2] * ((r.height || 400) / (r.width || 600));
    svg.setAttribute('viewBox', view.map((v) => Math.round(v * 10) / 10).join(' '));
  }
  function zoom(f, at = null) {
    if (!view) fit();
    viewMoved = true;
    const [x, y, w, h] = view, cx = at ? at[0] : x + w / 2, cy = at ? at[1] : y + h / 2;
    const W = Math.min(8000, Math.max(120, w * f)), k = W / w;
    view = [cx - (cx - x) * k, cy - (cy - y) * k, W, h * k];
    applyView();
  }
  const center = () => (view ? [view[0] + view[2] / 2, view[1] + view[3] / 2] : [200, 150]);
  // The arrow handle beside an element: drag it to another element to connect them, or to empty
  // canvas to add a new element there, connected (how trees and automata grow).
  function connectHandle(e, k) {
    const [x, y, w, h] = fitBounds(e);
    const g = document.createElementNS(SVG, 'g');
    g.setAttribute('class', 'uml-connect');
    g.dataset.handle = 'connect';
    g.dataset.for = e.id;
    const cx = x + w + 16 * k, cy = y + h / 2, r = 9 * k;
    const dot = document.createElementNS(SVG, 'circle');
    Object.entries({ cx, cy, r }).forEach(([a, v]) => dot.setAttribute(a, v));
    const arrow = document.createElementNS(SVG, 'path');
    arrow.setAttribute('d', `M${cx - 4 * k} ${cy}H${cx + 4 * k}M${cx + 1 * k} ${cy - 3 * k}L${cx + 4 * k} ${cy}L${cx + 1 * k} ${cy + 3 * k}`);
    const title = document.createElementNS(SVG, 'title');
    title.textContent = 'Drag to another element to connect (Shift when letting go: choose the kind), or to empty space to add a connected one';
    g.append(dot, arrow, title);
    return g;
  }
  let hoverId = null;
  function draw() {
    const ids = selected ? [selected.id] : [];
    const out = renderUml(model, { ids: true, selected: ids, badge: false, margin: 40 });
    const holder = document.createElement('div');
    holder.innerHTML = out.svg;
    const drawn = holder.firstElementChild;
    drawn.querySelector(':scope > rect')?.remove(); // the white page: the canvas has its own
    svg.replaceChildren(...drawn.childNodes);
    // Handles of the selection: a corner to resize an element, points to bend a connector.
    const kk = view ? view[2] / Math.max(1, canvas.getBoundingClientRect().width) : 1;
    // Pointing at an element (Visual Paradigm's hover): its arrow handle, to connect it at once.
    const hovered = hoverId && hoverId !== selected?.id && model.elements.find((q) => q.id === hoverId);
    if (hovered && !ELEMENTS[hovered.type]?.container) svg.append(connectHandle(hovered, kk));
    if (selected?.kind === 'element') {
      const e = model.elements.find((q) => q.id === selected.id);
      if (e) {
        const [x, y, w, h] = fitBounds(e);
        const k = view ? view[2] / Math.max(1, canvas.getBoundingClientRect().width) : 1;
        const s = 10 * k;
        const handle = document.createElementNS(SVG, 'rect');
        // A narrow bar (an activation, a fork) grows along its length: handles at both ends.
        const tall = ELEMENTS[e.type]?.shape === 'activation';
        Object.entries(tall
          ? { x: x + w / 2 - s / 2, y: y + h - s / 2, width: s, height: s, class: 'uml-handle', 'data-handle': 'resize' }
          : { x: x + w - s / 2, y: y + h - s / 2, width: s, height: s, class: 'uml-handle', 'data-handle': 'resize' }).forEach(([a, v]) => handle.setAttribute(a, v));
        const top = tall && document.createElementNS(SVG, 'rect');
        if (top) Object.entries({ x: x + w / 2 - s / 2, y: y - s / 2, width: s, height: s, class: 'uml-handle', 'data-handle': 'resizeTop' }).forEach(([a, v]) => top.setAttribute(a, v));
        svg.append(handle, ...(top ? [top] : []), connectHandle(e, k));
      }
    } else if (selected?.kind === 'connector') {
      const c = model.connectors.find((q) => q.id === selected.id);
      const k = view ? view[2] / Math.max(1, canvas.getBoundingClientRect().width) : 1;
      const pts = c && !CONNECTORS[c.type]?.message ? connectorPath(model, c) : null;
      const dot = (cx, cy, r, cls, h, tip) => {
        const d = document.createElementNS(SVG, 'circle');
        Object.entries({ cx, cy, r, class: cls, 'data-handle': h }).forEach(([a, v]) => d.setAttribute(a, v));
        if (tip) { const title = document.createElementNS(SVG, 'title'); title.textContent = tip; d.append(title); }
        svg.append(d);
      };
      if (pts) {
        // A hollow point in the middle of each stretch: drag it to bend the line there.
        for (let i = 1; i < pts.length; i++) dot((pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2, 4.5 * k, 'uml-handle uml-mid', `mid:${i - 1}`, 'Drag to bend the line here');
        // Its two ends: drag one onto another element to connect it there instead.
        dot(pts[0][0], pts[0][1], 5.5 * k, 'uml-handle uml-end', 'end:from', 'Drag onto another element to reconnect this end');
        if (!CONNECTORS[c.type]?.toConnector) dot(pts.at(-1)[0], pts.at(-1)[1], 5.5 * k, 'uml-handle uml-end', 'end:to', 'Drag onto another element to reconnect this end');
      }
      (c?.waypoints || []).forEach((p, i) => dot(p[0], p[1], 6 * k, 'uml-handle', `way:${i}`, 'Drag to move the bend; double-click to remove it'));
    }
    if (!view) fit();
  }

  // --- Geometry and picking -----------------------------------------------------------
  function toModel(e) {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  // The topmost element at a model point (containers last, so what they hold wins).
  function elementAt(pt, except = null) {
    const hits = model.elements.filter((e) => e.id !== except).filter((e) => { const [x, y, w, h] = fitBounds(e); return pt[0] >= x && pt[0] <= x + w && pt[1] >= y && pt[1] <= y + h; });
    hits.sort((a, b) => (ELEMENTS[a.type]?.container ? 1 : 0) - (ELEMENTS[b.type]?.container ? 1 : 0) || area(a) - area(b));
    return hits[0] || null;
  }
  const area = (e) => { const b = fitBounds(e); return b[2] * b[3]; };
  const descendants = (id) => { const out = []; const walk = (p) => { for (const e of model.elements) if (e.parent === p && !out.includes(e)) { out.push(e); walk(e.id); } }; walk(id); return out; };
  // The container an element sits in after a move (the smallest that holds its middle).
  function containerFor(e) {
    const [x, y, w, h] = fitBounds(e), mid = [x + w / 2, y + h / 2];
    const inside = new Set(descendants(e.id).map((q) => q.id));
    const holders = model.elements.filter((q) => q.id !== e.id && !inside.has(q.id) && ELEMENTS[q.type]?.container).filter((q) => { const b = fitBounds(q); return mid[0] > b[0] && mid[0] < b[0] + b[2] && mid[1] > b[1] && mid[1] < b[1] + b[3]; });
    holders.sort((a, b) => area(a) - area(b));
    return holders[0]?.id || null;
  }

  // --- Changes ------------------------------------------------------------------------
  function place(type, at) {
    snapshot();
    const def = ELEMENTS[type];
    const e = makeElement(type, [Math.round(at[0] - def.size[0] / 2), Math.round(at[1] - def.size[1] / 2)], {}, model);
    if (model.diagram === 'sequence' && def.shape.toLowerCase().includes('lifeline')) e.bounds[1] = Math.min(...model.elements.filter((q) => ELEMENTS[q.type]?.shape?.toLowerCase().includes('lifeline')).map((q) => q.bounds[1]), e.bounds[1]);
    model.elements.push(e);
    e.parent = containerFor(e);
    selected = { kind: 'element', id: e.id };
    setTool({ kind: 'select' });
    changed();
    rename(e);
  }
  // The connector a drag from an element's arrow handle makes: the last one used in this
  // diagram, or the kind it already has, or the diagram's first (a note link from a note).
  let lastConnector = null;
  function connectorFor(from) {
    const list = DIAGRAMS[model.diagram].connectors;
    if (from?.type === 'note') return 'anchor';
    if (lastConnector && list.includes(lastConnector) && lastConnector !== 'anchor' && !CONNECTORS[lastConnector].toConnector) return lastConnector;
    // Otherwise what it is already connected with (a tree goes on with lines), or the first.
    const own = [...model.connectors].reverse().find((c) => (c.from === from?.id || c.to === from?.id) && c.type !== 'anchor' && list.includes(c.type));
    return own?.type || list.find((t) => t !== 'anchor' && !CONNECTORS[t].toConnector) || list[0];
  }
  function grow(from, type, at, start) {
    const kind = ELEMENTS[from.type]?.container || from.type === 'note' ? DIAGRAMS[model.diagram].elements[0] : from.type;
    snapshot();
    const def = ELEMENTS[kind];
    const e = makeElement(kind, [Math.round(at[0] - def.size[0] / 2), Math.round(at[1] - def.size[1] / 2)], { name: def.noName || def.optionalName ? '' : model.diagram === 'graph' ? '' : def.label }, model);
    if (def.shape.toLowerCase().includes('lifeline')) e.bounds[1] = from.bounds[1];
    model.elements.push(e);
    e.parent = containerFor(e);
    const extra = CONNECTORS[type]?.message ? { props: { y: Math.round(start[1]) } } : {};
    const [a, b] = ends(type, from, e);
    model.connectors.push(makeConnector(type, a.id, b.id, extra, model));
    lastConnector = type;
    selected = { kind: 'element', id: e.id };
    changed();
    if (!def.noName && !def.optionalName) rename(e);
  }
  // Which way a new connector points, dragged from `a` to `b`: toward `b`, except one drawn
  // back toward where the drag started («extend»: from the extension to the base use case).
  const ends = (type, a, b) => (CONNECTORS[type]?.drawnBack ? [b, a] : [a, b]);
  // `exact`: from `from` to `to` as given (the Shift picker chose the direction).
  function connect(type, from, to, at = null, exact = false) {
    lastConnector = type;
    snapshot();
    const extra = {};
    if (CONNECTORS[type].message) extra.props = { y: Math.round(at?.[1] ?? 120) };
    if (!exact) [from, to] = ends(type, from, to);
    const c = makeConnector(type, from.id, to.id, extra, model);
    model.connectors.push(c);
    selected = { kind: 'connector', id: c.id };
    setTool({ kind: 'select' });
    changed();
  }
  function removeSelected() {
    if (!selected) return;
    snapshot();
    if (selected.kind === 'element') {
      const gone = new Set([selected.id]);
      // What a container holds stays, out of it.
      for (const e of model.elements) if (e.parent === selected.id) e.parent = model.elements.find((q) => q.id === selected.id)?.parent || null;
      model.elements = model.elements.filter((e) => !gone.has(e.id));
      model.connectors = model.connectors.filter((c) => !gone.has(c.from) && !gone.has(c.to));
    } else model.connectors = model.connectors.filter((c) => c.id !== selected.id);
    // An association class's link goes with its association.
    const lines = new Set(model.connectors.map((c) => c.id));
    model.connectors = model.connectors.filter((c) => !CONNECTORS[c.type]?.toConnector || lines.has(c.to));
    selected = null;
    changed();
  }
  function setModel(next, { keepView = false } = {}) {
    model = normalizeModel(next);
    if (!CODE_KINDS.has(model.diagram) && currentView !== 'visual') setView('visual');
    selected = null;
    if (!keepView) view = null;
    buildPalette();
    changed();
    notes.sync();
    if (!keepView) requestAnimationFrame(fit);
  }
  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(model));
    model = JSON.parse(from.pop());
    if (selected && ![...model.elements, ...model.connectors].some((q) => q.id === selected.id)) selected = null;
    lastSnap = { key: '', at: 0 };
    buildPalette();
    changed();
    notes.sync();
  }
  function updateButtons() {
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
    delBtn.disabled = !selected;
    clearAllBtn.disabled = !model.elements.length && !model.connectors.length;
  }

  // --- Pointer ------------------------------------------------------------------------
  let drag = null;
  svg.addEventListener('pointerdown', (ev) => {
    // The middle button pans from anywhere, over elements too, as on the note's pages.
    if (ev.button === 1) {
      ev.preventDefault();
      svg.setPointerCapture(ev.pointerId);
      drag = { mode: 'pan', start: [ev.clientX, ev.clientY], view: [...view] };
      return;
    }
    if (ev.button > 0) return;
    canvas.focus({ preventScroll: true });
    // Connecting from the menu: this click ends it.
    if (pending) { drag = pending; pending = null; return finish(ev); }
    const pt = toModel(ev);
    const handle = ev.target.closest?.('[data-handle]')?.dataset.handle;
    const hit = ev.target.closest?.('[data-uml-id]');
    const id = hit?.dataset.umlId, kind = hit?.dataset.umlKind;
    svg.setPointerCapture(ev.pointerId);
    if (tool.kind === 'element') { place(tool.type, pt); return; }
    if (tool.kind === 'connector') {
      const from = elementAt(pt);
      if (from && CONNECTORS[tool.type]?.toConnector && ELEMENTS[from.type]?.shape !== 'compartments') return say('An association class starts on a class: drag from the class to its association.');
      if (!from) return say('Start on an element, and let go on another.');
      drag = { mode: 'connect', type: tool.type, from, start: pt, line: null };
      return;
    }
    if (handle === 'connect') {
      const from = model.elements.find((q) => q.id === (ev.target.closest('[data-for]')?.dataset.for || selected?.id));
      if (!from) return;
      drag = { mode: 'connect', type: connectorFor(from), from, start: pt, line: null, grow: true };
      return;
    }
    if (handle === 'resize' || handle === 'resizeTop') {
      const e = model.elements.find((q) => q.id === selected.id);
      drag = { mode: 'resize', e, start: pt, bounds: [...e.bounds], snapped: false, top: handle === 'resizeTop', tall: ELEMENTS[e.type]?.shape === 'activation' };
      return;
    }
    if (handle?.startsWith('way:')) {
      const c = model.connectors.find((q) => q.id === selected.id);
      drag = { mode: 'way', c, index: Number(handle.slice(4)), start: pt, snapped: false };
      return;
    }
    if (handle?.startsWith('mid:')) {
      const c = model.connectors.find((q) => q.id === selected.id);
      drag = { mode: 'bend', c, index: Number(handle.slice(4)), start: pt, snapped: false };
      return;
    }
    if (handle?.startsWith('end:')) {
      const c = model.connectors.find((q) => q.id === selected.id);
      drag = { mode: 'reconnect', c, side: handle.slice(4), start: pt, line: null };
      return;
    }
    if (kind === 'element' || (!id && elementAt(pt))) {
      const e = model.elements.find((q) => q.id === id) || elementAt(pt);
      selected = { kind: 'element', id: e.id };
      const moving = [e, ...descendants(e.id)];
      drag = { mode: 'move', e, moving, start: pt, from: moving.map((q) => [...q.bounds]), snapped: false, ways: model.connectors.filter((c) => moving.some((q) => q.id === c.from) && moving.some((q) => q.id === c.to)).map((c) => [c, clone(c.waypoints)]) };
      changed();
      return;
    }
    // A connector's label: dragged anywhere around its line (double-click to edit it).
    if (kind === 'label') {
      selected = { kind: 'connector', id };
      const c = model.connectors.find((q) => q.id === id);
      drag = { mode: 'label', c, start: pt, offset: [...(c.props.labelOffset || [0, 0])], snapped: false };
      changed();
      return;
    }
    if (kind === 'connector') {
      selected = { kind: 'connector', id };
      const c = model.connectors.find((q) => q.id === id);
      // Dragging the line itself bends it where it was taken (a message moves up or down).
      drag = CONNECTORS[c.type]?.message ? { mode: 'message', c, start: pt, y: c.props.y, snapped: false } : { mode: 'bend', c, index: segmentAt(c, pt), start: pt, snapped: false };
      changed();
      return;
    }
    // Empty canvas: deselect and pan.
    if (selected) { selected = null; changed(); }
    drag = { mode: 'pan', start: [ev.clientX, ev.clientY], view: [...view] };
  });
  function rubber(d, pt) {
    if (!d.line) { d.line = document.createElementNS(SVG, 'line'); d.line.setAttribute('class', 'uml-rubber'); }
    const b = fitBounds(d.from);
    Object.entries({ x1: b[0] + b[2] / 2, y1: CONNECTORS[d.type]?.message ? d.start[1] : b[1] + b[3] / 2, x2: pt[0], y2: pt[1] }).forEach(([a, v]) => d.line.setAttribute(a, v));
    svg.append(d.line);
  }
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) {
      if (pending) return rubber(pending, toModel(ev));
      if (ev.pointerType === 'touch' || tool.kind !== 'select') return;
      // The element under the pointer (or near it, on the way to its arrow handle).
      const pt = toModel(ev), k = view ? view[2] / Math.max(1, canvas.getBoundingClientRect().width) : 1;
      const onHandle = ev.target.closest?.('[data-for]')?.dataset.for;
      const near = onHandle || elementAt(pt)?.id || (hoverId && (() => { const e = model.elements.find((q) => q.id === hoverId); if (!e) return null; const [x, y, w, h] = fitBounds(e); return pt[0] > x - 10 * k && pt[0] < x + w + 34 * k && pt[1] > y - 10 * k && pt[1] < y + h + 10 * k ? hoverId : null; })());
      if ((near || null) !== hoverId) { hoverId = near || null; draw(); }
      return;
    }
    const pt = toModel(ev);
    const dx = pt[0] - (drag.start?.[0] ?? 0), dy = pt[1] - (drag.start?.[1] ?? 0);
    const once = () => { if (!drag.snapped) { snapshot(); drag.snapped = true; } };
    if (drag.mode === 'pan') {
      viewMoved = true;
      const r = canvas.getBoundingClientRect(), k = view[2] / r.width;
      view = [drag.view[0] - (ev.clientX - drag.start[0]) * k, drag.view[1] - (ev.clientY - drag.start[1]) * k, drag.view[2], drag.view[3]];
      applyView();
    } else if (drag.mode === 'move') {
      if (!drag.snapped && Math.hypot(dx, dy) < 2) return;
      once();
      const g = (v) => Math.round(v / 5) * 5;
      drag.moving.forEach((q, i) => { q.bounds[0] = g(drag.from[i][0] + dx); q.bounds[1] = g(drag.from[i][1] + dy); });
      for (const [c, w] of drag.ways) c.waypoints = w.map((p) => [Math.round(p[0] + dx), Math.round(p[1] + dy)]);
      draw();
    } else if (drag.mode === 'resize') {
      once();
      if (drag.top) {
        // The top end: the bar's bottom stays where it is.
        const h = Math.max(10, Math.round(drag.bounds[3] - dy));
        drag.e.bounds[1] = drag.bounds[1] + drag.bounds[3] - h;
        drag.e.bounds[3] = h;
      } else {
        if (!drag.tall) drag.e.bounds[2] = Math.max(16, Math.round(drag.bounds[2] + dx));
        drag.e.bounds[3] = Math.max(drag.tall ? 10 : 6, Math.round(drag.bounds[3] + dy));
      }
      draw();
    } else if (drag.mode === 'way') {
      once();
      drag.c.waypoints[drag.index] = snapBend(drag.c, drag.index, pt);
      draw();
    } else if (drag.mode === 'bend') {
      if (!drag.snapped && Math.hypot(dx, dy) < 3) return;
      once();
      // A new bend where the line was taken; from now on it moves like any other.
      drag.c.waypoints.splice(drag.index, 0, [Math.round(pt[0]), Math.round(pt[1])]);
      Object.assign(drag, { mode: 'way' });
      drag.c.waypoints[drag.index] = snapBend(drag.c, drag.index, pt);
      draw();
    } else if (drag.mode === 'reconnect') {
      const pts = connectorPath(model, drag.c) || [];
      const fixed = drag.side === 'from' ? pts.at(-1) : pts[0];
      if (!fixed) return;
      if (!drag.line) { drag.line = document.createElementNS(SVG, 'line'); drag.line.setAttribute('class', 'uml-rubber'); }
      Object.entries({ x1: fixed[0], y1: fixed[1], x2: pt[0], y2: pt[1] }).forEach(([a, v]) => drag.line.setAttribute(a, v));
      svg.append(drag.line);
    } else if (drag.mode === 'message') {
      if (!drag.snapped && Math.abs(dy) < 2) return;
      once();
      drag.c.props.y = Math.round(drag.y + dy);
      draw();
    } else if (drag.mode === 'label') {
      if (!drag.snapped && Math.hypot(dx, dy) < 2) return;
      once();
      drag.c.props.labelOffset = [Math.round(drag.offset[0] + dx), Math.round(drag.offset[1] + dy)];
      draw();
    } else if (drag.mode === 'connect') rubber(drag, pt);
  });
  // Which stretch of a connector's line is nearest `pt` (where a new bend goes in the waypoints).
  function segmentAt(c, pt) {
    const pts = connectorPath(model, c) || [];
    let best = 0, bestD = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const t = Math.max(0, Math.min(1, ((pt[0] - ax) * (bx - ax) + (pt[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
      const dd = Math.hypot(ax + t * (bx - ax) - pt[0], ay + t * (by - ay) - pt[1]);
      if (dd < bestD) { bestD = dd; best = i - 1; }
    }
    return Math.min(best, c.waypoints.length);
  }
  // A bend lines up with its neighbours when it is nearly level or upright with them.
  function snapBend(c, i, pt) {
    const pts = connectorPath(model, c) || [];
    // Next to an end, the element's middle (the end itself moves as the bend does).
    const middle = (id) => { const e = model.elements.find((q) => q.id === id); if (!e) return null; const [x, y, w, h] = fitBounds(e); return [x + w / 2, y + h / 2]; };
    const prev = i === 0 ? middle(c.from) || pts[0] : pts[i];
    const next = i === c.waypoints.length - 1 ? (CONNECTORS[c.type]?.toConnector ? pts.at(-1) : middle(c.to) || pts.at(-1)) : pts[i + 2];
    const k = view ? view[2] / Math.max(1, canvas.getBoundingClientRect().width) : 1, near = 7 * k;
    let [x, y] = pt;
    for (const q of [prev, next]) {
      if (!q) continue;
      if (Math.abs(x - q[0]) < near) x = q[0];
      if (Math.abs(y - q[1]) < near) y = q[1];
    }
    return [Math.round(x), Math.round(y)];
  }
  // The connector line under the pointer (not an association class's own link).
  function connectorUnder(ev, except = null) {
    const hit = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => n.closest?.('[data-uml-kind="connector"],[data-uml-kind="label"]')).find(Boolean);
    const c = hit && model.connectors.find((q) => q.id === hit.dataset.umlId);
    return c && c.id !== except && !CONNECTORS[c.type]?.toConnector ? c : null;
  }
  const finish = (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'reconnect') {
      d.line?.remove();
      const pt = toModel(ev), c = d.c;
      const target = d.side === 'to' && CONNECTORS[c.type]?.toConnector ? connectorUnder(ev, c.id) : elementAt(pt);
      if (!target || target.id === (d.side === 'from' ? c.from : c.to)) return draw();
      if (d.side === 'from' && CONNECTORS[c.type]?.toConnector && !target.bounds) return draw();
      snapshot();
      c[d.side] = target.id;
      c.waypoints = [];
      return changed();
    }
    if (d.mode === 'connect' && CONNECTORS[d.type]?.toConnector) {
      d.line?.remove();
      const line = connectorUnder(ev);
      if (!line) return say('Let go on the association this class belongs to.');
      lastConnector = d.type;
      snapshot();
      const c = makeConnector(d.type, d.from.id, line.id, {}, model);
      model.connectors.push(c);
      selected = { kind: 'connector', id: c.id };
      setTool({ kind: 'select' });
      return changed();
    }
    if (d.mode === 'connect') {
      d.line?.remove();
      const pt = toModel(ev);
      const to = elementAt(pt, d.grow ? d.from.id : null) || (!d.grow ? elementAt(pt) : null);
      if (to && ev.shiftKey && to !== d.from) return pickLink(d, to, ev);
      if (to) return connect(d.type, d.from, to, d.start);
      if (!d.grow) return say('Let go on an element to connect to it.');
      // Let go on empty space: a new element like the one it started from, connected to it.
      if (Math.hypot(pt[0] - d.start[0], pt[1] - d.start[1]) < 12) return;
      grow(d.from, d.type, pt, d.start);
      return;
    }
    if (d.mode === 'move' && d.snapped) {
      const parent = containerFor(d.e);
      d.e.parent = parent;
    }
    if (d.snapped) changed();
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointerleave', () => { if (hoverId && !drag) { hoverId = null; draw(); } });
  // No autoscroll circle or paste from the middle button over the canvas.
  for (const type of ['mousedown', 'auxclick']) svg.addEventListener(type, (ev) => { if (ev.button === 1) ev.preventDefault(); });
  svg.addEventListener('pointercancel', () => { drag?.line?.remove(); drag = null; draw(); });
  // Double-clicks are told apart here, from the presses themselves: the first press redraws
  // the canvas, and the browser's own dblclick does not come after that.
  let lastPress = null;
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0 || ev.pointerType === 'touch' && touches.size > 1) return;
    const now = performance.now();
    const twice = lastPress && now - lastPress.t < 450 && Math.hypot(ev.clientX - lastPress.x, ev.clientY - lastPress.y) < 8;
    lastPress = twice ? null : { t: now, x: ev.clientX, y: ev.clientY, target: ev.target };
    if (twice) { const target = ev.target.isConnected ? ev.target : document.elementFromPoint(ev.clientX, ev.clientY); requestAnimationFrame(() => { drag?.line?.remove(); drag = null; double({ clientX: ev.clientX, clientY: ev.clientY, target: target?.isConnected ? target : document.elementFromPoint(ev.clientX, ev.clientY) || svg }); }); }
  }, true);
  function double(ev) {
    const pt = toModel(ev);
    const handle = ev.target.closest?.('[data-handle]')?.dataset.handle;
    if (handle?.startsWith('way:') && selected?.kind === 'connector') {
      snapshot();
      model.connectors.find((q) => q.id === selected.id).waypoints.splice(Number(handle.slice(4)), 1);
      return changed();
    }
    const hit = ev.target.closest?.('[data-uml-id]');
    if (hit?.dataset.umlKind === 'label') {
      const c = model.connectors.find((q) => q.id === hit.dataset.umlId);
      if (c) { selected = { kind: 'connector', id: c.id }; changed(); return rename(c); }
    }
    if (hit?.dataset.umlKind === 'connector') {
      const c = model.connectors.find((q) => q.id === hit.dataset.umlId);
      // On its words, or a message: rename it. Elsewhere on the line: a bend there.
      if (c && (ev.target.closest('text') || CONNECTORS[c.type]?.message)) { selected = { kind: 'connector', id: c.id }; changed(); return rename(c); }
      if (!c) return;
      // A bend where it was double-clicked, between the two points it falls between.
      snapshot();
      const pts = connectorPath(model, c) || [];
      let best = 0, bestD = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const t = Math.max(0, Math.min(1, ((pt[0] - ax) * (bx - ax) + (pt[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
        const dd = Math.hypot(ax + t * (bx - ax) - pt[0], ay + t * (by - ay) - pt[1]);
        if (dd < bestD) { bestD = dd; best = i - 1; }
      }
      c.waypoints.splice(best, 0, [Math.round(pt[0]), Math.round(pt[1])]);
      selected = { kind: 'connector', id: c.id };
      return changed();
    }
    // (A click redraws the canvas, so the second one may land on the canvas itself.)
    const onEl = hit?.dataset.umlKind === 'element' ? model.elements.find((q) => q.id === hit.dataset.umlId) : !hit ? elementAt(pt) : null;
    if (onEl) { if (!ELEMENTS[onEl.type]?.noName) { selected = { kind: 'element', id: onEl.id }; changed(); rename(onEl); } return; }
    // On empty canvas: a new element of the diagram's first kind (a node in a node graph).
    if (!hit && !elementAt(pt)) place(DIAGRAMS[model.diagram].elements[0], pt);
  }
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (!view) fit();
    if (ev.ctrlKey || ev.metaKey) return zoom(Math.exp(ev.deltaY * 0.01), toModel(ev));
    viewMoved = true;
    const r = canvas.getBoundingClientRect(), k = view[2] / r.width;
    view[0] += (ev.shiftKey ? ev.deltaY : ev.deltaX) * k;
    view[1] += (ev.shiftKey ? 0 : ev.deltaY) * k;
    applyView();
  }, { passive: false });
  // Two fingers: zoom and pan the canvas.
  const touches = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch') return;
    touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (touches.size === 2) { drag?.line?.remove(); drag = null; const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), view: [...view], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; }
  }, true);
  canvas.addEventListener('pointermove', (ev) => {
    if (!touches.has(ev.pointerId)) return;
    touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (!pinch || touches.size !== 2) return;
    const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = canvas.getBoundingClientRect();
    const f = pinch.d / Math.max(10, d), W = Math.min(8000, Math.max(120, pinch.view[2] * f)), k0 = pinch.view[2] / r.width, k = W / r.width;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ax = pinch.view[0] + (pinch.mid[0] - r.left) * k0, ay = pinch.view[1] + (pinch.mid[1] - r.top) * k0;
    view = [ax - (mid[0] - r.left) * k, ay - (mid[1] - r.top) * k, W, W];
    viewMoved = true;
    applyView();
  }, true);
  const lift = (ev) => { touches.delete(ev.pointerId); if (touches.size < 2) pinch = null; };
  canvas.addEventListener('pointerup', lift, true);
  canvas.addEventListener('pointercancel', lift, true);

  // --- Keys ---------------------------------------------------------------------------
  // Keys pressed with nothing focused (focus left on the page after a menu or a button)
  // still reach the editor.
  const stray = (ev) => { if (root.isConnected && !root.contains(ev.target) && !document.querySelector('.context-menu') && (ev.target === document.body || ev.target === document.documentElement)) keys(ev); };
  document.addEventListener('keydown', stray);
  root.addEventListener('keydown', keys);
  function keys(ev) {
    if (ignoreKey?.(ev)) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || !!ev.target.isContentEditable;
    const mod = ev.ctrlKey || ev.metaKey;
    // Arrow keys move the selected element (Shift: ten times as far), as in drawing programs.
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (step && !typing && !mod && !ev.altKey && selected?.kind === 'element') { ev.preventDefault(); return nudge(step[0] * (ev.shiftKey ? 10 : 1), step[1] * (ev.shiftKey ? 10 : 1)); }
    // The menu key or Shift F10: the selection's menu (what right-click opens).
    if (!typing && (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey))) { ev.preventDefault(); return menuForSelection(); }
    if (mod && !ev.altKey && ['+', '=', '-', '_', '0'].includes(ev.key) && !typing) { ev.preventDefault(); ev.stopPropagation(); return ev.key === '0' ? fit() : zoom(ev.key === '-' || ev.key === '_' ? 1.25 : 1 / 1.25); }
    if (ev.key === 'Enter' && !typing && !mod && selected && !(selected.kind === 'element' && ELEMENTS[current()?.type]?.noName)) { ev.preventDefault(); return rename(current()); }
    if (mod && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); stepHistory(ev.shiftKey ? redo : undo, ev.shiftKey ? undo : redo); }
    else if (mod && ev.key.toLowerCase() === 'y' && !typing) { ev.preventDefault(); stepHistory(redo, undo); }
    else if ((ev.key === 'Delete' || ev.key === 'Backspace') && !typing && selected) { ev.preventDefault(); removeSelected(); }
    else if (ev.key === 'F2' && !typing && selected) { ev.preventDefault(); rename(current()); }
    else if (mod && ev.key.toLowerCase() === 'd' && !typing && selected?.kind === 'element') { ev.preventDefault(); duplicate(); }
    else if (mod && ev.key.toLowerCase() === 'c' && !typing && selected?.kind === 'element') { ev.preventDefault(); copySelected(); say('Copied. Ctrl V pastes it.'); }
    else if (mod && ev.key.toLowerCase() === 'x' && !typing && selected?.kind === 'element') { ev.preventDefault(); if (copySelected()) removeSelected(); }
    else if (mod && ev.key.toLowerCase() === 'v' && !typing && clip) { ev.preventDefault(); ev.stopPropagation(); pasteClip(); }
    else if (ev.key === 'Escape' && !typing && pending) { ev.preventDefault(); ev.stopPropagation(); pending.line?.remove(); pending = null; say(''); }
    else if (ev.key === 'Escape' && !typing) { if (tool.kind !== 'select') { ev.preventDefault(); ev.stopPropagation(); setTool({ kind: 'select' }); } else if (selected) { ev.preventDefault(); ev.stopPropagation(); selected = null; changed(); } }
    else if (!typing && !mod && !ev.altKey && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); showNotes(!notesOpen, !notesOpen); }
    else if (!typing && !mod && ev.key === '?') { ev.preventDefault(); ev.stopPropagation(); toggleHelp(); }
    else if (!typing && !mod && (ev.key === '+' || ev.key === '=')) zoom(1 / 1.25);
    else if (!typing && !mod && ev.key === '-') zoom(1.25);
    else if (!typing && !mod && !ev.altKey && indexOfKey(ev.key) >= 0) {
      const t = paletteTools()[indexOfKey(ev.key)];
      if (t) { ev.preventDefault(); chooseTool(t.kind, t.type); }
    }
  }

  // Moves the selected element (and what it holds) by dx, dy; a run of presses is one undo step.
  function nudge(dx, dy) {
    const e = current();
    if (!e) return;
    snapshot(`nudge:${e.id}`);
    const moving = [e, ...descendants(e.id)], ids = new Set(moving.map((q) => q.id));
    for (const q of moving) { q.bounds[0] += dx; q.bounds[1] += dy; }
    for (const c of model.connectors) if (ids.has(c.from) && ids.has(c.to)) c.waypoints = c.waypoints.map(([x, y]) => [x + dx, y + dy]);
    e.parent = containerFor(e);
    changed({ panel: false });
  }
  // The selection's right-click menu, opened from the keyboard beside it on screen.
  function menuForSelection() {
    const r = canvas.getBoundingClientRect();
    const node = selected && svg.querySelector(`[data-uml-id="${CSS.escape(selected.id)}"]`);
    const b = node?.getBoundingClientRect();
    const x = b ? Math.min(r.right - 8, b.left + b.width / 2) : r.left + r.width / 2, y = b ? Math.min(r.bottom - 8, b.top + b.height / 2) : r.top + r.height / 2;
    menuAt(x, y, toModel({ clientX: x, clientY: y }));
  }

  // --- Property panel -----------------------------------------------------------------
  function field(label, input, wide = false) {
    return make('label', { className: wide ? 'uml-field wide' : 'uml-field' }, make('span', { textContent: label }), input);
  }
  // An input for a field kind, bound to obj[key].
  function inputFor(kindOf, obj, key, label) {
    const id = `${selected?.id || 'diagram'}:${key}`;
    const set = (v, redrawPanel = false) => { snapshot(id); obj[key] = v; changed({ panel: redrawPanel }); };
    if (kindOf === 'bool') {
      const box = make('input', { type: 'checkbox', checked: !!obj[key] });
      box.onchange = () => set(box.checked);
      return make('label', { className: 'uml-check' }, box, ` ${label}`);
    }
    if (typeof kindOf === 'string' && ENUMS[kindOf]) {
      const sel = make('select', {}, ...['', ...ENUMS[kindOf]].filter((v, i) => i || kindOf === 'visibility').map((v) => make('option', { value: v, textContent: v || '(none)' })));
      sel.value = obj[key] ?? '';
      sel.onchange = () => set(sel.value);
      return field(label, sel);
    }
    if (kindOf === 'tags') {
      const inp = make('input', { type: 'text', value: (obj[key] || []).join(', '), placeholder: 'Comma separated' });
      inp.oninput = () => set(inp.value.split(',').map((s) => s.trim()).filter(Boolean));
      return field(label, inp);
    }
    if (kindOf === 'number') {
      const inp = make('input', { type: 'number', value: Number.isFinite(obj[key]) ? obj[key] : '' });
      inp.oninput = () => set(inp.value === '' ? null : Number(inp.value));
      return field(label, inp);
    }
    if (kindOf && typeof kindOf === 'object' && kindOf.list) {
      const list = kindOf.list, def = LISTS[list];
      const area = make('textarea', { rows: Math.max(2, Math.min(10, (obj[key] || []).length + 1)), spellcheck: false, value: (obj[key] || []).map((r) => formatLine(list, r)).join('\n'), placeholder: `One per line, e.g. ${def.example}` });
      area.oninput = () => set(area.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => parseLine(list, l)));
      return field(`${def.label} (one per line, as in UML)`, area, true);
    }
    const inp = make('input', { type: 'text', value: obj[key] ?? '' });
    inp.oninput = () => set(inp.value);
    return field(label, inp);
  }
  const titleCase = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  function buildPanel() {
    const out = [];
    if (!selected) {
      out.push(make('h3', { textContent: DIAGRAMS[model.diagram].label }));
      const name = make('input', { type: 'text', value: model.name, placeholder: 'Name of the diagram' });
      name.oninput = () => { snapshot('diagram:name'); model.name = name.value; changed({ panel: false }); };
      const title = make('input', { type: 'text', value: model.title || '', placeholder: 'Shown above it (optional)' });
      title.oninput = () => { snapshot('diagram:title'); model.title = title.value; changed({ panel: false }); };
      const badge = make('input', { type: 'checkbox', checked: model.badge !== false });
      badge.onchange = () => { snapshot(); model.badge = badge.checked; changed({ panel: false }); };
      out.push(field('Name', name), field('Title', title), make('label', { className: 'uml-check' }, badge, DIAGRAMS[model.diagram].notUml ? ' Show a badge on the note' : ' Show the UML badge on the note'));
      if (model.diagram !== 'sequence') {
        const arrange = make('button', { type: 'button', textContent: 'Arrange as tree', title: 'Lay it out top down, each element under the one that connects to it', disabled: !model.connectors.length });
        arrange.onclick = () => { snapshot(); treeLayout(model); changed(); fit(); };
        out.push(make('div', { className: 'uml-row' }, arrange));
      }
      out.push(make('p', { className: 'uml-hint', textContent: 'Tap an element on the left, then the canvas, to place it (or double-click empty canvas). Drag a selected element\'s arrow handle to another to connect them, or to empty space to add a connected one. Double-click to rename, right-click (or hold) for more. Drag to move, the corner to resize, the empty canvas to pan; double-click a line to bend it.' }));
    } else if (selected.kind === 'element') {
      const e = model.elements.find((q) => q.id === selected.id);
      if (!e) { selected = null; return buildPanel(); }
      const def = ELEMENTS[e.type] || { label: e.type, fields: {} };
      const head = make('h3', {}, umlIcon('element', e.type), ` ${def.label}`);
      out.push(head);
      if (!def.noName) {
        const name = def.longName ? make('textarea', { rows: 3, value: e.name }) : make('input', { type: 'text', value: e.name });
        name.className = 'uml-name';
        name.oninput = () => { snapshot(`${e.id}:name`); e.name = name.value; changed({ panel: false }); };
        out.push(field(def.longName ? 'Text' : 'Name', name, def.longName));
      }
      for (const [key, kindOf] of Object.entries(def.fields || {})) out.push(inputFor(kindOf, e.props, key, titleCase(key)));
      // Fields that came from a file and have no input here: shown, so nothing is hidden.
      const extra = Object.keys(e.props).filter((k) => !(k in (def.fields || {})));
      if (extra.length) out.push(make('p', { className: 'uml-hint', textContent: `Also kept from the file: ${extra.join(', ')}.` }));
    } else {
      const c = model.connectors.find((q) => q.id === selected.id);
      if (!c) { selected = null; return buildPanel(); }
      const def = CONNECTORS[c.type] || { label: c.type, fields: {} };
      out.push(make('h3', {}, umlIcon('connector', c.type), ` ${def.label}`));
      const allowed = DIAGRAMS[model.diagram].connectors.filter((t) => !!CONNECTORS[t].message === !!def.message || t === 'anchor');
      const type = make('select', {}, ...allowed.map((t) => make('option', { value: t, textContent: CONNECTORS[t].label })));
      type.value = c.type;
      type.onchange = () => {
        snapshot();
        const next = makeConnector(type.value, c.from, c.to, {}, model);
        c.type = type.value;
        c.props = { ...next.props, ...Object.fromEntries(Object.entries(c.props).filter(([k]) => k in next.props)) };
        changed();
      };
      out.push(field('Kind', type));
      const from = model.elements.find((q) => q.id === c.from), to = model.elements.find((q) => q.id === c.to);
      out.push(make('p', { className: 'uml-hint', textContent: `From ${from?.name || ELEMENTS[from?.type]?.label || '?'} to ${to?.name || ELEMENTS[to?.type]?.label || '?'}.` }));
      for (const [key, kindOf] of Object.entries(def.fields || {})) out.push(inputFor(kindOf, c.props, key, titleCase(key)));
      if (def.ends) {
        for (const [side, label] of [['fromEnd', 'At the start'], ['toEnd', 'At the end']]) {
          c.props[side] ||= { role: '', multiplicity: '', navigable: false };
          out.push(make('h4', { textContent: label }), inputFor('text', c.props[side], 'role', 'Role'), inputFor('text', c.props[side], 'multiplicity', 'Multiplicity'), inputFor('bool', c.props[side], 'navigable', 'Navigable (arrow)'));
        }
      }
      const swap = make('button', { type: 'button', textContent: 'Swap direction' });
      swap.onclick = () => { snapshot(); [c.from, c.to] = [c.to, c.from]; if (def.ends) [c.props.fromEnd, c.props.toEnd] = [c.props.toEnd, c.props.fromEnd]; c.waypoints.reverse(); changed(); };
      const straight = make('button', { type: 'button', textContent: 'Straighten', disabled: !c.waypoints.length });
      straight.onclick = () => { snapshot(); c.waypoints = []; changed(); };
      // A plain line (no arrow, no ends) looks the same either way round: no Swap direction.
      out.push(make('div', { className: 'uml-row' }, ...(directed(def) ? [swap] : []), straight));
    }
    panel.replaceChildren(...out);
  }
  // Renames in place: a text box over the element (or the connector's label), as in Visual
  // Paradigm. Enter keeps it (Shift Enter is a new line in a note), Escape leaves it as it was.
  let editing = null;
  function rename(target) {
    if (!target) return;
    const isEl = !!target.bounds;
    const def = isEl ? ELEMENTS[target.type] : CONNECTORS[target.type];
    if (!def || (isEl && def.noName) || (!isEl && !('name' in (def.fields || {})))) return;
    editing?.done(false);
    requestAnimationFrame(() => {
      const m = svg.getScreenCTM();
      if (!m) return;
      const r = canvas.getBoundingClientRect();
      const k = m.a || 1;
      let box;
      if (isEl) {
        const [x, y, w, h] = fitBounds(target);
        // Stick figures and the like keep their name under them; boxes have it inside.
        const below = ['stickman', 'dot', 'bullseye', 'flowFinal', 'diamond', 'node', 'actorLifeline'].includes(def.shape);
        const lane = def.shape === 'lane' || def.shape === 'boundary' || def.shape === 'folder' || def.shape === 'composite' || def.shape === 'compartments' || def.shape === 'lifeline' || def.shape === 'fragment';
        box = below ? [x + w / 2 - 80, y + h + 2, 160, 26] : lane ? [x + 4, y + 4, Math.max(120, w - 8), 26] : [x + 4, y + 4, w - 8, h - 8];
      } else {
        const pts = connectorPath(model, target) || [[0, 0], [0, 0]];
        const mid = pts[Math.floor((pts.length - 1) / 2)], nxt = pts[Math.floor((pts.length - 1) / 2) + 1] || mid;
        box = [(mid[0] + nxt[0]) / 2 - 70, (mid[1] + nxt[1]) / 2 - 13, 140, 26];
      }
      const p = new DOMPoint(box[0], box[1]).matrixTransform(m);
      const area = make('textarea', { className: 'uml-rename', value: isEl ? target.name : target.props.name || '', spellcheck: false });
      Object.assign(area.style, { left: `${p.x - r.left}px`, top: `${p.y - r.top}px`, width: `${Math.max(80, box[2] * k)}px`, height: `${Math.max(24, box[3] * k)}px`, fontSize: `${Math.max(11, 13 * k)}px` });
      canvas.append(area);
      area.focus();
      area.select();
      const before = area.value;
      const done = (keep) => {
        if (editing?.area !== area) return;
        editing = null;
        area.remove();
        if (keep && area.value !== before) {
          snapshot();
          if (isEl) target.name = def.longName ? area.value : area.value.replace(/\s*\n\s*/g, ' ').trim();
          else target.props.name = area.value.trim();
          changed();
        }
        canvas.focus({ preventScroll: true });
      };
      editing = { area, done };
      area.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
        else if (ev.key === 'Enter' && !(ev.shiftKey && def.longName)) { ev.preventDefault(); done(true); }
      });
      area.addEventListener('blur', () => done(true));
      area.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    });
  }
  const current = () => (selected?.kind === 'element' ? model.elements.find((q) => q.id === selected.id) : selected?.kind === 'connector' ? model.connectors.find((q) => q.id === selected.id) : null);
  function duplicate() {
    const e = selected?.kind === 'element' && current();
    if (!e) return;
    snapshot();
    const copies = new Map();
    for (const q of [e, ...descendants(e.id)]) {
      const c = clone(q);
      c.id = makeElement(q.type, [0, 0], {}, model).id;
      copies.set(q.id, c);
      c.bounds[0] += 20; c.bounds[1] += 20;
      model.elements.push(c);
    }
    for (const c of copies.values()) if (copies.has(c.parent)) c.parent = copies.get(c.parent).id;
    for (const l of [...model.connectors]) if (copies.has(l.from) && copies.has(l.to)) model.connectors.push({ ...clone(l), id: makeConnector(l.type, l.from, l.to, {}, model).id, from: copies.get(l.from).id, to: copies.get(l.to).id, waypoints: l.waypoints.map(([x, y]) => [x + 20, y + 20]) });
    selected = { kind: 'element', id: copies.get(e.id).id };
    changed();
  }
  // Shift held when letting go: the connector's type and direction, picked from a menu (the
  // type it would have been, pointing the way it would have, comes first).
  const nameOf = (e) => e.name || ELEMENTS[e.type]?.label || 'element';
  function pickLink(d, to, ev) {
    const from = d.from;
    const entry = (t) => {
      const [a, b] = ends(t, from, to);
      return {
        label: CONNECTORS[t].label, iconEl: umlIcon('connector', t), checked: t === d.type,
        run: () => connect(t, from, to, d.start),
        submenu: [
          { label: `${nameOf(a)} → ${nameOf(b)}`, icon: 'arrowRight', checked: true, run: () => connect(t, a, b, d.start, true) },
          { label: `${nameOf(b)} → ${nameOf(a)}`, icon: 'arrowLeft', run: () => connect(t, b, a, d.start, true) },
        ],
      };
    };
    const types = DIAGRAMS[model.diagram].connectors.filter((t) => !CONNECTORS[t].toConnector);
    // After the click that ends this press, which would close a menu opened now.
    const [x, y] = [ev.clientX, ev.clientY];
    setTimeout(() => menu(x, y, [entry(d.type), '-', ...types.filter((t) => t !== d.type).map(entry)], { title: 'Connect as' }), 0);
  }
  // Right-angled bends between a connector's two ends (one elbow, or two for a step).
  function rectilinear(c) {
    const box = (id) => { const e = model.elements.find((q) => q.id === id); return e && fitBounds(e); };
    const a = box(c.from), b = CONNECTORS[c.type]?.toConnector ? null : box(c.to);
    const end = b ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : (connectorPath(model, c) || []).at(-1);
    if (!a || !end) return [];
    const [ax, ay] = [a[0] + a[2] / 2, a[1] + a[3] / 2], [bx, by] = end;
    // Side by side: across, down, across; one above the other: down, across, down.
    const apart = (p, q) => Math.abs(p - q);
    if (b && b[0] > a[0] + a[2] || b && a[0] > b[0] + b[2]) { const mx = Math.round((ax + bx) / 2); return apart(ay, by) < 4 ? [] : [[mx, Math.round(ay)], [mx, Math.round(by)]]; }
    const my = Math.round((ay + by) / 2);
    return apart(ax, bx) < 4 ? [] : [[Math.round(ax), my], [Math.round(bx), my]];
  }
  // A connector made another type, keeping its name, label place, colour and text size.
  function retype(c, t) {
    if (c.type === t) return;
    snapshot();
    const keep = c.props || {};
    const fresh = makeConnector(t, c.from, c.to, { props: Object.fromEntries(Object.entries({ name: keep.name, labelOffset: keep.labelOffset, color: keep.color, textScale: keep.textScale, y: CONNECTORS[t].message ? keep.y : undefined }).filter(([, v]) => v !== undefined)) }, model);
    c.type = t;
    c.props = fresh.props;
    changed();
  }
  // Text size and colour, for an element or a connector.
  const SIZES = [0.8, 1, 1.25, 1.5, 2];
  const COLORS = [['Ink', null], ['Blue', '#2563eb'], ['Green', '#16a34a'], ['Red', '#dc2626'], ['Orange', '#ea580c'], ['Purple', '#7c3aed'], ['Teal', '#0d9488'], ['Grey', '#64748b']];
  function setProp(item, key, value) {
    snapshot();
    item.props ||= {};
    if (value == null) delete item.props[key]; else item.props[key] = value;
    changed();
  }
  const styleEntries = (item) => [
    { label: 'Text size', icon: 'text', submenu: SIZES.map((k) => ({ label: k === 1 ? 'Normal' : `${Math.round(k * 100)} %`, checked: textScale(item) === k, run: () => setProp(item, 'textScale', k === 1 ? null : k) })) },
    { label: 'Colour', icon: 'draw', submenu: COLORS.map(([label, c]) => ({ label, swatch: c || '#1f2328', checked: itemColor(item) === c, run: () => setProp(item, 'color', c) })) },
  ];
  // Copy, cut and paste of elements (with what they hold and the connectors among them).
  let clip = null;
  function copySelected() {
    const e = selected?.kind === 'element' && current();
    if (!e) return false;
    const group = [e, ...descendants(e.id)], ids = new Set(group.map((q) => q.id));
    clip = { elements: group.map(clone), connectors: model.connectors.filter((l) => ids.has(l.from) && ids.has(l.to)).map(clone), diagram: model.diagram, pastes: 0 };
    return true;
  }
  function pasteClip(at = null) {
    if (!clip) return say('Copy an element first (Ctrl C).');
    const known = new Set(DIAGRAMS[model.diagram].elements);
    if (!clip.elements.every((q) => known.has(q.type) || ELEMENTS[q.type])) return;
    snapshot();
    clip.pastes++;
    const [x0, y0] = clip.elements[0].bounds;
    const [dx, dy] = at ? [Math.round(at[0] - x0), Math.round(at[1] - y0)] : [20 * clip.pastes, 20 * clip.pastes];
    const copies = new Map();
    for (const q of clip.elements) {
      const c = clone(q);
      c.id = makeElement(q.type, [0, 0], {}, model).id;
      c.bounds[0] += dx; c.bounds[1] += dy;
      copies.set(q.id, c);
      model.elements.push(c);
    }
    for (const c of copies.values()) c.parent = copies.has(c.parent) ? copies.get(c.parent).id : containerFor(c);
    for (const l of clip.connectors) model.connectors.push({ ...clone(l), id: makeConnector(l.type, l.from, l.to, {}, model).id, from: copies.get(l.from).id, to: copies.get(l.to).id, waypoints: l.waypoints.map(([x, y]) => [x + dx, y + dy]) });
    selected = { kind: 'element', id: copies.get(clip.elements[0].id).id };
    changed();
  }
  // Starts a connection from `from` that follows the pointer; the next click ends it.
  let pending = null;
  function startConnect(from) {
    pending = { mode: 'connect', type: connectorFor(from), from, start: [from.bounds[0] + from.bounds[2] / 2, from.bounds[1] + from.bounds[3] / 2], line: null, grow: true };
    say('Click another element to connect to it, or empty space to add a connected one (Escape stops).');
  }

  // --- Menu at the pointer: right-click, or a long press ------------------------------
  function menuAt(x, y, pt) {
    const hit = document.elementFromPoint(x, y)?.closest?.('[data-uml-id]');
    const e = hit?.dataset.umlKind === 'element' ? model.elements.find((q) => q.id === hit.dataset.umlId) : !hit && pt ? elementAt(pt) : null;
    const c = ['connector', 'label'].includes(hit?.dataset.umlKind) ? model.connectors.find((q) => q.id === hit.dataset.umlId) : null;
    if (e || c) { selected = { kind: e ? 'element' : 'connector', id: (e || c).id }; changed(); }
    else if (selected) { selected = null; changed(); }
    const props = { label: 'Properties…', icon: 'settings', run: () => showPanel(true) };
    const del = { label: 'Delete', icon: 'backspace', danger: true, key: 'Del', run: removeSelected };
    if (e) {
      const def = ELEMENTS[e.type];
      return menu(x, y, [
        !def.noName && { label: 'Rename', icon: 'text', key: 'F2', run: () => rename(e) },
        props,
        { label: 'Connect to…', icon: 'link', run: () => startConnect(e) },
        { label: 'Duplicate', icon: 'copy', key: 'Ctrl D', run: duplicate },
        { label: 'Cut', icon: 'scissors', key: 'Ctrl X', run: () => { if (copySelected()) removeSelected(); } },
        { label: 'Copy', icon: 'copy', key: 'Ctrl C', run: copySelected },
        '-', ...styleEntries(e),
        '-', del,
      ], { title: e.name || def.label });
    }
    if (c) {
      const def = CONNECTORS[c.type];
      return menu(x, y, [
        'name' in (def.fields || {}) && { label: 'Rename', icon: 'text', key: 'F2', run: () => rename(c) },
        props,
        !def.toConnector && { label: 'Type', icon: 'link', submenu: DIAGRAMS[model.diagram].connectors.filter((t) => !CONNECTORS[t].toConnector).map((t) => ({ label: CONNECTORS[t].label, iconEl: umlIcon('connector', t), checked: t === c.type, run: () => retype(c, t) })) },
        directed(def) && !def.toConnector && { label: 'Swap direction', icon: 'swap', run: () => { snapshot(); [c.from, c.to] = [c.to, c.from]; if (def.ends) [c.props.fromEnd, c.props.toEnd] = [c.props.toEnd, c.props.fromEnd]; c.waypoints.reverse(); changed(); } },
        { label: 'Straighten', icon: 'minus', disabled: !c.waypoints.length, run: () => { snapshot(); c.waypoints = []; changed(); } },
        !def.message && { label: 'Make rectilinear', icon: 'layers', run: () => { snapshot(); c.waypoints = rectilinear(c); changed(); } },
        { label: 'Label back beside the line', icon: 'restart', disabled: !c.props.labelOffset, run: () => { snapshot(); delete c.props.labelOffset; changed(); } },
        '-', ...styleEntries(c),
        '-', del,
      ], { title: c.props.name || def.label });
    }
    const at = pt || center();
    return menu(x, y, [
      ...DIAGRAMS[model.diagram].elements.map((t) => ({ label: `Add ${ELEMENTS[t].label.toLowerCase()}`, icon: 'plus', run: () => place(t, at) })),
      '-',
      clip && { label: 'Paste here', icon: 'import', key: 'Ctrl V', run: () => pasteClip(at) },
      { label: 'Show the whole diagram', icon: 'fit', run: fit },
      model.diagram !== 'sequence' && { label: 'Arrange as tree', icon: 'layers', disabled: !model.connectors.length, run: () => { snapshot(); treeLayout(model); changed(); fit(); } },
      { label: 'Diagram properties…', icon: 'settings', run: () => showPanel(true) },
    ], { title: DIAGRAMS[model.diagram].label });
  }
  svg.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (drag?.mode === 'connect') { drag.line?.remove(); drag = null; }
    menuAt(ev.clientX, ev.clientY, toModel(ev));
  });
  // A finger held still for a moment: the same menu.
  let press = null;
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch') return;
    clearTimeout(press?.timer);
    const at = [ev.clientX, ev.clientY], pt = toModel(ev);
    press = { at, timer: setTimeout(() => { press = null; if (touches.size > 1) return; drag?.line?.remove(); drag = null; draw(); menuAt(at[0], at[1], pt); }, 550) };
  }, true);
  svg.addEventListener('pointermove', (ev) => { if (press && Math.hypot(ev.clientX - press.at[0], ev.clientY - press.at[1]) > 8) { clearTimeout(press.timer); press = null; } }, true);
  const unpress = () => { clearTimeout(press?.timer); press = null; };
  svg.addEventListener('pointerup', unpress, true);
  svg.addEventListener('pointercancel', unpress, true);

  // --- Cheat sheet (?) ---------------------------------------------------------------------
  let help = null;
  function toggleHelp() {
    help ||= cheatSheet(root, {
      key: 'uml', title: 'UML editor',
      sections: [
        { title: 'Mouse', icon: 'select', rows: [
          { icon: 'select', does: 'Click: select · drag: move · corner: resize' },
          { icon: 'arrowRight', does: 'Point at an element, drag its arrow to another: connect' },
          { keys: 'Shift', does: 'Held when letting go: choose the kind and direction' },
          { icon: 'plus', does: 'Arrow dropped on empty space: a new element, connected' },
          { icon: 'draw', does: 'Drag a line: bend it · hollow dot: another bend · double-click a bend: remove it' },
          { icon: 'link', does: 'Drag a selected line\'s end onto another element: reconnect it' },
          { icon: 'text', does: 'Double-click: rename · on empty canvas: a new element' },
          { icon: 'settings', does: 'Right-click or hold: the menu (type, straighten, rectilinear, colour…)' },
          { icon: 'pan', does: 'Drag empty canvas or the middle button: pan · Ctrl wheel: zoom' },
        ] },
        { title: 'Keys', icon: 'keyboard', rows: [
          { keys: '1 … 9 / 0', does: 'Pick a tool from the palette' },
          { keys: 'Shift S', does: 'The tools in a ring at the pointer' },
          { keys: 'Esc', does: 'Back to Select · clear the selection' },
          { keys: 'Enter / F2', does: 'Rename the selection' },
          { keys: 'Del / Backspace', does: 'Delete the selection' },
          { keys: '← ↑ → ↓', does: 'Move the selected element (Shift: ten times as far)' },
          { keys: 'Ctrl Z / Ctrl Shift Z / Ctrl Y', does: 'Undo · redo' },
          { keys: 'Ctrl C / Ctrl X / Ctrl V / Ctrl D', does: 'Copy · cut · paste · duplicate' },
          { keys: 'Ctrl + / Ctrl − / Ctrl 0', does: 'Zoom in · out · the whole diagram' },
          { keys: 'Shift F10 / Menu', does: 'The selection\'s menu' },
          { keys: 'N', does: 'Notes on the diagram' },
          { keys: '?', does: 'This sheet' },
        ] },
        { title: 'Views', icon: 'split', rows: [
          { icon: 'uml', does: 'Visual: the drawing' },
          { icon: 'code', does: 'Code: the diagram as PlantUML; typing redraws it' },
          { icon: 'split', does: 'Both, side by side' },
          { icon: 'import', does: 'Open Visual Paradigm XML, XMI, PlantUML or NoteComplete files' },
          { icon: 'export', does: 'Save as Visual Paradigm XML, XMI, PlantUML, SVG, PNG or JSON' },
        ] },
      ],
    });
    helpBtn.setAttribute('aria-pressed', String(help.toggle()));
  }
  helpBtn.onclick = toggleHelp;

  // --- Bar ----------------------------------------------------------------------------
  kindSelect.onchange = () => {
    if (kindSelect.value === model.diagram) return;
    snapshot();
    // An empty diagram starts from the example of the new kind; one with work keeps it.
    if (!model.elements.length) setModel({ ...starterModel(kindSelect.value), name: model.name });
    else { model.diagram = kindSelect.value; buildPalette(); changed(); }
    setView(currentView);
  };
  undoBtn.onclick = () => stepHistory(undo, redo);
  redoBtn.onclick = () => stepHistory(redo, undo);
  delBtn.onclick = removeSelected;
  clearAllBtn.onclick = () => {
    if (!model.elements.length && !model.connectors.length) return;
    snapshot();
    model.elements = [];
    model.connectors = [];
    selected = null;
    changed();
    say('Cleared. One undo (Ctrl Z) brings it back.');
  };
  zoomIn.onclick = () => zoom(1 / 1.25);
  zoomOut.onclick = () => zoom(1.25);
  fitBtn.onclick = fit;
  importBtn.onclick = () => importInput.click();
  importInput.onchange = async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    const open = (text, options) => {
      try {
        const next = /@startuml/i.test(text) ? parsePlantUml(text).model : importUml(text, options);
        snapshot();
        setModel(next);
        say(`Opened ${file.name}${options ? ` (${next.name})` : ''}: ${model.elements.length} elements, ${model.connectors.length} connectors.`);
      } catch (e) { say(e.message, true); }
    };
    let text;
    try { text = await file.text(); } catch (e) { return say(e.message, true); }
    // A Visual Paradigm project with several diagrams: which one.
    let list = [];
    try { list = detectFormat(text) === 'vp-xml' ? vpDiagrams(text).filter((d) => d.shapes) : []; } catch { /* importUml says what is wrong. */ }
    if (list.length < 2) return open(text);
    menu(...below(importBtn), list.map((d) => ({ label: `${d.name || DIAGRAMS[d.kind].label} · ${DIAGRAMS[d.kind].label.toLowerCase()}`, icon: 'uml', run: () => open(text, { diagram: d.index }) })), { title: `${file.name}: which diagram?` });
  };
  async function exportAs(what) {
    try {
      if (what === 'vp') await download(exportVp(model), fileName(model, 'xml'), 'application/xml');
      else if (what === 'xmi') await download(exportXmi(model), fileName(model, 'xmi'), 'application/xml');
      else if (what === 'svg') await download(renderUml(model).svg, fileName(model, 'svg'), 'image/svg+xml');
      else if (what === 'png') await download(await umlPng(model), fileName(model, 'png'), 'image/png');
      else if (what === 'json') await download(JSON.stringify(model, null, 2), fileName(model, 'json'), 'application/json');
      else if (what === 'puml') await download(toPlantUml(model, { preamble }), fileName(model, 'puml'), 'text/plain');
      say('Exported.');
    } catch (e) { say(e.message, true); }
  }
  const below = (b) => { const r = b.getBoundingClientRect(); return [r.left, r.bottom + 4]; };
  exportBtn.onclick = () => {
    const uml = !DIAGRAMS[model.diagram].notUml;
    menu(...below(exportBtn), [
      { label: 'Visual Paradigm XML (.xml)', icon: 'uml', disabled: !uml, run: () => exportAs('vp') },
      { label: 'XMI 2.1 (.xmi)', icon: 'uml', disabled: !uml, run: () => exportAs('xmi') },
      { label: 'PlantUML (.puml)', icon: 'code', disabled: !CODE_KINDS.has(model.diagram), run: () => exportAs('puml') },
      { label: 'Picture (.svg)', icon: 'image', run: () => exportAs('svg') },
      { label: 'Picture (.png)', icon: 'image', run: () => exportAs('png') },
      { label: 'NoteComplete diagram (.json)', icon: 'save', run: () => exportAs('json') },
    ], { title: 'Export' });
  };
  panelBtn.onclick = () => showPanel(!panelOpen);
  notesBtn.onclick = () => showNotes(!notesOpen, !notesOpen);
  if (applyBtn) applyBtn.onclick = () => onApply(normalizeModel(model));
  if (cancelBtn) cancelBtn.onclick = () => onCancel();

  // The canvas gets its size once laid out (and again when the window changes): fit again
  // until the view has been moved by hand.
  const resize = new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return; if (viewMoved) applyView(); else fit(); });
  resize.observe(canvas);
  buildPalette();
  showPanel(panelOpen);
  showNotes(notesOpen);
  setView(startView || savedView());
  changed();
  requestAnimationFrame(fit);
  return {
    model: () => normalizeModel(model),
    set: (m) => setModel(m),
    select: (id) => { const e = model.elements.find((q) => q.id === id); selected = e ? { kind: 'element', id } : null; changed(); },
    // Zoom from the page around it: dir 1 in, −1 out, 0 the whole diagram.
    zoom: (dir) => (dir === 0 ? fit() : zoom(dir > 0 ? 1 / 1.25 : 1.25)),
    focus: () => canvas.focus({ preventScroll: true }),
    setView,
    destroy: () => { help?.destroy(); ring.destroy(); resize.disconnect(); document.removeEventListener('keydown', stray); closeContextMenu(); root.replaceChildren(); },
  };
}

// Before a new diagram opens: which editor view, from a small menu of icons (Visual, Code,
// Both), unless the person chose to always use the one they pick. Resolves with the view, or
// null when the menu was closed without a choice.
export function chooseView(diagram, { x = innerWidth / 2, y = innerHeight / 3, menu } = {}) {
  let ask = true;
  try { ask = localStorage.getItem(ASK_KEY) !== '0'; } catch { /* Optional. */ }
  if (!CODE_KINDS.has(diagram) || !ask) return Promise.resolve(savedView());
  return new Promise((resolve) => {
    let chosen = false, again = false;
    const pick = (v) => { chosen = true; try { localStorage.setItem(VIEW_KEY, v); } catch { /* Optional. */ } resolve(v); };
    const show = () => menu(x, y, [
      ...Object.entries(VIEWS).map(([v, d]) => ({ label: d.label, icon: d.icon, checked: v === savedView(), run: () => pick(v) })),
      '-',
      { label: 'Ask every time', icon: 'settings', checked: ask, run: () => { ask = !ask; again = true; try { localStorage.setItem(ASK_KEY, ask ? '1' : '0'); } catch { /* Optional. */ } show(); } },
    ], { title: 'Editor', onClose: () => setTimeout(() => { if (again) { again = false; return; } if (!chosen) resolve(null); }, 0) });
    show();
  });
}

// The editor over a note, full-window. Resolves with the new model, or null.
export function openUmlEditor(model, { editing = false, markdown = null, view = null } = {}) {
  ensureStyles();
  return new Promise((resolve) => {
    const dialog = make('dialog', { className: 'uml-dialog' });
    const host = make('div', { className: 'uml-host' });
    dialog.append(host);
    document.body.append(dialog);
    const finish = (value) => { editor.destroy(); dialog.close(); dialog.remove(); resolve(value); };
    // Keys stay in the editor (the note's shortcuts are not for it).
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); });
    dialog.showModal();
    const editor = mountUmlEditor(host, model, { onApply: (m) => finish(m), onCancel: () => finish(null), applyLabel: editing ? 'Apply' : 'Insert', markdown, view });
  });
}
