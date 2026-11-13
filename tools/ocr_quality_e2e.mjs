// Browser check of text recognition at both qualities, with Chinese (Chromium, after a
// web build; needs the network for Tesseract's language data, fetched here with curl).
// A picture with Spanish and Chinese lines is opened as a note and recognized at normal
// and high quality, with the Spanish word lists; Find then finds the words, Chinese by
// characters.
//   node tools/ocr_quality_e2e.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader } from './e2e_common.mjs';
const cache = join(tmpdir(), 'notecomplete-ocr-data'); mkdirSync(cache, { recursive: true });
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
const fetched = [];
// Language data through curl (it knows this machine's proxy), kept between runs.
const fromNetwork = async (route) => {
  const url = route.request().url(), file = join(cache, url.replace(/[^\w.-]+/g, '_'));
  fetched.push(url);
  if (!existsSync(file)) execFileSync('curl', ['-sSfL', '-o', file, url]);
  await route.fulfill({ body: readFileSync(file), contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
};
// Language data (jsDelivr) and the Spanish word lists (jsDelivr, GitHub).
await ctx.route('https://cdn.jsdelivr.net/**', fromNetwork);
await ctx.route('https://raw.githubusercontent.com/**', fromNetwork);
// The picture: printed Spanish and Chinese lines, rendered by the browser.
const art = await ctx.newPage();
await art.setContent(`<body style="margin:0;background:#fff;font:34px 'WenQuanYi Zen Hei',sans-serif;padding:60px;width:1100px">
  <p>La memoria caché guarda los datos más usados del procesador.</p>
  <p>Ejercicio: calcula la dirección física y el número de página.</p>
  <p>我们学习中文和计算机科学。</p><p>数据存储在内存中。</p></body>`);
const png = join(cache, 'ocr-sample.png');
await art.screenshot({ path: png, fullPage: true }); await art.close();

const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
await openReader(p, server.origin);
await p.setInputFiles('#file', png);
await p.waitForSelector('.sheet[data-page="0"] .render svg');
const recognize = async (quality, during = null) => {
  await p.evaluate(() => document.getElementById('ocrOpen').click());
  await p.waitForSelector('#ocrDialog[open]');
  await p.selectOption('#ocrLanguage', ['spa', 'chi_sim']);
  await p.locator(`input[name="ocrQuality"][value="${quality}"]`).locator("xpath=..").click();
  if (!(await p.isChecked('#ocrRedo'))) await p.check('#ocrRedo');
  assert.equal(await p.evaluate(() => document.querySelector('input[name="ocrQuality"]:checked').value), quality);
  await p.evaluate(() => { document.getElementById('status').textContent = ''; });
  await p.click('#ocrStart');
  if (during) await during();
  await p.waitForFunction(() => /Text recognized|Could not recognize/.test(document.getElementById('status').textContent), null, { timeout: 600000 });
  const message = await p.textContent('#status');
  assert.match(message, /Text recognized/, message);
};
const find = async (query) => {
  await p.keyboard.press('Control+f');
  await p.fill('#findInput', query);
  await p.waitForTimeout(600);
  const n = await p.evaluate(() => document.querySelectorAll('#findResults li').length);
  await p.keyboard.press('Escape');
  return n;
};
const words = ['memoria', 'procesador', 'dirección', 'página', '学习', '中文', '内存'];

let t = Date.now();
await recognize('normal');
const normalTime = Date.now() - t;
assert.ok(fetched.some(u => /best_int\/chi_sim/.test(u)), 'the Chinese data was fetched');
assert.ok(fetched.some(u => /es_50k\.txt$/.test(u)) && fetched.some(u => /an-array-of-spanish-words/.test(u)), 'the Spanish word lists were fetched');
const normal = {}; for (const w of words) normal[w] = await find(w);
console.log('· normal quality:', `${(normalTime / 1000).toFixed(1)} s`, normal);

t = Date.now();
fetched.length = 0;
// Quick result first (the default): while the extra passes run, Find already has the words.
let duringRun = null;
await recognize('high', async () => {
  await p.waitForFunction(() => /improving/.test(document.getElementById('jobArea').textContent), null, { timeout: 300000 });
  duringRun = await find('memoria');
});
assert.ok(duringRun > 0, 'the quick result is searchable while the run improves it');
console.log('· quick result searchable while improving');
const highTime = Date.now() - t;
const high = {}; for (const w of words) high[w] = await find(w);
console.log('· high quality:', `${(highTime / 1000).toFixed(1)} s`, high);
for (const w of words) assert.ok(normal[w] > 0 && high[w] > 0, `both qualities find “${w}”`);
assert.equal(await p.evaluate(() => localStorage.getItem('notecomplete-ocr-quality')), 'high', 'the quality is remembered');
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('OCR quality end to end: passed.');
