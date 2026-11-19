// Browser check of the character panel, conversion and vocabulary cards (docs/CHINESE-INPUT.md
// §8, §10): right-click on 好 in a page text box → "Look up 你好" / "Look up 好" on top of the
// item menu; the panel shows the readings, the meaning, the stroke animation, and a component
// opens its own look-up (← goes back); a card goes into a deck; the box's words become
// vocabulary cards; the deck exports in the Chinese Anki layouts and has writing practice; the
// box converts to traditional; a look-up from a card in the (modal) deck dialog shows over it;
// a phone shows the panel as a bottom sheet. Needs a web build with vendor/chinese.
//   node tools/chinese_lookup_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] || '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const TEXT = '你好，我不知道银行在哪里';

async function noteWithText(p) {
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
  await p.keyboard.press('Escape');
  await p.waitForFunction((t) => [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item] text')].some((e) => e.textContent.includes(t)), TEXT, { timeout: 8000 });
  await p.evaluate(() => document.querySelector('#toolbar [data-tool="select"]')?.click());
  await sleep(300);
}
// The screen point of character `i` of the page text box line holding `text`.
const charPoint = (p, text, i) => p.evaluate(([t, k]) => {
  const el = [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item] text')].find((e) => e.textContent.includes(t) && !e.closest('.zh-ruby'));
  const r = el.getExtentOfChar(el.textContent.indexOf(t) + k), m = el.getScreenCTM();
  const q = new DOMPoint(r.x + r.width / 2, r.y + r.height / 2).matrixTransform(m);
  return [q.x, q.y];
}, [text, i]);
const menuLabels = (p) => p.locator('.context-menu').first().locator('button span').allTextContents();
const menuClick = (p, label) => p.locator('.context-menu button', { hasText: label }).first().click();

try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await noteWithText(p);

  // ── Right-click on 好 ──
  const [hx, hy] = await charPoint(p, '你好', 1);
  await p.mouse.click(hx, hy, { button: 'right' });
  await p.locator('.context-menu').waitFor();
  const labels = await menuLabels(p);
  assert.deepEqual(labels.slice(0, 2), ['Look up 你好', 'Look up 好'], `menu: ${labels.join(' | ')}`);
  assert.ok(labels.includes('Edit text'), 'the item menu keeps its entries');
  assert.ok(labels.some((l) => l.startsWith('Convert this text box')) && labels.some((l) => l.startsWith('Make vocabulary cards')));
  if (DIR) await p.screenshot({ path: `${DIR}/zh-menu.png` });
  await menuClick(p, 'Look up 好');
  const win = p.locator('.zh-lookup');
  await win.locator('.zh-lk-readings').waitFor();
  await win.locator('.hz-stage svg [data-i]').first().waitFor({ state: 'attached', timeout: 10000 });
  const readings = await win.locator('.zh-lk-reading').allTextContents();
  assert.match(readings[0], /^hǎo/, `the reading used here first: ${readings}`);
  assert.ok(readings.length >= 2, 'every reading');
  assert.equal(await win.locator('.zh-lk-reading.here .zh-t3').count(), 1, 'tone 3 colour');
  assert.match(await win.locator('.zh-lk-meanings').textContent(), /good/);
  assert.match(await win.locator('.zh-lk-level').first().textContent(), /HSK 1/);
  assert.equal(await win.locator('.hz-stage svg [data-i]').count(), 6, '好 has 6 strokes');
  await sleep(900);
  const drawn = await win.locator('.hz-stage svg [data-i]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('stroke-dashoffset')) < Number(e.dataset.len)));
  assert.ok(drawn.some(Boolean), 'the animation plays');
  if (DIR) await p.screenshot({ path: `${DIR}/zh-panel.png` });
  console.log('· panel:', readings.join(' / '), '·', (await win.locator('.zh-lk-meanings li').first().textContent()).trim());
  // A part of 好 (女) opens its own look-up; ← goes back.
  await win.locator('.zh-lk-section:has(summary:text-is("Structure")) .zh-lk-link', { hasText: '女' }).first().click();
  await p.waitForFunction(() => document.querySelector('.zh-lookup .zh-lk-char')?.textContent === '女');
  await win.locator('.zh-lk-back').click();
  await p.waitForFunction(() => document.querySelector('.zh-lookup .zh-lk-char')?.textContent === '好');
  // Words with it, opened.
  await win.locator('.zh-lk-section summary', { hasText: 'Words with' }).click();
  await win.locator('.zh-lk-words li').nth(9).waitFor();
  if (DIR) await win.screenshot({ path: `${DIR}/zh-panel-words.png` });
  // Add to flashcards → a new deck.
  await win.locator('button', { hasText: 'Flashcard' }).click();
  await menuClick(p, 'New deck');
  await p.waitForFunction(() => /added to “Chinese vocabulary”/.test(document.body.textContent), null, { timeout: 5000 });
  console.log('· 好 added to a new deck');
  await win.locator('.pk-window-close').click();

  // ── Vocabulary cards from the text box ──
  await p.mouse.click(hx, hy, { button: 'right' });
  await menuClick(p, 'Make vocabulary cards');
  const vocab = p.locator('.zh-vocab');
  await vocab.locator('.zh-vocab-list li').first().waitFor({ timeout: 10000 });
  const words = await vocab.locator('.zh-vocab-han').allTextContents();
  assert.ok(words.includes('银行') && words.includes('你好'), `words: ${words}`);
  if (DIR) await p.screenshot({ path: `${DIR}/zh-vocab.png` });
  // HSK 1 off: fewer words.
  const before = await vocab.locator('.zh-vocab-list li').count();
  await vocab.locator('.zh-vocab-levels .chip', { hasText: 'HSK 1' }).click();
  assert.ok(await vocab.locator('.zh-vocab-list li').count() < before, 'filtered by level');
  await vocab.locator('.zh-vocab-levels .chip', { hasText: 'HSK 1' }).click();
  await vocab.locator('.zh-vocab-deck select').selectOption({ label: /Chinese vocabulary/ }).catch(async () => {
    const v = await vocab.locator('.zh-vocab-deck select option').nth(1).getAttribute('value');
    await vocab.locator('.zh-vocab-deck select').selectOption(v);
  });
  await vocab.locator('button.primary').click();
  await p.locator('#deckDialog[open]').waitFor();
  const fronts = await p.locator('#deckCards .deck-card-front').allTextContents();
  const backs = await p.locator('#deckCards .deck-card-back').allTextContents();
  assert.equal(fronts[0], '好');
  assert.ok(fronts.includes('银行'));
  assert.match(backs[fronts.indexOf('银行')], /^yín háng — .+ · HSK \d/);
  console.log('· deck:', fronts.length, 'cards; 银行 →', backs[fronts.indexOf('银行')]);
  if (DIR) await p.screenshot({ path: `${DIR}/zh-deck.png` });
  // Anki: the Chinese layouts.
  await p.locator('#deckExport').click();
  const anki = await menuLabels(p);
  assert.ok(anki.some((l) => /ruby/.test(l)) && anki.some((l) => /furigana/.test(l)) && anki.some((l) => /Hanzi \/ Pinyin \/ Meaning/.test(l)), anki.join(' | '));
  if (DIR) await p.screenshot({ path: `${DIR}/zh-anki-menu.png` });
  const [download] = await Promise.all([p.waitForEvent('download'), menuClick(p, 'Hanzi / Pinyin / Meaning')]);
  const file = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  assert.match(file, /#columns:Hanzi\tPinyin\tMeaning\tTags/);
  assert.match(file, /\n银行\tyín háng\t[^\t]+\tHSK\d/);
  console.log('· Anki 3-field export:', file.split('\n').find((l) => l.startsWith('银行')));
  // A look-up from a card, in the modal deck dialog: the panel shows over it.
  const card = p.locator('#deckCards .deck-card-front', { hasText: '银行' });
  const box = await card.boundingBox();
  await p.mouse.click(box.x + 6, box.y + box.height / 2, { button: 'right' });
  await p.locator('.context-menu').waitFor();
  assert.equal((await menuLabels(p))[0], 'Look up 银行');
  await menuClick(p, 'Look up 银行');
  await p.locator('#deckDialog .zh-lookup .zh-lk-readings').waitFor();
  assert.match(await p.locator('#deckDialog .zh-lookup .zh-lk-readings').textContent(), /yín háng/);
  if (DIR) await p.screenshot({ path: `${DIR}/zh-card-lookup.png` });
  await p.locator('#deckDialog .zh-lookup .pk-window-close').click();
  // Writing practice over the deck's characters.
  await p.locator('#deckList button', { hasText: 'Writing practice' }).click();
  await p.locator('.zh-writing .hz-practice svg').waitFor({ timeout: 10000 });
  assert.match(await p.locator('.zh-writing-progress').textContent(), /^1 of \d+/);
  if (DIR) await p.screenshot({ path: `${DIR}/zh-writing.png` });
  await p.locator('.zh-writing button', { hasText: 'Back to the cards' }).click();
  await p.locator('#deckClose').click();
  console.log('· export menu, look-up in a card, writing practice');

  // ── Convert the box to traditional ──
  await p.mouse.click(hx, hy, { button: 'right' });
  await menuClick(p, 'Convert this text box');
  const conv = p.locator('.zh-window:has(.zh-cv-preview)');
  await p.waitForFunction(() => /銀行/.test(document.querySelector('.zh-cv-preview')?.textContent || ''), null, { timeout: 8000 });
  if (DIR) await p.screenshot({ path: `${DIR}/zh-convert.png` });
  await conv.locator('button.primary').click();
  await p.waitForFunction(() => [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item] text')].some((e) => e.textContent.includes('銀行')), null, { timeout: 8000 });
  console.log('· converted to traditional on the page');
  // Convert one occurrence back from the panel.
  const [gx, gy] = await charPoint(p, '銀行', 0);
  await p.mouse.click(gx, gy, { button: 'right' });
  await menuClick(p, 'Look up 銀');
  await win.locator('button', { hasText: 'Convert here to 银' }).click({ timeout: 8000 });
  await p.waitForFunction(() => [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item] text')].some((e) => e.textContent.includes('银行')), null, { timeout: 8000 });
  console.log('· one occurrence converted from the panel');
  await win.locator('.pk-window-close').click();

  // ── The notes: a selection converted in the editor; a look-up in the preview ──
  await p.evaluate(() => document.getElementById('notesToggle').click());
  const md = p.locator('#notesEditor .TinyMDE');
  await md.waitFor();
  await md.click();
  await p.keyboard.insertText('我的头发很干净');
  await sleep(300);
  await p.evaluate(() => { const n = [...document.querySelectorAll('#notesEditor .TinyMDE *')].map((e) => e.firstChild).find((t) => t?.nodeType === 3 && t.data.includes('头发')); const r = document.createRange(); r.setStart(n, n.data.indexOf('头发')); r.setEnd(n, n.data.indexOf('头发') + 5); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const sel = await p.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.mouse.click(sel[0], sel[1], { button: 'right' });
  await p.locator('.context-menu').waitFor();
  assert.ok((await menuLabels(p)).includes('Convert simplified ↔ traditional…'));
  await menuClick(p, 'Convert simplified');
  await p.waitForFunction(() => /頭髮很乾淨/.test(document.querySelector('.zh-cv-preview')?.textContent || ''), null, { timeout: 8000 });
  await p.locator('.zh-window:has(.zh-cv-preview) button.primary').click();
  await p.waitForFunction(() => /我的頭髮很乾淨/.test(document.querySelector('#notesEditor .TinyMDE').textContent), null, { timeout: 5000 });
  console.log('· notes: selection converted:', (await md.textContent()).trim());
  await p.evaluate(() => document.getElementById('notesPreview').click());
  const rendered = p.locator('#notesRender');
  await rendered.locator('text=很').first().waitFor();
  const pt = await rendered.evaluate((r) => { const w = document.createTreeWalker(r, 4); for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.data.indexOf('很'); if (i >= 0) { const g = document.createRange(); g.setStart(n, i); g.setEnd(n, i + 1); const b = g.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; } } return null; });
  await p.mouse.click(pt[0], pt[1], { button: 'right' });
  await p.locator('.context-menu').waitFor();
  const prevLabels = await menuLabels(p);
  assert.ok(prevLabels.includes('Look up 很'), prevLabels.join(' | '));
  await menuClick(p, 'Look up 很');
  await p.waitForFunction(() => document.querySelector('.zh-lookup .zh-lk-char')?.textContent === '很');
  console.log('· notes preview: look up', prevLabels.join(' | '));
  if (DIR) await p.screenshot({ path: `${DIR}/zh-notes.png` });
  await win.locator('.pk-window-close').click();

  // ── A phone: a bottom sheet ──
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const q = await phone.newPage();
  q.on('pageerror', (e) => errors.push(e.message));
  await noteWithText(q);
  await q.evaluate(async () => { const m = await import('./chinese/zh-menu.js'); await m.lookUp('好'); });
  const sheet = q.locator('.zh-lookup.zh-sheet');
  await sheet.locator('.hz-stage svg').waitFor({ timeout: 10000 });
  const r = await sheet.boundingBox();
  assert.ok(Math.abs(r.y + r.height - 844) < 2 && r.width >= 388, `a bottom sheet: ${JSON.stringify(r)}`);
  await sleep(600);
  if (DIR) await q.screenshot({ path: `${DIR}/zh-phone.png` });
  console.log('· phone: bottom sheet');
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('Chinese look-up e2e passed');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await b.close();
  process.exit();
}
