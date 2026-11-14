import test from 'node:test';
import assert from 'node:assert/strict';
import { NavHistory, mouseNavDirection, keyNavDirection, sameStop } from './nav-history.js';

test('tracks page jumps and Home transitions with back and forward stacks', () => {
  const nav = new NavHistory();
  const p0 = { view: 'doc', key: 'n1', page: 0, scrollTop: 10 };
  const p5 = { view: 'doc', key: 'n1', page: 5, scrollTop: 400 };
  const home = { view: 'home', folderId: null };

  nav.record(p0, p5);
  assert.equal(nav.canBack, true);
  assert.equal(nav.canForward, false);

  nav.record(p5, home);
  assert.deepEqual(nav.back(home), p5);
  assert.equal(nav.canForward, true);
  assert.deepEqual(nav.back(p5), p0);
  assert.equal(nav.canBack, false);

  assert.deepEqual(nav.forward(p0), p5);
  assert.deepEqual(nav.forward(p5), home);
  assert.equal(nav.canForward, false);
});

test('ignores duplicate stops and clears forward stack on new navigation', () => {
  const nav = new NavHistory();
  const p0 = { view: 'doc', key: 'n1', page: 0 };
  const p1 = { view: 'doc', key: 'n1', page: 1 };
  const p2 = { view: 'doc', key: 'n1', page: 2 };

  nav.record(p0, p0);
  assert.equal(nav.canBack, false);
  nav.record(p0, p1);
  assert.deepEqual(nav.back(p1), p0);
  assert.equal(nav.canForward, true);

  nav.record(p0, p2);
  assert.equal(nav.canForward, false);
  assert.deepEqual(nav.back(p2), p0);
  assert.equal(sameStop(p0, { view: 'doc', key: 'n1', page: 0 }), true);
});

test('recognizes mouse back/forward buttons and keyboard navigation keys', () => {
  assert.equal(mouseNavDirection({ button: 3 }), -1);
  assert.equal(mouseNavDirection({ button: 4 }), 1);
  assert.equal(mouseNavDirection({ button: 0 }), 0);
  assert.equal(keyNavDirection({ key: 'BrowserBack' }), -1);
  assert.equal(keyNavDirection({ key: 'BrowserForward' }), 1);
  assert.equal(keyNavDirection({ key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }), -1);
  assert.equal(keyNavDirection({ key: 'ArrowRight', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }), 1);
  assert.equal(keyNavDirection({ key: 'ArrowLeft', altKey: false }), 0);
});
