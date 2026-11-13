// Browser check of the new-page button (Chromium, after a web build): below the last page,
// it adds a blank page the size of the last one, one Undo takes it away again (the view
// moves to the last page left), and an infinite canvas has none.
//   node tools/add_page_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Examen wuolah.noteful'));
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
