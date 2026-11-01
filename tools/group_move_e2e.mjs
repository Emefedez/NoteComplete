// Browser check of moving a grabbed group (Chromium, after a web build): the Grab tool's
// rectangle selects every item in it, dragging the group moves them all, and one Undo
// brings them all back.
//   node tools/group_move_e2e.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null, port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
await p.goto(server.origin + '/'); await p.waitForFunction(() => !document.getElementById('open').disabled);
await p.setInputFiles('#file', fileURLToPath(new URL('../samples/Examen wuolah.noteful', import.meta.url)));
await p.waitForFunction(() => document.querySelectorAll('.sheet [data-item]').length > 10);
const s = await p.locator('.sheet').first().boundingBox();
const rect = { x: s.x + s.width * 0.05, y: s.y + s.height * 0.1, w: s.width * 0.4, h: s.height * 0.12 };
const inside = () => p.evaluate((r) => [...document.querySelectorAll('.sheet[data-page="0"] [data-item]')].map(e => { const b = e.getBoundingClientRect(); return { id: e.dataset.item, x: b.x, y: b.y, w: b.width, h: b.height }; }).filter(b => b.w > 0 && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y), rect);
await p.evaluate(() => document.querySelector('[data-tool=grab]').click());
await p.mouse.move(rect.x, rect.y); await p.mouse.down(); await p.mouse.move(rect.x + rect.w, rect.y + rect.h, { steps: 8 }); await p.mouse.up();
const before = await inside();
await p.evaluate(() => document.getElementById('grabSelect').click());
await p.waitForFunction(() => document.querySelector('.selection-overlay'), null, { timeout: 15000 });
assert.match(await p.textContent('#selectionKind'), /^Group/);
const poly = await p.locator('.selection-overlay polygon').boundingBox();
await p.mouse.move(poly.x + poly.width / 2, poly.y + poly.height / 2); await p.mouse.down();
await p.mouse.move(poly.x + poly.width / 2 + 60, poly.y + poly.height / 2 + 200, { steps: 10 }); await p.mouse.up();
await p.waitForTimeout(3000);
const after = await p.evaluate((ids) => ids.map(id => { const e = document.querySelector(`.sheet[data-page="0"] [data-item="${CSS.escape(id)}"]`); const b = e?.getBoundingClientRect(); return b ? { id, x: b.x, y: b.y } : { id, gone: true }; }), before.map(b => b.id));
let moved = 0, stayed = [];
for (const a of after) { const o = before.find(b => b.id === a.id); if (!a.gone && Math.abs(a.y - o.y - 200) < 15) moved++; else stayed.push(a.id); }
assert.ok(before.length > 20, 'the rectangle holds many strokes');
assert.deepEqual(stayed, [], 'every item moved');
console.log('· moved', moved, 'of', before.length);
await p.evaluate(() => document.getElementById('undo').click());
await p.waitForTimeout(1500);
const back = await p.evaluate((ids) => ids.map(id => document.querySelector(`.sheet[data-page="0"] [data-item="${CSS.escape(id)}"]`)?.getBoundingClientRect().y), before.map(b => b.id));
assert.equal(back.filter((y, i) => Math.abs(y - before[i].y) < 3).length, before.length, 'one Undo brings the whole group back');
console.log('· one Undo brought them all back');
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('Group move end to end: passed.');
