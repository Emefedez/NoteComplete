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

test('two fingers scroll when they move together, even as their gap wobbles, and zoom when they spread', () => {
  const g = new TouchGesture();
  g.start(t([100, 100], [200, 100]), 0);
  assert.deepEqual(g.move(t([100, 130], [200, 130])), [{ type: 'pan', dx: 0, dy: 30 }]);
  // The gap changes by 4%: still a scroll.
  assert.deepEqual(g.move(t([100, 160], [204, 160])), [{ type: 'pan', dx: 2, dy: 30 }]);
  g.end([], 500);
  const z = new TouchGesture();
  z.start(t([100, 100], [200, 100]), 0);
  const [zoom] = z.move(t([50, 100], [250, 100]));
  assert.equal(zoom.type, 'zoom');
  assert.equal(zoom.step, 2);
  assert.equal(zoom.x, 150);
  // Once zooming, it keeps zooming.
  assert.equal(z.move(t([40, 120], [260, 120]))[0].type, 'zoom');
  // One finger: the tool or the browser handles it.
  const h = new TouchGesture();
  h.start(t([0, 0]), 0);
  assert.deepEqual(h.move(t([0, 40])), []);
});

test('a two-finger scroll glides on when the fingers lift', () => {
  const g = new TouchGesture();
  const two = (y) => [{ clientX: 100, clientY: y }, { clientX: 200, clientY: y }];
  g.start(two(500), 0);
  for (let t = 16, y = 480; t <= 160; t += 16, y -= 20) g.move(two(y), t);
  const out = g.end([], 170);
  const fling = out.find((a) => a.type === 'fling');
  assert.ok(fling && fling.vy > 1000, JSON.stringify(out));
  // A scroll that stopped before lifting stays put.
  g.start(two(500), 1000);
  for (let t = 1016, y = 480; t <= 1100; t += 16, y -= 20) g.move(two(y), t);
  assert.deepEqual(g.end([], 1400), []);
});

test('two fingers held still open the quick menu, and lifting them does not undo', () => {
  const g = new TouchGesture();
  const two = [{ clientX: 100, clientY: 300 }, { clientX: 180, clientY: 300 }];
  g.start(two, 0);
  assert.deepEqual(g.hold(300), []);
  assert.deepEqual(g.hold(600), [{ type: 'menu', x: 140, y: 300 }]);
  assert.deepEqual(g.hold(900), []);
  assert.deepEqual(g.end([], 950), []);
  // Moved fingers are a scroll, not a hold.
  g.start(two, 2000);
  g.move([{ clientX: 100, clientY: 260 }, { clientX: 180, clientY: 260 }], 2050);
  assert.deepEqual(g.hold(2600), []);
});
