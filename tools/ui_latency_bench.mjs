// UI latency benchmark: how long the interface takes to answer a tap, at a tablet-like CPU
// (CDP CPU throttling, 4× by default). For menus, tool buttons, dialogs and tabs it measures
// from the pointer going down to the first frame painted with the answer on screen (a menu
// open, a tool pressed, a dialog showing), and lists them slowest first.
//   node tools/ui_latency_bench.mjs [file] [--cpu 4] [--runs 3] [--json out.json] [--only text]
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, startReader } from './e2e_common.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const cpu = Number(flag('--cpu', 4));
const runs = Number(flag('--runs', 3));
const jsonOut = flag('--json', '');
const only = flag('--only', '');
const file = args[0] || 'samples/Practice book (vol. 1).noteful';

const server = await startReader();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
p.on('pageerror', (e) => console.error('pageerror', e.message));
await p.addInitScript(() => {
  let down = 0, taps = 0;
  addEventListener('pointerdown', (e) => { down = e.timeStamp; taps++; }, true);
  addEventListener('keydown', (e) => { down = e.timeStamp; taps++; }, true);
  // Resolves with the time from the last pointer down (or key) to the paint of the first frame
  // in which `test` holds.
  window.__until = (src, timeout = 15000) => new Promise((resolve) => {
    const test = new Function(`return (${src})`);
    const start = performance.now(), before = taps;
    const tick = () => {
      // Only once the measured tap has come: what already held before it does not count.
      let ok = false; if (taps > before) try { ok = !!test(); } catch {}
      // A message posted from the frame's callback arrives once that frame is painted.
      if (ok) return requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(Math.round(performance.now() - down)); ch.port2.postMessage(0); });
      if (performance.now() - start > timeout) return resolve(-1);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
});
await p.goto(server.origin + '/');
await p.waitForFunction(() => !document.getElementById('open').disabled);
const bytes = readFileSync(new URL(`../${file}`, import.meta.url));
await p.route('**/__bench_file', (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
await p.evaluate(async () => {
  const buf = await (await fetch('/__bench_file')).arrayBuffer();
  const input = document.getElementById('file');
  const dt = new DataTransfer(); dt.items.add(new File([buf], 'bench.noteful')); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForFunction(() => document.querySelector('.sheet[data-page="0"] .render svg'), null, { timeout: 120000 });
await p.waitForTimeout(2500);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

const visible = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })()`;
const menu = (id) => `#${id} > summary`;
const openMenu = (id) => async () => { await p.click(menu(id)); await p.waitForSelector(`#${id}[open] .menu-content`); await p.waitForTimeout(150); };
// Escape, and then close what a dialog left open (some keep themselves open on Escape).
const esc = async () => { for (let i = 0; i < 3; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(60); } await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); }); await p.waitForTimeout(250); };

async function clickAt(sel) {
  const target = p.locator(sel).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw Error(`${sel} not on screen`);
  if (await target.isDisabled()) throw Error(`${sel} is disabled`);
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(40);
  await p.mouse.down(); await p.mouse.up();
}

// One measured tap: `click` (a selector, or a function that clicks or presses keys) until `done` holds.
async function tap(click, done) {
  const wait = p.evaluate((src) => window.__until(src), done);
  await p.waitForTimeout(30);
  // Raw mouse events at the element's centre: Playwright's own click checks the hit target
  // inside the page on pointer down, which a throttled CPU would count against the app.
  if (typeof click === 'string') await clickAt(click); else await click();
  return wait;
}

const steps = [];
for (const id of ['fileMenu', 'editMenu', 'viewMenu', 'pagesMenu', 'studyMenu', 'helpMenu']) {
  steps.push({ name: `menu ${id.replace('Menu', '')} open`, click: menu(id), done: visible(`#${id}[open] .menu-content`), after: esc });
}
steps.push({ name: 'menu hop File → Edit (hover)', before: openMenu('fileMenu'), click: async () => { await p.mouse.move(0, 0); const r = await p.locator(menu('editMenu')).boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await p.mouse.down(); await p.mouse.up(); }, done: visible('#editMenu[open] .menu-content'), after: esc });
for (const tool of ['select', 'draw', 'highlight', 'erase', 'tape', 'grab', 'text', 'shape', 'pan']) {
  const other = tool === 'pan' ? 'select' : 'pan';
  steps.push({ name: `tool ${tool}`, click: `#toolbar [data-tool="${tool}"]`, done: `document.querySelector('#toolbar [data-tool="${tool}"]').getAttribute('aria-pressed') === 'true'`, after: async () => { await p.evaluate((t) => document.querySelector(`#toolbar [data-tool="${t}"]`).click(), other); } });
}
steps.push({ name: 'tool by key P', click: () => p.keyboard.press('p'), done: `document.querySelector('#toolbar [data-tool="draw"]').getAttribute('aria-pressed') === 'true'`, after: async () => { await p.evaluate(() => document.querySelector('#toolbar [data-tool="pan"]').click()); } });
const dialog = (name, menuId, button, shown) => steps.push({ name, before: menuId && openMenu(menuId), click: `#${button}`, done: visible(shown), after: esc });
dialog('dialog Import/export', 'fileMenu', 'exportOpen', '#exportDialog');
dialog('dialog Insert prefab', 'editMenu', 'insertGraph', '.prefab-grid');
dialog('dialog Find', 'editMenu', 'findOpen', '#findBar');
dialog('dialog Go to page', 'pagesMenu', 'gotoPage', 'dialog[open]');
dialog('dialog Display quality', 'viewMenu', 'qualityOpen', 'dialog[open]');
dialog('dialog Shortcuts', 'helpMenu', 'shortcutsOpen', 'dialog[open]');
dialog('dialog Lag log', 'viewMenu', 'lagLogOpen', 'dialog[open]');
dialog('command palette', null, 'paletteOpen', 'dialog[open], .palette:not([hidden])');
steps.push({ name: 'export dialog tab switch', before: async () => { await openMenu('fileMenu')(); await p.click('#exportOpen'); await p.waitForSelector('#exportDialog[open]'); await p.waitForTimeout(300); }, click: '#exportTabExport', done: `document.querySelector('#exportTabExport').getAttribute('aria-selected') === 'true' || document.querySelector('#exportTabExport').getAttribute('aria-pressed') === 'true' || document.querySelector('#exportTabExport').classList.contains('active')`, after: esc });
steps.push({ name: 'right-click menu on a page', click: async () => { const r = await p.locator('.sheet[data-page="0"]').boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + Math.min(r.height, 500) / 2); await p.waitForTimeout(40); await p.mouse.click(r.x + r.width / 2, r.y + Math.min(r.height, 500) / 2, { button: 'right' }); }, done: visible('.context-menu'), after: esc });
steps.push({ name: 'chat panel', click: '#chatToggle', done: visible('#chatPanel, .chat-panel'), after: async () => { await p.click('#chatToggle').catch(() => {}); await esc(); } });
steps.push({ name: 'home', click: '#homeButton', done: visible('#home, .home'), after: async () => { await p.click('#homeButton').catch(() => {}); await p.keyboard.press('Escape'); await p.waitForTimeout(400); } });

const swatch = (n) => `#toolOptions .swatches[data-for="color"] > :nth-child(${n})`;
steps.push({ name: 'pen settings: colour tap', before: async () => { await p.evaluate((sel) => { document.querySelector('#toolbar [data-tool="draw"]').click(); document.querySelector(sel)?.click(); }, swatch(1)); await p.waitForTimeout(300); }, click: swatch(3), done: `document.querySelector(${JSON.stringify(swatch(3))}).getAttribute('aria-checked') === 'true'`, after: async () => { await p.evaluate(() => document.querySelector('#toolbar [data-tool="pan"]').click()); } });

const results = [];
for (const s of steps) {
  if (only && !s.name.includes(only)) continue;
  const times = [];
  for (let i = 0; i < runs; i++) {
    try {
      if (s.before) await s.before();
      times.push(await tap(s.click, s.done));
    } catch (e) { times.push(-1); console.error(s.name, e.message.split('\n')[0]); }
    try { if (s.after) await s.after(); } catch {}
    await p.waitForTimeout(200);
  }
  const ok = times.filter((t) => t >= 0).sort((a, c) => a - c);
  results.push({ step: s.name, median: ok.length ? ok[ok.length >> 1] : -1, max: ok.length ? ok.at(-1) : -1, failed: times.length - ok.length });
}
results.sort((a, c) => c.median - a.median);
console.log(`file ${file}, CPU ×${cpu}, ${runs} runs each (ms from the tap to the frame that shows the answer)`);
console.table(results);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
await b.close();
process.exit(0);
