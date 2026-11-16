// Zoom benchmark of the web reader (Chromium, after a web build): Ctrl + wheel zooms in and out
// on a note, as a trackpad pinch (small steps, 16 ms apart) and a mouse wheel (notches 200 ms
// apart, each one a real zoom) do on desktop. Reports the main thread's
// longest task and the frames slower than 50 ms while zooming, and how long the page takes to
// settle (sharp at the new size) after the wheel stops.
//   node tools/zoom_bench.mjs [file] [--dpr 1|2] [--cpu N]
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const dpr = Number(flag('--dpr', 1)), cpu = Number(flag('--cpu', 1));
const file = args[0] || samplePath('Practice book (vol. 1).noteful');
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: dpr });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', file);
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(2500);
  const cdp = await p.context().newCDPSession(p);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await p.evaluate(() => {
    window.__frames = []; window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask' });
    let last = performance.now();
    const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const box = await p.locator('#viewport').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  const results = [];
  for (const [label, dy, steps, gap] of [['trackpad in', -10, 60, 16], ['trackpad out', 10, 60, 16], ['wheel notches in', -100, 8, 200], ['wheel notches out', 100, 8, 200]]) {
    await p.evaluate(() => { window.__frames.length = 0; window.__long.length = 0; });
    const t0 = Date.now();
    await p.keyboard.down('Control');
    for (let i = 0; i < steps; i++) {
      await p.mouse.wheel(0, dy);
      await sleep(gap);
    }
    await p.keyboard.up('Control');
    const during = Date.now() - t0;
    // Settled: no pinch transform, nothing loading, no long task for 500 ms.
    const settle0 = Date.now();
    await p.waitForFunction(() => !document.getElementById('pages').style.transform, null, { timeout: 10000 });
    let quiet = 0;
    while (quiet < 5 && Date.now() - settle0 < 15000) {
      const n = await p.evaluate(() => window.__long.length);
      await sleep(100);
      quiet = (await p.evaluate(() => window.__long.length)) === n ? quiet + 1 : 0;
    }
    const r = await p.evaluate(() => ({ frames: window.__frames.slice(), long: window.__long.slice() }));
    const slow = r.frames.filter((f) => f > 50);
    results.push({ label, during, settle: Date.now() - settle0 - 500, longest: Math.round(Math.max(0, ...r.long)), longTotal: Math.round(r.long.reduce((a, c) => a + c, 0)), slowFrames: slow.length, worstFrame: Math.round(Math.max(0, ...r.frames)), zoom: await p.inputValue('#zoomValue') });
  }
  console.table(results);
  if (errors.length) console.log('page errors:', errors);
} finally {
  await b.close();
  // The server's close waits for idle connections; nothing else is left to wait for.
  server.close?.();
  process.exit(process.exitCode || 0);
}
