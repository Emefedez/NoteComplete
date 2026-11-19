import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { placeMenu, dockOffset } from './caret.js';

const vp = { width: 1000, height: 800 };
const size = { width: 300, height: 120 };

test('the menu goes under the caret line', () => {
  assert.deepEqual(placeMenu({ left: 100, top: 200, bottom: 220 }, size, vp), { left: 100, top: 224, above: false });
});

test('it flips above at the bottom edge and at the on-screen keyboard', () => {
  const r = placeMenu({ left: 100, top: 700, bottom: 720 }, size, vp);
  assert.equal(r.above, true);
  assert.equal(r.top, 700 - 4 - 120);
  // The keyboard leaves 500 px of a 800 px window: the visual viewport is shorter.
  const k = placeMenu({ left: 100, top: 420, bottom: 440 }, size, { width: 1000, height: 500 });
  assert.equal(k.above, true);
  assert.equal(k.top, 296);
  // A scrolled visual viewport (pinch zoom): its offset counts.
  const z = placeMenu({ left: 100, top: 420, bottom: 440 }, size, { width: 1000, height: 500, top: 100 });
  assert.equal(z.above, false);
});

test('the math keypad counts as the bottom', () => {
  const r = placeMenu({ left: 100, top: 500, bottom: 520 }, size, vp, 600);
  assert.equal(r.above, true);
  assert.equal(r.top, 376);
});

test('it is clamped to the sides', () => {
  assert.equal(placeMenu({ left: 900, top: 10, bottom: 30 }, size, vp).left, 1000 - 8 - 300);
  assert.equal(placeMenu({ left: -50, top: 10, bottom: 30 }, size, vp).left, 8);
});

test('no room either way: the larger side, inside the window', () => {
  const r = placeMenu({ left: 10, top: 60, bottom: 80 }, { width: 100, height: 700 }, vp);
  assert.ok(r.top >= 8 && r.top + 700 <= 800);
});

test('dock offset above the keyboard', () => {
  assert.equal(dockOffset(844, { height: 500, top: 0 }), 344);
  assert.equal(dockOffset(844, { height: 844, top: 0 }), 0);
});
