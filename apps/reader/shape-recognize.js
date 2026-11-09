// A pen stroke as a clean shape (docs/SHAPES-TABLES-MATH.md, S2): line, arrow, rectangle or
// square, ellipse or circle, triangle, star. Pure: points in page units in, a shape out
// ({kind, start, end, rotation}: the shape's box in its own frame and the angle in degrees
// it is turned by about its centre), or null when the stroke is not clearly one.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DEG = 180 / Math.PI;

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}
// `n` points evenly spaced along the stroke, so fast and slow parts weigh the same.
export function resample(points, n = 64) {
  const length = pathLength(points);
  if (!(length > 0)) return [points[0]];
  const step = length / (n - 1), out = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length && out.length < n; i++) {
    let a = points[i - 1];
    const b = points[i];
    let d = dist(a, b);
    while (carried + d >= step && out.length < n) {
      const t = (step - carried) / d, p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      out.push(p);
      a = p;
      d = dist(a, b);
      carried = 0;
    }
    carried += d;
  }
  while (out.length < n) out.push(points.at(-1));
  return out;
}
function diagonal(points) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return Math.hypot(x1 - x0, y1 - y0);
}
// The stroke without what the hand adds at its ends: the jitter while the pen is held still
// to snap (a cluster of points round where it stops, which a line or an arrow head would
// otherwise count as length and turns) and the little tick where the pen lands.
function steady(points, diag) {
  const reach = Math.min(Math.max(5, 0.04 * diag), 0.2 * diag);
  let end = points.length - 1;
  while (end > 1 && dist(points[end - 1], points.at(-1)) <= reach) end--;
  let start = 0;
  while (start < end - 1 && dist(points[start + 1], points[0]) <= reach) start++;
  const kept = points.slice(start, end + 1);
  // The held end is where the pen came to rest: the middle of the cluster.
  const rest = points.slice(end);
  kept[kept.length - 1] = rest.reduce((s, p) => [s[0] + p[0] / rest.length, s[1] + p[1] / rest.length], [0, 0]);
  // Tremor: points closer together than a hair's width add nothing but noise.
  const hair = Math.max(0.5, 0.008 * diag), out = [kept[0]];
  for (let i = 1; i < kept.length - 1; i++) if (dist(kept[i], out.at(-1)) >= hair) out.push(kept[i]);
  out.push(kept.at(-1));
  return out;
}
// Convex hull, counter-clockwise in page coordinates (monotone chain).
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function area(polygon) {
  let s = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}
// The smallest rectangle around the hull (one of its sides lies on a hull edge): centre,
// size along and across `angle` (radians).
function minAreaRect(h) {
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(angle), s = Math.sin(angle);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of h) {
      const u = x * c + y * s, v = -x * s + y * c;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
    const size = (x1 - x0) * (y1 - y0);
    if (!best || size < best.size) {
      const u = (x0 + x1) / 2, v = (y0 + y1) / 2;
      best = { size, angle, w: x1 - x0, h: y1 - y0, c: [u * c - v * s, u * s + v * c] };
    }
  }
  return best;
}
// Douglas–Peucker on an open polyline.
function simplify(points, eps) {
  if (points.length < 3) return points;
  let far = 0, index = 0;
  const a = points[0], b = points.at(-1), len = dist(a, b);
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = len > 0 ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len : dist(p, a);
    if (d > far) { far = d; index = i; }
  }
  if (far <= eps) return [a, b];
  return simplify(points.slice(0, index + 1), eps).slice(0, -1).concat(simplify(points.slice(index), eps));
}
// The corners of a closed stroke, in drawing order, and their signed turning angles. The
// stroke is split at its point farthest from the start, so where it starts is not a corner
// unless the shape has one there.
function corners(points, eps) {
  let far = 0;
  for (let i = 1; i < points.length; i++) if (dist(points[i], points[0]) > dist(points[far], points[0])) far = i;
  let v = simplify(points.slice(0, far + 1), eps).slice(0, -1).concat(simplify(points.slice(far), eps));
  if (v.length > 1 && dist(v[0], v.at(-1)) < eps * 2) v.pop();
  // Merge corners too close together and drop the ones where the stroke hardly turns.
  for (let changed = true; changed && v.length > 2;) {
    changed = false;
    for (let i = 0; i < v.length && v.length > 2; i++) {
      const prev = v[(i + v.length - 1) % v.length], next = v[(i + 1) % v.length];
      const turn = turnAt(prev, v[i], next);
      if (dist(prev, v[i]) < eps || Math.abs(turn) < 28) { v.splice(i, 1); changed = true; break; }
    }
  }
  const turns = v.map((p, i) => turnAt(v[(i + v.length - 1) % v.length], p, v[(i + 1) % v.length]));
  return { v, turns };
}
function turnAt(a, b, c) {
  let t = (Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * DEG;
  while (t > 180) t -= 360;
  while (t <= -180) t += 360;
  return t;
}
// Points in a frame centred on `c` and turned by `angle`.
const local = (p, c, angle) => {
  const x = p[0] - c[0], y = p[1] - c[1], cs = Math.cos(angle), sn = Math.sin(angle);
  return [x * cs + y * sn, -x * sn + y * cs];
};
// Angle in degrees to the nearest of a set of steps, when within `tolerance`.
function snapAngle(degrees, step, tolerance) {
  const nearest = Math.round(degrees / step) * step;
  return Math.abs(degrees - nearest) <= tolerance ? nearest : degrees;
}
const box = (c, w, h) => ({ start: [c[0] - w / 2, c[1] - h / 2], end: [c[0] + w / 2, c[1] + h / 2] });
// Sides within 13% of each other become equal (a square, a circle).
function evenSides(w, h) {
  if (Math.max(w, h) / Math.min(w, h) > 1.13) return [w, h];
  const s = (w + h) / 2;
  return [s, s];
}
// A rectangle's angle in (-45°, 45°], with its width and height swapped to match.
function levelled(rect) {
  let deg = rect.angle * DEG, w = rect.w, h = rect.h;
  while (deg > 45) { deg -= 90; [w, h] = [h, w]; }
  while (deg <= -45) { deg += 90; [w, h] = [h, w]; }
  return { deg, w, h };
}

// `strict` (shapes made on lift, without the pen held): only large, very clean shapes, and
// no lines, so handwriting stays handwriting.
export function recognizeShape(points, { strict = false } = {}) {
  const raw = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 0.01);
  if (raw.length < 3) return null;
  const rawDiag = diagonal(raw);
  if (rawDiag < (strict ? 64 : 14)) return null;
  const clean = steady(raw, rawDiag);
  if (clean.length < 3) return null;
  const xs = clean.map((p) => p[0]), ys = clean.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), diag = Math.hypot(bw, bh);
  if (diag < (strict ? 64 : 14)) return null;
  const first = clean[0], last = clean.at(-1);
  const r = resample(clean, 64);

  // A line: close to the straight line between its ends all along, and not doubling back
  // (the length is measured on a coarse copy, so a shaky hand does not add to it).
  const chord = dist(first, last);
  const off = chord > 0 ? Math.max(...clean.map((p) => Math.abs((last[0] - first[0]) * (first[1] - p[1]) - (first[0] - p[0]) * (last[1] - first[1])) / chord)) : Infinity;
  if (off <= (strict ? 0.035 : 0.07) * chord && chord / pathLength(resample(clean, 16)) >= 0.9) {
    if (strict && dist(first, last) < 150) return null;
    const angle = snapAngle(Math.atan2(last[1] - first[1], last[0] - first[0]) * DEG, 45, 6) / DEG, d = dist(first, last);
    return { kind: "line", start: first, end: [first[0] + d * Math.cos(angle), first[1] + d * Math.sin(angle)], rotation: 0 };
  }

  const arrow = arrowOf(r, strict);
  if (arrow) return arrow;

  // Everything else is closed: the ends meet, or the pen goes on past the start (then the
  // part drawn twice is left out).
  const loop = closed(clean, Math.max(bw, bh), strict);
  if (!loop) return null;
  const r2 = resample(loop, 64);
  const h = hull(loop), hullArea = area(h), rect = minAreaRect(h);
  if (!rect || rect.w < 1 || rect.h < 1) return null;
  const fill = hullArea / rect.size;
  const { v, turns } = corners(r2, 0.06 * diag);
  const k = v.length, turning = turns.reduce((s, t) => s + t, 0);

  // A star: a pentagram (five sharp corners, turning twice round) or its outline (about ten
  // corners, far and near the centre in turn).
  const pentagram = k >= 4 && k <= 7 && Math.abs(turning) > 540 && turns.filter((t) => Math.abs(t) > 100).length >= 4;
  let outline = false;
  if (k >= 8 && k <= 12) {
    const c = [xs.reduce((s, x) => s + x, 0) / xs.length, ys.reduce((s, y) => s + y, 0) / ys.length];
    const radii = v.map((p) => dist(p, c)), sorted = [...radii].sort((a, b) => a - b), half = Math.floor(k / 2);
    const inner = sorted.slice(0, half).reduce((s, x) => s + x, 0) / half, outer = sorted.slice(-half).reduce((s, x) => s + x, 0) / half;
    const alternates = radii.filter((x, i) => (x > (inner + outer) / 2) !== (radii[(i + 1) % k] > (inner + outer) / 2)).length >= k - 2;
    outline = alternates && inner / outer < 0.72 && area(v) < 0.8 * hullArea;
  }
  if (pentagram || outline) {
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { kind: "star", start: [x0, y0], end: [x0 + bw, y0 + bh], rotation: 0 };
  }
  if (strict && fill < 0.4) return null;

  // A rectangle, an ellipse or a triangle: each is fitted to the stroke and the one whose
  // outline the stroke follows most closely (both ways round: the stroke stays near the
  // outline, and the outline is drawn all round) wins, if it is close enough.
  const { deg, w, h: hh } = levelled(rect);
  const angle = deg / DEG;
  const start = { c: rect.c, a: w / 2, b: hh / 2, angle };
  const box4 = fitOutline(r2, start, toRectangle), ell = fitOutline(r2, start, toEllipse);
  const rectOutline = placed(box4, [[-box4.a, -box4.b], [box4.a, -box4.b], [box4.a, box4.b], [-box4.a, box4.b]]);
  const ellOutline = placed(ell, Array.from({ length: 48 }, (_, i) => [ell.a * Math.cos(i * Math.PI / 24), ell.b * Math.sin(i * Math.PI / 24)]));
  const tri = bestTriangle(h, r2);
  const fits = [
    { kind: "rectangle", err: misfit(r2, rectOutline) - (k === 4 ? 0.006 : 0) },
    { kind: "ellipse", err: misfit(r2, ellOutline) - (k <= 2 ? 0.006 : 0) },
    { kind: "triangle", err: tri ? tri.err - (k === 3 ? 0.006 : 0) : Infinity },
  ].sort((x, y) => x.err - y.err);
  const best = fits[0], limit = strict ? 0.026 : 0.036;
  if (!(best.err < limit)) return null;
  if (best.kind === "triangle") return triangleOf(tri.points);
  const fit = best.kind === "rectangle" ? box4 : ell;
  const e = levelled({ angle: fit.angle, w: 2 * fit.a, h: 2 * fit.b }), [sw, sh] = evenSides(e.w, e.h);
  const level = Math.abs(e.deg) < 7 || (best.kind === "ellipse" && sw === sh);
  return { kind: best.kind, ...box(fit.c, sw, sh), rotation: level ? 0 : e.deg };
}

// One stroke: a straight shaft, then a short head at the far end that stays behind the tip.
function arrowOf(r, strict) {
  // The tip is where the stroke first gets (nearly) farthest from the start: drawing the head
  // passes the tip again, and that second pass may be a little farther.
  const far = Math.max(...r.map((p) => dist(p, r[0])));
  let tip = r.findIndex((p) => dist(p, r[0]) >= 0.97 * far);
  while (tip + 1 < r.length && dist(r[tip + 1], r[0]) > dist(r[tip], r[0])) tip++;
  if (tip < r.length * 0.4 || tip > r.length - 4) return null;
  const a = r[0], b = r[tip], shaft = dist(a, b);
  // Straight: near the line from start to tip all along, and not doubling back (measured on a
  // coarse copy, as for a line, so a shaky hand does not count as a bend).
  const part = r.slice(0, tip + 1);
  const off = Math.max(...part.map((p) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / shaft));
  if (off > (strict ? 0.04 : 0.08) * shaft || shaft / pathLength(resample(part, 20)) < (strict ? 0.96 : 0.9)) return null;
  const head = r.slice(tip), headLength = pathLength(head);
  if (headLength < 0.09 * shaft || headLength > 1.4 * shaft) return null;
  const ux = (b[0] - a[0]) / shaft, uy = (b[1] - a[1]) / shaft;
  let side = 0;
  for (const p of head) {
    const dx = p[0] - b[0], dy = p[1] - b[1];
    if (Math.hypot(dx, dy) > 0.5 * shaft || dx * ux + dy * uy > 0.1 * shaft) return null;
    side = Math.max(side, Math.abs(dx * uy - dy * ux));
  }
  if (side < 0.045 * shaft) return null;
  return { kind: "arrow", start: a, end: b, rotation: 0 };
}
// The closed part of a stroke whose ends meet (a gap of up to a third of its size, a quarter
// when strict), or which goes on past its start and then follows its own beginning: cut
// where it comes closest to the start.
function closed(points, size, strict) {
  if (dist(points[0], points.at(-1)) <= (strict ? 0.25 : 0.35) * size) return points;
  const total = pathLength(points);
  let walked = 0, back = -1;
  for (let i = 1; i < points.length; i++) {
    walked += dist(points[i - 1], points[i]);
    if (walked > 0.55 * total && (back < 0 || dist(points[i], points[0]) < dist(points[back], points[0]))) back = i;
  }
  if (back < 0 || dist(points[back], points[0]) > 0.15 * size) return null;
  const early = points.slice(0, Math.ceil(points.length * 0.5));
  for (let i = back + 1; i < points.length; i++)
    if (Math.min(...early.map((q) => dist(points[i], q))) > 0.1 * size) return null;
  return points.slice(0, back + 1);
}
// The ellipse or rectangle a stroke follows: starting from the one its smallest rectangle
// gives, the centre, half sizes and angle are nudged while that brings the outline closer to
// the stroke (a hand-drawn oval or box seldom fills exactly the box around it: a wobble
// outwards on one side pushes that box out).
const toEllipse = (u, v, a, b) => Math.abs(Math.hypot(u / a, v / b) - 1) * Math.sqrt(a * b);
const toRectangle = (u, v, a, b) => {
  const x = Math.abs(u) - a, y = Math.abs(v) - b;
  return x > 0 || y > 0 ? Math.hypot(Math.max(x, 0), Math.max(y, 0)) : -Math.max(x, y);
};
function fitOutline(stroke, start, distance) {
  const cost = ({ c, a, b, angle }) => {
    if (!(a > 0.5 && b > 0.5)) return Infinity;
    const cs = Math.cos(angle), sn = Math.sin(angle);
    let sum = 0;
    for (const p of stroke) {
      const x = p[0] - c[0], y = p[1] - c[1];
      sum += distance(x * cs + y * sn, -x * sn + y * cs, a, b);
    }
    return sum / stroke.length;
  };
  let e = start, best = cost(e);
  const size = (start.a + start.b) / 2;
  for (let step = 0.08; step > 0.004; step /= 2)
    for (let improved = true, rounds = 0; improved && rounds < 8; rounds++) {
      improved = false;
      const d = step * size;
      for (const change of [
        { c: [e.c[0] + d, e.c[1]] }, { c: [e.c[0] - d, e.c[1]] }, { c: [e.c[0], e.c[1] + d] }, { c: [e.c[0], e.c[1] - d] },
        { a: e.a + d }, { a: e.a - d }, { b: e.b + d }, { b: e.b - d }, { angle: e.angle + step / 2 }, { angle: e.angle - step / 2 },
      ]) {
        const next = { ...e, ...change }, value = cost(next);
        if (value < best - 1e-9) { e = next; best = value; improved = true; }
      }
    }
  return e;
}
const placed = ({ c, a, b, angle }, points) => points.map(([x, y]) => [c[0] + x * Math.cos(angle) - y * Math.sin(angle), c[1] + x * Math.sin(angle) + y * Math.cos(angle)]);
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
// How far a closed stroke is from a closed outline, as a share of the outline's size: the
// mean distance from the stroke to the outline plus the mean distance from points all round
// the outline back to the stroke (so a stroke that leaves out a side does not fit).
function misfit(stroke, outline) {
  const ring = [...outline, outline[0]], size = Math.sqrt(area(outline));
  if (!(size > 0)) return Infinity;
  const near = (p, line) => {
    let d = Infinity;
    for (let i = 1; i < line.length; i++) d = Math.min(d, segmentDistance(p, line[i - 1], line[i]));
    return d;
  };
  const strokeRing = [...stroke, stroke[0]], round = resample(ring, 48);
  const there = stroke.map((p) => near(p, ring)), back = round.map((p) => near(p, strokeRing));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  // A tail or a loop off the outline (an "a", a "6") is a short part far from it, which the
  // means hardly see: the farthest few points count on their own.
  const worst = there.sort((a, b) => b - a)[Math.floor(there.length * 0.05)];
  return Math.max((mean(there) + mean(back)) / 2, worst / 4) / size;
}
// The triangle that fits the stroke best: the biggest one on its hull, grown a little about
// its centre when the corners were drawn round.
function bestTriangle(h, stroke) {
  const big = biggestTriangle(h);
  if (!big || !(big.area > 0)) return null;
  const c = big.points.reduce((s, p) => [s[0] + p[0] / 3, s[1] + p[1] / 3], [0, 0]);
  let best = null;
  for (const grow of [1, 1.04, 1.08, 1.12, 1.16]) {
    const points = big.points.map((p) => [c[0] + (p[0] - c[0]) * grow, c[1] + (p[1] - c[1]) * grow]);
    const err = misfit(stroke, points);
    if (!best || err < best.err) best = { err, points };
  }
  return best;
}
function biggestTriangle(h) {
  // A hull of a hand-drawn stroke has tens of points; fewer are enough to find the corners.
  const p = h.length > 40 ? h.filter((_, i) => i % Math.ceil(h.length / 40) === 0) : h;
  let best = null;
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++)
      for (let k = j + 1; k < p.length; k++) {
        const a = area([p[i], p[j], p[k]]);
        if (!best || a > best.area) best = { area: a, points: [p[i], p[j], p[k]] };
      }
  return best;
}
// The core's triangle is isosceles, point up in its box: the corner whose two sides are the
// most alike is the point, the other two the base; the box turns to match. When the triangle
// is nearly equilateral, so that any corner could be the point, the one that leaves the base
// level (or upright) wins.
function triangleOf(t) {
  let best = null;
  for (let i = 0; i < 3; i++) {
    const apex = t[i], b1 = t[(i + 1) % 3], b2 = t[(i + 2) % 3];
    const odd = Math.abs(dist(apex, b1) - dist(apex, b2)) / Math.max(dist(apex, b1), dist(apex, b2));
    const base = Math.abs(Math.atan2(b2[1] - b1[1], b2[0] - b1[0]) * DEG) % 90, tilt = Math.min(base, 90 - base);
    const score = odd + tilt / 600;
    if (!best || score < best.score) best = { score, apex, b1, b2 };
  }
  const { apex, b1, b2 } = best, m = [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2];
  const width = dist(b1, b2);
  // Across the base, towards the point: the height is the point's distance from the base line.
  let n = [-(b2[1] - b1[1]) / width, (b2[0] - b1[0]) / width];
  if (n[0] * (apex[0] - m[0]) + n[1] * (apex[1] - m[1]) < 0) n = [-n[0], -n[1]];
  const height = n[0] * (apex[0] - m[0]) + n[1] * (apex[1] - m[1]);
  let deg = snapAngle(Math.atan2(n[1], n[0]) * DEG + 90, 90, 8);
  while (deg > 180) deg -= 360;
  while (deg <= -180) deg += 360;
  const c = [m[0] + n[0] * height / 2, m[1] + n[1] * height / 2];
  // Pointing down: the same box upside down, with no turn.
  if (Math.abs(Math.abs(deg) - 180) < 1e-9) {
    const { start, end } = box(c, width, height);
    return { kind: "triangle", start: [start[0], end[1]], end: [end[0], start[1]], rotation: 0 };
  }
  return { kind: "triangle", ...box(c, width, height), rotation: Math.abs(deg) < 1e-9 ? 0 : deg };
}
