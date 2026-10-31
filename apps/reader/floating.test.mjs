import test from 'node:test';
import assert from 'node:assert/strict';
import { clampRect, resizeRect } from './floating.js';

const area = { width: 1000, height: 700 }, min = { width: 300, height: 200 };

test('a window is kept fully inside its area, so its head and × stay reachable', () => {
  assert.deepEqual(clampRect({ left: 900, top: -50, width: 400, height: 300 }, area, min), { left: 600, top: 0, width: 400, height: 300 });
  assert.deepEqual(clampRect({ left: -80, top: 650, width: 400, height: 300 }, area, min), { left: 0, top: 400, width: 400, height: 300 });
  assert.deepEqual(clampRect({ left: 0, top: 0, width: 1400, height: 900 }, area, min), { left: 0, top: 0, width: 1000, height: 700 });
  assert.deepEqual(clampRect({ left: 10, top: 10, width: 100, height: 50 }, area, min), { left: 10, top: 10, width: 300, height: 200 });
  // An area smaller than the minimum still wins.
  assert.deepEqual(clampRect({ left: 0, top: 0, width: 500, height: 500 }, { width: 250, height: 150 }, min), { left: 0, top: 0, width: 250, height: 150 });
});

test('resizing from an edge or corner moves only those sides, within limits', () => {
  const start = { left: 100, top: 100, width: 400, height: 300 };
  assert.deepEqual(resizeRect(start, 50, 40, 'br', min, area), { left: 100, top: 100, width: 450, height: 340 });
  assert.deepEqual(resizeRect(start, -50, 0, 'l', min, area), { left: 50, top: 100, width: 450, height: 300 });
  assert.deepEqual(resizeRect(start, 0, -500, 't', min, area), { left: 100, top: 0, width: 400, height: 400 });
  assert.deepEqual(resizeRect(start, -300, -300, 'br', min, area), { left: 100, top: 100, width: 300, height: 200 });
  assert.deepEqual(resizeRect(start, 2000, 2000, 'br', min, area), { left: 100, top: 100, width: 900, height: 600 });
  assert.deepEqual(resizeRect(start, 250, 0, 'l', min, area), { left: 200, top: 100, width: 300, height: 300 });
});
