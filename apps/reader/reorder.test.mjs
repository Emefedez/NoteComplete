import test from 'node:test';
import assert from 'node:assert/strict';
import { pulledOut, slotFor } from './reorder.js';

test('a dragged item lands between the centres around it', () => {
  assert.equal(slotFor(5, [10, 30, 50]), 0);
  assert.equal(slotFor(40, [10, 30, 50]), 2);
});

test('a tab counts as pulled out well below or above the strip, or outside the window', () => {
  const row = { top: 4, bottom: 30 }, view = { width: 1280, height: 860 };
  assert.equal(pulledOut({ x: 400, y: 60 }, row, view), false);
  assert.equal(pulledOut({ x: 400, y: 90 }, row, view), true);
  assert.equal(pulledOut({ x: -5, y: 20 }, row, view), true);
  assert.equal(pulledOut({ x: 1300, y: 20 }, row, view), true);
  assert.equal(pulledOut({ x: 400, y: -2 }, row, view), true);
});
