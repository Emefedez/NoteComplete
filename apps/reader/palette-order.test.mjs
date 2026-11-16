import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedIds, saveOrder, keyFor, indexOfKey } from './palette-order.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('the order kept is used, and new entries come after their neighbour', () => {
  const s = memory();
  assert.deepEqual(orderedIds('x', ['a', 'b', 'c'], s), ['a', 'b', 'c']);
  saveOrder('x', ['c', 'a', 'b'], s);
  assert.deepEqual(orderedIds('x', ['a', 'b', 'c'], s), ['c', 'a', 'b']);
  assert.deepEqual(orderedIds('x', ['a', 'n', 'b', 'c'], s), ['c', 'a', 'n', 'b'], 'n follows a');
  assert.deepEqual(orderedIds('x', ['z', 'a'], s), ['z', 'a'], 'gone ones are dropped, a new first one leads');
});

test('number keys: 1–9 then 0', () => {
  assert.deepEqual([0, 1, 8, 9, 10].map(keyFor), ['1', '2', '9', '0', '']);
  assert.deepEqual(['1', '9', '0', 'a', '-'].map(indexOfKey), [0, 8, 9, -1, -1]);
});
