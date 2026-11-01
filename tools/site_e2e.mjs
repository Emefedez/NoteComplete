// Browser check of the website (Chromium), served as GitHub Pages does (a sub-path, no
// special headers). Build it first:
//   python tools/build_web.py && node apps/desktop/stage.mjs && node tools/build_site.mjs
//   node tools/site_e2e.mjs
// It opens with the welcome notebook in front (Notes panel open, formatted) and Home
// beside it; on a phone the tab count opens the list of tabs and switches to Home.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../apps/desktop/reader/', import.meta.url));
const TYPES = { js: 'text/javascript', wasm: 'application/wasm', json: 'application/json', svg: 'image/svg+xml', html: 'text/html', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(new URL(q.url, 'http://x').pathname).replace(/^\/NoteComplete\/?/, '');
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
    assert.ok(await f.evaluate(() => [...document.querySelectorAll('#notesPanel a')].some((a) => a.href.includes('/releases/latest'))), 'download links in the Notes panel');
    assert.equal(await f.isVisible('#tabCount'), phone);
    if (phone) {
      await f.click('#tabCount');
      await f.click('#tabMenu .tab-menu-row:not(.current) button[role=menuitemradio]');
      await p.waitForFunction(() => { const [a, b] = document.querySelectorAll('#tabs iframe'); return a.hidden && !b.hidden; });
    }
    assert.deepEqual(errors, []);
    console.log(`· ${phone ? 'phone: the tab count switches to Home' : 'desktop: welcome notebook and Home tabs, notes formatted'}`);
  }
  console.log('Website end to end: passed.');
} finally { await b.close(); server.close(); }
