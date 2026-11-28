import test from 'node:test';
import assert from 'node:assert/strict';
import { readMotion, saveMotion, MOTION_KEY, scaleLabel } from './motion.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('animations start on, off when the system asks for less motion', () => {
  assert.deepEqual(readMotion(memory()), { on: true, pop: 1, content: 1 });
  assert.equal(readMotion(memory(), true).on, false);
});
test('scales snap to the steps and are kept', () => {
  const s = memory();
  assert.deepEqual(saveMotion({ pop: 1.9, content: 0.3 }, s), { on: true, pop: 2, content: 0.25 });
  assert.deepEqual(readMotion(s), { on: true, pop: 2, content: 0.25 });
  saveMotion({ on: false }, s);
  assert.equal(JSON.parse(s.getItem(MOTION_KEY)).on, false);
  assert.equal(scaleLabel(1.5), '1.5×');
});
test('bad stored values fall back', () => {
  const s = memory(); s.setItem(MOTION_KEY, '{"on":"yes","pop":"x"}');
  assert.deepEqual(readMotion(s), { on: true, pop: 1, content: 1 });
});
