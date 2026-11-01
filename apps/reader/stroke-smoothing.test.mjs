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
  const { points, pressures } = smoothStroke([[0, 0], [10, 0], [10, 10]], [0.2, 0.4, 0.6]);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [10, 10]);
  assert.equal(points.length, 6);
  assert.deepEqual(pressures.map((p) => +p.toFixed(2)), [0.2, 0.25, 0.35, 0.45, 0.55, 0.6]);
  assert.deepEqual(smoothStroke([[1, 1]], [0.5]).points, [[1, 1]]);
});
