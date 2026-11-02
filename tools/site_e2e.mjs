// Browser check of the website (Chromium), served as GitHub Pages does (a sub-path, no
// special headers). Build it first:
//   python tools/build_web.py && node apps/desktop/stage.mjs && node tools/build_site.mjs
//   node tools/site_e2e.mjs
// It opens with the welcome notebook in front (Notes panel open, formatted) and Home
// beside it; on a phone the tab count opens the list of tabs and switches to Home.
import http from 'node:http';
import { createReadStream, statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../apps/desktop/reader/', import.meta.url));
const TYPES = { js: 'text/javascript', wasm: 'application/wasm', json: 'application/json', svg: 'image/svg+xml', html: 'text/html', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json' };
// What the browser asked the server for (not what its service worker answered).
const asked = [];
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/NoteComplete\/?/, '');
  asked.push(p);
  if (!p || p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  try { if (!statSync(file).isFile()) throw 0; } catch { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' });
  createReadStream(file).pipe(r);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const b = await chromium.launch();
try {
  for (const phone of [false, true]) {
    const p = await (await b.newContext(phone ? { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } })).newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/NoteComplete/`);
    await p.waitForFunction(() => document.querySelectorAll('#tabs iframe').length === 2);
    const f = p.frames().find((fr) => fr.url().includes('open='));
    await f.waitForFunction(() => document.querySelectorAll('.sheet').length >= 3 && document.querySelector('.sheet [data-item]'), null, { timeout: 30000 });
    await f.waitForFunction(() => document.getElementById('notesPreview')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    assert.deepEqual(await f.evaluate(() => [...document.querySelectorAll('#tabStrip .tab')].map((t) => t.querySelector('.tab-label').textContent + (t.classList.contains('current') ? '*' : ''))), ['Welcome to NoteComplete*', 'Home']);
    // The formatted notes render a moment after Preview turns on.
    await f.waitForFunction(() => [...document.querySelectorAll('#notesPanel a')].some((a) => a.href.includes('/releases/latest')), null, { timeout: 5000 });
    assert.equal(await f.evaluate(() => document.getElementById('notesToggle').getAttribute('aria-expanded')), 'true');
    assert.notEqual(await f.evaluate(() => getComputedStyle(document.getElementById('notesToggle')).backgroundColor), 'rgba(0, 0, 0, 0)', 'the Notes button shows it is on');
    assert.equal(await f.isVisible('#tabCount'), phone);
    if (phone) {
      await f.click('#tabCount');
      await f.click('#tabMenu .tab-menu-row:not(.current) button[role=menuitemradio]');
      await p.waitForFunction(() => { const [a, b] = document.querySelectorAll('#tabs iframe'); return a.hidden && !b.hidden; });
    }
    assert.deepEqual(errors, []);
    console.log(`· ${phone ? 'phone: the tab count switches to Home' : 'desktop: welcome notebook and Home tabs, notes formatted'}`);
  }
  // The service worker caches the app shell, not the engines a feature loads when used; the
  // next visit takes the app from it, and the site opens offline.
  const context = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await context.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const welcome = () => p.waitForFunction(() => [...document.querySelectorAll('#tabs iframe')].some((f) => f.contentDocument?.querySelector('.sheet [data-item]')), null, { timeout: 30000 });
  await p.goto(`http://127.0.0.1:${server.address().port}/NoteComplete/`);
  await welcome();
  const cached = await p.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const names = new Set();
    for (const key of await caches.keys()) for (const r of await (await caches.open(key)).keys()) names.add(new URL(r.url).pathname.replace('/NoteComplete/', ''));
    return [...names];
  });
  const { shell } = JSON.parse(readFileSync(path.join(root, 'precache.json'), 'utf8'));
  for (const name of shell) assert.ok(cached.includes(name), `${name} cached at install`);
  assert.ok(!cached.some((name) => /vendor\/(transformers|tesseract|mammoth|sheetjs|katex)\//.test(name)), 'the engines wait until they are used');
  asked.length = 0;
  await p.reload();
  await welcome();
  assert.ok(!asked.includes('app.js') && !asked.includes('pkg/noteful_wasm_bg.wasm'), `the second visit takes the app from the cache (asked: ${asked.join(', ')})`);
  await context.setOffline(true);
  await p.reload();
  await welcome();
  assert.deepEqual(errors, []);
  console.log('· offline: the shell is cached at install, the engines are not; a second visit and an offline one load from the cache');
  console.log('Website end to end: passed.');
} finally { await b.close(); server.close(); }
