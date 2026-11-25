import test from 'node:test';
import assert from 'node:assert/strict';
import { prefabPacks, shellWithoutPacks, staticImports } from '../../tools/prefab_packs.mjs';
import { packs, packById, packOf, packInstalled, cards, moduleById } from './prefab-registry.js';
import { formatSize, packList, isInstalled, missingPackFor } from './prefab-packs.js';

test('prefab_packs: core stays in shell, non-core lazy files leave shell', () => {
  const { packs: built, lazy } = prefabPacks();
  assert.equal(built.core.core, true);
  assert.ok(built.core.bytes > 0);
  assert.ok(built.algorithms.bytes > 0);
  assert.ok(built.chinese.bytes > 0);
  // Core pack files are never lazy.
  for (const file of Object.keys(built.core.files)) {
    assert.ok(!lazy.includes(file), `core file ${file} must stay in shell`);
  }
  // Non-core pack editors/modules not imported by the app shell are lazy.
  assert.ok(lazy.includes('prefabs/algorithms/render.js'));
  assert.ok(lazy.includes('prefabs/hanzi/render.js'));
  assert.ok(lazy.includes('prefabs/textual-analysis/editor.js'));
  // shellWithoutPacks drops lazy files and keeps everything else.
  const shell = ['index.html', 'app.js', 'prefabs/stickynote/render.js', 'prefabs/algorithms/render.js', 'prefabs/hanzi/render.js'];
  assert.deepEqual(shellWithoutPacks(shell, lazy), ['index.html', 'app.js', 'prefabs/stickynote/render.js']);
});

test('staticImports finds static import and export-from statements only', () => {
  const src = `
    import { a } from './a.js';
    export * from './b.js';
    import './side.js';
    const lazy = () => import('./lazy.js');
  `;
  assert.deepEqual(staticImports(src), ['./a.js', './b.js', './side.js']);
});

test('registry exposes packs in order with dependencies and cards', () => {
  const list = packs();
  assert.equal(list[0].id, 'core');
  assert.equal(list[0].core, true);
  assert.ok(list.some((p) => p.id === 'charts'));
  assert.ok(list.some((p) => p.id === 'diagrams'));
  assert.deepEqual(packById('textual-analysis').requires, ['diagrams']);
  assert.equal(packOf(moduleById('graph')).id, 'core');
  assert.equal(packOf(moduleById('uml')).id, 'diagrams');
  // In Node (no browser storage), all shipped packs count as installed.
  assert.equal(packInstalled('charts'), true);
  assert.equal(isInstalled('algorithms'), true);
  assert.equal(missingPackFor({ type: 'histogram' }), null);
  assert.equal(packList().every((p) => p.installed), true);
  assert.ok(cards({ all: true }).length >= cards().length);
  assert.equal(formatSize(0), '');
  assert.equal(formatSize(512), '1 KB');
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(1.5 * 1024 * 1024), '1.5 MB');
});
