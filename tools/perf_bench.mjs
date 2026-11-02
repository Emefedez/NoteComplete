// Performance and memory benchmark of the web reader (Chromium, after a web build).
// Opens a note, scrolls through every page, draws strokes, and reports time, main-thread
// work (CDP TaskDuration), the JS heap, DOM nodes and the memory of the whole browser
// (PSS of every Chromium process, so the engine's worker and WebAssembly are counted), also
// after a simulated memory-pressure signal (what stays once the browser drops its caches).
//   node tools/perf_bench.mjs [file ...] [--runs N] [--dpr 1|2] [--json out.json]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const runs = Number(flag('--runs', 3));
const dpr = Number(flag('--dpr', 1)); // the screen's pixel density (2 for tablets, phones, most laptops)
const jsonOut = flag('--json', '');
const root = new URL('../', import.meta.url);
const files = args.length ? args : ['samples/Practice book (vol. 1).noteful', 'samples/Examen wuolah.noteful', 'tests/fixtures/multi-audio-synthetic.noteful'];

// Proportional set size of a process tree, in MB (shared pages split between sharers).
function pss(rootPid) {
  const all = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number)) {
      if (all.has(pid)) continue;
      try {
        const ppid = Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
        if (all.has(ppid)) { all.add(pid); grew = true; }
      } catch { /* gone */ }
    }
  }
  let kb = 0;
  for (const pid of all) {
    try { kb += Number(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m)[1]); } catch { /* gone */ }
  }
  return kb / 1024;
}
const browserPid = (b) => {
  // Playwright does not expose it: the newest chromium whose command line has our user data dir.
  const out = execSync('ps -eo pid,ppid,args').toString().split('\n');
  const mine = out.filter((l) => l.includes('--remote-debugging-pipe') && !l.includes('--type=')).map((l) => Number(l.trim().split(/\s+/)[0]));
  return Math.max(...mine);
};

async function once(file) {
  const server = await startServer({ root: fileURLToPath(new URL('apps/reader/', root)), host: '127.0.0.1', address: '127.0.0.1', notes: null });
  const b = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const pid = browserPid(b);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const gc = async () => { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); await p.waitForTimeout(300); };
  await p.goto(server.origin + '/');
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await gc();
  const idle = pss(pid);
  const bytes = readFileSync(new URL(file, root));
  const r = {};
  // Open.
  await p.route('**/__bench_file', (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
  await p.evaluate(async () => { window.__bench = await (await fetch('/__bench_file')).arrayBuffer(); });
  let m0 = await metric();
  let t0 = Date.now();
  await p.evaluate(() => {
    const input = document.getElementById('file');
    const dt = new DataTransfer(); dt.items.add(new File([window.__bench], 'bench.noteful')); input.files = dt.files;
    window.__bench = null;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForFunction(() => document.querySelector('.sheet[data-page="0"] .render svg'), null, { timeout: 60000 });
  r.openMs = Date.now() - t0;
  let m1 = await metric();
  r.openCpuMs = (m1.TaskDuration - m0.TaskDuration) * 1000;
  r.pages = await p.evaluate(() => document.querySelectorAll('.sheet').length);
  await p.waitForTimeout(1500);
  await gc();
  r.openPssMB = pss(pid) - idle;
  r.openHeapMB = (await metric()).JSHeapUsedSize / 1048576;
  // Scroll through every page, waiting for the pages in view to show.
  m0 = await metric(); t0 = Date.now();
  let peakPss = 0, peakNodes = 0;
  // Sheet positions are read once (they do not move while scrolling), so the wait below
  // costs the page next to nothing. A page counts as shown with its PDF drawn, if it has one
  // (an <image> in the SVG or a canvas under it, whichever this build uses).
  const steps = await p.evaluate(() => {
    const v = document.getElementById('viewport');
    window.__sheets = [...document.querySelectorAll('.sheet')].map((el) => ({ el, top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }));
    window.__pdf = !!document.querySelector('.sheet .pdf-raster, .sheet [data-background] image');
    return Math.ceil(v.scrollHeight / (v.clientHeight * 0.9));
  });
  r.pdf = await p.evaluate(() => window.__pdf);
  for (let i = 1; i <= steps; i++) {
    await p.evaluate((i) => { const v = document.getElementById('viewport'); v.scrollTop = i * v.clientHeight * 0.9; }, i);
    await p.waitForFunction(() => {
      const v = document.getElementById('viewport'), top = v.scrollTop, bottom = top + v.clientHeight;
      return window.__sheets.filter((s) => s.bottom > top && s.top < bottom)
        .every(({ el }) => el.querySelector('.render svg') && (!window.__pdf || el.querySelector('.pdf-raster, [data-background] image')));
    }, null, { timeout: 30000, polling: 16 });
    if (i % 10 === 0) { peakPss = Math.max(peakPss, pss(pid) - idle); peakNodes = Math.max(peakNodes, (await metric()).Nodes); }
  }
  r.scrollMs = Date.now() - t0;
  m1 = await metric();
  r.scrollCpuMs = (m1.TaskDuration - m0.TaskDuration) * 1000;
  r.scrollPeakPssMB = Math.max(peakPss, pss(pid) - idle);
  r.scrollPeakNodes = Math.max(peakNodes, m1.Nodes);
  // Thumbnails: open the pages panel and scroll it to the end.
  await p.waitForTimeout(500);
  await gc();
  r.afterScrollPssMB = pss(pid) - idle;
  r.afterScrollHeapMB = (await metric()).JSHeapUsedSize / 1048576;
  // What the system cannot take back: the browser drops its caches of decoded pictures when
  // memory runs short (as a phone or tablet does), so this is the note's lasting footprint.
  await cdp.send('Memory.simulatePressureNotification', { level: 'critical' });
  await p.waitForTimeout(1500);
  await gc();
  r.afterPressurePssMB = pss(pid) - idle;
  // Draw: 20 strokes on the page in view, then wait for the page to settle.
  await p.evaluate(() => { const v = document.getElementById('viewport'); v.scrollTop = 0; });
  await p.waitForFunction(() => document.querySelector('.sheet[data-page="0"] .render svg'));
  // Work left over from scrolling (thumbnails, search words, rasters of the pages in view)
  // is counted on its own, so the drawing below measures drawing.
  m0 = await metric();
  await p.waitForTimeout(3000);
  r.settleCpuMs = ((await metric()).TaskDuration - m0.TaskDuration) * 1000;
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const s = await p.locator('.sheet[data-page="0"]').boundingBox();
  m0 = await metric(); t0 = Date.now();
  const lat = [];
  for (let k = 0; k < 20; k++) {
    const y = s.y + 60 + k * 18;
    await p.mouse.move(s.x + 80, y); await p.mouse.down();
    const start = Date.now();
    for (let j = 1; j <= 30; j++) await p.mouse.move(s.x + 80 + j * 12, y + Math.sin(j / 3) * 8);
    lat.push((Date.now() - start) / 30);
    await p.mouse.up();
  }
  await p.waitForFunction(() => !document.querySelector('.pending-ink'), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1600);
  r.drawMs = Date.now() - t0;
  m1 = await metric();
  r.drawCpuMs = (m1.TaskDuration - m0.TaskDuration) * 1000;
  r.moveMs = lat.reduce((a, b) => a + b) / lat.length;
  await gc();
  r.afterDrawPssMB = pss(pid) - idle;
  r.domNodes = m1.Nodes;
  await b.close(); await server.stop();
  return r;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const report = {};
for (const file of files) {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await once(file));
  const keys = Object.keys(results[0]);
  report[basename(file)] = Object.fromEntries(keys.map((k) => [k, Math.round(median(results.map((x) => x[k])) * 10) / 10]));
  console.log(basename(file), report[basename(file)]);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
