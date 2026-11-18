// Browser check of Edit PDF (Chromium, after a web build; docs/PDF-EDITOR.md):
// - a note with PDF pages (Practice book): the tool outlines the page's text blocks; a
//   double-click turns the largest into a text box in the PDF's own embedded font, open for
//   typing; the page's background becomes a one-page PDF without that text; typed text stays;
//   one undo puts the PDF's text back;
// - a PDF whose letters are drawn as shapes (Examen wuolah.pdf) says it has no text to edit.
//   node tools/pdf_edit_e2e.mjs [screenshots folder]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('Practice book (vol. 1).noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await p.fill('#pageNumber', '2');
  await p.press('#pageNumber', 'Enter');
  await sleep(1500);
  const sel = '.sheet[data-page="1"]';
  const textItems = () => p.locator(`${sel} .render [data-item^="image:"] text`).count();
  // The blocks outlined now (after moving the pointer over the page, which reads them).
  const outlined = async (dy = 150) => {
    await p.mouse.move(sheet.x + sheet.width * 0.4, Math.max(sheet.y, 150) + dy);
    await p.waitForSelector(`${sel} .pdf-edit-layer rect`);
    return p.locator(`${sel} .pdf-edit-layer rect`).count();
  };

  // 1. Outlines under the pointer.
  await p.click('#toolbar [data-tool="pdfedit"]');
  let sheet = await p.locator(sel).boundingBox();
  const blocks = await outlined();
  assert.ok(blocks >= 8, `the page's text in blocks: ${blocks}`);
  if (DIR) await p.screenshot({ path: DIR + 'outlines.png' });
  console.log(`· Edit PDF outlines ${blocks} blocks of the page's text`);

  // 2. A double-click: the block as a text box in the PDF's font, open for typing.
  const boxes = await p.$$eval(`${sel} .pdf-edit-layer rect:not(.object)`, (rs) => rs.map((r) => { const q = r.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; }).filter((q) => q.y > 100 && q.y + q.h < 880));
  const target = boxes.sort((m, n) => n.w * n.h - m.w * m.h)[0];
  await p.mouse.dblclick(target.x + 20, target.y + target.h / 2);
  await p.waitForSelector('.text-editor');
  const editor = await p.$eval('.text-editor', (a) => ({ value: a.value, font: getComputedStyle(a).fontFamily }));
  assert.match(editor.value, /^Libro de prácticas de Arquitectura de Computadores II/, `the block's text: ${editor.value}`);
  assert.ok(editor.value.includes('\n'), 'its lines kept');
  assert.match(editor.font, / pdf[0-9a-f]{8}/, `the PDF's embedded font: ${editor.font}`);
  await p.keyboard.press('Control+End');
  await p.keyboard.type(' Editado.');
  await p.keyboard.press('Escape');
  await p.mouse.click(sheet.x + 5, Math.max(sheet.y, 150) + 5);
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="1"] .render [data-item^="image:"] text').length > 0);
  await sleep(800);
  const typed = await p.$$eval(`${sel} .render [data-item^="image:"] tspan`, (ts) => ts.map((t) => t.textContent).join('\n'));
  assert.match(typed, /Editado\.$/, `typed text kept: ${typed}`);
  assert.equal(await outlined(160), blocks - 1, 'the PDF behind no longer has that text');
  if (DIR) await p.screenshot({ path: DIR + 'converted.png' });
  console.log('· a double-click makes the block a text box in the PDF\'s font; the PDF behind loses that text');

  // 2b. Saved, reloaded and opened from Recent: the box is still drawn in the PDF's font.
  const family = editor.font.match(/"([^"]+ pdf[0-9a-f]{8})"/)[1];
  await p.keyboard.press('Control+s');
  await p.waitForFunction(() => !document.getElementById('saveState').classList.contains('dirty'), null, { timeout: 15000 });
  await p.reload();
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.waitForSelector('#recentList .note-card');
  await p.click('#recentList .note-card:has-text("Practice book")');
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await p.fill('#pageNumber', '2');
  await p.press('#pageNumber', 'Enter');
  await p.waitForFunction((f) => [...document.fonts].some((face) => face.family.replace(/"/g, '') === f && face.status === 'loaded'), family, { timeout: 20000 });
  console.log(`· saved and reopened: ${family} is loaded again from the page's PDF`);
  await p.click('#toolbar [data-tool="pdfedit"]');
  await sleep(1000);
  sheet = await p.locator(sel).boundingBox();

  // 3. Undo (the typing, then the conversion; kept in the saved history): the PDF's text is back.
  await p.keyboard.press('Control+z');
  await sleep(800);
  await p.keyboard.press('Control+z');
  await p.waitForFunction(() => !document.querySelector('.sheet[data-page="1"] .render [data-item^="image:"] text'));
  await sleep(800);
  assert.equal(await textItems(), 0);
  assert.equal(await outlined(170), blocks, 'the original PDF page, all its blocks again');
  console.log('· undo puts the PDF\'s text back');

  // 3b. Objects: the logo (an image) taken out of the PDF as a picture, selected, dragged;
  // one undo puts it back in the PDF.
  const kinds = await p.$$eval(`${sel} .pdf-edit-layer rect.object`, (rs) => rs.map((r) => r.dataset.kind));
  assert.ok(kinds.includes('image') && kinds.includes('drawing'), `objects outlined: ${kinds}`);
  const logo = await p.$eval(`${sel} .pdf-edit-layer rect.object[data-kind="image"]`, (r) => { const q = r.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  await p.mouse.dblclick(logo.x, logo.y);
  await p.waitForFunction(() => document.querySelector('#toolbar [data-tool="select"]').getAttribute('aria-pressed') === 'true');
  await p.waitForSelector(`${sel} .render [data-item^="image:"] image`);
  const picture = p.locator(`${sel} .render [data-item^="image:"]`).first();
  const at = await picture.boundingBox();
  assert.ok(Math.abs(at.x + at.width / 2 - logo.x) < 4 && Math.abs(at.y + at.height / 2 - logo.y) < 4, 'the picture where the image was');
  await p.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await p.mouse.down();
  await p.mouse.move(at.x + at.width / 2 + 120, at.y + at.height / 2 + 30, { steps: 8 });
  await p.mouse.up();
  await sleep(1000);
  const to = await picture.boundingBox();
  assert.ok(Math.abs(to.x - at.x - 120) < 3 && Math.abs(to.y - at.y - 30) < 3, `dragged: ${JSON.stringify([to.x - at.x, to.y - at.y])}`);
  if (DIR) await p.screenshot({ path: DIR + 'object-moved.png' });
  await p.click('#toolbar [data-tool="pdfedit"]');
  assert.equal(await outlined(170), blocks - 1, 'the PDF behind no longer has the image');
  await p.keyboard.press('Control+z');
  await sleep(600);
  await p.keyboard.press('Control+z');
  await p.waitForFunction(() => !document.querySelector('.sheet[data-page="1"] .render [data-item^="image:"]'));
  await sleep(800);
  assert.equal(await outlined(180), blocks, 'undo: the image is in the PDF again');
  console.log('· an image of the PDF becomes a picture to drag; undo puts it back');

  // 4. Text drawn as shapes: nothing to edit, and it says so.
  const q = await b.newPage({ viewport: { width: 1280, height: 900 } });
  q.on('pageerror', (e) => errors.push(e.message));
  await openReader(q, server.origin);
  await q.setInputFiles('#file', samplePath('Examen wuolah.pdf'));
  await q.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(800);
  await q.click('#toolbar [data-tool="pdfedit"]');
  const s0 = await q.locator('.sheet[data-page="0"]').boundingBox();
  await q.mouse.click(s0.x + s0.width / 2, Math.max(s0.y, 150) + 200);
  await q.waitForFunction(() => /no text to edit/.test(document.body.textContent));
  console.log('· a PDF without printed text says there is nothing to edit');

  assert.deepEqual(errors, []);
  console.log('Edit PDF: OK');
} finally {
  await b.close();
  server.close?.();
}
process.exit(0);
