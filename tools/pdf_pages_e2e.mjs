// Browser check of PDF pages (Chromium, after a web build): adding a page (and undoing and
// redoing it) keeps the PDF on the pages around it, also when + is pressed while the last
// page is still being drawn; and at the largest zoom the PDF is still shown, as a picture
// once it is larger than a canvas some tablets can show (4096 px a side).
//   node tools/pdf_pages_e2e.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null, port: 0 });
const b = await chromium.launch();
const sample = (name) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url));
const errors = [];
async function open(name, options = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept());
  await p.goto(server.origin + '/'); await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.setInputFiles('#file', sample(name));
  await p.waitForFunction(() => document.querySelector('.sheet .pdf-raster, .sheet [data-background] > image'), null, { timeout: 30000 });
  return { p, ctx };
}
// Every page drawn near the view, except blank ones (`blank`), shows its PDF: a canvas with
// pixels or a picture whose URL still loads, laid out with a size. Waits for drawing to settle.
async function pdfShown(p, blank, label) {
  await p.waitForFunction((blank) => {
    const drawn = [...document.querySelectorAll('.sheet')].filter((s) => s.querySelector(':scope > .render') && !blank.includes(Number(s.dataset.page)));
    return drawn.length && drawn.every((s) => s.querySelector('.render > canvas.pdf-raster, [data-background] > image'));
  }, blank, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(800);
  const pages = await p.evaluate(async (blank) => {
    const out = [];
    for (const s of document.querySelectorAll('.sheet')) {
      if (!s.querySelector(':scope > .render') || blank.includes(Number(s.dataset.page))) continue;
      const canvas = s.querySelector('.render > canvas.pdf-raster'), image = s.querySelector('[data-background] > image');
      const box = (canvas || image)?.getBoundingClientRect();
      let ok = !!box && box.width > 0 && box.height > 0;
      if (canvas) ok &&= canvas.isConnected && canvas.width > 0 && canvas.height > 0;
      else if (image) ok &&= await fetch(image.getAttribute('href')).then(() => true, () => false);
      out.push({ page: Number(s.dataset.page), ok, kind: canvas ? 'canvas' : image ? 'image' : 'none' });
    }
    return out;
  }, blank);
  assert.ok(pages.length, `${label}: PDF pages are drawn near the view`);
  for (const page of pages) assert.ok(page.ok, `${label}: page ${page.page + 1} shows its PDF (${page.kind})`);
  return pages;
}
const toEnd = (p) => p.evaluate(() => { const v = document.getElementById('viewport'); v.scrollTop = v.scrollHeight; });
const scrollBy = (p, dy) => p.evaluate((dy) => { document.getElementById('viewport').scrollTop += dy; }, dy);
const sheets = (p) => p.evaluate(() => document.querySelectorAll('.sheet').length);

for (const name of ['Practice book (vol. 1).noteful', 'Examen wuolah.noteful']) {
  const { p, ctx } = await open(name);
  const count = await sheets(p);
  await toEnd(p); await pdfShown(p, [], `${name}, at the end`);
  await p.click('.add-page-end');
  await p.waitForFunction((n) => document.querySelectorAll('.sheet').length === n + 1, count);
  await pdfShown(p, [count], `${name}, page added`);
  await scrollBy(p, -900); await pdfShown(p, [count], `${name}, page added, scrolled up`);
  await p.evaluate(() => document.getElementById('undo').click());
  await p.waitForFunction((n) => document.querySelectorAll('.sheet').length === n, count);
  await pdfShown(p, [], `${name}, undone`);
  await p.evaluate(() => document.getElementById('redo').click());
  await p.waitForFunction((n) => document.querySelectorAll('.sheet').length === n + 1, count);
  await pdfShown(p, [count], `${name}, redone`);
  console.log(`· ${name}: adding a page, undo and redo keep the PDF`);
  await ctx.close();
}

{
  // + pressed while the last page is still being drawn, on a slow device.
  const { p, ctx } = await open('Practice book (vol. 1).noteful');
  const count = await sheets(p);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  for (const wait of [0, 150, 400]) {
    await scrollBy(p, -4000); await p.waitForTimeout(300);
    await toEnd(p); await p.waitForTimeout(wait);
    await p.evaluate(() => document.querySelector('.add-page-end').click());
    await p.waitForFunction((n) => document.querySelectorAll('.sheet').length === n + 1, count);
    await pdfShown(p, [count], `added ${wait} ms after reaching the end`);
    await p.evaluate(() => document.getElementById('undo').click());
    await p.waitForFunction((n) => document.querySelectorAll('.sheet').length === n, count);
    await pdfShown(p, [], `added ${wait} ms after reaching the end, undone`);
  }
  console.log('· adding a page while the last one is still drawn keeps the PDF');
  await ctx.close();
}

{
  // A 2× tablet screen at the largest zoom.
  const { p, ctx } = await open('Practice book (vol. 1).noteful', { deviceScaleFactor: 2 });
  const [fit] = await pdfShown(p, [], 'fit');
  assert.equal(fit.kind, 'canvas', 'a page with little ink is a canvas at fit');
  // The largest zoom the app allows (400 %; beyond it the box keeps 400).
  await p.fill('#zoomValue', '900'); await p.press('#zoomValue', 'Enter');
  assert.equal(await p.inputValue('#zoomValue'), '400%');
  await p.waitForFunction(() => document.querySelector('.sheet [data-background] > image'), null, { timeout: 30000 });
  const zoomed = await pdfShown(p, [], 'largest zoom');
  const sizes = await p.evaluate(() => [...document.querySelectorAll('.sheet .render > canvas.pdf-raster')].map((c) => [c.width, c.height]));
  for (const [w, h] of sizes) assert.ok(w <= 4096 && h <= 4096, `no canvas larger than 4096 px a side (${w}×${h})`);
  assert.ok(zoomed.some((page) => page.kind === 'image'), 'the zoomed page is a picture');
  await scrollBy(p, 3000); await pdfShown(p, [], 'largest zoom, scrolled');
  console.log('· at the largest zoom the PDF is shown, as a picture');
  await ctx.close();
}

assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('PDF pages end to end: passed.');
