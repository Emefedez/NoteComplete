// Browser check of moving and resizing floating windows from anywhere on them, as in a
// tiling window manager (Chromium, after a web build): Ctrl + drag moves the Ask AI
// window, Shift + drag resizes it from the corner nearest the pointer, the place is
// remembered, a drag that starts on a button does not press it, and text fields keep
// their own Shift-click.
//   node tools/window_keys_e2e.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null, port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
await p.goto(server.origin + '/'); await p.waitForFunction(() => !document.getElementById('open').disabled);
await p.setInputFiles('#file', fileURLToPath(new URL('../samples/Examen wuolah.noteful', import.meta.url)));
await p.waitForSelector('.sheet[data-page="0"] .render svg');
await p.evaluate(() => { const c = document.getElementById('chatPanel'); c.hidden = false; c.classList.remove('compact'); });
await p.waitForFunction(() => document.getElementById('chatPanel').classList.contains('screen-window'));
const box = () => p.evaluate(() => { const r = document.getElementById('chatPanel').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const drag = async (key, from, by) => {
  await p.keyboard.down(key);
  await p.mouse.move(from.x, from.y); await p.mouse.down();
  await p.mouse.move(from.x + by.x, from.y + by.y, { steps: 8 }); await p.mouse.up();
  await p.keyboard.up(key);
};
// The panel's body, away from its head and edges.
const inside = (r, fx, fy) => ({ x: r.x + r.w * fx, y: r.y + r.h * fy });

let r0 = await box();
await drag('Shift', inside(r0, 0.2, 0.2), { x: 40, y: 250 });
let r1 = await box();
assert.ok(Math.abs(r1.x + r1.w - (r0.x + r0.w)) < 1 && Math.abs(r1.y + r1.h - (r0.y + r0.h)) < 1 && Math.abs(r1.w - (r0.w - 40)) < 2 && Math.abs(r1.h - (r0.h - 250)) < 2, `Shift + drag near the top left shrinks it from there (${JSON.stringify([r0, r1])})`);
await drag('Shift', inside(r1, 0.8, 0.8), { x: -30, y: -50 });
let r2 = await box();
assert.ok(Math.abs(r2.x - r1.x) < 1 && Math.abs(r2.y - r1.y) < 1 && Math.abs(r2.w - (r1.w - 30)) < 2 && Math.abs(r2.h - (r1.h - 50)) < 2, `Shift + drag near the bottom right resizes it from there (${JSON.stringify([r1, r2])})`);
console.log('· Shift + drag resized it from the nearest corner');
await drag('Control', inside(r2, 0.5, 0.6), { x: -150, y: 40 });
let r3 = await box();
assert.ok(Math.abs(r3.x - (r2.x - 150)) < 2 && Math.abs(r3.y - (r2.y + 40)) < 2 && Math.abs(r3.w - r2.w) < 1 && Math.abs(r3.h - r2.h) < 1, `Ctrl + drag moves it (${JSON.stringify([r2, r3])})`);
console.log('· Ctrl + drag moved the window');

const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('notecomplete-chat-window:screen')));
assert.ok(Math.abs(saved.width - r3.w) < 1 && Math.abs(saved.height - r3.h) < 1, 'the size is remembered');

// A Ctrl + drag that starts on a head button (put away) moves the window and does not press it.
const away = await p.locator('#chatPanel .window-away').boundingBox();
await drag('Control', { x: away.x + away.width / 2, y: away.y + away.height / 2 }, { x: -30, y: 20 });
assert.equal(await p.evaluate(() => document.getElementById('chatPanel').classList.contains('in-tray')), false, 'the button under the drag was not pressed');
const r4 = await box();
assert.ok(Math.abs(r4.x - (r3.x - 30)) < 2, 'it moved instead');
console.log('· a drag starting on a button moved the window without pressing it');

// Shift-click in the question field still selects text there; the window stays put.
// (The question field is hidden in the web app without an AI tool: a field like it stands in.)
await p.evaluate(() => { const t = document.createElement('textarea'); t.id = 'probeField'; t.style.cssText = 'display:block;width:200px;height:40px'; document.querySelector('#chatPanel .chat-head').after(t); });
const field = p.locator('#probeField');
{
  await field.fill('one two three');
  const fb = await field.boundingBox();
  await drag('Shift', { x: fb.x + 10, y: fb.y + fb.height / 2 }, { x: 40, y: 0 });
  const r5 = await box();
  assert.deepEqual([r5.x, r5.y, r5.w, r5.h].map(Math.round), [r4.x, r4.y, r4.w, r4.h].map(Math.round), 'Shift-drag in a text field leaves the window alone');
  console.log('· Shift in the question field left the window alone');
}
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('Window keys end to end: passed.');
