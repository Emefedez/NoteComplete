import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeShape } from './shape-recognize.js';
import { shapePoints } from './shapes.js';

// Strokes "drawn by hand": points along a path every ~3 units, a wobble across it, turned
// about its centre and moved onto the page.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function drawn(path, { seed = 1, wobble = 1.5, angle = 0, at = [300, 300], step = 3 } = {}) {
  const random = rng(seed), out = [];
  const c = path.reduce((s, p) => [s[0] + p[0] / path.length, s[1] + p[1] / path.length], [0, 0]);
  const t = angle * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) {
      const x = a[0] + (b[0] - a[0]) * j / n - c[0] + (random() - 0.5) * wobble * 2, y = a[1] + (b[1] - a[1]) * j / n - c[1] + (random() - 0.5) * wobble * 2;
      out.push([at[0] + x * cs - y * sn, at[1] + x * sn + y * cs]);
    }
  }
  return out;
}
const polygon = (corners, overshoot = 0.08) => {
  // Closed, with the pen going a little past where it started.
  const p = [...corners, corners[0]], extra = corners[1];
  return [...p, [corners[0][0] + (extra[0] - corners[0][0]) * overshoot, corners[0][1] + (extra[1] - corners[0][1]) * overshoot]];
};
const ellipsePath = (rx, ry, turns = 1.04) => Array.from({ length: 80 }, (_, i) => {
  const t = (i / 79) * turns * 2 * Math.PI - Math.PI / 2;
  return [rx * Math.cos(t), ry * Math.sin(t)];
});
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const size = (s) => [Math.abs(s.end[0] - s.start[0]), Math.abs(s.end[1] - s.start[1])];

test('a straight stroke is a line, snapped to level when nearly level', () => {
  const s = recognizeShape(drawn([[0, 0], [200, 9]]));
  assert.equal(s.kind, 'line');
  assert.ok(near(s.start[1], s.end[1], 1e-6), 'levelled');
  const slanted = recognizeShape(drawn([[0, 0], [200, 60]], { seed: 3 }));
  assert.equal(slanted.kind, 'line');
  assert.ok(!near(slanted.start[1], slanted.end[1], 10), 'a real slope stays');
});

test('a shaft with a head drawn without lifting is an arrow pointing at the tip', () => {
  const path = [[0, 0], [200, 0], [180, -16], [200, 0], [180, 16]];
  for (const angle of [0, 35, -120]) {
    const s = recognizeShape(drawn(path, { angle, seed: angle + 9 }));
    assert.equal(s?.kind, 'arrow', `at ${angle}°`);
    assert.ok(Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1]) > 180);
  }
});

test('rectangles, level or at an angle, with their size; near-squares become squares', () => {
  const s = recognizeShape(drawn(polygon([[0, 0], [240, 0], [240, 140], [0, 140]])));
  assert.equal(s.kind, 'rectangle');
  assert.equal(s.rotation, 0);
  const [w, h] = size(s);
  assert.ok(near(w, 240, 10) && near(h, 140, 10), `${w}×${h}`);
  const turned = recognizeShape(drawn(polygon([[0, 0], [240, 0], [240, 140], [0, 140]]), { angle: 25, seed: 4 }));
  assert.equal(turned.kind, 'rectangle');
  assert.ok(near(turned.rotation, 25, 4), `${turned.rotation}°`);
  const square = recognizeShape(drawn(polygon([[0, 0], [150, 0], [150, 140], [0, 140]]), { seed: 5 }));
  assert.equal(square.kind, 'rectangle');
  const [sw, sh] = size(square);
  assert.ok(near(sw, sh, 1e-6), 'square');
});

test('ellipses and circles', () => {
  const e = recognizeShape(drawn(ellipsePath(140, 70), { seed: 6 }));
  assert.equal(e.kind, 'ellipse');
  const [w, h] = size(e);
  assert.ok(near(w, 280, 16) && near(h, 140, 12), `${w}×${h}`);
  const c = recognizeShape(drawn(ellipsePath(90, 85), { seed: 7, angle: 40 }));
  assert.equal(c.kind, 'ellipse');
  assert.equal(c.rotation, 0, 'a circle needs no turn');
  const [cw, ch] = size(c);
  assert.ok(near(cw, ch, 1e-6));
  const turned = recognizeShape(drawn(ellipsePath(150, 60), { seed: 8, angle: -30 }));
  assert.equal(turned.kind, 'ellipse');
  assert.ok(near(turned.rotation, -30, 5), `${turned.rotation}°`);
});

test('triangles point up, down (a flipped box) or turned', () => {
  const up = recognizeShape(drawn(polygon([[100, 0], [200, 170], [0, 170]]), { seed: 10 }));
  assert.equal(up.kind, 'triangle');
  assert.equal(up.rotation, 0);
  assert.ok(up.start[1] < up.end[1], 'point at the top of the box');
  const down = recognizeShape(drawn(polygon([[0, 0], [200, 0], [100, 170]]), { seed: 11 }));
  assert.equal(down.kind, 'triangle');
  assert.equal(down.rotation, 0);
  assert.ok(down.start[1] > down.end[1], 'box upside down');
  // Clearly isosceles: a nearly equilateral one has no one point, and is made level instead.
  const turned = recognizeShape(drawn(polygon([[100, 0], [200, 230], [0, 230]]), { seed: 12, angle: 50 }));
  assert.equal(turned.kind, 'triangle');
  assert.ok(near(turned.rotation, 50, 6), `${turned.rotation}°`);
});

test('a nearly equilateral triangle keeps a level base', () => {
  const t = recognizeShape(drawn(polygon([[100, 0], [200, 175], [0, 175]]), { seed: 19, angle: 4 }));
  assert.equal(t?.kind, 'triangle');
  assert.equal(t.rotation, 0);
});

test('what a hand adds: the pen held still at the end, a tick where it lands', () => {
  // Jitter while the pen is held to snap: a cluster of points round the end.
  const hold = (points, seed = 1) => {
    const random = rng(seed), end = points.at(-1);
    return [...points, ...Array.from({ length: 30 }, () => [end[0] + (random() - 0.5) * 3, end[1] + (random() - 0.5) * 3])];
  };
  assert.equal(recognizeShape(hold(drawn([[0, 0], [45, 0]], { seed: 20 })))?.kind, 'line', 'a short line, held');
  assert.equal(recognizeShape(hold(drawn([[0, 0], [200, 0], [180, -16], [200, 0], [180, 16]], { seed: 21 })))?.kind, 'arrow');
  const tick = drawn([[0, 0], [160, 0]], { seed: 22 });
  assert.equal(recognizeShape([[tick[0][0] - 4, tick[0][1] + 5], ...tick])?.kind, 'line', 'a tick where the pen lands');
});

test('circles and ovals drawn past their start, or not quite closed', () => {
  const over = recognizeShape(drawn(ellipsePath(120, 80, 1.2), { seed: 23 }));
  assert.equal(over?.kind, 'ellipse', 'a fifth of a turn too far');
  const [w, h] = size(over);
  assert.ok(near(w, 240, 16) && near(h, 160, 14), `${w}×${h}`);
  assert.equal(recognizeShape(drawn(ellipsePath(120, 80, 0.92), { seed: 24 }))?.kind, 'ellipse', 'a gap at the top');
  // A wobbly, egg-shaped oval is still an oval.
  const egg = ellipsePath(110, 70).map(([x, y]) => [x * (1 + 0.06 * Math.sin(Math.atan2(y, x))), y]);
  assert.equal(recognizeShape(drawn(egg, { seed: 25, wobble: 2.5 }))?.kind, 'ellipse');
});

test('rectangles and triangles drawn with round corners', () => {
  const rounded = (corners, r) => {
    const out = [];
    for (let i = 0; i <= corners.length; i++) {
      const a = corners[(i + corners.length - 1) % corners.length], b = corners[i % corners.length], c = corners[(i + 1) % corners.length];
      const into = Math.hypot(b[0] - a[0], b[1] - a[1]), out_ = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const p = [b[0] + (a[0] - b[0]) * r / into, b[1] + (a[1] - b[1]) * r / into], q = [b[0] + (c[0] - b[0]) * r / out_, b[1] + (c[1] - b[1]) * r / out_];
      for (let t = 0; t <= 1; t += 0.25) out.push([(1 - t) ** 2 * p[0] + 2 * (1 - t) * t * b[0] + t * t * q[0], (1 - t) ** 2 * p[1] + 2 * (1 - t) * t * b[1] + t * t * q[1]]);
    }
    return out;
  };
  assert.equal(recognizeShape(drawn(rounded([[0, 0], [240, 0], [240, 140], [0, 140]], 24), { seed: 26 }))?.kind, 'rectangle');
  assert.equal(recognizeShape(drawn(rounded([[0, 0], [260, 0], [60, -180]], 18), { seed: 27, angle: 15 }))?.kind, 'triangle', 'a scalene one');
});

test('stars: a pentagram in one stroke, or the outline of one', () => {
  const outer = Array.from({ length: 5 }, (_, i) => {
    const t = (-90 + 72 * i) * Math.PI / 180;
    return [100 * Math.cos(t), 100 * Math.sin(t)];
  });
  const pentagram = [0, 2, 4, 1, 3, 0].map((i) => outer[i]);
  assert.equal(recognizeShape(drawn(pentagram, { seed: 13 }))?.kind, 'star');
  const outline = shapePoints('star', [0, 0], [200, 190]);
  const s = recognizeShape(drawn(outline, { seed: 14 }));
  assert.equal(s?.kind, 'star');
  const [w, h] = size(s);
  assert.ok(near(w, 200, 10) && near(h, 190, 10), `${w}×${h}`);
});

test('handwriting and loose scribbles stay ink', () => {
  const loops = Array.from({ length: 120 }, (_, i) => [i * 2 + 12 * Math.cos(i / 4), 14 * Math.sin(i / 4)]); // cursive "llll"
  assert.equal(recognizeShape(drawn(loops, { seed: 15 })), null);
  const zigzag = [[0, 0], [30, 60], [60, 0], [90, 60], [120, 0], [150, 60]];
  assert.equal(recognizeShape(drawn(zigzag, { seed: 16 })), null);
  const u = [[0, 0], [0, 120], [120, 120], [120, 0]];
  assert.equal(recognizeShape(drawn(u, { seed: 17 })), null);
  // A loop with a tail ("a", "6", "9"): not an oval.
  const six = [...ellipsePath(50, 50, 1).map(([x, y]) => [x, y + 50]), [0, 0], [-10, -60], [-20, -110]];
  assert.equal(recognizeShape(drawn(six, { seed: 28 })), null);
  // A spiral doubles back over itself without ever closing.
  const spiral = Array.from({ length: 120 }, (_, i) => { const t = i / 119 * 4 * Math.PI; return [(10 + t * 8) * Math.cos(t), (10 + t * 8) * Math.sin(t)]; });
  assert.equal(recognizeShape(drawn(spiral, { seed: 29 })), null);
  assert.equal(recognizeShape([[0, 0], [3, 2], [5, 6]]), null, 'too small');
});

test('strict (on lift): short strokes and lines stay ink, clean big shapes still convert', () => {
  assert.equal(recognizeShape(drawn([[0, 0], [60, 0]]), { strict: true }), null);
  assert.equal(recognizeShape(drawn(ellipsePath(14, 18), { seed: 18 }), { strict: true }), null, 'an "o" is a letter');
  assert.equal(recognizeShape(drawn(polygon([[0, 0], [240, 0], [240, 140], [0, 140]]), { wobble: 0.8 }), { strict: true })?.kind, 'rectangle');
});

test('the star drawn by shapes.js fills its box with the point at the top middle', () => {
  const p = shapePoints('star', [10, 20], [110, 120]);
  assert.equal(p.length, 11);
  assert.ok(near(p[0][0], 60, 1e-9) && near(p[0][1], 20, 1e-9));
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  assert.ok(near(Math.min(...xs), 10, 1e-9) && near(Math.max(...xs), 110, 1e-9));
  assert.ok(near(Math.min(...ys), 20, 1e-9) && near(Math.max(...ys), 120, 1e-9));
});
