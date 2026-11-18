import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cards, groups, moduleOf, renderSpec, nameOf, stamp, addModule, manifestProblem, listModules } from './prefab-registry.js';

test('the shipped modules give the picker every prefab it had, in its groups', () => {
  const ids = cards().map((c) => c.id);
  for (const id of ['graph', 'table', 'histogram', 'bar', 'states', 'timeline', 'states-exercise', 'plot', 'tree', 'uml-class', 'uml-useCase', 'uml-full']) assert.ok(ids.includes(id), id);
  assert.deepEqual(groups().map(([g]) => g), ['basic', 'exam', 'diagram']);
  assert.deepEqual(Object.fromEntries(cards().map((c) => [c.id, c.kind])), { ...Object.fromEntries(cards().map((c) => [c.id, c.kind])), graph: 'graph', table: 'table', histogram: 'prefab', tree: 'uml', 'uml-class': 'uml' });
  assert.deepEqual(listModules().map((m) => m.manifest.id), ['graph', 'table', 'charts', 'uml']);
});

test('specs find their module by name or by type; old notes name none', () => {
  assert.equal(moduleOf({ type: 'states' }).manifest.id, 'charts');
  assert.equal(moduleOf({ type: 'uml', diagram: 'class' }).manifest.id, 'uml');
  assert.equal(moduleOf({ module: 'charts', type: 'plot' }).manifest.id, 'charts');
  assert.equal(moduleOf({ type: 'nothing' }), null);
  assert.deepEqual(stamp({ type: 'plot' }), { module: 'charts', type: 'plot' });
  assert.equal(nameOf({ type: 'histogram', contiguous: false, bins: [{ label: 'a', value: 1 }] }), 'Bar chart');
  assert.equal(nameOf({ module: 'gone', type: 'x' }), 'Prefab');
  assert.ok(renderSpec(cards().find((c) => c.id === 'plot').spec).svg.startsWith('<svg'));
  assert.equal(renderSpec({ module: 'gone' }), null, 'a missing module draws nothing (the picture stays on the page)');
});

test('added modules are checked, join the cards, and replace a shipped one by id', () => {
  assert.match(manifestProblem({ id: 'X', api: 1, kind: 'type', prefabs: [] }), /lower-case/);
  assert.match(manifestProblem({ id: 'x', api: 2, kind: 'type', prefabs: [] }), /api 2/);
  assert.throws(() => addModule({ id: 'bad', api: 1, kind: 'other', prefabs: [] }), /kind/);
  addModule({ id: 'numberline', api: 1, kind: 'custom', types: ['numberline'], prefabs: [{ id: 'numberline', group: 'maths', label: 'Number line', hint: 'h', icon: 'graph', spec: { type: 'numberline' } }], groups: { maths: 'Maths' } }, { render: () => ({ svg: '<svg/>', width: 10, height: 10 }), name: () => 'Number line' });
  assert.ok(cards().some((c) => c.id === 'numberline' && c.kind === 'prefab' && c.module === 'numberline'));
  assert.deepEqual(groups().at(-1), ['maths', 'Maths']);
  assert.equal(nameOf({ type: 'numberline' }), 'Number line');
});

test('prefabs/index.js is generated from the module folders and up to date', () => {
  const script = fileURLToPath(new URL('../../tools/prefab_index.mjs', import.meta.url));
  execFileSync(process.execPath, [script, '--check']);
});
