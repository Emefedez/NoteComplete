import test from 'node:test';
import assert from 'node:assert/strict';
import { followPoint, smoothStroke } from './stroke-smoothing.js';

// A straight stroke drawn with a jittery stylus: ±3 units up and down every sample.
const draw = (smooth) => {
  const pts = [[0, 0]];
  for (let i = 1; i <= 60; i++) pts.push(followPoint(pts.at(-1), [i * 5, i % 2 ? 3 : -3], smooth));
  return pts;
};
const wobble = (pts) => Math.max(...pts.slice(10).map((p) => Math.abs(p[1])));

test('a jittery stylus line is calmed, a mouse less, and nothing for other tools', () => {
  assert.equal(wobble(draw(0)), 3);
  assert.ok(wobble(draw(0.35)) < 1.6, `stylus wobble ${wobble(draw(0.35))}`);
  assert.ok(wobble(draw(0.6)) < wobble(draw(0)));
  // Fast strokes are followed closely: a long jump is not left far behind.
  const fast = followPoint([0, 0], [100, 0], 0.35);
  assert.ok(fast[0] >= 85);
});

test('rounding keeps the ends and the pressure, and leaves dots alone', () => {
  const { points, pressures } = smoothStroke([[0, 0], [30, 0], [30, 30]], [0.2, 0.4, 0.6]);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [30, 30]);
  assert.equal(points.length, 6);
  assert.deepEqual(pressures.map((p) => +p.toFixed(2)), [0.2, 0.25, 0.35, 0.45, 0.55, 0.6]);
  assert.deepEqual(smoothStroke([[1, 1]], [0.5]).points, [[1, 1]]);
});

test('pressure shows fully on a long stroke, and hardly on the small marks of accented letters', async () => {
  const { pressureRadii } = await import('./stroke-smoothing.js');
  const ramp = (n) => Array.from({ length: n }, (_, i) => 0.1 + 0.8 * Math.sin(Math.PI * i / (n - 1)));
  const along = (n, length) => Array.from({ length: n }, (_, i) => [i / (n - 1) * length, 0]);
  const spread = (radii) => Math.max(...radii) - Math.min(...radii);
  const long = pressureRadii(ramp(40), along(40, 200), 1);
  const tick = pressureRadii(ramp(8), along(8, 8), 1);
  const tilde = pressureRadii(ramp(12), along(12, 14), 1);
  // A word-long stroke keeps the whole range (thin ends, full middle); a tick is the pen's plain width.
  assert.ok(spread(long) > 1.1, `long spread ${spread(long)}`);
  assert.ok(spread(tick) < 0.001 && tick.every((r) => Math.abs(r - 1) < 1e-9), `tick ${tick}`);
  assert.ok(spread(tilde) < 0.001);
  // In between, gradually.
  const middle = pressureRadii(ramp(20), along(20, 45), 1);
  assert.ok(spread(middle) > spread(tilde) && spread(middle) < spread(long));
  // The pressure samples are smoothed: a spike no longer makes a bump of its own.
  const spiky = pressureRadii([0.5, 0.5, 1, 0.5, 0.5], along(5, 200), 1);
  const plain = pressureRadii([0.5, 0.5, 1, 0.5, 0.5].map(() => 1), along(5, 200), 1);
  assert.ok(Math.max(...spiky) < 0.3 + 1.4 * 1 - 0.05, `peak ${Math.max(...spiky)}`);
  assert.ok(plain.every((r) => Math.abs(r - 1.7) < 1e-9));
  // Missing pressure counts as neutral, and radii stay in bounds.
  assert.deepEqual(pressureRadii([NaN, undefined], along(2, 200), 1), [1, 1]);
  assert.ok(pressureRadii([1, 1], along(2, 200), 100).every((r) => r <= 50));
});

test('a small mark keeps its shape: the line follows the pen closely and is not rounded at the end', async () => {
  const { followPoint, smoothStroke, extentOf, DETAIL } = await import('./stroke-smoothing.js');
  // A tilde as drawn: 14 px long, 4 px high, 12 samples, slowly (the pen sends few points).
  const raw = Array.from({ length: 12 }, (_, i) => { const t = i / 11; return [t * 14, 2 + Math.sin(t * Math.PI * 2) * 2]; });
  const draw = (smooth, extentOf2) => { const line = [raw[0]]; for (const r of raw.slice(1)) line.push(followPoint(line.at(-1), r, smooth, extentOf2(line))); return line; };
  const height = (pts) => Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1]));
  const before = draw(0.35, () => Infinity);   // the old filter
  const now = draw(0.35, extentOf);
  assert.ok(height(before) < 3.2, `old ${height(before)}`);
  assert.ok(height(now) > 0.9 * height(raw), `a tilde keeps ${height(now) / height(raw)} of its height`);
  // A long line is smoothed as before.
  assert.deepEqual(followPoint([0, 0], [10, 0], 0.35, 500), followPoint([0, 0], [10, 0], 0.35));
  assert.ok(Math.hypot(...followPoint([0, 0], [10, 0], 0.35, 500)) < 5.5);
  // Mouse (0.6) and no smoothing keep working.
  assert.deepEqual(followPoint([0, 0], [10, 3], 0, 1), [10, 3]);
  // Between the two, gradually.
  const at = (extent) => followPoint([0, 0], [10, 0], 0.35, extent)[0];
  assert.ok(at(0) > at(DETAIL / 2) && at(DETAIL / 2) > at(DETAIL));
  // At the pen lift a small mark is left alone; a long stroke is rounded (twice the points).
  const pressures = raw.map(() => 0.5);
  assert.equal(smoothStroke(raw, pressures).points.length, raw.length);
  const long = Array.from({ length: 30 }, (_, i) => [i * 5, Math.sin(i / 3) * 9]);
  assert.equal(smoothStroke(long, long.map(() => 0.5)).points.length, long.length * 2);
  assert.equal(extentOf([]), 0);
});
