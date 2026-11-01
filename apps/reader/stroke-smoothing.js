// Smoothing of drawn strokes. Stylus and finger samples jitter (and an Apple Pencil sends
// many of them), so each new point moves only part of the way to the pen; fast strokes are
// followed more closely so the line does not lag. When the pen lifts, one pass of Chaikin
// corner cutting rounds what is left.

// The next point of the line toward `raw`; `smooth` 0 means no smoothing.
export function followPoint(last, raw, smooth) {
  if (!smooth) return raw;
  const gap = Math.hypot(raw[0] - last[0], raw[1] - last[1]);
  const ease = Math.min(0.85, smooth + gap / 60);
  return [last[0] + (raw[0] - last[0]) * ease, last[1] + (raw[1] - last[1]) * ease];
}

// One pass of Chaikin: each segment becomes points at ¼ and ¾; the ends are kept and the
// pressure follows. Short strokes and dots stay as they are, and so do very long ones.
export function smoothStroke(points, pressures, limit = 8192) {
  if (points.length < 3 || points.length * 2 > limit) return { points, pressures };
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
