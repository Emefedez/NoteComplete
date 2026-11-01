import test from 'node:test';
import assert from 'node:assert/strict';
import { TabList } from './tab-host.js';

test('web tabs: open in front or behind, close to the neighbour, reorder, rename', () => {
  const tabs = new TabList();
  const welcome = tabs.add({ title: 'Welcome' });
  const home = tabs.add({ activate: false });
  assert.deepEqual(tabs.list().map((t) => [t.title, t.current]), [['Welcome', true], ['Home', false]]);
  tabs.update(home.id, { title: 'Apuntes', dirty: true });
  tabs.move(home.id, 0);
  assert.deepEqual(tabs.list().map((t) => t.title), ['Apuntes', 'Welcome']);
  // Closing the current tab makes the one in its place current.
  assert.equal(tabs.remove(welcome.id), true);
  assert.equal(tabs.current, home.id);
  assert.equal(tabs.list()[0].dirty, true);
  // The last one: the host opens a new Home.
  assert.equal(tabs.remove(home.id), false);
  assert.equal(tabs.current, null);
});
