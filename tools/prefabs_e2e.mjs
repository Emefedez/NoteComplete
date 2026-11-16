// Browser check of prefabs and the menu at the pointer (Chromium, after a web build):
// Insert prefab → Histogram puts an editable figure on the page; a right-click on it opens its
// menu (Edit histogram…, Delete…) and editing it redraws it in one undo step; the selection's
// ⋯ circle opens the same menu; a right-click on the empty page offers to insert there; and
// Shift + right-click removes what is under the pointer at once.
//   node tools/prefabs_e2e.mjs [screenshots folder]
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
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(600);
  const ADDED = '.sheet[data-page="0"] .render :is([data-item^="new:"], [data-item^="image:"])';
  const items = () => p.locator(ADDED).count();

  // 1. Insert prefab: the picker lists the exam figures; a histogram goes on the page.
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  const cards = await p.locator('.prefab-card strong').allTextContents();
  for (const name of ['Function graph', 'Histogram', 'Bar chart', 'Process states', 'CPU timeline', 'Tree or node graph', 'Table'])
    assert.ok(cards.includes(name), `the picker offers ${name}: ${cards}`);
  if (DIR) await p.screenshot({ path: DIR + 'picker.png' });
  await p.click('.prefab-card:has-text("Histogram")');
  await p.waitForSelector('.prefab-dialog .prefab-data');
  assert.ok(await p.locator('.prefab-dialog .compound-preview-box svg').count(), 'a live preview');
  await p.fill('.prefab-dialog .prefab-title input', 'Notas del examen');
  await p.click('.prefab-dialog button.primary');
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .render :is([data-item^="new:"], [data-item^="image:"])').length === 2);
  if (DIR) await p.screenshot({ path: DIR + 'inserted.png' });
  console.log('· Insert prefab → Histogram: a picture and its frame on the page');

  // 2. Right-click on it: its menu; Edit histogram… opens the editor with its data; Apply redraws.
  const img = await p.locator('.sheet[data-page="0"] .render [data-item^="image:"]').first().boundingBox();
  const mid = [img.x + img.width / 2, img.y + img.height / 2];
  await p.mouse.click(...mid, { button: 'right' });
  await p.waitForSelector('.context-menu');
  const entries = await p.locator('.context-menu button span').allTextContents();
  assert.ok(entries.includes('Edit histogram…'), `edit entry: ${entries}`);
  assert.ok(entries.includes('Delete'), `delete entry: ${entries}`);
  assert.equal(await p.locator('.context-menu button > :first-child:is(svg, i)').count(), entries.length, 'every entry has an icon');
  assert.ok(entries.includes('Export'), `export entry: ${entries}`);
  await p.hover('.context-menu button:has-text("Export")');
  await p.waitForSelector('.context-submenu');
  const exportEntries = await p.locator('.context-submenu button span').allTextContents();
  assert.ok(exportEntries.includes('Download PNG') && exportEntries.includes('Send by QR…'), `export menu: ${exportEntries}`);
  const [png] = await Promise.all([p.waitForEvent('download'), p.click('.context-submenu button:has-text("Download PNG")')]);
  assert.match(png.suggestedFilename(), /Histogram\.png$/);
  await p.mouse.click(...mid, { button: 'right' });
  await p.waitForSelector('.context-menu');
  if (DIR) await p.screenshot({ path: DIR + 'menu.png' });
  await p.click('.context-menu button:has-text("Edit histogram")');
  await p.waitForSelector('.prefab-dialog');
  assert.equal(await p.inputValue('.prefab-dialog .prefab-title input'), 'Notas del examen', 'the editor has what it is');
  await p.fill('.prefab-dialog .prefab-title input', 'Notas finales');
  await p.click('.prefab-dialog button.primary');
  await p.waitForFunction(() => !document.querySelector('.prefab-dialog'));
  await sleep(500);
  assert.equal(await items(), 2, 'redrawn in place, not added');
  await p.keyboard.press('Control+z');
  await sleep(500);
  assert.equal(await items(), 2, 'one undo brings the one before back');
  console.log('· right-click → Edit histogram…: edited and redrawn in one undo step');

  // 3. Selected: the ⋯ circle opens the same menu.
  await p.mouse.click(...mid, { button: 'right' });
  await p.waitForSelector('.context-menu');
  await p.click('.context-menu button:has-text("Move, resize or rotate")');
  await p.waitForSelector('.selection-overlay .selection-menu');
  const dots = await p.locator('.selection-overlay .selection-menu').boundingBox();
  await p.mouse.click(dots.x + dots.width / 2, dots.y + dots.height / 2);
  await p.waitForSelector('.context-menu');
  assert.ok((await p.locator('.context-menu button span').allTextContents()).includes('Edit histogram…'));
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.context-menu'));
  // Escape again lets go of the selection.
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.selection-overlay'));
  console.log('· the selection’s ⋯ opens its menu; Escape lets go of it');

  // 4. The empty page: insert here, the quick menu, undo.
  const sheet = await p.locator('.sheet').first().boundingBox();
  await p.mouse.click(sheet.x + sheet.width * 0.5, Math.min(mid[1] + img.height / 2 + 120, 860), { button: 'right' });
  await p.waitForSelector('.context-menu');
  const pageEntries = await p.locator('.context-menu button span').allTextContents();
  for (const e of ['Insert prefab here…', 'Insert shape', 'Type text here', 'Insert image…', 'Export this page', 'Undo', 'Customize this menu…']) assert.ok(pageEntries.includes(e), `page menu: ${pageEntries}`);
  assert.ok(!pageEntries.includes('Quick menu') && !pageEntries.includes('Insert UML diagram here…'), `page menu: ${pageEntries}`);
  // Resting on Insert prefab here…: the ones used last.
  await p.hover('.context-menu:not(.context-submenu) button:has-text("Insert prefab here")');
  await p.waitForSelector('.context-submenu');
  assert.ok((await p.locator('.context-submenu button span').allTextContents()).includes('Histogram'), 'recently used');
  // Insert shape → Rectangle: one more item, where it was asked.
  const before = await items();
  await p.hover('.context-menu:not(.context-submenu) button:has-text("Insert shape")');
  await p.click('.context-submenu button:has-text("Rectangle")');
  await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] .render :is([data-item^="new:"], [data-item^="image:"])').length === n + 1, before);
  // Its menu: colour, thickness and opacity, changed in place.
  const rectBox = await p.locator('.sheet[data-page="0"] .render [data-item^="new:"]').last().boundingBox();
  await p.mouse.click(rectBox.x + 2, rectBox.y + rectBox.height / 2, { button: 'right' });
  await p.waitForSelector('.context-menu');
  const shapeEntries = await p.locator('.context-menu button span').allTextContents();
  for (const e of ['Colour', 'Thickness', 'Opacity', 'Export']) assert.ok(shapeEntries.includes(e), `shape menu: ${shapeEntries}`);
  await p.hover('.context-menu:not(.context-submenu) button:has-text("Colour")');
  await p.waitForSelector('.context-submenu .context-swatch');
  if (DIR) await p.screenshot({ path: DIR + 'colour.png' });
  await p.click('.context-submenu button:has-text("Red")');
  await p.waitForFunction(() => [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="new:"]')].pop()?.innerHTML.toLowerCase().includes('#d13b2f') || [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="new:"] [stroke]')].some((e) => /209, ?59, ?47|d13b2f/i.test(e.getAttribute('stroke'))), null, { timeout: 5000 });
  await p.keyboard.press('Control+z');
  await sleep(400);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+z');
  await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] .render :is([data-item^="new:"], [data-item^="image:"])').length === n, before);
  // Customize: add the quick menu and a prefab of one's own; kept.
  await p.mouse.click(sheet.x + sheet.width * 0.5, Math.min(mid[1] + img.height / 2 + 120, 860), { button: 'right' });
  await p.click('.context-menu button:has-text("Customize this menu")');
  await p.waitForSelector('.menu-config');
  await p.selectOption('.menu-config select', 'quick');
  await p.click('.menu-config button:has-text("Add")');
  await p.selectOption('.menu-config select', 'prefab:timeline');
  await p.click('.menu-config button:has-text("Add")');
  await p.click('.menu-config li[data-id="export"] button[aria-label="Remove"]');
  await p.click('.menu-config button.primary');
  await p.mouse.click(sheet.x + sheet.width * 0.5, Math.min(mid[1] + img.height / 2 + 120, 860), { button: 'right' });
  await p.waitForSelector('.context-menu');
  const mine = await p.locator('.context-menu button span').allTextContents();
  assert.ok(mine.includes('Quick menu') && !mine.includes('Export this page') && mine.some((e) => /^Insert CPU/.test(e)), `customized: ${mine}`);
  await p.keyboard.press('Escape');
  await p.evaluate(() => localStorage.removeItem('notecomplete-page-menu'));
  console.log('· right-click on the page: insert prefab (recent ones), shape, text, image, export; customizable');

  // 4b. Resized with Select: drawn again at the new size (a new picture, not stretched), still
  // selected, in one undo step.
  await p.mouse.click(...mid, { button: 'right' });
  await p.click('.context-menu button:has-text("Move, resize or rotate")');
  await p.waitForSelector('.selection-overlay [data-selection-handle="2"]');
  const imageNow = () => p.evaluate(() => { const i = document.querySelector('.sheet[data-page="0"] .render [data-item^="image:"] image'); const r = i.getBoundingClientRect(); return { href: i.getAttribute('href')?.slice(0, 80) + i.getAttribute('href')?.length, w: r.width, h: r.height }; });
  const old = await imageNow();
  const corner = await p.locator('[data-selection-handle="2"]').boundingBox();
  await p.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await p.mouse.down();
  await p.mouse.move(corner.x + corner.width / 2 + 90, corner.y + corner.height / 2 + 90, { steps: 8 });
  await p.mouse.up();
  await p.waitForFunction((h) => { const i = document.querySelector('.sheet[data-page="0"] .render [data-item^="image:"] image'); return i && i.getAttribute('href')?.slice(0, 80) + i.getAttribute('href')?.length !== h; }, old.href, { timeout: 10000 });
  const grown = await imageNow();
  assert.ok(grown.w > old.w + 40, `bigger: ${old.w} → ${grown.w}`);
  assert.ok(Math.abs(grown.w / grown.h - old.w / old.h) < 0.03, `same proportions: ${old.w / old.h} vs ${grown.w / grown.h}`);
  assert.equal(await items(), 2, 'redrawn in place, not added');
  await p.waitForSelector('.selection-overlay');
  await p.keyboard.press('Control+z');
  await p.waitForFunction((w) => Math.abs(document.querySelector('.sheet[data-page="0"] .render [data-item^="image:"] image').getBoundingClientRect().width - w) < 2, old.w);
  await p.keyboard.press('Escape');
  console.log('· a resized prefab is drawn again at its new size, in one undo step');

  // 5. Shift + right-click: removed at once, as right-click did before.
  await p.keyboard.down('Shift');
  await p.mouse.click(...mid, { button: 'right' });
  await p.keyboard.up('Shift');
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .render :is([data-item^="new:"], [data-item^="image:"])').length < 2);
  assert.equal(await p.locator('.context-menu').count(), 0, 'no menu');
  console.log('· Shift + right-click removes what is under the pointer');

  assert.deepEqual(errors, []);
  console.log('prefabs and the menu at the pointer: OK');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
