// A table on the page (docs/SHAPES-TABLES-MATH.md, T1): rows × columns of typed cells, made
// of ordinary items like a graph (graph.js): its border and rules are line shapes, the header
// row a highlighter band under them, each cell with text a typed text box (math when it
// has $…$). Every item is a part of the table (part.rs), the first one with its spec, so
// selecting any of it selects the table and Edit table brings the cells back to change,
// add or remove rows and columns. Noteful gets it as it looks.
const LINE = [0.35, 0.38, 0.44, 1], TEXT = [0.12, 0.14, 0.16, 1];
// Background colours: the header's (and the whole table's) tint, and a lighter one for the
// rows of the body. Blue is the header tint tables always had.
export const TINTS = Object.freeze({
  blue: { label: 'Blue', head: [0.78, 0.86, 0.98, 1], body: [0.9, 0.94, 0.995, 1] },
  green: { label: 'Green', head: [0.78, 0.92, 0.8, 1], body: [0.9, 0.965, 0.91, 1] },
  yellow: { label: 'Yellow', head: [0.99, 0.92, 0.66, 1], body: [1, 0.97, 0.85, 1] },
  pink: { label: 'Pink', head: [0.98, 0.8, 0.86, 1], body: [0.995, 0.91, 0.94, 1] },
  grey: { label: 'Grey', head: [0.84, 0.85, 0.87, 1], body: [0.93, 0.935, 0.945, 1] },
});
// none: no background; header: the header row tinted (as before); striped: the header and every
// other row; all: the whole table, the header a shade darker.
export const BACKGROUNDS = Object.freeze({ none: 'None', header: 'Header', striped: 'Striped rows', all: 'Whole table' });
// The rules drawn: every one, only the outline, only those between rows (with the top and bottom
// edges), or none. A header row or column keeps its thicker rule in all of them.
export const BORDERS = Object.freeze({ all: 'All', outer: 'Outline', horizontal: 'Rows only', none: 'None' });
// Text size: auto follows the rows' height (as tables always did); the others are fixed.
export const TEXT_SIZES = Object.freeze({ auto: { label: 'Auto' }, small: { label: 'Small', size: 10 }, medium: { label: 'Medium', size: 13 }, large: { label: 'Large', size: 17 } });
export const ALIGNS = Object.freeze(['left', 'center', 'right']), VALIGNS = Object.freeze(['top', 'middle', 'bottom']);

export const TABLE_DEFAULTS = Object.freeze({ v: 1, cells: [['', '', ''], ['', '', ''], ['', '', '']], header: true, widths: null, background: 'header', tint: 'blue', merges: [] });
// A 50 × 20 table is about 1,100 items on the page, drawn in one step.
export const MAX_ROWS = 50, MAX_COLUMNS = 20;
// Cells joined into one (docs/TABLES-AND-OFFICE.md, phase 1): [row, column, rows, columns], the
// first cell's text shown across the whole area. Kept inside the grid, at least two cells each,
// never overlapping (a later one that overlaps an earlier one is dropped).
export function normalMerges(merges, rows, cols) {
  const taken = new Set(), out = [];
  for (const m of Array.isArray(merges) ? merges : []) {
    if (!Array.isArray(m) || m.length < 4 || !m.every(Number.isInteger)) continue;
    const [r, c] = m;
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
    const rs = Math.min(Math.max(1, m[2]), rows - r), cs = Math.min(Math.max(1, m[3]), cols - c);
    if (rs * cs < 2) continue;
    const keys = [];
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) keys.push(i * cols + j);
    if (keys.some((k) => taken.has(k))) continue;
    keys.forEach((k) => taken.add(k));
    out.push([r, c, rs, cs]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
// Relative sizes (column widths, row heights): one positive number per column or row, or null.
const relative = (list, n) => (Array.isArray(list) && list.length === n && list.every((w) => Number.isFinite(w) && w > 0) ? list : null);
export const cellKey = (r, c) => `${r},${c}`;
const parseKey = (key) => { const m = /^(\d+),(\d+)$/.exec(key); return m ? [+m[1], +m[2]] : null; };
// A cell's own look, kept only for cells that have one, under "row,column" (a merged area under
// its first cell): bold and italic (true or false, over the header's bold), align (ALIGNS),
// valign (VALIGNS) and fill (a TINTS colour).
export function normalFormat(format, rows, cols, merges = []) {
  const out = {};
  if (!format || typeof format !== 'object' || Array.isArray(format)) return out;
  const keys = Object.keys(format).map((k) => [k, parseKey(k)]).filter(([, rc]) => rc && rc[0] < rows && rc[1] < cols)
    .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]);
  for (const [key, [r, c]] of keys) {
    const f = format[key];
    if (!f || typeof f !== 'object') continue;
    // A cell inside a merge (not its first) shows nothing of its own.
    if (merges.some(([mr, mc, rs, cs]) => r >= mr && r < mr + rs && c >= mc && c < mc + cs && (r !== mr || c !== mc))) continue;
    const g = {};
    if (typeof f.bold === 'boolean') g.bold = f.bold;
    if (typeof f.italic === 'boolean') g.italic = f.italic;
    if (ALIGNS.includes(f.align)) g.align = f.align;
    if (VALIGNS.includes(f.valign)) g.valign = f.valign;
    if (Object.hasOwn(TINTS, f.fill)) g.fill = f.fill;
    if (Object.keys(g).length) out[cellKey(r, c)] = g;
  }
  return out;
}
// A rectangular grid of strings (1–50 rows, 1–20 columns), a header flag, column widths
// (relative; null: equal), a background (BACKGROUNDS) in a colour (TINTS) and merged cells.
// Version 2 when cells are merged; a table without merges is the version 1 it always was.
// Version 3 when it uses any of: row heights (`heights`, relative like widths, or `fit`: rows as
// tall as their text), per-cell `format`, a `headerColumn`, `borders` (BORDERS) other than all, a
// text `size` (TEXT_SIZES) other than auto. Without them a table is exactly what it was.
export function tableSpec(value = {}) {
  const spec = { ...TABLE_DEFAULTS, ...value };
  const rows = (Array.isArray(spec.cells) && spec.cells.length ? spec.cells : TABLE_DEFAULTS.cells).slice(0, MAX_ROWS);
  const cols = Math.min(MAX_COLUMNS, Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0))));
  const cells = rows.map((r) => Array.from({ length: cols }, (_, c) => String((Array.isArray(r) ? r[c] : '') ?? '').slice(0, 2000)));
  const widths = relative(spec.widths, cols);
  const background = Object.hasOwn(BACKGROUNDS, spec.background) ? spec.background : 'header';
  const tint = Object.hasOwn(TINTS, spec.tint) ? spec.tint : 'blue';
  const merges = normalMerges(spec.merges, cells.length, cols);
  const heights = relative(spec.heights, cells.length);
  const format = normalFormat(spec.format, cells.length, cols, merges);
  const extra = {
    ...(heights ? { heights } : spec.fit === true ? { fit: true } : {}),
    ...(Object.keys(format).length ? { format } : {}),
    ...(spec.headerColumn === true ? { headerColumn: true } : {}),
    ...(Object.hasOwn(BORDERS, spec.borders) && spec.borders !== 'all' ? { borders: spec.borders } : {}),
    ...(Object.hasOwn(TEXT_SIZES, spec.size) && spec.size !== 'auto' ? { size: spec.size } : {}),
  };
  const v = Object.keys(extra).length ? 3 : merges.length ? 2 : 1;
  return { v, cells, header: spec.header !== false, widths, background, tint, ...(merges.length ? { merges } : {}), ...extra };
}
// The merge covering a cell, or null.
export function mergeAt(spec, r, c) {
  return (spec.merges || []).find(([mr, mc, rs, cs]) => r >= mr && r < mr + rs && c >= mc && c < mc + cs) || null;
}
// The cell that shows a cell's area: the first cell of its merge, or itself.
export function anchorOf(spec, r, c) {
  const m = mergeAt(spec, r, c);
  return m ? [m[0], m[1]] : [r, c];
}
// The rows and columns from one cell to another, grown until no merge is cut by its edge.
export function mergeArea(spec, [r0, c0], [r1, c1]) {
  let top = Math.min(r0, r1), left = Math.min(c0, c1), bottom = Math.max(r0, r1), right = Math.max(c0, c1);
  for (let grew = true; grew;) {
    grew = false;
    for (const [mr, mc, rs, cs] of spec.merges || []) {
      if (mr > bottom || mr + rs - 1 < top || mc > right || mc + cs - 1 < left) continue;
      const next = [Math.min(top, mr), Math.min(left, mc), Math.max(bottom, mr + rs - 1), Math.max(right, mc + cs - 1)];
      if (next[0] !== top || next[1] !== left || next[2] !== bottom || next[3] !== right) { [top, left, bottom, right] = next; grew = true; }
    }
  }
  return [top, left, bottom - top + 1, right - left + 1];
}
// The cells that show something in an area [row, column, rows, columns]: each merge's first cell
// once, the others as they are.
export function areaAnchors(spec, [r, c, rs, cs]) {
  const out = [], seen = new Set();
  for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) {
    const [ar, ac] = anchorOf(spec, i, j), key = cellKey(ar, ac);
    if (!seen.has(key)) { seen.add(key); out.push([ar, ac]); }
  }
  return out;
}
// A cell's own look (its merge's first cell's), or {}.
export function formatOf(spec, r, c) {
  const [ar, ac] = anchorOf(spec, r, c);
  return spec.format?.[cellKey(ar, ac)] || {};
}
// `patch` given to the cells (their merges' first cells): a field set to null is taken away.
export function formatCells(spec, cells, patch) {
  spec = tableSpec(spec);
  const format = { ...(spec.format || {}) };
  for (const [r, c] of cells) {
    const key = cellKey(...anchorOf(spec, r, c)), next = { ...(format[key] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
    format[key] = next;
  }
  return tableSpec({ ...spec, format });
}
// The cells from one to another joined into one. The merges inside it become part of it, and
// the text of every cell in it is kept, one line each, in the first cell.
export function mergeCells(spec, from, to) {
  spec = tableSpec(spec);
  const [r, c, rs, cs] = mergeArea(spec, from, to);
  if (rs * cs < 2) return spec;
  const cells = spec.cells.map((row) => [...row]), texts = [];
  for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) {
    if (cells[i][j].trim()) texts.push(cells[i][j].trim());
    cells[i][j] = '';
  }
  cells[r][c] = texts.join('\n');
  const merges = (spec.merges || []).filter(([mr, mc]) => !(mr >= r && mr < r + rs && mc >= c && mc < c + cs));
  return tableSpec({ ...spec, cells, merges: [...merges, [r, c, rs, cs]] });
}
// The merge covering a cell split back into single cells (the text stays in the first one).
export function splitCell(spec, r, c) {
  spec = tableSpec(spec);
  const m = mergeAt(spec, r, c);
  return m ? tableSpec({ ...spec, merges: spec.merges.filter((x) => x !== m) }) : spec;
}
// Merges after `count` rows (axis 0) or columns (axis 1) are inserted before `at` (count > 0)
// or removed from `at` on (count < 0): moved past it, grown when it lands inside them, shrunk
// when part of them goes.
export function shiftMerges(merges, axis, at, count) {
  const out = [];
  for (const m of merges || []) {
    const next = [...m], start = m[axis], span = m[axis + 2];
    if (count > 0) {
      if (start >= at) next[axis] = start + count;
      else if (at < start + span) next[axis + 2] = span + count;
    } else {
      const gone0 = at, gone1 = at - count; // removed: [gone0, gone1)
      const keepBefore = Math.max(0, Math.min(start + span, gone0) - start);
      const keepAfter = Math.max(0, start + span - Math.max(start, gone1));
      if (keepBefore + keepAfter === 0) continue;
      next[axis] = start < gone0 ? start : gone0;
      next[axis + 2] = keepBefore + keepAfter;
    }
    out.push(next);
  }
  return out;
}
// The cells' looks after rows (axis 0) or columns (axis 1) are inserted or removed, as shiftMerges.
export function shiftFormat(format, axis, at, count) {
  const out = {};
  for (const [key, f] of Object.entries(format || {})) {
    const rc = parseKey(key);
    if (!rc) continue;
    let k = rc[axis];
    if (count > 0) { if (k >= at) k += count; }
    else if (k >= at && k < at - count) continue;
    else if (k >= at - count) k += count;
    rc[axis] = k;
    out[cellKey(...rc)] = f;
  }
  return out;
}
// `count` rows (axis 0) or columns (axis 1) inserted before `at`, empty, as wide or tall as the
// one beside them; the merges, widths, heights and cell looks follow. Never past the limits.
export function insertLines(spec, axis, at, count = 1) {
  spec = tableSpec(spec);
  const rows = spec.cells.length, cols = spec.cells[0].length, n = axis ? cols : rows;
  count = Math.min(count, (axis ? MAX_COLUMNS : MAX_ROWS) - n);
  at = Math.max(0, Math.min(at, n));
  if (count <= 0) return spec;
  const cells = spec.cells.map((r) => [...r]);
  if (axis) cells.forEach((r) => r.splice(at, 0, ...Array(count).fill('')));
  else cells.splice(at, 0, ...Array.from({ length: count }, () => Array(cols).fill('')));
  const grow = (list) => { if (!list) return list; const next = [...list]; next.splice(at, 0, ...Array(count).fill(list[Math.min(at, list.length - 1)])); return next; };
  return tableSpec({ ...spec, cells, merges: shiftMerges(spec.merges, axis, at, count), format: shiftFormat(spec.format, axis, at, count),
    ...(axis ? { widths: grow(spec.widths) } : { heights: grow(spec.heights) }) });
}
// `count` rows or columns removed from `at` on (one is always left).
export function deleteLines(spec, axis, at, count = 1) {
  spec = tableSpec(spec);
  const n = axis ? spec.cells[0].length : spec.cells.length;
  count = Math.min(count, n - at, n - 1);
  if (at < 0 || count <= 0) return spec;
  const cells = spec.cells.map((r) => [...r]);
  if (axis) cells.forEach((r) => r.splice(at, count));
  else cells.splice(at, count);
  const shrink = (list) => { if (!list) return list; const next = [...list]; next.splice(at, count); return next; };
  return tableSpec({ ...spec, cells, merges: shiftMerges(spec.merges, axis, at, -count), format: shiftFormat(spec.format, axis, at, -count),
    ...(axis ? { widths: shrink(spec.widths) } : { heights: shrink(spec.heights) }) });
}
// Rows and columns added or taken away at the end, keeping what is typed.
export function resized(spec, rows, cols) {
  spec = tableSpec(spec);
  rows = Math.min(MAX_ROWS, Math.max(1, rows));
  cols = Math.min(MAX_COLUMNS, Math.max(1, cols));
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => spec.cells[r]?.[c] ?? ''));
  const widths = spec.widths && spec.widths.length === cols ? spec.widths : null;
  return tableSpec({ ...spec, cells, widths });
}
// The rows that can be sorted: all but the header row. Not when a merge spans rows among them
// (a row cannot move without the rows it is joined to).
export function canSort(spec) {
  const body = spec.header && spec.cells.length > 1 ? 1 : 0;
  return spec.cells.length - body >= 2 && !(spec.merges || []).some(([r, , rs]) => rs > 1 && r + rs > body);
}
// Numbers by value (a decimal comma too), the rest as words with their numbers in order; empty
// cells last either way.
const numeric = (t) => (/^[-+]?(\d+([.,]\d*)?|[.,]\d+)(e[-+]?\d+)?%?$/i.test(t) ? Number(t.replace(',', '.').replace('%', '')) : null);
export function compareCells(a, b) {
  a = a.trim(); b = b.trim();
  const na = numeric(a), nb = numeric(b);
  if (na !== null && nb !== null) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
// The rows below the header in the order of column `col` (dir 1 up, -1 down), the same rows'
// heights, merges and cell looks going with them. Equal cells keep their order.
export function sortRows(spec, col, dir = 1) {
  spec = tableSpec(spec);
  if (!canSort(spec)) return spec;
  const body = spec.header && spec.cells.length > 1 ? 1 : 0;
  const text = (r) => spec.cells[r][anchorOf(spec, r, col)[1]] ?? '';
  const order = spec.cells.map((_, r) => r).slice(body).sort((a, b) => {
    const ta = text(a).trim(), tb = text(b).trim();
    if (!ta || !tb) return (!ta) - (!tb) || a - b;
    return dir * compareCells(ta, tb) || a - b;
  });
  order.unshift(...spec.cells.map((_, r) => r).slice(0, body));
  const to = new Map(order.map((from, i) => [from, i]));
  const format = {};
  for (const [key, f] of Object.entries(spec.format || {})) { const [r, c] = parseKey(key); format[cellKey(to.get(r), c)] = f; }
  return tableSpec({ ...spec, cells: order.map((r) => spec.cells[r]), heights: spec.heights && order.map((r) => spec.heights[r]),
    merges: (spec.merges || []).map(([r, c, rs, cs]) => [to.get(r), c, rs, cs]), format });
}
// A block of cells (table-paste.js: { cells, merges } with merges relative to the block) written
// from cell `at` on: the table grows to take it, up to the limits (what is past them is left
// out), merges it lands on are split, and its own merges come with it.
export function pasteBlock(spec, [r0, c0], block) {
  spec = tableSpec(spec);
  const h = Math.min(block.cells.length, MAX_ROWS - r0), w = Math.min(Math.max(0, ...block.cells.map((r) => r.length)), MAX_COLUMNS - c0);
  if (h <= 0 || w <= 0) return spec;
  spec = insertLines(spec, 0, spec.cells.length, r0 + h - spec.cells.length);
  spec = insertLines(spec, 1, spec.cells[0].length, c0 + w - spec.cells[0].length);
  const cells = spec.cells.map((r) => [...r]);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) cells[r0 + i][c0 + j] = String(block.cells[i]?.[j] ?? '');
  const outside = ([r, c, rs, cs]) => r >= r0 + h || r + rs <= r0 || c >= c0 + w || c + cs <= c0;
  const pasted = (block.merges || []).map(([r, c, rs, cs]) => [r0 + r, c0 + c, Math.min(rs, h - r), Math.min(cs, w - c)]);
  return tableSpec({ ...spec, cells, merges: [...(spec.merges || []).filter(outside), ...pasted] });
}

// Row heights, relative: the ones it was given, all equal, or (fit) each row as tall as its
// tallest text needs — a row of n lines (1.3 font sizes each, 0.9 of padding) against one line.
export function rowWeights(spec) {
  const rows = spec.cells.length;
  if (spec.heights) return spec.heights;
  const weights = Array(rows).fill(1);
  if (!spec.fit) return weights;
  spec.cells.forEach((row, r) => row.forEach((text, c) => {
    const value = text.trim(), m = mergeAt(spec, r, c);
    if (!value || (m && (m[0] !== r || m[1] !== c))) return;
    const rs = m ? m[2] : 1, need = (0.9 + 1.3 * value.split('\n').length) / 2.2 / rs;
    for (let i = r; i < r + rs; i++) weights[i] = Math.max(weights[i], need);
  }));
  return weights;
}
// The size a table is drawn at when it is first put on the page, or grows to when rows or lines
// are added in the editor: 120 per column, a row of one line 44 tall with auto text (a 3 × 3
// table: 360 × 132, as tables always were), less with smaller fixed text.
export function tableNaturalSize(spec) {
  spec = tableSpec(spec);
  const fixed = TEXT_SIZES[spec.size || 'auto'].size, unit = fixed ? Math.max(26, fixed * 2.4) : 44;
  const weights = rowWeights(spec), least = Math.min(...weights);
  return [120 * spec.cells[0].length, unit * weights.reduce((s, w) => s + w / least, 0)];
}

const shapeLine = (a, b, width, layer) => ({ points: [a, b], width, rgba: LINE, tool: 0, layer, shape: { kind: 'line', start: a, end: b } });

// `box`: [x, y, w, h]. Returns { lines, images } for drawMany, all parts of table `id`.
export function tableItems(box, spec = {}, { layer = 0, id = `t${Date.now().toString(36)}` } = {}) {
  spec = tableSpec(spec);
  const [bx, by, bw, bh] = box, rows = spec.cells.length, cols = spec.cells[0].length;
  const total = spec.widths ? spec.widths.reduce((s, w) => s + w, 0) : cols;
  const xs = [bx];
  for (let c = 0; c < cols; c++) xs.push(xs[c] + bw * (spec.widths ? spec.widths[c] : 1) / total);
  // Rows: equal (as tables always were, the same numbers exactly), or by their heights.
  const weights = rowWeights(spec), sum = weights.reduce((s, w) => s + w, 0), even = weights.every((w) => w === weights[0]);
  const rh = bh / rows, ys = [by];
  for (let r = 0; r < rows; r++) ys.push(even ? by + (r + 1) * rh : ys[r] + bh * weights[r] / sum);
  const rowH = (r) => (even ? rh : ys[r + 1] - ys[r]);
  const lines = [], images = [];
  // Backgrounds: highlighter bands under the ink, which blend with what is over them (a filled
  // shape would hide the cells' text, drawn below strokes). One band per tinted row, broken
  // where a cell has its own fill (a band over a band would blend into a third colour).
  const tint = TINTS[spec.tint], headed = spec.header && rows > 1, headCol = !!spec.headerColumn && cols > 1;
  const fills = [], filled = spec.cells.map((row) => row.map(() => false));
  spec.cells.forEach((row, r) => row.forEach((_, c) => {
    const m = mergeAt(spec, r, c);
    if (m && (m[0] !== r || m[1] !== c)) return;
    const own = spec.format?.[cellKey(r, c)]?.fill;
    const rgba = own ? TINTS[own].head : headCol && c === 0 && !(headed && r === 0) && spec.background !== 'none' ? tint.head : null;
    if (!rgba) return;
    const [rs, cs] = m ? [m[2], m[3]] : [1, 1];
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) filled[i][j] = true;
    fills.push({ points: [[xs[c], (ys[r] + ys[r + rs]) / 2], [xs[c + cs], (ys[r] + ys[r + rs]) / 2]], width: ys[r + rs] - ys[r], rgba, tool: 1, layer, square: true, under: true });
  }));
  const band = (r, rgba) => {
    for (let i = 0; i < cols;) {
      if (filled[r][i]) { i++; continue; }
      let j = i;
      while (j < cols && !filled[r][j]) j++;
      const y = ys[r] + rowH(r) / 2;
      lines.push({ points: [[i === 0 ? bx : xs[i], y], [j === cols ? bx + bw : xs[j], y]], width: rowH(r), rgba, tool: 1, layer, square: true, under: true });
      i = j;
    }
  };
  for (let r = 0; r < rows; r++) {
    const head = headed && r === 0;
    const body = r - (headed ? 1 : 0);
    if (spec.background === 'all') band(r, head ? tint.head : tint.body);
    else if (spec.background === 'striped') { if (head) band(r, tint.head); else if (body % 2 === 1) band(r, tint.body); }
    else if (spec.background === 'header' && head) band(r, tint.head);
  }
  lines.push(...fills);
  // The border: the table's box exactly, so it can be drawn again where it is now after being
  // moved or resized (it carries the spec); without an outline it is there but clear. Then the
  // rules inside it.
  const borders = spec.borders || 'all', outline = borders === 'all' || borders === 'outer';
  const border = { points: [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh], [bx, by]], width: 1.4, rgba: outline ? LINE : [...LINE.slice(0, 3), 0], tool: 0, layer, shape: { kind: 'rectangle', start: [bx, by], end: [bx + bw, by + bh] } };
  lines.push(border);
  if (borders === 'horizontal') lines.push(shapeLine([bx, by], [bx + bw, by], 1.4, layer), shapeLine([bx, by + bh], [bx + bw, by + bh], 1.4, layer));
  // Rules between rows and columns, cut where a merged area crosses them: one line per run of
  // uncut stretches.
  const merges = spec.merges || [];
  const crosses = (axis, k, i) => merges.some((m) => m[axis] < k && k < m[axis] + m[axis + 2] && i >= m[1 - axis] && i < m[1 - axis] + m[3 - axis]);
  const rule = (axis, k, width) => {
    const n = axis === 0 ? cols : rows, at = axis === 0 ? xs : ys;
    for (let i = 0; i < n;) {
      if (crosses(axis, k, i)) { i++; continue; }
      let j = i;
      while (j < n && !crosses(axis, k, j)) j++;
      lines.push(axis === 0 ? shapeLine([at[i], ys[k]], [at[j], ys[k]], width, layer) : shapeLine([xs[k], at[i]], [xs[k], at[j]], width, layer));
      i = j;
    }
  };
  for (let r = 1; r < rows; r++) {
    const head = spec.header && r === 1;
    if (head || borders === 'all' || borders === 'horizontal') rule(0, r, head ? 1.4 : 0.8);
  }
  for (let c = 1; c < cols; c++) {
    const head = headCol && c === 1;
    if (head || borders === 'all') rule(1, c, head ? 1.4 : 0.8);
  }
  const fixed = TEXT_SIZES[spec.size || 'auto'].size;
  const unit = even ? rh : bh * Math.min(...weights) / sum;
  const size = fixed || Math.max(8, Math.min(16, unit * 0.45));
  spec.cells.forEach((row, r) => row.forEach((text, c) => {
    const value = text.trim(), m = mergeAt(spec, r, c);
    if (!value || (m && (m[0] !== r || m[1] !== c))) return;
    // A cell's area, or its merge's: merged cells have their text in the middle unless told
    // otherwise; every cell is centred top to bottom unless told otherwise.
    const f = spec.format?.[cellKey(r, c)] || {};
    const [rs, cs] = m ? [m[2], m[3]] : [1, 1];
    const areaW = xs[c + cs] - xs[c], areaH = ys[r + rs] - ys[r], lines_ = value.split('\n').length;
    const w = Math.max(size, Math.min(areaW - 6, Math.ceil(Math.max(...value.split('\n').map((l) => l.length)) * size * 0.58 + 12)));
    const h = Math.max(size, Math.min(areaH - 2, Math.ceil(lines_ * size * 1.3 + 8)));
    const align = f.align || (m ? 'center' : 'left'), valign = f.valign || 'middle';
    const x = align === 'center' ? xs[c] + Math.max(3, (areaW - w) / 2) : align === 'right' ? Math.max(xs[c] + 3, xs[c + cs] - 3 - w) : xs[c] + 3;
    const y = valign === 'top' ? ys[r] + 1 : valign === 'bottom' ? Math.max(ys[r] + 1, ys[r + rs] - 1 - h) : ys[r] + Math.max(1, (areaH - h) / 2);
    // Lines inside the box aligned too (the text box's own align, which Noteful keeps), when
    // the cell asks for it.
    const boxAlign = f.align === 'center' ? 1 : f.align === 'right' ? 2 : 0;
    images.push({
      base64: '', mime: '', layer,
      bounds: [x, y, w, h],
      text: { text: value, font_size: size, rgba: TEXT, bold: f.bold ?? ((headed && r === 0) || (headCol && c === 0)), italic: f.italic ?? false, font: 'Helvetica', ...(boxAlign ? { align: boxAlign } : {}), ...(/\$/.test(value) ? { math: true } : {}) },
    });
  }));
  for (const item of [...lines, ...images]) item.part = { id, kind: 'table', ...(item === border ? { spec: JSON.stringify(spec) } : {}) };
  return { lines, images, spec };
}
