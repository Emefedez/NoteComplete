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

export const TABLE_DEFAULTS = Object.freeze({ v: 1, cells: [['', '', ''], ['', '', ''], ['', '', '']], header: true, widths: null, background: 'header', tint: 'blue' });
// A rectangular grid of strings (1–30 rows, 1–12 columns), a header flag, column widths
// (relative; null: equal) and a background (BACKGROUNDS) in a colour (TINTS).
export function tableSpec(value = {}) {
  const spec = { ...TABLE_DEFAULTS, ...value };
  const rows = (Array.isArray(spec.cells) && spec.cells.length ? spec.cells : TABLE_DEFAULTS.cells).slice(0, 30);
  const cols = Math.min(12, Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0))));
  const cells = rows.map((r) => Array.from({ length: cols }, (_, c) => String((Array.isArray(r) ? r[c] : '') ?? '').slice(0, 2000)));
  const widths = Array.isArray(spec.widths) && spec.widths.length === cols && spec.widths.every((w) => Number.isFinite(w) && w > 0) ? spec.widths : null;
  const background = Object.hasOwn(BACKGROUNDS, spec.background) ? spec.background : 'header';
  const tint = Object.hasOwn(TINTS, spec.tint) ? spec.tint : 'blue';
  return { v: 1, cells, header: spec.header !== false, widths, background, tint };
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
