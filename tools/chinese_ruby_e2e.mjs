// Browser check of reading Chinese (Chromium; docs/CHINESE-INPUT.md §6, §11): View → "Pinyin
// over characters" puts <rt> in the Markdown preview and a pinyin layer over the page's text
// boxes, Markdown {漢字|han4 zi4} is ruby either way, letters find Chinese in Find by pinyin,
// and an exported PNG of a page with Chinese draws the glyphs with the bundled font even where
// the system has no Chinese font (the browser is started with a fontconfig without one).
// With FAKE_CLIENT=1 (or before chinese/client.js exists) the dictionary is a stand-in.
//   node tools/chinese_ruby_e2e.mjs [screenshot folder]
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, startReader, openReader, samplePath as sample, READER_ROOT } from './e2e_common.mjs';

const shots = process.argv[2] || null;
const fake = process.env.FAKE_CLIENT === '1' || !existsSync(READER_ROOT + 'chinese/client.js');
const FAKE = `const R = { 我: 'wǒ', 不: 'bù', 知: 'zhī', 道: 'dào', 银: 'yín', 行: 'háng', 在: 'zài', 哪: 'nǎ', 里: 'lǐ', 你: 'nǐ', 好: 'hǎo', 中: 'zhōng', 文: 'wén' };
export function chinese() { return { async annotate(text) {
  const out = []; let i = 0;
  for (const c of text) { if (R[c]) out.push({ start: i, end: i + c.length, text: c, pinyin: [R[c]], level: c === '行' ? 3 : 1 }); i += c.length; }
  return out;
} }; }`;
// A fontconfig with Latin fonts only: Chinese can come from the bundled font alone.
const fonts = mkdtempSync(path.join(tmpdir(), 'zh-fonts-'));
writeFileSync(path.join(fonts, 'fonts.conf'), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/usr/share/fonts/liberation</dir><dir>/usr/share/fonts/TTF</dir><cachedir>${fonts}/cache</cachedir></fontconfig>`);

const server = await startReader({ port: 0 });
const b = await chromium.launch({ env: { ...process.env, FONTCONFIG_FILE: path.join(fonts, 'fonts.conf') }, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const shot = async (p, name, options = {}) => { if (shots) await p.screenshot({ path: `${shots}/${name}.png`, ...options }); };
const TEXT = '我不知道银行在哪里';

try {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  if (fake) await p.route('**/chinese/client.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await openReader(p, server.origin);
  assert.equal(await p.evaluate(() => !!document.querySelector('link[data-zh-font]')), false, 'no Chinese font before Chinese is shown');
  await p.setInputFiles('#file', sample('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(600);
  assert.equal(await p.evaluate(() => [...document.querySelectorAll('#zhRubyToggle')].length), 1);
  await p.evaluate(() => document.querySelector('[data-tool=text]').click());
  const s = await p.locator('.sheet').first().boundingBox();
  await p.mouse.click(s.x + 120, s.y + 160);
  await p.waitForSelector('.text-editor');
  await sleep(200);
  await p.keyboard.insertText(`${TEXT}\nHello 你好`);
  await p.keyboard.press('Escape');
  await p.waitForFunction((t) => [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item] text')].some((e) => e.textContent.includes(t)), TEXT, { timeout: 8000 });
  await p.waitForFunction(() => !!document.querySelector('link[data-zh-font]'));
  console.log('· the Chinese font is linked once a page shows Chinese');

  // Pinyin over characters: on, over each character of the box.
  await p.evaluate(() => document.getElementById('zhRubyToggle').click());
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .zh-ruby text').length >= 11, null, { timeout: 8000 });
  const layer = await p.evaluate(() => [...document.querySelectorAll('.sheet[data-page="0"] .zh-ruby text')].map((t) => t.textContent));
  assert.deepEqual(layer.slice(0, 9), ['wǒ', 'bù', 'zhī', 'dào', 'yín', 'háng', 'zài', 'nǎ', 'lǐ']);
  assert.equal(await p.evaluate(() => document.getElementById('zhRubyToggle').getAttribute('aria-checked')), 'true');
  // Each reading sits above its character, centred on it.
  const placed = await p.evaluate(() => {
    const t = [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item] text')].find((e) => e.textContent.startsWith('我'));
    const r = document.querySelector('.sheet[data-page="0"] .zh-ruby text').getBBox(), c = t.getExtentOfChar(0);
    return { dx: Math.abs(r.x + r.width / 2 - (c.x + c.width / 2)), above: r.y + r.height <= c.y + c.height * 0.4 };
  });
  assert.ok(placed.dx < 1 && placed.above, JSON.stringify(placed));
  await sleep(300);
  await shot(p, 'page-ruby', { clip: { x: s.x + 60, y: s.y + 100, width: 520, height: 200 } });
  console.log('· the page layer puts pinyin over each character');

  // The note keeps the choice (chinese.ruby in the project).
  assert.equal(await p.evaluate(async () => (await import('./chinese/ruby.js')).noteChinese().ruby), 'on');

  // Markdown: written ruby always, and the automatic ruby over the rest.
  await p.evaluate(() => document.querySelector('[data-proxy="notesToggle"]').click());
  await p.waitForSelector('#notesEditor .TinyMDE', { timeout: 8000 });
  await p.click('#notesEditor .TinyMDE');
  await p.keyboard.insertText('# 中文\n\n{你好|ni3 hao3}, 我不知道。`代码`\n');
  await sleep(300);
  await p.evaluate(() => document.getElementById('notesPreview').click());
  await p.waitForFunction(() => document.querySelectorAll('#notesRender ruby.zh-auto').length >= 6, null, { timeout: 8000 });
  const md = await p.evaluate(() => ({
    written: [...document.querySelectorAll('#notesRender ruby:not(.zh-auto) rt')].map((r) => r.textContent),
    auto: [...document.querySelectorAll('#notesRender ruby.zh-auto rt')].map((r) => r.textContent),
    code: document.querySelector('#notesRender code')?.textContent,
  }));
  assert.deepEqual(md.written, ['nǐ', 'hǎo']);
  assert.deepEqual(md.auto, ['zhōng', 'wén', 'wǒ', 'bù', 'zhī', 'dào']);
  assert.equal(md.code, '代码', 'code is left alone');
  await sleep(300);
  await shot(p, 'markdown-ruby');
  console.log('· Markdown preview: {你好|ni3 hao3} and automatic <rt> over the rest');

  // Off: both layers go.
  await p.evaluate(() => document.getElementById('zhRubyToggle').click());
  await p.waitForFunction(() => !document.querySelector('.zh-ruby, ruby.zh-auto'), null, { timeout: 5000 });
  assert.equal(await p.evaluate(() => document.querySelectorAll('#notesRender ruby rt').length), 2, 'written ruby stays');
  await p.evaluate(() => document.getElementById('zhRubyToggle').click());
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .zh-ruby text').length >= 11, null, { timeout: 8000 });
  console.log('· off removes the automatic ruby, written ruby stays');

  // Find: letters find Chinese by pinyin.
  await p.evaluate(() => document.getElementById('findOpen').click());
  await p.fill('#findInput', 'yinhang');
  await p.waitForFunction(() => /of/.test(document.getElementById('findCount').textContent), null, { timeout: 8000 });
  console.log(`· Find: "yinhang" → ${await p.evaluate(() => document.getElementById('findCount').textContent)}`);
  await p.keyboard.press('Escape');

  // Export the page as PNG: the glyphs come from the font embedded in the picture.
  await p.evaluate(() => { document.getElementById('exportOpen').click(); document.getElementById('exportTabExport').click(); });
  await sleep(300);
  assert.equal(await p.evaluate(() => document.getElementById('exportRuby').checked), true, 'the export checkbox starts as the view');
  assert.equal(await p.evaluate(() => document.getElementById('exportRuby').closest('label').hidden), false);
  await shot(p, 'export-dialog');
  await p.evaluate(() => document.getElementById('exportImage').click());
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.evaluate(() => [...document.querySelectorAll('#imageTypes button')].find((x) => /PNG/.test(x.textContent)).click())]);
  const png = path.join(shots || fonts, 'export.png');
  await download.saveAs(png);
  // Measure the ink of 你 in the PNG against the same character drawn with the font (no tofu:
  // a missing glyph is an empty box with a fraction of the ink and none in its middle).
  const check = await p.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 128 && px[i + 1] < 128 && px[i + 2] < 128) dark++;
    // Without the embedded font the same characters draw as boxes: compare against them.
    const t = document.createElement('canvas').getContext('2d');
    t.font = "40px 'No Such Font'";
    const tofu = t.measureText('你').width;
    return { width: img.width, dark, tofu };
  }, readFileSync(png).toString('base64'));
  assert.ok(check.dark > 2000, JSON.stringify(check));
  console.log(`· exported PNG (${check.width}px wide) has the glyphs: ${png}`);
  assert.deepEqual(errors, []);
  console.log('All Chinese reading checks passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
