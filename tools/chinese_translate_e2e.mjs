// Browser check of translating Chinese and the Chinese overlays (docs/CHINESE-INPUT.md §16):
// Chinese selected in a text box being typed shows the bar (Translate, Look up, Stroke order,
// Listen); Translate shows the translation (the services are stand-ins here), es | en asks again,
// Colours matches each word to its part; right-click and Shift + right-click inside the box being
// typed open the character's panel and never remove the box; the panel's es | en shows Spanish
// meanings; Chinese printed in a PDF opens its panel on Shift + right-click and shows the bar
// when selected; the grab tool offers 中 over Chinese. Needs a web build with vendor/chinese.
//   node tools/chinese_translate_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] || '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const TEXT = '我喜欢学中文';
// The stand-in services: the sentence, each word alone, and dictionary meanings into Spanish.
const ES = { [TEXT]: 'Me gusta aprender chino', 我: 'me', 喜欢: 'gustar', 学: 'aprender', 中文: 'chino', good: 'bueno', well: 'bien' };
const EN = { [TEXT]: 'I like to learn Chinese', 我: 'I', 喜欢: 'like', 学: 'learn', 中文: 'Chinese' };
const asked = [];
async function stubTranslation(ctx) {
  await ctx.route('https://translate.googleapis.com/**', (route) => {
    const u = new URL(route.request().url()), q = u.searchParams.get('q'), to = u.searchParams.get('tl');
    asked.push(`${u.searchParams.get('sl')}>${to}:${q}`);
    const table = to === 'es' ? ES : EN;
    const out = q.split('\n').map((l) => table[l] ?? `[${l}]`).join('\n');
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([[[out, q]]]) });
  });
}
const itemCount = (p) => p.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] .render [data-item] text').length);

try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  await stubTranslation(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.locator('.sheet[data-page="0"] .render').waitFor();
  await sleep(500);
  await p.evaluate(() => document.querySelector('[data-tool=text]').click());
  const s = await p.locator('.sheet').first().boundingBox();
  await p.mouse.click(s.x + 120, s.y + 160);
  await p.waitForSelector('.text-editor');
  await sleep(200);
  await p.keyboard.insertText(TEXT);
  await sleep(300);

  // ── Right-click and Shift + right-click inside the box being typed: the panel, the box stays ──
  const area = p.locator('.text-editor');
  const charAt = (i) => area.evaluate((a, k) => {
    const r = a.getBoundingClientRect(), cs = getComputedStyle(a), c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const left = c.measureText(a.value.slice(0, k)).width, w = c.measureText(a.value[k]).width;
    return [r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) + left + w / 2, r.top + parseFloat(cs.paddingTop) + parseFloat(cs.lineHeight) / 2 + 1];
  }, i);
  const [hx, hy] = await charAt(1);
  await p.keyboard.down('Shift');
  await p.mouse.click(hx, hy, { button: 'right' });
  await p.keyboard.up('Shift');
  const win = p.locator('.zh-lookup');
  await p.waitForFunction(() => document.querySelector('.zh-lookup .zh-lk-char')?.textContent === '喜');
  assert.equal(await area.count(), 1, 'Shift + right-click inside the box being typed does not remove it');
  assert.equal(await area.inputValue(), TEXT);
  if (DIR) await p.screenshot({ path: `${DIR}/typed-shift-right-click.png` });
  const [xx, xy] = await charAt(4);
  await p.mouse.click(xx, xy, { button: 'right' });
  await p.waitForFunction(() => document.querySelector('.zh-lookup .zh-lk-char')?.textContent === '中');
  assert.equal(await area.count(), 1);
  console.log('· right-click and Shift + right-click in the box being typed open 喜 / 中, the box stays');

  // ── The panel's es | en ──
  await win.locator('.zh-lang button[data-lang="es"]').click();
  await p.waitForFunction(() => document.querySelector('.zh-lookup .zh-lang button[data-lang="es"]')?.getAttribute('aria-pressed') === 'true' && /\[|chino|bueno/.test(document.querySelector('.zh-lookup .zh-lk-meanings')?.textContent || ''), null, { timeout: 8000 });
  assert.ok(asked.some((a) => a.startsWith('en>es:')), 'meanings asked in Spanish');
  if (DIR) await p.screenshot({ path: `${DIR}/lookup-es.png` });
  await win.locator('.zh-lang button[data-lang="en"]').click();
  await p.waitForFunction(() => document.querySelector('.zh-lookup .zh-lang button[data-lang="en"]')?.getAttribute('aria-pressed') === 'true');
  await win.locator('.pk-window-close').click();
  console.log('· es | en in the panel');

  // ── Selected Chinese: the bar, Translate, es | en, Colours ──
  // (Pressing in the panel finished the box: typed again with the Text tool.)
  if (!(await area.count())) {
    await p.evaluate(() => document.querySelector('[data-tool=text]').click());
    await p.mouse.click(hx, hy);
    await area.waitFor();
  }
  await area.focus();
  await p.keyboard.press('Control+A');
  const bar = p.locator('.zh-select-bar');
  await bar.waitFor({ state: 'visible' });
  const titles = await bar.locator('button').evaluateAll((bs) => bs.map((x) => x.title));
  assert.ok(titles[0].startsWith('Translate'), titles.join(' | '));
  assert.ok(titles.some((t) => t.startsWith('Look up')) && titles.some((t) => t.startsWith('Stroke order')), titles.join(' | '));
  if (DIR) await p.screenshot({ path: `${DIR}/selection-bar.png` });
  await bar.locator('button').first().click();
  const tr = p.locator('.zh-translate');
  await p.waitForFunction(() => document.querySelector('.zh-translate .zh-tr-target')?.textContent === 'I like to learn Chinese');
  await tr.locator('.zh-lang button[data-lang="es"]').click();
  await p.waitForFunction(() => document.querySelector('.zh-translate .zh-tr-target')?.textContent === 'Me gusta aprender chino');
  await tr.locator('.zh-tr-colours').click();
  await p.waitForFunction(() => document.querySelectorAll('.zh-translate .zh-tr-part').length >= 4, null, { timeout: 8000 });
  const pairs = await tr.evaluate((w) => [...w.querySelectorAll('.zh-tr-part')].map((m) => [m.textContent, [...w.querySelectorAll('.zh-tr-word')].find((b) => b.style.getPropertyValue('--zh-c') === m.style.getPropertyValue('--zh-c'))?.textContent]));
  assert.deepEqual(pairs, [['Me', '我'], ['gusta', '喜欢'], ['aprender', '学'], ['chino', '中文']]);
  if (DIR) await p.screenshot({ path: `${DIR}/translate-colours.png` });
  console.log('· translate:', pairs.map(([a, c]) => `${c}=${a}`).join(' '));
  await tr.locator('.pk-window-close').click();
  await p.keyboard.press('Escape');
  await p.waitForFunction((t) => [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item] text')].some((e) => e.textContent.includes(t)), TEXT, { timeout: 8000 });
  assert.equal(await itemCount(p) >= 1, true, 'the box was written');

  // ── Grab over the box: 中 → the bar ──
  await p.evaluate(() => document.querySelector('[data-tool=grab]')?.click());
  const box = await p.locator('.sheet[data-page="0"] .render [data-item] text').first().boundingBox();
  await p.mouse.move(box.x - 10, box.y - 10);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width + 10, box.y + box.height + 10, { steps: 6 });
  await p.mouse.up();
  await p.locator('#grabMenu').waitFor({ state: 'visible' });
  await p.locator('#grabZh').waitFor({ state: 'visible', timeout: 8000 });
  await p.locator('#grabZh').click();
  await bar.waitFor({ state: 'visible' });
  console.log('· grab: 中 shows the bar');
  await p.keyboard.press('Escape');

  // ── Export: pinyin over the Chinese exactly as the view shows it, and the text in the first PNG ──
  await p.evaluate(() => document.querySelector('[data-tool=pan]')?.click());
  const exportOnce = async (kind) => {
    await p.evaluate(() => { document.getElementById('exportOpen').click(); document.getElementById('exportTabExport').click(); });
    await sleep(300);
    if (kind === 'png') await p.evaluate(() => document.getElementById('exportImage').click());
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }),
      p.evaluate((k) => (k === 'svg' ? document.getElementById('svg').click() : [...document.querySelectorAll('#imageTypes button')].find((x) => /PNG/.test(x.textContent)).click()), kind)]);
    const file = path.join(tmpdir(), `zh-export-${Date.now()}.${kind}`);
    await d.saveAs(file);
    await p.keyboard.press('Escape');
    await sleep(200);
    return file;
  };
  // Dark pixels (the text) and coloured ones (pinyin in tone colours) of a PNG.
  const inkOf = (file) => p.evaluate(async (data) => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let dark = 0, colour = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i + 1] + px[i + 2] < 200) dark++; if (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 90) colour++; }
    return { dark, colour };
  }, readFileSync(file).toString('base64'));
  const rubyShown = () => p.evaluate(() => document.getElementById('zhRubyToggle').getAttribute('aria-pressed') === 'true');
  if (await rubyShown()) { await p.evaluate(() => document.getElementById('zhRubyToggle').click()); await sleep(800); }
  const off = await inkOf(await exportOnce('png'));
  assert.ok(off.dark > 100, `the first PNG export has the Chinese text (${off.dark} dark pixels)`);
  assert.equal(off.colour, 0, 'pinyin hidden: none in the PNG');
  assert.doesNotMatch(readFileSync(await exportOnce('svg'), 'utf8'), /zh-ruby/, 'pinyin hidden: none in the SVG');
  await p.evaluate(() => document.getElementById('zhRubyToggle').click());
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .zh-ruby text').length >= 6, null, { timeout: 8000 });
  assert.match(readFileSync(await exportOnce('svg'), 'utf8'), /^<svg[\s\S]*zh-ruby/, 'pinyin shown: in the SVG (the page SVG, not the PDF raster)');
  assert.ok((await inkOf(await exportOnce('png'))).colour > 50, 'pinyin shown: in the PNG');
  await p.evaluate(() => document.getElementById('zhRubyToggle').click());
  console.log('· export follows the pinyin shown or hidden; the first PNG has its text');

  // ── A PDF with Chinese: Shift + right-click on a character, and the bar for a selection ──
  const tmp = mkdtempSync(path.join(tmpdir(), 'zh-pdf-'));
  const pdfPath = path.join(tmp, 'chinese.pdf');
  const maker = await ctx.newPage();
  await maker.setContent(`<html><body style="font: 32px 'WenQuanYi Zen Hei', 'Noto Sans CJK SC', sans-serif; padding: 60px">${TEXT}。</body></html>`);
  await maker.pdf({ path: pdfPath, format: 'A4' });
  await maker.close();
  await p.close();
  const q = await ctx.newPage();
  q.on('pageerror', (e) => errors.push(e.message));
  await openReader(q, server.origin);
  await q.setInputFiles('#file', pdfPath);
  await q.locator('.sheet[data-page="0"] .render').waitFor();
  await q.evaluate(() => document.querySelector('[data-tool=pan]')?.click());
  await q.waitForSelector('.sheet[data-page="0"] .text-layer text', { state: 'attached', timeout: 15000 });
  await sleep(300);
  const pt = await q.evaluate(() => {
    const el = [...document.querySelectorAll('.sheet[data-page="0"] .text-layer text')].find((e) => e.textContent.includes('学'));
    const i = el.textContent.indexOf('学'), r = el.getExtentOfChar(i), m = el.getScreenCTM();
    const q = new DOMPoint(r.x + r.width / 2, r.y + r.height / 2).matrixTransform(m);
    return [q.x, q.y];
  });
  await q.keyboard.down('Shift');
  await q.mouse.click(pt[0], pt[1], { button: 'right' });
  await q.keyboard.up('Shift');
  await q.waitForFunction(() => document.querySelector('.zh-lookup .zh-lk-char')?.textContent === '学', null, { timeout: 8000 });
  if (DIR) await q.screenshot({ path: `${DIR}/pdf-shift-right-click.png` });
  await q.locator('.zh-lookup .pk-window-close').click();
  console.log('· PDF: Shift + right-click on 学 opens its panel');
  // Select the PDF's text with the mouse: the bar.
  await q.mouse.move(pt[0] - 70, pt[1]);
  await q.mouse.down();
  await q.mouse.move(pt[0] + 40, pt[1], { steps: 8 });
  await q.mouse.up();
  await q.locator('.zh-select-bar').waitFor({ state: 'visible', timeout: 5000 });
  if (DIR) await q.screenshot({ path: `${DIR}/pdf-selection-bar.png` });
  console.log('· PDF: selecting Chinese shows the bar');
  rmSync(tmp, { recursive: true, force: true });
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('chinese_translate_e2e: ok');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await b.close();
  process.exit();
}
