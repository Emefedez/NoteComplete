import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerTaps } from './editor-touch.js';

test('a quick, still tap of two fingers undoes and of three redoes; moving or lingering does not', () => {
  const t = fingerTaps();
  t.down(1, 100, 100, 0); t.down(2, 160, 100, 20);
  assert.equal(t.up(1, 120), null, 'one finger still down');
  assert.equal(t.up(2, 140), 'undo');
  t.down(1, 100, 100, 0); t.down(2, 160, 100, 10); t.down(3, 220, 100, 20);
  t.up(1, 150); t.up(2, 160);
  assert.equal(t.up(3, 170), 'redo');
  t.down(1, 100, 100, 0); t.down(2, 160, 100, 10); t.move(2, 190, 100);
  t.up(1, 100);
  assert.equal(t.up(2, 110), null, 'a pinch is not a tap');
  t.down(1, 100, 100, 0); t.down(2, 160, 100, 10);
  t.up(1, 500);
  assert.equal(t.up(2, 520), null, 'too slow');
  t.down(1, 100, 100, 0);
  assert.equal(t.up(1, 50), null, 'one finger');
});

test('two fingers held still give their centre once, for the quick menu', () => {
  const t = fingerTaps();
  t.down(1, 100, 100, 0); t.down(2, 200, 140, 10);
  assert.equal(t.hold(200), null, 'not yet');
  assert.deepEqual(t.hold(500), [150, 120]);
  assert.equal(t.hold(700), null, 'once');
  t.up(1, 800);
  assert.equal(t.up(2, 810), null, 'a hold is not a tap');
});
