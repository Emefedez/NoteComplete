// The UML diagram editor: a palette of the diagram's element and connector types (uml.js),
// a canvas to place, move, resize and connect them, and a property panel built from each
// type's fields. The same editor runs on its own page (uml.html) and in a full-window dialog
// over a note (openUmlEditor), where Apply hands the diagram back to be drawn on the page.
import { DIAGRAMS, ELEMENTS, CONNECTORS, ENUMS, LISTS, normalizeModel, starterModel, renderUml, fitBounds, connectorPath, makeElement, makeConnector, parseLine, formatLine, umlIcon, umlName } from './uml.js';
import { importUml, exportXmi, exportVp } from './uml-xml.js';
import { download } from './download.js';

const SVG = 'http://www.w3.org/2000/svg';
const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
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
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(out.svg)}`;
  await img.decode();
  const canvas = make('canvas', { width: Math.round(out.width * scale), height: Math.round(out.height * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Mounts the editor in `root`. `apply`/`cancel`: the buttons shown when it edits for a note.
// Returns { model(), set(model), destroy() }.
export function mountUmlEditor(root, initial, { onApply = null, onCancel = null, onChange = null, applyLabel = 'Apply' } = {}) {
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
    if (panel) buildPanel();
    updateButtons();
    onChange?.(model);
  }

  // --- Layout -------------------------------------------------------------------------
  root.classList.add('uml-editor');
  root.replaceChildren();
  const kindSelect = make('select', { className: 'uml-kind', title: 'Diagram type' }, ...Object.entries(DIAGRAMS).map(([k, d]) => make('option', { value: k, textContent: d.label })));
  const undoBtn = make('button', { type: 'button', textContent: 'Undo', title: 'Undo (Ctrl Z)' });
  const redoBtn = make('button', { type: 'button', textContent: 'Redo', title: 'Redo (Ctrl Y)' });
  const delBtn = make('button', { type: 'button', textContent: 'Delete', title: 'Delete the selection (Delete)' });
  const zoomOut = make('button', { type: 'button', textContent: '−', title: 'Zoom out' });
  const zoomIn = make('button', { type: 'button', textContent: '+', title: 'Zoom in' });
  const fitBtn = make('button', { type: 'button', textContent: 'Fit', title: 'Show the whole diagram' });
  const importInput = make('input', { type: 'file', accept: '.xml,.xmi,.uml,.json,application/xml,text/xml,application/json', hidden: true });
  const importBtn = make('button', { type: 'button', textContent: 'Import…', title: 'Open a Visual Paradigm XML, XMI or NoteComplete diagram file' });
  const exportSelect = make('select', { className: 'uml-export', title: 'Export the diagram' },
    make('option', { value: '', textContent: 'Export…' }),
    make('option', { value: 'vp', textContent: 'Visual Paradigm XML (.xml)' }),
    make('option', { value: 'xmi', textContent: 'XMI 2.1 (.xmi)' }),
    make('option', { value: 'svg', textContent: 'Picture (.svg)' }),
    make('option', { value: 'png', textContent: 'Picture (.png)' }),
    make('option', { value: 'json', textContent: 'NoteComplete diagram (.json)' }));
  const spacer = make('span', { className: 'uml-spacer' });
  const cancelBtn = onCancel && make('button', { type: 'button', textContent: 'Cancel' });
  const applyBtn = onApply && make('button', { type: 'button', className: 'primary', textContent: applyLabel });
  const bar = make('div', { className: 'uml-bar' }, kindSelect, undoBtn, redoBtn, delBtn, zoomOut, zoomIn, fitBtn, importBtn, importInput, exportSelect, spacer, cancelBtn, applyBtn);
  const palette = make('div', { className: 'uml-palette', role: 'toolbar', ariaLabel: 'Elements and connectors' });
  const canvas = make('div', { className: 'uml-canvas', tabIndex: 0 });
  const panel = make('div', { className: 'uml-panel' });
  const status = make('div', { className: 'uml-status', role: 'status' });
  root.append(bar, make('div', { className: 'uml-main' }, palette, canvas, panel), status);
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('uml-svg');
  canvas.append(svg);
  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  // --- Palette ------------------------------------------------------------------------
  function buildPalette() {
    const d = DIAGRAMS[model.diagram];
    kindSelect.value = model.diagram;
    const button = (kind, type, label) => {
      const b = make('button', { type: 'button', className: 'uml-tool', title: kind === 'element' ? `${label}: tap the canvas to place it` : `${label}: drag from one element to another` }, umlIcon(kind, type), make('span', { textContent: label }));
      b.dataset.kind = kind; b.dataset.type = type;
      b.onclick = () => setTool(tool.kind === kind && tool.type === type ? { kind: 'select' } : { kind, type });
      b.ondblclick = () => { if (kind === 'element') place(type, center()); };
      return b;
    };
    const sel = make('button', { type: 'button', className: 'uml-tool', title: 'Select, move and resize (Escape)' }, umlIcon('connector', 'none'), make('span', { textContent: 'Select' }));
    sel.dataset.kind = 'select';
    sel.querySelector('path').setAttribute('d', 'm6 4 12 7-6 1.5-3 6Z');
    sel.onclick = () => setTool({ kind: 'select' });
    palette.replaceChildren(sel,
      make('h4', { textContent: 'Elements' }), ...d.elements.map((t) => button('element', t, ELEMENTS[t].label)),
      make('h4', { textContent: 'Connectors' }), ...d.connectors.map((t) => button('connector', t, CONNECTORS[t].label)));
    markTool();
  }
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
  function draw() {
    const ids = selected ? [selected.id] : [];
    const out = renderUml(model, { ids: true, selected: ids, badge: false, margin: 40 });
    const holder = document.createElement('div');
    holder.innerHTML = out.svg;
    const drawn = holder.firstElementChild;
    drawn.querySelector(':scope > rect')?.remove(); // the white page: the canvas has its own
    svg.replaceChildren(...drawn.childNodes);
    // Handles of the selection: a corner to resize an element, points to bend a connector.
    if (selected?.kind === 'element') {
      const e = model.elements.find((q) => q.id === selected.id);
      if (e) {
        const [x, y, w, h] = fitBounds(e);
        const k = view ? view[2] / Math.max(1, canvas.getBoundingClientRect().width) : 1;
        const s = 10 * k;
        const handle = document.createElementNS(SVG, 'rect');
        Object.entries({ x: x + w - s / 2, y: y + h - s / 2, width: s, height: s, class: 'uml-handle', 'data-handle': 'resize' }).forEach(([a, v]) => handle.setAttribute(a, v));
        svg.append(handle);
      }
    } else if (selected?.kind === 'connector') {
      const c = model.connectors.find((q) => q.id === selected.id);
      const k = view ? view[2] / Math.max(1, canvas.getBoundingClientRect().width) : 1;
      (c?.waypoints || []).forEach((p, i) => {
        const dot = document.createElementNS(SVG, 'circle');
        Object.entries({ cx: p[0], cy: p[1], r: 6 * k, class: 'uml-handle', 'data-handle': `way:${i}` }).forEach(([a, v]) => dot.setAttribute(a, v));
        svg.append(dot);
      });
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
    focusName();
  }
  function connect(type, from, to, at = null) {
    snapshot();
    const extra = {};
    if (CONNECTORS[type].message) extra.props = { y: Math.round(at?.[1] ?? 120) };
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
    selected = null;
    changed();
  }
  function setModel(next, { keepView = false } = {}) {
    model = normalizeModel(next);
    selected = null;
    if (!keepView) view = null;
    buildPalette();
    changed();
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
  }
  function updateButtons() {
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
    delBtn.disabled = !selected;
  }

  // --- Pointer ------------------------------------------------------------------------
  let drag = null;
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    canvas.focus({ preventScroll: true });
    const pt = toModel(ev);
    const handle = ev.target.closest?.('[data-handle]')?.dataset.handle;
    const hit = ev.target.closest?.('[data-uml-id]');
    const id = hit?.dataset.umlId, kind = hit?.dataset.umlKind;
    svg.setPointerCapture(ev.pointerId);
    if (tool.kind === 'element') { place(tool.type, pt); return; }
    if (tool.kind === 'connector') {
      const from = elementAt(pt);
      if (!from) return say('Start on an element, and let go on another.');
      drag = { mode: 'connect', from, start: pt, line: null };
      return;
    }
    if (handle === 'resize') {
      const e = model.elements.find((q) => q.id === selected.id);
      drag = { mode: 'resize', e, start: pt, bounds: [...e.bounds], snapped: false };
      return;
    }
    if (handle?.startsWith('way:')) {
      const c = model.connectors.find((q) => q.id === selected.id);
      drag = { mode: 'way', c, index: Number(handle.slice(4)), start: pt, snapped: false };
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
    if (kind === 'connector') {
      selected = { kind: 'connector', id };
      const c = model.connectors.find((q) => q.id === id);
      drag = CONNECTORS[c.type]?.message ? { mode: 'message', c, start: pt, y: c.props.y, snapped: false } : null;
      changed();
      return;
    }
    // Empty canvas: deselect and pan.
    if (selected) { selected = null; changed(); }
    drag = { mode: 'pan', start: [ev.clientX, ev.clientY], view: [...view] };
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
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
      drag.e.bounds[2] = Math.max(16, Math.round(drag.bounds[2] + dx));
      drag.e.bounds[3] = Math.max(6, Math.round(drag.bounds[3] + dy));
      draw();
    } else if (drag.mode === 'way') {
      once();
      drag.c.waypoints[drag.index] = [Math.round(pt[0]), Math.round(pt[1])];
      draw();
    } else if (drag.mode === 'message') {
      if (!drag.snapped && Math.abs(dy) < 2) return;
      once();
      drag.c.props.y = Math.round(drag.y + dy);
      draw();
    } else if (drag.mode === 'connect') {
      if (!drag.line) { drag.line = document.createElementNS(SVG, 'line'); drag.line.setAttribute('class', 'uml-rubber'); }
      const b = fitBounds(drag.from);
      Object.entries({ x1: b[0] + b[2] / 2, y1: CONNECTORS[tool.type]?.message ? drag.start[1] : b[1] + b[3] / 2, x2: pt[0], y2: pt[1] }).forEach(([a, v]) => drag.line.setAttribute(a, v));
      svg.append(drag.line);
    }
  });
  const finish = (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'connect') {
      d.line?.remove();
      const pt = toModel(ev);
      const to = elementAt(pt);
      if (!to) return say('Let go on an element to connect to it.');
      connect(tool.type, d.from, to, d.start);
      return;
    }
    if (d.mode === 'move' && d.snapped) {
      const parent = containerFor(d.e);
      d.e.parent = parent;
    }
    if (d.snapped) changed();
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', () => { drag?.line?.remove(); drag = null; draw(); });
  svg.addEventListener('dblclick', (ev) => {
    const pt = toModel(ev);
    const handle = ev.target.closest?.('[data-handle]')?.dataset.handle;
    if (handle?.startsWith('way:') && selected?.kind === 'connector') {
      snapshot();
      model.connectors.find((q) => q.id === selected.id).waypoints.splice(Number(handle.slice(4)), 1);
      return changed();
    }
    const hit = ev.target.closest?.('[data-uml-id]');
    if (hit?.dataset.umlKind === 'connector') {
      const c = model.connectors.find((q) => q.id === hit.dataset.umlId);
      if (!c || CONNECTORS[c.type]?.message) return;
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
    if (hit?.dataset.umlKind === 'element') focusName();
  });
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
  root.addEventListener('keydown', (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); stepHistory(ev.shiftKey ? redo : undo, ev.shiftKey ? undo : redo); }
    else if (mod && ev.key.toLowerCase() === 'y' && !typing) { ev.preventDefault(); stepHistory(redo, undo); }
    else if ((ev.key === 'Delete' || ev.key === 'Backspace') && !typing && selected) { ev.preventDefault(); removeSelected(); }
    else if (ev.key === 'Escape' && !typing) { if (tool.kind !== 'select') { ev.preventDefault(); ev.stopPropagation(); setTool({ kind: 'select' }); } else if (selected) { ev.preventDefault(); ev.stopPropagation(); selected = null; changed(); } }
    else if (!typing && !mod && (ev.key === '+' || ev.key === '=')) zoom(1 / 1.25);
    else if (!typing && !mod && ev.key === '-') zoom(1.25);
  });

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
      out.push(field('Name', name), field('Title', title), make('label', { className: 'uml-check' }, badge, ' Show the UML badge on the note'),
        make('p', { className: 'uml-hint', textContent: 'Pick an element on the left and tap the canvas to place it; pick a connector and drag between two elements. Drag to move, the corner to resize, the empty canvas to pan; double-click a line to bend it.' }));
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
      out.push(make('div', { className: 'uml-row' }, swap, straight));
    }
    panel.replaceChildren(...out);
  }
  function focusName() {
    requestAnimationFrame(() => { const n = panel.querySelector('.uml-name'); n?.focus(); n?.select?.(); });
  }

  // --- Bar ----------------------------------------------------------------------------
  kindSelect.onchange = () => {
    if (kindSelect.value === model.diagram) return;
    snapshot();
    // An empty diagram starts from the example of the new kind; one with work keeps it.
    if (!model.elements.length) setModel({ ...starterModel(kindSelect.value), name: model.name });
    else { model.diagram = kindSelect.value; buildPalette(); changed(); }
  };
  undoBtn.onclick = () => stepHistory(undo, redo);
  redoBtn.onclick = () => stepHistory(redo, undo);
  delBtn.onclick = removeSelected;
  zoomIn.onclick = () => zoom(1 / 1.25);
  zoomOut.onclick = () => zoom(1.25);
  fitBtn.onclick = fit;
  importBtn.onclick = () => importInput.click();
  importInput.onchange = async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const next = importUml(await file.text());
      snapshot();
      setModel(next);
      say(`Opened ${file.name}: ${model.elements.length} elements, ${model.connectors.length} connectors.`);
    } catch (e) { say(e.message, true); }
  };
  exportSelect.onchange = async () => {
    const what = exportSelect.value;
    exportSelect.value = '';
    try {
      if (what === 'vp') await download(exportVp(model), fileName(model, 'xml'), 'application/xml');
      else if (what === 'xmi') await download(exportXmi(model), fileName(model, 'xmi'), 'application/xml');
      else if (what === 'svg') await download(renderUml(model).svg, fileName(model, 'svg'), 'image/svg+xml');
      else if (what === 'png') await download(await umlPng(model), fileName(model, 'png'), 'image/png');
      else if (what === 'json') await download(JSON.stringify(model, null, 2), fileName(model, 'json'), 'application/json');
      if (what) say('Exported.');
    } catch (e) { say(e.message, true); }
  };
  if (applyBtn) applyBtn.onclick = () => onApply(normalizeModel(model));
  if (cancelBtn) cancelBtn.onclick = () => onCancel();

  // The canvas gets its size once laid out (and again when the window changes): fit again
  // until the view has been moved by hand.
  const resize = new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return; if (viewMoved) applyView(); else fit(); });
  resize.observe(canvas);
  buildPalette();
  changed();
  requestAnimationFrame(fit);
  return {
    model: () => normalizeModel(model),
    set: (m) => setModel(m),
    select: (id) => { const e = model.elements.find((q) => q.id === id); selected = e ? { kind: 'element', id } : null; changed(); },
    destroy: () => { resize.disconnect(); root.replaceChildren(); },
  };
}

// The editor over a note, full-window. Resolves with the new model, or null.
export function openUmlEditor(model, { editing = false } = {}) {
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
    const editor = mountUmlEditor(host, model, { onApply: (m) => finish(m), onCancel: () => finish(null), applyLabel: editing ? 'Apply' : 'Insert' });
  });
}
