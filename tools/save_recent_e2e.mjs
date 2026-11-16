// Browser check of saving and Recent on the website (Chromium, after a web build):
// a new note saved with Ctrl S is kept in NoteComplete and listed in Recent, reopens from
// there after a reload, and the next save updates that same copy (one Recent entry, no file
// picker). In a browser that cannot write files (no createWritable, as Safari and older
// Android WebViews), an opened note is still kept and listed in Recent.
//   node tools/save_recent_e2e.mjs [screenshots folder]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
const recentNames = (p) => p.locator('#recentList .note-card strong').allTextContents();
const statusText = (p, re) => p.waitForFunction((source) => new RegExp(source).test(document.getElementById('status').textContent), re.source, { timeout: 20000 })
  .catch(async (e) => { throw Error(`${e.message}\nstatus: ${await p.textContent('#status')}`); });
try {
  const context = await b.newContext({ viewport: { width: 1200, height: 900 } });
  // Saving must never fall back to a picker or a download here.
  await context.addInitScript(() => { window.showSaveFilePicker = () => { throw Error('picker opened'); }; });
  context.setDefaultTimeout(20000);
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('download', () => errors.push('a download started'));
  await openReader(p, server.origin);

  // 1. File → New document, Ctrl S: kept in NoteComplete, listed in Recent.
  await p.evaluate(() => document.getElementById('newDocument').click());
  await p.fill('#newName', 'Lecture 4');
  await p.click('#newCreate');
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await p.keyboard.press('Control+s');
  await statusText(p, /Saved Lecture 4\.nfedit in NoteComplete/);
  console.log('· a new note saves into NoteComplete, without a picker or download');

  // 2. After a reload, Recent lists it, and it opens from there.
  await p.reload();
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.waitForFunction(() => [...document.querySelectorAll('#recentList .note-card strong')].some((n) => n.textContent === 'Lecture 4'));
  if (DIR) await p.screenshot({ path: DIR + 'recent.png' });
  await p.click('#recentList .note-card:has-text("Lecture 4")');
  await p.waitForSelector('.sheet[data-page="0"] .render');
  console.log('· Recent lists it after a reload and opens it');

  // 3. Saving again updates the same copy: still one entry.
  await p.keyboard.press('Control+s');
  await statusText(p, /^Saved Lecture 4\.nfedit\.$/);
  await p.click('#homeButton');
  await p.waitForFunction(() => document.querySelectorAll('#recentList .note-card').length > 0);
  assert.deepEqual(await recentNames(p), ['Lecture 4']);
  console.log('· the next save updates it in place: one Recent entry');

  // 4. A browser without createWritable keeps opened notes too.
  const safari = await b.newContext({ viewport: { width: 390, height: 844 } });
  await safari.addInitScript(() => { delete FileSystemFileHandle.prototype.createWritable; });
  safari.setDefaultTimeout(20000);
  const q = await safari.newPage();
  q.on('pageerror', (e) => errors.push(e.message));
  await openReader(q, server.origin);
  await q.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await q.waitForSelector('.sheet[data-page="0"] .render');
  await q.keyboard.press('Control+s');
  await statusText(q, /^Saved /);
  await q.reload();
  await q.waitForFunction(() => !document.getElementById('open').disabled);
  await q.waitForFunction(() => document.querySelectorAll('#recentList .note-card').length > 0);
  const names = await recentNames(q);
  assert.equal(names.length, 1, `one entry: ${names}`);
  if (DIR) await q.screenshot({ path: DIR + 'no-writable.png' });
  console.log(`· without createWritable the note is kept in browser storage: ${names}`);

  assert.deepEqual(errors, []);
  console.log('Saving and Recent: all checks passed.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
}
process.exit();
