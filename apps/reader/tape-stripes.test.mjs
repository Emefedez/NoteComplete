import test from 'node:test';
import assert from 'node:assert/strict';
import { tapeStripes } from './tape-stripes.js';

const polys = (d) => d.split('M').filter(Boolean).map((s) => s.replace('Z', '').split('L').map((p) => p.split(' ').map(Number)));
const area = (poly) => Math.abs(poly.reduce((s, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

test('tape stripes cover 6/14 of the strip and stay inside it', () => {
  const d = tapeStripes([[0, 100], [280, 100]], 40);
  const shapes = polys(d);
  assert.ok(shapes.length > 10);
  for (const poly of shapes) for (const [x, y] of poly) assert.ok(x >= -1e-6 && x <= 280 + 1e-6 && y >= 80 - 1e-6 && y <= 120 + 1e-6, `${x},${y}`);
  const covered = shapes.reduce((s, p) => s + area(p), 0) / (280 * 40);
  assert.ok(Math.abs(covered - 6 / 14) < 0.05, `covered ${covered}`);
  // Turned tape: the same share, inside its own strip.
  const turned = polys(tapeStripes([[0, 0], [200, 200]], 30)).reduce((s, p) => s + area(p), 0) / (Math.hypot(200, 200) * 30);
  assert.ok(Math.abs(turned - 6 / 14) < 0.05, `turned ${turned}`);
  assert.equal(tapeStripes([[5, 5]], 40), '');
  assert.equal(tapeStripes([[0, 0], [10, 0]], 0), '');
});
