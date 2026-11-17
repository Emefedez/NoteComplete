// The chart editor: process-state diagrams and CPU timelines painted cell by cell, bar charts
// and histograms with bars dragged to their value, and exam plots from a form, each with the
// figure as it will look on the page beside it. The same editor runs on its own page
// (charts.html) and in a full-window dialog over a note (openChartEditor), as the UML editor.
//
// An exercise keeps the solution in the figure and the student's answer beside it
// (chart-model.js). "Fill in" mode paints the answer over the solution's rows and times, which
// cannot be changed; Check marks what is wrong and Show solution draws it under the answer.
import { renderVisualSvg } from './exam-html.js';
import { sortable } from './reorder.js';
import { orderedIds, saveOrder, keyFor, indexOfKey } from './palette-order.js';
import { editorQuickMenu } from './editor-quick.js';
import { icon } from './icons.js';
import { codeBox, jsonErrorAt } from './json-code.js';
import { STATES, triOf, editorKind, canBeExercise, gridOf, rowsData, withGrid, labelsOf, resample, barsOf, emptyAnswer, answerGrid, displaySpec, checkAnswer } from './chart-model.js';

// Whether a pen is used on this device (kept): then fingers scroll and zoom in the editors.
const PEN_KEY = 'notecomplete-pen-seen';
const coarse = () => !!globalThis.matchMedia?.('(pointer: coarse)').matches;
let penUsed = false;
try { penUsed = localStorage.getItem(PEN_KEY) === '1'; } catch { /* Not kept. */ }
globalThis.addEventListener?.('pointerdown', (e) => {
  if (e.pointerType !== 'pen' || penUsed) return;
  penUsed = true;
  try { localStorage.setItem(PEN_KEY, '1'); } catch { /* Not kept. */ }
}, { capture: true, passive: true });
const SVG = 'http://www.w3.org/2000/svg';
const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
};
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
// A button with an icon, and its words beside it unless `iconOnly`.
const button = (name, label, title, { iconOnly = false, className = '' } = {}) => {
  const b = make('button', { type: 'button', title, className: `${className} ${iconOnly ? 'ch-icon' : 'ch-labeled'}`.trim() }, icon(name), !iconOnly && make('span', { textContent: label }));
  b.setAttribute('aria-label', label);
  return b;
};
// The figure as it will look on the page: shown or folded away, and how tall (this device).
const PREVIEW_KEY = 'notecomplete.chart.preview';
const previewPrefs = () => { try { return { open: false, height: 220, ...JSON.parse(localStorage.getItem(PREVIEW_KEY) || '{}') }; } catch { return { open: false, height: 220 }; } };
const savePreview = (prefs) => { try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(prefs)); } catch { /* Not kept. */ } };
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));
export const STATE_NAMES = { run: 'Running', ready: 'Ready', blocked: 'Blocked' };
const STATE_COLORS = { run: '#2563eb', ready: '#16a34a', blocked: '#dc2626' };
const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4f46e5'];
// A timeline label's colour, as exam-html.js draws it.
function labelColor(label, order) {
  const key = String(label || '').toUpperCase().trim();
  if (/^(IDLE|WAIT|WAITING|STALL|ESPERA|LISTO|READY|BLOQ(UEADO)?|BLOCKED|-)$/.test(key)) return '#94a3b8';
  if (/^(CPU|EJEC(UCI[OÓ]N)?|RUN(NING)?)$/.test(key)) return '#2563eb';
  if (/^(E\/S|I\/O|IO|ES|DISCO|DISK|IMPRESORA|PRINTER)\d*$/.test(key)) return '#f59e0b';
  const i = order.indexOf(label);
  return PALETTE[(i < 0 ? order.length : i) % PALETTE.length];
}
const KIND_NAMES = { states: 'Process states', timeline: 'CPU timeline', bars: 'Chart', plot: 'Exam plot' };
export function chartName(spec) {
  const k = editorKind(spec);
  if (k === 'bars') return String(spec.type).toLowerCase() === 'histogram' || spec.contiguous === true ? 'Histogram' : 'Bar chart';
  return KIND_NAMES[k] || 'Chart';
}

// Loads chart-editor.css once (the reader's own page does not carry it).
function ensureStyles() {
  if (document.querySelector('link[data-chart-css]')) return;
  const link = make('link', { rel: 'stylesheet', href: new URL('./chart-editor.css', import.meta.url).href });
  link.dataset.chartCss = '';
  document.head.append(link);
}

// Mounts the editor in `root` for `spec` (an exam visual spec of a kind editorKind knows).
// `mode`: 'author' edits the figure (the solution of an exercise); 'answer' fills an exercise
// in. Returns { spec(), set(spec), mode(), destroy() }.
// `references`: [{ name, src, kind: 'image' | 'pdf' }] shown beside the canvas while filling
// in (the exercise's page, snippets kept from the Grab tool); `onReference(ref)` hears of one
// added here, so it can be offered again.
export function mountChartEditor(root, initial, { mode: startMode = 'author', onApply = null, onCancel = null, onChange = null, applyLabel = 'Apply', extraBar = [], references = [], onReference = null, notePages = null, recentNotes = null } = {}) {
  ensureStyles();
  let base, kind, grid, bars, ans, mode, brush, check = null, showSolution = false;
  const undo = [], redo = [];
  let lastSnap = { key: '', at: 0 };

  function load(spec, m = startMode) {
    base = clone(spec);
    kind = editorKind(base);
    root.dataset.kind = kind || '';
    grid = kind === 'states' || kind === 'timeline' ? gridOf(base) : null;
    bars = kind === 'bars' ? barsOf(base) : null;
    // Filling in a figure that is not an exercise yet makes it one: the figure is the
    // solution, and the answer starts empty.
    if (m === 'answer' && !base.exercise && canBeExercise(base)) base.exercise = true;
    mode = m === 'json' ? 'json' : m === 'answer' && base.exercise && canBeExercise(base) ? 'answer' : 'author';
    ans = null;
    if (base.exercise && canBeExercise(base)) ans = grid ? answerGrid(base) : barsOf(base.answer || emptyAnswer(base));
    brush = kind === 'states' ? 'run' : kind === 'timeline' ? (labelsOf(grid)[0] || 'P1') : null;
    check = null;
    showSolution = false;
  }
  // The spec as it stands: the solution's data, and the answer of an exercise.
  function current() {
    let out = grid ? withGrid(base, grid) : bars ? { ...base, bins: bars.map((b) => ({ ...b })) } : { ...base };
    if (bars) { delete out.bars; delete out.data; }
    if (out.exercise && canBeExercise(out)) {
      if (!ans) ans = grid ? answerGrid(out) : barsOf(emptyAnswer(out));
      out.answer = grid ? rowsData(ans) : { bins: ans.map((b) => ({ label: b.label, value: b.value })) };
    } else delete out.answer;
    return out;
  }
  function snapshot(key = '') {
    const now = Date.now();
    if (key && key === lastSnap.key && now - lastSnap.at < 1200) { lastSnap.at = now; return; }
    lastSnap = { key, at: now };
    undo.push(JSON.stringify({ spec: current(), mode }));
    if (undo.length > 200) undo.shift();
    redo.length = 0;
  }
  function restore(text) {
    const s = JSON.parse(text);
    const keepBrush = brush;
    load(s.spec, s.mode);
    if (kind === 'timeline' || kind === 'states') brush = keepBrush;
  }

  // --- Layout --------------------------------------------------------------------------
  root.classList.add('chart-editor');
  root.replaceChildren();
  const undoBtn = button('undo', 'Undo', 'Undo (Ctrl Z)', { iconOnly: true });
  const redoBtn = button('redo', 'Redo', 'Redo (Ctrl Y)', { iconOnly: true });
  const modeBox = make('div', { className: 'ch-mode', role: 'group' });
  modeBox.setAttribute('aria-label', 'What the editor shows');
  const authorBtn = button('draw', 'Editor', 'Edit the figure itself (for an exercise, the solution the answer is checked against)');
  const answerBtn = button('select', 'Fill in', 'Fill the exercise in, as a student: the rows and times stay as they are');
  const jsonBtn = button('hash', 'JSON', 'Edit the figure\'s data as JSON');
  modeBox.append(authorBtn, answerBtn, jsonBtn);
  const checkBtn = button('check', 'Check', 'Mark what is wrong in the answer');
  const solBtn = button('eye', 'Solution', 'Draw the solution under the answer');
  const clearBtn = button('trash', 'Clear all', 'Clear all: start the answer again');
  const spacer = make('span', { className: 'ch-spacer' });
  const cancelBtn = onCancel && button('close', 'Cancel', 'Close without changing the note (Esc)');
  const applyBtn = onApply && button('check', applyLabel, `${applyLabel} on the note`, { className: 'primary' });
  const bar = make('div', { className: 'ch-bar' }, ...extraBar, undoBtn, redoBtn, modeBox, checkBtn, solBtn, clearBtn, spacer, cancelBtn, applyBtn);
  const palette = make('div', { className: 'ch-palette', role: 'toolbar' });
  palette.setAttribute('aria-label', 'Brushes');
  const canvas = make('div', { className: 'ch-canvas', tabIndex: 0 });
  const jsonArea = make('textarea', { className: 'ch-json', spellcheck: false });
  jsonArea.setAttribute('aria-label', 'The figure as JSON');
  jsonArea.wrap = 'off';
  // Line numbers beside it, and the line of an error marked (json-code.js).
  const jsonCode = codeBox(jsonArea);
  jsonCode.box.classList.add('ch-json-box');
  const setJson = (text) => { jsonArea.value = text; jsonCode.mark(null); };
  const preview = make('div', { className: 'ch-preview' });
  // The figure as on the page: a panel under the canvas, folded with its arrow and as tall
  // as its top edge is dragged.
  const prefs = previewPrefs();
  const fold = make('button', { type: 'button', className: 'ch-fold', title: 'Show or hide the figure as it will look on the page' }, icon('arrowUp'), make('span', { textContent: 'On the page' }));
  const grip = make('div', { className: 'ch-grip-bar', title: 'Drag to make it taller or shorter' });
  // Notes beside it (N): Markdown kept with the figure (`notes`), not drawn on the page.
  const notesFold = make('button', { type: 'button', className: 'ch-fold ch-notes-fold', title: 'Notes on this figure, in Markdown, kept with it (N)' }, icon('note'), make('span', { textContent: 'Notes' }), make('kbd', { textContent: 'N' }));
  const notesPane = make('div', { className: 'ch-notes' });
  const boxHead = make('div', { className: 'ch-box-head' }, fold, notesFold);
  const boxBody = make('div', { className: 'ch-box-body' }, preview, notesPane);
  const previewBox = make('div', { className: 'ch-preview-box' }, grip, boxHead, boxBody);
  let notesEditor = null, notesLoading = null;
  async function showNotes() {
    if (notesEditor || notesLoading) return notesLoading;
    notesLoading = (async () => {
      try {
        const { loadEditor } = await import('./notes.js');
        const TinyMDE = await loadEditor();
        if (!root.isConnected || !prefs.notes) return;
        const host = make('div', { className: 'ch-notes-editor' });
        notesPane.replaceChildren(host);
        notesEditor = new TinyMDE.Editor({ element: host, content: base.notes || '', placeholder: 'Notes on this figure: what each process does, why it blocks… Markdown: # heading, **bold**, - list.' });
        notesEditor.addEventListener('change', (e) => {
          if ((base.notes || '') === e.content) return;
          if (e.content.trim()) base.notes = e.content; else delete base.notes;
          if (mode === 'json') setJson(JSON.stringify(current(), null, 2));
          onChange?.(current());
        });
      } catch {
        // Without the Markdown editor: a plain text box.
        const area = make('textarea', { className: 'ch-notes-plain', spellcheck: true, placeholder: 'Notes on this figure (Markdown)' });
        area.value = base.notes || '';
        area.oninput = () => { if (area.value.trim()) base.notes = area.value; else delete base.notes; onChange?.(current()); };
        notesPane.replaceChildren(area);
        notesEditor = { getContent: () => area.value, setContent: (v) => { area.value = v; } };
      } finally { notesLoading = null; }
    })();
    return notesLoading;
  }
  function toggleNotes(open = !prefs.notes) {
    prefs.notes = open;
    savePreview(prefs);
    layoutPreview();
    if (open) showNotes().then(() => notesPane.querySelector('.TinyMDE, textarea')?.focus());
    else { notesEditor = null; notesPane.replaceChildren(); }
    draw();
  }
  notesFold.onclick = () => toggleNotes();
  const panel = make('div', { className: 'ch-panel' });
  // What to look at while filling in: the exercise's page, kept snippets, a picture or PDF.
  const refs = [...references];
  const refList = make('div', { className: 'ch-refs' });
  const NOTE_EXT = /\.(noteful|nfedit|notecomp(lete)?|notepart)$/i;
  const refFile = make('input', { type: 'file', accept: `image/*,application/pdf,.pdf${notePages ? ',.noteful,.nfedit,.notecomp,.notecomplete' : ''}`, multiple: true, hidden: true });
  const refAdd = button('image', notePages ? 'Picture, PDF or note…' : 'Picture or PDF…', 'Open a picture, a PDF or a note to look at while drawing or filling in (or paste a snippet: Ctrl V)');
  refAdd.onclick = () => refFile.click();
  const addRef = (ref) => { refs.push(ref); onReference?.(ref); buildRefs(); };
  // A note's pages come from the app (its engine draws them); shown as pages like a PDF.
  const addNote = async (name, read) => {
    const ref = { name, kind: 'pages', pages: null };
    addRef(ref);
    try { Object.assign(ref, await read()); } catch (e) { ref.error = e?.message || String(e); }
    buildRefs();
  };
  refFile.onchange = () => {
    for (const file of refFile.files) {
      if (notePages && NOTE_EXT.test(file.name)) addNote(file.name.replace(NOTE_EXT, ''), () => notePages(file));
      else addRef({ name: file.name, src: URL.createObjectURL(file), kind: file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : 'image' });
    }
    refFile.value = '';
  };
  // Recent notes, to look at one while drawing: a plain list (a native select works with a finger).
  const refRecent = recentNotes ? make('select', { className: 'ch-ref-recent', title: 'Look at a recent note' }) : null;
  if (refRecent) {
    let listed = [];
    const fill = async () => {
      listed = await recentNotes().catch(() => []);
      refRecent.replaceChildren(make('option', { value: '', textContent: listed.length ? 'A recent note…' : 'No recent notes' }), ...listed.map((n, i) => make('option', { value: String(i), textContent: n.title })));
    };
    fill();
    refRecent.onchange = () => {
      const n = listed[Number(refRecent.value)];
      refRecent.value = '';
      if (n) addNote(n.title, () => n.open());
    };
  }
  // PDFs as page pictures (pdf.js): an iframe showed nothing on iPad and little elsewhere.
  async function pdfPages(r) {
    const { openPdf } = await import('./pdf-background.js');
    const bytes = new Uint8Array(await (await fetch(r.src)).arrayBuffer());
    const pdf = await openPdf(bytes);
    const pages = [];
    try {
      for (let n = 1; n <= Math.min(pdf.numPages, 30); n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1400 / base.width) });
        const c = document.createElement('canvas');
        c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
        const ctx = c.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        page.cleanup();
        pages.push(c.toDataURL('image/jpeg', 0.85));
        c.width = c.height = 0;
      }
    } finally { pdf.destroy?.(); }
    return pages;
  }
  function refView(r) {
    if (r.kind === 'image') return make('img', { src: r.src, alt: r.name, className: 'ch-ref-img' });
    const box = make('div', { className: 'ch-ref-pages' });
    if (r.error) box.append(make('p', { className: 'ch-hint', textContent: `Could not show it: ${r.error}` }));
    else if (r.pages) box.append(...r.pages.map((src, n) => make('img', { src, alt: `${r.name}, page ${n + 1}`, className: 'ch-ref-img', loading: 'lazy' })));
    else {
      box.append(make('p', { className: 'ch-hint', textContent: 'Opening…' }));
      if (r.kind === 'pdf' && !r.loading) {
        r.loading = pdfPages(r).then((pages) => { r.pages = pages; }, (e) => { r.error = e?.message || String(e); }).finally(() => { if (root.isConnected) buildRefs(); });
      }
    }
    return box;
  }
  function buildRefs() {
    refList.replaceChildren(...refs.map((r, i) => {
      const remove = button('close', 'Remove', `Take ${r.name} away`, { iconOnly: true, className: 'ch-mini' });
      remove.onclick = () => { refs.splice(i, 1); buildRefs(); };
      return make('figure', { className: 'ch-ref' }, make('figcaption', {}, make('span', { textContent: r.name }), remove), refView(r));
    }));
    if (!refs.length) refList.append(make('p', { className: 'ch-hint', textContent: `Nothing to look at yet: open a picture, PDF${notePages ? ' or note' : ''}, or paste a snippet grabbed from a note (Grab tool → Keep for exercises, then Ctrl V here or it shows up on its own).` }));
  }
  const onPaste = (e) => {
    if (mode === 'json' || !root.isConnected) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    addRef({ name: 'Pasted snippet', src: URL.createObjectURL(file), kind: 'image' });
  };
  document.addEventListener('paste', onPaste, true);
  const status = make('div', { className: 'ch-status', role: 'status' });
  root.append(bar, make('div', { className: 'ch-main' }, palette, make('div', { className: 'ch-center' }, canvas, jsonCode.box, previewBox), panel), status);
  function layoutPreview() {
    // A plot has no canvas: its figure is the view, always shown.
    const open = kind === 'plot' || prefs.open, notes = !!prefs.notes && kind !== 'plot';
    previewBox.classList.toggle('open', open);
    previewBox.classList.toggle('notes-open', notes);
    previewBox.style.height = (open || notes) && kind !== 'plot' ? `${Math.max(90, prefs.height)}px` : '';
    fold.replaceChild(icon(open ? 'arrowDown' : 'arrowUp'), fold.firstChild);
    fold.setAttribute('aria-expanded', String(open));
    notesFold.setAttribute('aria-pressed', String(notes));
    notesFold.setAttribute('aria-expanded', String(notes));
    fold.hidden = grip.hidden = notesFold.hidden = kind === 'plot';
  }
  fold.onclick = () => { prefs.open = !prefs.open; savePreview(prefs); layoutPreview(); draw(); };
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY, h0 = previewBox.getBoundingClientRect().height;
    if (!prefs.open && !prefs.notes) { prefs.open = true; layoutPreview(); }
    try { grip.setPointerCapture(e.pointerId); } catch { /* A synthetic event. */ }
    const max = () => root.querySelector('.ch-center').getBoundingClientRect().height - 80;
    const move = (ev) => { prefs.height = Math.round(Math.max(90, Math.min(max(), h0 + (y0 - ev.clientY)))); layoutPreview(); };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); savePreview(prefs); draw(); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  function changed({ panel: rebuild = true, palette: repaint = false, json = true } = {}) {
    if (repaint) buildPalette();
    if (json && mode === 'json') setJson(JSON.stringify(current(), null, 2));
    draw();
    if (rebuild) buildPanel();
    updateButtons();
    onChange?.(current());
  }
  function updateButtons() {
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
    const ex = Boolean(base.exercise && canBeExercise(base));
    answerBtn.hidden = !ex;
    authorBtn.setAttribute('aria-pressed', String(mode === 'author'));
    answerBtn.setAttribute('aria-pressed', String(mode === 'answer'));
    jsonBtn.setAttribute('aria-pressed', String(mode === 'json'));
    checkBtn.hidden = solBtn.hidden = mode !== 'answer';
    // Clear all: the answer while filling in, what is painted or measured while editing.
    clearBtn.hidden = !(mode === 'answer' || (mode === 'author' && (grid || bars)));
    clearBtn.title = mode === 'answer' ? 'Clear all: start the answer again' : grid ? 'Clear all: every painted cell and end marker (the rows stay)' : 'Clear all: every bar back to 0 (the labels stay)';
    solBtn.replaceChild(icon(showSolution ? 'eyeOff' : 'eye'), solBtn.firstChild);
    solBtn.title = showSolution ? 'Hide the solution under the answer' : 'Draw the solution under the answer';
    solBtn.setAttribute('aria-pressed', String(showSolution));
    if (applyBtn) applyBtn.disabled = Boolean(jsonError);
    root.dataset.mode = mode;
  }
  function setMode(m) {
    if (mode === 'json' && jsonError) return say('Fix the JSON first: it is not a figure this editor knows.', true);
    mode = m;
    check = null;
    showSolution = false;
    say(m === 'answer' ? 'Fill in: paint the answer on the rows; Check marks what is wrong.' : m === 'json' ? 'JSON: the figure\'s data. Changes show as soon as they are valid.' : 'Editor: what you draw here is the figure, and the answer is checked against it.');
    if (m === 'json') setJson(JSON.stringify(current(), null, 2));
    changed({ palette: true });
    if (m === 'json') jsonArea.focus();
  }
  authorBtn.onclick = () => mode !== 'author' && setMode('author');
  answerBtn.onclick = () => mode !== 'answer' && setMode('answer');
  jsonBtn.onclick = () => mode !== 'json' && setMode('json');
  // JSON: each valid change is the figure (one undo step per pause in typing).
  let jsonError = '';
  jsonArea.addEventListener('input', () => {
    let spec = null;
    let at = null;
    try { spec = JSON.parse(jsonArea.value); } catch (e) { at = jsonErrorAt(jsonArea.value, e); jsonError = at.message; }
    if (spec) jsonError = editorKind(spec) ? '' : 'This JSON is not a process-state diagram, CPU timeline, chart or plot.';
    jsonArea.classList.toggle('invalid', Boolean(jsonError));
    jsonCode.mark(at?.line || null);
    if (jsonError) {
      // Where the error is: its line marked, and a tap on "Line 4, column 12" goes there.
      if (at?.line) {
        status.replaceChildren(make('button', { type: 'button', className: 'json-goto', title: 'Go to the error', textContent: `Line ${at.line}, column ${at.column}`, onclick: () => jsonCode.go(at.index) }), ` ${at.message}.`);
        status.classList.add('error');
      } else say(jsonError, true);
      updateButtons();
      return;
    }
    snapshot('json');
    const keepBrush = brush;
    load(spec, 'json');
    if (kind === 'timeline' || kind === 'states') brush = keepBrush;
    say('JSON: the figure\'s data. Changes show as soon as they are valid.');
    changed({ panel: true, palette: true, json: false });
  });
  checkBtn.onclick = () => {
    check = checkAnswer(current());
    say(check.done ? `All right: ${check.right} of ${check.total}.` : `${check.right} of ${check.total} right; the ones marked in red are not.`, !check.done);
    draw();
  };
  solBtn.onclick = () => { showSolution = !showSolution; updateButtons(); draw(); };
  clearBtn.onclick = () => {
    snapshot();
    if (mode === 'author') {
      if (grid) { for (const r of grid.rows) { r.cells.fill(''); delete r.end; } for (const r of ans?.rows || []) delete r.end; }
      else if (bars) for (const b of bars) b.value = 0;
      check = null;
      changed();
      say('Cleared. One undo (Ctrl Z) brings it back.');
      return;
    }
    ans = grid ? answerGrid({ ...current(), answer: emptyAnswer(current()) }) : barsOf(emptyAnswer(current()));
    check = null;
    changed();
  };
  undoBtn.onclick = () => { if (!undo.length) return; redo.push(JSON.stringify({ spec: current(), mode })); restore(undo.pop()); changed({ palette: true }); };
  redoBtn.onclick = () => { if (!redo.length) return; undo.push(JSON.stringify({ spec: current(), mode })); restore(redo.pop()); changed({ palette: true }); };
  cancelBtn && (cancelBtn.onclick = () => onCancel());
  applyBtn && (applyBtn.onclick = () => !jsonError && onApply(current()));
  function keys(e) {
    const t = e.target;
    // In the editor, or with nothing in it focused (a brush just dragged, the dialog itself).
    if (!root.isConnected || !(t instanceof Node) || !(root.contains(t) || t.contains(root)) || e.defaultPrevented) return;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    if (mode === 'json' && t === jsonArea) return;
    if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redoBtn : undoBtn).click(); }
    else if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redoBtn.click(); }
    else if (!typing && !t.closest?.('.TinyMDE') && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'N') && kind !== 'plot') { e.preventDefault(); toggleNotes(); }
    else if (!typing && !t.closest?.('.TinyMDE') && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9]$/.test(e.key)) {
      const b = palette.querySelectorAll('.ch-brush')[indexOfKey(e.key)];
      if (b) { e.preventDefault(); b.click(); }
    }
  }
  document.addEventListener('keydown', keys, true);

  // --- Palette -------------------------------------------------------------------------
  // The working rows: the solution's, or the answer's when filling in.
  const work = () => (mode === 'answer' ? ans : grid);
  function brushButton(value, label, swatch, index) {
    const key = keyFor(index);
    const b = make('button', { type: 'button', className: 'ch-brush', title: `${label}: drag over the cells to paint${key ? ` (${key})` : ''}. Drag it up or down to reorder` }, swatch, make('span', { textContent: label }), key && make('kbd', { textContent: key }));
    b.dataset.value = value;
    b.setAttribute('aria-pressed', String(brush === value));
    b.onclick = () => choose(value);
    return b;
  }
  function choose(value) {
    brush = value;
    for (const q of palette.querySelectorAll('.ch-brush')) q.setAttribute('aria-pressed', String(q.dataset.value === brush));
  }
  function swatchOf(value, order) {
    const s = svgEl('svg', { viewBox: '0 0 28 14', width: 28, height: 14, 'aria-hidden': 'true' });
    if (value === '') s.append(svgEl('path', { d: 'M4 3l20 8M4 11l20-8', stroke: '#64748b', 'stroke-width': 1.6 }));
    else if (value === '@shift') s.append(svgEl('path', { d: 'M3 7h22M3 7l4-4M3 7l4 4M25 7l-4-4M25 7l-4 4', stroke: '#0f172a', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' }));
    else if (value === '@arrival') s.append(svgEl('circle', { cx: 14, cy: 7, r: 4, fill: '#0f172a' }));
    else if (kind === 'states') appendState(s, value, 2, 26, 7);
    else s.append(svgEl('rect', { x: 2, y: 2, width: 24, height: 10, rx: 2, fill: labelColor(value, order) }));
    return s;
  }
  // The brushes in the order the person left them (palette-order.js): [{ value, label }].
  const orderName = () => (kind === 'states' ? 'chart-states' : 'chart-timeline');
  function brushes() {
    let list = [];
    if (kind === 'states') {
      list = [...STATES.map((v) => ({ value: v, label: base.legend?.[v] || STATE_NAMES[v] })), { value: '', label: 'Erase' }, { value: '@shift', label: 'Shift' }];
      if (mode === 'author') list.push({ value: '@arrival', label: 'Arrival' });
    } else if (kind === 'timeline') {
      const names = [...new Set([...labelsOf(grid), ...labelsOf(ans || { rows: [] }), ...grid.rows.map((r) => r.label).filter((l) => /^P\d+$|^[A-Z]$/.test(l)), ...(base.palette || [])])];
      if (brush && !brush.startsWith('@') && !names.includes(brush)) names.push(brush);
      list = [...names.map((n) => ({ value: n, label: n })), { value: '', label: 'Erase' }, { value: '@shift', label: 'Shift' }];
    }
    const ids = orderedIds(orderName(), list.map((b) => b.value));
    return ids.map((id) => list.find((b) => b.value === id));
  }
  function buildPalette() {
    palette.replaceChildren();
    if (kind === 'states' || kind === 'timeline') {
      const list = brushes();
      if (!list.some((b) => b.value === brush)) brush = list[0]?.value ?? '';
      const order = kind === 'timeline' ? labelsOf(grid) : null;
      const box = make('div', { className: 'ch-brushes' }, ...list.map((b, i) => brushButton(b.value, b.label, swatchOf(b.value, order), i)));
      sortable(box, { items: '.ch-brush', key: (el) => el.dataset.value, axis: 'auto', onReorder: (ids) => { saveOrder(orderName(), ids); buildPalette(); } });
      palette.append(make('h4', { textContent: 'Paint' }), box);
      if (kind === 'timeline') {
        const input = make('input', { type: 'text', placeholder: 'New: P4, Idle…', className: 'ch-new-label', spellcheck: false });
        input.setAttribute('aria-label', 'New label to paint with');
        input.onkeydown = (e) => {
          if (e.key !== 'Enter' || !input.value.trim()) return;
          e.preventDefault();
          brush = input.value.trim();
          base.palette = [...new Set([...(base.palette || []), brush])];
          buildPalette();
          palette.querySelector('.ch-new-label')?.focus();
        };
        palette.append(input, make('p', { className: 'ch-hint', textContent: 'Enter adds it as a brush.' }));
      }
      palette.append(make('h4', { textContent: `Length${base.unit ? ` (${base.unit})` : ''}` }), lengthBox());
      palette.append(make('p', { className: 'ch-hint', textContent: 'Arrival: a first dot is when it arrives, a second one later where it ends (nothing paints past it). The number after each letter is its TRI (running + blocked). Keys 1–9 pick a brush, Shift S opens them at the pointer. Drag one to reorder them. Scroll over the grid to change the length, Ctrl + scroll to zoom the time axis; right-click or right-drag erases. Shift: drag from a cell left or right to slide the rest of that row (Shift held: every row).' }));
    } else if (kind === 'bars') {
      palette.append(make('p', { className: 'ch-hint', textContent: mode === 'answer' ? 'Drag each bar up or down to its value.' : 'Drag a bar up or down to its value. Names and values are also on the right.' }));
    } else {
      palette.append(make('p', { className: 'ch-hint', textContent: 'Curves, points and shaded areas are on the right; the figure follows.' }));
    }
    palette.hidden = kind === 'plot' || mode === 'json';
  }
  // Shift S: the brushes in a ring at the pointer (editor-quick.js).
  const ring = editorQuickMenu(root, {
    entries: () => (kind === 'states' || kind === 'timeline' ? brushes().map((b) => {
      const icon = swatchOf(b.value, kind === 'timeline' ? labelsOf(grid) : null);
      icon.setAttribute('width', 22);
      return { key: b.value, label: b.label, icon, active: () => brush === b.value, run: () => choose(b.value) };
    }) : []),
    onReorder: (ids) => { saveOrder(orderName(), ids); buildPalette(); },
  });

  // --- Canvas: grids ----------------------------------------------------------------------
  function appendState(g, state, x1, x2, y) {
    const c = STATE_COLORS[state];
    if (state === 'run') g.append(svgEl('line', { x1, y1: y, x2, y2: y, stroke: c, 'stroke-width': 4, 'stroke-linecap': 'round' }));
    else if (state === 'ready') g.append(svgEl('line', { x1, y1: y, x2, y2: y, stroke: c, 'stroke-width': 3, 'stroke-dasharray': '6 4' }));
    else if (state === 'blocked') for (let x = x1; x < x2 - 2; x += 5) g.append(svgEl('line', { x1: x, y1: y + 5, x2: x + 4, y2: y - 5, stroke: c, 'stroke-width': 1.8 }));
  }
  let geo = null; // { left, top, cw, rh, n }
  // How much a click paints: 1, 5 or 10 time units (the wheel over the grid switches them).
  const LENGTHS = [1, 5, 10];
  let lengthAt = 0, stamp = null;
  const spanCells = () => Math.max(1, Math.round(LENGTHS[lengthAt] / (work()?.cell || 1)));
  function lengthBox() {
    const box = make('div', { className: 'ch-lengths', role: 'group' });
    box.setAttribute('aria-label', 'How much a click paints');
    LENGTHS.forEach((units, i) => {
      const b = make('button', { type: 'button', className: 'ch-length', textContent: String(units), title: `A click paints ${units} time unit${units === 1 ? '' : 's'} (scroll over the grid to switch)` });
      b.setAttribute('aria-pressed', String(i === lengthAt));
      b.onclick = () => setLength(i);
      box.append(b);
    });
    return box;
  }
  function setLength(i) {
    lengthAt = (i + LENGTHS.length) % LENGTHS.length;
    for (const [k, b] of [...palette.querySelectorAll('.ch-length')].entries()) b.setAttribute('aria-pressed', String(k === lengthAt));
    if (stamp?.at) showStamp(stamp.at);
  }
  // The cells a click would paint, outlined under the pointer.
  function showStamp(at) {
    if (!stamp || !geo) return;
    stamp.at = at;
    const g = work();
    const ok = at && at.row >= 0 && at.row < g.rows.length && at.cell >= 0 && at.cell < geo.n && brush !== '@arrival';
    stamp.el.style.display = ok ? '' : 'none';
    if (!ok) return;
    const a = Math.min(at.cell, geo.n - 1), b = Math.min(geo.n, a + spanCells());
    for (const [k, v] of Object.entries({ x: geo.left + a * geo.cw, y: geo.top + at.row * geo.rh + 2, width: (b - a) * geo.cw, height: geo.rh - 4 })) stamp.el.setAttribute(k, v);
  }
  // Over the grid: the wheel changes the length painted; Ctrl (or ⌘, or a pinch) + wheel zooms
  // the time axis in or out, keeping the time under the pointer where it is.
  let zoom = 1;
  canvas.addEventListener('wheel', (e) => {
    if (!(kind === 'states' || kind === 'timeline') || mode === 'json' || e.shiftKey || !e.deltaY || !canvas.querySelector('.ch-grid')?.contains(e.target)) return;
    e.preventDefault();
    if (!(e.ctrlKey || e.metaKey)) return setLength(lengthAt + (e.deltaY > 0 ? 1 : -1));
    if (!geo) return;
    const r = canvas.firstChild.getBoundingClientRect(), cell = (e.clientX - r.left - geo.left) / geo.cw;
    const before = geo.cw;
    zoom = Math.max(0.25, Math.min(8, zoom * Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004)));
    draw();
    if (!geo || geo.cw === before) return;
    canvas.scrollLeft += cell * (geo.cw - before);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => { if (canvas.querySelector('.ch-grid')?.contains(e.target)) e.preventDefault(); });
  // Fingers on the canvas. Two fingers scroll and pinch (the pinch zooms the time axis, as
  // Ctrl + wheel does); a paint the first finger began is taken back. Once a pen has been
  // used, one finger scrolls too and only the pen (or a mouse) paints, as on the note's pages.
  const touches = new Map();
  let nav = null, touchUndo = -1;
  const mid = () => { const [a, b] = [...touches.values()]; return b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a; };
  const spread = () => { const [a, b] = [...touches.values()]; return b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0; };
  const startNav = () => {
    const [x, y] = mid();
    const r = canvas.firstChild?.getBoundingClientRect?.();
    nav = { x, y, left: canvas.scrollLeft, top: canvas.scrollTop, dist: spread(), zoom, cell: geo && r ? (x - r.left - geo.left) / geo.cw : 0 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 1) touchUndo = undo.length;
    if (touches.size === 2) {
      // The first finger's paint, if any, ends and is taken back.
      for (const id of touches.keys()) if (id !== e.pointerId) canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch', bubbles: true }));
      if (touchUndo >= 0 && undo.length > touchUndo) { restore(undo.pop()); draw(); }
    }
    if (touches.size >= 2 || penUsed) {
      e.stopPropagation();
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch { /* A synthetic event. */ }
      startNav();
    }
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (!nav) return;
    e.stopPropagation();
    const [x, y] = mid();
    if (touches.size >= 2 && nav.dist > 20 && geo && (kind === 'states' || kind === 'timeline')) {
      const before = geo.cw;
      const next = Math.max(0.25, Math.min(8, nav.zoom * spread() / nav.dist));
      if (Math.abs(next - zoom) > 0.01) {
        zoom = next;
        draw();
        // The time between the fingers stays between them.
        if (geo && geo.cw !== before) { const r = canvas.firstChild.getBoundingClientRect(); canvas.scrollLeft += (r.left + geo.left + nav.cell * geo.cw) - x; }
        return;
      }
    }
    canvas.scrollLeft = nav.left - (x - nav.x);
    canvas.scrollTop = nav.top - (y - nav.y);
  }, true);
  const lift = (e) => {
    if (!touches.delete(e.pointerId)) return;
    if (nav) e.stopPropagation();
    // One finger left of a pinch: it goes on scrolling from where it is.
    if (touches.size && nav) startNav(); else if (!touches.size) { nav = null; touchUndo = -1; }
  };
  canvas.addEventListener('pointerup', lift, true);
  canvas.addEventListener('pointercancel', (e) => { if (e.isTrusted) lift(e); }, true);
  function drawGrid() {
    const g = work();
    const n = g.rows[0]?.cells.length || Math.round((g.tEnd - g.tStart) / g.cell);
    const width = Math.max(320, canvas.clientWidth - 16);
    const longest = g.rows.reduce((m, r) => Math.max(m, r.label.length), 2);
    // Process states: room for each process's TRI after its letter.
    const triW = kind === 'states' ? 12 + 7 * Math.max(2, ...g.rows.map((r) => String(fmt(triOf(r, g.cell))).length)) : 0;
    const left = Math.min(140, 22 + longest * 8) + triW, top = 30;
    const cw = Math.max(4, Math.min(160, Math.max(14, Math.min(48, (width - left - 10) / Math.max(1, n))) * zoom));
    // Taller rows for a finger or a pen (a coarse pointer): a row is easy to hit and stay in.
    const rh = (showSolution ? 50 : 42) + (coarse() ? 18 : 0);
    geo = { left, top, cw, rh, n };
    const W = left + cw * n + 10, H = top + rh * g.rows.length + 10;
    const s = svgEl('svg', { class: 'ch-grid', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    // A line at every cell, so each unit of time can be counted; stronger, and labelled, every
    // "Ticks every" (or as often as the labels fit).
    const step = Number(base.tStep) > 0 ? Math.max(1, Math.round(Number(base.tStep) / g.cell)) : 0;
    const fits = Math.max(1, Math.ceil(26 / cw));
    const every = step ? step * Math.ceil(fits / step) : fits;
    for (let k = 0; k <= n; k++) {
      const x = left + k * cw, major = step ? k % step === 0 : k % every === 0;
      s.append(svgEl('line', { x1: x, y1: top - (major ? 6 : 2), x2: x, y2: top + rh * g.rows.length, class: major ? 'ch-gl' : 'ch-gl minor' }));
      if (k % every === 0) s.append(Object.assign(svgEl('text', { x, y: top - 9, class: 'ch-time', 'text-anchor': 'middle' }), { textContent: fmt(g.tStart + k * g.cell) }));
    }
    if (base.unit) s.append(Object.assign(svgEl('text', { x: left - 6, y: top - 9, class: 'ch-time', 'text-anchor': 'end' }), { textContent: base.unit }));
    const order = labelsOf(grid);
    const solution = mode === 'answer' && showSolution ? grid : null;
    g.rows.forEach((r, ri) => {
      const y0 = top + ri * rh, yc = y0 + (showSolution ? rh * 0.38 : rh / 2);
      s.append(svgEl('rect', { x: left, y: y0, width: cw * n, height: rh, class: ri % 2 ? 'ch-lane odd' : 'ch-lane' }));
      s.append(Object.assign(svgEl('text', { x: left - (kind === 'states' ? triW : 8), y: y0 + rh / 2 + 4, class: 'ch-label', 'text-anchor': 'end' }), { textContent: r.label }));
      // Runs of a value drawn as one stretch, as on the page.
      let k = 0;
      while (k < n) {
        const v = r.cells[k];
        let e = k + 1;
        while (e < n && r.cells[e] === v) e++;
        if (v) {
          const x1 = left + k * cw, x2 = left + e * cw;
          if (kind === 'states') {
            appendState(s, v, x1 + 2, x2 - 2, yc);
            if (x2 - x1 >= 16) s.append(Object.assign(svgEl('text', { x: (x1 + x2) / 2, y: yc + 15, class: 'ch-len', fill: STATE_COLORS[v], 'text-anchor': 'middle' }), { textContent: fmt((e - k) * g.cell) }));
          } else {
            s.append(svgEl('rect', { x: x1 + 1, y: yc - 11, width: x2 - x1 - 2, height: 22, rx: 3, fill: labelColor(v, order), class: 'ch-iv' }));
            if (x2 - x1 >= 18) s.append(Object.assign(svgEl('text', { x: (x1 + x2) / 2, y: yc + 4, class: 'ch-ivl', 'text-anchor': 'middle' }), { textContent: v }));
          }
        }
        k = e;
      }
      // The solution, thin, under the answer.
      if (solution) {
        const sr = solution.rows[ri], ys = y0 + rh - 7;
        sr?.cells.forEach((v, c) => {
          if (!v) return;
          const x1 = left + c * cw;
          if (kind === 'states') s.append(svgEl('rect', { x: x1 + 1, y: ys - 2, width: cw - 2, height: 4, fill: STATE_COLORS[v], opacity: 0.55 }));
          else s.append(svgEl('rect', { x: x1 + 1, y: ys - 2, width: cw - 2, height: 4, fill: labelColor(v, order), opacity: 0.55 }));
        });
      }
      const arrival = (mode === 'answer' ? grid.rows[ri]?.arrival : r.arrival);
      if (kind === 'states' && arrival != null) s.append(svgEl('circle', { cx: left + ((arrival - g.tStart) / g.cell) * cw, cy: yc, r: 4.2, class: 'ch-arrival' }));
      const end = (mode === 'answer' ? grid.rows[ri]?.end : r.end);
      if (kind === 'states' && end != null) {
        const xe = left + ((end - g.tStart) / g.cell) * cw;
        s.append(svgEl('line', { x1: xe, y1: y0 + 6, x2: xe, y2: y0 + rh - 6, class: 'ch-end-line' }), svgEl('circle', { cx: xe, cy: yc, r: 4.2, class: 'ch-arrival ch-end' }));
      }
      // TRI beside the letter: time running plus time blocked.
      if (kind === 'states') s.append(Object.assign(svgEl('text', { x: left - 6, y: y0 + rh / 2 + 4, class: 'ch-tri', 'text-anchor': 'end' }), { textContent: fmt(triOf(r, g.cell)) }));
      if (check) for (let c = 0; c < n; c++) if (check.wrong.has(`${ri}:${c}`)) s.append(svgEl('rect', { x: left + c * cw + 1, y: y0 + 2, width: cw - 2, height: rh - 4, class: 'ch-wrong' }));
    });
    // The lanes' backgrounds under the cell lines (they were drawn over them).
    for (const lane of [...s.querySelectorAll('.ch-lane')].reverse()) s.prepend(lane);
    const outline = svgEl('rect', { class: 'ch-stamp', rx: 3 });
    outline.style.display = 'none';
    s.append(outline);
    stamp = { el: outline, at: stamp?.at || null };
    showStamp(stamp.at);
    canvas.replaceChildren(s);
    s.addEventListener('pointerdown', gridDown);
    s.addEventListener('pointermove', (e) => { if (!e.buttons) showStamp(cellAt(e)); });
    s.addEventListener('pointerleave', () => showStamp(null));
  }
  function cellAt(e) {
    const r = canvas.firstChild.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const row = Math.floor((y - geo.top) / geo.rh), cell = Math.floor((x - geo.left) / geo.cw);
    return { row, cell, x };
  }
  function gridDown(e) {
    // The right button erases (a click or a drag), whatever the brush.
    const erasing = e.button === 2;
    if (e.button !== 0 && !erasing) return;
    const g = work();
    const at = cellAt(e);
    if (at.row < 0 || at.row >= g.rows.length || at.cell < -1 || at.cell > geo.n) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    snapshot();
    check = null;
    if (brush === '@arrival' && !erasing) {
      // The first marker on a line is its arrival; a second one, later, is where it ends.
      // A marker clicked again goes; with both there, the nearer one moves to the click.
      const t = g.tStart + Math.max(0, Math.min(geo.n, Math.round((at.x - geo.left) / geo.cw))) * g.cell;
      const r = g.rows[at.row];
      if (r.arrival === t) r.arrival = null;
      else if (r.end === t) delete r.end;
      else if (r.arrival == null && (r.end == null || t < r.end)) r.arrival = t;
      else if (r.end == null && t > r.arrival) r.end = t;
      else if (r.end == null) r.arrival = t;
      else if (Math.abs(t - r.arrival) <= Math.abs(t - r.end) && t < r.end) r.arrival = t;
      else if (t > (r.arrival ?? -Infinity)) r.end = t;
      else r.arrival = t;
      // Nothing painted past its end.
      if (r.end != null) {
        const k0 = Math.max(0, Math.round((r.end - g.tStart) / g.cell));
        for (let k = k0; k < r.cells.length; k++) r.cells[k] = '';
      }
      // The answer has the solution's markers.
      if (mode === 'author' && ans?.rows[at.row]) { ans.rows[at.row].arrival = r.arrival; if (r.end != null) ans.rows[at.row].end = r.end; else delete ans.rows[at.row].end; }
      changed();
      return;
    }
    if (brush === '@shift' && !erasing) return shiftDrag(e, g, at);
    const row = g.rows[at.row];
    const from = Math.max(0, Math.min(geo.n - 1, at.cell));
    // A click on a cell already painted with the brush clears it; a drag paints the run.
    const span = spanCells();
    const value = erasing ? '' : row.cells[from] === brush && brush ? '' : brush;
    // The run follows the pointer both ways: moving back (without letting go) gives the cells
    // passed over back as they were before the press.
    const before = [...row.cells];
    // A process with an end marker paints no further than it (move or remove the marker first).
    const endAt = (mode === 'answer' ? grid.rows[at.row]?.end : row.end);
    const lastCell = endAt != null ? Math.min(geo.n, Math.round((endAt - g.tStart) / g.cell)) - 1 : geo.n - 1;
    if (from > lastCell && value) { say('This process ends at its second marker: move or remove it to paint further.', true); return; }
    const paint = (to) => {
      const a = Math.min(from, to), b = Math.min(value ? lastCell : geo.n - 1, Math.max(from, to) + span - 1);
      for (let k = 0; k < before.length; k++) row.cells[k] = k >= a && k <= b ? value : before[k];
    };
    paint(from);
    draw();
    // draw() replaces the svg: the canvas follows the pointer instead.
    try { canvas.setPointerCapture(e.pointerId); } catch { /* A synthetic event. */ }
    let last = from;
    const move = (ev) => {
      const to = Math.max(0, Math.min(geo.n - 1, cellAt(ev).cell));
      if (to === last) return;
      last = to;
      paint(to);
      draw();
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      changed();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  // The Shift brush: what is painted from the pressed cell on slides left or right with the
  // pointer (a skipped unit made room for, or an extra one taken out). Shift held: every row.
  // Cells pushed past the end are kept while the drag lasts, so moving back brings them back.
  function shiftDrag(e, g, at) {
    const from = Math.max(0, Math.min(geo.n - 1, at.cell));
    const rows = e.shiftKey ? g.rows : [g.rows[at.row]];
    const before = rows.map((r) => [...r.cells]);
    const apply = (d) => rows.forEach((r, i) => {
      const old = before[i], n = old.length;
      for (let k = from + Math.min(0, d); k < n; k++) {
        if (d >= 0) r.cells[k] = k < from ? old[k] : k < from + d ? '' : old[k - d] ?? '';
        else r.cells[k] = old[k - d] ?? '';
      }
    });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* A synthetic event. */ }
    canvas.style.cursor = 'ew-resize';
    let last = 0;
    const move = (ev) => {
      const d = Math.max(-from, Math.round((cellAt(ev).x - at.x) / geo.cw));
      if (d === last) return;
      last = d;
      apply(d);
      draw();
    };
    const up = () => {
      canvas.style.cursor = '';
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      changed();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  // --- Canvas: bars -----------------------------------------------------------------------
  function barsTop(list) {
    if (Number.isFinite(Number(base.yMax)) && Number(base.yMax) > 0) return Number(base.yMax);
    const m = Math.max(0, ...bars.map((b) => b.value ?? 0), ...list.map((b) => b.value ?? 0));
    return m > 0 ? Math.ceil(m * 1.25) : 10;
  }
  const snapOf = (top) => Number(base.snap) > 0 ? Number(base.snap) : top > 200 ? 10 : top > 40 ? 1 : (bars.some((b) => b.value != null && !Number.isInteger(b.value)) ? 0.5 : 1);
  function drawBars() {
    const list = mode === 'answer' ? ans : bars;
    const W = Math.max(320, canvas.clientWidth - 16), H = 300;
    const left = 46, top = 16, bottom = 36, ph = H - top - bottom, pw = W - left - 12;
    const yMax = barsTop(list), snap = snapOf(yMax);
    const n = Math.max(1, list.length), slot = pw / n, bw = Math.max(10, slot * (base.contiguous || String(base.type).toLowerCase() === 'histogram' ? 0.96 : 0.7));
    geo = { left, top, ph, pw, slot, yMax, snap };
    const s = svgEl('svg', { class: 'ch-bars', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    // Round steps along the axis: 1, 2 or 5 times a power of ten.
    const raw = yMax / 6, p10 = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map((m) => m * p10).find((v) => v >= raw);
    for (let v = 0; v <= yMax + 1e-9; v += step) {
      const y = top + ph - (v / yMax) * ph;
      s.append(svgEl('line', { x1: left, y1: y, x2: left + pw, y2: y, class: 'ch-gl minor' }));
      s.append(Object.assign(svgEl('text', { x: left - 6, y: y + 4, class: 'ch-time', 'text-anchor': 'end' }), { textContent: fmt(Math.round(v * 1000) / 1000) }));
    }
    // A column per bar, as the page draws them: with the lines across, squares to place on.
    for (let i = 0; i <= n; i++) s.append(svgEl('line', { x1: left + i * slot, y1: top, x2: left + i * slot, y2: top + ph, class: 'ch-gl minor' }));
    list.forEach((b, i) => {
      const x = left + i * slot + (slot - bw) / 2;
      const g = svgEl('g', { class: 'ch-bar-col', 'data-index': i });
      g.append(svgEl('rect', { x: left + i * slot, y: top, width: slot, height: ph, class: 'ch-bar-hit' }));
      if (mode === 'answer' && showSolution && bars[i]?.value != null) {
        const ys = top + ph - (Math.min(yMax, bars[i].value) / yMax) * ph;
        g.append(svgEl('line', { x1: x - 3, y1: ys, x2: x + bw + 3, y2: ys, class: 'ch-sol-line' }));
      }
      if (b.value != null) {
        const h = (Math.max(0, Math.min(yMax, b.value)) / yMax) * ph;
        g.append(svgEl('rect', { x, y: top + ph - h, width: bw, height: Math.max(1, h), rx: 2, fill: b.color || PALETTE[i % PALETTE.length], class: 'ch-barrect' }));
        g.append(Object.assign(svgEl('text', { x: x + bw / 2, y: top + ph - h - 5, class: 'ch-ivv', 'text-anchor': 'middle' }), { textContent: fmt(b.value) }));
        g.append(svgEl('rect', { x: x + bw / 2 - 12, y: top + ph - h - 3, width: 24, height: 6, rx: 3, class: 'ch-grip' }));
      } else g.append(svgEl('rect', { x, y: top, width: bw, height: ph, class: 'ch-empty-bar' }));
      if (check?.wrong.has(String(i))) g.append(svgEl('rect', { x: x - 3, y: top, width: bw + 6, height: ph, class: 'ch-wrong' }));
      g.append(Object.assign(svgEl('text', { x: left + i * slot + slot / 2, y: top + ph + 16, class: 'ch-label small', 'text-anchor': 'middle' }), { textContent: b.label }));
      s.append(g);
    });
    s.append(svgEl('line', { x1: left, y1: top, x2: left, y2: top + ph, class: 'ch-axis' }), svgEl('line', { x1: left, y1: top + ph, x2: left + pw, y2: top + ph, class: 'ch-axis' }));
    canvas.replaceChildren(s);
    s.addEventListener('pointerdown', barDown);
  }
  function barDown(e) {
    if (e.button !== 0) return;
    const list = mode === 'answer' ? ans : bars;
    const r = canvas.firstChild.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - geo.left) / geo.slot);
    if (i < 0 || i >= list.length) return;
    e.preventDefault();
    snapshot();
    check = null;
    const { top, ph, snap } = geo, yMax = geo.yMax;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* A synthetic event. */ }
    const set = (ev) => {
      const y = ev.clientY - canvas.firstChild.getBoundingClientRect().top;
      const v = Math.max(0, Math.min(yMax, ((top + ph - y) / ph) * yMax));
      list[i].value = Math.round(v / snap) * snap;
      list[i].value = Math.round(list[i].value * 1e6) / 1e6;
      draw();
    };
    set(e);
    const move = (ev) => set(ev);
    const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); changed(); };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  function draw() {
    if (mode === 'json') { /* The text is the view. */ }
    else if (grid) drawGrid();
    else if (bars) drawBars();
    else canvas.replaceChildren(make('p', { className: 'ch-hint', textContent: 'An exam plot is drawn from its curves, points and areas: change them on the right.' }));
    canvas.hidden = kind === 'plot' || mode === 'json';
    jsonCode.box.hidden = mode !== 'json';
    layoutPreview();
    // The notes follow the figure (undo, the JSON, another figure loaded).
    if (prefs.notes && kind !== 'plot') {
      if (!notesEditor) showNotes();
      else if (notesEditor.getContent && notesEditor.getContent() !== (base.notes || '')) notesEditor.setContent(base.notes || '');
    }
    if (!previewBox.classList.contains('open')) { preview.replaceChildren(); return; }
    const shown = displaySpec(current());
    const out = renderVisualSvg(shown, { forMcp: false });
    if (out?.svg) preview.innerHTML = out.svg; else preview.replaceChildren(make('p', { className: 'ch-hint error', textContent: 'Nothing to draw yet.' }));
  }

  // --- Properties panel ---------------------------------------------------------------------
  const field = (label, input, hint = '') => make('label', { className: 'ch-field' }, make('span', { textContent: label }), input, hint && make('small', { textContent: hint }));
  function text(value, onInput, attrs = {}) {
    const input = make('input', { type: 'text', value: value ?? '', spellcheck: false, ...attrs });
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }
  function number(value, onInput, attrs = {}) {
    const input = make('input', { type: 'number', value: value ?? '', step: 'any', ...attrs });
    input.addEventListener('change', () => onInput(input.value === '' ? null : Number(input.value)));
    return input;
  }
  function check1(label, checked, onInput, title = '') {
    const input = make('input', { type: 'checkbox', checked: Boolean(checked) });
    input.addEventListener('change', () => onInput(input.checked));
    return make('label', { className: 'ch-check', title }, input, ` ${label}`);
  }
  const edit = (key, fn, opts) => (v) => { snapshot(key); fn(v); changed(opts); };
  function iconBtn(name, title, onclick) { const b = button(name, title, title, { iconOnly: true, className: 'ch-mini' }); b.onclick = onclick; return b; }

  function buildPanel() {
    const out = [];
    const locked = mode !== 'author';
    out.push(make('h3', { textContent: chartName(base) }));
    out.push(field('Title', text(base.title, edit('title', (v) => { base.title = v; }, { panel: false }), { disabled: locked })));
    if (locked) {
      out.push(make('p', { className: 'ch-hint', textContent: mode === 'json' ? 'Editing the JSON: the fields come back in Editor.' : 'Filling in: the rows, times and names are the exercise\'s. Switch to Editor to change them.' }));
      if (mode === 'answer') { buildRefs(); out.push(make('h4', { textContent: 'To look at' }), refAdd, ...(refRecent ? [refRecent] : []), refFile, refList); }
      panel.replaceChildren(...out);
      return;
    }
    if (canBeExercise(base)) {
      out.push(check1('Exercise: filled in here, then checked', base.exercise, edit('exercise', (v) => {
        base.exercise = v;
        if (v) { ans = grid ? answerGrid({ ...current(), answer: emptyAnswer(current()) }) : barsOf(emptyAnswer(current())); }
        else ans = null;
      }, { palette: true }), 'The page shows the student\'s answer (empty to start); what you draw here is the solution it is checked against'));
      if (base.exercise) out.push(check1('Show the solution on the page', base.reveal, edit('reveal', (v) => { base.reveal = v; })));
    }
    out.push(check1('Empty, to fill in by hand on the page', base.blank, edit('blank', (v) => { base.blank = v; }), 'The page shows the axes and rows only'));
    if (grid) out.push(...gridPanel());
    else if (bars) out.push(...barsPanel());
    else out.push(...plotPanel());
    // Something to copy from while drawing: a picture or PDF, or a snippet grabbed from a note.
    buildRefs();
    out.push(make('h4', { textContent: 'To look at' }), refAdd, ...(refRecent ? [refRecent] : []), refFile, refList);
    panel.replaceChildren(...out);
  }
  function retime(changes) {
    grid = resample(grid, changes);
    if (ans) ans = resample(ans, changes);
  }
  function gridPanel() {
    const out = [make('h4', { textContent: 'Time' })];
    const row = make('div', { className: 'ch-row3' },
      field('From', number(grid.tStart, edit('t0', (v) => { if (v != null && v < grid.tEnd) retime({ tStart: v }); }))),
      field('To', number(grid.tEnd, edit('t1', (v) => { if (v != null && v > grid.tStart) retime({ tEnd: v }); }))),
      field('Cell', number(grid.cell, edit('cell', (v) => { if (v > 0 && (grid.tEnd - grid.tStart) / v <= 600) retime({ cell: v }); }), { min: 0.01, title: 'The length of one cell of the grid' })));
    out.push(row, make('div', { className: 'ch-row3' },
      field('Ticks every', number(base.tStep, edit('tstep', (v) => { base.tStep = v > 0 ? v : undefined; }, { panel: false }), { min: 0 })),
      field('Unit', text(base.unit, edit('unit', (v) => { base.unit = v; }, { panel: false }), { placeholder: 'ms, u.t.' }))));
    if (kind === 'states') {
      out.push(make('h4', { textContent: 'Legend' }));
      const legend = base.legend || (base.legend = {});
      for (const s of STATES) out.push(field(STATE_NAMES[s], text(legend[s] ?? '', edit(`legend-${s}`, (v) => { legend[s] = v; }, { panel: false, palette: true }), { placeholder: { run: 'Activo', ready: 'Listo', blocked: 'Bloqueado' }[s] })));
    } else {
      out.push(field('Axis label', text(base.xLabel, edit('xlabel', (v) => { base.xLabel = v; }, { panel: false }), { placeholder: 'Time (ms)' })));
    }
    out.push(make('h4', { textContent: kind === 'states' ? 'Processes (top to bottom, as on the page)' : 'Rows' }));
    grid.rows.forEach((r, i) => {
      const parts = [text(r.label, edit(`label-${i}`, (v) => { r.label = v; if (ans?.rows[i]) ans.rows[i].label = v; }, { panel: false }), { 'aria-label': 'Name', className: 'ch-name' })];
      if (kind === 'states') {
        parts.push(number(r.arrival, edit(`arr-${i}`, (v) => { r.arrival = v; if (ans?.rows[i]) ans.rows[i].arrival = v; }, { panel: false }), { 'aria-label': 'Arrives at', placeholder: 'arrives', title: 'Arrives at (a dot on its line); the Arrival brush sets it too', className: 'ch-num' }));
        const done = make('input', { type: 'checkbox', checked: r.done !== false, title: 'Ends (* after its last stretch)' });
        done.onchange = edit(`done-${i}`, () => { r.done = done.checked; }, { panel: false });
        parts.push(make('label', { className: 'ch-check', title: 'Ends: * after its last stretch' }, done, '*'));
      }
      const swap = (a, b) => { snapshot(); for (const g of [grid, ans]) if (g) [g.rows[a], g.rows[b]] = [g.rows[b], g.rows[a]]; changed(); };
      const up = iconBtn('arrowUp', 'Move up', () => i && swap(i - 1, i));
      const down = iconBtn('arrowDown', 'Move down', () => i < grid.rows.length - 1 && swap(i, i + 1));
      up.disabled = !i;
      down.disabled = i === grid.rows.length - 1;
      parts.push(up, down);
      parts.push(iconBtn('backspace', 'Remove', () => { if (grid.rows.length < 2) return; snapshot(); for (const g of [grid, ans]) g?.rows.splice(i, 1); changed({ palette: true }); }));
      out.push(make('div', { className: 'ch-rowedit' }, ...parts));
    });
    out.push(Object.assign(button('plus', kind === 'states' ? 'Add process' : 'Add row', kind === 'states' ? 'Add a process (a row)' : 'Add a row'), { onclick: () => {
      snapshot();
      const n = grid.rows[0]?.cells.length || Math.round((grid.tEnd - grid.tStart) / grid.cell);
      const names = grid.rows.map((r) => r.label);
      let label = kind === 'states' ? String.fromCharCode(65 + grid.rows.length) : `P${grid.rows.length + 1}`;
      if (names.includes(label)) label = `${label}'`;
      for (const g of [grid, ans]) g?.rows.push({ label, arrival: null, done: true, cells: Array(n).fill('') });
      changed({ palette: true });
    } }));
    return out;
  }
  function barsPanel() {
    const histogram = base.contiguous ?? String(base.type).toLowerCase() === 'histogram';
    const out = [
      check1('Bars touching (histogram)', histogram, edit('contig', (v) => { base.contiguous = v; base.type = v ? 'histogram' : 'bar'; })),
      make('div', { className: 'ch-row3' },
        field('Axis (x)', text(base.xLabel, edit('xl', (v) => { base.xLabel = v; }, { panel: false }))),
        field('Axis (y)', text(base.yLabel, edit('yl', (v) => { base.yLabel = v; }, { panel: false })))),
      make('div', { className: 'ch-row3' },
        field('Top of the axis', number(base.yMax, edit('ymax', (v) => { base.yMax = v > 0 ? v : undefined; }, { panel: false }), { min: 0, placeholder: 'auto' })),
        field('Snap to', number(base.snap, edit('snap', (v) => { base.snap = v > 0 ? v : undefined; }, { panel: false }), { min: 0, placeholder: 'auto', title: 'Dragged bars stop at multiples of this' }))),
      check1('Values over the bars', base.showValues !== false, edit('sv', (v) => { base.showValues = v; })),
      make('h4', { textContent: 'Bars' }),
    ];
    bars.forEach((b, i) => {
      out.push(make('div', { className: 'ch-rowedit' },
        text(b.label, edit(`bl-${i}`, (v) => { b.label = v; if (ans?.[i]) ans[i].label = v; }, { panel: false }), { 'aria-label': 'Name', className: 'ch-name' }),
        number(b.value, edit(`bv-${i}`, (v) => { b.value = v; }, { panel: false }), { 'aria-label': 'Value', className: 'ch-num' }),
        iconBtn('backspace', 'Remove', () => { if (bars.length < 2) return; snapshot(); bars.splice(i, 1); ans?.splice(i, 1); changed(); })));
    });
    out.push(Object.assign(button('plus', 'Add bar', 'Add a bar'), { onclick: () => {
      snapshot();
      const last = bars[bars.length - 1]?.label || '';
      const m = last.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
      const label = m ? `${m[2]}-${Number(m[2]) + (Number(m[2]) - Number(m[1]))}` : /^[A-Y]$/.test(last) ? String.fromCharCode(last.charCodeAt(0) + 1) : `${bars.length + 1}`;
      bars.push({ label, value: 0 });
      ans?.push({ label, value: null });
      changed();
    } }));
    return out;
  }
  function plotPanel() {
    const out = [make('div', { className: 'ch-row3' },
      field('x from', number(base.xMin ?? -5, edit('xmin', (v) => { base.xMin = v; }, { panel: false }))),
      field('x to', number(base.xMax ?? 5, edit('xmax', (v) => { base.xMax = v; }, { panel: false }))),
      field('x label', text(base.xLabel ?? 'x', edit('xlab', (v) => { base.xLabel = v; }, { panel: false })))),
    make('div', { className: 'ch-row3' },
      field('y from', number(base.yMin ?? -5, edit('ymin', (v) => { base.yMin = v; }, { panel: false }))),
      field('y to', number(base.yMax ?? 5, edit('ymax', (v) => { base.yMax = v; }, { panel: false }))),
      field('y label', text(base.yLabel ?? 'y', edit('ylab', (v) => { base.yLabel = v; }, { panel: false })))),
    check1('Grid', base.grid !== false, edit('grid', (v) => { base.grid = v; }))];
    const list = (title, key, fields, blank, addLabel) => {
      const items = Array.isArray(base[key]) ? base[key] : (base[key] = []);
      out.push(make('h4', { textContent: title }));
      items.forEach((it, i) => {
        out.push(make('div', { className: 'ch-rowedit' }, ...fields.map(([f, label, type]) => {
          if (type === 'check') { const c = make('input', { type: 'checkbox', checked: Boolean(it[f]), title: label }); c.onchange = edit(`${key}-${i}-${f}`, () => { it[f] = c.checked; }, { panel: false }); return make('label', { className: 'ch-check', title: label }, c, label); }
          const set = edit(`${key}-${i}-${f}`, (v) => { it[f] = v; }, { panel: false });
          return type === 'number' ? number(it[f], set, { 'aria-label': label, placeholder: label, className: 'ch-num' }) : text(it[f], set, { 'aria-label': label, placeholder: label, className: f === 'expr' ? 'ch-name' : 'ch-short' });
        }), iconBtn('backspace', 'Remove', () => { snapshot(); items.splice(i, 1); changed(); })));
      });
      out.push(Object.assign(button('plus', addLabel, addLabel), { onclick: () => { snapshot(); items.push(blank()); changed(); } }));
    };
    list('Curves (functions of x: x^2 - 1, sin(x), 2*x + 1)', 'functions', [['expr', 'f(x)', 'text'], ['label', 'label', 'text'], ['dashed', 'dashed', 'check']], () => ({ expr: 'x', label: '' }), 'Add curve');
    list('Points', 'points', [['x', 'x', 'number'], ['y', 'y', 'number'], ['label', 'label', 'text'], ['open', 'open', 'check']], () => ({ x: 0, y: 0, label: '' }), 'Add point');
    list('Shaded areas (under a curve, from … to …)', 'areas', [['expr', 'f(x)', 'text'], ['from', 'from', 'number'], ['to', 'to', 'number']], () => ({ expr: base.functions?.[0]?.expr || 'x', from: 0, to: 1 }), 'Add area');
    return out;
  }

  // --- Start -------------------------------------------------------------------------------
  load(initial);
  if (mode === 'json') setJson(JSON.stringify(current(), null, 2));
  buildPalette();
  buildPanel();
  updateButtons();
  const resize = new ResizeObserver(() => draw());
  resize.observe(canvas);
  draw();
  // Keys (1–9, Shift S, Ctrl Z) go to the editor from the start.
  (mode === 'json' ? jsonArea : canvas).focus({ preventScroll: true });
  if (mode === 'json') say('JSON: the figure\'s data. Changes show as soon as they are valid.');
  if (mode === 'answer') say('Fill in: choose a brush and drag over the cells; Check marks what is wrong.');
  return {
    spec: current,
    mode: () => mode,
    set(spec, m = 'author') { snapshot(); load(spec, m); buildPalette(); changed(); },
    destroy() { document.removeEventListener('paste', onPaste, true); ring.destroy(); resize.disconnect(); document.removeEventListener('keydown', keys, true); root.replaceChildren(); root.classList.remove('chart-editor'); },
  };
}

// The editor over the whole window, for a figure on a note. Resolves with the spec, or null.
export function openChartEditor(spec, { editing = false, mode = 'author', references = [], onReference = null, notePages = null, recentNotes = null } = {}) {
  ensureStyles();
  return new Promise((resolve) => {
    const dialog = make('dialog', { className: 'chart-dialog' });
    dialog.setAttribute('aria-label', `${editing ? 'Edit' : 'Insert'} ${chartName(spec).toLowerCase()}`);
    const host = make('div', { className: 'chart-host' });
    dialog.append(host);
    document.body.append(dialog);
    let editor = null;
    const finish = (value) => { editor?.destroy(); dialog.close(); dialog.remove(); resolve(value); };
    // Keys stay in the editor (the note's shortcuts are not for it); Escape cancels.
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dialog.showModal();
    editor = mountChartEditor(host, spec, { mode, references, onReference, notePages, recentNotes, onApply: (s) => finish(s), onCancel: () => finish(null), applyLabel: editing ? 'Apply' : 'Insert' });
  });
}
