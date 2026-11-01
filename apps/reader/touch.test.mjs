import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchGesture } from './touch.js';

const t = (...xy) => xy.map(([clientX, clientY]) => ({ clientX, clientY }));

test('a quick two-finger tap undoes and a three-finger tap redoes', () => {
  const g = new TouchGesture();
  assert.deepEqual(g.start(t([100, 100]), 0), []);
  assert.deepEqual(g.start(t([100, 100], [160, 100]), 20), [{ type: 'cancel' }]);
  assert.deepEqual(g.end(t([160, 100]), 120), []);
  assert.deepEqual(g.end([], 140), [{ type: 'undo' }]);
  g.start(t([100, 100]), 0); g.start(t([100, 100], [150, 100]), 10); g.start(t([100, 100], [150, 100], [200, 110]), 20);
  g.end(t([100, 100], [150, 100]), 150); g.end(t([100, 100]), 160);
  assert.deepEqual(g.end([], 170), [{ type: 'redo' }]);
});

test('one finger never undoes, and a slow or moving two-finger touch is not a tap', () => {
  const g = new TouchGesture();
  g.start(t([10, 10]), 0);
  assert.deepEqual(g.end([], 50), []);
  g.start(t([10, 10], [60, 10]), 0);
  assert.deepEqual(g.end([], 900), []);
  g.start(t([10, 10], [60, 10]), 0);
  g.move(t([10, 60], [60, 60]));
  assert.deepEqual(g.end([], 100), []);
});

test('two fingers pan when they move together and zoom when they spread', () => {
  const g = new TouchGesture();
  g.start(t([100, 100], [200, 100]), 0);
  assert.deepEqual(g.move(t([100, 130], [200, 130])), [{ type: 'pan', dx: 0, dy: 30 }]);
  const [zoom] = g.move(t([50, 130], [250, 130]));
  assert.equal(zoom.type, 'zoom');
  assert.equal(zoom.step, 2);
  assert.equal(zoom.x, 150);
  // One finger: the tool or the browser handles it.
  const h = new TouchGesture();
  h.start(t([0, 0]), 0);
  assert.deepEqual(h.move(t([0, 40])), []);
});
