// Browser check of Chinese in a picture (chinese/zh-picture.js): an image-only PDF of a printed
// Chinese line is opened; a right-click on one of its characters opens the page menu at once,
// and the look-up of that character (and its word) is added to the menu once read; it opens the
// look-up panel. Needs a web build and the network for Tesseract's Chinese data (fetched here
// with curl and kept; or put it in NOTECOMPLETE_OCR_DATA, named as the URL with every run of
// other characters than letters, digits, "." and "-" turned into "_").
//   node tools/chinese_picture_e2e.mjs [screenshots folder]
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader } from './e2e_common.mjs';
const DIR = process.argv[2] || '';
const cache = process.env.NOTECOMPLETE_OCR_DATA || join(tmpdir(), 'notecomplete-ocr-data'); mkdirSync(cache, { recursive: true });
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const fromNetwork = async (route) => {
  const url = route.request().url(), file = join(cache, url.replace(/[^\w.-]+/g, '_'));
  if (!existsSync(file)) execFileSync('curl', ['-sSfL', '-o', file, url]);
  await route.fulfill({ body: readFileSync(file), contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
};
await ctx.route('https://cdn.jsdelivr.net/**', fromNetwork);

// The PDF: a picture of one printed line, no text in it.
const LINE = '我们学习中文。', FONT = 56, PAD = 80, W = 900;
const art = await ctx.newPage();
await art.setViewportSize({ width: W, height: 400 });
await art.setContent(`<body style="margin:0;background:#fff"><p style="margin:0;padding:${PAD}px;font:${FONT}px/1 'WenQuanYi Zen Hei',sans-serif">${LINE}</p></body>`);
const png = await art.screenshot();
await art.setContent(`<body style="margin:0"><img style="display:block;width:100%" src="data:image/png;base64,${png.toString('base64')}"></body>`);
const pdf = join(cache, 'chinese-picture.pdf');
await art.pdf({ path: pdf, width: `${W}px`, height: '400px', printBackground: true, pageRanges: '1' });
await art.close();

const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await openReader(p, server.origin);
// Chinese is in use on this device (its mode was turned on once).
await p.evaluate(() => localStorage.setItem('notecomplete-zh-used', '1'));
await p.setInputFiles('#file', pdf);
await p.waitForSelector('.sheet[data-page="0"] .render canvas.pdf-raster, .sheet[data-page="0"] .render image');
await p.waitForTimeout(1200);
const box = await p.locator('.sheet[data-page="0"] .render').boundingBox();
// 学: the third character, in the middle of the line.
const at = { x: box.x + ((PAD + FONT * 2.5) / W) * box.width, y: box.y + ((PAD + FONT / 2) / 400) * box.height };
await p.mouse.click(at.x, at.y, { button: 'right' });
await p.waitForSelector('.context-menu');
const opened = Date.now();
await p.waitForSelector('.context-menu button.context-added', { timeout: 120000 });
const labels = await p.locator('.context-menu button.context-added').allTextContents();
console.log(`· read in ${Date.now() - opened} ms:`, labels.join(' | '));
if (DIR) await p.screenshot({ path: `${DIR}/chinese-picture-menu.png` });
assert.ok(labels.some((l) => /^Look up 学/.test(l)), `学 offered: ${labels}`);
assert.ok(labels.some((l) => /^Look up 学习/.test(l)), `its word offered: ${labels}`);
await p.locator('.context-menu button.context-added', { hasText: /^Look up 学 / }).click();
await p.waitForSelector('.zh-lookup .zh-lk-char');
assert.equal(await p.textContent('.zh-lookup .zh-lk-char'), '学');
if (DIR) await p.screenshot({ path: `${DIR}/chinese-picture-lookup.png` });
assert.deepEqual(errors, []);
console.log('Chinese in a picture: OK');
await b.close(); process.exit(0);
