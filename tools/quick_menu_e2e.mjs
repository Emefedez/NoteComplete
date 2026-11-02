// Browser check of the quick menu (Chromium): Z held over the pages, pointed at a tool
// and let go chooses it; Z tapped, a tool tapped shows its settings; a held tool moves on
// the ring; 1–8 choose tools;
// Esc closes; a pen's side button opens it without removing anything; two fingers held
// still open it on a touch screen and do not undo.
//   node tools/quick_menu_e2e.mjs [screenshot-dir]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const shots = process.argv[2];
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null, port: 0 });
const b = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sample = fileURLToPath(new URL('../samples/Examen wuolah.noteful', import.meta.url));
const openNote = async (p) => {
  await p.goto(server.origin + '/');
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.setInputFiles('#file', sample);
  await p.waitForFunction(() => document.querySelectorAll('.sheet [data-item]').length > 10);
};
const tool = (p) => p.evaluate(() => document.querySelector('#toolbar [data-tool][aria-pressed="true"]')?.dataset.tool);
try {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await openNote(p);
  const s = await p.locator('.sheet').first().boundingBox();
  await p.mouse.move(s.x + 300, s.y + 300);
  // Hold Z, point at the highlighter, let go.
  await p.keyboard.down('z');
  await p.waitForSelector('.quick-menu');
  if (shots) { await sleep(400); await p.screenshot({ path: `${shots}/quick-menu.png`, clip: { x: s.x + 100, y: s.y + 100, width: 420, height: 420 } }); }
  const hl = await p.locator('.quick-menu [aria-label="Highlighter"]').boundingBox();
  await sleep(300);
  await p.mouse.move(hl.x + 22, hl.y + 22);
  await p.keyboard.up('z');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'letting go closes it');
  assert.equal(await tool(p), 'highlight');
  console.log('· hold Z, point, let go: chooses the tool');
  // Tap Z, tap the pen: it is chosen and its settings ring the tools; they apply at once
  // and the menu stays open for more.
  await p.keyboard.press('z');
  await p.waitForSelector('.quick-menu');
  await p.click('.quick-menu .qm-inner[aria-label="Pen"]');
  assert.equal(await tool(p), 'draw');
  assert.equal(await p.locator('.quick-menu').count(), 1, 'a tool with settings keeps the menu open');
  assert.ok(await p.locator('.quick-menu [aria-label="Pen pressure"]').count(), 'the pen\'s settings are shown');
  await p.click('.quick-menu .qm-swatch >> nth=2');
  assert.equal(await p.inputValue('#color'), '#d13b2f');
  await p.click('.quick-menu .qm-outer[aria-label="4 pt"]');
  assert.equal(await p.inputValue('#width'), '4');
  assert.equal(await p.getAttribute('.quick-menu .qm-outer[aria-label="4 pt"]', 'aria-pressed'), 'true');
  if (shots) await sleep(300), await p.screenshot({ path: `${shots}/quick-menu-pen.png`, clip: { x: s.x + 100, y: s.y + 100, width: 420, height: 420 } });
  // The eraser's settings are its sizes; Select has none and closes the menu.
  await p.click('.quick-menu .qm-inner[aria-label="Eraser"]');
  assert.ok(await p.locator('.quick-menu .qm-outer[aria-label="Large"]').count(), 'eraser sizes');
  await p.click('.quick-menu .qm-inner[aria-label="Select"]');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'a tool without settings closes it');
  console.log('· tapping a tool shows its settings: colours, widths, pressure, eraser sizes');
  // Holding a tool lifts it; dropped on another place, the ring keeps that order.
  await p.keyboard.press('z');
  await p.waitForSelector('.quick-menu');
  const ringOrder = () => p.evaluate(() => [...document.querySelectorAll('.quick-menu .qm-inner')].map((b) => b.getAttribute('aria-label')));
  const first = await ringOrder();
  const pen = await p.locator('.quick-menu .qm-inner >> nth=0').boundingBox();
  const target = await p.locator('.quick-menu .qm-inner >> nth=2').boundingBox();
  await p.mouse.move(pen.x + 22, pen.y + 22); await p.mouse.down(); await sleep(600);
  for (let i = 1; i <= 8; i++) await p.mouse.move(pen.x + 22 + (target.x - pen.x) * i / 8, pen.y + 22 + (target.y - pen.y) * i / 8);
  await p.mouse.up(); await sleep(100);
  const second = await ringOrder();
  assert.equal(second[2], first[0], `the held tool moved (${second})`);
  assert.equal(await tool(p), 'select', 'moving a tool does not choose it');
  assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem('notecomplete-quick-order'))).slice(0, 3), ['highlight', 'erase', 'draw']);
  await p.keyboard.press('Escape');
  console.log('· hold a tool to move it on the ring (remembered)');
  await p.keyboard.press('z'); await p.keyboard.press('2');
  assert.equal(await tool(p), 'erase', '2 chooses the second tool (after the move)');
  await p.keyboard.press('Escape');
  await p.keyboard.press('z'); await p.keyboard.press('Escape');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'Esc closes it');
  // Typing in a text field never opens it.
  await p.evaluate(() => { const i = document.createElement('input'); i.id = 'probe'; document.body.append(i); i.focus(); });
  await p.keyboard.press('z');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'not while typing');
  await p.evaluate(() => document.getElementById('probe').remove());
  console.log('· number keys, Esc, not while typing');
  // A pen's side button: the menu, and nothing under it is removed.
  const cdp = await p.context().newCDPSession(p);
  const items = await p.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length);
  const at = await p.evaluate(() => { const r = document.querySelector('.sheet[data-page="0"] [data-item]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'right', buttons: 2, clickCount: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'right', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await p.waitForSelector('.quick-menu');
  await sleep(500);
  assert.equal(await p.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length), items, 'nothing removed');
  await p.keyboard.press('Escape');
  console.log('· a pen side button opens it and removes nothing');
  assert.deepEqual(errors, []);

  // Two fingers held still on a touch screen.
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  const t = await ctx.newPage();
  await openNote(t);
  await t.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const tc = await ctx.newCDPSession(t);
  const touch = (type, pts) => tc.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const before = await t.evaluate(() => document.querySelectorAll('.sheet [data-item]').length);
  await touch('touchStart', [[300, 600]]); await touch('touchStart', [[300, 600], [400, 600]]);
  await sleep(800);
  assert.equal(await t.locator('.quick-menu').count(), 1, 'two fingers held open it');
  await touch('touchEnd', []); await sleep(400);
  assert.equal(await t.evaluate(() => document.querySelectorAll('.sheet [data-item]').length), before, 'no undo and no stroke');
  if (shots) await t.screenshot({ path: `${shots}/quick-menu-touch.png` });
  await t.locator('.quick-menu [aria-label="Shapes"]').tap();
  assert.equal(await tool(t), 'shape');
  console.log('· two fingers held still open it on a touch screen');
  console.log('Quick menu end to end: passed.');
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
