// Browser check of archives (Chromium, after a web build): a zip holding a PDF, a Noteful note
// and a text file opens in the archive window, all intact; the PDF and the note open from
// inside it with "archive.zip › path" as their title; a zip with a corrupted entry is reported
// damaged; a zipped Goodnotes notebook opens as the notebook; a zip of several notebooks
// (a Goodnotes folder export, one of them inside a nested zip) opens as a group of documents.
//   node tools/archive_e2e.mjs [screenshots folder]
// GOODNOTES_ZIP=/path/to/real.goodnotes.zip also opens that file and prints its page count.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
import { crc32 } from '../apps/reader/zip.js';

const DIR = process.argv[2] || '';
const fixture = (name) => fileURLToPath(new URL(`../tests/fixtures/import/${name}`, import.meta.url));
// A zip with deflated entries (stored when deflate does not help), as zip tools write them.
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const nameBytes = Buffer.from(name), packed = deflateRawSync(bytes), store = packed.length >= bytes.length;
    const data = store ? Buffer.from(bytes) : packed, crc = crc32(bytes);
    const local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(store ? 0 : 8, 10);
    entry.writeUInt16LE(0x6000, 12); entry.writeUInt16LE(0x5b51, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data); central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const work = await mkdtemp(path.join(tmpdir(), 'nc-archive-e2e-'));
const pdf = await readFile(samplePath('Examen wuolah.pdf')), note = await readFile(samplePath('nota_1linea.noteful'));
const text = Buffer.from('Lista de la compra\n- pan\n- leche\n'.repeat(20));
const good = zip([{ name: 'Apuntes/Examen wuolah.pdf', bytes: pdf }, { name: 'Apuntes/nota_1linea.noteful', bytes: note }, { name: 'leeme.txt', bytes: text }, { name: 'setup.exe', bytes: Buffer.from('MZ not really') }]);
const goodPath = path.join(work, 'Curso.zip');
await writeFile(goodPath, good);
// The same archive with one byte of the text file changed (its data is deflated: the CRC fails).
const bad = Buffer.from(good), at = bad.indexOf(Buffer.from('leeme.txt')) + 'leeme.txt'.length + 10;
bad[at] ^= 0x55;
const badPath = path.join(work, 'Roto.zip');
await writeFile(badPath, bad);
// Goodnotes: one notebook zipped as it is, and a pack of three (one in a zip inside).
const gnBasic = await readFile(fixture('goodnotes-basic.goodnotes')), gnPdf = await readFile(fixture('goodnotes-pdf.goodnotes'));
const onePath = path.join(work, 'Mi libreta.goodnotes.zip');
await writeFile(onePath, gnBasic);
const packPath = path.join(work, 'Goodnotes export.zip');
await writeFile(packPath, zip([
  { name: 'Semestre 1/Cálculo.goodnotes', bytes: gnBasic },
  { name: 'Semestre 2/Física.goodnotes', bytes: gnPdf },
  { name: 'Viejos.zip', bytes: zip([{ name: 'Álgebra.goodnotes', bytes: gnBasic }]) },
]));

const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await openReader(p, server.origin);

await p.setInputFiles('#file', goodPath);
await p.locator('#zipWindow[open]').waitFor();
await p.locator('#zipSummary.ok').waitFor();
assert.match(await p.textContent('#zipSummary'), /4 files, all intact/);
const names = await p.locator('#zipTree .zip-name').allTextContents();
assert.deepEqual(names, ['Apuntes', 'Examen wuolah.pdf', 'nota_1linea.noteful', 'leeme.txt', 'setup.exe']);
assert.equal(await p.locator('#zipTree .zip-row.off').count(), 1, 'setup.exe is listed greyed');
assert.match(await p.locator('#zipTree .zip-row.off .zip-type').textContent(), /EXE file/);
assert.equal(await p.locator('#zipTree .zip-mark.ok').count(), 4);
if (DIR) await p.screenshot({ path: `${DIR}/archive-window.png` });
console.log('· a zip opens in the archive window: tree, sizes, "4 files, all intact", setup.exe greyed');

const row = (name) => p.locator('#zipTree .zip-row', { has: p.locator(`.zip-name:text-is("${name}")`) });
await row('Examen wuolah.pdf').locator('.zip-open').click();
await p.locator('.sheet[data-page="0"] .render').waitFor();
await p.waitForFunction(() => document.getElementById('title').textContent === 'Curso.zip › Apuntes/Examen wuolah.pdf');
assert.ok(await p.locator('#zipWindow[open]').count(), 'the window stays open beside the document');
console.log('· the PDF opens from inside, titled "Curso.zip › Apuntes/Examen wuolah.pdf"');
await row('nota_1linea.noteful').locator('.zip-open').click();
await p.waitForFunction(() => document.getElementById('title').textContent === 'Curso.zip › Apuntes/nota_1linea.noteful');
await p.locator('.sheet[data-page="0"] .render').waitFor();
if (DIR) await p.screenshot({ path: `${DIR}/archive-note.png` });
console.log('· the note opens from inside too');
// Save file… (web: a download).
const [download] = await Promise.all([p.waitForEvent('download'), row('leeme.txt').locator('.zip-save').click()]);
assert.equal(download.suggestedFilename(), 'leeme.txt');
assert.equal((await readFile(await download.path())).toString(), text.toString());
console.log('· Save file… gives the entry as it was');

await p.setInputFiles('#file', badPath);
await p.locator('#zipSummary.bad').waitFor();
assert.match(await p.textContent('#zipSummary'), /1 damaged: leeme\.txt/);
assert.equal(await row('leeme.txt').locator('.zip-mark.bad').count(), 1);
assert.equal(await row('leeme.txt').locator('.zip-open').count(), 0, 'a damaged entry does not open');
if (DIR) await p.screenshot({ path: `${DIR}/archive-damaged.png` });
console.log('· a corrupted zip: "1 damaged: leeme.txt", marked in its row');
await p.click('#zipX');

await p.setInputFiles('#file', onePath);
await p.waitForFunction(() => document.getElementById('title').textContent && !document.getElementById('zipWindow').open && document.querySelector('.sheet[data-page="0"] .render'));
await p.waitForFunction(() => /Mi libreta/.test(document.getElementById('title').textContent));
// The title shows before the notebook has finished opening: a file chosen meanwhile is ignored.
await p.waitForFunction(() => /notebook opened as a note/.test(document.getElementById('status').textContent));
assert.doesNotMatch(await p.textContent('#title'), /\.zip|\.goodnotes/);
console.log(`· a zipped Goodnotes notebook opens as the notebook: "${await p.textContent('#title')}"`);

await p.setInputFiles('#file', packPath);
await p.locator('#groupPanel:not([hidden])').waitFor();
await p.waitForFunction(() => document.querySelectorAll('#groupList li').length === 3);
assert.equal(await p.textContent('#groupName'), 'Goodnotes export');
const members = await p.locator('#groupList .group-name').allTextContents();
assert.deepEqual(members, ['Semestre 1/Cálculo', 'Semestre 2/Física', 'Viejos.zip › Álgebra']);
assert.deepEqual([...new Set(await p.locator('#groupList .group-kind').allTextContents())], ['Goodnotes']);
await p.waitForFunction(() => document.getElementById('title').textContent === 'Goodnotes export.zip › Semestre 1/Cálculo.goodnotes');
await p.locator('#groupList .group-item').nth(2).click();
await p.waitForFunction(() => document.getElementById('title').textContent === 'Goodnotes export.zip › Viejos.zip › Álgebra.goodnotes');
await p.locator('.sheet[data-page="0"] .render').waitFor();
if (DIR) await p.screenshot({ path: `${DIR}/goodnotes-pack.png` });
console.log('· a Goodnotes export (with a zip inside) opens as a group of 3 notebooks; the nested one opens');

if (process.env.GOODNOTES_ZIP) {
  const t = Date.now();
  await p.setInputFiles('#file', process.env.GOODNOTES_ZIP);
  await p.waitForFunction((name) => document.getElementById('title').textContent === name, path.basename(process.env.GOODNOTES_ZIP).replace(/\.zip$/i, '').replace(/\.goodnotes$/i, ''), { timeout: 180000 });
  await p.locator('.sheet[data-page="0"] .render').waitFor({ timeout: 60000 });
  const pages = await p.evaluate(() => Number(document.getElementById('pageNumber').max));
  console.log(`· ${path.basename(process.env.GOODNOTES_ZIP)} opened as a notebook: ${pages} pages in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  if (DIR) await p.screenshot({ path: `${DIR}/goodnotes-real.png` });
}
assert.deepEqual(errors, []);
console.log('Archives: OK');
await b.close(); process.exit(0);
