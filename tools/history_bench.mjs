// How drawing costs grow with a note's edit history: draws strokes in batches and reports,
// per batch, the main-thread work per stroke and the time from pen up to the stroke settled.
//   node tools/history_bench.mjs [file] [--batches N] [--per N]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../apps/desktop/collab-server.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (n, f) => { const i = args.indexOf(n); if (i < 0) return f; const v = args[i + 1]; args.splice(i, 2); return v; };
const batches = Number(flag('--batches', 6)), per = Number(flag('--per', 50));
const file = args[0] || 'samples/Examen wuolah.noteful';
const root = new URL('../', import.meta.url);
const server = await startServer({ root: fileURLToPath(new URL('apps/reader/', root)), host: '127.0.0.1', address: '127.0.0.1', notes: null });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send('Performance.enable');
const cpu = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value * 1000;
await p.goto(server.origin + '/');
await p.waitForFunction(() => !document.getElementById('open').disabled);
const bytes = readFileSync(new URL(file, root));
await p.route('**/__bench_file', (r) => r.fulfill({ body: bytes, contentType: 'application/octet-stream' }));
await p.evaluate(async () => {
  const buf = await (await fetch('/__bench_file')).arrayBuffer();
  const input = document.getElementById('file');
  const dt = new DataTransfer(); dt.items.add(new File([buf], 'bench.noteful')); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForFunction(() => document.querySelector('.sheet[data-page="0"] .render svg'), null, { timeout: 60000 });
await p.waitForTimeout(3000);
await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
const s = await p.locator('.sheet[data-page="0"]').boundingBox();
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
for (let k = 0; k < batches; k++) {
  if (k === batches - 1) await cdp.send('Profiler.start');
  const c0 = await cpu(); const settle = [];
  for (let i = 0; i < per; i++) {
    const y = s.y + 40 + (i % 40) * 15, x = s.x + 40 + (k % 4) * 120;
    await p.mouse.move(x, y); await p.mouse.down();
    for (let j = 1; j <= 12; j++) await p.mouse.move(x + j * 8, y + Math.sin(j / 2) * 5);
    const t = Date.now();
    await p.mouse.up();
    await p.waitForFunction(() => !document.querySelector('.pending-ink'), null, { timeout: 20000, polling: 'raf' }).catch(() => {});
    settle.push(Date.now() - t);
  }
  await p.waitForTimeout(500);
  const c1 = await cpu();
  settle.sort((a, b) => a - b);
  console.log(`strokes ${(k + 1) * per}: cpu/stroke ${((c1 - c0) / per).toFixed(1)} ms, settle median ${settle[per >> 1]} ms, p90 ${settle[Math.floor(per * 0.9)]} ms`);
}
if (process.env.PROFILE) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas; const counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
  for (const [id, us] of counts) { const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + us); }
  [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, us]) => console.log((us / 1000).toFixed(0).padStart(6), 'ms', k));
}
await b.close(); await server.stop();
