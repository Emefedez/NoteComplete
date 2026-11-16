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
  { id: 'graph', kind: 'graph', label: 'Function graph', hint: 'Axes and a grid, with functions of x', icon: 'graph' },
  {
    id: 'histogram', kind: 'prefab', label: 'Histogram', hint: 'Frequencies of intervals, bars touching', icon: 'graph',
    spec: { type: 'histogram', title: 'Histogram', xLabel: 'Interval', yLabel: 'Frequency', bins: [{ label: '0-10', value: 3 }, { label: '10-20', value: 7 }, { label: '20-30', value: 5 }, { label: '30-40', value: 2 }] },
  },
  {
    id: 'bar', kind: 'prefab', label: 'Bar chart', hint: 'Separate bars for categories', icon: 'graph',
    spec: { type: 'bar', title: 'Bar chart', xLabel: '', yLabel: 'Value', bins: [{ label: 'A', value: 4 }, { label: 'B', value: 6 }, { label: 'C', value: 3 }] },
  },
  {
    id: 'states', kind: 'prefab', label: 'Process states', hint: 'Running, ready and blocked over time (scheduling)', icon: 'clock',
    spec: {
      type: 'states', title: 'FIFO', tStart: 0, tEnd: 30, tStep: 5, unit: 'u.t.', legend: { run: 'Running', ready: 'Ready', blocked: 'Blocked' },
      processes: [
        { label: 'A', arrival: 0, segments: [{ state: 'run', start: 0, end: 10 }, { state: 'blocked', start: 10, end: 20 }, { state: 'run', start: 20, end: 25 }] },
        { label: 'B', arrival: 5, segments: [{ state: 'ready', start: 5, end: 10 }, { state: 'run', start: 10, end: 20 }] },
      ],
    },
  },
  {
    id: 'timeline', kind: 'prefab', label: 'CPU timeline', hint: 'Gantt chart of what runs on each row', icon: 'monitor',
    spec: { type: 'timeline', title: 'CPU (RR q=2)', tStart: 0, tEnd: 10, tStep: 1, unit: 'ms', rows: [{ label: 'CPU', intervals: [{ label: 'P1', start: 0, end: 2 }, { label: 'P2', start: 2, end: 4 }, { label: 'P1', start: 4, end: 6 }, { label: 'P3', start: 6, end: 9 }] }] },
  },
  {
    id: 'tree', kind: 'prefab', label: 'Tree or node graph', hint: 'Nodes and edges: trees, automata, graphs', icon: 'share',
    spec: { type: 'tree', directed: true, nodes: [{ id: 'A', label: '10' }, { id: 'B', label: '5' }, { id: 'C', label: '15' }], edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }] },
  },
  {
    id: 'plot', kind: 'prefab', label: 'Exam plot', hint: 'A plot as exams draw it: curves, points and shaded areas', icon: 'graph',
    spec: { type: 'plot', title: 'f(x)', xMin: -4, xMax: 4, yMin: -2, yMax: 6, functions: [{ expr: 'x^2 - 1', label: 'f(x)' }], points: [{ x: 0, y: -1, label: '(0,-1)' }] },
  },
  { id: 'table', kind: 'table', label: 'Table', hint: 'Rows and columns of typed cells', icon: 'table' },
  ...Object.entries(DIAGRAMS).map(([diagram, d]) => ({ id: `uml-${diagram}`, kind: 'uml', label: `UML ${d.label.replace(/ diagram$/, '').toLowerCase()}`, hint: `${d.label}, as in Visual Paradigm: opens the diagram editor`, icon: 'uml', spec: starterModel(diagram) })),
];

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

// The prefab picker: one card per prefab, with a small preview. Resolves with the chosen
// PREFABS entry, or null.
export function choosePrefab() {
  return new Promise((resolve) => {
    const { dialog, body, cancel, apply } = shell('Insert prefab', 'Insert');
    apply.hidden = true;
    const grid = make('div', { className: 'prefab-grid', role: 'list' });
    const finish = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    for (const p of PREFABS) {
      const card = make('button', { type: 'button', className: 'prefab-card', title: p.hint, onclick: () => finish(p) });
      card.setAttribute('role', 'listitem');
      const svg = p.spec && prefabSvg(p.spec)?.svg;
      card.append(svg ? previewOf(svg) : make('div', { className: 'prefab-preview prefab-icon' }, icon(p.icon)), make('strong', { textContent: p.label }), make('span', { textContent: p.hint }));
      grid.append(card);
    }
    body.append(grid);
    cancel.onclick = () => finish(null);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dialog.showModal();
    grid.querySelector('button')?.focus();
  });
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
    const preview = make('div', { className: 'compound-preview-box' });
    body.append(
      make('label', { className: 'prefab-title' }, 'Title ', titleInput),
      make('label', {}, blankInput, ' Empty, for students to fill in'),
      make('details', { className: 'prefab-help', open: !editing }, make('summary', { textContent: 'Data' }),
        make('p', { textContent: 'Change the values, labels and ranges below; the preview follows. Lists: bins (histogram, bar chart), processes with segments run, ready or blocked (process states), rows with intervals (CPU timeline), nodes and edges (tree), functions, points and areas (exam plot).' }),
        text),
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
        error.textContent = e instanceof SyntaxError ? `Data: ${e.message}` : e.message;
        apply.disabled = true;
      }
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
