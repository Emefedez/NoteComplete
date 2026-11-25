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

export const TABLE_DEFAULTS = Object.freeze({ v: 1, cells: [['', '', ''], ['', '', ''], ['', '', '']], header: true, widths: null, background: 'header', tint: 'blue', merges: [] });
export const MAX_ROWS = 30, MAX_COLUMNS = 12;
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
// A rectangular grid of strings (1–30 rows, 1–12 columns), a header flag, column widths
// (relative; null: equal), a background (BACKGROUNDS) in a colour (TINTS) and merged cells.
// Version 2 when cells are merged; a table without merges is the version 1 it always was.
export function tableSpec(value = {}) {
  const spec = { ...TABLE_DEFAULTS, ...value };
  const rows = (Array.isArray(spec.cells) && spec.cells.length ? spec.cells : TABLE_DEFAULTS.cells).slice(0, MAX_ROWS);
  const cols = Math.min(MAX_COLUMNS, Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0))));
  const cells = rows.map((r) => Array.from({ length: cols }, (_, c) => String((Array.isArray(r) ? r[c] : '') ?? '').slice(0, 2000)));
  const widths = Array.isArray(spec.widths) && spec.widths.length === cols && spec.widths.every((w) => Number.isFinite(w) && w > 0) ? spec.widths : null;
  const background = Object.hasOwn(BACKGROUNDS, spec.background) ? spec.background : 'header';
  const tint = Object.hasOwn(TINTS, spec.tint) ? spec.tint : 'blue';
  const merges = normalMerges(spec.merges, cells.length, cols);
  return { v: merges.length ? 2 : 1, cells, header: spec.header !== false, widths, background, tint, ...(merges.length ? { merges } : {}) };
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
// Rows and columns added or taken away at the end, keeping what is typed.
export function resized(spec, rows, cols) {
  spec = tableSpec(spec);
  rows = Math.min(MAX_ROWS, Math.max(1, rows));
  cols = Math.min(MAX_COLUMNS, Math.max(1, cols));
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => spec.cells[r]?.[c] ?? ''));
  const widths = spec.widths && spec.widths.length === cols ? spec.widths : null;
  return tableSpec({ ...spec, cells, widths });
}

const shapeLine = (a, b, width, layer) => ({ points: [a, b], width, rgba: LINE, tool: 0, layer, shape: { kind: 'line', start: a, end: b } });

// `box`: [x, y, w, h]. Returns { lines, images } for drawMany, all parts of table `id`.
export function tableItems(box, spec = {}, { layer = 0, id = `t${Date.now().toString(36)}` } = {}) {
  spec = tableSpec(spec);
  const [bx, by, bw, bh] = box, rows = spec.cells.length, cols = spec.cells[0].length;
  const total = spec.widths ? spec.widths.reduce((s, w) => s + w, 0) : cols;
  const xs = [bx];
  for (let c = 0; c < cols; c++) xs.push(xs[c] + bw * (spec.widths ? spec.widths[c] : 1) / total);
  const rh = bh / rows, ys = Array.from({ length: rows + 1 }, (_, r) => by + r * rh);
  const lines = [], images = [];
  // Backgrounds: highlighter bands under the ink, which blend with what is over them (a filled
  // shape would hide the cells' text, drawn below strokes). One band per tinted row.
  const tint = TINTS[spec.tint], headed = spec.header && rows > 1;
  const band = (r, rgba) => lines.push({ points: [[bx, ys[r] + rh / 2], [bx + bw, ys[r] + rh / 2]], width: rh, rgba, tool: 1, layer, square: true, under: true });
  for (let r = 0; r < rows; r++) {
    const head = headed && r === 0;
    const body = r - (headed ? 1 : 0);
    if (spec.background === 'all') band(r, head ? tint.head : tint.body);
    else if (spec.background === 'striped') { if (head) band(r, tint.head); else if (body % 2 === 1) band(r, tint.body); }
    else if (spec.background === 'header' && head) band(r, tint.head);
  }
  // The border: the table's box exactly, so it can be drawn again where it is now after being
  // moved or resized (it carries the spec). Then the rules inside it.
  const border = { points: [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh], [bx, by]], width: 1.4, rgba: LINE, tool: 0, layer, shape: { kind: 'rectangle', start: [bx, by], end: [bx + bw, by + bh] } };
  lines.push(border);
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
  for (let r = 1; r < rows; r++) rule(0, r, spec.header && r === 1 ? 1.4 : 0.8);
  for (let c = 1; c < cols; c++) rule(1, c, 0.8);
  const size = Math.max(8, Math.min(16, rh * 0.45));
  spec.cells.forEach((row, r) => row.forEach((text, c) => {
    const value = text.trim(), m = mergeAt(spec, r, c);
    if (!value || (m && (m[0] !== r || m[1] !== c))) return;
    // A cell's area, or its merge's: merged cells have their text in the middle.
    const [rs, cs] = m ? [m[2], m[3]] : [1, 1];
    const areaW = xs[c + cs] - xs[c], areaH = ys[r + rs] - ys[r], lines_ = value.split('\n').length;
    const w = Math.max(size, Math.min(areaW - 6, Math.ceil(Math.max(...value.split('\n').map((l) => l.length)) * size * 0.58 + 12)));
    const h = Math.max(size, Math.min(areaH - 2, Math.ceil(lines_ * size * 1.3 + 8)));
    images.push({
      base64: '', mime: '', layer,
      bounds: [m ? xs[c] + Math.max(3, (areaW - w) / 2) : xs[c] + 3, ys[r] + Math.max(1, (areaH - h) / 2), w, h],
      text: { text: value, font_size: size, rgba: TEXT, bold: headed && r === 0, italic: false, font: 'Helvetica', ...(/\$/.test(value) ? { math: true } : {}) },
    });
  }));
  for (const item of [...lines, ...images]) item.part = { id, kind: 'table', ...(item === border ? { spec: JSON.stringify(spec) } : {}) };
  return { lines, images, spec };
}
