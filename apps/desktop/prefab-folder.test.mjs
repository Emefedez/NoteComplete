import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prefabFolder, userPrefabPath } from './prefab-folder.js';

async function shippedTree() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-prefabs-'));
  for (const [file, text] of [['index.js', '//'], ['kit/shell.js', '//'], ['charts/module.json', '{"id":"charts","version":"1.0.0"}'], ['charts/render.js', '//'], ['_template/module.json', '{"id":"x"}']]) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text);
  }
  return dir;
}

test('the app\'s modules copy to a folder that becomes the default; kit and index stay the app\'s', async () => {
  const shipped = await shippedTree();
  const home = await mkdtemp(path.join(tmpdir(), 'nc-home-'));
  const f = prefabFolder({ settingsFile: path.join(home, 'settings.json'), shipped });
  assert.equal(await f.folder(), null, 'the app\'s own at first');
  const target = path.join(home, 'mods');
  await mkdir(target);
  assert.equal(await f.copyTo(target), target, 'an empty folder takes the modules');
  assert.deepEqual((await readdir(target)).sort(), ['_template', 'charts']);
  assert.equal(await f.folder(), target);
  // Copying again keeps what was changed there.
  await writeFile(path.join(target, 'charts/render.js'), '// mine');
  const again = await f.copyTo(target);
  assert.equal(again, path.join(target, 'prefabs'), 'a folder with files gets its own prefabs folder');
  assert.equal(await readFile(path.join(target, 'charts/render.js'), 'utf8'), '// mine');
  await f.use(target);
  const listed = await f.list();
  assert.deepEqual(listed.modules.map((m) => [m.folder, m.manifest.id, m.render]), [['charts', 'charts', true]]);
  assert.deepEqual(listed.shipped.map((m) => m.manifest.version), ['1.0.0']);
  await f.use(null);
  assert.equal(await f.folder(), null);
});

test('addresses under prefabs-user/ map to the folder, kit/ to the app, never outside', () => {
  const opts = { folder: '/home/u/mods', shipped: '/app/reader/prefabs' };
  assert.equal(userPrefabPath('prefabs-user/numberline/render.js', opts), path.resolve('/home/u/mods/numberline/render.js'));
  assert.equal(userPrefabPath('prefabs-user/kit/index.js', opts), path.resolve('/app/reader/prefabs/kit/index.js'));
  assert.equal(userPrefabPath('prefabs-user/../secret', opts), null);
  assert.equal(userPrefabPath('prefabs-user/.git/config', opts), null);
  assert.equal(userPrefabPath('prefabs-user/numberline/render.js', { ...opts, folder: null }), null);
  assert.equal(userPrefabPath('other.js', opts), null);
});
