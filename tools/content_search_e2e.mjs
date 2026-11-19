// Browser check of the search inside notes and Batch OCR on Home (Chromium, after a web build):
// a PDF opened once is listed in Recent; the second magnifier searches inside it (Index… reads
// it first), a match opens it with Find on the words; Batch OCR selects only documents it can
// read and its dialog lists them with their ticks.
//   node tools/content_search_e2e.mjs [screenshots folder]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
try {
  const context = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: DIR ? 2 : 1 });
  context.setDefaultTimeout(30000);
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);

  // 1. A scanned PDF and a note with typed text opened once: both in Recent.
  for (const name of ['Examen wuolah.pdf', 'texto.noteful']) {
    await p.setInputFiles('#file', samplePath(name));
    await p.waitForSelector('.sheet[data-page="0"] .render');
    await p.keyboard.press('Control+s');
    // An unchanged .noteful has nothing to save; opening it lists it in Recent already.
    await p.waitForFunction(() => /^Saved /.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  }
  await p.click('#homeButton');
  await p.waitForFunction(() => document.querySelectorAll('#recentList .note-card').length >= 2);
  console.log('· two documents in Recent');

  // 2. Search inside: nothing kept for the PDF yet → Index…, then it is found.
  await p.click('#recentContentSearch');
  assert.equal(await p.getAttribute('#recentContentSearch', 'aria-pressed'), 'true');
  await p.fill('#recentSearch', 'bocadillo');
  await p.press('#recentSearch', 'Enter');
  await p.waitForFunction(() => /not searched yet|matches? in/.test(document.getElementById('contentSummary').textContent));
  if (await p.isVisible('#contentIndex')) {
    await p.click('#contentIndex');
    await p.waitForFunction(() => /match/.test(document.getElementById('contentSummary').textContent) && !/not searched yet/.test(document.getElementById('contentSummary').textContent), null, { timeout: 60000 });
  }
  const summary = await p.textContent('#contentSummary');
  assert.match(summary, /\d+ match(es)? in \d+ notes?/, summary);
  const shown = await p.$$eval('#recentList li:not([hidden]) .note-card strong', (n) => n.map((x) => x.textContent));
  assert.ok(shown.length && shown.every((n) => n === 'texto'), `only the typed note: ${shown}`);
  if (DIR) await p.screenshot({ path: DIR + 'content-search.png' });
  console.log(`· search inside notes: ${summary}`);

  // 3. A match opens the note with Find on the words.
  await p.click('#contentList .content-hit');
  await p.waitForSelector('#findBar:not([hidden])');
  assert.equal(await p.inputValue('#findInput'), 'bocadillo');
  await p.waitForFunction(() => /of \d+/.test(document.getElementById('findCount').textContent));
  console.log(`· the match opens the note with Find: ${await p.textContent('#findCount')}`);
  await p.click('#homeButton');

  // 4. Esc leaves the mode: the name search is back.
  await p.fill('#recentSearch', '');
  await p.press('#recentSearch', 'Escape');
  assert.equal(await p.getAttribute('#recentContentSearch', 'aria-pressed'), 'false');
  assert.equal(await p.isHidden('#contentResults'), true);

  // 5. Batch OCR: every document selectable, the dialog lists the chosen ones; transcribe hides.
  const count = await p.$$eval('#recentList .note-card', (c) => c.length);
  await p.click('#batchOcrMode');
  await p.waitForFunction((n) => document.querySelectorAll('#recentList .note-card.has-items').length === n, count)
    .catch(async (e) => { throw Error(`${e.message}: ${JSON.stringify(await p.$$eval('#recentList .note-card', (c) => c.map((x) => [x.className, x.noteEntry?.name])))}`); });
  assert.equal(await p.isHidden('#batchTranscribeMode'), true);
  await p.click('#batchOcrSelectAll');
  assert.match(await p.textContent('#batchOcrStart'), new RegExp(`Recognize \\(${count} notes\\)`));
  await p.click('#batchOcrStart');
  await p.waitForSelector('#batchOcrDialog[open]');
  assert.equal(await p.$$eval('#boNotesList .bt-note-head.is-selected', (n) => n.length), count);
  if (DIR) await p.screenshot({ path: DIR + 'batch-ocr-dialog.png' });
  const box = await p.$eval('#batchOcrDialog', (d) => ({ w: d.clientWidth, h: d.clientHeight, scroll: d.scrollHeight > d.clientHeight + 1 }));
  assert.equal(box.scroll, false, 'the dialog fits without scrolling');
  await p.click('#boClose');
  await p.click('#batchOcrCancel');
  assert.equal(await p.isVisible('#batchTranscribeMode'), true);
  console.log('· Batch OCR selects documents, its dialog lists them and fits without scrolling');

  // 6. Batch transcribe still selects only notes with audio (none here).
  await p.click('#batchTranscribeMode');
  await p.waitForFunction((n) => document.querySelectorAll('#recentList .note-card.no-items').length === n, count);
  await p.click('#batchTranscribeCancel');
  console.log('· Batch transcribe greys out notes without recordings');

  assert.deepEqual(errors, []);
  console.log('Search inside notes and Batch OCR: all checks passed.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await b.close();
  server.close?.();
}
