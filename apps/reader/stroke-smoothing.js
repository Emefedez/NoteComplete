// Smoothing of drawn strokes. Stylus and finger samples jitter (and an Apple Pencil sends
// many of them), so each new point moves only part of the way to the pen; fast strokes are
// followed more closely so the line does not lag. When the pen lifts, one pass of Chaikin
// corner cutting rounds what is left.

// Smoothing is for the jitter of a long line. A small mark (a tilde, an accent, a dot, the
// hook of a letter) is drawn slowly, which is when smoothing pulled hardest, and has nothing to
// smooth: it came out flatter and shorter than drawn (a tilde lost a third of its height). So
// while a stroke is still small the line follows the pen closely, easing into the usual
// smoothing as the stroke grows past DETAIL page units, and a stroke that stays small is
// not rounded when the pen lifts.
export const DETAIL = 24;
const small = (extent) => Math.min(1, Math.max(0, 1 - extent / DETAIL));

// The next point of the line toward `raw`; `smooth` 0 means no smoothing. `extent`: how big
// the stroke is so far (the diagonal of its box). `dt`: milliseconds since the last sample.
// The smoothing was tuned for one sample every STEP_MS; an Apple Pencil sends one every ~4 ms,
// which pulled each point back twice as often and left the line lagging and flattened in
// small handwriting. With `dt` the pull and the speed are per unit of time, so a stroke comes
// out the same at 240 samples a second as at 120 or 60.
export const STEP_MS = 1000 / 120;
export function followPoint(last, raw, smooth, extent = Infinity, dt) {
  if (!smooth) return raw;
  const steps = Number.isFinite(dt) && dt > 0 ? Math.min(4, Math.max(0.25, dt / STEP_MS)) : 1;
  const gap = Math.hypot(raw[0] - last[0], raw[1] - last[1]) / steps;
  const ease = Math.min(0.85, smooth + gap / 60);
  const follow = 1 - (1 - (ease + (0.9 - ease) * small(extent))) ** steps;
  return [last[0] + (raw[0] - last[0]) * follow, last[1] + (raw[1] - last[1]) * follow];
}
// The diagonal of the box around some points.
export function extentOf(points) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return points.length ? Math.hypot(x1 - x0, y1 - y0) : 0;
}

// The pen's usual pressure, learnt from its strokes: `previous` (none at first) moves a tenth
// of the way to each stroke's median, so one light or heavy stroke changes little.
export function nextPressureBase(previous, pressures) {
  const firm = pressures.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (firm.length < 5) return previous;
  const median = firm[firm.length >> 1];
  const next = Number.isFinite(previous) ? previous + (median - previous) * 0.1 : median;
  return Math.min(0.9, Math.max(0.05, next));
}
// One pass of Chaikin: each segment becomes points at ¼ and ¾; the ends are kept and the
// pressure follows. Small marks and dots stay as they are, and so do very long ones.
export function smoothStroke(points, pressures, limit = 8192) {
  if (points.length < 3 || points.length * 2 > limit || extentOf(points) < DETAIL) return { points, pressures };
  const out = [points[0]], outP = [pressures[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]], [pa, pb] = [pressures[i], pressures[i + 1]];
    for (const t of [0.25, 0.75]) {
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      outP.push(Number.isFinite(pa) && Number.isFinite(pb) ? pa + (pb - pa) * t : pa ?? pb);
    }
  }
  out.push(points.at(-1));
  outP.push(pressures.at(-1));
  return { points: out, pressures: outP };
}

// The radius at each point of a stylus stroke (half the pen's width at neutral pressure):
// pressure 0 → 0.3×, 0.5 → 1×, 1 → 1.7×. How much of that a stroke shows depends on its size,
// because a short mark (a tilde, an accent, a dot, the cross of a t) has too few points for
// pressure to look like anything but a needle with a swollen middle: the smaller the stroke,
// the closer to the pen's plain width, and a word-long stroke gets all of it. The pressure
// samples are also smoothed a little: they jitter from point to point and make the edge bumpy.
// `base`: the pressure this pen writes with at rest (penPressureBase), drawn at the pen's own
// width. Measured against a fixed 0.5, an Apple Pencil (which writes nearer 0.2–0.3) came out
// at the pen's width while a stroke was small and thinner and thinner as it grew.
export const SMALL_STROKE = 14, LARGE_STROKE = 80;
export function pressureRadii(pressures, points, half, base = 0.5) {
  const level = (p) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5);
  const raw = pressures.map(level);
  const soft = raw.map((v, i) => (i === 0 || i === raw.length - 1 ? v : 0.25 * raw[i - 1] + 0.5 * v + 0.25 * raw[i + 1]));
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const size = points.length ? Math.hypot(x1 - x0, y1 - y0) : 0;
  const share = Math.min(1, Math.max(0, (size - SMALL_STROKE) / (LARGE_STROKE - SMALL_STROKE)));
  const factor = (v) => Math.min(1.7, Math.max(0.3, 1 + 1.4 * (v - base)));
  return soft.map((v) => Math.min(50, Math.max(0.05, half * (1 + share * (factor(v) - 1)))));
}

// A stroke with a radius at each point as one SVG path, as the core draws it (scene.rs
// run_outline, kept identical): a disc at each point and the band between neighbouring discs,
// all wound the same way so that filled they are their union, antialiased once along the edge.
export function runOutline(points, radii) {
  const f = (v) => Math.round(v * 1000) / 1000;
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i], r = f(radii[i]);
    d += `M${f(x + r)} ${f(y)}A${r} ${r} 0 1 1 ${f(x - r)} ${f(y)}A${r} ${r} 0 1 1 ${f(x + r)} ${f(y)}Z`;
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]], [ra, rb] = [radii[i], radii[i + 1]];
    const dx = b[0] - a[0], dy = b[1] - a[1], dist = Math.hypot(dx, dy);
    if (dist < 1e-9 || dist <= Math.abs(rb - ra)) continue;
    const ux = dx / dist, uy = dy / dist, k = (ra - rb) / dist, q = Math.sqrt(Math.max(0, 1 - k * k));
    const [ax, ay, bx, by] = [k * ux - q * uy, k * uy + q * ux, k * ux + q * uy, k * uy - q * ux];
    const quad = [[a[0] + ra * ax, a[1] + ra * ay], [b[0] + rb * ax, b[1] + rb * ay], [b[0] + rb * bx, b[1] + rb * by], [a[0] + ra * bx, a[1] + ra * by]];
    let area = 0;
    for (let j = 0; j < 4; j++) area += quad[j][0] * quad[(j + 1) % 4][1] - quad[(j + 1) % 4][0] * quad[j][1];
    if (area < 0) quad.reverse();
    d += `M${f(quad[0][0])} ${f(quad[0][1])}L${f(quad[1][0])} ${f(quad[1][1])}L${f(quad[2][0])} ${f(quad[2][1])}L${f(quad[3][0])} ${f(quad[3][1])}Z`;
  }
  return d;
}
