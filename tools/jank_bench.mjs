// Jank benchmark: what a slow tablet feels as sudden lag. Opens a note at a tablet-like CPU
// (CDP CPU throttling, 4× by default), then writes, scrolls, zooms and waits long enough for
// auto-save, and reports every main-thread task over 50 ms (long tasks), the longest one, the
// frames that took over 50 ms, and, with --profile, the functions that spent the most time
// inside the long tasks.
//   node tools/jank_bench.mjs [file] [--cpu 4] [--strokes 40] [--profile] [--json out.json]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const cpu = Number(flag('--cpu', 4));
const strokes = Number(flag('--strokes', 40));
const jsonOut = flag('--json', '');
const profile = bool('--profile');
const root = new URL('../', import.meta.url);
const file = args[0] || 'samples/Practice book (vol. 1).noteful';

const server = await startServer({ root: fileURLToPath(new URL('apps/reader/', root)), host: '127.0.0.1', address: '127.0.0.1', notes: null });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
p.on('pageerror', (e) => console.error('pageerror', e.message));
await p.addInitScript(() => {
  window.__long = [];
  window.__frames = [];
  window.__phase = 'load';
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push({ phase: window.__phase, at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true });
  let last = performance.now();
  const tick = (now) => { const d = now - last; if (d > 50) window.__frames.push({ phase: window.__phase, ms: Math.round(d) }); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await p.goto(server.origin + '/');
await p.waitForFunction(() => !document.getElementById('open').disabled);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
const tops = {};
let current = null;
async function stopProfile() {
  if (!profile || !current) return;
  const { profile: prof } = await cdp.send('Profiler.stop');
  const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n);
  const name = (f) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
  const self = new Map();
  for (let i = 0; i < prof.samples.length; i++) {
    const node = nodes.get(prof.samples[i]), f = node.callFrame;
    if (f.functionName === '(idle)' || f.functionName === '(program)') continue;
    // A built-in (no script) is named with the script function that called it.
    let key = name(f);
    if (!f.url) { let up = parent.get(node.id); while (up && !up.callFrame.url) up = parent.get(up.id); if (up) key += ` ← ${name(up.callFrame)}`; }
    self.set(key, (self.get(key) || 0) + (prof.timeDeltas[i] || 0) / 1000);
  }
  tops[current] = [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, ms]) => `${Math.round(ms)} ms  ${k}`);
}
const phase = async (name) => {
  await stopProfile();
  current = name;
  if (profile) await cdp.send('Profiler.start');
  await p.evaluate((n) => { window.__phase = n; }, name);
};
if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); }

const bytes = readFileSync(new URL(file, root));
await p.route('**/__bench_file', (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
await phase('open');
await p.evaluate(async () => {
  const buf = await (await fetch('/__bench_file')).arrayBuffer();
  const input = document.getElementById('file');
  const dt = new DataTransfer(); dt.items.add(new File([buf], 'bench.noteful')); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForFunction(() => document.querySelector('.sheet[data-page="0"] .render svg'), null, { timeout: 120000 });
await p.waitForTimeout(3000);

await phase('write');
await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
const s = await p.locator('.sheet[data-page="0"]').boundingBox();
const commits = [];
for (let k = 0; k < strokes; k++) {
  const y = s.y + 60 + (k % 30) * 16, x0 = s.x + 60 + Math.floor(k / 30) * 300;
  await p.mouse.move(x0, y); await p.mouse.down();
  for (let j = 1; j <= 25; j++) await p.mouse.move(x0 + j * 9, y + Math.sin(j / 3) * 6);
  await p.mouse.up();
  const t = Date.now();
  await p.waitForFunction(() => !document.querySelector('.pending-ink'), null, { timeout: 20000, polling: 10 }).catch(() => {});
  commits.push(Date.now() - t);
  await p.waitForTimeout(120);
}
commits.sort((a, b) => a - b);
console.log(`stroke commit ms: median ${commits[commits.length >> 1]}, p90 ${commits[Math.floor(commits.length * 0.9)]}, max ${commits.at(-1)}`);
await p.waitForTimeout(1500);

await phase('scroll');
for (let i = 0; i < 30; i++) { await p.mouse.move(s.x + 300, 400); await p.mouse.wheel(0, 500); await p.waitForTimeout(60); }
for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, -500); await p.waitForTimeout(60); }
await p.waitForTimeout(1500);

await phase('zoom');
for (let i = 0; i < 6; i++) { await p.keyboard.down('Control'); await p.mouse.wheel(0, -200); await p.keyboard.up('Control'); await p.waitForTimeout(250); }
for (let i = 0; i < 6; i++) { await p.keyboard.down('Control'); await p.mouse.wheel(0, 200); await p.keyboard.up('Control'); await p.waitForTimeout(250); }
await p.waitForTimeout(1500);

await phase('idle');
// Long enough for one auto-save copy (every minute) and the work after edits.
await p.waitForTimeout(Number(process.env.IDLE_MS || 70000));

const { long, frames } = await p.evaluate(() => ({ long: window.__long, frames: window.__frames }));
const byPhase = {};
for (const t of long) {
  const ph = (byPhase[t.phase] ||= { tasks: 0, totalMs: 0, maxMs: 0, over200: 0 });
  ph.tasks++; ph.totalMs += t.ms; ph.maxMs = Math.max(ph.maxMs, t.ms); if (t.ms > 200) ph.over200++;
}
for (const f of frames) { const ph = (byPhase[f.phase] ||= { tasks: 0, totalMs: 0, maxMs: 0, over200: 0 }); ph.slowFrames = (ph.slowFrames || 0) + 1; ph.worstFrameMs = Math.max(ph.worstFrameMs || 0, f.ms); }
console.log(`file ${file}, CPU ×${cpu}`);
console.table(byPhase);
console.log('longest tasks', [...long].sort((a, b) => b.ms - a.ms).slice(0, 12));

await stopProfile();
for (const [ph, list] of Object.entries(tops)) console.log(`\n${ph}:\n  ` + list.join('\n  '));
const top = tops;
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ file, cpu, byPhase, long, top }, null, 2));
await b.close(); await server.stop();
