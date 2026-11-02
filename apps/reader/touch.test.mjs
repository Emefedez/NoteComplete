import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchGesture, deliberate, touchGestures } from './touch.js';

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

test('a two-finger scroll moves the pages by the whole finger movement, the first pixels included', () => {
  const g = new TouchGesture();
  const two = (y) => [{ clientX: 100, clientY: y }, { clientX: 200, clientY: y }];
  g.start(two(500), 0);
  let total = 0;
  for (let y = 495; y >= 400; y -= 5) for (const a of g.move(two(y), 500 - y)) if (a.type === 'pan') total += a.dy;
  assert.equal(total, -100);
});

test('only deliberate two-finger holds count: together, and not a palm', () => {
  const finger = { radiusX: 10, radiusY: 12 }, palm = { radiusX: 80, radiusY: 70 };
  assert.equal(deliberate([finger, finger], 80), true);
  assert.equal(deliberate([finger, finger], 600), false, 'a second finger long after the first');
  assert.equal(deliberate([finger, palm], 50), false, 'a resting palm');
  assert.equal(deliberate([{}, {}], 50), true, 'no radius reported');
});

test('iPad fingers count: Safari\'s coarse radii, 0 or missing, and only a clear palm is not', () => {
  // Safari on iPad: radiusX and radiusY both the touch's major radius, in steps of about 10.4.
  const ipad = (r) => ({ radiusX: r, radiusY: r, force: 0, touchType: 'direct' });
  assert.equal(deliberate([ipad(20.83), ipad(31.25)], 40), true, 'light fingertips');
  assert.equal(deliberate([ipad(41.67), ipad(41.67)], 40), true, 'fingertips pressed a little');
  assert.equal(deliberate([ipad(52.08), ipad(31.25)], 40), true, 'a thumb pressed flat');
  assert.equal(deliberate([ipad(0), ipad(0)], 40), true, 'radius 0: not reported');
  assert.equal(deliberate([{ radiusX: undefined, radiusY: undefined }, { radiusX: NaN }], 40), true, 'missing');
  assert.equal(deliberate([ipad(31.25), ipad(72.92)], 40), false, 'a palm');
  assert.equal(deliberate([ipad(31.25), { radiusX: 0, radiusY: 93.75 }], 40), false, 'a palm reported on one axis');
});

test('fingers held close together settle without turning the hold into a zoom', () => {
  const g = new TouchGesture();
  // Two fingertips side by side, 50 px apart; their gap shrinks by 5 px (10 %) as they settle.
  g.start(t([200, 300], [250, 300]), 0);
  assert.deepEqual(g.move(t([202, 300], [247, 301]), 60), []);
  assert.deepEqual(g.hold(400), [{ type: 'menu', x: 224.5, y: 300.5 }]);
  // A real pinch still zooms.
  const z = new TouchGesture();
  z.start(t([200, 300], [250, 300]), 0);
  assert.equal(z.move(t([190, 300], [262, 300]), 60)[0].type, 'zoom');
});

// touchGestures on a stand-in for the pages, fed iPad-like touch events.
function pages() {
  const handlers = {};
  return {
    scrollLeft: 0, scrollTop: 0,
    addEventListener(type, fn) { handlers[type] = fn; },
    fire(type, touches, changed, timeStamp) {
      const e = { type, touches, changedTouches: changed, timeStamp, prevented: false, preventDefault() { this.prevented = true; } };
      handlers[type]?.(e);
      return e;
    },
    has: (type) => !!handlers[type],
  };
}
const ipadFinger = (x, y, r = 31.25) => ({ clientX: x, clientY: y, radiusX: r, radiusY: r, force: 0, touchType: 'direct' });

test('iPad: two fingers that land in one event, held still, open the quick menu', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = pages(), menus = [];
  touchGestures({ viewport: view, pinchBy() {}, cancelGesture() {}, undo() {}, redo() {}, menu: (x, y) => menus.push([x, y]) });
  // An earlier one-finger touch, long ago: the gap is measured from this gesture's start.
  view.fire('touchstart', [ipadFinger(50, 50)], [ipadFinger(50, 50)], 1000);
  view.fire('touchend', [], [ipadFinger(50, 50)], 1100);
  const a = ipadFinger(300, 400), b = ipadFinger(380, 400, 41.67);
  assert.equal(view.fire('touchstart', [a, b], [a, b], 9000).prevented, true);
  t.mock.timers.tick(400);
  assert.deepEqual(menus, [[340, 400]]);
  view.fire('touchend', [], [a, b], 9500);
});

test('iPad: a hold whose fingers were never heard lifting does not spoil the next one', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = pages(), menus = [];
  touchGestures({ viewport: view, pinchBy() {}, cancelGesture() {}, undo() {}, redo() {}, menu: (x, y) => menus.push([x, y]) });
  const a = ipadFinger(300, 400), b = ipadFinger(380, 400);
  view.fire('touchstart', [a], [a], 0);
  view.fire('touchstart', [a, b], [b], 60);
  t.mock.timers.tick(400);
  assert.equal(menus.length, 1);
  // No touchend arrives (it went to a part of the page that was redrawn). The next hold:
  view.fire('touchstart', [a], [a], 5000);
  view.fire('touchstart', [a, b], [b], 5050);
  t.mock.timers.tick(400);
  assert.equal(menus.length, 2, 'the second hold opens it too');
  // A palm beside a finger, or a hold right after the Pencil wrote, does not.
  view.fire('touchend', [], [a, b], 6000);
  const palm = ipadFinger(380, 420, 83.33);
  view.fire('touchstart', [a, palm], [a, palm], 7000);
  t.mock.timers.tick(400);
  assert.equal(menus.length, 2, 'a palm');
  assert.ok(view.has('gesturestart'), 'Safari\'s own pinch is turned off');
});

test('iPad: no hold right after the Pencil wrote', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = pages(), menus = [];
  touchGestures({ viewport: view, pinchBy() {}, cancelGesture() {}, undo() {}, redo() {}, menu: (x, y) => menus.push([x, y]), penBusy: () => true });
  const a = ipadFinger(300, 400), b = ipadFinger(380, 400);
  view.fire('touchstart', [a, b], [a, b], 0);
  t.mock.timers.tick(400);
  assert.deepEqual(menus, []);
});
