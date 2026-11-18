// Browser check of the folder of prefab modules (Chromium, after a web build): a stand-in for
// the desktop bridge lists a folder whose number line module is a changed copy, served at
// prefabs-user/ as the desktop serves it (kit/ from the app). It replaces the app's own: its
// card is in Insert prefab, its editor (importing the kit from prefabs-user/kit) opens, and
// Prefab modules… lists it as from the folder.
//   node tools/prefab_folder_e2e.mjs
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const reader = fileURLToPath(new URL('../apps/reader/', import.meta.url));
const folder = await mkdtemp(path.join(tmpdir(), 'nc-modules-'));
await cp(path.join(reader, 'prefabs/numberline'), path.join(folder, 'numberline'), { recursive: true });
const manifestFile = path.join(folder, 'numberline/module.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
manifest.version = '2.0.0';
manifest.prefabs[0].label = 'My number line';
await writeFile(manifestFile, JSON.stringify(manifest));

const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.route('**/prefabs-user/**', async (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname).split('/prefabs-user/')[1];
  const file = rel.startsWith('kit/') ? path.join(reader, 'prefabs', rel) : path.join(folder, rel);
  try { await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/javascript' }); }
  catch { await route.fulfill({ status: 404, body: '' }); }
});
await p.addInitScript((listed) => {
  window.notecompletePrefabs = { list: async () => listed, copyTo: async () => null, use: async () => null, reset: async () => null, open: async () => true };
}, { folder, shipped: [{ folder: 'numberline', manifest: { id: 'numberline', version: '1.0.0' }, render: true }], modules: [{ folder: 'numberline', manifest, render: true }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
await p.locator('.sheet[data-page="0"] .render').waitFor();
await sleep(400);
await p.evaluate(() => document.getElementById('insertGraph').click());
await p.locator('.prefab-grid').waitFor();
assert.equal(await p.locator('.prefab-card:has(strong:text-is("Number line"))').count(), 0, 'the folder’s copy replaces the app’s');
await p.click('.prefab-card:has(strong:text-is("My number line"))');
await p.locator('.pk-dialog .pk-canvas svg').waitFor();
assert.ok(await p.evaluate(() => performance.getEntriesByType('resource').some((r) => r.name.includes('/prefabs-user/numberline/editor.js'))), 'its editor came from the folder');
console.log('· a module in the folder replaces the app’s: its card, its editor (kit from prefabs-user/kit)');
await p.keyboard.press('Escape');
await p.locator('.pk-dialog').waitFor({ state: 'detached' });
await p.evaluate(() => document.getElementById('insertGraph').click());
await p.locator('.prefab-grid').waitFor();
await p.click('.prefab-modules-open');
await p.locator('.prefab-modules-dialog').waitFor();
const row = await p.locator('.prefab-module-row:has(b:text-is("Number line")) small').textContent();
assert.match(row, /folder · 2\.0\.0 · the app has 1\.0\.0/);
assert.ok(await p.locator('.prefab-modules-dialog button:has-text("Reload modules")').count());
console.log('· Prefab modules… lists it from the folder, with the app’s newer or older version');
assert.deepEqual(errors, []);
console.log('Prefab modules folder: OK');
await b.close();
process.exit(0);
