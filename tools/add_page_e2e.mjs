// Browser check of the new-page button (Chromium, after a web build): below the last page,
// it adds a blank page the size of the last one, one Undo takes it away again (the view
// moves to the last page left), and an infinite canvas has none.
//   node tools/add_page_e2e.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null, port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
await p.goto(server.origin + '/'); await p.waitForFunction(() => !document.getElementById('open').disabled);
await p.setInputFiles('#file', fileURLToPath(new URL('../samples/Examen wuolah.noteful', import.meta.url)));
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 3);
await p.evaluate(() => { const v = document.getElementById('viewport'); v.scrollTop = v.scrollHeight; });
await p.waitForTimeout(400);
assert.equal(await p.isVisible('.add-page-end'), true);
await p.click('.add-page-end');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 4);
const sizes = await p.evaluate(() => [...document.querySelectorAll('.sheet')].map(s => s.style.aspectRatio));
assert.equal(sizes[3], sizes[2]);
console.log('· a page the size of the last one was added');
await p.evaluate(() => document.getElementById('undo').click());
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 3);
assert.equal(await p.locator('.add-page-end').count(), 1);
console.log('· one Undo takes it away');
// A canvas has none.
await p.evaluate(() => document.getElementById('newDocument').click());
await p.check('[name="newKind"][value="canvas"]'); await p.click('#newCreate');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 1);
assert.equal(await p.isVisible('.add-page-end'), false);
assert.deepEqual(errors, []);
console.log('· an infinite canvas has none');
await b.close(); await server.stop();
console.log('New page end to end: passed.');
