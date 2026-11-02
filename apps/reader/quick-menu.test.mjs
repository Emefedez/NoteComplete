import test from 'node:test';
import assert from 'node:assert/strict';
import { ring, fitCentre, slotAt, moved } from './quick-menu.js';

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
