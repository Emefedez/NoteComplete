// Browser check of touch on the pages (Chromium with real multi-touch through DevTools,
// after a web build): one finger draws, a two-finger tap undoes and a three-finger tap
// redoes, two fingers pinch-zoom and scroll, a finger selects and moves a stroke, and a
// long menu scrolls on a short screen.
//   node tools/touch_e2e.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null, port: 0 });
const b = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const ctx = await b.newContext({ viewport: { width: 412, height: 560 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const drag = async (from, to, steps = 8) => { await touch('touchStart', [from]); for (let i = 1; i <= steps; i++) { await touch('touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await sleep(16); } await touch('touchEnd', []); };
  const added = (n) => p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] [data-item^="new:"]').length === n, n, { timeout: 8000 });
  await p.goto(server.origin + '/');
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.setInputFiles('#file', fileURLToPath(new URL('../samples/Examen wuolah.noteful', import.meta.url)));
  await p.waitForFunction(() => document.querySelectorAll('.sheet [data-item]').length > 10);
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const s = await p.locator('.sheet').first().boundingBox();
  await drag([s.x + 100, s.y + 200], [s.x + 250, s.y + 230]);
  await added(1);
  console.log('· one finger draws');
  await touch('touchStart', [[150, 300]]); await touch('touchStart', [[150, 300], [220, 300]]); await sleep(60); await touch('touchEnd', []);
  await added(0);
  await touch('touchStart', [[150, 300], [200, 300], [250, 300]]); await sleep(60); await touch('touchEnd', []);
  await added(1);
  console.log('· a two-finger tap undoes, a three-finger tap redoes');
  // Select the stroke with a finger and move it.
  await p.evaluate(() => document.querySelector('[data-tool=select]').click());
  const at = await p.evaluate(() => { const r = document.querySelector('.sheet[data-page="0"] [data-item^="new:"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.y]; });
  await touch('touchStart', [[at[0], at[1]]]); await sleep(50); await touch('touchEnd', []);
  await p.waitForSelector('.selection-overlay');
  await sleep(200);
  await drag([at[0], at[1]], [at[0], at[1] + 80], 10);
  await p.waitForFunction((y) => Math.abs(document.querySelector('.sheet[data-page="0"] [data-item^="new:"]').getBoundingClientRect().y - y - 80) < 6, at[2], { timeout: 8000 });
  console.log('· a finger selects and moves a stroke');
  // Pinch zooms; two fingers scroll, also with a drawing tool, and draw nothing.
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const w0 = (await p.locator('.sheet').first().boundingBox()).width;
  await touch('touchStart', [[180, 350], [230, 350]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[180 - i * 5, 350], [230 + i * 5, 350]]); await sleep(16); }
  await touch('touchEnd', []); await sleep(800);
  const w1 = (await p.locator('.sheet').first().boundingBox()).width;
  assert.ok(w1 > w0 * 1.8, `pinch zooms (${w0} → ${w1})`);
  const top0 = await p.evaluate(() => document.getElementById('viewport').scrollTop);
  await touch('touchStart', [[150, 450], [230, 450]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[150, 450 - i * 15], [230, 450 - i * 15]]); await sleep(16); }
  await touch('touchEnd', []); await sleep(300);
  assert.ok(await p.evaluate(() => document.getElementById('viewport').scrollTop) > top0 + 100, 'two fingers scroll');
  await added(1);
  console.log('· two fingers pinch-zoom and scroll without drawing');
  // A long menu scrolls on a short screen.
  await p.evaluate(() => document.querySelector('details.bar-menu')?.setAttribute('open', ''));
  const m = await p.evaluate(() => { const e = document.querySelector('details.bar-menu[open] .menu-content'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, bottom: Math.min(r.bottom, innerHeight) - 20, top: r.y + 20, overflow: e.scrollHeight - e.clientHeight, fits: r.bottom <= innerHeight }; });
  assert.ok(m.fits, 'the menu stays inside the window');
  if (m.overflow > 0) {
    await drag([m.x, m.bottom], [m.x, m.top], 12); await sleep(400);
    assert.ok(await p.evaluate(() => document.querySelector('details.bar-menu[open] .menu-content').scrollTop) > 0, 'the menu scrolls');
  }
  console.log('· long menus fit the window and scroll');
  assert.deepEqual(errors, []);
  console.log('Touch end to end: passed.');
} finally {
  await b.close(); await server.stop();
}
