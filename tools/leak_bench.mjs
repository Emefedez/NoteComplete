// Memory check of opening and closing the reader's heavier features (Chromium, after a web
// build): each one is opened and closed many times; after garbage collection, what is still
// alive (JS heap, DOM nodes, event listeners, documents) should not grow with the count.
// A feature whose leftovers grow by more than a small margin per cycle is reported.
//   node tools/leak_bench.mjs [cycles=12]
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const CYCLES = Number(process.argv[2]) || 12;
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await p.context().newCDPSession(p);
async function alive() {
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(60); }
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  const c = await cdp.send('Memory.getDOMCounters');
  return { heap: usedSize, nodes: c.nodes, listeners: c.jsEventListeners, documents: c.documents };
}

await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Practice book (vol. 1).noteful'));
await p.locator('.sheet[data-page="0"] .render').first().waitFor();
await p.fill('#pageNumber', '2'); await p.press('#pageNumber', 'Enter');
await sleep(1500);
const blur = () => p.evaluate(() => document.activeElement?.blur());
const escape = async (n = 2) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await sleep(120); } };
const sheet = async () => p.locator('.sheet[data-page="1"]').boundingBox();

const scenarios = {
  // What driving the page costs by itself (the protocol's own objects): the baseline.
  'Baseline (Escape only)': async () => { await p.keyboard.press('Escape'); await sleep(150); },
  'Insert prefab picker': async () => {
    await p.evaluate(() => document.getElementById('insertGraph').click());
    await p.locator('.prefab-grid').first().waitFor();
    await escape(1);
    await p.locator('.prefab-grid').first().waitFor({ state: 'detached' }).catch(() => {});
  },
  'Chart editor (histogram)': async () => {
    await p.evaluate(() => document.getElementById('insertGraph').click());
    await p.locator('.prefab-grid').first().waitFor();
    await p.click('.prefab-card:has(strong:text-is("Histogram"))');
    await p.locator('.chart-dialog .ch-canvas').first().waitFor();
    await p.click('.chart-dialog button:has-text("Cancel")');
    await p.locator('.chart-dialog').first().waitFor({ state: 'detached' }).catch(() => {});
  },
  'UML editor (class)': async () => {
    await p.evaluate(() => document.getElementById('insertUml').click());
    await p.locator('.prefab-grid, .uml-dialog').first().waitFor();
    if (await p.locator('.prefab-grid').count()) {
      await p.click('.prefab-card:has(strong:text-is("UML class"))');
      if (await p.locator('.prefab-editor[data-view="visual"]').count()) await p.click('.prefab-editor[data-view="visual"]');
    }
    await p.locator('.uml-dialog .uml-canvas svg').first().waitFor();
    await p.click('.uml-dialog button:has-text("Cancel")');
    await p.locator('.uml-dialog').first().waitFor({ state: 'detached' }).catch(() => {});
  },
  'Edit PDF on and off (outlines)': async () => {
    await blur();
    await p.keyboard.press('e');
    const s = await sheet();
    await p.mouse.move(s.x + s.width * 0.4, Math.max(s.y, 150) + 150);
    await p.locator('.sheet[data-page="1"] .pdf-edit-layer rect').first().waitFor();
    await p.keyboard.press('v');
    await sleep(100);
  },
  'Text box open and discard': async () => {
    await blur();
    await p.keyboard.press('w');
    const s = await sheet();
    await p.mouse.click(s.x + 150, Math.max(s.y, 150) + 400);
    await p.locator('.text-editor').first().waitFor({ state: 'attached' });
    await p.keyboard.type('x');
    await p.keyboard.press('Shift+Escape');
    await p.locator('.text-editor').first().waitFor({ state: 'detached' }).catch(() => {});
    await p.keyboard.press('v');
  },
  'Notes panel': async () => {
    await blur();
    await p.keyboard.press('Control+b'); await sleep(250);
    await p.keyboard.press('Control+b'); await sleep(150);
  },
  'Pages panel': async () => {
    await blur();
    await p.keyboard.press('Control+Alt+b'); await sleep(150);
    await p.keyboard.press('Control+Alt+b'); await sleep(150);
  },
  'Find bar': async () => {
    await blur();
    await p.keyboard.press('Control+f');
    await p.locator('#findBar:not([hidden])').first().waitFor();
    await p.keyboard.press('Control+f');
    await sleep(150);
  },
  'Command palette': async () => {
    await p.keyboard.press('Control+k');
    await p.locator('#paletteDialog[open]').first().waitFor();
    await escape(1);
  },
  'Page menu (right-click)': async () => {
    const s = await sheet();
    await p.mouse.click(s.x + 120, Math.max(s.y, 150) + 420, { button: 'right' });
    await p.locator('.context-menu').first().waitFor();
    await escape(1);
  },
};

const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
const report = [];
for (const [name, run] of Object.entries(scenarios)) {
  if (only && !only.test(name)) continue;
  try {
    for (let i = 0; i < 3; i++) await run();   // warm up: caches, lazy modules
    const before = await alive();
    for (let i = 0; i < CYCLES; i++) await run();
    const after = await alive();
    const per = (k) => (after[k] - before[k]) / CYCLES;
    const row = { name, heapKB: Math.round(per('heap') / 1024), nodes: Math.round(per('nodes') * 10) / 10, listeners: Math.round(per('listeners') * 10) / 10, documents: per('documents') };
    row.leak = row.heapKB > 64 || row.nodes > 4 || row.listeners > 1 || row.documents > 0;
    report.push(row);
    console.log(`${row.leak ? '✖' : '·'} ${name}: per cycle ${row.heapKB} KB heap, ${row.nodes} nodes, ${row.listeners} listeners, ${row.documents} documents`);
  } catch (e) {
    console.log(`? ${name}: ${e.message.split('\n')[0]}`);
    await escape(3);
  }
}
if (errors.length) console.log('page errors:', errors);
await b.close();
server.close?.();
process.exit(report.some((r) => r.leak) ? 1 : 0);
