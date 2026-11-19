// Browser check of the number keys (Chromium, after a web build): 1–9 choose the colour
// numbered on the tool's swatches (pen, highlighter), digits typed into a text box stay text,
// Ctrl 2 still changes tab; the Import, export and share window opens Export on Notes, Tab
// goes to the next section and 2 chooses its second item.
//   node tools/number_keys_e2e.mjs   (SHOTS=dir/ saves screenshots, in dark mode)
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.env.SHOTS || '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
try {
  const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  p.on('pageerror', (e) => errors.push(e.message));
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
  await p.locator('.sheet[data-page="0"] .render').waitFor(); await sleep(600);
  await p.evaluate(() => document.activeElement?.blur());
  const colour = () => p.evaluate(() => document.getElementById('color').value.toLowerCase());
  const nth = (n) => p.evaluate((n) => document.querySelectorAll('#toolOptions .choice-row[data-for="color"] button')[n - 1].dataset.value.toLowerCase(), n);
  const checked = () => p.evaluate(() => document.querySelector('#toolOptions .choice-row[data-for="color"] button[aria-checked="true"]')?.dataset.num);

  // Pen + 3: the third swatch, checked in the tool bar as a click would.
  await p.keyboard.press('p'); await sleep(200);
  await p.keyboard.press('3'); await sleep(150);
  assert.equal(await colour(), await nth(3), 'pen + 3: the third colour');
  assert.equal(await checked(), '3', 'the third swatch is checked');
  const nums = await p.evaluate(() => [...document.querySelectorAll('#toolOptions .choice-row[data-for="color"] button')].map((x) => x.dataset.num || ''));
  assert.deepEqual(nums.slice(0, 8), ['1', '2', '3', '4', '5', '6', '7', '8'], 'each swatch has its number');
  const ink = await p.evaluate(() => [...document.querySelectorAll('#toolOptions .choice-row[data-for="color"] button')].map((x) => x.style.getPropertyValue('--swatch-ink')));
  assert.equal(ink[0], '#ffffff', 'light digits on the black swatch');
  assert.equal(ink[6], '#1f2328', 'dark digits on the yellow swatch');
  // Drawing in it uses it.
  const s = await p.locator('.sheet[data-page="0"]').boundingBox();
  await p.mouse.move(s.x + 100, s.y + 100); await p.mouse.down();
  for (let i = 1; i < 8; i++) await p.mouse.move(s.x + 100 + i * 15, s.y + 120);
  await p.mouse.up(); await sleep(600);
  if (DIR) await p.locator('#toolbar').screenshot({ path: DIR + 'pen-colour-3.png' });
  console.log('· pen + 3 picks the third swatch, numbered');

  // Highlighter + 5.
  await p.keyboard.press('h'); await sleep(200);
  await p.keyboard.press('5'); await sleep(150);
  assert.equal(await colour(), await nth(5), 'highlighter + 5: the fifth colour');
  assert.equal(await checked(), '5');
  // The pen kept its own colour.
  await p.keyboard.press('p'); await sleep(200);
  assert.equal(await colour(), await nth(3), 'the pen keeps the third colour');
  console.log('· highlighter + 5 picks the fifth swatch; the pen keeps its own');

  // Digits typed into a text box are text, not colours.
  const before = await colour();
  await p.evaluate(() => document.querySelector('[data-tool=text]').click()); await sleep(400);
  await p.mouse.click(s.x + 200, s.y + 300);
  await p.waitForSelector('.text-editor');
  await p.keyboard.type('12345');
  assert.equal(await p.evaluate(() => document.querySelector('.text-editor').value), '12345', 'digits typed into the box');
  const textSwatchNums = await p.evaluate(() => getComputedStyle(document.querySelector('#textSwatches .swatch'), '::after').content);
  assert.equal(textSwatchNums, 'none', 'no numbers on the text colours while typing');
  await p.keyboard.press('Escape'); await sleep(800);
  await p.keyboard.press('p'); await sleep(200);
  assert.equal(await colour(), before, 'the pen colour is unchanged after typing digits');
  // The page number field takes digits too.
  await p.fill('#pageNumber', '1'); await p.focus('#pageNumber'); await p.keyboard.press('4');
  assert.equal(await colour(), before, 'digits in the page box are not colours');
  await p.press('#pageNumber', 'Escape'); await p.evaluate(() => document.activeElement?.blur());
  console.log('· digits in a text box and the page box stay text');

  // Ctrl 2 still changes tab, and leaves the colour as it is.
  await p.keyboard.press('Control+2'); await sleep(200);
  assert.deepEqual(await p.evaluate(() => window.tabCalls), [['activate', 2]], 'Ctrl 2: the second tab');
  assert.equal(await colour(), before, 'Ctrl 2 is not a colour');
  console.log('· Ctrl 2 still changes tab');

  // Eraser: no colours, no number keys (the colour stays).
  await p.keyboard.press('b'); await sleep(200);
  await p.keyboard.press('1'); await sleep(100);
  await p.keyboard.press('p'); await sleep(200);
  assert.equal(await colour(), before, 'the eraser has no number keys');

  // "?" mentions the colour keys.
  await p.keyboard.press('?'); await sleep(100);
  assert.match(await p.evaluate(() => document.getElementById('status').textContent), /1–9/, '? mentions 1–9');
  await p.keyboard.press('?');

  // The Import, export and share window: Export opens on Notes, even after Resources.
  await p.evaluate(() => { document.getElementById('exportOpen').click(); });
  await p.waitForSelector('#exportDialog[open]');
  await p.click('#exportTabExport');
  await p.click('#exportSubTabResources');
  await p.click('#exportClose');
  await p.evaluate(() => { document.getElementById('exportOpen').click(); });
  await p.waitForSelector('#exportDialog[open]'); await sleep(150);
  const view = () => p.evaluate(() => ({
    tab: document.querySelector('#exportDialog [data-export-tab][aria-selected="true"]').dataset.exportTab,
    sub: document.querySelector('#exportDialog [data-export-subtab][aria-selected="true"]').dataset.exportSubtab,
  }));
  assert.deepEqual(await view(), { tab: 'export', sub: 'notes' }, 'Export opens on Notes');
  const keys = await p.evaluate(() => [...document.querySelectorAll('#exportSubPanelNotes .export-item')].filter((x) => !x.hidden).map((x) => x.dataset.num || ''));
  assert.deepEqual(keys.slice(0, 3), ['1', '2', '3'], 'items numbered');
  if (DIR) await p.locator('#exportDialog').screenshot({ path: DIR + 'export-notes.png' });
  await p.keyboard.press('Tab'); await sleep(100);
  assert.deepEqual(await view(), { tab: 'export', sub: 'resources' }, 'Tab: Resources');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'exportSubTabResources', 'the focus on its tab');
  await p.keyboard.press('Tab'); await sleep(100);
  assert.equal((await view()).tab, 'open', 'Tab again: Open & Import');
  await p.keyboard.press('Shift+Tab'); await sleep(100);
  assert.deepEqual(await view(), { tab: 'export', sub: 'resources' }, 'Shift Tab: back to Resources');
  if (DIR) await p.locator('#exportDialog').screenshot({ path: DIR + 'export-resources.png' });
  // 2: the second item of Resources (Browse saved resources), and the window closes.
  await p.keyboard.press('2'); await sleep(500);
  assert.equal(await p.evaluate(() => document.getElementById('exportDialog').open), false, '2 chose an item and closed the window');
  assert.equal(await p.evaluate(() => !!document.querySelector('dialog[open]')), true, 'the saved resources opened');
  await p.keyboard.press('Escape'); await sleep(300);
  // Esc closes the window.
  await p.evaluate(() => { document.getElementById('exportOpen').click(); });
  await p.waitForSelector('#exportDialog[open]'); await sleep(100);
  await p.keyboard.press('Escape'); await sleep(200);
  assert.equal(await p.evaluate(() => document.getElementById('exportDialog').open), false, 'Esc closes it');
  console.log('· export window: Notes first, Tab and Shift Tab go round, 2 chooses, Esc closes');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('Number keys: OK');
  await b.close(); await server.close?.(); process.exit(0);
} catch (e) {
  console.error(e); console.error(errors);
  await b.close(); process.exit(1);
}
