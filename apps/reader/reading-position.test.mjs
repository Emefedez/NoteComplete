import test from 'node:test';
import assert from 'node:assert/strict';
import { readPosition, savePosition } from './reading-position.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

test('savePosition and readPosition round-trip note and text positions', () => {
  const s = memStorage();
  assert.equal(readPosition('k1', s), null);
  assert.equal(savePosition('k1', { page: 4, scrollTop: 1234.6 }, s), true);
  const p1 = readPosition('k1', s);
  assert.equal(p1.page, 4);
  assert.equal(p1.scrollTop, 1235);

  assert.equal(savePosition('k2', { textScroll: 880.2 }, s), true);
  assert.equal(readPosition('k2', s).textScroll, 880);
});

test('savePosition prunes oldest entries past 200', () => {
  const s = memStorage();
  for (let i = 0; i < 210; i++) savePosition(`doc-${i}`, { page: i }, s);
  const stored = JSON.parse(s.getItem('notecomplete-reading-positions'));
  assert.equal(Object.keys(stored).length, 200);
});
