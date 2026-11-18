// Browser check of pasting from other apps onto a page (Chromium, after a web build): a picture
// in the clipboard goes centred on the pointer and is selected; plain text becomes a text box.
// Checked with Edit PDF on, where it matters most.
//   node tools/paste_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const DIR = process.argv[2] || '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Practice book (vol. 1).noteful'));
await p.locator('.sheet[data-page="0"] .render').waitFor();
await p.fill('#pageNumber', '2'); await p.press('#pageNumber', 'Enter'); await sleep(1200);
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press('e');
const s = await p.locator('.sheet[data-page="1"]').boundingBox();
const spot = [s.x + 700, Math.max(s.y, 150) + 380];
await p.mouse.move(...spot); await sleep(300);
// An image in the clipboard (a red and blue 40×20 PNG drawn here).
await p.evaluate(async () => {
  const c = Object.assign(document.createElement('canvas'), { width: 40, height: 20 });
  const x = c.getContext('2d'); x.fillStyle = '#d00'; x.fillRect(0, 0, 20, 20); x.fillStyle = '#00d'; x.fillRect(20, 0, 20, 20);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
});
await p.keyboard.press('Control+v');
await p.locator('.sheet[data-page="1"] .render [data-item^="image:"] image').first().waitFor({ state: 'attached', timeout: 15000 });
await sleep(800);
const img = await p.locator('.sheet[data-page="1"] .render [data-item^="image:"]').first().boundingBox();
assert.ok(Math.abs(img.x + img.width / 2 - spot[0]) < 3 && Math.abs(img.y + img.height / 2 - spot[1]) < 3, 'centred on the pointer');
assert.equal(await p.evaluate(() => document.querySelector('button[data-tool][aria-pressed=true]')?.dataset.tool), 'select', 'selected, to move it');
console.log('· a pasted picture lands centred on the pointer, selected (Edit PDF on)');
if (DIR) await p.screenshot({ path: DIR + '/paste-image.png' });
// Text from another app.
await p.keyboard.press('Escape');
await p.evaluate(() => navigator.clipboard.writeText('Pegado desde otra app\nsegunda línea'));
await p.mouse.move(s.x + 300, Math.max(s.y, 150) + 600); await sleep(200);
await p.keyboard.press('Control+v'); await sleep(1500);
const texts = await p.$$eval('.sheet[data-page="1"] .render [data-item^="image:"] tspan', (ts) => ts.map((t) => t.textContent));
assert.deepEqual(texts, ['Pegado desde otra app', 'segunda línea']);
console.log('· pasted text from another app becomes a text box');
if (DIR) await p.screenshot({ path: DIR + '/paste-text.png' });
assert.deepEqual(errors, []);
console.log('Paste from other apps: OK');
await b.close(); process.exit(0);
