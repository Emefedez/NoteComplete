// The Textual Analysis editor (docs/PREFAB-MODULES-GUIDE.md), laid out as Visual Paradigm's:
// the problem statement on top in the app's Markdown editor (TinyMDE with its format bar:
// bold, italic, lists, ==highlights== and =={.red}coloured remarks==), every candidate's
// occurrences highlighted in its colour as you type, a classify bar (a button per type, Alt
// and its number) and Find; the candidate table under it (No. | Candidate Class | Extracted
// Text | Type | Description | Occurrence | Highlight) in a resizable split. On the right: the
// title, what goes on the page, matching, the candidates' tree by folder and the selected
// candidate's folder, owner, merge. A click on a row flashes its words in the text.
import { editorShell, field, textInput, selectInput, checkInput, make, button, orderedIds, saveOrder, keyFor, indexOfKey, sortable } from '../kit/index.js';
import { render, kindIcon } from './render.js';
import { KINDS, SHOWS, normalize, classify, candidateAt, findOccurrences, occurrences, update, setText, merge, move, removeCandidate, suggestName } from './model.js';
import { tinyMdeHighlightGrammar, paintEditorHighlights } from '../../md-highlight.js';
import { textFind } from '../../text-find.js';
import { umlFromAnalysis, withLinks } from './uml-from.js';
import { openContextMenu } from '../../context-menu.js';
import { askRenameScope, promptRenameEverywhere } from '../../model-explorer.js';

const SHOW_LABELS = { both: 'Text and table', text: 'Text only', table: 'Table only' };
// The kind an owner has, for each kind that can have one.
const OWNER_KIND = { attribute: 'class', operation: 'class', usecase: 'actor' };
const SPLIT_KEY = 'notecomplete.textual-analysis.split';
const highlights = typeof Highlight !== 'undefined' && globalThis.CSS?.highlights;

function loadStyles() {
  if (document.querySelector('link[data-textual-analysis-css]')) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./textual-analysis.css', import.meta.url).href });
  link.dataset.textualAnalysisCss = '';
  document.head.append(link);
}

// Character offsets in a text ↔ TinyMDE's { row, col }.
const toIndex = (text, { row, col }) => {
  const lines = text.split('\n');
  let index = 0;
  for (let r = 0; r < Math.min(row, lines.length); r++) index += lines[r].length + 1;
  return Math.min(text.length, index + Math.min(col, lines[Math.min(row, lines.length - 1)]?.length ?? 0));
};
const toRowCol = (text, index) => {
  const before = text.slice(0, Math.max(0, Math.min(index, text.length))).split('\n');
  return { row: before.length - 1, col: before.at(-1).length };
};
const iconSvg = (kind) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '-1 -1 16 16');
  s.setAttribute('class', 'ta-type-icon');
  s.innerHTML = kindIcon(kind, 0, 0);
  return s;
};

export function open(root, { spec, editing, host }) {
  loadStyles();
  let model = normalize(spec);
  const past = [], future = [];
  let view = 'text', editor = null, bar = null, area = null, typingTimer = 0, typingBase = null, lastSel = null, flashTimer = 0, destroyed = false;
  let selected = host.project?.focusCandidateId ? model.candidates.findIndex((c) => c.id === host.project.focusCandidateId) : -1;
  const candidateOccurrences = (c) => (c && host.project?.getOccurrences ? (host.project.getOccurrences(c, model) || []) : []);
  function jumpToDiagram(occ) {
    if (!host.project?.jumpTo) return;
    settleTyping();
    host.project.jumpTo(occ, model);
    host.done(model);
  }
  async function renameCandidateEverywhere(c, idx, nextName) {
    const oldName = c.name;
    if (!nextName || nextName === oldName) return;
    change(update(model, idx, { name: nextName }), { rebuild: false });
    host.project?.renameEverywhere?.(c, oldName, nextName, model);
  }
  function openCandidateMenu(ev, c, i) {
    ev.preventDefault();
    ev.stopPropagation();
    if (selected !== i) { selected = i; drawTable(); drawPanel(); }
    const occs = candidateOccurrences(c);
    const showIn = occs.length > 0 ? {
      label: 'Show in…',
      icon: 'link',
      submenu: occs.map((o) => ({
        label: o.label,
        icon: o.module === 'textual-analysis' ? 'text' : 'uml',
        run: () => jumpToDiagram(o),
      })),
    } : null;
    const renameAll = occs.length > 0 ? {
      label: 'Rename everywhere…',
      icon: 'text',
      run: async () => {
        const res = await promptRenameEverywhere({
          oldName: c.name,
          occurrenceCount: occs.length + 1,
          host: root.closest('dialog') || document.body,
        });
        if (res?.name && res.name !== c.name) {
          await renameCandidateEverywhere(c, i, res.name);
          drawTable();
        }
      },
    } : null;
    openContextMenu(ev.clientX, ev.clientY, [
      showIn,
      renameAll,
      (showIn || renameAll) && '-',
      { label: 'Remove candidate', icon: 'trash', danger: true, run: () => change(removeCandidate(model, i)) },
    ], { title: c.name, host: root.closest('dialog') || document.body });
  }
  const names = []; // CSS highlight names this editor registered
  const shell = editorShell(root, {
    id: 'textual-analysis',
    title: 'Textual analysis',
    applyLabel: host.applyLabel,
    onApply: () => { settleTyping(); host.done(model); },
    onCancel: () => host.cancel(),
    undo: () => step(past, future),
    redo: () => step(future, past),
    help: [{
      title: 'Textual analysis',
      icon: 'text',
      rows: [
        { does: 'Write or paste the problem statement, select words, then press a type above the text: they become a candidate, highlighted in its colour everywhere they appear.' },
        { keys: 'Alt 1 … 6', does: 'Classify the selection as that type (the bar’s order; drag to change it)' },
        { keys: 'Alt Backspace', does: 'Remove the candidate at the cursor (and its highlights)' },
        { keys: 'Ctrl F', does: 'Find in the text' },
        { does: 'Click a row to see its words in the text. Rename it in Candidate Class; the same extracted text twice is one candidate.' },
        { does: 'Format bar: bold, italic, lists (indent for nested), Highlight ▸ colours, underline, text colour for remarks.' },
        { keys: 'Ctrl Z / Ctrl Shift Z', does: 'Undo · redo' },
        { keys: 'Ctrl Enter', does: editing ? 'Apply' : 'Insert' },
        { keys: 'Esc', does: 'Cancel' },
      ],
    }],
  });
  shell.canvas.classList.add('ta-canvas');
  shell.panel.classList.add('ta-panel');

  // ----- History: whole models as JSON. Typing is one step per pause.
  function remember() { past.push(JSON.stringify(model)); future.length = 0; }
  function settleTyping() {
    clearTimeout(typingTimer);
    if (typingBase) { past.push(typingBase); future.length = 0; typingBase = null; }
  }
  function step(from, to) {
    settleTyping();
    if (!from.length) return;
    to.push(JSON.stringify(model));
    model = JSON.parse(from.pop());
    showText();
    draw(true);
  }
  function change(next, { rebuild = true } = {}) {
    settleTyping();
    remember();
    model = normalize(next);
    if (selected >= model.candidates.length) selected = model.candidates.length - 1;
    draw(rebuild);
    paint();
  }
  // A field typed in: one undo step per pause, and nothing rebuilt under the cursor.
  function typing(apply) {
    typingBase ||= JSON.stringify(model);
    apply();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(settleTyping, 800);
    shell.history(true, future.length > 0);
    drawPage();
  }

  // ----- Layout: classify bar, format bar, text, grip, table.
  const classifyBar = make('div', { className: 'ta-classify', role: 'toolbar', ariaLabel: 'Classify the selection' });
  const commands = make('div', { className: 'notes-commands ta-commands' });
  const textHost = make('div', { className: 'ta-text notes-editor' });
  const findInput = make('input', { type: 'search', className: 'ta-find-input', placeholder: 'Find', ariaLabel: 'Find in the text' });
  const findCount = make('span', { className: 'ta-find-count' });
  const findPrev = button('chevronLeft', 'Previous', { iconOnly: true }), findNext = button('chevronRight', 'Next', { iconOnly: true }), findClose = button('close', 'Close Find', { iconOnly: true });
  const findBar = make('div', { className: 'ta-find', hidden: true }, findInput, findCount, findPrev, findNext, findClose);
  const grip = make('div', { className: 'ta-grip', role: 'separator', ariaOrientation: 'horizontal', title: 'Drag to share the height between the text and the table' });
  const table = make('div', { className: 'ta-table' });
  const textPane = make('div', { className: 'ta-text-pane' }, classifyBar, findBar, commands, textHost);
  const pageHost = make('div', { className: 'ta-page', hidden: true });
  const split = make('div', { className: 'ta-split' }, textPane, grip, table);
  shell.canvas.append(split, pageHost);
  try { const h = Number(localStorage.getItem(SPLIT_KEY)); if (h > 60) split.style.setProperty('--ta-table', `${h}px`); } catch { /* Default height. */ }
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startY = e.clientY, start = table.getBoundingClientRect().height, max = split.getBoundingClientRect().height - 120;
    const moveTo = (ev) => split.style.setProperty('--ta-table', `${Math.max(70, Math.min(max, start - (ev.clientY - startY)))}px`);
    const up = () => {
      grip.removeEventListener('pointermove', moveTo);
      try { localStorage.setItem(SPLIT_KEY, String(Math.round(table.getBoundingClientRect().height))); } catch { /* Not kept. */ }
    };
    grip.addEventListener('pointermove', moveTo);
    grip.addEventListener('pointerup', up, { once: true });
  });
  // Clicks on the bar keep the selection in the text.
  classifyBar.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

  const finder = textFind({ bar: findBar, input: findInput, count: findCount, prev: findPrev, next: findNext, close: findClose, root: () => textHost.querySelector('.TinyMDE'), plainEditor: () => area });
  // Esc in Find closes Find, not the editor.
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopPropagation(); });

  const kindIds = () => orderedIds('textual-analysis-kinds', KINDS.map((k) => k.id));
  function drawBar() {
    const buttons = kindIds().map((id, i) => {
      const k = KINDS.find((x) => x.id === id);
      const b = make('button', { type: 'button', className: 'pk-button ta-kind', title: `Classify the selection as ${k.label} (Alt ${keyFor(i)})`, disabled: view !== 'text' }, iconSvg(id), make('span', { textContent: k.label }), make('kbd', { textContent: keyFor(i) }));
      b.dataset.kind = id;
      b.onclick = () => classifySelection(id);
      return b;
    });
    const remove = button('erase', 'Remove', { title: 'Remove the candidate at the cursor and its highlights (Alt Backspace)' });
    remove.disabled = view !== 'text';
    remove.onclick = () => removeAtCursor();
    const find = button('search', 'Find', { iconOnly: true, title: 'Find in the text (Ctrl F)' });
    find.disabled = view !== 'text';
    find.onclick = () => finder.toggle();
    const views = make('div', { className: 'ta-views', role: 'group' }, ...[['text', 'text', 'Edit'], ['page', 'eye', 'Page']].map(([v, ic, label]) => {
      const b = button(ic, label, { title: v === 'page' ? 'The figure as it will be on the page' : 'Edit the text and the candidates' });
      b.setAttribute('aria-pressed', String(view === v));
      b.onclick = () => setView(v);
      return b;
    }));
    classifyBar.replaceChildren(make('div', { className: 'ta-kinds' }, ...buttons), remove, find, make('span', { className: 'pk-spacer' }), views);
    sortable(classifyBar.querySelector('.ta-kinds'), { items: '.ta-kind', key: (el) => el.dataset.kind, onReorder: (ids) => { saveOrder('textual-analysis-kinds', ids); drawBar(); } });
  }
  function setView(v) {
    view = v;
    split.hidden = v !== 'text';
    pageHost.hidden = v !== 'page';
    if (v !== 'text') finder.close();
    drawBar();
    drawPage();
    if (v === 'text') paint();
  }

  // ----- The text: TinyMDE when it loads, else a plain text box (offsets work the same).
  async function mountText() {
    try {
      const { loadEditor, MARKDOWN_COMMANDS } = await import('../../notes.js');
      const TinyMDE = await loadEditor();
      if (destroyed) return;
      editor = new TinyMDE.Editor({ element: textHost, content: model.text, customInlineGrammar: tinyMdeHighlightGrammar(), placeholder: 'Write or paste the problem statement, then select words and classify them…' });
      bar = new TinyMDE.CommandBar({ element: commands, editor, commands: MARKDOWN_COMMANDS.filter((c) => !['insertImage', 'h1'].includes(c)) });
      editor.addEventListener('change', (e) => typed(e.content));
      editor.addEventListener('selection', (e) => { if (e.focus) lastSel = { focus: e.focus, anchor: e.anchor || e.focus }; });
      paint();
    } catch {
      if (destroyed) return;
      area = make('textarea', { className: 'ta-plain', value: model.text, spellcheck: true });
      area.oninput = () => typed(area.value);
      textHost.replaceChildren(area);
    }
  }
  const editorRoot = () => textHost.querySelector('.TinyMDE');
  // Occurrences in the text, in each candidate's colour: CSS highlights over the editor's own
  // text (nothing added to what TinyMDE draws, so typing and the caret are untouched).
  const sheet = make('style');
  document.head.append(sheet);
  let paintFrame = 0;
  function paint() {
    cancelAnimationFrame(paintFrame);
    paintFrame = requestAnimationFrame(() => {
      const r = editorRoot();
      if (!r) return;
      r.querySelectorAll('[data-painted]').forEach((el) => delete el.dataset.painted);
      paintEditorHighlights(r);
      if (!highlights) return;
      for (const n of names.splice(0)) CSS.highlights.delete(n);
      const lines = [...r.children];
      const ranges = model.candidates.map(() => []);
      for (const o of findOccurrences(model)) {
        // An occurrence may run over a line break: one range per line.
        const a = toRowCol(model.text, o.start), b = toRowCol(model.text, o.end);
        for (let row = a.row; row <= b.row; row++) {
          const range = rangeIn(lines[row], row === a.row ? a.col : 0, row === b.row ? b.col : Infinity);
          if (range) ranges[o.index].push(range);
        }
      }
      sheet.textContent = model.candidates.map((c, i) => `::highlight(ta-c${i}) { background-color: ${c.colour}; color: #15181d; }`).join('\n');
      ranges.forEach((list, i) => { if (list.length) { CSS.highlights.set(`ta-c${i}`, new Highlight(...list)); names.push(`ta-c${i}`); } });
    });
  }
  // A Range over columns `from`…`to` of one line element of the editor.
  function rangeIn(lineEl, from, to) {
    if (!lineEl) return null;
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let at = 0, started = false, last = null;
    while (walker.nextNode()) {
      const n = walker.currentNode, len = n.data.length;
      if (!started && from <= at + len) { range.setStart(n, Math.max(0, from - at)); started = true; }
      if (started && to <= at + len) { range.setEnd(n, Math.max(0, to - at)); return range; }
      at += len;
      last = n;
    }
    if (!started || !last) return null;
    range.setEnd(last, last.data.length);
    return range;
  }
  function showText(sel = null) {
    if (editor) {
      if (editor.getContent() !== model.text) editor.setContent(model.text);
      if (sel) { const focus = toRowCol(model.text, sel.to), anchor = toRowCol(model.text, sel.from); editor.setSelection(focus, anchor); lastSel = { focus, anchor }; }
    } else if (area) {
      if (area.value !== model.text) area.value = model.text;
      if (sel) area.setSelectionRange(sel.from, sel.to);
    }
    paint();
  }
  // The text typed: the counts follow at once, one undo step per pause.
  function typed(text) {
    if (text === model.text) return;
    typing(() => { model = { ...model, text }; });
    drawTableCounts();
    paint();
  }
  function selection() {
    if (area) return { from: area.selectionStart, to: area.selectionEnd };
    if (!editor) return null;
    const focus = editor.getSelection(false) || lastSel?.focus, anchor = editor.getSelection(true) || lastSel?.anchor || focus;
    if (!focus) return null;
    const a = toIndex(model.text, focus), b = toIndex(model.text, anchor);
    return { from: Math.min(a, b), to: Math.max(a, b) };
  }
  function classifySelection(kind) {
    if (view !== 'text') return;
    const sel = selection();
    const done = sel && sel.to > sel.from && classify(model, sel.from, sel.to, kind);
    if (!done) return shell.say('Select words in the text first.');
    selected = done.index;
    change(done.model);
    const c = model.candidates[done.index];
    shell.say(done.added ? `New candidate ${c.name} (${KINDS.find((k) => k.id === kind).label}): ${occurrences(model)[done.index]} in the text. Rename it in the table.` : `${c.name} is now a ${KINDS.find((k) => k.id === kind).label.toLowerCase()}.`);
    flash(done.index, false);
  }
  function removeAtCursor() {
    const sel = selection();
    const i = sel ? candidateAt(model, sel.from) : -1;
    if (i < 0) return shell.say('Put the cursor in a highlighted word to remove its candidate.');
    const gone = model.candidates[i].name;
    change(removeCandidate(model, i));
    shell.say(`${gone} removed, with its highlights.`);
  }

  // Alt and a number classifies (the bar's order), Alt Backspace removes, Ctrl F finds. Caught
  // before the editor so the text does not get the key.
  const keys = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'f' && view === 'text') { e.preventDefault(); e.stopPropagation(); finder.open(); return; }
      if (k === 'z') { e.preventDefault(); e.stopPropagation(); step(e.shiftKey ? future : past, e.shiftKey ? past : future); return; }
      if (k === 'y' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); step(future, past); return; }
    }
    if (e.ctrlKey || e.metaKey || !e.altKey) return;
    const digit = /^Digit(\d)$/.exec(e.code)?.[1];
    if (digit != null) {
      const id = kindIds()[indexOfKey(digit)];
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      classifySelection(id);
    } else if (e.key === 'Backspace') {
      e.preventDefault(); e.stopPropagation();
      removeAtCursor();
    }
  };
  root.addEventListener('keydown', keys, true);

  // ----- Flash: a candidate's words in the text, for a moment.
  function flash(i, scroll = true) {
    const r = editorRoot();
    if (!r || view !== 'text' || !model.candidates[i]) return;
    const lines = [...r.children];
    const list = [];
    for (const o of findOccurrences(model).filter((x) => x.index === i)) {
      const a = toRowCol(model.text, o.start), b = toRowCol(model.text, o.end);
      const range = a.row === b.row ? rangeIn(lines[a.row], a.col, b.col) : rangeIn(lines[a.row], a.col, Infinity);
      if (range) list.push(range);
    }
    clearTimeout(flashTimer);
    if (!list.length) return shell.say(`“${model.candidates[i].text}” is not in the text.`);
    if (highlights) {
      const h = new Highlight(...list);
      h.priority = 2;
      CSS.highlights.set('ta-flash', h);
      flashTimer = setTimeout(() => CSS.highlights.delete('ta-flash'), 1400);
    }
    if (scroll) {
      const top = list[0].getBoundingClientRect().top - textHost.getBoundingClientRect().top;
      if (top < 0 || top > textHost.clientHeight - 30) textHost.scrollTop += top - textHost.clientHeight / 3;
    }
  }

  // ----- The candidate table.
  function drawTable() {
    const counts = occurrences(model);
    const head = make('tr', {}, ...['No.', 'Candidate Class', 'Extracted Text', 'Type', 'Description', 'Occurrence', 'Highlight', ''].map((t) => make('th', { textContent: t })));
    const rows = model.candidates.map((c, i) => {
      const name = make('input', { type: 'text', value: c.name, spellcheck: false, ariaLabel: 'Candidate class (model name)', placeholder: suggestName(c.text, c.kind) });
      name.onchange = async () => {
        const oldName = c.name;
        const nextName = name.value.trim() || suggestName(c.text, c.kind);
        change(update(model, i, { name: nextName }), { rebuild: false });
        if (nextName !== oldName) {
          const occs = candidateOccurrences(c);
          if (occs.length > 0) {
            const scope = await askRenameScope({
              oldName,
              newName: nextName,
              otherCount: occs.length,
              otherLabels: occs.map((o) => o.label),
              host: root.closest('dialog') || document.body,
            });
            if (scope === 'everywhere') host.project?.renameEverywhere?.(c, oldName, nextName, model);
          }
        }
      };
      name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
      const text = make('input', { type: 'text', value: [c.text, ...(c.aliases || [])].join(', '), spellcheck: false, ariaLabel: 'Extracted text', title: 'The words it stands for in the text (another candidate’s words merge the two)' });
      text.onchange = () => { const [first] = text.value.split(','); change(setText(model, i, first)); };
      text.onkeydown = (e) => { if (e.key === 'Enter') text.blur(); };
      const type = selectInput(KINDS.map((k) => [k.id, k.label]), c.kind, (kind) => change(update(model, i, { kind })));
      type.ariaLabel = 'Type';
      const desc = make('textarea', { rows: 1, value: c.description, ariaLabel: 'Description' });
      desc.oninput = () => typing(() => { model.candidates[i].description = desc.value; });
      const colour = make('input', { type: 'color', value: c.colour, title: 'Highlight colour' });
      colour.oninput = () => { model.candidates[i].colour = colour.value; paint(); drawPage(); };
      colour.onchange = () => { const v = colour.value; model.candidates[i].colour = c.colour; change(update(model, i, { colour: v }), { rebuild: false }); };
      const up = button('collapse', 'Move up', { iconOnly: true });
      up.disabled = i === 0;
      up.onclick = () => { selected = i - 1; change(move(model, i, i - 1)); };
      const down = button('down', 'Move down', { iconOnly: true });
      down.disabled = i === model.candidates.length - 1;
      down.onclick = () => { selected = i + 1; change(move(model, i, i + 1)); };
      const del = button('trash', 'Delete the candidate (its highlights go too)', { iconOnly: true });
      del.onclick = () => change(removeCandidate(model, i));
      const tr = make('tr', { className: i === selected ? 'selected' : '' },
        make('td', { className: 'ta-no', textContent: String(i + 1) }),
        make('td', {}, name), make('td', {}, text),
        make('td', { className: 'ta-type' }, iconSvg(c.kind), type),
        make('td', {}, desc),
        make('td', { className: 'ta-occ', textContent: String(counts[i]) }),
        make('td', { className: 'ta-hl' }, colour),
        make('td', { className: 'ta-actions' }, up, down, del));
      tr.addEventListener('pointerdown', (e) => {
        if (selected !== i) { selected = i; table.querySelectorAll('tr.selected').forEach((r) => r.classList.remove('selected')); tr.classList.add('selected'); drawPanel(); }
        if (!e.target.closest('button, select, input[type="color"]')) flash(i);
      });
      tr.addEventListener('contextmenu', (e) => openCandidateMenu(e, c, i));
      return tr;
    });
    const empty = !rows.length && make('p', { className: 'ta-empty', textContent: 'No candidates yet. Select words in the text and press a type above it (or Alt and its number).' });
    table.replaceChildren(make('table', {}, make('thead', {}, head), make('tbody', {}, ...rows)), empty || '');
  }
  function drawTableCounts() {
    const counts = occurrences(model);
    table.querySelectorAll('td.ta-occ').forEach((td, i) => { td.textContent = String(counts[i] ?? 0); });
  }

  // ----- The panel: title, page, matching, the tree, the selected candidate.
  function drawPanel() {
    const counts = occurrences(model);
    const folders = new Map();
    model.candidates.forEach((c, i) => { const f = c.folder || ''; if (!folders.has(f)) folders.set(f, []); folders.get(f).push(i); });
    const tree = make('div', { className: 'ta-tree', role: 'tree' }, ...[...folders.entries()].sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b)).map(([folder, list]) => make('div', { className: 'ta-folder', role: 'group' },
      make('div', { className: 'ta-folder-name', textContent: folder || 'Candidate Items' }),
      ...list.map((i) => {
        const c = model.candidates[i];
        const occs = candidateOccurrences(c);
        const linkCount = occs.length || (c.uml?.length ? new Set(c.uml.map((u) => u.diagram)).size : 0);
        const umlMark = linkCount ? make('small', {
          className: `ta-uml-mark${occs.length ? ' linked' : ''}`,
          textContent: linkCount > 1 ? `UML · ${linkCount}` : 'UML',
          title: occs.length ? 'Click to jump to linked UML diagram' : `In ${linkCount} UML diagram(s)`,
        }) : null;
        if (umlMark && occs.length) {
          umlMark.onclick = (ev) => {
            ev.stopPropagation();
            if (occs.length === 1) jumpToDiagram(occs[0]);
            else openCandidateMenu(ev, c, i);
          };
        }
        const item = make('button', { type: 'button', className: `ta-tree-item${i === selected ? ' selected' : ''}`, role: 'treeitem', title: linkCount ? `In ${linkCount} UML diagram(s) — right-click for Show in…` : '' }, iconSvg(c.kind), make('span', { textContent: c.name }), umlMark, make('small', { textContent: String(counts[i]) }));
        item.onclick = () => { selected = i; drawTable(); drawPanel(); flash(i); };
        item.oncontextmenu = (ev) => openCandidateMenu(ev, c, i);
        return item;
      }))));
    const c = model.candidates[selected];
    let details = [];
    if (c) {
      const folderList = make('datalist', { id: 'ta-folders' }, ...[...new Set(['Clases', 'Actores', 'Casos de uso', ...model.candidates.map((x) => x.folder).filter(Boolean)])].map((f) => make('option', { value: f })));
      const folder = make('input', { type: 'text', value: c.folder || '', placeholder: 'No folder' });
      folder.setAttribute('list', 'ta-folders');
      folder.onchange = () => change(update(model, selected, { folder: folder.value.trim() }), { rebuild: false });
      const ownerKind = OWNER_KIND[c.kind];
      const owners = ownerKind ? model.candidates.filter((o) => o.kind === ownerKind) : [];
      const owner = ownerKind ? selectInput([['', ownerKind === 'class' ? 'No class' : 'No actor'], ...owners.map((o) => [o.name, o.name])], c.owner || '', (value) => change(update(model, selected, { owner: value }))) : null;
      const others = model.candidates.map((o, j) => [String(j), o.name]).filter(([j]) => Number(j) !== selected);
      const mergeInto = others.length ? selectInput([['', 'Merge into…'], ...others], '', (j) => { if (j !== '') { const into = Number(j); selected = into > selected ? into - 1 : into; change(merge(model, model.candidates.indexOf(c), into)); } }) : null;
      const occs = candidateOccurrences(c);
      const showInLinks = occs.length ? make('div', { className: 'ta-links' }, ...occs.map((o) => {
        const b = make('button', { type: 'button', className: 'ta-link-btn', textContent: o.label, title: `Jump to ${o.label}` });
        b.onclick = () => jumpToDiagram(o);
        return b;
      })) : null;
      details = [
        make('h4', { textContent: `Selected: ${c.name}` }),
        showInLinks && field('Show in…', showInLinks, 'Linked UML diagrams for this candidate'),
        field('Folder', make('div', {}, folder, folderList), 'Groups it in the tree above'),
        owner && field(ownerKind === 'class' ? 'Belongs to class' : 'Used by actor', owner, ownerKind === 'class' ? 'Its compartment in the class diagram' : 'An association in the use case diagram'),
        mergeInto && field('Merge', mergeInto, 'Its extracted text then counts for the other candidate'),
      ];
    }
    // Create UML diagrams: classes (with their attributes and operations) and actors and use
    // cases, as new UML prefabs, each opened in the diagram editor and put on the page after
    // this one; the candidates keep which elements came from them.
    const kinds = new Set(model.candidates.map((x) => x.kind));
    const makeUml = button('uml', 'Create UML diagrams', { title: 'Classes with their attributes and operations become a class diagram; actors and use cases a use case diagram. Each opens in the diagram editor, then goes on the page.' });
    makeUml.disabled = !host.insert || !['class', 'actor', 'usecase'].some((k) => kinds.has(k));
    makeUml.onclick = () => createUml();
    const linked = model.candidates.filter((x) => x.uml?.length).length;
    shell.panel.replaceChildren(
      make('h4', { textContent: 'UML' }),
      makeUml,
      make('small', { className: 'ta-note', textContent: !host.insert ? 'Open this analysis from a note to make diagrams from it.' : linked ? `${linked} candidate${linked === 1 ? '' : 's'} already in a diagram; making them again adds new diagrams.` : `${host.applyLabel}s this analysis, then opens each diagram.` }),
      field('Title', textInput(model.title, (title) => typing(() => { model.title = title; }))),
      field('On the page', selectInput(SHOWS.map((s) => [s, SHOW_LABELS[s]]), model.show, (show) => change({ ...model, show }, { rebuild: false }))),
      make('h4', { textContent: 'Matching' }),
      checkInput('Plurals count too (-s, -es)', model.match.plural, (plural) => change({ ...model, match: { ...model.match, plural } })),
      checkInput('Ignore accents (é = e)', model.match.accents, (accents) => change({ ...model, match: { ...model.match, accents } })),
      make('h4', { textContent: `Candidates (${model.candidates.length})` }),
      tree,
      ...details,
    );
  }
  function createUml() {
    if (!host.insert) return;
    settleTyping();
    const { diagrams, links, skipped } = umlFromAnalysis(model);
    if (!diagrams.length) return shell.say('No class, actor or use case candidates to make diagrams from.', true);
    model = normalize(withLinks(model, links));
    for (const d of diagrams) host.insert(d);
    if (skipped.length) console.info(`Textual analysis: no class for ${skipped.join(', ')}`);
    host.done(model);
  }
  function drawPage() {
    if (view === 'page') pageHost.innerHTML = render(model).svg;
  }
  // Everything follows the model; a field being typed in keeps its focus (`rebuild` false
  // leaves the table as it is).
  function draw(rebuild = true) {
    shell.history(past.length > 0 || !!typingBase, future.length > 0);
    drawPage();
    const active = document.activeElement;
    const typingInTable = active && table.contains(active) && active.matches('input[type="text"], textarea');
    if (rebuild && !typingInTable) drawTable(); else drawTableCounts();
    if (!(active && shell.panel.contains(active) && active.matches('input[type="text"], textarea'))) drawPanel();
  }

  drawBar();
  draw();
  mountText();
  return {
    destroy() {
      destroyed = true;
      clearTimeout(typingTimer);
      clearTimeout(flashTimer);
      cancelAnimationFrame(paintFrame);
      finder.close();
      if (highlights) { for (const n of names) CSS.highlights.delete(n); CSS.highlights.delete('ta-flash'); }
      sheet.remove();
      bar?.destroy?.();
      root.removeEventListener('keydown', keys, true);
      shell.destroy();
    },
  };
}
