// The editors of graphs and tables (graph.js, table.js), the shipped "window" prefab modules
// (prefabs/graph, prefabs/table): what a graph or table is, changed in a movable window over
// the page (the kit's movableWindow, not modal: the page stays in sight and scrolls behind it)
// with a live preview, then drawn (again) on the page as one undo step. The math keypad
// (math-keypad.js) types into a graph's function fields, inside the window.
import { graphSpec, graphItems } from './graph.js';
import { tableSpec, resized, TINTS, BACKGROUNDS, MAX_ROWS, MAX_COLUMNS, mergeAt, anchorOf, mergeArea, mergeCells, splitCell, insertLines, deleteLines } from './table.js';
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

// The items a graph or table is made of, drawn small: lines as polylines (fills as polygons),
// text boxes as text.
export function previewSvg({ lines, images }, box, size = [360, 240]) {
  const svg = document.createElementNS(SVG, 'svg');
  const pad = 26, [bx, by, bw, bh] = box;
  svg.setAttribute('viewBox', `${bx - pad} ${by - pad} ${bw + 2 * pad} ${bh + 2 * pad}`);
  svg.setAttribute('width', size[0]);
  svg.setAttribute('height', size[1]);
  svg.classList.add('compound-preview');
  for (const l of lines) {
    const fill = l.shape?.fill;
    const el = document.createElementNS(SVG, fill ? 'polygon' : 'polyline');
    el.setAttribute('points', l.points.map((p) => p.join(',')).join(' '));
    el.setAttribute('fill', fill ? hex(fill) : 'none');
    el.setAttribute('stroke', fill ? 'none' : hex(l.rgba));
    el.setAttribute('stroke-width', l.width);
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    svg.append(el);
  }
  for (const i of images) {
    const t = document.createElementNS(SVG, 'text');
    t.setAttribute('x', i.bounds[0] + 2);
    t.setAttribute('y', i.bounds[1] + i.text.font_size);
    t.setAttribute('font-size', i.text.font_size);
    t.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
    if (i.text.bold) t.setAttribute('font-weight', '700');
    t.setAttribute('fill', hex(i.text.rgba));
    t.textContent = i.text.text;
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
// the cursor is, cells merged into one and split again. Resolves with the new spec, or null.
export function editTable({ spec = {}, editing = false } = {}) {
  return new Promise((resolve) => {
    let value = tableSpec(spec);
    const { win, body, error, cancel, apply, onFinish } = windowShell('table', editing ? 'Edit table' : 'Insert table', { width: 560, minWidth: 320, minHeight: 220 });
    apply.textContent = editing ? 'Apply' : 'Insert';
    const grid = make('div', { className: 'table-grid' });
    const header = make('input', { type: 'checkbox', checked: value.header });
    // `at`: the cell with the cursor (the first cell of its merge). `sel`: cells chosen to merge,
    // from one cell to another, or null.
    let at = [0, 0], sel = null;
    const span = () => { const m = mergeAt(value, ...at); return m ? [m[2], m[3]] : [1, 1]; };
    const mergeButton = iconButton('cellsMerge', 'Merge cells (select them first: Shift + click, Shift + arrows or drag)', () => {
      if (!sel) return;
      const area = mergeArea(value, sel.from, sel.to);
      value = mergeCells({ ...value, header: header.checked }, sel.from, sel.to);
      sel = null;
      draw([area[0], area[1]]);
    });
    const splitButton = iconButton('cellsSplit', 'Split merged cell', () => {
      value = splitCell({ ...value, header: header.checked }, ...at);
      draw(at);
    });
    const tools = make('div', { className: 'table-tools' },
      iconButton('rowAbove', 'Row above', () => add(0, at[0], at)),
      iconButton('rowBelow', 'Row below', () => { const below = at[0] + span()[0]; add(0, below, [below, at[1]]); }),
      iconButton('colLeft', 'Column left', () => add(1, at[1], at)),
      iconButton('colRight', 'Column right', () => { const right = at[1] + span()[1]; add(1, right, [at[0], right]); }),
      iconButton('rowDelete', 'Delete row', () => value.cells.length > 1 && change(deleteLines(value, 0, at[0]), [Math.max(0, at[0] - 1), at[1]])),
      iconButton('colDelete', 'Delete column', () => value.cells[0].length > 1 && change(deleteLines(value, 1, at[1]), [at[0], Math.max(0, at[1] - 1)])),
      make('span', { className: 'table-tools-gap' }),
      mergeButton, splitButton,
      make('span', { className: 'spacer' }),
      make('label', {}, header, ' Header row'),
    );
    // Background: none, the header, striped rows or the whole table, in one of TINTS.
    const background = make('select', {}, ...Object.entries(BACKGROUNDS).map(([key, label]) => make('option', { value: key, textContent: label })));
    background.setAttribute('aria-label', 'Background');
    background.value = value.background;
    const swatches = Object.entries(TINTS).map(([key, tint]) => {
      const swatch = make('button', { type: 'button', className: 'table-swatch', title: tint.label });
      swatch.setAttribute('aria-label', `${tint.label} background`);
      swatch.dataset.tint = key;
      swatch.style.background = rgb(tint.head);
      swatch.onclick = () => { value.tint = key; draw(); };
      return swatch;
    });
    const look = make('div', { className: 'table-tools table-look' }, make('label', {}, 'Background ', background), make('span', { className: 'table-swatches' }, ...swatches));
    background.addEventListener('input', () => { value.background = background.value; draw(); });
    const hint = make('p', { className: 'muted', textContent: 'Tab and the arrow keys move between cells; Tab in the last cell adds a row. Shift + click, Shift + arrows or a drag choose cells to merge. $…$ in a cell is math.' });
    body.append(tools, look, grid, hint);
    // `next`: the table after a change (table.js insertLines, deleteLines…), its widths, heights
    // and cell looks kept by the change itself.
    function change(next, focus) {
      value = tableSpec({ ...next, header: header.checked });
      sel = null;
      draw(focus);
    }
    // A row (axis 0) or column (axis 1) inserted before `at`, unless the table is at its limit.
    function add(axis, before, focus) {
      const next = insertLines({ ...value, header: header.checked }, axis, before);
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
      const area = sel && mergeArea(value, sel.from, sel.to);
      for (const input of grid.querySelectorAll('[data-r]')) {
        const r = +input.dataset.r, c = +input.dataset.c;
        input.classList.toggle('table-selected', !!area && area[2] * area[3] > 1 && r >= area[0] && r < area[0] + area[2] && c >= area[1] && c < area[1] + area[3]);
      }
      mergeButton.disabled = !area || area[2] * area[3] < 2;
      splitButton.disabled = !mergeAt(value, ...at);
    }
    const fit = (input) => { input.rows = Math.max(1, input.value.split('\n').length); };
    function draw(focus = at) {
      error.textContent = '';
      const rows = value.cells.length, cols = value.cells[0].length;
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(70px, 1fr))`;
      const fields = [];
      value.cells.forEach((row, r) => row.forEach((text, c) => {
        const m = mergeAt(value, r, c);
        if (m && (m[0] !== r || m[1] !== c)) return;
        const [rs, cs] = m ? [m[2], m[3]] : [1, 1];
        const input = make('textarea', { value: text, spellcheck: false, autocomplete: 'off', rows: 1 });
        fit(input);
        input.dataset.r = r;
        input.dataset.c = c;
        input.style.gridArea = `${r + 1} / ${c + 1} / span ${rs} / span ${cs}`;
        input.classList.toggle('table-merged', !!m);
        const head = header.checked && r === 0 && rows > 1;
        input.classList.toggle('table-head', head);
        // The background as the table will have it (table.js tableItems).
        const tint = TINTS[value.tint] || TINTS.blue, row = r - (header.checked && rows > 1 ? 1 : 0);
        const fill = value.background === 'all' ? (head ? tint.head : tint.body)
          : value.background === 'striped' ? (head ? tint.head : row % 2 === 1 ? tint.body : null)
          : value.background === 'header' && head ? tint.head : null;
        input.style.background = fill ? rgb(fill) : '';
        if (fill) input.style.color = '#1f2328';
        input.setAttribute('aria-label', m ? `Rows ${r + 1}–${r + rs}, columns ${c + 1}–${c + cs} (merged)` : `Row ${r + 1}, column ${c + 1}`);
        input.addEventListener('focus', () => { at = [r, c]; showSelection(); });
        input.addEventListener('input', () => { value.cells[r][c] = input.value; fit(input); });
        // Shift + click chooses the cells from the cursor's to this one; a drag from one cell to others too.
        input.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          if (e.shiftKey) { e.preventDefault(); sel = { from: sel?.from || at, to: [r, c] }; showSelection(); return; }
          sel = null;
          drag = [r, c];
          showSelection();
        });
        input.addEventListener('keydown', (e) => {
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
            const order = [...grid.querySelectorAll('[data-r]')];
            const i = order.indexOf(input) + (e.shiftKey ? -1 : 1);
            if (i >= order.length) return add(0, rows, [rows, 0]);
            if (i >= 0) order[i].focus({ preventScroll: true });
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            // Enter goes down (Shift + Enter starts a new line in the cell).
            e.preventDefault();
            const next = cell(r + rs, c);
            if (next) { next.focus({ preventScroll: true }); next.select(); }
            else add(0, rows, [rows, c]);
            return;
          }
          if (!step) return;
          const next = cell(r + step[0], c + step[1]);
          if (next) { e.preventDefault(); sel = null; next.focus({ preventScroll: true }); next.select(); }
        });
        fields.push(input);
      }));
      grid.replaceChildren(...fields);
      for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.tint === value.tint));
      const target = cell(Math.min(focus[0], rows - 1), Math.min(focus[1], cols - 1));
      target?.focus({ preventScroll: true });
      showSelection();
    }
    // Dragging across cells chooses them; within one cell it selects text as usual.
    let drag = null;
    grid.addEventListener('pointermove', (e) => {
      if (!drag || !(e.buttons & 1)) { drag = null; return; }
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-r]');
      if (!over || !grid.contains(over)) return;
      const to = [+over.dataset.r, +over.dataset.c];
      if (to[0] === drag[0] && to[1] === drag[1] && !sel) return;
      sel = { from: drag, to };
      showSelection();
    });
    grid.addEventListener('pointerup', () => { drag = null; });
    header.addEventListener('input', () => { value.header = header.checked; draw(); });
    draw([0, 0]);
    let done = false;
    const finish = (result) => { if (done) return; done = true; win.destroy(); resolve(result); };
    onFinish(finish);
    cancel.onclick = () => finish(null);
    apply.onclick = () => finish(tableSpec({ ...value, header: header.checked, background: background.value }));
    cell(0, 0)?.focus({ preventScroll: true });
  });
}

export { resized };
