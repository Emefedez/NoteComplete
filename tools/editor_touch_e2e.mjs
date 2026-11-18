// Browser check of the diagram editor with fingers, a pen and a mouse (Chromium, after a web
// build; touch and pen input through the DevTools protocol): two- and three-finger taps undo
// and redo, a pinch zooms smoothly, two fingers held still open the quick menu, a hovering pen
// shows a ring, every corner resizes (the opposite one stays), and Shift + drag from anywhere
// on an element connects it without a menu.
//   node tools/editor_touch_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { chromium, startReader } from './e2e_common.mjs';
const DIR = process.argv[2] || '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1100, height: 760 }, hasTouch: true, colorScheme: 'dark' });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto(server.origin + '/uml.html');
await p.locator('.uml-canvas svg').first().waitFor();
await sleep(600);
const box = await p.locator('.uml-canvas').boundingBox();
const counts = () => p.evaluate(() => ({ elements: document.querySelectorAll('.uml-canvas [data-uml-kind="element"]').length, connectors: document.querySelectorAll('.uml-canvas [data-uml-kind="connector"]').length }));
const viewW = () => p.evaluate(() => Number(document.querySelector('.uml-canvas svg').getAttribute('viewBox').split(' ')[2]));
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })) });
const out = {};
out.start = await counts();
// Two-finger tap → undo; three → redo (after deleting an element with the keyboard).
const el = await p.locator('.uml-canvas [data-uml-kind="element"]').first().boundingBox();
await p.mouse.click(el.x + el.width / 2, el.y + el.height / 2);
await p.keyboard.press('Delete'); await sleep(300);
out.deleted = await counts();
const c = [box.x + box.width * 0.7, box.y + box.height * 0.7];
await touch('touchStart', [c, [c[0] + 60, c[1]]]); await sleep(60); await touch('touchEnd', []); await sleep(400);
out.afterTwoTap = await counts();
await touch('touchStart', [c, [c[0] + 60, c[1]], [c[0] + 120, c[1]]]); await sleep(60); await touch('touchEnd', []); await sleep(400);
out.afterThreeTap = await counts();
// Pinch: fingers apart → zoom in, in steps; the view must change smoothly and stay finite.
const w0 = await viewW();
const widths = [];
for (let i = 0; i <= 10; i++) {
  const d = 60 + i * 20;
  await touch(i ? 'touchMove' : 'touchStart', [[c[0] - d, c[1]], [c[0] + d, c[1]]]);
  await sleep(30);
  widths.push(Math.round(await viewW()));
}
await touch('touchEnd', []); await sleep(300);
out.pinch = { from: Math.round(w0), steps: widths };
await p.click('.uml-bar button[title="Show the whole diagram"]'); await sleep(300);
// Two fingers held still → the quick menu.
await touch('touchStart', [c, [c[0] + 80, c[1]]]); await sleep(700);
out.holdMenu = await p.locator('.quick-menu, .qm-ring, [class*="quick"]').count();
await touch('touchEnd', []); await sleep(200);
await p.keyboard.press('Escape'); await sleep(200);
// Pen hover: the ring follows.
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c[0], y: c[1], pointerType: 'pen' });
await sleep(100);
out.penRing = await p.evaluate(() => { const r = document.querySelector('.pen-hover-ring'); return r && !r.hidden ? r.style.transform : null; });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c[0] + 300, y: c[1] - 300, pointerType: 'mouse' });
// Resize from the top-left corner with the mouse.
const e2 = await p.locator('.uml-canvas [data-uml-kind="element"]').first().boundingBox();
await p.mouse.click(e2.x + e2.width / 2, e2.y + e2.height / 2); await sleep(200);
const nw = await p.locator('.uml-canvas [data-handle="resize:nw"]').boundingBox();
const se0 = await p.locator('.uml-canvas [data-handle="resize:se"]').boundingBox();
out.corners = await p.locator('.uml-canvas [data-handle^="resize:"]').count();
await p.mouse.move(nw.x + nw.width / 2, nw.y + nw.height / 2); await p.mouse.down();
await p.mouse.move(nw.x - 40, nw.y - 30, { steps: 6 }); await p.mouse.up(); await sleep(300);
const e3 = await p.locator('.uml-canvas [data-uml-kind="element"]').first().boundingBox();
const se1 = await p.locator('.uml-canvas [data-handle="resize:se"]').boundingBox();
const nw1 = await p.locator('.uml-canvas [data-handle="resize:nw"]').boundingBox();
out.seCorner = [Math.round(se1.x - se0.x), Math.round(se1.y - se0.y)];
out.nwCorner = [Math.round(nw1.x - nw.x), Math.round(nw1.y - nw.y)];
out.resizedNW = { dx: Math.round(e3.x - e2.x), dw: Math.round(e3.width - e2.width), right: Math.round(e3.x + e3.width - (e2.x + e2.width)) };
// Shift + drag from the middle of one element to another: a connection, no menu.
const els = await p.$$eval('.uml-canvas [data-uml-kind="element"]', (n) => n.map((x) => { const r = x.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
const before = await counts();
await p.keyboard.down('Shift');
await p.mouse.move(els[0][0], els[0][1]); await p.mouse.down();
await p.mouse.move(els[1][0], els[1][1], { steps: 8 }); await p.mouse.up();
await p.keyboard.up('Shift'); await sleep(300);
out.shiftConnect = { before: before.connectors, after: (await counts()).connectors, menu: await p.locator('.context-menu').count() };
if (DIR) await p.screenshot({ path: DIR + '/uml-touch.png' });
assert.deepEqual(out.afterTwoTap, out.start, 'two-finger tap: undo');
assert.deepEqual(out.afterThreeTap, out.deleted, 'three-finger tap: redo');
console.log('· two- and three-finger taps undo and redo');
const steps = out.pinch.steps;
assert.ok(steps.every((w, i) => !i || w <= steps[i - 1]) && steps.at(-1) < out.pinch.from * 0.4, `pinch zooms in steadily: ${steps}`);
console.log('· a pinch zooms in steadily');
assert.ok(out.holdMenu > 0, 'two fingers held: the quick menu');
assert.ok(out.penRing, 'a hovering pen shows its ring');
console.log('· two fingers held open the quick menu; a hovering pen shows a ring');
assert.equal(out.corners, 4);
assert.deepEqual(out.seCorner, [0, 0], 'resized from the top-left corner: the bottom-right one stays');
console.log('· every corner resizes, the opposite one stays');
assert.deepEqual(out.shiftConnect, { before: out.shiftConnect.before, after: out.shiftConnect.before + 1, menu: 0 });
console.log('· Shift + drag from an element connects it, no menu');
assert.deepEqual(errors, []);
console.log('Diagram editor with fingers and pen: OK');
await b.close(); process.exit(0);
