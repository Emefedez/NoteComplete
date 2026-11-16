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
  await p.click('.chart-dialog .ch-brush[data-value="blocked"]');
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
  await p.keyboard.press('Escape');
  await sleep(200);

  // 3. A scheduling exercise: inserted empty, filled in, checked.
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  await p.fill('.prefab-search', 'scheduling exercise');
  await p.click('.prefab-card:has-text("Scheduling exercise")');
  await p.waitForSelector('.chart-dialog .ch-grid');
  assert.equal(await p.locator('.chart-dialog .ch-mode').isVisible(), true, 'Solution / Fill in');
  await p.click('.chart-dialog button.primary');
  await p.waitForFunction((sel) => document.querySelectorAll(sel).length === 2, ADDED);
  await sleep(400);
  const ex = await p.locator(ADDED).nth(1).boundingBox();
  await p.mouse.click(ex.x + ex.width / 2, ex.y + ex.height / 2, { button: 'right' });
  await p.waitForSelector('.context-menu');
  entries = await p.locator('.context-menu button span').allTextContents();
  assert.ok(entries.includes('Fill in process states…'), `entries: ${entries}`);
  assert.ok(entries.includes('Edit process states (solution)…'), `entries: ${entries}`);
  await p.click('.context-menu button:has-text("Fill in process states")');
  await p.waitForSelector('.chart-dialog .ch-grid');
  assert.equal(await p.getAttribute('.chart-editor', 'data-mode'), 'answer');
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
  assert.match(said, /^\d+ of 40 right/, said);
  assert.ok(await p.locator('.chart-dialog .ch-wrong').count() > 0, 'wrong cells marked');
  await p.click('.chart-dialog button:has-text("Show solution")');
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
  assert.deepEqual(errors, []);
  console.log('charts e2e: ok');
} finally {
  await b.close();
  await server.close?.();
}
process.exit(0);
