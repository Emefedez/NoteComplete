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
  // Named in place, on the canvas.
  await p.waitForSelector('.uml-dialog .uml-rename');
  await p.fill('.uml-dialog .uml-rename', 'Lendable');
  await p.keyboard.press('Enter');
  await p.locator('.uml-dialog text:text-is("Lendable")').waitFor();
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
  // Right-click on an element: its menu, in the dialog (the page under it is inert).
  const lendBox = await p.locator('.uml-dialog [data-uml-kind="element"]:has(text:text-is("Lendable"))').boundingBox();
  await p.mouse.click(lendBox.x + lendBox.width / 2, lendBox.y + lendBox.height - 6, { button: 'right' });
  await p.waitForSelector('.uml-dialog .context-menu');
  const umlEntries = await p.locator('.context-menu button span').allTextContents();
  for (const e of ['Rename', 'Properties…', 'Connect to…', 'Duplicate', 'Delete']) assert.ok(umlEntries.includes(e), `element menu: ${umlEntries}`);
  await p.click('.context-menu button:has-text("Duplicate")');
  assert.equal(await p.locator('.uml-dialog [data-uml-kind="element"]').count(), before + 2, 'duplicated');
  // Delete, and fn + Backspace (Delete) or Backspace, remove the selection.
  await p.keyboard.press('Delete');
  assert.equal(await p.locator('.uml-dialog [data-uml-kind="element"]').count(), before + 1, 'Delete removes it');
  await p.click('.uml-dialog .uml-icon[aria-label="Undo"]');
  assert.equal(await p.locator('.uml-dialog [data-uml-kind="element"]').count(), before + 2, 'the undo icon');
  await p.mouse.click(lendBox.x + lendBox.width / 2 + 20, lendBox.y + lendBox.height + 14);
  await p.keyboard.press('Backspace');
  assert.equal(await p.locator('.uml-dialog [data-uml-kind="element"]').count(), before + 1, 'Backspace removes it');
  // Double-click: rename in place.
  await p.dblclick('.uml-dialog [data-uml-kind="element"]:has(text:text-is("Book"))');
  await p.waitForSelector('.uml-dialog .uml-rename');
  await p.keyboard.type('Volume');
  await p.keyboard.press('Enter');
  await p.locator('.uml-dialog text:text-is("Volume")').waitFor();
  console.log('· editor: right-click menu, Delete and Backspace, the undo icon, double-click to rename');
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
  // Nothing selected: the diagram's own settings, in the properties panel. A title, then Apply.
  await p.click('.uml-dialog .uml-tool[data-kind="select"]');
  if (await p.getAttribute('.uml-dialog .uml-icon[aria-label="Properties of the selection"]', 'aria-pressed') !== 'true') await p.click('.uml-dialog .uml-icon[aria-label="Properties of the selection"]');
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

  // 4. A node graph: drag a node's arrow handle to empty space (a new node, connected), and
  // from the new node to another (a connection); Arrange as tree lays it out.
  await q.goto(`${server.origin}/uml.html?diagram=graph`);
  await q.waitForSelector('.uml-canvas [data-uml-id]');
  const nodes = () => q.locator('.uml-canvas [data-uml-kind="element"]').count();
  const lines = () => q.locator('.uml-canvas [data-uml-kind="connector"]').count();
  const [n0, l0] = [await nodes(), await lines()];
  await q.click('.uml-canvas [data-uml-kind="element"]:has(text:text-is("15"))');
  const handle = await q.locator('.uml-canvas .uml-connect').boundingBox();
  const box = await q.locator('.uml-canvas').boundingBox();
  await q.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await q.mouse.down();
  await q.mouse.move(box.x + box.width - 80, box.y + box.height - 80, { steps: 10 });
  await q.mouse.up();
  assert.equal(await nodes(), n0 + 1, 'a new node where it was let go');
  assert.equal(await lines(), l0 + 1, 'connected to the one it came from');
  if (DIR) await q.screenshot({ path: `${DIR}grown.png` });
  await q.waitForFunction(() => document.activeElement?.classList.contains("uml-rename"));
  await q.keyboard.type("20");
  await q.keyboard.press("Enter");
  await q.locator('.uml-canvas text:text-is("20")').waitFor();
  const h2 = await q.locator('.uml-canvas .uml-connect').boundingBox();
  const seven = await q.locator('.uml-canvas [data-uml-kind="element"]:has(text:text-is("7"))').boundingBox();
  await q.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await q.mouse.down();
  await q.mouse.move(seven.x + seven.width / 2, seven.y + seven.height / 2, { steps: 10 });
  await q.mouse.up();
  assert.equal(await nodes(), n0 + 1, 'no node added when let go on one');
  assert.equal(await lines(), l0 + 2, 'connected to it');
  await q.keyboard.press('Escape');
  await q.mouse.click(box.x + 30, box.y + 30, { button: 'right' });
  await q.click('.context-menu button:has-text("Arrange as tree")');
  if (DIR) await q.screenshot({ path: `${DIR}graph.png` });
  console.log('· node graph: arrows dragged out of a node connect or grow it');

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
