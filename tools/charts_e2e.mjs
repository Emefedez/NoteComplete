// Browser check of the chart editor (Chromium, after a web build): Insert prefab → Process
// states opens the editor over the note; cells painted with a brush change the figure, and
// Insert puts it on the page. A scheduling exercise is inserted empty; right-click → Fill in
// paints the answer, Check marks what is wrong, and the page shows the answer. A bar is
// dragged to its value. While a dialog is open the tab strip still switches tabs and nothing
// is greyed out. The editor's own page (charts.html) opens every kind and keeps what is drawn.
//   node tools/charts_e2e.mjs [screenshots folder]
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
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  // A tab bridge as the desktop app gives: two tabs, and what is asked of it.
  // The figure as on the page, unfolded under the canvas (it starts folded).
  await p.addInitScript(() => { try { localStorage.setItem('notecomplete.chart.preview', JSON.stringify({ open: true, height: 240 })); } catch {} });
  await p.addInitScript(() => {
    const tabs = [{ id: 1, title: 'This note', current: true, active: true }, { id: 2, title: 'Other note', current: false }];
    window.tabCalls = [];
    window.notecompleteTabs = {
      list: async () => tabs, onList() {}, onCloseRequest() {}, closeSelf() {},
      activate: (id) => window.tabCalls.push(['activate', id]), open: () => window.tabCalls.push(['open']),
      close: (id) => window.tabCalls.push(['close', id]), move() {}, detach() {}, update: async () => {},
    };
  });
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(600);
  const ADDED = '.sheet[data-page="0"] .render [data-item^="image:"]';
  const pictures = () => p.locator(ADDED).count();

  // 1. Insert prefab → Process states: the chart editor, painted.
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  // The picker is a dialog: the tab strip still works, and nothing else is inert-free.
  const state = await p.evaluate(() => ({
    backdrop: getComputedStyle(document.querySelector('dialog[open]'), '::backdrop').backgroundColor,
    modal: document.querySelector('dialog[open]').matches(':modal'),
    stripInert: document.getElementById('tabStrip').closest('[inert]') !== null,
    pagesInert: document.querySelector('.sheet').closest('[inert]') !== null,
  }));
  assert.equal(state.modal, false, 'not in the top layer');
  assert.equal(state.stripInert, false, 'the tab strip is usable');
  assert.equal(state.pagesInert, true, 'the note under it is not');
  await p.click('#tabStrip .tab:has-text("Other note")');
  assert.deepEqual(await p.evaluate(() => window.tabCalls), [['activate', 2]], 'a click on a tab switches to it');
  if (DIR) await p.screenshot({ path: DIR + 'picker-with-tabs.png' });
  console.log('· a dialog leaves the tabs clickable, with no grey backdrop');

  await p.fill('.prefab-search', 'process states');
  await p.click('.prefab-card:has-text("Process states")');
  await p.waitForSelector('.chart-dialog .ch-grid');
  assert.equal(await p.locator('.sheet').first().evaluate((el) => el.closest('[inert]') !== null), true);
  const before = await p.locator('.chart-dialog .ch-preview svg line').count();
  // Shift S over the canvas: the brushes in a ring, over the dialog.
  const cbox = await p.locator('.chart-dialog .ch-canvas').boundingBox();
  await p.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  await p.keyboard.press('Shift+S');
  await p.waitForSelector('.quick-menu .qm-inner');
  const onTop = await p.evaluate(() => { const b = document.querySelector('.quick-menu .qm-inner').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.quick-menu') !== null; });
  assert.ok(onTop, 'the ring is drawn over the dialog');
  await p.click('.quick-menu .qm-inner[aria-label="Blocked"]');
  assert.equal(await p.getAttribute('.chart-dialog .ch-brush[aria-pressed="true"]', 'data-value'), 'blocked');
  const grid = await p.locator('.chart-dialog .ch-grid').boundingBox();
  const geo = await p.evaluate(() => {
    const g = document.querySelector('.chart-dialog .ch-grid');
    const lanes = [...g.querySelectorAll('.ch-lane')].map((r) => ({ y: +r.getAttribute('y'), h: +r.getAttribute('height'), x: +r.getAttribute('x'), w: +r.getAttribute('width') }));
    return { lanes, n: [...g.querySelectorAll('.ch-gl')].length - 1 };
  });
  const lane = geo.lanes[1], cw = lane.w / geo.n;
  const yB = grid.y + lane.y + lane.h / 2;
  await p.mouse.move(grid.x + lane.x + cw * 22.5, yB);
  await p.mouse.down();
  await p.mouse.move(grid.x + lane.x + cw * 27.5, yB, { steps: 6 });
  await p.mouse.up();
  const after = await p.locator('.chart-dialog .ch-preview svg line').count();
  assert.ok(after > before, `blocked hatching drawn in the figure (${before} → ${after} lines)`);
  // The Shift brush: dragged right from a painted cell, the rest of the row slides along.
  await p.click('.chart-dialog .ch-brush[data-value="@shift"]');
  const fig0 = await p.innerHTML('.chart-dialog .ch-preview svg');
  await p.mouse.move(grid.x + lane.x + cw * 22.5, yB);
  await p.mouse.down();
  await p.mouse.move(grid.x + lane.x + cw * 24.5, yB, { steps: 4 });
  await p.mouse.up();
  const lanesData = await p.evaluate(() => document.querySelector('.chart-dialog .ch-grid').innerHTML.length);
  assert.notEqual(await p.innerHTML('.chart-dialog .ch-preview svg'), fig0, 'Shift slid the row');
  // Ctrl + wheel zooms the time axis; the wheel alone changes the length.
  const gw = async () => (await p.locator('.chart-dialog .ch-grid').boundingBox()).width;
  const w0 = await gw();
  await p.mouse.move(grid.x + lane.x + cw * 10, yB);
  await p.keyboard.down('Control'); await p.mouse.wheel(0, -200); await p.keyboard.up('Control');
  await sleep(100);
  assert.ok(await gw() > w0 * 1.2, `Ctrl + wheel zooms in (${w0} → ${await gw()})`);
  assert.ok(lanesData > 0);
  // N: notes beside the figure, kept with it; the note's own notes panel stays shut.
  await p.click('.chart-dialog .ch-canvas', { position: { x: 4, y: 4 } });
  await p.keyboard.press('n');
  await p.waitForSelector('.chart-dialog .ch-notes .TinyMDE', { timeout: 10000 });
  assert.equal(await p.isVisible('#notesPanel'), false, 'the note\'s notes stay shut');
  await p.click('.chart-dialog .ch-notes .TinyMDE');
  await p.keyboard.type('A blocks at 22');
  await sleep(200);
  if (DIR) await p.screenshot({ path: DIR + 'states-editor.png' });
  await p.click('.chart-dialog button.primary');
  await p.waitForFunction((sel) => document.querySelectorAll(sel).length === 1, ADDED);
  assert.equal(await p.locator('.sheet').first().evaluate((el) => el.closest('[inert]') !== null), false, 'the note is usable again');
  console.log('· Insert prefab → Process states: painted in the editor, then on the page');

  // 2. Right-click: Edit process states… and Edit its data as JSON….
  const img = await p.locator(ADDED).first().boundingBox();
  await p.mouse.click(img.x + img.width / 2, img.y + img.height / 2, { button: 'right' });
  await p.waitForSelector('.context-menu');
  let entries = await p.locator('.context-menu button span').allTextContents();
  assert.ok(entries.includes('Edit process states…') && entries.includes('Edit its data as JSON…'), `entries: ${entries}`);
  assert.ok(entries.includes('Solve process states…'), `a premade figure can be solved: ${entries}`);
  // The JSON opens in the editor's own JSON view; a valid change shows at once.
  await p.click('.context-menu button:has-text("Edit its data as JSON")');
  await p.waitForSelector('.chart-dialog .ch-json:not([hidden])');
  assert.equal(await p.getAttribute('.chart-editor', 'data-mode'), 'json');
  const json = JSON.parse(await p.inputValue('.chart-dialog .ch-json'));
  assert.equal(json.notes, 'A blocks at 22', 'the notes are kept with the figure');
  await p.fill('.chart-dialog .ch-json', '{ "type": ');
  assert.equal(await p.locator('.chart-dialog button.primary').isDisabled(), true, 'invalid JSON cannot be applied');
  await p.fill('.chart-dialog .ch-json', JSON.stringify({ ...json, title: 'From JSON' }, null, 2));
  await p.waitForFunction(() => document.querySelector('.chart-dialog .ch-preview svg')?.textContent.includes('From JSON'));
  // Back to the editor: the grid, with the folding figure under it.
  await p.click('.chart-dialog .ch-mode button[aria-label="Editor"]');
  await p.waitForSelector('.chart-dialog .ch-grid');
  await p.click('.chart-dialog .ch-fold');
  assert.equal(await p.locator('.chart-dialog .ch-preview-box.open').count(), 0, 'the figure folds away');
  await p.click('.chart-dialog .ch-fold');
  await p.waitForSelector('.chart-dialog .ch-preview-box.open .ch-preview svg');
  // Both arrows on every process row.
  assert.ok(await p.locator('.chart-dialog .ch-rowedit button[aria-label="Move down"]').count() > 0, 'rows move down too');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.chart-dialog'));
  await sleep(200);

  // 3. A scheduling exercise: inserted empty, filled in, checked.
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  await p.fill('.prefab-search', 'scheduling exercise');
  await p.click('.prefab-card:has-text("Scheduling exercise")');
  await p.waitForSelector('.chart-dialog .ch-grid');
  assert.equal(await p.locator('.chart-dialog .ch-mode').isVisible(), true, 'Editor / Fill in');
  await p.click('.chart-dialog button.primary');
  await p.waitForFunction((sel) => document.querySelectorAll(sel).length === 2, ADDED);
  await sleep(400);
  const ex = await p.locator(ADDED).nth(1).boundingBox();
  await p.mouse.click(ex.x + ex.width / 2, ex.y + ex.height / 2, { button: 'right' });
  await p.waitForSelector('.context-menu');
  entries = await p.locator('.context-menu button span').allTextContents();
  assert.ok(entries.includes('Fill in process states…'), `entries: ${entries}`);
  assert.ok(entries.includes('Edit process states…'), `entries: ${entries}`);
  await p.click('.context-menu button:has-text("Fill in process states")');
  await p.waitForSelector('.chart-dialog .ch-grid');
  assert.equal(await p.getAttribute('.chart-editor', 'data-mode'), 'answer');
  // The exercise's page beside the canvas, to read its statement.
  await p.waitForSelector('.chart-dialog .ch-ref img');
  assert.match(await p.textContent('.chart-dialog .ch-ref figcaption'), /Page 1/);
  // Nothing is painted yet: the answer starts empty.
  assert.equal(await p.locator('.chart-dialog .ch-grid line[stroke="#2563eb"]').count(), 0);
  const g2 = await p.locator('.chart-dialog .ch-grid').boundingBox();
  const lanes2 = await p.evaluate(() => [...document.querySelectorAll('.chart-dialog .ch-lane')].map((r) => ({ y: +r.getAttribute('y'), h: +r.getAttribute('height'), x: +r.getAttribute('x'), w: +r.getAttribute('width') })));
  const cw2 = lanes2[0].w / 20, yA = g2.y + lanes2[0].y + lanes2[0].h / 2;
  // A: running 0–4 (right), then blocked 4–6 (half of it).
  await p.mouse.move(g2.x + lanes2[0].x + cw2 * 0.5, yA);
  await p.mouse.down();
  await p.mouse.move(g2.x + lanes2[0].x + cw2 * 3.5, yA, { steps: 4 });
  await p.mouse.up();
  await p.click('.chart-dialog .ch-brush[data-value="blocked"]');
  await p.mouse.move(g2.x + lanes2[0].x + cw2 * 4.5, yA);
  await p.mouse.down();
  await p.mouse.move(g2.x + lanes2[0].x + cw2 * 5.5, yA, { steps: 2 });
  await p.mouse.up();
  await p.click('.chart-dialog button:has-text("Check")');
  const said = await p.textContent('.chart-dialog .ch-status');
  assert.match(said, /^\d+ of 60 right/, said);
  assert.ok(await p.locator('.chart-dialog .ch-wrong').count() > 0, 'wrong cells marked');
  await p.click('.chart-dialog button[aria-label="Solution"]');
  if (DIR) await p.screenshot({ path: DIR + 'exercise-checked.png' });
  await p.click('.chart-dialog button.primary');
  await p.waitForFunction(() => !document.querySelector('.chart-dialog'));
  await sleep(500);
  assert.equal(await pictures(), 2, 'redrawn in place');
  if (DIR) await p.screenshot({ path: DIR + 'exercise-on-page.png' });
  console.log('· scheduling exercise: inserted empty, filled in, checked, the answer on the page');

  // 4. Escape cancels the editor, as it did the modal dialog.
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  await p.fill('.prefab-search', 'bar chart');
  await p.click('.prefab-card:has-text("Bar chart")');
  await p.waitForSelector('.chart-dialog .ch-bars');
  const bars = await p.locator('.chart-dialog .ch-bars').boundingBox();
  const col = await p.locator('.chart-dialog .ch-bar-hit').first().boundingBox();
  await p.mouse.move(col.x + col.width / 2, col.y + col.height * 0.5);
  await p.mouse.down();
  await p.mouse.move(col.x + col.width / 2, col.y + 4, { steps: 5 });
  await p.mouse.up();
  const top = await p.locator('.chart-dialog .ch-panel .ch-rowedit input[type="number"]').first().inputValue();
  assert.ok(Number(top) > 4, `the bar went up to ${top}`);
  assert.ok(bars.width > 300);
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.chart-dialog'));
  assert.equal(await pictures(), 2, 'Escape inserts nothing');
  console.log('· bar chart: a bar dragged to its value; Escape cancels');

  // 5. The editor's own page.
  const q = await b.newPage({ viewport: { width: 1100, height: 760 } });
  await q.addInitScript(() => { try { localStorage.setItem('notecomplete.chart.preview', JSON.stringify({ open: true, height: 240 })); } catch {} });
  q.on('pageerror', (e) => errors.push(`charts.html: ${e.message}`));
  for (const kind of ['timeline', 'bar', 'histogram', 'plot', 'states']) {
    await q.goto(`${server.origin}/charts.html?kind=${kind}`);
    await q.waitForSelector('.ch-preview svg');
    if (DIR) await q.screenshot({ path: `${DIR}page-${kind}.png` });
  }
  await q.fill('.ch-panel input[type="text"]', 'Round robin');
  await q.reload();
  await q.waitForSelector('.ch-preview svg');
  assert.equal(await q.inputValue('.ch-panel input[type="text"]'), 'Round robin', 'kept between visits');
  console.log('· charts.html: every kind opens, and what is drawn is kept');

  // 6. Brushes: number keys in their order, dragged into another order, and Shift S.
  await q.goto(`${server.origin}/charts.html?kind=states`);
  await q.waitForSelector('.ch-grid');
  await q.evaluate(() => localStorage.removeItem('notecomplete.palette.chart-states'));
  await q.reload();
  await q.waitForSelector('.ch-grid');
  const pressed = () => q.getAttribute('.ch-brush[aria-pressed="true"]', 'data-value');
  const keysShown = () => q.locator('.ch-brush kbd').allTextContents();
  assert.deepEqual(await keysShown(), ['1', '2', '3', '4', '5', '6']);
  await q.click('.ch-canvas');
  await q.keyboard.press('2');
  assert.equal(await pressed(), 'ready', '2 picks the second brush');
  const run = await q.locator('.ch-brush[data-value="run"]').boundingBox();
  const blocked = await q.locator('.ch-brush[data-value="blocked"]').boundingBox();
  await q.mouse.move(blocked.x + 30, blocked.y + blocked.height / 2);
  await q.mouse.down();
  await q.mouse.move(blocked.x + 30, run.y + 2, { steps: 10 });
  await q.mouse.up();
  const order = await q.$$eval('.ch-brush', (bs) => bs.map((b) => b.dataset.value));
  assert.equal(order[0], 'blocked', `dragged first: ${order}`);
  await sleep(100);
  await q.keyboard.press('1');
  assert.equal(await pressed(), 'blocked', '1 follows the new order');
  await q.reload();
  await q.waitForSelector('.ch-grid');
  assert.equal(await q.getAttribute('.ch-brush >> nth=0', 'data-value'), 'blocked', 'the order is kept');
  const canvasBox = await q.locator('.ch-canvas').boundingBox();
  await q.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + 80);
  await q.click('.ch-canvas', { position: { x: 5, y: canvasBox.height - 5 } });
  await q.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + 80);
  await q.keyboard.press('Shift+S');
  await q.waitForSelector('.quick-menu .qm-inner');
  assert.equal(await q.locator('.quick-menu .qm-inner').count(), 6, 'the brushes in a ring');
  const ringBg = await q.$eval('.quick-menu .qm-disc', (d) => getComputedStyle(d).position);
  assert.equal(ringBg, 'absolute', 'quick-menu.css is loaded on the own page');
  await q.click('.quick-menu .qm-inner[aria-label="Erase"]');
  assert.equal(await q.locator('.quick-menu').count(), 0);
  assert.equal(await pressed(), '', 'picked from the ring');
  if (DIR) await q.screenshot({ path: DIR + 'page-reordered.png' });
  // The UML editor: the same keys and ring.
  await q.goto(`${server.origin}/uml.html?diagram=class`);
  await q.waitForSelector('.uml-canvas [data-uml-id]');
  const first = await q.$eval('.uml-tools .uml-tool', (b) => b.dataset.type);
  await q.click('.uml-canvas', { position: { x: 5, y: 5 } });
  await q.keyboard.press('1');
  assert.equal(await q.getAttribute(`.uml-tools .uml-tool[data-type="${first}"]`, 'aria-pressed'), 'true', 'UML: 1 picks the first tool');
  await q.keyboard.press('Escape');
  await q.keyboard.press('Shift+S');
  await q.waitForSelector('.quick-menu .qm-inner');
  assert.equal(await q.locator('.quick-menu .qm-inner').count(), await q.locator('.uml-tools .uml-tool').count());
  await q.keyboard.press('Escape');
  assert.equal(await q.locator('.quick-menu').count(), 0);
  console.log('· palettes: number keys follow an order dragged by hand and kept; Shift S rings in both editors');
  assert.deepEqual(errors, []);
  console.log('charts e2e: ok');
} finally {
  await b.close();
  await server.close?.();
}
process.exit(0);
