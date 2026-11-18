// Browser check of the "window" prefab modules (Chromium, after a web build): the graph and
// table editors open as movable windows over the page, not modal. The graph window is dragged
// by its title bar (mouse and finger), stays inside the window, is resized from its corner and
// opens again where it was left; the page scrolls behind it; Esc leaves without changes;
// Insert puts the graph and the table on the page, and Edit graph… applies in place.
//   node tools/prefab_window_e2e.mjs [screenshots folder]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
try {
  const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark', hasTouch: true });
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('Practice book (vol. 1).noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(600);
  const ADDED = '.sheet[data-page="0"] .render [data-item^="new:"]';
  const items = () => p.locator(ADDED).count();
  const WIN = '.pk-window.compound-window';
  const box = async () => p.locator(WIN).boundingBox();

  // 1. Insert prefab → Function graph: a window over the page, not a modal dialog.
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  await p.click('.prefab-card:has(strong:text-is("Function graph"))');
  await p.waitForSelector(`${WIN} .graph-row input`);
  assert.equal(await p.textContent(`${WIN} .pk-window-title`), 'Insert graph');
  assert.equal(await p.evaluate(() => !!document.querySelector('dialog:modal')), false, 'not modal');
  if (DIR) await p.screenshot({ path: DIR + 'graph-window.png' });

  // 2. Dragged by its title bar with the mouse.
  const a = await box();
  const head = await p.locator(`${WIN} .pk-window-head`).boundingBox();
  await p.mouse.move(head.x + 60, head.y + head.height / 2);
  await p.mouse.down();
  await p.mouse.move(head.x - 200, head.y + 100, { steps: 6 });
  await p.mouse.up();
  const moved = await box();
  // Down as far as it fits (the keypad makes it tall): kept whole inside the window.
  assert.ok(Math.abs(moved.x - (a.x - 260)) < 3 && moved.y >= a.y && moved.y <= a.y + 100 - head.height / 2 + 1 && moved.y + moved.height <= 860, `moved: ${JSON.stringify([a, moved])}`);
  // Pushed far past the bottom right: it stays whole inside the window.
  const h2 = await p.locator(`${WIN} .pk-window-head`).boundingBox();
  await p.mouse.move(h2.x + 60, h2.y + 10);
  await p.mouse.down();
  await p.mouse.move(h2.x + 3000, h2.y + 3000, { steps: 4 });
  await p.mouse.up();
  const edge = await box();
  assert.ok(edge.x + edge.width <= 1280 && edge.y + edge.height <= 860 && edge.x >= 0, `kept inside: ${JSON.stringify(edge)}`);
  console.log('· the graph window is dragged by its title bar and stays inside the window');

  // 3. A finger drags it too (touch pointer events).
  const cdp = await p.context().newCDPSession(p);
  const h3 = await p.locator(`${WIN} .pk-window-head`).boundingBox();
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const [tx, ty] = [h3.x + 60, h3.y + h3.height / 2];
  await touch('touchStart', tx, ty);
  for (let i = 1; i <= 6; i++) await touch('touchMove', tx - 50 * i, ty - 40 * i);
  await touch('touchEnd');
  await sleep(100);
  const fingered = await box();
  assert.ok(fingered.x < edge.x - 200 && fingered.y < edge.y, `moved by a finger: ${JSON.stringify([edge, fingered])}`);
  console.log('· a finger drags it as well');

  // 4. Resized from its corner.
  const g = await p.locator(`${WIN} .pk-grip-rb`).boundingBox();
  await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await p.mouse.down();
  await p.mouse.move(g.x + 80, g.y + 60, { steps: 4 });
  await p.mouse.up();
  const sized = await box();
  assert.ok(sized.width > fingered.width + 50 && sized.height > fingered.height + 40, `resized: ${JSON.stringify([fingered, sized])}`);
  console.log('· resized from its corner');

  // 5. The page scrolls behind it (a wheel over the page, outside the window).
  const before = await p.evaluate(() => document.getElementById('viewport').scrollTop);
  const view = await p.locator('#viewport').boundingBox();
  const spot = [sized.x > view.x + 200 ? view.x + 100 : view.x + view.width - 100, view.y + view.height - 120];
  await p.mouse.move(...spot);
  await p.mouse.wheel(0, 600);
  await sleep(400);
  const after = await p.evaluate(() => document.getElementById('viewport').scrollTop);
  assert.ok(after > before + 100, `the page scrolled behind the window: ${before} → ${after}`);
  assert.ok(await p.locator(WIN).isVisible(), 'the window stays');
  await p.evaluate(() => { document.getElementById('viewport').scrollTop = 0; });
  await sleep(300);
  console.log('· the page scrolls behind the window');

  // 6. Esc leaves without changes; it opens again where it was left.
  await p.click(`${WIN} .graph-row input`);
  await p.keyboard.press('Escape');
  await p.waitForSelector(WIN, { state: 'detached' });
  assert.equal(await items(), 0, 'nothing inserted');
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  await p.click('.prefab-card:has(strong:text-is("Function graph"))');
  await p.waitForSelector(`${WIN} .graph-row input`);
  const again = await box();
  assert.ok(Math.abs(again.x - sized.x) < 2 && Math.abs(again.y - sized.y) < 2 && Math.abs(again.width - sized.width) < 2, `remembered: ${JSON.stringify([sized, again])}`);
  console.log('· Esc closes it unchanged; it opens again where it was left');

  // 7. Insert: the graph on the page as ink and text boxes.
  await p.fill(`${WIN} .graph-row input`, 'x^2 - 1');
  await sleep(200);
  assert.ok(await p.locator(`${WIN} .compound-preview polyline`).count() > 2, 'a live preview');
  await p.click(`${WIN} button.primary`);
  await p.waitForSelector(WIN, { state: 'detached' });
  await p.waitForFunction((sel) => document.querySelectorAll(sel).length > 3, ADDED);
  const graphItems = await items();
  if (DIR) await p.screenshot({ path: DIR + 'graph-inserted.png' });
  console.log(`· Insert puts the graph on the page (${graphItems} items)`);

  // 8. Edit graph… from its menu: the window with what it is; Apply redraws in place.
  const any = await p.locator(ADDED).first().boundingBox();
  await p.mouse.click(any.x + any.width / 2, any.y + any.height / 2, { button: 'right' });
  await p.waitForSelector('.context-menu');
  const entries = await p.locator('.context-menu button span').allTextContents();
  const edit = entries.find((e) => /^Edit graph/.test(e));
  assert.ok(edit, `edit entry: ${entries}`);
  await p.click(`.context-menu button:has-text("${edit}")`);
  await p.waitForSelector(`${WIN} .graph-row input`);
  assert.equal(await p.textContent(`${WIN} .pk-window-title`), 'Edit graph');
  assert.equal(await p.inputValue(`${WIN} .graph-row input`), 'x^2 - 1');
  assert.equal(await p.textContent(`${WIN} button.primary`), 'Apply');
  await p.click(`${WIN} .graph-add`);
  await p.locator(`${WIN} .graph-row input`).nth(1).fill('2x');
  await p.click(`${WIN} button.primary`);
  await p.waitForSelector(WIN, { state: 'detached' });
  await sleep(500);
  assert.ok((await items()) > graphItems, 'redrawn with the second function');
  console.log('· Edit graph… opens the window with its functions and applies in place');

  // 9. A table, in its own window.
  await p.keyboard.press('Escape');
  await p.evaluate(() => document.getElementById('insertTable').click());
  await p.waitForSelector(`${WIN} .table-grid input`);
  assert.equal(await p.textContent(`${WIN} .pk-window-title`), 'Insert table');
  assert.equal(await p.evaluate(() => !!document.querySelector('dialog:modal')), false, 'not modal');
  await p.fill(`${WIN} .table-grid input[data-r="0"][data-c="0"]`, 'x');
  await p.keyboard.press('Tab');
  await p.keyboard.type('y');
  if (DIR) await p.screenshot({ path: DIR + 'table-window.png' });
  const beforeTable = await items();
  await p.click(`${WIN} button.primary`);
  await p.waitForSelector(WIN, { state: 'detached' });
  await p.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [ADDED, beforeTable]);
  console.log('· Insert table: its window, then the table on the page');

  assert.deepEqual(errors, []);
  console.log('Window prefab modules: OK');
} finally {
  await b.close();
  await server.close?.();
}
process.exit(0);
