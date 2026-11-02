import test from 'node:test';
import assert from 'node:assert/strict';
import { ring, fitCentre } from './quick-menu.js';

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
