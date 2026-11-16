// Browser check of UML diagrams (Chromium, after a web build): Insert prefab → UML class
// diagram opens the diagram editor; a class placed from the palette and Insert put the
// diagram on the page as a picture with its frame; a right-click on it offers Edit UML class
// diagram…, which reopens the editor with the diagram, and Apply redraws it in one undo step.
// The editor's own page (uml.html) opens with no errors and keeps what is drawn.
//   node tools/uml_e2e.mjs [screenshots folder]
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
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(600);
  const ADDED = '.sheet[data-page="0"] .render :is([data-item^="new:"], [data-item^="image:"])';
  const items = () => p.locator(ADDED).count();

  // 1. The picker has a card per UML diagram kind; the class one opens the editor.
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  const cards = await p.locator('.prefab-card strong').allTextContents();
  for (const name of ['UML use case', 'UML class', 'UML state machine', 'UML activity', 'UML sequence']) assert.ok(cards.includes(name), `the picker offers ${name}: ${cards}`);
  if (DIR) await p.screenshot({ path: DIR + 'picker.png' });
  await p.click('.prefab-card:has-text("UML class")');
  await p.waitForSelector('.uml-dialog .uml-canvas svg [data-uml-id]');
  await sleep(300);
  const before = await p.locator('.uml-dialog [data-uml-kind="element"]').count();
  await p.click('.uml-dialog .uml-tool[data-type="interface"]');
  const canvas = await p.locator('.uml-dialog .uml-canvas').boundingBox();
  await p.mouse.click(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.6);
  await p.fill('.uml-dialog .uml-name', 'Lendable');
  assert.equal(await p.locator('.uml-dialog [data-uml-kind="element"]').count(), before + 1, 'placed from the palette');
  // Connect Book to the interface with a realization.
  await p.click('.uml-dialog .uml-tool[data-type="realization"]');
  const book = await p.locator('.uml-dialog [data-uml-kind="element"]:has(text:text-is("Book"))').boundingBox();
  const lend = await p.locator('.uml-dialog [data-uml-kind="element"]:has(text:text-is("Lendable"))').boundingBox();
  await p.mouse.move(book.x + book.width / 2, book.y + 12);
  await p.mouse.down();
  await p.mouse.move(lend.x + lend.width / 2, lend.y + lend.height / 2, { steps: 8 });
  await p.mouse.up();
  assert.equal(await p.locator('.uml-dialog [data-uml-kind="connector"]').count(), 3, 'connected');
  if (DIR) await p.screenshot({ path: DIR + 'editor.png' });
  await p.click('.uml-dialog button.primary');
  await p.waitForFunction((sel) => document.querySelectorAll(sel).length === 2, ADDED);
  assert.equal(await p.locator('.uml-dialog').count(), 0);
  if (DIR) await p.screenshot({ path: DIR + 'inserted.png' });
  console.log('· Insert prefab → UML class: drawn in the editor, then on the page');

  // 2. Right-click: Edit UML class diagram… reopens it with what it is.
  const img = await p.locator('.sheet[data-page="0"] .render [data-item^="image:"]').first().boundingBox();
  const mid = [img.x + img.width / 2, img.y + img.height / 2];
  await p.mouse.click(...mid, { button: 'right' });
  await p.waitForSelector('.context-menu');
  const entries = await p.locator('.context-menu button span').allTextContents();
  assert.ok(entries.includes('Edit UML class diagram…'), `edit entry: ${entries}`);
  await p.click('.context-menu button:has-text("Edit UML class diagram")');
  await p.waitForSelector('.uml-dialog [data-uml-id]');
  assert.equal(await p.locator('.uml-dialog [data-uml-kind="element"]').count(), before + 1, 'the editor has the diagram');
  assert.equal(await p.locator('.uml-dialog [data-uml-kind="connector"]').count(), 3);
  // Nothing selected: the diagram's own settings. A title, then Apply.
  await p.click('.uml-dialog .uml-tool[data-kind="select"]');
  await p.fill('.uml-dialog .uml-panel input[placeholder^="Shown above"]', 'Library');
  await p.click('.uml-dialog button.primary');
  await p.waitForFunction(() => !document.querySelector('.uml-dialog'));
  await sleep(500);
  assert.equal(await items(), 2, 'redrawn in place, not added');
  await p.keyboard.press('Control+z');
  await sleep(500);
  assert.equal(await items(), 2, 'one undo brings the one before back');
  console.log('· right-click → Edit UML class diagram…: reopened and redrawn in one undo step');

  // 3. The editor's own page.
  const q = await b.newPage({ viewport: { width: 1100, height: 760 } });
  q.on('pageerror', (e) => errors.push(`uml.html: ${e.message}`));
  await q.goto(`${server.origin}/uml.html?diagram=state`);
  await q.waitForSelector('.uml-canvas [data-uml-id]');
  assert.equal(await q.inputValue('.uml-kind'), 'state');
  for (const kind of ['useCase', 'activity', 'sequence']) {
    await q.goto(`${server.origin}/uml.html?diagram=${kind}`);
    await q.waitForSelector('.uml-canvas [data-uml-id]');
    if (DIR) await q.screenshot({ path: `${DIR}page-${kind}.png` });
  }
  await q.reload();
  await q.waitForSelector('.uml-canvas [data-uml-id]');
  assert.equal(await q.inputValue('.uml-kind'), 'sequence', 'kept between visits');
  console.log('· uml.html: every kind opens, and what is drawn is kept');

  assert.deepEqual(errors, []);
  console.log('UML diagrams: OK');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
