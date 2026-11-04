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
// the stroke is so far (the diagonal of its box).
export function followPoint(last, raw, smooth, extent = Infinity) {
  if (!smooth) return raw;
  const gap = Math.hypot(raw[0] - last[0], raw[1] - last[1]);
  const ease = Math.min(0.85, smooth + gap / 60);
  const follow = ease + (0.9 - ease) * small(extent);
  return [last[0] + (raw[0] - last[0]) * follow, last[1] + (raw[1] - last[1]) * follow];
}
// The diagonal of the box around some points.
export function extentOf(points) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return points.length ? Math.hypot(x1 - x0, y1 - y0) : 0;
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
export const SMALL_STROKE = 14, LARGE_STROKE = 80;
export function pressureRadii(pressures, points, half) {
  const level = (p) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5);
  const raw = pressures.map(level);
  const soft = raw.map((v, i) => (i === 0 || i === raw.length - 1 ? v : 0.25 * raw[i - 1] + 0.5 * v + 0.25 * raw[i + 1]));
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const size = points.length ? Math.hypot(x1 - x0, y1 - y0) : 0;
  const share = Math.min(1, Math.max(0, (size - SMALL_STROKE) / (LARGE_STROKE - SMALL_STROKE)));
  return soft.map((v) => Math.min(50, Math.max(0.05, half * (1 + share * (0.3 + 1.4 * v - 1)))));
}
