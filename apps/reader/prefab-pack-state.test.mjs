import test from 'node:test';
import assert from 'node:assert/strict';
import { PACKS_KEY, readPackState, writePackState, packOn, withPack, withCard, treeState, toggleNode, selectionFrom, planFrom } from './prefab-pack-state.js';

const memory = (init = {}) => {
  const map = new Map(Object.entries(init));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
};
const PACKS = [
  { id: 'core', core: true, cards: ['graph', 'table'] },
  { id: 'charts', cards: ['histogram', 'bar'] },
  { id: 'diagrams', cards: ['uml-class', 'tree'] },
  { id: 'textual', requires: ['diagrams'], cards: ['textual'] },
  { id: 'bare' },
];

test('no saved state: everything is installed (existing users lose nothing, new ones start from Everything)', () => {
  const s = readPackState(memory());
  assert.deepEqual(s, { v: 1, all: true, packs: {}, off: [], hideMissing: false });
  for (const p of PACKS) assert.equal(packOn(s, p), true, p.id);
  // Broken or unreadable storage: the same defaults.
  assert.equal(readPackState(memory({ [PACKS_KEY]: '{nope' })).all, true);
  assert.equal(readPackState({ getItem: () => { throw Error('denied'); } }).all, true);
  assert.equal(readPackState(null).all, true);
});

test('packs installed and removed one by one; the core pack always stays', () => {
  const store = memory();
  let s = withPack(readPackState(store), 'charts', false);
  assert.equal(packOn(s, PACKS[1]), false);
  assert.equal(packOn(s, PACKS[2]), true, 'the others follow `all`');
  s = withPack(s, 'core', false);
  assert.equal(packOn(s, PACKS[0]), true, 'core is never removed');
  s = { ...s, all: false };
  assert.equal(packOn(s, PACKS[2]), false, 'chosen one by one: unknown packs are not installed');
  s = withCard(s, 'histogram', false);
  assert.deepEqual(s.off, ['histogram']);
  s = withPack(s, 'charts', true, ['histogram', 'bar']);
  assert.deepEqual(s.off, [], 'installing a pack turns its prefabs on again');
  writePackState(s, store);
  assert.deepEqual(readPackState(store), { ...s, hideMissing: false });
  assert.doesNotThrow(() => writePackState(s, { setItem: () => { throw Error('full'); } }));
});

test('the tree is tri-state: Everything, packs and prefabs', () => {
  const sel = new Set(['graph', 'table', 'histogram', 'uml-class', 'tree', 'textual', 'bare']);
  const t = treeState(PACKS, sel);
  assert.equal(t.all, 'some');
  assert.deepEqual(t.packs, { core: 'on', charts: 'some', diagrams: 'on', textual: 'on', bare: 'on' });
  assert.equal(treeState(PACKS, new Set()).all, 'off');
  const every = toggleNode(PACKS, new Set(), 'all', true);
  assert.equal(treeState(PACKS, every).all, 'on');
  assert.equal(treeState(PACKS, toggleNode(PACKS, every, 'all', false)).all, 'off');
  // A pack ticks or clears all its prefabs; a prefab only itself.
  const noCharts = toggleNode(PACKS, every, 'charts', false);
  assert.equal(treeState(PACKS, noCharts).packs.charts, 'off');
  assert.equal(treeState(PACKS, toggleNode(PACKS, noCharts, 'bar', true)).packs.charts, 'some');
});

test('a pack another one needs comes along, and clearing it clears what needs it', () => {
  // Ticking Textual analysis ticks Diagrams.
  let sel = toggleNode(PACKS, new Set(), 'textual', true);
  assert.deepEqual(treeState(PACKS, sel).packs, { core: 'off', charts: 'off', diagrams: 'on', textual: 'on', bare: 'off' });
  // One diagram prefab off: Textual stays (the pack is still installed).
  sel = toggleNode(PACKS, sel, 'tree', false);
  assert.equal(treeState(PACKS, sel).packs.textual, 'on');
  // The last one off, or the whole pack: Textual goes too.
  assert.equal(treeState(PACKS, toggleNode(PACKS, sel, 'uml-class', false)).packs.textual, 'off');
  assert.equal(treeState(PACKS, toggleNode(PACKS, sel, 'diagrams', false)).packs.textual, 'off');
});

test('Finish: what to install and remove, and the prefabs left off', () => {
  const now = withPack(readPackState(memory()), 'bare', false);
  const sel = selectionFrom(PACKS, now);
  assert.equal(sel.has('bare'), false);
  assert.equal(sel.has('histogram'), true);
  // Nothing changed: nothing to do.
  assert.deepEqual(planFrom(PACKS, sel, now).install, []);
  assert.deepEqual(planFrom(PACKS, sel, now).remove, []);
  // Charts down to one prefab, Diagrams off (so Textual too), the bare pack on.
  let next = toggleNode(PACKS, sel, 'bar', false);
  next = toggleNode(PACKS, next, 'diagrams', false);
  next = toggleNode(PACKS, next, 'bare', true);
  const plan = planFrom(PACKS, next, now);
  assert.deepEqual(plan.install, ['bare']);
  assert.deepEqual(plan.remove, ['diagrams', 'textual']);
  assert.deepEqual(plan.state.off, ['bar']);
  assert.equal(plan.state.all, false);
  assert.deepEqual(plan.state.packs, { charts: true, diagrams: false, textual: false, bare: true });
  // The core pack is never removed, even with all its prefabs off.
  const noCore = planFrom(PACKS, toggleNode(PACKS, next, 'core', false), now);
  assert.ok(!noCore.remove.includes('core'));
  assert.deepEqual(noCore.state.off.slice(0, 2), ['graph', 'table']);
  // Everything ticked: `all`, so packs added in a later version come installed.
  assert.equal(planFrom(PACKS, toggleNode(PACKS, next, 'all', true), now).state.all, true);
});
