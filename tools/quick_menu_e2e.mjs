// Browser check of the quick menu (Chromium): Shift + S held over the pages, pointed at a tool
// and let go chooses it; Shift + S pressed, a tool tapped shows its settings; a held tool moves on
// the ring; 1–9 choose tools;
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
  await p.click('.quick-menu .qm-outer[aria-label^="4 px"]');
  assert.equal(await p.inputValue('#width'), '4');
  assert.equal(await p.getAttribute('.quick-menu .qm-outer[aria-label^="4 px"]', 'aria-pressed'), 'true');
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
    const xs = [...document.querySelectorAll('.quick-menu .qm-outer[aria-label*=" px"]')].map((b) => b.getBoundingClientRect().x);
    return { colours: ys('.quick-menu .qm-swatch'), widths: ys('.quick-menu .qm-outer[aria-label*=" px"]'), xs };
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
  // An order saved before Grab was on the ring (checked after the reload).
  await p.evaluate(() => localStorage.setItem('notecomplete-quick-order', JSON.stringify(['pan', 'select', 'draw', 'highlight', 'erase', 'shape', 'text', 'tape'])));
  await p.reload();
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.setInputFiles('#file', sample);
  await p.waitForFunction(() => document.querySelectorAll('.sheet [data-item]').length > 10);
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  assert.equal(await p.inputValue('#color'), '#aa2200', 'remembered after a reload');
  console.log('· each tool keeps its own colour and width');
  // Widths in px: right-click one in the tool bar (or hold it) to set its value; the quick
  // menu shows the same presets and edits them the same way.
  await p.evaluate(() => { document.querySelector('[data-tool=draw]').click(); });
  if (!(await p.isVisible('.choice-row[data-for="width"]'))) await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.choice-row[data-for="width"] button')].map((b) => b.getAttribute('aria-label'))), ['1 px', '2 px', '4 px', '8 px']);
  await p.click('.choice-row[data-for="width"] button >> nth=1', { button: 'right' });
  await p.waitForSelector('#widthDialog[open]');
  await p.fill('#widthValue', '3.5');
  await p.click('#widthSave');
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.choice-row[data-for="width"] button')].map((b) => b.getAttribute('aria-label'))), ['1 px', '3.5 px', '4 px', '8 px']);
  assert.equal(await p.inputValue('#width'), '3.5', 'the edited width is in use');
  await p.keyboard.press('Shift+S');
  await p.waitForSelector('.quick-menu');
  assert.ok(await p.locator('.quick-menu .qm-outer[aria-label^="3.5 px"]').count(), 'the quick menu shows it');
  const w = await p.locator('.quick-menu .qm-outer[aria-label^="8 px"]').boundingBox();
  await p.mouse.move(w.x + 18, w.y + 18); await p.mouse.down(); await sleep(450); await p.mouse.up();
  await p.waitForSelector('#widthDialog[open]');
  await p.fill('#widthValue', '12');
  await p.click('#widthSave');
  assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem('notecomplete-widths'))).draw, [1, 3.5, 4, 12]);
  await p.keyboard.press('Escape');
  console.log('· widths in px: held or right-clicked in the bar or the menu to change them');
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
  // Holding the menu's × does the same, and the menu stays; a tap on it closes the menu.
  { const sh = await p.locator('.sheet').first().boundingBox(); await p.mouse.move(sh.x + 300, sh.y + 300); }
  await p.keyboard.press('Shift+S');
  await p.waitForSelector('.quick-menu .qm-centre');
  const holdCentre = async () => {
    const c = await p.locator('.quick-menu .qm-centre').boundingBox();
    await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await p.mouse.down(); await sleep(450); await p.mouse.up();
    await sleep(100);
  };
  await holdCentre();
  assert.equal(await p.isVisible('#toolbar .segmented'), false, 'held ×: tool bar hidden');
  assert.equal(await p.locator('.quick-menu').count(), 1, 'the menu stays open');
  await holdCentre();
  assert.equal(await p.isVisible('#toolbar .segmented'), true, 'held again: shown');
  assert.equal(await p.locator('.quick-menu').count(), 1, 'still open');
  await sleep(450);
  await p.click('.quick-menu .qm-centre');
  await p.waitForFunction(() => !document.querySelector('.quick-menu'));
  console.log('· holding the menu’s × shows or hides the tool bar; a tap closes the menu');
  // Grab is on the ring with the tool bar's icon, added at the end of an order saved before it.
  await p.keyboard.press('Shift+S');
  await p.waitForSelector('.quick-menu');
  assert.deepEqual(await ringOrder(), ['Pan', 'Select', 'Pen', 'Highlighter', 'Eraser', 'Shapes', 'Text', 'Tape', 'Grab']);
  assert.equal(await p.getAttribute('.quick-menu .qm-inner[aria-label="Grab"] svg path', 'd'), await p.getAttribute('#toolbar [data-tool="grab"] svg path', 'd'), 'the tool bar\'s icon');
  await p.click('.quick-menu .qm-inner[aria-label="Grab"]');
  assert.equal(await tool(p), 'grab');
  assert.equal(await p.locator('.quick-menu').count(), 0, 'Grab has no settings: the menu closes');
  assert.equal(await p.locator('.grab-rect').count(), 0, 'choosing Grab starts no grab');
  await p.keyboard.press('Shift+S'); await p.keyboard.press('1'); await p.keyboard.press('Shift+S'); await p.keyboard.press('9');
  assert.equal(await tool(p), 'grab', '9 chooses the ninth tool');
  console.log('· Grab is on the ring (also added to an order saved before it), 9 chooses it');
  // A region grabbed; then the menu opened every way with Grab on: no new box and no new
  // grab, and the grabbed region keeps its box and its menu.
  const page0 = await p.locator('.sheet[data-page="0"]').boundingBox();
  const region = { x: page0.x + page0.width * 0.05, y: page0.y + page0.height * 0.1, w: page0.width * 0.4, h: page0.height * 0.12 };
  await p.mouse.move(region.x, region.y); await p.mouse.down(); await p.mouse.move(region.x + region.w, region.y + region.h, { steps: 8 }); await p.mouse.up();
  await p.waitForSelector('#grabMenu:not([hidden])');
  await p.evaluate(() => {
    window.grabProbe = { rect: document.querySelector('.grab-rect'), added: 0 };
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('grab-rect')) window.grabProbe.added++; }).observe(document.body, { childList: true, subtree: true });
  });
  const grabKept = async (how) => {
    await p.waitForSelector('.quick-menu', { timeout: 3000 });
    await sleep(150);
    const state = () => p.evaluate(() => ({ added: window.grabProbe.added, boxes: document.querySelectorAll('.grab-rect').length, same: window.grabProbe.rect.isConnected, menu: !document.getElementById('grabMenu').hidden }));
    assert.deepEqual(await state(), { added: 0, boxes: 1, same: true, menu: true }, how);
    assert.equal(await tool(p), 'grab', how);
    await p.keyboard.press('Escape');
    await sleep(100);
    assert.deepEqual(await state(), { added: 0, boxes: 1, same: true, menu: true }, `${how}, closed`);
  };
  const free = [page0.x + page0.width * 0.6, Math.min(page0.y + page0.height * 0.5, 600)];
  const penAt = (type, x, y, extra) => cdp.send('Input.dispatchMouseEvent', { type, x, y, clickCount: 1, pointerType: 'pen', ...extra });
  await p.mouse.move(...free);
  await p.keyboard.press('Shift+S'); await grabKept('Shift + S');
  await p.keyboard.down('Shift'); await p.mouse.click(...free, { button: 'right' }); await p.keyboard.up('Shift'); await grabKept('Shift + right-click');
  await penAt('mousePressed', ...free, { button: 'left', buttons: 1, modifiers: 8 }); await penAt('mouseReleased', ...free, { button: 'left', buttons: 0, modifiers: 8 }); await grabKept('Shift + pen');
  await penAt('mousePressed', ...free, { button: 'right', buttons: 2 }); await penAt('mouseReleased', ...free, { button: 'right', buttons: 0 }); await grabKept('the pen\'s button on the page');
  await penAt('mouseMoved', free[0] + 10, free[1], { button: 'none', buttons: 0 }); await penAt('mouseMoved', free[0] + 12, free[1], { button: 'none', buttons: 1 }); await grabKept('the pen\'s button while hovering');
  await penAt('mouseMoved', free[0] + 14, free[1], { button: 'none', buttons: 0 });
  // The long-press saved above: a pen held still on the page.
  await penAt('mousePressed', ...free, { button: 'left', buttons: 1 }); await p.waitForSelector('.quick-menu', { timeout: 2000 }); await penAt('mouseReleased', ...free, { button: 'left', buttons: 0 }); await grabKept('the pen held still');
  // A second box being dragged when the menu opens goes away; the first grab stays.
  await p.mouse.move(...free); await p.mouse.down(); await p.mouse.move(free[0] + 80, free[1] + 60, { steps: 4 });
  assert.equal(await p.isVisible('#grabMenu'), false, 'a new box hides the last grab\'s menu');
  await p.keyboard.press('Shift+S');
  await p.evaluate(() => { window.grabProbe.added = 0; });
  await grabKept('Shift + S while dragging a box');
  await p.mouse.up();
  console.log('· with Grab on, every way of opening the menu starts no grab and keeps the grabbed region');
  // Select from the menu turns the grabbed region into the selection, as the tool bar's does.
  await p.keyboard.press('Shift+S');
  await p.click('.quick-menu .qm-inner[aria-label="Select"]');
  assert.equal(await tool(p), 'select');
  await p.waitForFunction(() => document.querySelector('.selection-overlay'), null, { timeout: 15000 });
  assert.match(await p.textContent('#selectionKind'), /^Group/);
  assert.equal(await p.locator('.grab-rect').count(), 0, 'no grab box left');
  assert.equal(await p.isVisible('#grabMenu'), false, 'no grab menu left');
  // And back to Grab: ready to grab again.
  await p.keyboard.press('Shift+S');
  await p.click('.quick-menu .qm-inner[aria-label="Grab"]');
  assert.equal(await p.locator('.selection-overlay').count(), 0, 'the selection is let go');
  await p.mouse.move(region.x, region.y); await p.mouse.down(); await p.mouse.move(region.x + 150, region.y + 80, { steps: 6 }); await p.mouse.up();
  await p.waitForSelector('#grabMenu:not([hidden])');
  // Select from the menu with nothing grabbed: the tool, and no stale grab.
  await p.click('#grabCancel');
  await p.keyboard.press('Shift+S');
  await p.click('.quick-menu .qm-inner[aria-label="Select"]');
  assert.equal(await tool(p), 'select');
  assert.equal(await p.locator('.selection-overlay').count(), 0, 'nothing selected');
  console.log('· Select from the menu while in Grab: the grabbed region is selected, as with the tool bar');
  // A tool chosen in the menu leaves the tool bar's settings closed, chosen twice too; the
  // tool bar's own button still opens them.
  await p.evaluate(() => document.querySelector('#toolbar [data-tool=pan]').click());
  for (const [label, name] of [['Pen', 'draw'], ['Pen', 'draw'], ['Highlighter', 'highlight']]) {
    await p.keyboard.press('Shift+S');
    await p.click(`.quick-menu .qm-inner[aria-label="${label}"]`);
    assert.equal(await tool(p), name);
    assert.equal(await p.isVisible('#toolOptions'), false, `${label} chosen in the menu`);
    await p.keyboard.press('Escape');
    assert.equal(await p.isVisible('#toolOptions'), false, `${label} chosen in the menu, menu closed`);
  }
  await p.evaluate(() => document.querySelector('#toolbar [data-tool=highlight]').click());
  assert.equal(await p.isVisible('#toolOptions'), true, 'pressing the selected tool in the tool bar shows its settings');
  await p.evaluate(() => document.querySelector('#toolbar [data-tool=draw]').click());
  assert.equal(await p.isVisible('#pressureOptions'), true, 'a tool chosen in the tool bar shows its settings');
  console.log('· choosing a tool in the menu does not open its settings in the tool bar');
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
  // With Grab on: a region grabbed with a finger, then two fingers held (the first one
  // moving a little before the second lands) open the menu and start no grab; Select from
  // the menu selects the region.
  const touchErrors = []; t.on('pageerror', (e) => touchErrors.push(e.message));
  await t.keyboard.press('Escape');
  await t.evaluate(() => document.querySelector('[data-tool=grab]').click());
  const tp = await t.locator('.sheet[data-page="0"]').boundingBox();
  const from = [Math.round(tp.x + tp.width * 0.05), Math.round(tp.y + tp.height * 0.1)], to = [Math.round(tp.x + tp.width * 0.45), Math.round(tp.y + tp.height * 0.22)];
  await touch('touchStart', [from]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[from[0] + (to[0] - from[0]) * i / 8, from[1] + (to[1] - from[1]) * i / 8]]);
  await touch('touchEnd', []);
  await t.waitForSelector('#grabMenu:not([hidden])');
  await t.evaluate(() => {
    window.grabProbe = { rect: document.querySelector('.grab-rect'), added: 0 };
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('grab-rect')) window.grabProbe.added++; }).observe(document.body, { childList: true, subtree: true });
  });
  const touchState = () => t.evaluate(() => ({ added: window.grabProbe.added, boxes: document.querySelectorAll('.grab-rect').length, same: window.grabProbe.rect.isConnected, menu: !document.getElementById('grabMenu').hidden }));
  const hold = [Math.round(tp.x + tp.width * 0.4), Math.round(tp.y + tp.height * 0.4)];
  await touch('touchStart', [hold]); await touch('touchMove', [[hold[0] + 5, hold[1] + 3]]);
  await touch('touchStart', [[hold[0] + 5, hold[1] + 3], [hold[0] + 100, hold[1]]]);
  await sleep(800);
  assert.equal(await t.locator('.quick-menu').count(), 1, 'two fingers held open it with Grab on');
  await touch('touchEnd', []); await sleep(300);
  assert.deepEqual(await touchState(), { added: 0, boxes: 1, same: true, menu: true }, 'two fingers start no grab');
  assert.equal(await tool(t), 'grab');
  await t.locator('.quick-menu [aria-label="Select"]').tap();
  assert.equal(await tool(t), 'select');
  await t.waitForFunction(() => document.querySelector('.selection-overlay'), null, { timeout: 15000 });
  assert.equal(await t.locator('.grab-rect').count(), 0, 'no grab box left');
  assert.equal(await t.isVisible('#grabMenu'), false, 'no grab menu left');
  assert.deepEqual(touchErrors, []);
  console.log('· with Grab on, two fingers held open it and start no grab; Select from the menu selects the region');
  console.log('Quick menu end to end: passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
