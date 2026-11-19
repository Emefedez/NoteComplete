// Browser check of Chinese input (Chromium; docs/CHINESE-INPUT.md §11): Pinyin mode turns
// tone digits into marks with no dictionary; Hanzi mode nihao + Space → 你好; Esc with pinyin
// typed keeps the text box open; a click on a candidate keeps the focus; on a phone (390×844)
// the menu docks as a strip. With FAKE_CLIENT=1 (or before chinese/client.js exists) the
// dictionary is a small stand-in served in its place.
//   node tools/chinese_ime_e2e.mjs [screenshot folder]
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, startReader, openReader, samplePath as sample, READER_ROOT } from './e2e_common.mjs';

const shots = process.argv[2] || null;
const fake = process.env.FAKE_CLIENT === '1' || !existsSync(READER_ROOT + 'chinese/client.js');
const FAKE = `const W = {
  nihao: [['你好','nǐ hǎo',5,1],['你','nǐ',2,1],['尼','ní',2,4],['泥','ní',2,5]],
  ni: [['你','nǐ',2,1],['呢','ne',2,1],['尼','ní',2,4]], n: [['你','nǐ',1,1]], nih: [['你好','nǐ hǎo',3,1]], niha: [['你好','nǐ hǎo',4,1]],
  hao: [['好','hǎo',3,1],['号','hào',3,1]], h: [['好','hǎo',1,1]], ha: [['哈','hā',2,2]],
};
export function chinese() { return {
  async candidates(input) { await new Promise((r) => setTimeout(r, 5)); return { reading: '', rest: '', items: (W[input] || []).map(([text, pinyin, consumed, level]) => ({ text, pinyin, consumed, level, gloss: '', sentence: false })) }; },
  async choose() {}, async packs() { return [{ id: 'core', name: 'Common (HSK 1–3)', bundled: true, installed: true, words: 36000, bytes: 300000 }, { id: 'hsk4', name: 'HSK 4', bundled: false, installed: false, words: 1000, bytes: 40000 }]; },
}; }`;

const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const shot = async (p, name) => { if (shots) await p.screenshot({ path: `${shots}/${name}.png` }); };

async function open(viewport, mobile = false) {
  const ctx = await b.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  if (fake) await p.route('**/chinese/client.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', sample('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(600);
  await p.evaluate(() => document.querySelector('[data-tool=text]').click());
  return p;
}
async function newBox(p, x, y) {
  const s = await p.locator('.sheet').first().boundingBox();
  await p.mouse.click(s.x + x, s.y + y);
  await p.waitForSelector('.text-editor');
  await sleep(200);
}
const value = (p) => p.evaluate(() => document.querySelector('.text-editor')?.value);
const mode = (p) => p.evaluate(() => document.querySelector('.text-editor')?.__zhIme?.mode);
const menuShown = (p) => p.evaluate(() => !!document.querySelector('.zh-ime:not([hidden])'));

try {
  const p = await open({ width: 1200, height: 800 });
  await newBox(p, 140, 140);
  assert.equal(await p.locator('#textFormat .zh-toggle').count(), 1, 'the 中 button in the format bar');
  await p.keyboard.press('Control+Shift+Space');
  assert.equal(await mode(p), 'hanzi');
  await p.keyboard.press('Control+Shift+Space');
  assert.equal(await mode(p), 'pinyin');
  await p.keyboard.type('ni3hao3 Zhong1guo2 lv4');
  assert.equal(await value(p), 'nǐhǎo Zhōngguó lǜ');
  console.log('· Pinyin mode: ni3hao3 → nǐhǎo, with no dictionary');
  await p.keyboard.type(' ma');
  await sleep(100);
  assert.ok(await menuShown(p), 'the reading shows at the caret');
  await shot(p, 'pinyin-reading');
  await p.keyboard.press('Escape');
  await sleep(300);
  assert.equal(await p.locator('.text-editor').count(), 1, 'Esc with pinyin typed keeps the box open');
  assert.equal(await value(p), 'nǐhǎo Zhōngguó lǜ ');
  assert.ok(!(await menuShown(p)));
  console.log('· Esc clears the pinyin and keeps the text box');

  // Hanzi mode: Ctrl+Shift+Space twice more (Pinyin → Off → Hanzi).
  await p.keyboard.press('Control+Shift+Space');
  await p.keyboard.press('Control+Shift+Space');
  assert.equal(await mode(p), 'hanzi');
  await p.keyboard.type('nihao');
  await p.waitForSelector('.zh-ime li[data-i]', { timeout: 8000 });
  await sleep(150);
  await shot(p, 'hanzi-menu');
  const box = await p.evaluate(() => { const m = document.querySelector('.zh-ime').getBoundingClientRect(), a = document.querySelector('.text-editor').getBoundingClientRect(); return { m: [m.left, m.top], a: [a.left, a.top, a.bottom] }; });
  assert.ok(box.m[1] >= box.a[1] && box.m[1] < box.a[2] + 80, `the menu is at the caret line (${JSON.stringify(box)})`);
  await p.keyboard.press(' ');
  await sleep(200);
  assert.equal(await value(p), 'nǐhǎo Zhōngguó lǜ 你好');
  console.log('· Hanzi mode: nihao + Space → 你好');
  await p.keyboard.type('ni');
  await p.waitForFunction(() => document.querySelector('.zh-ime li[data-i="1"]') && document.querySelector('.zh-ime-reading')?.textContent.includes('n'), null, { timeout: 8000 });
  await sleep(150);
  const second = await p.evaluate(() => document.querySelector('.zh-ime li[data-i="1"] ruby').firstChild.textContent);
  await p.click('.zh-ime li[data-i="1"]');
  await sleep(300);
  assert.equal(await p.evaluate(() => document.activeElement?.className), 'text-editor', 'the box keeps the focus');
  assert.equal(await p.locator('.text-editor').count(), 1, 'the box is still open');
  assert.ok((await value(p)).endsWith('你好' + second), await value(p));
  console.log('· a click on a candidate chooses it and keeps the focus');
  await p.keyboard.type('hao');
  await p.waitForSelector('.zh-ime li[data-i]');
  // A digit right after pinyin is a tone; Tab moves the highlight, Space chooses it.
  await p.keyboard.press('Tab');
  await p.keyboard.press(' ');
  await sleep(150);
  const third = await p.evaluate(() => document.querySelector('.text-editor').value.slice(-1));
  assert.ok(/\p{Script=Han}/u.test(third) && third !== '好', 'Tab + Space: the second candidate');
  await p.keyboard.type(',');
  assert.ok((await value(p)).endsWith(third + '，'), 'full-width comma');
  // Hold Space, press 2, release: candidate 2 (你, "ni"); "hao" is left to choose, then a Space tap.
  const before = await value(p);
  await p.keyboard.type('nihao');
  await p.waitForFunction(() => document.querySelector('.zh-ime li[data-i="1"] ruby')?.firstChild.textContent === '你' && document.querySelector('.zh-ime-reading')?.textContent.includes('hao'), null, { timeout: 8000 });
  assert.ok(await p.isVisible('.zh-ime-keys'), 'the Space+1–9 hint');
  await p.keyboard.down(' ');
  await p.keyboard.press('2');
  await sleep(50);
  assert.equal(await value(p), before, 'nothing written while Space is held');
  await p.keyboard.up(' ');
  await sleep(200);
  assert.equal(await value(p), before, 'the release adds nothing; 你 waits for the rest');
  assert.ok((await p.textContent('.zh-ime-reading')).startsWith('你'), 'the chosen part shows in the menu');
  await p.waitForSelector('.zh-ime li[data-i]');
  await sleep(150);
  const rest = await p.evaluate(() => document.querySelector('.zh-ime li[data-i="0"] ruby').firstChild.textContent);
  await p.keyboard.press(' ');
  await sleep(200);
  assert.equal(await value(p), before + '你' + rest);
  console.log(`· Space held + 2 → 你, then Space → ${rest}`);
  // ma3 + Space: a third-tone character.
  await p.keyboard.type('ma3');
  await p.waitForFunction(() => document.querySelector('.zh-ime-reading')?.textContent.includes('mǎ') && document.querySelector('.zh-ime li[data-i="0"] rt'), null, { timeout: 8000 });
  await sleep(150);
  const [ma, maPy] = await p.evaluate(() => { const r = document.querySelector('.zh-ime li[data-i="0"] ruby'); return [r.firstChild.textContent, r.querySelector('rt').textContent]; });
  assert.ok(/ǎ/.test(maPy), `third tone (${ma} ${maPy})`);
  await p.keyboard.press(' ');
  await sleep(200);
  assert.ok((await value(p)).endsWith(ma), await value(p));
  console.log(`· ma3 + Space → ${ma} (${maPy})`);
  // Number keys while the menu is up never pick tools.
  await p.keyboard.type('ni');
  await p.waitForSelector('.zh-ime:not([hidden])');
  // Shift alone: Latin letters for now.
  await p.keyboard.press('Escape');
  await p.keyboard.press('Shift');
  await p.keyboard.type('ok');
  assert.ok((await value(p)).endsWith(ma + 'ok'), await value(p));
  await p.keyboard.press('Shift');
  // Esc on an empty buffer finishes the box as before.
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.text-editor'), null, { timeout: 5000 });
  console.log('· Shift alone types Latin; Esc with nothing typed still finishes the box');
  await sleep(1200);
  await shot(p, 'committed');
  // The mode is kept for the note's next box.
  await newBox(p, 140, 300);
  assert.equal(await mode(p), 'hanzi');
  await p.keyboard.press('Escape');

  // Phone: the menu docks above the keyboard.
  const q = await open({ width: 390, height: 844 }, true);
  await newBox(q, 60, 120);
  await q.keyboard.press('Control+Shift+Space');
  await q.keyboard.type('nihao');
  await q.waitForSelector('.zh-ime li[data-i]', { timeout: 8000 });
  await sleep(200);
  const dock = await q.evaluate(() => { const m = document.querySelector('.zh-ime'); const r = m.getBoundingClientRect(); return { docked: m.classList.contains('zh-ime-docked'), left: r.left, width: r.width, bottom: r.bottom, h: innerHeight }; });
  assert.ok(dock.docked && dock.left === 0 && dock.width === 390 && Math.abs(dock.bottom - dock.h) < 2, JSON.stringify(dock));
  await shot(q, 'phone-docked');
  console.log('· phone: the strip docks at the bottom, full width');

  // The notes panel: written through TinyMDE (one change, as collab needs).
  await p.evaluate(() => document.getElementById('notesToggle').click());
  await p.waitForSelector('#notesEditor .TinyMDE', { timeout: 10000 });
  await p.evaluate(() => { if (document.getElementById('notesPreview').getAttribute('aria-pressed') === 'true') document.getElementById('notesPreview').click(); });
  await p.waitForSelector('#notesEditor .TinyMDE');
  await p.click('#notesEditor .TinyMDE');
  await p.keyboard.press('Control+End');
  if (await p.evaluate(() => document.querySelector('#notesEditor .TinyMDE').__zhIme.mode) !== 'hanzi') await p.keyboard.press('Control+Shift+Space');
  await p.keyboard.type('nihao');
  await p.waitForSelector('.zh-ime li[data-i]', { timeout: 8000 });
  await shot(p, 'notes-menu');
  await p.keyboard.press(' ');
  await sleep(300);
  assert.ok((await p.evaluate(() => document.querySelector('#notesEditor .TinyMDE').textContent)).includes('你好'), 'notes got 你好');
  assert.equal(await p.locator('#notesPanel .zh-toggle').count(), 1);
  console.log('· notes panel: nihao + Space → 你好 through the editor');
  // Settings → Chinese.
  await p.evaluate(() => document.getElementById('zhSettingsOpen').click());
  await p.waitForSelector('.zh-settings[open] .zh-pack');
  await sleep(200);
  await shot(p, 'settings');
  assert.ok(await p.locator('.zh-settings .zh-pack').count() >= 1);
  console.log('· Settings → Chinese lists the dictionaries');
  assert.deepEqual(errors, []);
  console.log(`Chinese input: all checks passed${fake ? ' (stand-in dictionary)' : ''}.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
