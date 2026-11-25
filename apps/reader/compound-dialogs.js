// The editors of graphs and tables (graph.js, table.js), the shipped "window" prefab modules
// (prefabs/graph, prefabs/table): what a graph or table is, changed in a movable window over
// the page (the kit's movableWindow, not modal: the page stays in sight and scrolls behind it)
// with a live preview, then drawn (again) on the page as one undo step. The math keypad
// (math-keypad.js) types into a graph's function fields, inside the window.
import { graphSpec, graphItems } from './graph.js';
import { tableSpec, tableItems, tableNaturalSize, resized, TINTS, BACKGROUNDS, BORDERS, TEXT_SIZES, MAX_ROWS, MAX_COLUMNS, mergeAt, anchorOf, mergeArea, mergeCells, splitCell, insertLines, deleteLines, areaAnchors, formatOf, formatCells, sortRows, canSort, pasteBlock } from './table.js';
import { clipboardBlock } from './table-paste.js';
import { icon } from './icons.js';
import { loadKatex } from './rich-text.js';
import { movableWindow } from './prefabs/kit/window.js';

const SVG = 'http://www.w3.org/2000/svg';
const rgb = ([r, g, b]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
const make = (tag, props = {}, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
};
const iconButton = (glyph, title, onclick, className = 'icon-button') => {
  const b = make('button', { type: 'button', className, title, onclick });
  b.setAttribute('aria-label', title);
  b.append(icon(glyph));
  return b;
};
const hex = (rgba) => `rgb(${rgba.slice(0, 3).map((c) => Math.round(c * 255)).join(',')})`;

// The items a graph or table is made of, drawn small: lines as polylines (fills as polygons,
// highlighter bands blended under the ink as on the page, clear lines left out), text boxes as
// text laid out as the core lays them out (core text.rs: 5 in from the box's sides, lines at least
// 15 apart, aligned by the box's align).
export function previewSvg({ lines, images }, box, size = [360, 240], pad = 26) {
  const svg = document.createElementNS(SVG, 'svg');
  const [bx, by, bw, bh] = box;
  svg.setAttribute('viewBox', `${bx - pad} ${by - pad} ${bw + 2 * pad} ${bh + 2 * pad}`);
  svg.setAttribute('width', size[0]);
  svg.setAttribute('height', size[1]);
  svg.classList.add('compound-preview');
  for (const l of lines) {
    const fill = l.shape?.fill;
    if (!fill && l.rgba[3] === 0) continue;
    const el = document.createElementNS(SVG, fill ? 'polygon' : 'polyline');
    el.setAttribute('points', l.points.map((p) => p.join(',')).join(' '));
    el.setAttribute('fill', fill ? hex(fill) : 'none');
    el.setAttribute('stroke', fill ? 'none' : hex(l.rgba));
    el.setAttribute('stroke-width', l.width);
    el.setAttribute('stroke-linecap', l.square ? 'butt' : 'round');
    el.setAttribute('stroke-linejoin', l.square ? 'miter' : 'round');
    if (l.rgba[3] < 1) el.setAttribute('opacity', l.rgba[3]);
    if (l.tool === 1) el.style.mixBlendMode = 'multiply';
    svg.append(el);
  }
  for (const i of images) {
    const t = document.createElementNS(SVG, 'text'), [x, y, w] = i.bounds, size_ = i.text.font_size, step = Math.max(15, size_);
    const align = i.text.align || 0;
    t.setAttribute('font-size', size_);
    t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
    t.setAttribute('text-anchor', ['start', 'middle', 'end'][align]);
    if (i.text.bold) t.setAttribute('font-weight', '700');
    if (i.text.italic) t.setAttribute('font-style', 'italic');
    t.setAttribute('fill', hex(i.text.rgba));
    i.text.text.split('\n').forEach((line, k) => {
      const span = document.createElementNS(SVG, 'tspan');
      span.setAttribute('x', align === 1 ? x + w / 2 : align === 2 ? x + w - 5 : x + 5);
      span.setAttribute('y', y + 8 + step * (k + 1));
      span.textContent = line;
      t.append(span);
    });
    svg.append(t);
  }
  return svg;
}

// The window both editors are built in: its body, an error line and Cancel / Insert at its foot.
// `finish(null)` is what Esc and × do.
function windowShell(key, title, { width, height = null, minWidth, minHeight }) {
  let finish = () => {};
  const win = movableWindow({ key, title, width, height, minWidth, minHeight, className: 'compound-window', onClose: () => finish(null), onApply: () => apply.click() });
  const body = win.body;
  body.classList.add('compound-body');
  const error = make('p', { className: 'compound-error', role: 'status' });
  const cancel = make('button', { type: 'button', textContent: 'Cancel' });
  const apply = make('button', { type: 'button', className: 'primary', textContent: 'Insert' });
  win.foot.classList.add('ocr-actions');
  win.foot.append(error, cancel, apply);
  return { win, body, error, cancel, apply, onFinish: (fn) => { finish = fn; } };
}

// Opens the graph editor. `spec`: the graph's (or {} for a new one); `editing`: Apply instead of
// Insert. Resolves with the new spec, or null when cancelled.
export function editGraph({ spec = {}, editing = false, rgba, keypad = null } = {}) {
  return new Promise((resolve) => {
    let value = graphSpec(spec);
    if (!value.functions.length) value.functions = [''];
    const { win, body, error, cancel, apply, onFinish } = windowShell('graph', editing ? 'Edit graph' : 'Insert graph', { width: 560, minWidth: 320, minHeight: 260 });
    apply.textContent = editing ? 'Apply' : 'Insert';
    const list = make('div', { className: 'graph-functions' });
    const preview = make('div', { className: 'compound-preview-box' });
    const num = (label, v, step = 'any') => {
      const input = make('input', { type: 'number', step, value: String(v) });
      input.setAttribute('aria-label', label);
      return input;
    };
    const x0 = num('x from', value.x[0]), x1 = num('x to', value.x[1]);
    const yAuto = make('input', { type: 'checkbox', checked: !value.y });
    const y0 = num('y from', value.y?.[0] ?? -5), y1 = num('y to', value.y?.[1] ?? 5);
    const grid = make('input', { type: 'checkbox', checked: value.grid });
    const numbers = make('input', { type: 'checkbox', checked: value.numbers });
    const ranges = make('div', { className: 'graph-ranges' },
      make('label', {}, 'x from ', x0, ' to ', x1),
      make('label', {}, yAuto, ' y fits the curves'),
      make('label', { className: 'graph-y' }, 'y from ', y0, ' to ', y1),
      make('label', {}, grid, ' Grid'),
      make('label', {}, numbers, ' Numbers'));
    const add = make('button', { type: 'button', className: 'graph-add', onclick: () => { addRow(''); refresh(); list.querySelector('.graph-row:last-child input')?.focus({ preventScroll: true }); } });
    add.append(icon('plus'), ' Function');
    body.append(list, add, ranges, preview);
    const COLOURS = [rgba || [0.14, 0.42, 0.81, 1], [0.82, 0.29, 0.36, 1], [0.16, 0.62, 0.39, 1], [0.56, 0.31, 0.78, 1], [0.94, 0.55, 0, 1]];
    function addRow(text) {
      const input = make('input', { type: 'text', value: text, placeholder: 'y = \\sin x', spellcheck: false, autocomplete: 'off' });
      input.setAttribute('aria-label', 'Function of x (LaTeX)');
      const typeset = make('span', { className: 'graph-typeset' });
      const swatch = make('span', { className: 'graph-swatch' });
      const remove = iconButton('close', 'Remove this function', () => { row.remove(); refresh(); });
      const row = make('div', { className: 'graph-row' }, swatch, input, typeset, remove);
      input.addEventListener('input', refresh);
      input.addEventListener('focus', () => keypad?.attach(input));
      list.append(row);
    }
    value.functions.forEach(addRow);
    let katex = null;
    loadKatex().then((k) => { katex = k; refresh(); }).catch(() => { /* Optional. */ });
    function read() {
      const range = (a, b) => [Number(a.value), Number(b.value)];
      return graphSpec({
        functions: [...list.querySelectorAll('input')].map((i) => i.value),
        x: range(x0, x1),
        y: yAuto.checked ? null : range(y0, y1),
        grid: grid.checked,
        numbers: numbers.checked,
      });
    }
    function refresh() {
      ranges.querySelector('.graph-y').hidden = yAuto.checked;
      [...list.children].forEach((row, i) => {
        row.querySelector('.graph-swatch').style.background = hex(COLOURS[i % COLOURS.length]);
        const tex = row.querySelector('input').value.trim(), out = row.querySelector('.graph-typeset');
        if (katex && tex) katex.render(tex, out, { throwOnError: false });
        else out.textContent = '';
      });
      value = read();
      const box = [0, 0, 400, 280];
      try {
        const items = graphItems(box, value, { rgba: COLOURS[0], width: 2 });
        preview.replaceChildren(previewSvg(items, box));
        error.textContent = '';
        apply.disabled = false;
      } catch (e) {
        error.textContent = e.message;
        apply.disabled = true;
      }
    }
    for (const el of [x0, x1, yAuto, y0, y1, grid, numbers]) el.addEventListener('input', refresh);
    refresh();
    let done = false;
    const finish = (result) => { if (done) return; done = true; keypad?.detach(); keypad?.mount(document.body); win.destroy(); resolve(result); };
    onFinish(finish);
    cancel.onclick = () => finish(null);
    apply.onclick = () => { if (!apply.disabled) finish(read()); };
    // The keypad shows inside the window, under the functions, in its flow so it never covers
    // the buttons (and moves with the window).
    keypad?.mount(body);
    list.querySelector('input')?.focus({ preventScroll: true });
  });
}

// Opens the table editor: a grid of cells to type in, rows and columns added or removed where
// the cursor is, cells merged into one and split again, their looks (bold, italic, alignment,
// fill) set on the chosen cells, columns and rows sized by dragging their edges, a range pasted
// from a spreadsheet, rows sorted, every change undoable, and a preview of the table as it will
// be drawn. Resolves with the new spec, or null.
const PREVIEW_KEY = 'notecomplete-table-preview';
const columnName = (c) => (c >= 26 ? String.fromCharCode(64 + Math.floor(c / 26)) : '') + String.fromCharCode(65 + (c % 26));
export function editTable({ spec = {}, editing = false } = {}) {
  return new Promise((resolve) => {
    // A new table's rows fit their text.
    let value = tableSpec(!editing && !spec.cells ? { ...spec, fit: true } : spec);
    const { win, body, error, cancel, apply, onFinish } = windowShell('table', editing ? 'Edit table' : 'Insert table', { width: 600, minWidth: 340, minHeight: 260 });
    apply.textContent = editing ? 'Apply' : 'Insert';
    const grid = make('div', { className: 'table-grid' });
    // `at`: the cell with the cursor (the first cell of its merge). `sel`: cells chosen (to merge,
    // give a look or clear), from one cell to another, or null.
    let at = [0, 0], sel = null;
    const span = () => { const m = mergeAt(value, ...at); return m ? [m[2], m[3]] : [1, 1]; };
    const area = () => { const a = sel && mergeArea(value, sel.from, sel.to); return a && a[2] * a[3] > 1 ? a : null; };
    // The cells a look or Delete acts on: the chosen ones, or the cursor's.
    const targets = () => (area() ? areaAnchors(value, area()) : [anchorOf(value, ...at)]);

    // Undo and redo over the whole table (and where the cursor was). Typing in one cell is one step.
    const past = [], future = [];
    let typing = null;
    const snapshot = () => JSON.stringify({ value, at });
    const remember = () => { past.push(snapshot()); if (past.length > 200) past.shift(); future.length = 0; typing = null; };
    const restore = (from, to) => {
      if (!from.length) return;
      to.push(snapshot());
      const state = JSON.parse(from.pop());
      value = tableSpec(state.value);
      sel = null; typing = null;
      draw(state.at);
    };
    const undo = () => restore(past, future), redo = () => restore(future, past);

    const mergeButton = iconButton('cellsMerge', 'Merge cells (select them first: Shift + click, Shift + arrows or drag)', () => {
      const a = area();
      if (a) change(mergeCells(value, sel.from, sel.to), [a[0], a[1]]);
    });
    const splitButton = iconButton('cellsSplit', 'Split merged cell', () => change(splitCell(value, ...at), at));
    const sortUp = iconButton('sortAsc', 'Sort rows by this column, A to Z and 1 to 9 (the header row stays)', () => change(sortRows(value, at[1], 1), at));
    const sortDown = iconButton('sortDesc', 'Sort rows by this column, Z to A and 9 to 1', () => change(sortRows(value, at[1], -1), at));
    const undoButton = iconButton('undo', 'Undo (Ctrl+Z)', undo), redoButton = iconButton('redo', 'Redo (Ctrl+Shift+Z)', redo);
    let previewOn = false;
    try { previewOn = localStorage.getItem(PREVIEW_KEY) === 'on'; } catch { /* Folded by default, like process timeline. */ }
    const togglePreview = () => {
      previewOn = !previewOn;
      try { localStorage.setItem(PREVIEW_KEY, previewOn ? 'on' : 'off'); } catch { /* For this window only. */ }
      showPreview();
    };
    const previewButton = iconButton('eye', 'Show or hide the table as it will look on the page', togglePreview);
    const tools = make('div', { className: 'table-tools' },
      iconButton('rowAbove', 'Row above', () => add(0, at[0], at)),
      iconButton('rowBelow', 'Row below', () => { const below = at[0] + span()[0]; add(0, below, [below, at[1]]); }),
      iconButton('colLeft', 'Column left', () => add(1, at[1], at)),
      iconButton('colRight', 'Column right', () => { const right = at[1] + span()[1]; add(1, right, [at[0], right]); }),
      iconButton('rowDelete', 'Delete row', () => value.cells.length > 1 && change(deleteLines(value, 0, at[0]), [Math.max(0, at[0] - 1), at[1]])),
      iconButton('colDelete', 'Delete column', () => value.cells[0].length > 1 && change(deleteLines(value, 1, at[1]), [at[0], Math.max(0, at[1] - 1)])),
      make('span', { className: 'table-tools-gap' }),
      mergeButton, splitButton,
      make('span', { className: 'table-tools-gap' }),
      sortUp, sortDown,
      make('span', { className: 'spacer' }),
      undoButton, redoButton, previewButton,
    );
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'Rows and columns');

    // The format bar: the looks of the chosen cells (or the cursor's).
    const isHead = (r, c) => (value.header && value.cells.length > 1 && r === 0) || (!!value.headerColumn && value.cells[0].length > 1 && c === 0);
    const lookOf = (r, c) => {
      const f = formatOf(value, r, c), [ar, ac] = anchorOf(value, r, c);
      return { bold: f.bold ?? isHead(ar, ac), italic: !!f.italic, align: f.align || (mergeAt(value, r, c) ? 'center' : 'left'), valign: f.valign || 'middle', fill: f.fill || null };
    };
    // A look given to the target cells; a value that is what the cell has anyway is not kept.
    const setLook = (field, next) => {
      remember();
      for (const [r, c] of targets()) {
        const plain = field === 'bold' ? isHead(r, c) : field === 'italic' ? false : field === 'valign' ? 'middle' : field === 'align' && !mergeAt(value, r, c) ? 'left' : null;
        value = formatCells(value, [[r, c]], { [field]: next === plain ? null : next });
      }
      draw(at);
    };
    const toggle = (field) => setLook(field, !lookOf(...at)[field]);
    const bar = {
      bold: iconButton('bold', 'Bold (Ctrl+B)', () => toggle('bold')),
      italic: iconButton('italic', 'Italic (Ctrl+I)', () => toggle('italic')),
      left: iconButton('alignLeft', 'Align left', () => setLook('align', 'left')),
      center: iconButton('alignCenter', 'Centre', () => setLook('align', 'center')),
      right: iconButton('alignRight', 'Align right', () => setLook('align', 'right')),
      top: iconButton('alignTop', 'Top', () => setLook('valign', 'top')),
      middle: iconButton('alignMiddle', 'Middle', () => setLook('valign', 'middle')),
      bottom: iconButton('alignBottom', 'Bottom', () => setLook('valign', 'bottom')),
    };
    const fillNone = make('button', { type: 'button', className: 'table-swatch table-fill table-fill-none', title: 'No fill' });
    fillNone.setAttribute('aria-label', 'No fill');
    fillNone.onclick = () => setLook('fill', null);
    const fills = Object.entries(TINTS).map(([key, tint]) => {
      const swatch = make('button', { type: 'button', className: 'table-swatch table-fill', title: `${tint.label} fill` });
      swatch.setAttribute('aria-label', `${tint.label} fill`);
      swatch.dataset.fill = key;
      swatch.style.background = rgb(tint.head);
      swatch.onclick = () => setLook('fill', key);
      return swatch;
    });
    const clearLook = iconButton('clearFormat', 'Clear the looks of these cells', () => {
      remember();
      value = formatCells(value, targets(), { bold: null, italic: null, align: null, valign: null, fill: null });
      draw(at);
    });
    const fillIcon = make('span', { className: 'table-fill-icon', title: 'Fill' }, icon('fillColor'));
    const format = make('div', { className: 'table-tools table-format' },
      bar.bold, bar.italic, make('span', { className: 'table-tools-gap' }),
      bar.left, bar.center, bar.right, make('span', { className: 'table-tools-gap' }),
      bar.top, bar.middle, bar.bottom, make('span', { className: 'table-tools-gap' }),
      fillIcon, make('span', { className: 'table-swatches' }, fillNone, ...fills), make('span', { className: 'table-tools-gap' }),
      clearLook);
    format.setAttribute('role', 'toolbar');
    format.setAttribute('aria-label', 'Cell format');

    // The look of the whole table.
    const select = (label, options, current, onchange) => {
      const el = make('select', {}, ...Object.entries(options).map(([key, text]) => make('option', { value: key, textContent: text })));
      el.setAttribute('aria-label', label);
      el.value = current;
      el.addEventListener('input', () => onchange(el.value));
      return el;
    };
    const header = make('input', { type: 'checkbox', checked: value.header });
    const headerColumn = make('input', { type: 'checkbox', checked: !!value.headerColumn });
    header.addEventListener('input', () => change(tableSpec({ ...value, header: header.checked }), at));
    headerColumn.addEventListener('input', () => change(tableSpec({ ...value, headerColumn: headerColumn.checked }), at));
    const background = select('Background', BACKGROUNDS, value.background, (v) => change(tableSpec({ ...value, background: v }), at));
    const swatches = Object.entries(TINTS).map(([key, tint]) => {
      const swatch = make('button', { type: 'button', className: 'table-swatch', title: tint.label });
      swatch.setAttribute('aria-label', `${tint.label} background`);
      swatch.dataset.tint = key;
      swatch.style.background = rgb(tint.head);
      swatch.onclick = () => change(tableSpec({ ...value, tint: key }), at);
      return swatch;
    });
    const borders = select('Borders', BORDERS, value.borders || 'all', (v) => change(tableSpec({ ...value, borders: v }), at));
    const sizes = select('Text size', Object.fromEntries(Object.entries(TEXT_SIZES).map(([k, s]) => [k, s.label])), value.size || 'auto', (v) => change(tableSpec({ ...value, size: v }), at));
    const rowsLook = select('Row heights', { equal: 'Equal', fit: 'Fit text', custom: 'Dragged' }, 'equal', (v) => change(tableSpec({ ...value, heights: null, fit: v === 'fit' }), at));
    rowsLook.querySelector('[value=custom]').disabled = true;
    const look = make('div', { className: 'table-tools table-look' },
      make('label', {}, header, ' Header row'), make('label', {}, headerColumn, ' Header column'),
      make('label', {}, 'Background ', background), make('span', { className: 'table-swatches' }, ...swatches),
      make('label', {}, 'Borders ', borders), make('label', {}, 'Text ', sizes), make('label', {}, 'Rows ', rowsLook));
    const previewFold = make('button', { type: 'button', className: 'table-preview-fold', title: 'Show or hide the table as it will look on the page', onclick: togglePreview }, icon('chevronDown'), make('span', { textContent: 'On the page' }));
    const preview = make('div', { className: 'compound-preview-box table-preview' });
    preview.setAttribute('aria-label', 'Preview');
    const previewBox = make('div', { className: 'table-preview-box' }, previewFold, preview);
    const hint = make('p', { className: 'muted', textContent: 'Tab and the arrow keys move between cells; Tab in the last cell adds a row. Shift + click, Shift + arrows or a drag choose cells; Delete clears them. Paste a range from a spreadsheet. Drag the edges of the column letters or row numbers to size them (double-click: all equal). $…$ in a cell is math.' });
    body.append(tools, format, look, grid, previewBox, hint);

    // `next`: the table after a change (table.js insertLines, sortRows…), as one undo step.
    function change(next, focus) {
      remember();
      value = tableSpec(next);
      sel = null;
      draw(focus);
    }
    // A row (axis 0) or column (axis 1) inserted before `at`, unless the table is at its limit.
    function add(axis, before, focus) {
      const next = insertLines(value, axis, before);
      if (next.cells.length === value.cells.length && next.cells[0].length === value.cells[0].length) { error.textContent = `Up to ${MAX_ROWS} rows and ${MAX_COLUMNS} columns.`; return; }
      change(next, focus);
    }
    // The text field showing a cell: the one of its merge when it is merged.
    function cell(r, c) {
      if (r < 0 || c < 0 || r >= value.cells.length || c >= value.cells[0].length) return null;
      const [ar, ac] = anchorOf(value, r, c);
      return grid.querySelector(`[data-r="${ar}"][data-c="${ac}"]`);
    }
    function showSelection() {
      const a = area();
      for (const input of grid.querySelectorAll('textarea[data-r]')) {
        const r = +input.dataset.r, c = +input.dataset.c;
        input.classList.toggle('table-selected', !!a && r >= a[0] && r < a[0] + a[2] && c >= a[1] && c < a[1] + a[3]);
      }
      mergeButton.disabled = !a;
      splitButton.disabled = !mergeAt(value, ...at);
      sortUp.disabled = sortDown.disabled = !canSort(value);
      sortUp.title = sortDown.title = canSort(value) ? '' : 'Rows joined by merged cells cannot be sorted';
      if (canSort(value)) { sortUp.title = `Sort rows by column ${columnName(at[1])}, A to Z and 1 to 9 (the header row stays)`; sortDown.title = `Sort rows by column ${columnName(at[1])}, Z to A and 9 to 1`; }
      undoButton.disabled = !past.length;
      redoButton.disabled = !future.length;
      const l = lookOf(...at);
      const pressed = { bold: l.bold, italic: l.italic, left: l.align === 'left', center: l.align === 'center', right: l.align === 'right', top: l.valign === 'top', middle: l.valign === 'middle', bottom: l.valign === 'bottom' };
      for (const [k, b] of Object.entries(bar)) b.setAttribute('aria-pressed', String(pressed[k]));
      fillNone.setAttribute('aria-pressed', String(!l.fill));
      for (const f of fills) f.setAttribute('aria-pressed', String(f.dataset.fill === l.fill));
    }
    // As many rows as its lines, and more when a long line wraps (once it is on the page).
    const fit = (input) => {
      input.rows = Math.max(1, input.value.split('\n').length);
      if (input.isConnected && input.scrollHeight > input.clientHeight + 1) input.rows += Math.ceil((input.scrollHeight - input.clientHeight) / 18);
    };
    // Column widths and row heights as the grid shows them: relative to each other, as on the page.
    const columnsTemplate = (ws) => {
      const mean = ws.reduce((s, w) => s + w, 0) / ws.length;
      return `30px ${ws.map((w) => `minmax(${Math.round(Math.max(36, 72 * w / mean))}px, ${(w / mean).toFixed(3)}fr)`).join(' ')}`;
    };
    const rowsTemplate = (hs) => {
      const least = hs && Math.min(...hs);
      return `24px ${value.cells.map((_, r) => (hs ? `minmax(${Math.round(Math.min(400, 30 * hs[r] / least))}px, auto)` : 'auto')).join(' ')}`;
    };
    // Dragging the edge of a column letter (axis 1) or row number (axis 0); arrow keys on it too.
    function sizeGrip(axis, i) {
      const g = make('span', { className: `table-grip table-grip-${axis ? 'col' : 'row'}`, tabIndex: 0, title: `Drag to size ${axis ? `column ${columnName(i)}` : `row ${i + 1}`}; double-click: all equal` });
      g.setAttribute('role', 'separator');
      g.setAttribute('aria-orientation', axis ? 'vertical' : 'horizontal');
      g.setAttribute('aria-label', axis ? `Width of column ${columnName(i)}` : `Height of row ${i + 1}`);
      const measure = () => [...grid.querySelectorAll(axis ? '.table-colhead' : '.table-rowhead')].map((h) => (axis ? h.getBoundingClientRect().width : h.getBoundingClientRect().height));
      const resize = (start, d) => {
        const next = [...start], least = axis ? 36 : 24;
        if (axis && i < start.length - 1) { const dd = Math.max(least - start[i], Math.min(d, start[i + 1] - least)); next[i] += dd; next[i + 1] -= dd; }
        else next[i] = Math.max(least, start[i] + d);
        return next;
      };
      const keep = (px) => {
        const mean = px.reduce((s, w) => s + w, 0) / px.length, rel = px.map((w) => Math.round(1000 * w / mean) / 1000);
        change(tableSpec(axis ? { ...value, widths: rel } : { ...value, heights: rel }), at);
      };
      g.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const start = measure(), from = axis ? e.clientX : e.clientY;
        let px = start;
        g.setPointerCapture(e.pointerId);
        g.classList.add('dragging');
        const move = (ev) => {
          px = resize(start, (axis ? ev.clientX : ev.clientY) - from);
          if (axis) grid.style.gridTemplateColumns = columnsTemplate(px);
          else grid.style.gridTemplateRows = `24px ${px.map((h) => `${Math.round(h)}px`).join(' ')}`;
        };
        const up = () => {
          g.removeEventListener('pointermove', move);
          g.removeEventListener('pointerup', up);
          g.removeEventListener('pointercancel', up);
          g.classList.remove('dragging');
          if (px !== start) keep(px);
        };
        g.addEventListener('pointermove', move);
        g.addEventListener('pointerup', up);
        g.addEventListener('pointercancel', up);
      });
      g.addEventListener('dblclick', () => change(tableSpec(axis ? { ...value, widths: null } : { ...value, heights: null }), at));
      g.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const start = measure();
        keep(resize(start, d * Math.max(8, start[i] * 0.1)));
        grid.querySelector(`.table-grip-${axis ? 'col' : 'row'}[data-i="${i}"]`)?.focus({ preventScroll: true });
      });
      g.dataset.i = i;
      return g;
    }
    // Choosing a whole column or row from its letter or number.
    const chooseLine = (axis, i) => {
      const last = axis ? value.cells.length - 1 : value.cells[0].length - 1;
      sel = axis ? { from: [0, i], to: [last, i] } : { from: [i, 0], to: [i, last] };
      at = anchorOf(value, ...sel.from);
      cell(...at)?.focus({ preventScroll: true });
      showSelection();
    };
    function draw(focus = at) {
      error.textContent = '';
      const rows = value.cells.length, cols = value.cells[0].length;
      grid.style.gridTemplateColumns = columnsTemplate(value.widths || Array(cols).fill(1));
      grid.style.gridTemplateRows = rowsTemplate(value.heights);
      const fields = [make('div', { className: 'table-corner' })];
      for (let c = 0; c < cols; c++) {
        const h = make('div', { className: 'table-colhead', textContent: columnName(c), title: `Column ${columnName(c)}: click to choose it` }, sizeGrip(1, c));
        h.style.gridArea = `1 / ${c + 2}`;
        h.addEventListener('click', (e) => { if (!e.target.closest('.table-grip')) chooseLine(1, c); });
        fields.push(h);
      }
      for (let r = 0; r < rows; r++) {
        const h = make('div', { className: 'table-rowhead', textContent: String(r + 1), title: `Row ${r + 1}: click to choose it` }, sizeGrip(0, r));
        h.style.gridArea = `${r + 2} / 1`;
        h.addEventListener('click', (e) => { if (!e.target.closest('.table-grip')) chooseLine(0, r); });
        fields.push(h);
      }
      const tint = TINTS[value.tint] || TINTS.blue, headed = value.header && rows > 1;
      value.cells.forEach((row, r) => row.forEach((text, c) => {
        const m = mergeAt(value, r, c);
        if (m && (m[0] !== r || m[1] !== c)) return;
        const [rs, cs] = m ? [m[2], m[3]] : [1, 1];
        const input = make('textarea', { value: text, spellcheck: false, autocomplete: 'off', rows: 1 });
        fit(input);
        input.dataset.r = r;
        input.dataset.c = c;
        input.style.gridArea = `${r + 2} / ${c + 2} / span ${rs} / span ${cs}`;
        input.classList.toggle('table-merged', !!m);
        input.classList.toggle('table-head', isHead(r, c));
        // The look as the table will have it (table.js tableItems): the cell's fill, the header
        // column's tint, or its row's band.
        const l = lookOf(r, c), body_ = r - (headed ? 1 : 0), head = headed && r === 0;
        const band = value.background === 'all' ? (head ? tint.head : tint.body)
          : value.background === 'striped' ? (head ? tint.head : body_ % 2 === 1 ? tint.body : null)
          : value.background === 'header' && head ? tint.head : null;
        const colTint = value.headerColumn && cols > 1 && c === 0 && !head && value.background !== 'none' ? tint.head : null;
        const fill = l.fill ? TINTS[l.fill].head : colTint || band;
        input.style.background = fill ? rgb(fill) : '';
        if (fill) input.style.color = '#1f2328';
        input.style.fontWeight = l.bold ? '700' : '400';
        input.style.fontStyle = l.italic ? 'italic' : 'normal';
        input.style.textAlign = l.align;
        input.style.alignSelf = { top: 'start', middle: 'center', bottom: 'end' }[l.valign];
        input.setAttribute('aria-label', m ? `Rows ${r + 1}–${r + rs}, columns ${columnName(c)}–${columnName(c + cs - 1)} (merged)` : `${columnName(c)}${r + 1}`);
        input.addEventListener('focus', () => { at = [r, c]; showSelection(); });
        input.addEventListener('input', () => {
          if (typing !== input) { remember(); typing = input; }
          value.cells[r][c] = input.value;
          fit(input);
          showSelection();
          schedulePreview();
        });
        // Shift + click chooses the cells from the cursor's to this one; a drag from one cell to others too.
        input.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          if (e.shiftKey) { e.preventDefault(); sel = { from: sel?.from || at, to: [r, c] }; showSelection(); return; }
          sel = null;
          drag = [r, c];
          showSelection();
        });
        input.addEventListener('keydown', (e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && !e.altKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggle('bold'); return; }
          if (mod && !e.altKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); toggle('italic'); return; }
          if ((e.key === 'Delete' || e.key === 'Backspace') && area()) {
            // Several cells chosen: their text goes, in one step.
            e.preventDefault();
            const next = value.cells.map((row_) => [...row_]);
            for (const [i, j] of areaAnchors(value, area())) next[i][j] = '';
            const keep = sel;
            change({ ...value, cells: next }, at);
            sel = keep;
            showSelection();
            return;
          }
          const before = input.value.slice(0, input.selectionStart), after = input.value.slice(input.selectionEnd);
          const step = { ArrowUp: !before.includes('\n') && [-1, 0], ArrowDown: !after.includes('\n') && [rs, 0],
            ArrowLeft: input.selectionStart === 0 && input.selectionEnd === 0 && [0, -1], ArrowRight: input.selectionStart === input.value.length && [0, cs] }[e.key];
          if (step && e.shiftKey) {
            // Shift + arrows: the chosen cells grow or shrink from the cursor's.
            e.preventDefault();
            const to = sel?.to || [r, c], next = [to[0] + Math.sign(step[0]), to[1] + Math.sign(step[1])];
            if (next[0] < 0 || next[1] < 0 || next[0] >= rows || next[1] >= cols) return;
            sel = { from: sel?.from || [r, c], to: next };
            showSelection();
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const order = [...grid.querySelectorAll('textarea[data-r]')];
            const i = order.indexOf(input) + (e.shiftKey ? -1 : 1);
            if (i >= order.length) return add(0, rows, [rows, 0]);
            if (i >= 0) order[i].focus({ preventScroll: false });
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey && !mod) {
            // Enter goes down (Shift + Enter starts a new line in the cell).
            e.preventDefault();
            const next = cell(r + rs, c);
            if (next) { next.focus({ preventScroll: false }); next.select(); }
            else add(0, rows, [rows, c]);
            return;
          }
          if (!step) return;
          const next = cell(r + step[0], c + step[1]);
          if (next) { e.preventDefault(); sel = null; next.focus({ preventScroll: false }); next.select(); }
        });
        fields.push(input);
      }));
      grid.replaceChildren(...fields);
      for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.tint === value.tint));
      header.checked = value.header;
      headerColumn.checked = !!value.headerColumn;
      background.value = value.background;
      borders.value = value.borders || 'all';
      sizes.value = value.size || 'auto';
      rowsLook.value = value.heights ? 'custom' : value.fit ? 'fit' : 'equal';
      at = [Math.min(focus[0], rows - 1), Math.min(focus[1], cols - 1)];
      cell(...at)?.focus({ preventScroll: true });
      showSelection();
      showPreview();
    }
    // The preview: the items table.js draws, as an SVG at the size the table would be put on the page.
    let previewQueued = false;
    function showPreview() {
      preview.hidden = !previewOn;
      previewBox.classList.toggle('folded', !previewOn);
      previewButton.setAttribute('aria-pressed', String(previewOn));
      previewFold.setAttribute('aria-expanded', String(previewOn));
      previewFold.replaceChildren(icon(previewOn ? 'chevronDown' : 'chevronRight'), make('span', { textContent: 'On the page' }));
      if (!previewOn) return;
      const [w, h] = tableNaturalSize(value), box = [0, 0, w, h];
      const svg = previewSvg(tableItems(box, value, { id: 'preview' }), box, [w, h], 8);
      preview.replaceChildren(svg);
    }
    const schedulePreview = () => {
      if (previewQueued || !previewOn) return;
      previewQueued = true;
      requestAnimationFrame(() => { previewQueued = false; showPreview(); });
    };
    // Dragging across cells chooses them; within one cell it selects text as usual.
    let drag = null;
    grid.addEventListener('pointermove', (e) => {
      if (!drag || !(e.buttons & 1)) { drag = null; return; }
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('textarea[data-r]');
      if (!over || !grid.contains(over)) return;
      const to = [+over.dataset.r, +over.dataset.c];
      if (to[0] === drag[0] && to[1] === drag[1] && !sel) return;
      sel = { from: drag, to };
      showSelection();
    });
    grid.addEventListener('pointerup', () => { drag = null; });
    // A range copied from a spreadsheet, a CSV or TSV, or an HTML table: written from the cursor
    // (or the first chosen cell) on, the table growing to take it. Plain text goes into the cell.
    grid.addEventListener('paste', (e) => {
      const block = clipboardBlock({ html: e.clipboardData?.getData('text/html') || '', text: e.clipboardData?.getData('text/plain') || '' });
      if (!block) return;
      e.preventDefault();
      const from = area() ? [area()[0], area()[1]] : at;
      const next = pasteBlock(value, from, block);
      const cut = from[0] + block.cells.length > MAX_ROWS || from[1] + Math.max(...block.cells.map((r) => r.length)) > MAX_COLUMNS;
      change(next, from);
      if (cut) error.textContent = `Pasted up to ${MAX_ROWS} rows and ${MAX_COLUMNS} columns; the rest was left out.`;
    });
    // Undo and redo for the table, not the text field's own.
    win.el.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
    }, true);
    draw([0, 0]);
    let done = false;
    const finish = (result) => { if (done) return; done = true; win.destroy(); resolve(result); };
    onFinish(finish);
    cancel.onclick = () => finish(null);
    apply.onclick = () => finish(tableSpec(value));
    cell(0, 0)?.focus({ preventScroll: true });
  });
}

export { resized };
