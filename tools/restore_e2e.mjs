// Browser check of reopening documents after a restart for an update (Chromium, after a web
// build). The desktop bridge (preload.cjs notecompleteRestore, main.js session.js) is stood in
// for: one tab asks the reader for its state (window.notecompleteSession), another starts with
// it. An edited note comes back on its page with its unsaved changes; a saved note reopens
// from Recent as saved.
//   node tools/restore_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Practice book (vol. 1).noteful'));
await p.waitForSelector('.sheet[data-page="0"] .render');
await p.keyboard.press('Control+s');
await p.waitForFunction(() => !document.getElementById('saveState').classList.contains('dirty'), null, { timeout: 20000 });
await p.fill('#pageNumber', '3'); await p.press('#pageNumber', 'Enter'); await sleep(1200);
const strokes = (q) => q.evaluate(() => document.querySelectorAll('.sheet[data-page="2"] [data-item^="new:"]').length);
await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
const s = await p.locator('.sheet[data-page="2"]').boundingBox();
await p.mouse.move(s.x + 200, Math.max(s.y, 150) + 100); await p.mouse.down();
for (let i = 1; i <= 10; i++) await p.mouse.move(s.x + 200 + i * 12, Math.max(s.y, 150) + 110);
await p.mouse.up(); await sleep(1000);
assert.equal(await strokes(p), 1);
const state = await p.evaluate(() => window.notecompleteSession());
assert.ok(state.entryKey && state.slot && state.page === 2);
await p.close();
// "After the restart": a fresh page whose desktop bridge hands back that state.
const q = await ctx.newPage(); q.on('pageerror', (e) => errors.push(e.message));
await q.addInitScript((st) => { window.notecompleteRestore = { take: async () => st }; }, state);
await openReader(q, server.origin);
await q.waitForSelector('.sheet[data-page="2"] .render', { timeout: 30000 });
await q.waitForFunction(() => document.querySelectorAll('.sheet[data-page="2"] [data-item^="new:"]').length === 1, null, { timeout: 20000 });
await sleep(800);
const info = await q.evaluate(() => ({ title: document.getElementById('title').textContent, page: document.getElementById('pageNumber').value, dirty: document.getElementById('saveState').classList.contains('dirty'), status: document.getElementById('status').textContent }));
console.log('· an edited note comes back on its page, with its unsaved changes');
assert.equal(info.page, '3');
assert.ok(info.dirty, 'unsaved, as before the restart');
// A saved note with nothing unsaved: reopened from Recent, no automatic save.
const r = await ctx.newPage(); r.on('pageerror', (e) => errors.push(e.message));
await r.addInitScript((st) => { window.notecompleteRestore = { take: async () => st }; }, { ...state, slot: '', page: 0 });
await openReader(r, server.origin);
await r.waitForSelector('.sheet[data-page="0"] .render', { timeout: 30000 });
await sleep(800);
const saved = await r.evaluate(() => ({ dirty: document.getElementById('saveState').classList.contains('dirty'), strokes: document.querySelectorAll('[data-item^="new:"]').length }));
assert.deepEqual(saved, { dirty: false, strokes: 0 }, 'a saved note reopens as saved');
console.log('· a saved note reopens from Recent as it was saved');
assert.deepEqual(errors, []);
console.log('Restore after an update: OK');
await b.close(); process.exit(0);
