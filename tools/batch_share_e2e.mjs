// Browser check of sharing several notes from Home → Recent (Chromium, after a web build): two
// notes opened once are listed in Recent; Share selects them (the other batch modes hide), its
// dialog lists them and fits, Save .zip gives one .zip holding both files, and QR or link opens
// the Share via QR window with that .zip.
//   node tools/batch_share_e2e.mjs [screenshots folder]
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
try {
  const context = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: DIR ? 2 : 1, acceptDownloads: true });
  context.setDefaultTimeout(30000);
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);

  // 1. Two documents opened once: both in Recent.
  const names = ['Examen wuolah.pdf', 'texto.noteful'];
  for (const name of names) {
    await p.setInputFiles('#file', samplePath(name));
    await p.waitForSelector('.sheet[data-page="0"] .render');
    await p.keyboard.press('Control+s');
    await p.waitForFunction(() => /^Saved /.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  }
  await p.click('#homeButton');
  await p.waitForFunction(() => document.querySelectorAll('#recentList .note-card').length >= 2);
  const count = await p.$$eval('#recentList .note-card', (c) => c.length);
  console.log(`· ${count} documents in Recent`);

  // 2. Share mode: every note selectable, the other batch modes hidden.
  await p.click('#batchShareMode');
  await p.waitForFunction((n) => document.querySelectorAll('#recentList .note-card.has-items').length === n, count);
  assert.equal(await p.isHidden('#batchOcrMode'), true);
  assert.equal(await p.isHidden('#batchTranscribeMode'), true);
  await p.click('#batchShareSelectAll');
  assert.match(await p.textContent('#batchShareStart'), new RegExp(`Share \\(${count} notes\\)`));
  if (DIR) await p.screenshot({ path: DIR + 'batch-share-select.png' });
  await p.click('#batchShareStart');
  await p.waitForSelector('#batchShareDialog[open]');
  assert.equal(await p.$$eval('#bsNotesList .bt-note-head.is-selected', (n) => n.length), count);
  assert.match(await p.textContent('#bsSummary'), new RegExp(`${count} notes to share`));
  const box = await p.$eval('#batchShareDialog', (d) => d.scrollHeight > d.clientHeight + 1);
  assert.equal(box, false, 'the dialog fits without scrolling');
  if (DIR) await p.screenshot({ path: DIR + 'batch-share-dialog.png' });
  console.log('· Share selects the notes and its dialog lists them');

  // 3. Save .zip: one .zip with both files.
  const [download] = await Promise.all([p.waitForEvent('download'), p.click('#bsZip')]);
  assert.match(download.suggestedFilename(), /^NoteComplete \d+ notes \d{4}-\d\d-\d\d\.zip$/);
  // The names in the .zip's central directory.
  const zip = readFileSync(await download.path()), inside = [];
  for (let at = zip.indexOf('PK\x01\x02'); at >= 0; at = zip.indexOf('PK\x01\x02', at + 46)) inside.push(zip.toString('utf8', at + 46, at + 46 + zip.readUInt16LE(at + 28)));
  assert.equal(inside.length, count, `the .zip holds ${count} files: ${inside}`);
  for (const name of names) assert.ok(inside.some((n) => n.startsWith(name.replace(/\.[^.]+$/, ''))), `the .zip holds ${name}: ${inside}`);
  await p.waitForSelector('#batchShareDialog:not([open])', { state: 'attached' });
  assert.equal(await p.isVisible('#batchShareMode'), true, 'the selection mode is left');
  console.log(`· Save .zip: ${download.suggestedFilename()}`);

  // 4. QR or link: the Share via QR window opens with the .zip.
  await p.click('#batchShareMode');
  await p.waitForFunction((n) => document.querySelectorAll('#recentList .note-card.has-items').length === n, count);
  await p.click('#batchShareSelectAll');
  await p.click('#batchShareStart');
  await p.click('#bsQr');
  await p.waitForFunction(() => [...document.querySelectorAll('dialog[open]')].some((d) => /Share notes/.test(d.textContent) && /\.zip/.test(d.textContent)), null, { timeout: 20000 });
  if (DIR) await p.screenshot({ path: DIR + 'batch-share-qr.png' });
  console.log('· QR or link opens the share window with the .zip');

  assert.deepEqual(errors, []);
  console.log('Share several notes: all checks passed.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await b.close();
  server.close?.();
  process.exit(process.exitCode || 0);
}
