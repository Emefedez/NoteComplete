// Prefabs: ready-made figures to put on a page (Insert → Insert prefab, Shift X, or the Shapes
// tool's prefab box). A function graph and a table are the editable ink objects of graph.js and
// table.js; the exam figures (histogram, bar chart, process states, CPU timeline, tree, plot)
// are drawn by exam-html.js, as in generated exams, and placed as a picture with a frame that
// keeps what they are (part.rs, kind "prefab"), so they can be edited again like a graph.
import { imageReady } from './image-ready.js';
import { cards, groups, onModules, nameOf, renderSpec, stamp, moduleOf } from './prefab-registry.js';
import { icon } from './icons.js';
import { jsonErrorAt, codeBox } from './json-code.js';
import { CODE_DIAGRAMS, savedUmlView, saveUmlView, askUmlView, setAskUmlView } from './uml.js';
import { toPlantUml } from './uml-plantuml.js';

// What each prefab starts as: the cards of the prefab modules (prefab-registry.js,
// docs/PREFAB-MODULES.md). `kind`: "graph" and "table" open their own editors; "prefab" is a
// figure drawn as a picture from its `spec` (the charts module: exam figures); "uml" a diagram
// edited in the diagram editor. Live lists: modules added at start join them.
export const PREFABS = [];
export const PREFAB_GROUPS = [];
function refreshCards() {
  PREFABS.splice(0, PREFABS.length, ...cards());
  PREFAB_GROUPS.splice(0, PREFAB_GROUPS.length, ...groups());
}
refreshCards();
onModules(refreshCards);

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

// The name of a prefab's figure, for menus ("Histogram"): its module says.
export const prefabName = (spec) => nameOf(spec);

// The figure as SVG text with its size, or null when the spec draws nothing (or its module
// is missing).
export const prefabSvg = (spec) => renderSpec(spec);
// The spec with what its module fetches before drawing (a module's async `prepare`, e.g. the
// hanzi module's stroke data); used by MCP add_prefab, which writes no data into its specs.
export const prefabPrepare = async (spec) => (await moduleOf(spec)?.code.prepare?.(spec)) || spec;

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
    // With the next step turned off: which editor a UML diagram opens in, and a way back to the choice.
    const editorChip = make('button', { type: 'button', className: 'prefab-editor-chip', hidden: true });
    const importInput = make('input', { type: 'file', accept: '.puml,.plantuml,.pu,.iuml,.wsd,.xml,.xmi,.uml,.json,application/xml,text/xml,application/json', hidden: true });
    const importBtn = make('button', { type: 'button', title: 'Open a PlantUML (.puml), Visual Paradigm XML, XMI or NoteComplete diagram file' }, icon('import'), ' Import .puml / diagram…');
    const cancel = make('button', { type: 'button', textContent: 'Cancel' });
    const apply = make('button', { type: 'button', className: 'primary', textContent: 'Insert' });
    // The modules in use, and the folder of modules (prefab-modules-ui.js).
    const modulesBtn = make('button', { type: 'button', className: 'prefab-modules-open', title: 'Prefab modules: which are in use, and a folder of your own' }, icon('settings'), ' Modules…');
    modulesBtn.onclick = () => import('./prefab-modules-ui.js').then((m) => m.openModulesDialog({ status: (text) => { hint.textContent = text; } }));
    const filter = make('div', { className: 'prefab-filter' }, search, pills);
    const split = make('div', { className: 'prefab-split' }, grid, make('section', { className: 'prefab-side' }, big, name, hint, editorChip));
    const actions = make('div', { className: 'ocr-actions' }, importBtn, importInput, modulesBtn, make('span', { className: 'prefab-step-spacer' }), cancel, apply);
    // The next step for a class or use case diagram: which editor, the two side by side.
    const step = make('div', { className: 'prefab-step', hidden: true });
    dialog.append(
      make('div', { className: 'exam-dlg-head' }, make('h2', {}, icon('graph'), ' Insert prefab'), close),
      filter, split, actions, step);
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(dialog);
    const previews = new Map();
    const thumb = (p) => {
      if (!previews.has(p.id)) previews.set(p.id, (p.spec && prefabSvg(p.spec)?.svg) || null);
      const svg = previews.get(p.id);
      return svg ? previewOf(svg) : make('div', { className: 'prefab-preview prefab-icon' }, icon(p.icon));
    };
    // The cards' pictures are drawn a few at a time after the picker shows: drawing all of
    // them first (UML diagrams, charts) kept a tablet's first open waiting for seconds.
    const waiting = [];
    let drawing = 0;
    const drawSome = () => {
      drawing = 0;
      const until = performance.now() + 12;
      while (waiting.length && performance.now() < until) {
        const [p, slot] = waiting.shift();
        if (slot.isConnected) slot.replaceWith(thumb(p));
      }
      if (waiting.length && dialog.open) drawing = setTimeout(drawSome, 16);
    };
    const lazyThumb = (p) => {
      if (previews.has(p.id)) return thumb(p);
      const slot = make('div', { className: 'prefab-preview prefab-icon' }, icon(p.icon));
      waiting.push([p, slot]);
      if (!drawing) drawing = setTimeout(drawSome, 30);
      return slot;
    };
    // The large picture of the one shown: drawn after the frame that shows the picker (or the
    // newly pointed card), so a tap gets its answer first; its icon stands in until then.
    let bigFor = null;
    const showBig = (p) => {
      bigFor = p;
      if (!p || previews.has(p.id)) return big.replaceChildren(...(p ? [thumb(p)] : []));
      big.replaceChildren(make('div', { className: 'prefab-preview prefab-icon' }, icon(p.icon)));
      requestAnimationFrame(() => setTimeout(() => { if (bigFor === p && dialog.isConnected) big.replaceChildren(thumb(p)); }, 0));
    };
    let active = null;
    const finish = (value) => { if (value?.id && value.kind !== 'uml-import') notePrefabUsed(value.id); dialog.close(); dialog.remove(); resolve(value); };
    importBtn.onclick = () => importInput.click();
    importInput.onchange = async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file) return;
      try { const text = await file.text(); finish({ id: 'uml-import', kind: 'uml-import', fileName: file.name, text }); } catch { /* Ignored. */ }
    };
    const codeCapable = (p) => p?.kind === 'uml' && CODE_DIAGRAMS.has(p.spec?.diagram);
    const EDITORS = {
      visual: { icon: 'uml', label: 'Visual', does: 'Draw it: place elements from the palette and drag arrows between them, as in Visual Paradigm.' },
      split: { icon: 'code', label: 'PlantUML', does: 'Write it as PlantUML text. The drawing follows beside it, and each edits the other.' },
    };
    const editorOf = () => (savedUmlView() === 'visual' ? 'visual' : 'split');
    // Insert: a class or use case diagram asks for its editor first (unless that step is off).
    const go = (p) => { if (!p) return; if (codeCapable(p) && askUmlView()) editorStep(p); else finish(p); };
    function editorStep(p) {
      let chosen = editorOf();
      const never = make('input', { type: 'checkbox' });
      const code = (() => { try { return toPlantUml(p.spec, { layout: false }).trim().split('\n').slice(0, 16).join('\n'); } catch { return ''; } })();
      const cards = Object.entries(EDITORS).map(([v, e]) => {
        const picture = v === 'visual' ? thumb(p) : make('pre', { className: 'prefab-code', textContent: code });
        const card = make('button', { type: 'button', className: 'prefab-editor' }, make('div', { className: 'prefab-editor-picture' }, picture), make('strong', {}, icon(e.icon), ` ${e.label}`), make('span', { textContent: e.does }));
        card.dataset.view = v;
        card.onclick = () => pick(v);
        card.onfocus = () => mark(v);
        return card;
      });
      const mark = (v) => { chosen = v; for (const c of cards) c.setAttribute('aria-pressed', String(c.dataset.view === v)); };
      const pick = (v) => { saveUmlView(v); if (never.checked) setAskUmlView(false); finish(p); };
      const back = make('button', { type: 'button', textContent: 'Back' }, );
      const insert = make('button', { type: 'button', className: 'primary', textContent: 'Insert' });
      back.onclick = () => { step.hidden = true; step.replaceChildren(); filter.hidden = split.hidden = actions.hidden = false; search.focus(); };
      insert.onclick = () => pick(chosen);
      step.replaceChildren(
        make('h3', { className: 'exam-sub' }, icon('uml'), ` ${p.label}: editor`),
        make('div', { className: 'prefab-editors', role: 'group' }, ...cards),
        make('div', { className: 'ocr-actions' }, make('label', { className: 'prefab-never' }, never, ' Don\'t ask again'), make('span', { className: 'prefab-step-spacer' }), back, insert));
      step.onkeydown = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const v = e.key === 'ArrowLeft' ? 'visual' : 'split'; mark(v); cards.find((c) => c.dataset.view === v).focus(); }
        else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); pick(chosen); }
        else if (e.key === 'Backspace' && e.target.tagName !== 'INPUT') { e.preventDefault(); back.click(); }
      };
      filter.hidden = split.hidden = actions.hidden = true;
      step.hidden = false;
      mark(chosen);
      cards.find((c) => c.dataset.view === chosen).focus();
    }
    editorChip.onclick = () => { if (active) { setAskUmlView(true); editorStep(active); } };
    function show(p) {
      active = p;
      editorChip.hidden = !codeCapable(p) || askUmlView();
      if (!editorChip.hidden) { const e = EDITORS[editorOf()]; editorChip.replaceChildren(icon(e.icon), ` ${e.label}`); editorChip.title = 'The editor it opens in: click to choose again'; }
      for (const c of grid.querySelectorAll('.prefab-card')) c.setAttribute('aria-selected', String(c.dataset.id === p?.id));
      showBig(p);
      name.textContent = p?.label || 'Nothing found';
      hint.textContent = p ? p.hint : 'Try another word, or All.';
      apply.disabled = !p;
    }
    const words = (p) => `${p.label} ${p.hint} ${PREFAB_GROUPS.find(([g]) => g === p.group)?.[1] || ''} ${p.id}`.toLowerCase();
    function list() {
      const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const found = PREFABS.filter((p) => (!group || p.group === group) && q.every((w) => words(p).includes(w)));
      const card = (p) => {
        const c = make('button', { type: 'button', className: 'prefab-card', title: p.hint, onclick: () => go(p) }, lazyThumb(p), make('strong', { textContent: p.label }), make('span', { textContent: p.hint }));
        c.dataset.id = p.id;
        c.setAttribute('role', 'option');
        // A mouse previews on hover. Not a finger or the Pencil: Safari on iPad treats a change
        // made on its emulated hover as "show the hover state" and drops the tap's click.
        c.onpointerenter = (e) => { if (e.pointerType === 'mouse') show(p); };
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
      else if (e.key === 'Enter' && active) { e.preventDefault(); go(active); }
    });
    apply.onclick = () => go(active);
    cancel.onclick = close.onclick = () => finish(null);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    list();
    dialog.showModal();
    search.focus();
  });
}

export { jsonErrorAt } from './json-code.js';

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
  const targetW = Math.max(1, Math.round(size[0] * scale));
  const targetH = Math.max(1, Math.round(size[1] * scale));
  const img = new Image();
  // As a picture it has no page styles: its text takes a sans font, as in the exam pages.
  // Explicitly set the SVG's raster width/height to targetW x targetH (keeping viewBox) so
  // the browser rasterizes vector curves and text at full HiDPI resolution instead of
  // rasterizing at the SVG's base pixel dimensions and upscaling a bitmap.
  let svg = out.svg;
  const rootMatch = svg.match(/<svg\b[^>]*>/);
  if (rootMatch) {
    let root = rootMatch[0];
    if (!/\sfont-family=/.test(root)) {
      root = root.replace('<svg', '<svg font-family="Helvetica, Arial, sans-serif"');
    }
    if (!/\sviewBox=/i.test(root) && out.width && out.height) {
      root = root.replace('<svg', `<svg viewBox="0 0 ${out.width} ${out.height}"`);
    }
    if (!/\spreserveAspectRatio=/i.test(root)) {
      root = root.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
    }
    root = root.replace(/\swidth="[^"]*"/i, '').replace(/\sheight="[^"]*"/i, '');
    root = root.replace('<svg', `<svg width="${targetW}" height="${targetH}"`);
    svg = svg.replace(rootMatch[0], root);
  }
  await imageReady(img, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  try {
    canvas.width = targetW;
    canvas.height = targetH;
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
  const frame = { points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], width: 0.5, rgba: [0.8, 0.84, 0.9, 1], tool: 0, layer, shape: { kind: 'rectangle', start: [x, y], end: [x + w, y + h] }, part: { id, kind: 'prefab', spec: JSON.stringify(stamp(spec)) } };
  const picture = { base64: png.base64, mime: png.mime, bounds: [x, y, w, h], layer, part: { id, kind: 'prefab' } };
  return { lines: [frame], images: [picture] };
}
