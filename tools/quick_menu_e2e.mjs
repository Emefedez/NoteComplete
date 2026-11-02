// Browser check of the quick menu (Chromium): Shift + S held over the pages, pointed at a tool
// and let go chooses it; Shift + S pressed, a tool tapped shows its settings; a held tool moves on
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
  // Hold Shift + S, point at the highlighter, let go.
  await p.keyboard.down('Shift'); await p.keyboard.down('S');
  await p.waitForSelector('.quick-menu');
  if (shots) { await sleep(400); await p.screenshot({ path: `${shots}/quick-menu.png`, clip: { x: s.x + 100, y: s.y + 100, width: 420, height: 420 } }); }
  const hl = await p.locator('.quick-menu [aria-label="Highlighter"]').boundingBox();
  await sleep(300);
  await p.mouse.move(hl.x + 22, hl.y + 22);
  await p.keyboard.up('S'); await p.keyboard.up('Shift');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'letting go closes it');
  assert.equal(await tool(p), 'highlight');
  console.log('· hold Shift + S, point, let go: chooses the tool');
  // Press Shift + S, tap the pen: it is chosen and its settings ring the tools; they apply at once
  // and the menu stays open for more.
  await p.keyboard.press('Shift+S');
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
  // Every tool's colours across the top, sizes along the bottom: the highlighter like the pen.
  await p.keyboard.press('Shift+S');
  await p.click('.quick-menu .qm-inner[aria-label="Highlighter"]');
  const layout = await p.evaluate(() => {
    const centre = document.querySelector('.quick-menu .qm-centre').getBoundingClientRect();
    const cy = centre.y + centre.height / 2;
    const ys = (sel) => [...document.querySelectorAll(sel)].map((b) => b.getBoundingClientRect().y + b.getBoundingClientRect().height / 2 - cy);
    const xs = [...document.querySelectorAll('.quick-menu .qm-outer[aria-label$="pt"]')].map((b) => b.getBoundingClientRect().x);
    return { colours: ys('.quick-menu .qm-swatch'), widths: ys('.quick-menu .qm-outer[aria-label$="pt"]'), xs };
  });
  assert.ok(layout.colours.every((y) => y < 0), 'colours on top');
  assert.ok(layout.widths.every((y) => y > 0), 'widths along the bottom');
  assert.deepEqual(layout.xs, [...layout.xs].sort((a, b) => a - b), 'widths small to large, left to right');
  // A colour dragged to another place keeps it; right-click opens the colour picker.
  const sw = async (i) => p.locator(`.quick-menu .qm-swatch >> nth=${i}`).boundingBox();
  const c0 = await sw(0), c2 = await sw(2);
  const firstColour = await p.getAttribute('.quick-menu .qm-swatch >> nth=0', 'aria-label');
  await p.mouse.move(c0.x + 18, c0.y + 18); await p.mouse.down(); await sleep(450);
  for (let i = 1; i <= 8; i++) await p.mouse.move(c0.x + 18 + (c2.x - c0.x) * i / 8, c0.y + 18 + (c2.y - c0.y) * i / 8);
  await p.mouse.up(); await sleep(150);
  assert.equal(await p.getAttribute('.quick-menu .qm-swatch >> nth=2', 'aria-label'), firstColour, 'the colour moved');
  assert.equal(JSON.parse(await p.evaluate(() => localStorage.getItem('notecomplete-palettes'))).highlight[2], firstColour.match(/#[0-9a-f]+/i)[0]);
  await p.click('.quick-menu .qm-swatch >> nth=1', { button: 'right' });
  assert.equal(await p.evaluate(() => !!document.querySelector('body > input[type=color]')), true, 'right-click opens the colour picker');
  await p.evaluate(() => { const input = document.querySelector('body > input[type=color]'); input.value = '#123456'; input.dispatchEvent(new Event('change')); });
  assert.match(await p.getAttribute('.quick-menu .qm-swatch >> nth=1', 'aria-label'), /#123456/, 'the palette colour changed');
  assert.equal(await p.inputValue('#color'), '#123456');
  await p.keyboard.press('Escape');
  console.log('· every tool’s colours on top and sizes below; colours can be moved and changed');
  // Shift + right-click opens it too, and removes nothing.
  const kept = await p.evaluate(() => document.querySelectorAll('.sheet [data-item]').length);
  await p.keyboard.down('Shift');
  await p.mouse.click(s.x + 300, s.y + 300, { button: 'right' });
  await p.keyboard.up('Shift');
  await p.waitForSelector('.quick-menu');
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(() => document.querySelectorAll('.sheet [data-item]').length), kept);
  console.log('· Shift + right-click opens it');
  await p.evaluate(() => document.querySelector('[data-tool=select]').click());
  // Holding a tool lifts it; dropped on another place, the ring keeps that order.
  await p.keyboard.press('Shift+S');
  await p.waitForSelector('.quick-menu');
  // Select has no settings: the small menu, tools only.
  assert.equal(await p.locator('.quick-menu .qm-outer').count(), 0, 'no outer ring without settings');
  assert.ok((await p.locator('.quick-menu .qm-disc').boundingBox()).width < 170, 'the small menu');
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
  await p.keyboard.press('Shift+S'); await p.keyboard.press('2');
  assert.equal(await tool(p), 'erase', '2 chooses the second tool (after the move)');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Shift+S'); await p.keyboard.press('Escape');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'Esc closes it');
  // Typing in a text field never opens it.
  await p.evaluate(() => { const i = document.createElement('input'); i.id = 'probe'; document.body.append(i); i.focus(); });
  await p.keyboard.press('Shift+S');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'not while typing');
  await p.evaluate(() => document.getElementById('probe').remove());
  // S alone is still the Select tool.
  await p.keyboard.press('p'); await p.keyboard.press('s');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'S alone does not open it');
  assert.equal(await tool(p), 'select');
  console.log('· number keys, Esc, not while typing; S alone still selects');
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
  // Shift + pen: Shift held as the pen touches, or pressed while the pen hovers.
  const shiftBefore = await p.evaluate(() => document.querySelectorAll('.sheet [data-item]').length);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0] + 40, y: at[1] + 40, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', modifiers: 8 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0] + 40, y: at[1] + 40, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', modifiers: 8 });
  await p.waitForSelector('.quick-menu');
  await sleep(400);
  assert.equal(await p.evaluate(() => document.querySelectorAll('.sheet [data-item]').length), shiftBefore, 'Shift + pen draws nothing');
  await p.keyboard.press('Escape');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0] + 60, y: at[1] + 20, button: 'none', buttons: 0, pointerType: 'pen' });
  await p.keyboard.press('Shift');
  await p.waitForSelector('.quick-menu');
  await p.keyboard.press('Escape');
  console.log('· Shift + pen opens it at the pen (touching or hovering)');
  // The button however it is reported: pressed while hovering (right button, eraser bit),
  // or in the middle of a stroke.
  for (const buttons of [1, 2, 4]) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0] + 70, y: at[1] + 30, button: 'none', buttons: 0, pointerType: 'pen' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0] + 72, y: at[1] + 30, button: 'none', buttons, pointerType: 'pen' });
    await p.waitForSelector('.quick-menu', { timeout: 3000 });
    await p.keyboard.press('Escape');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0] + 74, y: at[1] + 30, button: 'none', buttons: 0, pointerType: 'pen' });
  }
  console.log('· a pen button pressed while hovering opens it (Android buttons 1, right or middle bit)');
  // Button held, then a tap: Chromium sends only a contextmenu with no pointer type.
  const removed = await p.evaluate(() => document.querySelectorAll('.sheet [data-item]').length);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0] + 80, y: at[1] + 30, button: 'none', buttons: 0, pointerType: 'pen' });
  await p.evaluate(([x, y]) => document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })), [at[0] + 80, at[1] + 30]);
  await p.waitForSelector('.quick-menu', { timeout: 3000 });
  await p.keyboard.press('Escape');
  await sleep(300);
  assert.equal(await p.evaluate(() => document.querySelectorAll('.sheet [data-item]').length), removed, 'the hold-and-tap removes nothing');
  console.log('· the button held and a tap (contextmenu with no pointer type) opens it');
  // View → Pen button…: hover, press twice, tap with it held; then saved for this browser.
  await p.evaluate(() => document.getElementById('penSetupOpen').click());
  const pad2 = await p.locator('#penSetupPad').boundingBox();
  const hover = (buttons) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pad2.x + 50 + Math.random() * 20, y: pad2.y + 50, button: 'none', buttons, pointerType: 'pen' });
  await p.click('#penSetupStart');
  for (let i = 0; i < 6; i++) { await hover(0); await sleep(150); }
  await p.waitForFunction(() => document.getElementById('penSetupStep').textContent.startsWith('2 of 3'), null, { timeout: 4000 });
  for (const b of [1, 1, 0, 1, 0]) { await hover(b); await sleep(120); }
  await p.waitForFunction(() => document.getElementById('penSetupStep').textContent.startsWith('3 of 3'), null, { timeout: 8000 });
  await p.evaluate(() => document.getElementById('penSetupPad').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  await p.waitForFunction(() => document.getElementById('penSetupStep').textContent.startsWith('Done'), null, { timeout: 8000 });
  assert.match(await p.textContent('#penSetupResult'), /hovers \(reported as buttons 1\) and when you tap/);
  await p.click('#penSetupLongPress');
  await p.click('#penSetupSave');
  const saved = JSON.parse(await p.evaluate(() => localStorage.getItem('notecomplete-pen-button')));
  assert.equal(saved.hoverMask, 1);
  assert.equal(saved.longPress, true);
  console.log('· View → Pen button… learns the button and saves it');
  // The opt-in long-press: the pen held still on the page opens the menu.
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0] + 90, y: at[1] + 60, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
  await p.waitForSelector('.quick-menu', { timeout: 2000 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0] + 90, y: at[1] + 60, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  await p.keyboard.press('Escape');
  console.log('· with the long-press on, holding the pen still opens it');
  // Help → Test pen and stylus lists what the pen reports.
  await p.evaluate(() => document.getElementById('penTestOpen').click());
  const padBox = await p.locator('#penTestPad').boundingBox();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: padBox.x + 40, y: padBox.y + 40, button: 'right', buttons: 2, clickCount: 1, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: padBox.x + 40, y: padBox.y + 40, button: 'right', buttons: 0, clickCount: 1, pointerType: 'pen' });
  assert.match(await p.textContent('#penTestLog'), /pointerdown · pen · button 2 · buttons 2/);
  await p.click('#penTestClose');
  console.log('· Help → Test pen and stylus shows what the pen reports');
  // Each tool keeps its own colour and width, also after a reload.
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  await p.evaluate(() => { const c = document.getElementById('color'); c.value = '#aa2200'; c.dispatchEvent(new Event('change')); const w = document.getElementById('width'); w.value = '8'; w.dispatchEvent(new Event('change')); });
  await p.evaluate(() => document.querySelector('[data-tool=highlight]').click());
  assert.notEqual(await p.inputValue('#color'), '#aa2200', 'the highlighter has its own colour');
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  assert.equal(await p.inputValue('#color'), '#aa2200');
  assert.equal(await p.inputValue('#width'), '8');
  await p.reload();
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.setInputFiles('#file', sample);
  await p.waitForFunction(() => document.querySelectorAll('.sheet [data-item]').length > 10);
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  assert.equal(await p.inputValue('#color'), '#aa2200', 'remembered after a reload');
  console.log('· each tool keeps its own colour and width');
  // View → Tool bar (Shift + T) hides the tools; the quick menu still has them.
  await p.evaluate(() => { document.activeElement?.blur(); });
  await p.keyboard.press('Shift+T');
  assert.equal(await p.isVisible('#toolbar .segmented'), false, 'tool bar hidden');
  assert.equal(await p.getAttribute('#toolsToggle', 'aria-checked'), 'false');
  await p.keyboard.press('Shift+S');
  await p.waitForSelector('.quick-menu');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Shift+T');
  assert.equal(await p.isVisible('#toolbar .segmented'), true, 'shown again');
  console.log('· Shift + T hides and shows the tool bar');
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
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
