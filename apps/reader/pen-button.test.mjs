import test from 'node:test';
import assert from 'node:assert/strict';
import { penButtonDetector, profileFrom, describeProfile, loadPenProfile, browserTag, PROFILE_KEY } from './pen-button.js';

const pen = (type, buttons, time, button = type === 'pointermove' ? -1 : 0) => ({ type, pointerType: 'pen', buttons, button, time });

test('S Pen on Android: pressing the button while hovering reports buttons 1 on a hover move', () => {
  const d = penButtonDetector();
  assert.equal(d.pointer(pen('pointermove', 0, 0)), null);
  assert.equal(d.pointer(pen('pointermove', 1, 16)), 'menu');
  assert.equal(d.pointer(pen('pointermove', 1, 32)), null, 'only on the press, not while held');
  assert.equal(d.pointer(pen('pointermove', 0, 48)), null);
  assert.equal(d.pointer(pen('pointermove', 3, 64)), 'menu', 'Samsung’s combined state (34 → 3)');
});

test('a stroke (buttons 1 while touching) is never the button', () => {
  const d = penButtonDetector();
  assert.equal(d.pointer(pen('pointerdown', 1, 0)), null);
  for (let t = 16; t < 200; t += 16) assert.equal(d.pointer(pen('pointermove', 1, t)), null);
  assert.equal(d.pointer(pen('pointerup', 0, 200)), null);
  assert.equal(d.pointer(pen('pointermove', 0, 220)), null);
});

test('a lost pen lift does not hide the next hover press', () => {
  const d = penButtonDetector();
  d.pointer(pen('pointerdown', 1, 0));
  assert.equal(d.pointer(pen('pointermove', 0, 100)), null, 'hovering again: contact over');
  assert.equal(d.pointer(pen('pointermove', 1, 120)), 'menu');
});

test('button held then a tap: Chromium sends only a contextmenu with no pointer type', () => {
  const d = penButtonDetector();
  d.pointer(pen('pointermove', 0, 1000));
  assert.equal(d.contextmenu({ pointerType: '', time: 1400, android: true, last: 'pen' }), 'menu');
  assert.equal(d.contextmenu({ pointerType: '', time: 60000, android: true, last: 'touch' }), 'menu', 'on Android, any time once a pen was used');
  assert.equal(d.contextmenu({ pointerType: '', time: 1400, android: true, last: 'mouse' }), null, 'a mouse right-click');
  assert.equal(d.contextmenu({ pointerType: '', time: 4000, android: false, last: 'pen' }), null, 'elsewhere only right after the pen');
  assert.equal(d.contextmenu({ pointerType: 'touch', time: 1100, android: true }), null);
});

test('desktop pens: barrel or eraser as the pen touches', () => {
  const d = penButtonDetector();
  assert.equal(d.pointer({ type: 'pointerdown', pointerType: 'pen', button: 2, buttons: 2, time: 0 }), 'menu');
  d.pointer(pen('pointerup', 0, 10));
  assert.equal(d.pointer({ type: 'pointerdown', pointerType: 'pen', button: 5, buttons: 32, time: 20 }), 'menu');
  assert.equal(d.pointer({ type: 'pointermove', pointerType: 'mouse', buttons: 2, button: -1, time: 30 }), null, 'a mouse is not a pen');
});

test('turned off, nothing from the pen opens the menu; reset counts the next press', () => {
  let profile = { off: true };
  const d = penButtonDetector(() => profile);
  d.pointer(pen('pointermove', 0, 0));
  assert.equal(d.pointer(pen('pointermove', 1, 10)), null);
  assert.equal(d.contextmenu({ pointerType: '', time: 20, android: true }), null);
  profile = null;
  d.pointer(pen('pointermove', 1, 30));
  assert.equal(d.pointer(pen('pointermove', 1, 40)), null);
  d.reset();
  assert.equal(d.pointer(pen('pointermove', 1, 50)), 'menu', 'after the menu closed');
});

test('calibration keeps the bits the button set while hovering, and says so', () => {
  const p = profileFrom({
    hover: [{ phase: 'baseline', buttons: 0 }, { phase: 'press', buttons: 0 }, { phase: 'press', buttons: 1 }],
    taps: [{ pointerType: '' }],
    keys: [{ key: 'Shift', code: 'ShiftLeft' }],
  }, 'Mozilla/5.0 (Linux; Android 14) Chrome/142.0 Mobile');
  assert.equal(p.hoverMask, 1);
  assert.equal(p.tapContextmenu, '');
  assert.equal(p.key, null, 'modifier keys are not the button');
  assert.match(describeProfile(p), /hovers \(reported as buttons 1\) and when you tap/);
  assert.match(describeProfile(profileFrom({ hover: [{ phase: 'baseline', buttons: 0 }] })), /Air command/);
  assert.match(describeProfile(profileFrom({})), /does not report the pen hovering/);
});

test('a calibrated hover mask only counts those bits', () => {
  const d = penButtonDetector(() => ({ hoverMask: 2 }));
  d.pointer(pen('pointermove', 0, 0));
  assert.equal(d.pointer(pen('pointermove', 1, 10)), null);
  assert.equal(d.pointer(pen('pointermove', 3, 20)), 'menu');
});

test('a saved profile applies only to the browser version it was made in', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/142.0 Mobile';
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null };
  assert.equal(loadPenProfile(storage, ua), null);
  store.set(PROFILE_KEY, JSON.stringify({ v: 1, ua: browserTag(ua), hoverMask: 1, longPress: true }));
  assert.equal(loadPenProfile(storage, ua).hoverMask, 1);
  const other = loadPenProfile(storage, ua.replace('142', '150'));
  assert.equal(other.hoverMask, undefined);
  assert.equal(other.longPress, true, 'choices (off, long-press) carry over');
});

test('Brave: the button shows only when the pen comes back into hover range with it held', () => {
  const d = penButtonDetector();
  d.pointer(pen('pointermove', 0, 0));
  // The press itself is dropped while hovering: nothing changes until the pen leaves...
  assert.equal(d.pointer(pen('pointermove', 0, 20)), null);
  d.pointer({ type: 'pointerleave', pointerType: 'pen', buttons: 0, button: -1, time: 40 });
  // ...and comes back with the button held.
  assert.equal(d.pointer(pen('pointerover', 1, 60)), 'menu');
  assert.equal(d.pointer(pen('pointermove', 1, 80)), null, 'once per entry');
  d.pointer({ type: 'pointerleave', pointerType: 'pen', buttons: 1, button: -1, time: 100 });
  assert.equal(d.pointer(pen('pointerover', 0, 120)), null, 'entering without the button: nothing');
  d.pointer({ type: 'pointerleave', pointerType: 'pen', buttons: 0, button: -1, time: 140 });
  assert.equal(d.pointer(pen('pointermove', 1, 160)), 'menu', 'held again on the next entry');
});

test('a pen touching down without hovering first is the tip, not the button', () => {
  const d = penButtonDetector();
  assert.equal(d.pointer({ type: 'pointerover', pointerType: 'pen', buttons: 1, button: 0, pressure: 0.3, time: 0 }), null);
  assert.equal(d.pointer({ type: 'pointerdown', pointerType: 'pen', buttons: 1, button: 0, pressure: 0.3, time: 1 }), null);
  assert.equal(d.pointer({ type: 'pointermove', pointerType: 'pen', buttons: 1, button: -1, pressure: 0.4, time: 20 }), null);
});
