// Browser check of the algorithms module (apps/reader/prefabs/algorithms; Chromium, after a
// web build): Insert prefab lists the algorithms as "Topic: Algorithm" cards; a card opens the
// player in a movable window; play, step, the keys and the timeline move through the steps
// with the code line, variables and changes following; the catalog is grouped and searched;
// a new input runs it again; "Show this step on the page" puts that step on the page; its menu
// opens it again at that step.
//   node tools/algorithms_e2e.mjs [screenshots folder]
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
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.locator('.sheet[data-page="0"] .render').waitFor();
  await sleep(500);
  const IMAGES = '.sheet[data-page="0"] .render [data-item^="image:"]';

  // 1. The picker: an Algorithms group, cards named "Topic: Algorithm".
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.locator('.prefab-grid').waitFor();
  await p.click('.prefab-picker [data-group="algorithms"]');
  const cards = await p.locator('.prefab-card strong').allTextContents();
  for (const c of ['Greedy: Dijkstra', 'Greedy: Prim', 'Graphs: Breadth-first search', 'Maps: HashMap (chaining and rehash)', 'Dynamic programming: 0/1 knapsack']) assert.ok(cards.includes(c), `the picker offers ${c}: ${cards}`);
  assert.deepEqual(cards, [...cards].sort((x, y) => x.localeCompare(y)), 'grouped by topic, alphabetical');
  await sleep(400);
  if (DIR) await p.screenshot({ path: DIR + 'picker.png' });
  console.log('· Insert prefab → Algorithms: the cards, by topic and name');

  // 2. The player in a movable window.
  await p.click('.prefab-card:has(strong:text-is("Greedy: Dijkstra"))');
  const win = p.locator('.pk-window.pk-module-window');
  await win.locator('.alg-stage svg').waitFor();
  assert.equal(await p.locator('.pk-dialog').count(), 0, 'not a modal dialog');
  const count = () => win.locator('.alg-count').textContent();
  const caption = () => win.locator('.alg-caption').textContent();
  const line = () => win.locator('.alg-line.on').getAttribute('data-line').catch(() => null);
  assert.match(await count(), /^1 \/ \d+$/);
  const total = Number((await count()).split('/')[1]);
  await sleep(300);
  await win.locator('.alg-controls button[aria-label="Step forward (→)"]').click();
  assert.match(await count(), /^2 \//);
  assert.match(await caption(), /source A is at distance 0/);
  assert.ok(await line(), 'the code line is marked');
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  assert.match(await count(), /^4 \//, 'arrow keys step');
  await p.keyboard.press('ArrowLeft');
  assert.match(await count(), /^3 \//);
  await p.keyboard.press('End');
  assert.equal(await count(), `${total} / ${total}`);
  assert.match(await caption(), /^Done\. Shortest distances from A: A 0, B 3, C 2, D 8, E 10, F 12/);
  await p.keyboard.press('Home');
  assert.match(await count(), /^1 \//);
  // Play, then pause with Space.
  await win.locator('.alg-speed select').selectOption('4');
  await p.keyboard.press('Space');
  await sleep(1300);
  await p.keyboard.press('Space');
  const played = Number((await count()).split('/')[0]);
  assert.ok(played > 2, `it played (${played})`);
  await sleep(500);
  assert.equal(Number((await count()).split('/')[0]), played, 'and paused');
  // Scrub the timeline to step 14.
  await win.locator('.alg-timeline').evaluate((el) => { el.value = '13'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.match(await count(), /^14 \//);
  assert.ok(await win.locator('.alg-vars dt').count() > 0, 'variables shown');
  await sleep(700);
  if (DIR) await p.screenshot({ path: DIR + 'player-dijkstra.png' });
  console.log('· the player: step, arrows, Home/End, play/pause, speed, scrub; code line and variables follow');

  // 3. The catalog: search, topics, and another algorithm.
  await win.locator('.alg-search').fill('heap');
  const found = await win.locator('.alg-item strong').allTextContents();
  assert.deepEqual(found, ['Heaps: Heapsort', 'Heaps: Insert and remove the maximum']);
  assert.deepEqual(await win.locator('.alg-heading').allTextContents(), ['Heaps']);
  await win.locator('.alg-search').fill('');
  const headings = await win.locator('.alg-heading').allTextContents();
  assert.deepEqual(headings, [...headings].sort((x, y) => x.localeCompare(y)));
  await win.locator('.alg-item[data-algorithm="heapsort"]').click();
  assert.match(await win.locator('.pk-title').textContent(), /Heaps: Heapsort/);
  await win.locator('.alg-timeline').evaluate((el) => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.keyboard.press('ArrowRight');
  await sleep(700);
  if (DIR) await p.screenshot({ path: DIR + 'player-heapsort.png' });
  console.log('· the catalog: grouped headings, search, another algorithm');

  // 4. Input: the knapsack with new items runs again; a broken one is said.
  await win.locator('.alg-search').fill('knapsack');
  await win.locator('.alg-item[data-algorithm="knapsack"]').click();
  await win.locator('.alg-tabs button[data-tab="input"]').click();
  const items = win.locator('.alg-side textarea');
  await items.fill('Gold 4 10\nSilver 3 7');
  await win.locator('.alg-side .pk-field:has-text("Capacity") input').fill('5');
  await p.keyboard.press('End');
  await win.locator('.alg-stage').click();
  await p.keyboard.press('End');
  assert.match(await caption(), /Best value 10 with Gold/);
  await items.fill('Gold four 10');
  assert.match(await win.locator('.pk-status').textContent(), /Not an item/);
  await items.fill('Gold 4 10\nSilver 3 7\nBronze 1 4');
  assert.equal(await win.locator('.pk-status').textContent(), '');
  await win.locator('.alg-stage').click();
  await p.keyboard.press('End');
  assert.match(await caption(), /Best value 14 with Gold, Bronze/);
  console.log('· input: a new input runs it again; a broken one is said and goes when fixed');

  // 5. A graph input: Dijkstra from another vertex, the drawing follows the edge list.
  await win.locator('.alg-tabs button[data-tab="catalog"]').click();
  await win.locator('.alg-search').fill('');
  await win.locator('.alg-item[data-algorithm="bfs"]').click();
  await win.locator('.alg-tabs button[data-tab="input"]').click();
  await win.locator('.alg-side textarea').fill('A-B\nB-C\nC-D\nA-E');
  assert.equal(await win.locator('.alg-draw .v').count(), 5, 'the drawing follows the text');
  const v = await win.locator('.alg-draw .v[data-id="C"]').boundingBox();
  await p.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
  await p.mouse.down();
  await p.mouse.move(v.x + v.width / 2 + 40, v.y + v.height / 2 + 20, { steps: 5 });
  await p.mouse.up();
  await win.locator('.pk-panel').click({ position: { x: 5, y: 5 } });
  await p.keyboard.press('End');
  assert.match(await caption(), /breadth-first order A, B, E, C, D/);
  await win.locator('.alg-side select').first().selectOption('C');
  await p.keyboard.press('End');
  assert.match(await caption(), /breadth-first order C, B, D, A, E/);
  if (DIR) await p.screenshot({ path: DIR + 'player-graph-input.png' });
  // Undo goes back to the start vertex A.
  await win.locator('.pk-bar button[aria-label^="Undo"]').click();
  await p.keyboard.press('End');
  assert.match(await caption(), /breadth-first order A, B, E, C, D/);
  console.log('· graph input: edge list, drag a vertex, start vertex; undo');

  // With a screenshots folder: every algorithm in the player, at its middle step.
  if (DIR) {
    await win.locator('.alg-tabs button[data-tab="catalog"]').click();
    for (const id of await win.locator('.alg-item').evaluateAll((els) => els.map((e) => e.dataset.algorithm))) {
      await win.locator(`.alg-item[data-algorithm="${id}"]`).click();
      const n = Number((await count()).split('/')[1]);
      await win.locator('.alg-timeline').evaluate((el, at) => { el.value = String(at); el.dispatchEvent(new Event('input', { bubbles: true })); }, Math.floor(n / 2) - 1);
      await p.keyboard.press('ArrowRight');
      await sleep(650);
      await win.screenshot({ path: `${DIR}algo-${id}.png` });
    }
  }

  // 6. Back to Dijkstra; step 14 on the page.
  await win.locator('.alg-tabs button[data-tab="catalog"]').click();
  await win.locator('.alg-item[data-algorithm="dijkstra"]').click();
  await win.locator('.alg-timeline').evaluate((el) => { el.value = '13'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const shown = await caption();
  const before = await p.locator(IMAGES).count();
  await win.locator('button:has-text("Show this step on the page")').click();
  await win.waitFor({ state: 'detached' });
  await p.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [IMAGES, before]);
  await sleep(500);
  if (DIR) await p.screenshot({ path: DIR + 'page.png' });
  console.log('· "Show this step on the page": inserted');

  // 7. Its menu opens it again at that step.
  const img = await p.locator(IMAGES).last().boundingBox();
  await p.mouse.click(img.x + img.width / 2, img.y + img.height / 2, { button: 'right' });
  await p.locator('.context-menu').waitFor();
  const entries = await p.locator('.context-menu button span').allTextContents();
  assert.ok(entries.includes('Edit Greedy: Dijkstra…'), `its menu: ${entries}`);
  await p.click('.context-menu button:has-text("Edit Greedy: Dijkstra")');
  await win.locator('.alg-stage svg').waitFor();
  assert.match(await count(), /^14 \//, 'at the step it shows');
  assert.equal(await caption(), shown);
  assert.equal(await win.locator('.pk-bar .pk-button.primary').textContent(), 'Apply');
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('Control+Enter');
  await win.waitFor({ state: 'detached' });
  await sleep(300);
  assert.equal(await p.locator(IMAGES).count(), before + 1, 'applied in place');
  console.log('· edited again from its menu at its step; Ctrl Enter applies the next one');

  // 8. The module's own menu entries: Edit code… (large, read only), Edit input…, Play….
  const menuOn = async () => {
    const box = await p.locator(IMAGES).last().boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await p.locator('.context-menu').waitFor();
  };
  await menuOn();
  const more = await p.locator('.context-menu button span').allTextContents();
  for (const entry of ['Play…', 'Edit input…', 'Edit code…']) assert.ok(more.includes(entry), `its menu: ${more}`);
  await p.click('.context-menu button:has-text("Edit code…")');
  // Dijkstra has a Java version: Edit code… opens it as a program of your own.
  await win.locator('.alg-code-edit textarea').waitFor();
  const asJava = await win.locator('.alg-code-edit textarea').inputValue();
  assert.match(asJava, /public class Algorithm/);
  assert.match(asJava, /dijkstra\(Graph<T, Integer> graph, Vertex<T> source\)/);
  await p.keyboard.press('Escape');
  await win.waitFor({ state: 'detached' });
  await menuOn();
  await p.click('.context-menu button:has-text("Edit Greedy: Dijkstra")');
  await win.locator('.alg-stage svg').waitFor();
  // A long line: scrolled sideways so its text is in sight, or wrapped on request.
  await win.locator('.alg-timeline').evaluate((el) => { el.value = '13'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(300);
  const sideways = await win.locator('.alg-code').evaluate((el) => { const on = el.querySelector('.alg-line.on code'); const r = on.getBoundingClientRect(), box = el.getBoundingClientRect(); const indent = on.textContent.match(/^\s*/)[0].length * (r.width / on.textContent.length); return { start: r.left + indent - box.left, width: box.width, scrolls: el.scrollWidth > el.clientWidth }; });
  assert.ok(sideways.start >= 0 && sideways.start < sideways.width - 40, `the line's text is in sight: ${JSON.stringify(sideways)}`);
  if (DIR) await p.screenshot({ path: DIR + 'edit-code.png' });
  await win.locator('.alg-wrap input').check();
  assert.equal(await win.locator('.alg-code').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'wrapped: no sideways scroll');
  await win.locator('.alg-wrap input').uncheck();
  await p.keyboard.press('Escape');
  await win.waitFor({ state: 'detached' });
  await menuOn();
  await p.click('.context-menu button:has-text("Edit input…")');
  await win.locator('.alg-tabs button[data-tab="input"][aria-selected="true"]').waitFor();
  await p.keyboard.press('Escape');
  await win.waitFor({ state: 'detached' });
  await menuOn();
  await p.click('.context-menu button:has-text("Play…")');
  await win.locator('.alg-stage svg').waitFor();
  await sleep(2600);
  assert.ok(Number((await count()).split('/')[0]) > 1, 'it plays from the start');
  await p.keyboard.press('Escape');
  await win.waitFor({ state: 'detached' });
  console.log('· its menu: Play…, Edit input…, Edit code… (as Java); long lines in sight, wrap');

  // 9. A narrow window: the panels still fit (and resize by their grips).
  await p.setViewportSize({ width: 980, height: 720 });
  await menuOn();
  await p.click('.context-menu button:has-text("Edit Greedy: Dijkstra")');
  await win.locator('.alg-stage svg').waitFor();
  await sleep(400);
  assert.ok(await win.locator('.panel-grip').count() >= 2, 'the side panels have grips');
  if (DIR) await p.screenshot({ path: DIR + 'player-narrow.png' });
  await p.keyboard.press('Escape');
  await win.waitFor({ state: 'detached' });
  console.log('· a narrow window');

  // 10. Java: a program of your own, run in the worker, stepped, put on the page, and opened
  // again from its menu (Edit code…) with its source; a compile error points at its line;
  // a built-in runs its Java version.
  await p.setViewportSize({ width: 1400, height: 900 });
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.locator('.prefab-grid').waitFor();
  await p.click('.prefab-card:has(strong:text-is("Sorting: Quicksort"))');
  await win.locator('.alg-stage svg').waitFor();
  await win.locator('.alg-tabs button[data-tab="catalog"]').click();
  await win.locator('.alg-new-java').click();
  const javaArea = win.locator('.alg-code-edit textarea');
  await javaArea.waitFor();
  const PROGRAM = `public class Count {
  public static int sum(int[] values) {
    int total = 0;
    for (int i = 0; i < values.length; i++) {
      total += values[i];
    }
    return total;
  }
}
`;
  await javaArea.fill(PROGRAM);
  await win.locator('.alg-side .pk-field:has-text("Entry") input').fill('Count.sum');
  await win.locator('.alg-side .pk-field:has-text("Arguments") input').fill('[[4, 8, 15, 16]]');
  await win.locator('.alg-run').click();
  await p.waitForFunction(() => /Ran in/.test(document.querySelector('.pk-window .pk-status')?.textContent || ''));
  assert.match(await win.locator('.pk-status').textContent(), /returned 43/);
  assert.ok(await win.locator('.alg-code .alg-line').count() >= 9, 'the run shows its code');
  assert.match(await win.locator('.pk-title').textContent(), /Java: Count\.sum/);
  for (let k = 0; k < 6; k++) await p.keyboard.press('ArrowRight');
  assert.ok(Number(await win.locator('.alg-code .alg-line.on').getAttribute('data-line')) >= 3, 'the step marks its line');
  assert.ok(await win.locator('.alg-vars dt').count() > 0, 'its locals');
  if (DIR) await p.screenshot({ path: DIR + 'java-run.png' });
  const javaCaption = await caption();
  const before2 = await p.locator(IMAGES).count();
  await win.locator('button:has-text("Show this step on the page")').click();
  await win.waitFor({ state: 'detached' });
  await p.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [IMAGES, before2]);
  console.log('· New from Java…: written, run in the worker, stepped, put on the page');
  await menuOn();
  await p.click('.context-menu button:has-text("Edit code…")');
  await win.locator('.alg-code-edit textarea').waitFor();
  assert.equal(await win.locator('.alg-code-edit textarea').inputValue(), PROGRAM, 'its source came back');
  assert.equal(await caption(), javaCaption, 'at its step');
  // A compile error: said with its line, marked in the pane.
  await win.locator('.alg-code-edit textarea').fill(PROGRAM.replace('int total = 0;', 'int total = ;'));
  await win.locator('.alg-tabs button[data-tab="input"]').click();
  await win.locator('.alg-run').click();
  await win.locator('.alg-code-error:not([hidden])').waitFor();
  assert.match(await win.locator('.alg-code-error').textContent(), /line 3/);
  assert.equal(await win.locator('.alg-line.error').getAttribute('data-line'), '3');
  if (DIR) await p.screenshot({ path: DIR + 'java-error.png' });
  await p.keyboard.press('Escape');
  await win.waitFor({ state: 'detached' });
  console.log('· Edit code… opens its source; a compile error points at its line');
  // A built-in through its Java version.
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.locator('.prefab-grid').waitFor();
  await p.click('.prefab-card:has(strong:text-is("Recursion: Factorial"))');
  await win.locator('.alg-stage svg').waitFor();
  const jsSteps = Number((await count()).split('/')[1]);
  await win.locator('.alg-tabs button[data-tab="input"]').click();
  await win.locator('.alg-side label:has-text("Run the Java version") input').check();
  await p.waitForFunction((n) => Number(document.querySelector('.pk-window .alg-count').textContent.split('/')[1]) !== n, jsSteps);
  await p.keyboard.press('End');
  assert.match(await win.locator('.alg-vars').textContent() + await caption(), /120|return/);
  if (DIR) await p.screenshot({ path: DIR + 'java-builtin.png' });
  await p.keyboard.press('Escape');
  await win.waitFor({ state: 'detached' });
  console.log('· a built-in runs its Java version');
  assert.deepEqual(errors, []);
  console.log('Algorithms: OK');
} catch (e) {
  console.error(e);
  console.error('page errors:', errors);
  await b.close();
  process.exit(1);
}
await b.close();
process.exit(0);
