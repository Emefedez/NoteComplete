// A table on the page (docs/SHAPES-TABLES-MATH.md, T1): rows × columns of typed cells, made
// of ordinary items like a graph (graph.js): its border and rules are line shapes, the header
// row a highlighter band under them, each cell with text a typed text box (math when it
// has $…$). Every item is a part of the table (part.rs), the first one with its spec, so
// selecting any of it selects the table and Edit table brings the cells back to change,
// add or remove rows and columns. Noteful gets it as it looks.
const LINE = [0.35, 0.38, 0.44, 1], HEAD = [0.78, 0.86, 0.98, 1], TEXT = [0.12, 0.14, 0.16, 1];

export const TABLE_DEFAULTS = Object.freeze({ v: 1, cells: [['', '', ''], ['', '', ''], ['', '', '']], header: true, widths: null });
// A rectangular grid of strings (1–30 rows, 1–12 columns), a header flag and column widths
// (relative; null: equal).
export function tableSpec(value = {}) {
  const spec = { ...TABLE_DEFAULTS, ...value };
  const rows = (Array.isArray(spec.cells) && spec.cells.length ? spec.cells : TABLE_DEFAULTS.cells).slice(0, 30);
  const cols = Math.min(12, Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0))));
  const cells = rows.map((r) => Array.from({ length: cols }, (_, c) => String((Array.isArray(r) ? r[c] : '') ?? '').slice(0, 2000)));
  const widths = Array.isArray(spec.widths) && spec.widths.length === cols && spec.widths.every((w) => Number.isFinite(w) && w > 0) ? spec.widths : null;
  return { v: 1, cells, header: spec.header !== false, widths };
}
// Rows and columns added or taken away, keeping what is typed.
export function resized(spec, rows, cols) {
  spec = tableSpec(spec);
  rows = Math.min(30, Math.max(1, rows));
  cols = Math.min(12, Math.max(1, cols));
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => spec.cells[r]?.[c] ?? ''));
  const widths = spec.widths && spec.widths.length === cols ? spec.widths : null;
  return { ...spec, cells, widths };
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
  // The header's tint: a highlighter band under the ink, which blends with what is over it
  // (a filled shape would hide the header's text, drawn below strokes).
  if (spec.header && rows > 1) lines.push({ points: [[bx, by + rh / 2], [bx + bw, by + rh / 2]], width: rh, rgba: HEAD, tool: 1, layer, square: true, under: true });
  // The border: the table's box exactly, so it can be drawn again where it is now after being
  // moved or resized (it carries the spec). Then the rules inside it.
  const border = { points: [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh], [bx, by]], width: 1.4, rgba: LINE, tool: 0, layer, shape: { kind: 'rectangle', start: [bx, by], end: [bx + bw, by + bh] } };
  lines.push(border);
  for (let r = 1; r < rows; r++) lines.push(shapeLine([bx, ys[r]], [bx + bw, ys[r]], spec.header && r === 1 ? 1.4 : 0.8, layer));
  for (let c = 1; c < cols; c++) lines.push(shapeLine([xs[c], by], [xs[c], by + bh], 0.8, layer));
  const size = Math.max(8, Math.min(16, rh * 0.45));
  spec.cells.forEach((row, r) => row.forEach((text, c) => {
    const value = text.trim();
    if (!value) return;
    const cellW = xs[c + 1] - xs[c], lines_ = value.split('\n').length;
    const w = Math.min(cellW - 6, Math.ceil(Math.max(...value.split('\n').map((l) => l.length)) * size * 0.58 + 12));
    const h = Math.min(rh - 2, Math.ceil(lines_ * size * 1.3 + 8));
    images.push({
      base64: '', mime: '', layer,
      bounds: [xs[c] + 3, ys[r] + Math.max(1, (rh - h) / 2), Math.max(size, w), Math.max(size, h)],
      text: { text: value, font_size: size, rgba: TEXT, bold: spec.header && r === 0 && rows > 1, italic: false, font: 'Helvetica', ...(/\$/.test(value) ? { math: true } : {}) },
    });
  }));
  for (const item of [...lines, ...images]) item.part = { id, kind: 'table', ...(item === border ? { spec: JSON.stringify(spec) } : {}) };
  return { lines, images, spec };
}
