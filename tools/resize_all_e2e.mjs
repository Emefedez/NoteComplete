// Browser check of Pages → Page size → Resize all pages (Chromium, after a web build): every
// page takes the chosen size (space added follows each page's own size), and one Undo
// brings them all back.
//   node tools/resize_all_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Examen wuolah.noteful'));
await p.waitForSelector('.sheet[data-page="0"] .render svg');
// Page proportions (width / height), as the sheets show them.
const ratios = () => p.evaluate(() => [...document.querySelectorAll('.sheet')].map(s => { const r = s.getBoundingClientRect(); return +(r.width / r.height).toFixed(3); }));
const before = await ratios();
const choose = async (preset) => {
  await p.evaluate(() => document.getElementById('resizePage').click());
  await p.waitForSelector('#resizeDialog[open]');
  await p.selectOption('#resizePreset', preset);
};
// A4 landscape for every page.
await choose('a4l');
assert.equal(await p.textContent('#resizeAll'), 'Resize all pages');
await p.click('#resizeAll');
await p.waitForFunction(() => /All \d+ pages resized/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
const landscape = await ratios();
assert.ok(landscape.every(r => Math.abs(r - 297 / 210) < 0.01), `every page A4 landscape: ${landscape}`);
console.log('· every page A4 landscape:', landscape.join(', '));
// One Undo brings every page back.
await p.evaluate(() => document.getElementById('undo').click());
await p.waitForFunction((n) => document.querySelectorAll('.sheet').length === n, before.length);
await p.waitForTimeout(800);
assert.deepEqual(await ratios(), before, 'one Undo restores every page');
console.log('· one Undo restored them all');
// Space on the right follows each page's own size: every page twice as wide as it was.
await choose('right100');
await p.click('#resizeAll');
await p.waitForFunction(() => /All \d+ pages resized/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
await p.waitForTimeout(800);
const wider = await ratios();
wider.forEach((r, i) => assert.ok(Math.abs(r - before[i] * 2) < 0.02, `page ${i + 1}: ${r} vs ${before[i]} × 2`));
console.log('· space added to every page, each from its own size');
// Asking again for what every page already has changes nothing.
await choose('right100');
await p.evaluate(() => { document.getElementById('status').textContent = ''; });
await p.click('#resizeAll');
await p.waitForFunction(() => /already has that size/.test(document.getElementById('status').textContent));
assert.equal(await p.evaluate(() => document.getElementById('undo').disabled), false);
console.log('· asked again: every page already has that size');
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('Resize all pages end to end: passed.');
