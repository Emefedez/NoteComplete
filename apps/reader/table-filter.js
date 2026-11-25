// Filter and sort for the tables of a document in the text view (docs/TABLES-AND-OFFICE.md,
// phase 2). A bar above each table with a few rows: a text filter, a count and Clear; a click
// on a column's header sorts by it (up, down, as written) and its ▾ filters by its values. Only
// the view changes, never the file. Rows that share a merged cell (rowspan) move and hide
// together, and such tables are not sorted. "Put on page" gives the rows shown, in their order,
// as a page table spec (table.js) to the app.
import { MAX_ROWS, MAX_COLUMNS } from './table.js';

// ---- Values ---------------------------------------------------------------------------------

// A number written in a cell ("7,5", "1.234,5", "1,234.5", "80 %", "-3", "€12"), or null.
export function numberOf(text) {
  let s = String(text ?? '').trim().replace(/[\s  ]/g, '').replace(/^[€$£¥]|[€$£¥%]$/g, '').replace(/^−/, '-');
  if (!/^[-+]?(\d|[.,]\d)[\d.,]*(e[-+]?\d+)?$/i.test(s)) return null;
  const comma = s.lastIndexOf(','), dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  // One comma is a decimal comma ("7,5"); several group thousands ("1,234,567"), as several dots do.
  else if (comma >= 0) s = s.indexOf(',') === comma ? s.replace(',', '.') : s.replace(/,/g, '');
  else if (dot >= 0 && s.indexOf('.') !== dot) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const collator = () => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Ascending order of two cell texts: numbers by value and before words, words by the reader's
// language (numbers inside them by value: "Tema 2" before "Tema 10"). Empty cells are not
// compared here: they always go last (sortedGroups).
export function compareCells(a, b, order = collator()) {
  const x = numberOf(a), y = numberOf(b);
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return order.compare(String(a), String(b));
}

// Without case or accents, for the text filter.
export const folded = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// ---- The grid ---------------------------------------------------------------------------------

// Rows of cells { text, rs, cs } (as in HTML: spots covered by a span left out) placed on a
// grid. `fill`: covered spots hold the text of the cell covering them (to filter by), else ''.
// Gives { grid, merges [row, col, rows, cols], groups [[first, last]] }: a group is rows joined
// by a rowspan, which must stay together.
export function placeCells(rows, { fill = false } = {}) {
  const grid = rows.map(() => []), merges = [], taken = rows.map(() => new Set()), groups = [];
  let reach = -1;
  rows.forEach((row, r) => {
    if (r > reach) groups.push([r, r]); else groups.at(-1)[1] = r;
    let c = 0;
    for (const { text = '', rs = 1, cs = 1 } of row) {
      while (taken[r].has(c)) c++;
      const h = Math.max(1, Math.min(rs | 0 || 1, rows.length - r)), w = Math.max(1, cs | 0 || 1);
      for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) { taken[i].add(j); grid[i][j] = fill || (i === r && j === c) ? text : ''; }
      if (h * w > 1) merges.push([r, c, h, w]);
      reach = Math.max(reach, r + h - 1);
      c += w;
    }
  });
  const width = grid.reduce((n, g) => Math.max(n, g.length), 0);
  return { grid: grid.map((g) => Array.from({ length: width }, (_, j) => g[j] ?? '')), merges, groups, width };
}

// Which groups the filters let through: every word of `query` somewhere in the group, and for
// each column in `values` (a Set of the texts allowed), a row of the group with one of them.
export function visibleGroups(grid, groups, { query = '', values = new Map() } = {}) {
  const words = folded(query).split(/\s+/).filter(Boolean);
  return groups.map(([first, last]) => {
    const rows = grid.slice(first, last + 1);
    for (const [col, allowed] of values) if (!rows.some((r) => allowed.has(String(r[col] ?? '').trim()))) return false;
    if (!words.length) return true;
    const text = folded(rows.map((r) => r.join(' ')).join(' '));
    return words.every((w) => text.includes(w));
  });
}

// The order of the groups sorted by a column (dir 1 up, -1 down, 0 as written); stable, and
// empty cells last either way.
export function sortedGroups(grid, groups, column, dir, order = collator()) {
  const index = groups.map((_, i) => i);
  if (!dir) return index;
  const key = (i) => String(grid[groups[i][0]]?.[column] ?? '').trim();
  return index.sort((a, b) => {
    const x = key(a), y = key(b);
    if (!x || !y) return (!x - !y) || a - b;
    return dir * compareCells(x, y, order) || a - b;
  });
}

// A column's different values with how many rows have each, in ascending order (empty last).
export function distinctValues(grid, column, order = collator()) {
  const counts = new Map();
  for (const row of grid) { const v = String(row[column] ?? '').trim(); counts.set(v, (counts.get(v) || 0) + 1); }
  return [...counts].map(([value, count]) => ({ value, count }))
    .sort((a, b) => (!a.value - !b.value) || compareCells(a.value, b.value, order));
}

// A page table (table.js) from rows of cells { text, rs, cs }: the first `head` rows its
// header. Cut to what a page table holds; { value: tableSpec input, total, kept }.
export function pageTable(rows, head = 1, { maxRows = MAX_ROWS, maxColumns = MAX_COLUMNS } = {}) {
  const { grid, merges, width } = placeCells(rows);
  const kept = { rows: Math.min(grid.length, maxRows), columns: Math.min(width, maxColumns) };
  const cells = grid.slice(0, kept.rows).map((r) => r.slice(0, kept.columns));
  const inside = merges.filter(([r, c]) => r < kept.rows && c < kept.columns)
    .map(([r, c, rs, cs]) => [r, c, Math.min(rs, kept.rows - r), Math.min(cs, kept.columns - c)]).filter(([, , rs, cs]) => rs * cs > 1);
  return { value: { cells, merges: inside, header: head > 0 }, total: { rows: grid.length, columns: width }, kept };
}

// ---- In the page ------------------------------------------------------------------------------

// A cell's text as a page table writes it: formulas back as $TeX$, pictures as their description.
export function cellSource(cell) {
  const copy = cell.cloneNode(true);
  for (const k of copy.querySelectorAll('.katex')) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    k.replaceWith(tex ? `$${tex.trim()}$` : k.textContent);
  }
  for (const img of copy.querySelectorAll('img')) img.replaceWith(img.getAttribute('alt') || '');
  for (const extra of copy.querySelectorAll('.tf-values, .tf-sort')) extra.remove();
  return copy.textContent.replace(/\s+/g, ' ').trim();
}
const rowCells = (tr) => [...tr.cells].map((td) => ({ text: cellSource(td), rs: td.rowSpan || 1, cs: td.colSpan || 1 }));

// Bars on the tables of `root` (a rendered document). minRows: tables with fewer body rows get
// no bar. onToPage({ value, total, kept, filtered, x, y }): Put on page (also a right-click on
// any table); without it, no such button.
export function attachTableFilters(root, { minRows = 4, onToPage = null } = {}) {
  for (const table of root.querySelectorAll('table')) {
    if (table.closest('.tf-wrap, pre, code')) continue;
    const body = table.tBodies[0];
    const bodyRows = body ? body.rows.length : 0;
    if (onToPage) table.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.tf-values')) return;
      event.preventDefault();
      onToPage({ ...toPage(table), x: event.clientX, y: event.clientY });
    });
    if (bodyRows >= minRows) tableBar(table, { onToPage });
  }
}

// The rows shown, in their order, as a page table.
function toPage(table) {
  const head = table.tHead ? table.tHead.rows.length : 0;
  const rows = [...table.rows].filter((tr) => !tr.hidden);
  const filtered = rows.length < table.rows.length;
  return { ...pageTable(rows.map(rowCells), head), filtered };
}

function tableBar(table, { onToPage }) {
  const doc = table.ownerDocument, body = table.tBodies[0];
  const original = [...body.rows], scroller = table.closest('.text-doc');
  const spanned = original.some((tr) => [...tr.cells].some((td) => td.rowSpan > 1));
  const state = { query: '', values: new Map(), column: -1, dir: 0 };
  let model = null;
  // The grid is read on first use: a big sheet costs nothing until filtered.
  const ensure = () => {
    if (model) return model;
    const placed = placeCells(original.map(rowCells), { fill: true });
    return (model = { ...placed, order: collator() });
  };

  const bar = doc.createElement('div');
  bar.className = 'tf-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Table filter');
  const search = doc.createElement('input');
  search.type = 'search';
  search.className = 'tf-search';
  search.placeholder = 'Filter rows';
  search.setAttribute('aria-label', 'Filter the rows of this table');
  const count = doc.createElement('span');
  count.className = 'tf-count';
  count.setAttribute('aria-live', 'polite');
  const clear = doc.createElement('button');
  clear.type = 'button';
  clear.className = 'tf-clear';
  clear.textContent = 'Clear';
  clear.title = 'Show every row in the order written';
  bar.append(search, count, clear);
  if (onToPage) {
    const put = doc.createElement('button');
    put.type = 'button';
    put.className = 'tf-put';
    put.textContent = 'Put on page';
    put.title = 'Put the rows shown on a page of a note, as a table you can edit';
    put.onclick = () => { const r = put.getBoundingClientRect(); onToPage({ ...toPage(table), x: r.left, y: r.bottom + 4 }); };
    bar.append(put);
  }
  const wrap = doc.createElement('div');
  wrap.className = 'tf-wrap';
  table.before(wrap);
  wrap.append(bar, table);

  // Columns: every header cell one column wide sorts and filters its column.
  const headers = [];
  if (table.tHead) {
    const taken = [];
    [...table.tHead.rows].forEach((tr, r) => {
      let c = 0;
      for (const th of tr.cells) {
        while (taken[r]?.has(c)) c++;
        for (let i = r; i < r + (th.rowSpan || 1); i++) for (let j = c; j < c + (th.colSpan || 1); j++) (taken[i] ||= new Set()).add(j);
        if ((th.colSpan || 1) === 1) headers.push({ th, column: c });
        c += th.colSpan || 1;
      }
    });
  }
  for (const { th, column } of headers) {
    const name = th.textContent.trim() || `column ${column + 1}`;
    th.classList.add('tf-head');
    const mark = doc.createElement('span');
    mark.className = 'tf-sort';
    mark.setAttribute('aria-hidden', 'true');
    const values = doc.createElement('button');
    values.type = 'button';
    values.className = 'tf-values';
    values.textContent = '▾';
    values.title = `Show only some values of ${name}`;
    values.setAttribute('aria-label', `Filter by the values of ${name}`);
    values.onclick = (event) => { event.stopPropagation(); valueMenu(values, column, name); };
    th.append(mark, values);
    if (spanned) { th.title = 'Sorting is off: rows of this table share merged cells. Filtering keeps them together.'; continue; }
    th.classList.add('tf-sortable');
    th.tabIndex = 0;
    th.title = `Sort by ${name} (again: the other way, then as written)`;
    const sort = () => {
      state.dir = state.column === column ? (state.dir === 1 ? -1 : state.dir === -1 ? 0 : 1) : 1;
      state.column = state.dir ? column : -1;
      apply();
    };
    th.addEventListener('click', sort);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
  }

  function apply() {
    const m = ensure();
    const shown = visibleGroups(m.grid, m.groups, state);
    const order = sortedGroups(m.grid, m.groups, state.column, state.dir, m.order);
    let rows = 0;
    const sequence = [];
    for (const g of order) {
      const [first, last] = m.groups[g];
      for (let r = first; r <= last; r++) { original[r].hidden = !shown[g]; sequence.push(original[r]); }
      if (shown[g]) rows += last - first + 1;
    }
    body.append(...sequence);
    const active = Boolean(state.query.trim() || state.values.size || state.dir);
    count.textContent = rows < original.length ? `${rows} of ${original.length} rows` : `${original.length} rows`;
    clear.hidden = !active;
    for (const { th, column } of headers) {
      th.setAttribute('aria-sort', state.column === column ? (state.dir === 1 ? 'ascending' : 'descending') : 'none');
      th.querySelector('.tf-sort').textContent = state.column === column ? (state.dir === 1 ? '▲' : '▼') : '';
      th.querySelector('.tf-values').classList.toggle('active', state.values.has(column));
    }
    wrap.classList.toggle('tf-active', active);
  }
  let typing = 0;
  search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { state.query = search.value; apply(); }, 120); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; state.query = ''; apply(); } });
  clear.onclick = () => {
    search.value = '';
    Object.assign(state, { query: '', values: new Map(), column: -1, dir: 0 });
    apply();
  };
  count.textContent = `${original.length} rows`;
  clear.hidden = true;

  // The values of one column, each with a check box; the filter follows every change.
  function valueMenu(anchor, column, name) {
    closeValueMenu(doc);
    const m = ensure(), list = distinctValues(m.grid, column, m.order);
    const allowed = state.values.get(column);
    const menu = doc.createElement('div');
    menu.className = 'tf-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', `Values of ${name}`);
    const title = doc.createElement('strong');
    title.textContent = name;
    const find = doc.createElement('input');
    find.type = 'search';
    find.placeholder = 'Find a value';
    find.setAttribute('aria-label', 'Find a value');
    find.hidden = list.length <= 10;
    const all = doc.createElement('label');
    all.className = 'tf-all';
    const allBox = doc.createElement('input');
    allBox.type = 'checkbox';
    all.append(allBox, doc.createTextNode(' All'));
    const items = doc.createElement('div');
    items.className = 'tf-items';
    const LIMIT = 500, boxes = [];
    for (const { value, count: n } of list.slice(0, LIMIT)) {
      const label = doc.createElement('label');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.checked = !allowed || allowed.has(value);
      box.value = value;
      const text = doc.createElement('span');
      text.textContent = value || '(empty)';
      if (!value) text.className = 'muted';
      const num = doc.createElement('span');
      num.className = 'tf-n';
      num.textContent = String(n);
      label.append(box, text, num);
      label.dataset.key = folded(value);
      items.append(label);
      boxes.push(box);
    }
    if (list.length > LIMIT) {
      const more = doc.createElement('p');
      more.className = 'muted';
      more.textContent = `The first ${LIMIT} of ${list.length} values; type in Filter rows for the others.`;
      items.append(more);
    }
    const sync = () => {
      const on = boxes.filter((b) => b.checked).length;
      allBox.checked = on === boxes.length;
      allBox.indeterminate = on > 0 && on < boxes.length;
      if (on === boxes.length && list.length <= LIMIT) state.values.delete(column);
      else state.values.set(column, new Set(boxes.filter((b) => b.checked).map((b) => b.value)));
      apply();
    };
    items.addEventListener('change', sync);
    allBox.addEventListener('change', () => { for (const b of boxes) if (!b.closest('label').hidden) b.checked = allBox.checked; sync(); });
    find.addEventListener('input', () => { const q = folded(find.value.trim()); for (const b of boxes) b.closest('label').hidden = Boolean(q) && !b.closest('label').dataset.key.includes(q); });
    menu.append(title, find, all, items);
    doc.body.append(menu);
    allBox.checked = boxes.every((b) => b.checked);
    allBox.indeterminate = !allBox.checked && boxes.some((b) => b.checked);
    const r = anchor.getBoundingClientRect(), view = doc.defaultView;
    menu.style.left = `${Math.max(8, Math.min(r.left, view.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${r.bottom + 4 + menu.offsetHeight > view.innerHeight ? Math.max(8, r.top - menu.offsetHeight - 4) : r.bottom + 4}px`;
    (find.hidden ? allBox : find).focus();
    const away = (e) => { if (!menu.contains(e.target) && e.target !== anchor) closeValueMenu(doc); };
    const keys = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeValueMenu(doc); anchor.focus(); } };
    doc.addEventListener('pointerdown', away, true);
    doc.addEventListener('keydown', keys, true);
    scroller?.addEventListener('scroll', () => closeValueMenu(doc), { once: true });
    menu.__off = () => { doc.removeEventListener('pointerdown', away, true); doc.removeEventListener('keydown', keys, true); };
  }
}

function closeValueMenu(doc) {
  for (const menu of doc.querySelectorAll('.tf-menu')) { menu.__off?.(); menu.remove(); }
}
