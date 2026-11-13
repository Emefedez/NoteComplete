// Browser check of moving a grabbed group (Chromium, after a web build): the Grab tool's
// rectangle selects every item in it, dragging the group moves them all, and one Undo
// brings them all back. Resizing the group (highlighter boxes and ink over them) leaves
// every item where the preview showed it, and the Grab menu's Erase clears the region.
//   node tools/group_move_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Examen wuolah.noteful'));
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

// Resize: a corner dragged out by half the group's size. Every item ends where the preview
// showed it (they used to land elsewhere), and the selection box goes around them.
const sheetBox = () => p.locator('.sheet[data-page="0"]').boundingBox();
const boxes = () => p.evaluate(() => { const s = document.querySelector('.sheet[data-page="0"]').getBoundingClientRect(); return Object.fromEntries([...document.querySelectorAll('.sheet[data-page="0"] [data-item]')].filter(e => !e.parentElement.closest('[data-item]')).map(e => { const b = e.getBoundingClientRect(); return [e.dataset.item, [b.x - s.x, b.y - s.y, b.width, b.height]]; }).filter(([, b]) => b[2] || b[3])); });
const grab = async (r) => {
  await p.evaluate(() => document.querySelector('[data-tool=grab]').click());
  await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.mouse.move(r.x + r.w, r.y + r.h, { steps: 8 }); await p.mouse.up();
  await p.waitForSelector('#grabMenu:not([hidden])');
};
await grab(rect);
await p.evaluate(() => document.getElementById('grabSelect').click());
await p.waitForFunction(() => document.querySelector('.selection-overlay [data-selection-handle="2"]'), null, { timeout: 15000 });
const corner = await p.locator('[data-selection-handle="2"]').boundingBox();
await p.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await p.mouse.down();
await p.mouse.move(corner.x + corner.width / 2 + rect.w / 2, corner.y + corner.height / 2 + rect.h / 2, { steps: 10 });
await p.waitForTimeout(200);
const preview = await boxes();
await p.mouse.up();
await p.waitForTimeout(3000);
const resized = await boxes();
const off = Object.keys(preview).filter(id => before.some(b => b.id === id) && (!resized[id] || resized[id].some((v, i) => Math.abs(v - preview[id][i]) > 3)));
assert.deepEqual(off, [], 'every resized item stays where the preview showed it');
const s0 = await sheetBox(), poly2 = await p.locator('.selection-overlay polygon').boundingBox();
const ids = before.map(b => b.id).filter(id => resized[id]);
const union = [Math.min(...ids.map(id => resized[id][0])), Math.min(...ids.map(id => resized[id][1])), Math.max(...ids.map(id => resized[id][0] + resized[id][2])), Math.max(...ids.map(id => resized[id][1] + resized[id][3]))];
assert.ok(Math.abs(poly2.x - s0.x - union[0]) < 12 && Math.abs(poly2.y - s0.y - union[1]) < 12, `the selection box goes around the resized items (${[poly2.x - s0.x, poly2.y - s0.y]} vs ${union})`);
console.log('· a resized group ends where its preview showed it,', ids.length, 'items');
await p.evaluate(() => document.getElementById('undo').click());
await p.waitForTimeout(1500);
await p.keyboard.press('Escape');

// Erase: the Grab menu's eraser removes the ink in the region in one step; ink well outside stays.
const all = await boxes();
await grab(rect);
await p.evaluate(() => document.getElementById('grabErase').click());
await p.waitForTimeout(2500);
const left = await boxes();
const s1 = await sheetBox(), r = { x: rect.x - s1.x, y: rect.y - s1.y, w: rect.w, h: rect.h };
const within = Object.entries(all).filter(([, b]) => b[0] >= r.x && b[1] >= r.y && b[0] + b[2] <= r.x + r.w && b[1] + b[3] <= r.y + r.h).map(([id]) => id);
const far = Object.entries(all).filter(([, b]) => b[1] > r.y + r.h + 40 || b[1] + b[3] < r.y - 40).map(([id]) => id);
assert.ok(within.length > 10, 'ink inside the region');
assert.deepEqual(within.filter(id => left[id]), [], 'the ink inside the region is erased');
assert.deepEqual(far.filter(id => !left[id]), [], 'ink away from the region stays');
await p.evaluate(() => document.getElementById('undo').click());
await p.waitForTimeout(1500);
assert.equal(Object.keys(await boxes()).length, Object.keys(all).length, 'one Undo brings it all back');
console.log('· Erase cleared', within.length, 'items inside the region; one Undo brought them back');
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('Group move end to end: passed.');
