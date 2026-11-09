// The editors of graphs and tables (graph.js, table.js): what a graph or table is, changed in
// a dialog with a live preview, then drawn (again) on the page as one undo step. The math keypad
// (math-keypad.js) types into a graph's function fields, inside the dialog.
import { graphSpec, graphItems } from './graph.js';
import { tableSpec, resized } from './table.js';
import { icon } from './icons.js';
import { loadKatex } from './rich-text.js';

const SVG = 'http://www.w3.org/2000/svg';
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

function dialogShell(title) {
  const dialog = make('dialog', { className: 'ocr-dialog compound-dialog' });
  const heading = make('h2', { textContent: title });
  const body = make('div', { className: 'compound-body' });
  const error = make('p', { className: 'compound-error', role: 'status' });
  const cancel = make('button', { type: 'button', textContent: 'Cancel' });
  const apply = make('button', { type: 'button', className: 'primary', textContent: 'Insert' });
  dialog.append(heading, body, error, make('div', { className: 'ocr-actions' }, cancel, apply));
  // Keys typed here stay here (no tool shortcuts behind the dialog).
  dialog.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dialog);
  return { dialog, body, error, cancel, apply };
}

// Opens the graph editor. `spec`: the graph's (or {} for a new one); `editing`: Apply instead of
// Insert. Resolves with the new spec, or null when cancelled.
export function editGraph({ spec = {}, editing = false, rgba, keypad = null } = {}) {
  return new Promise((resolve) => {
    let value = graphSpec(spec);
    if (!value.functions.length) value.functions = [''];
    const { dialog, body, error, cancel, apply } = dialogShell(editing ? 'Edit graph' : 'Insert graph');
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
    const add = make('button', { type: 'button', className: 'graph-add', onclick: () => { addRow(''); refresh(); list.querySelector('.graph-row:last-child input')?.focus(); } });
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
    loadKatex().then((k) => { katex = k; refresh(); }).catch(() => {});
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
    const finish = (result) => { keypad?.detach(); keypad?.mount(document.body); dialog.close(); dialog.remove(); resolve(result); };
    cancel.onclick = () => finish(null);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    apply.onclick = () => { if (!apply.disabled) finish(read()); };
    // The keypad shows inside the dialog, under the functions (a modal is above everything
    // else on the page), in its flow so it never covers the buttons.
    keypad?.mount(body);
    dialog.showModal();
    list.querySelector('input')?.focus();
  });
}

// Opens the table editor: a grid of cells to type in, rows and columns added or removed where
// the cursor is. Resolves with the new spec, or null.
export function editTable({ spec = {}, editing = false } = {}) {
  return new Promise((resolve) => {
    let value = tableSpec(spec);
    const { dialog, body, error, cancel, apply } = dialogShell(editing ? 'Edit table' : 'Insert table');
    apply.textContent = editing ? 'Apply' : 'Insert';
    const grid = make('div', { className: 'table-grid' });
    const header = make('input', { type: 'checkbox', checked: value.header });
    let at = [0, 0];
    const tools = make('div', { className: 'table-tools' },
      iconButton('rowAbove', 'Row above', () => change((c) => c.splice(at[0], 0, c[0].map(() => '')), [at[0], at[1]])),
      iconButton('rowBelow', 'Row below', () => change((c) => c.splice(at[0] + 1, 0, c[0].map(() => '')), [at[0] + 1, at[1]])),
      iconButton('colLeft', 'Column left', () => change((c) => c.forEach((r) => r.splice(at[1], 0, '')), [at[0], at[1]])),
      iconButton('colRight', 'Column right', () => change((c) => c.forEach((r) => r.splice(at[1] + 1, 0, '')), [at[0], at[1] + 1])),
      iconButton('rowDelete', 'Delete row', () => value.cells.length > 1 && change((c) => c.splice(at[0], 1), [Math.max(0, at[0] - 1), at[1]])),
      iconButton('colDelete', 'Delete column', () => value.cells[0].length > 1 && change((c) => c.forEach((r) => r.splice(at[1], 1)), [at[0], Math.max(0, at[1] - 1)])),
      make('span', { className: 'spacer' }),
      make('label', {}, header, ' Header row'),
    );
    const hint = make('p', { className: 'muted', textContent: 'Tab and the arrow keys move between cells; Tab in the last cell adds a row. $…$ in a cell is math.' });
    body.append(tools, grid, hint);
    function change(edit, focus) {
      const cells = value.cells.map((r) => [...r]);
      edit(cells);
      if (cells.length > 30 || cells[0].length > 12) { error.textContent = 'Up to 30 rows and 12 columns.'; return; }
      value = { ...tableSpec({ cells, header: header.checked }), widths: null };
      draw(focus);
    }
    function cell(r, c) { return grid.querySelector(`[data-r="${r}"][data-c="${c}"]`); }
    function draw(focus = at) {
      error.textContent = '';
      const rows = value.cells.length, cols = value.cells[0].length;
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(70px, 1fr))`;
      grid.replaceChildren(...value.cells.flatMap((row, r) => row.map((text, c) => {
        const input = make('input', { type: 'text', value: text, spellcheck: false, autocomplete: 'off' });
        input.dataset.r = r;
        input.dataset.c = c;
        input.classList.toggle('table-head', header.checked && r === 0 && rows > 1);
        input.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}`);
        input.addEventListener('focus', () => { at = [r, c]; });
        input.addEventListener('input', () => { value.cells[r][c] = input.value; });
        input.addEventListener('keydown', (e) => {
          const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] }[e.key]
            || (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0 ? [0, -1] : null)
            || (e.key === 'ArrowRight' && input.selectionStart === input.value.length ? [0, 1] : null);
          if (e.key === 'Tab') {
            e.preventDefault();
            const i = r * cols + c + (e.shiftKey ? -1 : 1);
            if (i >= rows * cols) return change((cs) => cs.push(cs[0].map(() => '')), [rows, 0]);
            if (i >= 0) cell(Math.floor(i / cols), i % cols)?.focus();
            return;
          }
          if (!move) return;
          const next = cell(r + move[0], c + move[1]);
          if (next) { e.preventDefault(); next.focus(); next.select(); }
          else if (e.key === 'Enter') { e.preventDefault(); change((cs) => cs.push(cs[0].map(() => '')), [rows, c]); }
        });
        return input;
      })));
      const target = cell(Math.min(focus[0], rows - 1), Math.min(focus[1], cols - 1));
      target?.focus();
    }
    header.addEventListener('input', () => { value.header = header.checked; draw(); });
    draw([0, 0]);
    const finish = (result) => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.onclick = () => finish(null);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    apply.onclick = () => finish(tableSpec({ ...value, header: header.checked }));
    dialog.showModal();
    cell(0, 0)?.focus();
  });
}

export { resized };
