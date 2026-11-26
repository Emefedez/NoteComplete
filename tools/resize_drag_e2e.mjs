// Browser check of resizing a page by dragging its borders (Chromium, after a web build):
// Done keeps the new size, × puts the page back to the size it had before dragging, even
// after several drags.
//   node tools/resize_drag_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Examen wuolah.noteful'));
await p.waitForSelector('.sheet[data-page="0"] .render svg');
await p.waitForTimeout(2000); // the first page settles (re-renders) before its frame is added
const sheet = '.sheet[data-page="0"]';
const ratio = () => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return +(r.width / r.height).toFixed(3); }, sheet);
const label = () => p.textContent('.page-resize-label span');
const start = async () => {
  await p.evaluate(() => document.getElementById('resizeDrag').click());
  await p.waitForSelector('.page-resize-frame .page-resize-cancel');
};
// Drag the right edge handle by dx screen pixels and wait for the page to take the size.
const dragRight = async (dx) => {
  await p.evaluate(() => { document.getElementById('status').textContent = ''; });
  const handle = p.locator('.page-resize-handle.e');
  await handle.scrollIntoViewIfNeeded();
  const h = await handle.boundingBox();
  const x = h.x + h.width / 2, y = h.y + Math.min(h.height / 2, 900 - h.y - 4);
  await p.mouse.move(x, y); await p.mouse.down();
  await p.mouse.move(x + dx / 2, y, { steps: 4 }); await p.mouse.move(x + dx, y, { steps: 4 });
  await p.mouse.up();
  await p.waitForFunction(() => /Page resized/.test(document.getElementById('status').textContent));
  await p.waitForTimeout(500);
};
const original = await ratio();
const originalLabel = (await start(), await label());
// Two drags, then × : back to the original size, frame gone.
await dragRight(-120);
await dragRight(-80);
const narrower = await ratio();
assert.ok(narrower < original - 0.05, `dragging made the page narrower: ${narrower} vs ${original}`);
console.log('· two drags:', original, '→', narrower);
await p.click('.page-resize-cancel');
await p.waitForFunction(([s, r]) => { const b = document.querySelector(s).getBoundingClientRect(); return Math.abs(b.width / b.height - r) < 0.001; }, [sheet, original]);
assert.equal(await p.locator('.page-resize-frame').count(), 0, '× leaves resizing');
assert.equal(await ratio(), original, '× restores the page size');
console.log('· × put the page back:', await ratio());
// Done keeps the change.
await start();
assert.equal(await label(), originalLabel);
await dragRight(-100);
await p.click('.page-resize-label button:not(.page-resize-cancel)');
await p.waitForTimeout(300);
assert.equal(await p.locator('.page-resize-frame').count(), 0);
assert.ok(await ratio() < original - 0.02, 'Done keeps the new size');
console.log('· Done kept the new size:', await ratio());
// × without dragging changes nothing.
const kept = await ratio();
await start();
await p.click('.page-resize-cancel');
await p.waitForTimeout(300);
assert.equal(await ratio(), kept);
console.log('· × without dragging changed nothing');
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('Resize by dragging end to end: passed.');
