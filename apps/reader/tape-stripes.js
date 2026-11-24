// Tape's washi stripes as plain shapes. The core paints them with an SVG <pattern>
// (scene.rs TAPE_DEFS); Safari on iPad painted that pattern as a solid white box over the tape
// (and, white on white, the tape vanished from the page thumbnails). Here the stripes are
// polygons: each 45° band (across the tape, period 14, 6 wide, as the pattern) clipped to the
// strip of each segment, all in one path that any browser fills the same way.
const PERIOD = 14, STRIPE = 6;

// Keeps the part of polygon `poly` where a·p + c >= 0 (one Sutherland–Hodgman step).
function clip(poly, [ax, ay], c) {
  const out = [], side = ([x, y]) => ax * x + ay * y + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

// The stripes of a tape drawn along `points` with `width`, as path data ("" when none).
export function tapeStripes(points, width) {
  const f = (v) => Math.round(v * 100) / 100, half = width / 2;
  let d = "";
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (length < 1e-6 || !(half > 0)) continue;
    const [ux, uy] = [dx / length, dy / length], [nx, ny] = [-uy, ux];
    // The segment's strip in its own frame: u along it, v across it.
    const strip = [[0, -half], [length, -half], [length, half], [0, half]];
    // u - v runs over [-half, length + half]; a stripe is the band k·P√2 ≤ u − v ≤ (k·P + S)√2.
    const step = PERIOD * Math.SQRT2, wide = STRIPE * Math.SQRT2;
    for (let k = Math.floor(-half / step) - 1; k * step <= length + half; k++) {
      const lo = k * step, hi = lo + wide;
      let poly = clip(strip, [1, -1], -lo);
      poly = clip(poly, [-1, 1], hi);
      if (poly.length < 3) continue;
      d += "M" + poly.map(([u, v]) => `${f(a[0] + ux * u + nx * v)} ${f(a[1] + uy * u + ny * v)}`).join("L") + "Z";
    }
  }
  return d;
}

// Replaces a page's pattern-painted tape copies (class nc-tape-pattern) with stripe paths.
export function stripeTapes(root, ns = "http://www.w3.org/2000/svg") {
  for (const line of root.querySelectorAll(".nc-tape-pattern polyline")) {
    const points = (line.getAttribute("points") || "").trim().split(/\s+/).map((pair) => pair.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
    const stripes = document.createElementNS(ns, "path");
    stripes.setAttribute("d", tapeStripes(points, Number(line.getAttribute("stroke-width")) || 0));
    stripes.setAttribute("class", "tape-stripes");
    stripes.setAttribute("fill", "#fff");
    stripes.setAttribute("fill-opacity", "0.42");
    line.replaceWith(stripes);
  }
}
