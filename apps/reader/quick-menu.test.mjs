import test from 'node:test';
import assert from 'node:assert/strict';
import { ring, fitCentre, slotAt, moved, outerRadius, layoutSections, nearest } from './quick-menu.js';

test('items sit on a ring, the first at the top, clockwise', () => {
  assert.deepEqual(ring(4, 10), [{ x: 0, y: -10 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }]);
});

test('the menu moves in from the edges so it stays whole on screen', () => {
  const view = { width: 400, height: 800 };
  assert.deepEqual(fitCentre(10, 790, 140, view), { x: 148, y: 652 });
  assert.deepEqual(fitCentre(200, 400, 140, view), { x: 200, y: 400 });
  // Narrower than the menu: centred.
  assert.deepEqual(fitCentre(10, 400, 250, view), { x: 200, y: 400 });
});

test('a lifted tool drops into the nearest place on the ring', () => {
  assert.equal(slotAt(0, -50, 8), 0);
  assert.equal(slotAt(50, 0, 8), 2);
  assert.equal(slotAt(-5, -50, 8), 0);
  assert.equal(slotAt(-50, -45, 8), 7);
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
});

test('a crowded outer ring grows so its items keep a gap', () => {
  assert.equal(outerRadius(12), 94);
  assert.ok(outerRadius(15) > 94);
  const r = outerRadius(16), [a, b] = ring(16, r);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 41, 'neighbours at least item size + gap apart');
});

test('settings sit in the same places for every tool: colours on top, sizes below, small to large left to right', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({ key: i }));
  for (const sections of [
    { top: items(5), bottom: items(4), left: items(1), right: items(2) }, // pen
    { top: items(5), bottom: items(4), left: items(3), right: items(2) }, // highlighter
    { top: items(5), bottom: items(5), left: items(3), right: items(2) }, // shapes
    { bottom: items(4), right: items(2) },                                // eraser
  ]) {
    const { radius, positions, size } = layoutSections(sections);
    const xs = (k) => positions[k].map((p) => p.x), ys = (k) => positions[k].map((p) => p.y);
    if (sections.top) {
      assert.deepEqual(xs('top'), [...xs('top')].sort((a, b) => a - b), 'colours left to right');
      assert.ok(ys('top').every((y) => y < 0), 'colours above');
      assert.ok(Math.abs(positions.top[(sections.top.length - 1) / 2]?.x ?? 0) < 1, 'centred at 12 o’clock');
    }
    assert.deepEqual(xs('bottom'), [...xs('bottom')].sort((a, b) => a - b), 'sizes small to large, left to right');
    assert.ok(ys('bottom').every((y) => y > 0));
    if (sections.left) assert.deepEqual(ys('left'), [...ys('left')].sort((a, b) => a - b), 'modes top to bottom');
    const all = Object.values(positions).flat();
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
      assert.ok(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) >= size + 2, `no overlap (radius ${radius}, items ${size})`);
  }
  assert.equal(nearest([{ x: 0, y: -90 }, { x: 40, y: -80 }], 35, -70), 1);
});

test('a crowded ring tightens its items before it grows', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({ key: i }));
  // Shapes with eight kinds, three fills, five colours, undo and redo.
  const crowded = { top: items(5), bottom: items(8), left: items(3), right: items(2) };
  const tight = layoutSections(crowded);
  assert.equal(tight.size, 32, 'smaller items');
  assert.ok(tight.radius < 130, `radius ${tight.radius}`);
  const roomy = layoutSections({ top: items(5), bottom: items(4), left: items(1), right: items(2) });
  assert.equal(roomy.size, 36, 'a pen keeps its full-size items');
  assert.equal(roomy.radius, 94);
});
