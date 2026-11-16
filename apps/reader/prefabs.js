// Prefabs: ready-made figures to put on a page (Insert → Insert prefab, Shift X, or the Shapes
// tool's prefab box). A function graph and a table are the editable ink objects of graph.js and
// table.js; the exam figures (histogram, bar chart, process states, CPU timeline, tree, plot)
// are drawn by exam-html.js, as in generated exams, and placed as a picture with a frame that
// keeps what they are (part.rs, kind "prefab"), so they can be edited again like a graph.
import { renderVisualSvg, normalizeVisualSpec } from './exam-html.js';
import { icon } from './icons.js';
import { DIAGRAMS, renderUml, starterModel, umlName } from './uml.js';

// What each prefab starts as. `kind`: "graph" and "table" open their own editors; "prefab"
// is an exam figure, described by `spec` (the exam visual spec); "uml" a UML diagram (uml.js),
// edited in the diagram editor (uml-editor.js) and kept as a prefab whose spec has type "uml".
export const PREFABS = [
  { id: 'graph', kind: 'graph', group: 'basic', label: 'Function graph', hint: 'Axes and a grid, with functions of x', icon: 'graph' },
  { id: 'table', kind: 'table', group: 'basic', label: 'Table', hint: 'Rows and columns of typed cells, with headers; edit cells in place later', icon: 'table' },
  {
    id: 'histogram', kind: 'prefab', group: 'exam', label: 'Histogram', hint: 'Frequencies of intervals, bars touching', icon: 'graph',
    spec: { type: 'histogram', title: 'Histogram', xLabel: 'Interval', yLabel: 'Frequency', bins: [{ label: '0-10', value: 3 }, { label: '10-20', value: 7 }, { label: '20-30', value: 5 }, { label: '30-40', value: 2 }] },
  },
  {
    id: 'bar', kind: 'prefab', group: 'exam', label: 'Bar chart', hint: 'Separate bars for categories', icon: 'graph',
    spec: { type: 'bar', title: 'Bar chart', xLabel: '', yLabel: 'Value', bins: [{ label: 'A', value: 4 }, { label: 'B', value: 6 }, { label: 'C', value: 3 }] },
  },
  {
    id: 'states', kind: 'prefab', group: 'exam', label: 'Process states', hint: 'Running, ready and blocked over time (scheduling)', icon: 'clock',
    spec: {
      type: 'states', title: 'FIFO', tStart: 0, tEnd: 30, tStep: 5, unit: 'u.t.', legend: { run: 'Running', ready: 'Ready', blocked: 'Blocked' },
      processes: [
        { label: 'A', arrival: 0, segments: [{ state: 'run', start: 0, end: 10 }, { state: 'blocked', start: 10, end: 20 }, { state: 'run', start: 20, end: 25 }] },
        { label: 'B', arrival: 5, segments: [{ state: 'ready', start: 5, end: 10 }, { state: 'run', start: 10, end: 20 }] },
      ],
    },
  },
  {
    id: 'timeline', kind: 'prefab', group: 'exam', label: 'CPU timeline', hint: 'Gantt chart of what runs on each row', icon: 'monitor',
    spec: { type: 'timeline', title: 'CPU (RR q=2)', tStart: 0, tEnd: 10, tStep: 1, unit: 'ms', rows: [{ label: 'CPU', intervals: [{ label: 'P1', start: 0, end: 2 }, { label: 'P2', start: 2, end: 4 }, { label: 'P1', start: 4, end: 6 }, { label: 'P3', start: 6, end: 9 }] }] },
  },
  // Drawn in the diagram editor: nodes, and arrows dragged from one to another.
  { id: 'tree', kind: 'uml', group: 'diagram', label: 'Tree or node graph', hint: 'Nodes and arrows: trees, automata, graphs. Drag from a node to connect or grow it', icon: 'share', spec: starterModel('graph') },
  {
    id: 'plot', kind: 'prefab', group: 'exam', label: 'Exam plot', hint: 'A plot as exams draw it: curves, points and shaded areas', icon: 'graph',
    spec: { type: 'plot', title: 'f(x)', xMin: -4, xMax: 4, yMin: -2, yMax: 6, functions: [{ expr: 'x^2 - 1', label: 'f(x)' }], points: [{ x: 0, y: -1, label: '(0,-1)' }] },
  },
  ...Object.entries(DIAGRAMS).filter(([, d]) => !d.notUml).map(([diagram, d]) => ({ id: `uml-${diagram}`, kind: 'uml', group: 'diagram', label: `UML ${d.label.replace(/ diagram$/, '').toLowerCase()}`, hint: `${d.label}, as in Visual Paradigm: opens the diagram editor`, icon: 'uml', spec: starterModel(diagram) })),
];

// The picker's groups, in order.
export const PREFAB_GROUPS = [['basic', 'Tables and graphs'], ['exam', 'Exam figures'], ['diagram', 'Diagrams']];

// The prefabs used last (ids, newest first): the picker shows them first, and the page's
// menu offers them beside Insert prefab.
const RECENT_KEY = 'notecomplete-prefab-recent';
export function recentPrefabs(limit = 5) {
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { /* Optional. */ }
  return (Array.isArray(ids) ? ids : []).map((id) => PREFABS.find((p) => p.id === id)).filter(Boolean).slice(0, limit);
}
export function notePrefabUsed(id) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentPrefabs(12).map((p) => p.id).filter((q) => q !== id)].slice(0, 12))); } catch { /* Optional. */ }
}

const NAMES = { plot: 'Exam plot', histogram: 'Histogram', states: 'Process states', timeline: 'CPU timeline', tree: 'Tree or node graph', graph_nodes: 'Tree or node graph' };
// The name of a prefab's figure, for menus ("Histogram").
export function prefabName(spec) {
  if (spec?.type === 'uml') return umlName(spec);
  const s = normalizeVisualSpec(spec);
  if (s?.type === 'histogram' && !s.contiguous) return 'Bar chart';
  return NAMES[s?.type] || 'Prefab';
}

// The figure as SVG text with its size, or null when the spec draws nothing.
export function prefabSvg(spec) {
  if (spec?.type === 'uml') return renderUml(spec);
  const out = renderVisualSvg(spec, { forMcp: false });
  return out?.svg ? out : null;
}

const make = (tag, props = {}, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
};
function shell(title, actionLabel) {
  const dialog = make('dialog', { className: 'ocr-dialog compound-dialog prefab-dialog' });
  const body = make('div', { className: 'compound-body' });
  const error = make('p', { className: 'compound-error', role: 'status' });
  const cancel = make('button', { type: 'button', textContent: 'Cancel' });
  const apply = make('button', { type: 'button', className: 'primary', textContent: actionLabel });
  dialog.append(make('h2', { textContent: title }), body, error, make('div', { className: 'ocr-actions' }, cancel, apply));
  dialog.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dialog);
  return { dialog, body, error, cancel, apply };
}
const previewOf = (svgText) => {
  const box = make('div', { className: 'prefab-preview' });
  box.innerHTML = svgText;
  return box;
};

// The prefab picker, as the other big dialogs (AI exam, quizzes): a search, the groups as
// pills, the list on the left and a large preview of the one pointed at on the right. The
// ones used last come first. Resolves with the chosen PREFABS entry, or null.
export function choosePrefab() {
  return new Promise((resolve) => {
    const dialog = make('dialog', { className: 'ocr-dialog prefab-dialog prefab-picker' });
    dialog.setAttribute('aria-label', 'Insert prefab');
    const close = make('button', { type: 'button', className: 'dlg-close', title: 'Close' }, icon('close'));
    close.setAttribute('aria-label', 'Close');
    const search = make('input', { type: 'search', className: 'prefab-search', placeholder: 'Search: table, histogram, CPU, UML class…', spellcheck: false, autocomplete: 'off' });
    search.setAttribute('aria-label', 'Search prefabs');
    const pills = make('div', { className: 'expand-mode-pills', role: 'group' });
    pills.setAttribute('aria-label', 'Groups');
    let group = '';
    for (const [id, label] of [['', 'All'], ...PREFAB_GROUPS]) {
      const b = make('button', { type: 'button', textContent: label });
      b.dataset.group = id;
      b.setAttribute('aria-pressed', String(id === group));
      b.onclick = () => { group = id; for (const q of pills.children) q.setAttribute('aria-pressed', String(q.dataset.group === group)); list(); };
      pills.append(b);
    }
    const grid = make('div', { className: 'prefab-grid', role: 'listbox' });
    grid.setAttribute('aria-label', 'Prefabs');
    const big = make('div', { className: 'prefab-big' });
    const name = make('h3', { className: 'exam-sub' });
    const hint = make('p', { className: 'muted' });
    const cancel = make('button', { type: 'button', textContent: 'Cancel' });
    const apply = make('button', { type: 'button', className: 'primary', textContent: 'Insert' });
    dialog.append(
      make('div', { className: 'exam-dlg-head' }, make('h2', {}, icon('graph'), ' Insert prefab'), close),
      make('div', { className: 'prefab-filter' }, search, pills),
      make('div', { className: 'prefab-split' }, grid, make('section', { className: 'prefab-side' }, big, name, hint)),
      make('div', { className: 'ocr-actions' }, cancel, apply));
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(dialog);
    const previews = new Map();
    const thumb = (p) => {
      if (!previews.has(p.id)) previews.set(p.id, (p.spec && prefabSvg(p.spec)?.svg) || null);
      const svg = previews.get(p.id);
      return svg ? previewOf(svg) : make('div', { className: 'prefab-preview prefab-icon' }, icon(p.icon));
    };
    let active = null;
    const finish = (value) => { if (value) notePrefabUsed(value.id); dialog.close(); dialog.remove(); resolve(value); };
    function show(p) {
      active = p;
      for (const c of grid.querySelectorAll('.prefab-card')) c.setAttribute('aria-selected', String(c.dataset.id === p?.id));
      big.replaceChildren(...(p ? [thumb(p)] : []));
      name.textContent = p?.label || 'Nothing found';
      hint.textContent = p ? p.hint : 'Try another word, or All.';
      apply.disabled = !p;
    }
    const words = (p) => `${p.label} ${p.hint} ${PREFAB_GROUPS.find(([g]) => g === p.group)?.[1] || ''} ${p.id}`.toLowerCase();
    function list() {
      const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const found = PREFABS.filter((p) => (!group || p.group === group) && q.every((w) => words(p).includes(w)));
      const card = (p) => {
        const c = make('button', { type: 'button', className: 'prefab-card', title: p.hint, onclick: () => finish(p) }, thumb(p), make('strong', { textContent: p.label }), make('span', { textContent: p.hint }));
        c.dataset.id = p.id;
        c.setAttribute('role', 'option');
        c.onmouseenter = () => show(p);
        c.onfocus = () => show(p);
        return c;
      };
      const out = [];
      const recent = !q.length && !group ? recentPrefabs(4) : [];
      if (recent.length) out.push(make('h4', { textContent: 'Recently used' }), ...recent.map(card));
      for (const [g, label] of PREFAB_GROUPS) {
        const items = found.filter((p) => p.group === g);
        if (items.length) out.push(make('h4', { textContent: label }), ...items.map(card));
      }
      grid.replaceChildren(...out);
      show(found.includes(active) ? active : recent[0] || found[0] || null);
    }
    // Arrows move through the list from the search; Enter inserts the one shown.
    const move = (d) => {
      const cards = [...grid.querySelectorAll('.prefab-card')];
      const at = cards.findIndex((c) => c.dataset.id === active?.id);
      const next = cards[Math.max(0, Math.min(cards.length - 1, at + d))];
      if (next) { show(PREFABS.find((p) => p.id === next.dataset.id)); next.scrollIntoView({ block: 'nearest' }); }
    };
    search.addEventListener('input', list);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter' && active) { e.preventDefault(); finish(active); }
    });
    apply.onclick = () => active && finish(active);
    cancel.onclick = close.onclick = () => finish(null);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    list();
    dialog.showModal();
    search.focus();
  });
}

// Where JSON.parse stopped: { line, column, index, message } (1-based line and column), from
// the error's own words ("at position 42", or "line 3 column 5"), or the end of the text.
export function jsonErrorAt(text, error) {
  const msg = String(error?.message || error || '');
  let index = null;
  const lc = msg.match(/line (\d+) column (\d+)/i);
  if (lc) {
    const lines = text.split('\n');
    index = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lc[2]) - 1;
  } else {
    const pos = msg.match(/position (\d+)/i);
    index = pos ? Number(pos[1]) : /end of (JSON|data)|unterminated|unexpected end/i.test(msg) ? text.length : null;
  }
  if (index === null) return { line: null, column: null, index: null, message: msg };
  index = Math.max(0, Math.min(text.length, index));
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n');
  // The reason without where (that is said separately), and without the text quoted back.
  const reason = msg.replace(/\s*\(line \d+ column \d+\)/i, '').replace(/\s*(in JSON )?at position \d+.*$/i, '').replace(/,\s*".*$/s, '').replace(/^JSON\.parse:\s*/i, '');
  return { line, column, index, message: reason || 'Not valid JSON' };
}

// A JSON text box with line numbers, and the line of an error marked behind its text.
function codeBox(textarea) {
  const gutter = make('pre', { className: 'json-gutter' });
  gutter.setAttribute('aria-hidden', 'true');
  const back = make('pre', { className: 'json-back' });
  back.setAttribute('aria-hidden', 'true');
  const box = make('div', { className: 'json-code' }, gutter, make('div', { className: 'json-edit' }, back, textarea));
  let bad = null;
  const paint = () => {
    const lines = textarea.value.split('\n');
    gutter.textContent = lines.map((_, i) => i + 1).join('\n');
    back.replaceChildren(...lines.map((l, i) => make('span', { className: i + 1 === bad ? 'json-bad' : '', textContent: `${l}\n` })));
    gutter.scrollTop = back.scrollTop = textarea.scrollTop;
    back.scrollLeft = textarea.scrollLeft;
  };
  textarea.addEventListener('input', paint);
  textarea.addEventListener('scroll', () => { gutter.scrollTop = back.scrollTop = textarea.scrollTop; back.scrollLeft = textarea.scrollLeft; });
  paint();
  return {
    box,
    mark(line) { bad = line; paint(); box.classList.toggle('has-error', !!line); },
    // Puts the caret where the error is, with its line in view.
    go(index) {
      textarea.focus();
      textarea.setSelectionRange(index, Math.min(textarea.value.length, index + 1));
      const line = textarea.value.slice(0, index).split('\n').length;
      const h = parseFloat(getComputedStyle(textarea).lineHeight) || 17;
      textarea.scrollTop = Math.max(0, (line - 3) * h);
    },
  };
}

// The editor of an exam figure: its title, empty (for students to fill in) or not, and its
// data as JSON, with a live preview. Resolves with the new spec, or null.
export function editPrefab({ spec, editing = false } = {}) {
  return new Promise((resolve) => {
    const { dialog, body, error, cancel, apply } = shell(editing ? `Edit ${prefabName(spec).toLowerCase()}` : `Insert ${prefabName(spec).toLowerCase()}`, editing ? 'Apply' : 'Insert');
    const { title = '', blank = false, ...data } = spec || {};
    const titleInput = make('input', { type: 'text', value: title, placeholder: 'Title (optional)' });
    titleInput.setAttribute('aria-label', 'Title');
    const blankInput = make('input', { type: 'checkbox', checked: Boolean(blank) });
    const text = make('textarea', { className: 'prefab-data', spellcheck: false, rows: 12, value: JSON.stringify(data, null, 2) });
    text.setAttribute('aria-label', 'Data (JSON)');
    text.wrap = 'off';
    const code = codeBox(text);
    const preview = make('div', { className: 'compound-preview-box' });
    body.append(
      make('label', { className: 'prefab-title' }, 'Title ', titleInput),
      make('label', {}, blankInput, ' Empty, for students to fill in'),
      make('details', { className: 'prefab-help', open: !editing }, make('summary', { textContent: 'Data' }),
        make('p', { textContent: 'Change the values, labels and ranges below; the preview follows. Lists: bins (histogram, bar chart), processes with segments run, ready or blocked (process states), rows with intervals (CPU timeline), nodes and edges (tree), functions, points and areas (exam plot).' }),
        code.box),
      preview);
    let value = null;
    function read() {
      const parsed = JSON.parse(text.value || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('The data must be one JSON object, in braces.');
      return { ...parsed, type: parsed.type || data.type, title: titleInput.value.trim(), blank: blankInput.checked };
    }
    function refresh() {
      try {
        value = read();
        const out = prefabSvg(value);
        if (!out) throw Error('Nothing to draw: check the lists in the data.');
        preview.replaceChildren(previewOf(out.svg));
        error.textContent = '';
        apply.disabled = false;
      } catch (e) {
        if (e instanceof SyntaxError) {
          // Says where, marks that line, and a click on the message goes there.
          const at = jsonErrorAt(text.value, e);
          code.mark(at.line);
          error.replaceChildren(at.line ? make('button', { type: 'button', className: 'json-goto', title: 'Go to the error', textContent: `Line ${at.line}, column ${at.column}`, onclick: () => code.go(at.index) }) : '', ` ${at.line ? '' : 'Data: '}${at.message}.`);
        } else { code.mark(null); error.textContent = e.message; }
        apply.disabled = true;
        return;
      }
      code.mark(null);
    }
    for (const el of [titleInput, blankInput, text]) el.addEventListener('input', refresh);
    refresh();
    const finish = (result) => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.onclick = () => finish(null);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    apply.onclick = () => { if (!apply.disabled) finish(value); };
    dialog.showModal();
    titleInput.focus();
  });
}

// The figure as a PNG `[w, h]` page units drawn at `scale` pixels per unit, for an image item.
export async function prefabPng(spec, size, scale = 3) {
  const out = prefabSvg(spec);
  if (!out) throw Error('Nothing to draw.');
  const img = new Image();
  // As a picture it has no page styles: its text takes a sans font, as in the exam pages.
  const svg = out.svg.replace('<svg ', '<svg font-family="Helvetica, Arial, sans-serif" ');
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  try {
    canvas.width = Math.max(1, Math.round(size[0] * scale));
    canvas.height = Math.max(1, Math.round(size[1] * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Could not draw the prefab.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/png');
    if (!url.startsWith('data:image/png;base64,')) throw Error('This prefab is too large for this device.');
    return { base64: url.split(',')[1], mime: 'image/png' };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

// The aspect (height / width) the figure is drawn at.
export function prefabAspect(spec) {
  const out = prefabSvg(spec);
  return out?.width && out?.height ? out.height / out.width : 0.5;
}

// `box`: [x, y, w, h] on the page; `png`: prefabPng(). Returns { lines, images } for drawMany:
// a frame that keeps the spec (invisible under the picture) and the picture, parts of `id`.
export function prefabItems(box, spec, png, { layer = 0, id = `p${Date.now().toString(36)}` } = {}) {
  const [x, y, w, h] = box;
  const frame = { points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], width: 0.5, rgba: [0.8, 0.84, 0.9, 1], tool: 0, layer, shape: { kind: 'rectangle', start: [x, y], end: [x + w, y + h] }, part: { id, kind: 'prefab', spec: JSON.stringify(spec) } };
  const picture = { base64: png.base64, mime: png.mime, bounds: [x, y, w, h], layer, part: { id, kind: 'prefab' } };
  return { lines: [frame], images: [picture] };
}
