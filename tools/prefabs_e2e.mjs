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
  assert.equal(await p.locator('.context-menu button svg').count(), entries.length, 'every entry has an icon');
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
  assert.ok(pageEntries.includes('Insert prefab here…') && pageEntries.includes('Quick menu'), `page menu: ${pageEntries}`);
  await p.keyboard.press('Escape');
  console.log('· right-click on the page: insert here, quick menu, undo');

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
