// Page navigation benchmark: what a slow tablet feels when moving into pages with much ink or
// many prefab parts. Opens a note at a tablet-like CPU (CDP CPU throttling, 4× by default) and
// times, for each way of getting to a page, how long until the page in view shows its ink,
// with the main-thread tasks over 50 ms and the frames over 50 ms meanwhile:
//   jump      Go to page (the page box) to pages far apart
//   scroll    a steady finger-speed scroll down through several pages
//   fling     a fast scroll far down, then stopping
//   back      jumping back to pages seen a moment before
// Make a heavy note first (node tools/make_heavy_note.mjs heavy.nfedit) or pass any note.
//   node tools/page_nav_bench.mjs <file> [--cpu 4] [--kept N] [--json out.json] [--profile]
// --kept sets Display quality → Recent pages kept ready (0 turns it off; default: the app's).
// --profile lists the functions that took the most main-thread time over all four.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, startReader, openReader } from './e2e_common.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const cpu = Number(flag('--cpu', 4));
const jsonOut = flag('--json', '');
const kept = flag('--kept', '');
const profile = args.includes('--profile') ? (args.splice(args.indexOf('--profile'), 1), true) : false;
const file = args[0];
if (!file) { console.error('usage: node tools/page_nav_bench.mjs <file> [--cpu 4] [--json out.json]'); process.exit(2); }

const server = await startReader();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
p.on('pageerror', (e) => console.error('pageerror', e.message));
if (kept !== '') await p.addInitScript((n) => { localStorage.setItem('notecomplete-quality-v1', JSON.stringify({ scale: 2, megapixels: 12, contrast: 100, brightness: 100, preloadPages: 2, keptPages: n })); }, Number(kept));
await p.addInitScript(() => {
  window.__long = [];
  window.__frames = [];
  window.__phase = 'load';
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push({ phase: window.__phase, ms: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true });
  let last = performance.now();
  const tick = (now) => { const d = now - last; if (d > 50) window.__frames.push({ phase: window.__phase, ms: Math.round(d) }); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await openReader(p, server.origin);
const bytes = readFileSync(file);
await p.route('**/__bench_file', (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
await p.evaluate(async (name) => {
  const buf = await (await fetch('/__bench_file')).arrayBuffer();
  const input = document.getElementById('file');
  const dt = new DataTransfer(); dt.items.add(new File([buf], name)); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, file.split('/').pop());
await p.waitForFunction(() => document.querySelector('.sheet[data-page="0"] .render svg'), null, { timeout: 180000 });
await p.waitForTimeout(3000);
const pages = await p.evaluate(() => document.querySelectorAll('.sheet').length);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }

const phase = (name) => p.evaluate((n) => { window.__phase = n; }, name);
// Until the page whose top is nearest the viewport's top shows its ink.
const shownAt = (index) => p.waitForFunction((i) => document.querySelector(`.sheet[data-page="${i}"] .render svg`), index, { timeout: 120000, polling: 16 });
const goTo = async (index) => {
  const t = Date.now();
  await p.evaluate((i) => { const box = document.getElementById('pageNumber'); box.value = String(i + 1); box.dispatchEvent(new Event('change')); }, index);
  await shownAt(index);
  return Date.now() - t;
};
const settle = () => p.waitForTimeout(1500);
const results = {};

await phase('jump');
const jumps = [];
for (const i of [Math.floor(pages / 2), pages - 2, 3, Math.floor(pages / 3)]) { jumps.push(await goTo(i)); await settle(); }
results.jump = jumps;

await phase('back');
const back = [];
for (const i of [Math.floor(pages / 2), pages - 2]) { back.push(await goTo(i)); await settle(); }
results.back = back;

await goTo(0);
await settle();
await phase('scroll');
{
  const t = Date.now();
  // About 1.2 pages a second, in 60 steps a second (a finger drag).
  const height = await p.evaluate(() => document.querySelector('.sheet').getBoundingClientRect().height);
  const steps = 300, step = (height * 1.2) / 60;
  await p.evaluate(async ([steps, step]) => {
    const v = document.getElementById('viewport');
    for (let i = 0; i < steps; i++) { v.scrollTop += step; await new Promise((r) => requestAnimationFrame(r)); }
  }, [steps, step]);
  const target = await p.evaluate(() => Number(document.getElementById('pageNumber').value) - 1);
  await shownAt(target);
  results.scroll = [Date.now() - t];
}
await settle();
await goTo(1);
await settle();
await phase('fling');
{
  const t = Date.now();
  await p.evaluate(async () => {
    const v = document.getElementById('viewport'), h = document.querySelector('.sheet').getBoundingClientRect().height;
    // Twelve pages in half a second, slowing down.
    for (let i = 0; i < 30; i++) { v.scrollTop += h * 0.8 * (1 - i / 30) * 0.9; await new Promise((r) => requestAnimationFrame(r)); }
  });
  const flung = Date.now();
  const target = await p.evaluate(() => Number(document.getElementById('pageNumber').value) - 1);
  await shownAt(target);
  results.fling = [Date.now() - flung];
  results.flingTotal = [Date.now() - t];
}
await settle();

let top = [];
if (profile) {
  const { profile: prof } = await cdp.send('Profiler.stop');
  const nodes = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n);
  const name = (f) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  const self = new Map();
  for (let i = 0; i < prof.samples.length; i++) {
    const node = nodes.get(prof.samples[i]), f = node.callFrame;
    if (f.functionName === '(idle)' || f.functionName === '(program)') continue;
    let key = name(f);
    if (!f.url) { let up = parent.get(node.id); while (up && !up.callFrame.url) up = parent.get(up.id); if (up) key += ` <- ${name(up.callFrame)}`; }
    self.set(key, (self.get(key) || 0) + (prof.timeDeltas[i] || 0) / 1000);
  }
  top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, ms]) => `${Math.round(ms)} ms  ${k}`);
}
const { long, frames } = await p.evaluate(() => ({ long: window.__long, frames: window.__frames }));
const report = {};
for (const name of ['jump', 'back', 'scroll', 'fling']) {
  const l = long.filter((x) => x.phase === name).map((x) => x.ms), f = frames.filter((x) => x.phase === name).map((x) => x.ms);
  report[name] = {
    toInkMs: results[name],
    longTasks: l.length, longTaskMs: l.reduce((a, b) => a + b, 0), longest: Math.max(0, ...l),
    slowFrames: f.length, worstFrame: Math.max(0, ...f),
  };
}
console.log(`${file.split('/').pop()}: ${pages} pages, CPU ${cpu}x`);
console.table(report);
if (top.length) console.log(top.join('\n'));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
await b.close();
server.close?.();
process.exit(0);
