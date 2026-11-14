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

test('tab strip calls onCurrent when clicking the current tab or switching back to it', async () => {
  const nodes = new Map();
  const makeEl = () => {
    const classes = new Set();
    return {
      hidden: true, className: '', textContent: '', title: '', dataset: {}, children: [],
      classList: { toggle(c, on) { on ? classes.add(c) : classes.delete(c); } },
      setAttribute() {}, addEventListener() {}, scrollIntoView() {},
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      querySelector(sel) { return sel === '.tab.current' ? this.children.find(c => c.className?.includes('current')) : null; },
      contains() { return false; },
    };
  };
  globalThis.document = {
    body: makeEl(),
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeEl()); return nodes.get(id); },
    createElement: makeEl,
    addEventListener() {},
  };
  const { tabStrip } = await import('./tab-strip.js');
  let listHandler = null, activated = [], currentReturned = 0;
  const bridge = {
    list: async () => [{ id: 1, title: 'Lecture 1', dirty: false, current: true }, { id: 2, title: 'Lecture 2', dirty: false, current: false }],
    onList: fn => { listHandler = fn; },
    onCloseRequest() {},
    activate: id => activated.push(id),
    close() {}, open() {}, move() {}, detach() {}, update: async () => {},
  };
  tabStrip(bridge, { dirty: () => false, onCurrent: () => { currentReturned++; } });
  await new Promise(r => setTimeout(r, 0));
  const strip = nodes.get('tabStrip');
  assert.equal(strip.children.length, 3); // 2 tabs + '+' button
  // Clicking the already-current tab returns from Home to the open document.
  strip.children[0].onclick();
  assert.equal(currentReturned, 1);
  assert.deepEqual(activated, []);
  // Clicking the other tab activates it; when our tab becomes active again, onCurrent fires.
  strip.children[1].onclick();
  assert.deepEqual(activated, [2]);
  listHandler([{ id: 1, title: 'Lecture 1', dirty: false, current: true, active: false }, { id: 2, title: 'Lecture 2', dirty: false, current: false, active: true }]);
  assert.equal(currentReturned, 1);
  listHandler([{ id: 1, title: 'Lecture 1', dirty: false, current: true, active: true }, { id: 2, title: 'Lecture 2', dirty: false, current: false, active: false }]);
  assert.equal(currentReturned, 2);
});
