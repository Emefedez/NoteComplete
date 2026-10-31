import test from 'node:test';
import assert from 'node:assert/strict';
import { tabStore } from './tabs.js';

test('tabs open next to the active one, close to a neighbour and reorder', () => {
  const s = tabStore();
  s.add(1, 'a'); s.add(1, 'b'); s.activate('a'); s.add(1, 'c');
  assert.deepEqual(s.list(1).map(t => t.id), ['a', 'c', 'b']);
  assert.equal(s.active(1), 'c');
  s.update('c', { title: '  Memoria 1 ', dirty: true });
  assert.deepEqual(s.list(1)[1], { id: 'c', title: 'Memoria 1', dirty: true, active: true });
  assert.equal(s.neighbour(1, 1), 'b');
  assert.equal(s.neighbour(1, -2), 'b');
  s.move('b', 0);
  assert.deepEqual(s.list(1).map(t => t.id), ['b', 'a', 'c']);
  assert.deepEqual(s.remove('c'), { window: 1, active: 'a', left: 2 });
  s.activate('b');
  assert.deepEqual(s.remove('b'), { window: 1, active: 'a', left: 1 });
  assert.deepEqual(s.remove('a'), { window: 1, active: null, left: 0 });
  assert.deepEqual(s.list(1), []);
  assert.equal(s.remove('a'), null);
});

test('windows keep their own tabs', () => {
  const s = tabStore();
  s.add(1, 'a'); s.add(2, 'b'); s.add(2, 'c', { activate: false });
  assert.equal(s.windowOf('c'), 2);
  assert.equal(s.active(2), 'b');
  assert.deepEqual(s.all().map(t => [t.window, t.id]), [[1, 'a'], [2, 'b'], [2, 'c']]);
  assert.equal(s.move('a', 'x'), false);
});

test('a tab moved to another window keeps its title and becomes active there', () => {
  const s = tabStore();
  s.add(1, 'a'); s.add(1, 'b');
  s.update('b', { title: 'Memoria 1', dirty: true });
  assert.deepEqual(s.transfer('b', 2), { window: 1, active: 'a', left: 1 });
  assert.deepEqual(s.list(2), [{ id: 'b', title: 'Memoria 1', dirty: true, active: true }]);
  assert.deepEqual(s.list(1).map(t => t.id), ['a']);
  assert.equal(s.windowOf('b'), 2);
  assert.equal(s.transfer('b', 2), null);
  assert.equal(s.transfer('x', 3), null);
});
