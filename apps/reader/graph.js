// A graph on the page (docs/SHAPES-TABLES-MATH.md, G1): empty axes and grid to draw on, or a
// function of x plotted on them. Made of ordinary items, sent as one `drawMany` edit (one undo
// step): grid lines and axes are line and arrow shapes, the curve is ink, numbers and axis
// names are typed text boxes. So every part can be selected, moved, recoloured or erased, and
// it exports to Noteful as it looks, with no graph object to keep in step.
import { compileFunction } from './math-eval.js';

const GRID = [0.8, 0.84, 0.9, 1], AXIS = [0.2, 0.22, 0.27, 1], LABEL = [0.35, 0.37, 0.42, 1];
const LABEL_SIZE = 11;

// A round step (1, 2 or 5 × 10ⁿ) giving about `lines` divisions of `span`.
export function niceStep(span, lines = 10) {
  const raw = span / lines, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.999);
}
const format = (v) => String(Math.round(v * 1e6) / 1e6).replace('-', '−');

// The y range that shows the curve: most of its values (outliers such as poles left out),
// and the x axis when it is near.
function yRange(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  let lo = sorted[Math.floor(sorted.length * 0.04)], hi = sorted[Math.ceil(sorted.length * 0.96) - 1];
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  if (lo > 0 && lo < (hi - lo) * 0.6) lo = -(hi - lo) * 0.05;
  if (hi < 0 && -hi < (hi - lo) * 0.6) hi = (hi - lo) * 0.05;
  return [lo, hi];
}

const shapeLine = (a, b, kind, width, rgba, layer) => ({ points: [a, b], width, rgba, tool: 0, layer, shape: { kind, start: a, end: b } });
const textBox = (text, x, y, layer, { size = LABEL_SIZE, rgba = LABEL, math = false } = {}) => {
  const w = Math.ceil(text.length * size * 0.62 + 12), h = Math.ceil(size * 1.4 + 8);
  return { base64: '', mime: '', bounds: [x, y, w, h], layer, text: { text, font_size: size, rgba, bold: false, italic: false, font: 'Helvetica', ...(math ? { math: true } : {}) } };
};

// `box`: [x, y, w, h] on the page. `tex`: a function of x (or none for empty axes). The
// curve takes `rgba` and `width` (the pen's). Returns { lines, images } for `drawMany`, and
// throws with a reason when the formula cannot be drawn.
export function graphItems(box, { tex = '', xRange = [-5, 5], rgba = [0.14, 0.42, 0.81, 1], width = 2, layer = 0 } = {}) {
  const [bx, by, bw, bh] = box;
  const [x0, x1] = xRange;
  const fn = tex.trim() ? compileFunction(tex) : null;
  const samples = fn ? Array.from({ length: 481 }, (_, i) => { const x = x0 + (x1 - x0) * i / 480; return [x, fn(x)]; }) : [];
  // Without a curve the cells are square: the y range follows the box's shape.
  const half = (x1 - x0) * bh / bw / 2;
  const [y0, y1] = (fn && yRange(samples.map((s) => s[1]))) || [-half, half];
  if (fn && !samples.some((s) => Number.isFinite(s[1]))) throw new Error('This function has no values between −5 and 5.');
  const px = (x) => bx + (x - x0) / (x1 - x0) * bw, py = (y) => by + bh - (y - y0) / (y1 - y0) * bh;
  const lines = [], images = [];
  // Grid.
  const sx = niceStep(x1 - x0), sy = niceStep(y1 - y0, fn ? 8 : Math.max(4, Math.round(10 * bh / bw)));
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) lines.push(shapeLine([px(x), by], [px(x), by + bh], 'line', 0.7, GRID, layer));
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) lines.push(shapeLine([bx, py(y)], [bx + bw, py(y)], 'line', 0.7, GRID, layer));
  // Axes through 0, or along the edge when 0 is out of view; arrows at the positive ends.
  const ax = y0 <= 0 && y1 >= 0 ? py(0) : by + bh, ay = x0 <= 0 && x1 >= 0 ? px(0) : bx;
  lines.push(shapeLine([bx, ax], [bx + bw + 10, ax], 'arrow', 1.4, AXIS, layer));
  lines.push(shapeLine([ay, by + bh], [ay, by - 10], 'arrow', 1.4, AXIS, layer));
  images.push(textBox('x', bx + bw + 6, ax + 2, layer, { size: 13, rgba: AXIS }));
  images.push(textBox('y', ay + 6, by - 24, layer, { size: 13, rgba: AXIS }));
  // Numbers on every other grid line at most, never at 0 or crowding the arrows.
  const every = (step, span) => (span / step > 7 ? 2 : 1);
  const ex = every(sx, x1 - x0), ey = every(sy, y1 - y0);
  // Every other one by value (−4, −2, 2, 4), so the numbers are even steps from 0.
  const labelled = (v, step, each) => Math.abs(v) > step / 2 && Math.round(v / step) % each === 0;
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1 - sx * 0.5; x += sx) if (labelled(x, sx, ex)) images.push(textBox(format(x), px(x) - 6, ax + 2, layer));
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1 - sy * 0.5; y += sy) if (labelled(y, sy, ey)) images.push(textBox(format(y), ay + 3, py(y) - 18, layer));
  // The curve: one ink line per visible run, cut where it leaves the box or jumps (a pole).
  let run = [];
  const flush = () => { if (run.length > 1) lines.push({ points: run, width, rgba, tool: 0, layer }); run = []; };
  for (let i = 0; i < samples.length; i++) {
    const [x, y] = samples[i], prev = samples[i - 1];
    const inside = Number.isFinite(y) && y >= y0 && y <= y1;
    const jump = prev && Number.isFinite(prev[1]) && Number.isFinite(y) && Math.abs(y - prev[1]) > (y1 - y0) * 0.9;
    if (jump) flush();
    if (inside) {
      // Entering from beyond an edge: start on the edge.
      if (!run.length && prev && Number.isFinite(prev[1]) && !jump) run.push(edgePoint(prev, [x, y], y0, y1, px, py));
      run.push([px(x), py(y)]);
    } else if (run.length) {
      if (Number.isFinite(y) && !jump) run.push(edgePoint(prev, [x, y], y0, y1, px, py));
      flush();
    }
  }
  flush();
  return { lines, images, range: { x: [x0, x1], y: [y0, y1] } };
}
// Where the segment from a to b crosses the box's top or bottom.
function edgePoint(a, b, y0, y1, px, py) {
  const edge = (b[1] > y1 || a[1] > y1) ? y1 : y0, t = (edge - a[1]) / (b[1] - a[1]);
  return [px(a[0] + (b[0] - a[0]) * t), py(edge)];
}
