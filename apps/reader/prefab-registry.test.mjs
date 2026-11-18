import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cards, groups, moduleOf, renderSpec, nameOf, stamp, addModule, manifestProblem, listModules, editorOf } from './prefab-registry.js';
import { keepInside } from './prefabs/kit/window.js';

test('the shipped modules give the picker every prefab it had, in its groups', () => {
  const ids = cards().map((c) => c.id);
  for (const id of ['graph', 'table', 'histogram', 'bar', 'states', 'timeline', 'states-exercise', 'plot', 'tree', 'uml-class', 'uml-useCase', 'uml-full']) assert.ok(ids.includes(id), id);
  assert.deepEqual(groups().map(([g]) => g), ['basic', 'exam', 'diagram', 'maths']);
  assert.deepEqual(Object.fromEntries(cards().map((c) => [c.id, c.kind])), { ...Object.fromEntries(cards().map((c) => [c.id, c.kind])), graph: 'graph', table: 'table', histogram: 'prefab', tree: 'uml', 'uml-class': 'uml' });
  assert.deepEqual(listModules().map((m) => m.manifest.id), ['graph', 'table', 'charts', 'uml', 'numberline']);
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

test('the editor comes from the manifest; a type module edits in its base and draws with the type owner', () => {
  const ed = (spec) => { const { editor, module } = editorOf(spec); return [editor, module?.manifest.id]; };
  assert.deepEqual(ed({ type: 'states' }), ['chart-editor', 'charts']);
  assert.deepEqual(ed({ type: 'uml', diagram: 'class' }), ['uml-editor', 'uml']);
  addModule({ id: 'dots', api: 1, kind: 'custom', types: ['dots'], editor: 'editor.js', prefabs: [] });
  assert.deepEqual(ed({ type: 'dots' }), ['module', 'dots']);
  assert.deepEqual(ed({ module: 'graph' }), ['graph', 'graph']);
  assert.deepEqual(ed({ module: 'table' }), ['table', 'table']);
  assert.deepEqual(ed({ type: 'nothing' }), ['', undefined], 'no module: the host chooses by type, as before');
  // A type module: a chart type of its own cards, no render.js, edited in the chart editor.
  addModule({ id: 'gantt', api: 1, kind: 'type', base: 'chart-editor', types: [], names: {}, prefabs: [{ id: 'gantt', label: 'Gantt', spec: { type: 'timeline', tStart: 0, tEnd: 4, tStep: 1, rows: [{ label: 'A', intervals: [{ label: 'x', start: 0, end: 2 }] }] } }] });
  const card = cards().find((c) => c.id === 'gantt');
  assert.equal(card.module, 'gantt');
  const spec = { module: 'gantt', ...card.spec };
  assert.deepEqual(ed(spec), ['chart-editor', 'gantt']);
  assert.ok(renderSpec(spec).svg.startsWith('<svg'), 'drawn by the module that owns its type');
  assert.equal(nameOf(spec), 'CPU timeline', 'named by the type owner when it names nothing');
  // The kit's base names, and another module as the base.
  addModule({ id: 'tree2', api: 1, kind: 'type', base: 'diagram', types: [], prefabs: [] });
  assert.deepEqual(ed({ module: 'tree2', type: 'uml' }), ['uml-editor', 'tree2']);
  addModule({ id: 'raw', api: 1, kind: 'type', base: 'data', types: [], prefabs: [] });
  assert.deepEqual(ed({ module: 'raw', type: 'plot' }), ['data', 'raw']);
  addModule({ id: 'dots2', api: 1, kind: 'type', base: 'dots', types: [], prefabs: [] });
  assert.deepEqual(ed({ module: 'dots2', type: 'dots' }), ['module', 'dots'], 'a base that is a module: its editor.js');
  addModule({ id: 'loop', api: 1, kind: 'type', base: 'loop', types: [], prefabs: [] });
  assert.deepEqual(ed({ module: 'loop', type: 'x' }), ['', 'loop'], 'a base naming itself does not loop');
});

test('the kit window stays whole inside the window, no smaller than its minimum', () => {
  const area = { left: 8, top: 48, width: 1000, height: 700 };
  assert.deepEqual(keepInside({ left: 900, top: 10, width: 400, height: 300 }, area), { left: 608, top: 48, width: 400, height: 300 });
  assert.deepEqual(keepInside({ left: -50, top: 900, width: 2000, height: 300 }, area), { left: 8, top: 448, width: 1000, height: 300 });
  assert.deepEqual(keepInside({ left: 20, top: 60, width: 100, height: 50 }, area, { width: 300, height: 180 }), { left: 20, top: 60, width: 300, height: 180 });
});
