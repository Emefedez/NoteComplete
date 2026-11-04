// Browser check of Word, OpenDocument, Excel and CSV files (Chromium, after a web build):
// each opens as formatted Markdown in the text view, editable as Markdown, searchable, with
// its pictures shown, and Save keeps a copy (.md, or .zip with the pictures folder), never
// over the original. The Word and spreadsheet readers are fetched only when needed.
//   node tools/office_import_e2e.mjs [screenshots folder]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';
import { docx, odt, workbook, CSV } from '../tests/fixtures/office-files.mjs';
import { zipEntry } from '../apps/reader/office.js';
// A one-pixel PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null });
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [], vendor = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (/vendor\/(mammoth|sheetjs)\//.test(r.url())) vendor.push(r.url().split('/vendor/')[1]); });
  p.on('dialog', (d) => d.accept());
  await p.goto(server.origin + '/');
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  assert.deepEqual(vendor, [], 'nothing of the office readers is fetched at startup');

  const open = async (name, bytes, mimeType = 'application/octet-stream') => {
    await p.setInputFiles('#file', { name, mimeType, buffer: Buffer.from(bytes) });
    await p.waitForFunction((title) => !document.getElementById('textView').hidden && document.getElementById('textTitle').textContent === title
      && document.querySelector('#textBody')?.children.length > 0, name.replace(/\.[^.]+$/, ''), { timeout: 20000 });
    // Editable as Markdown; Save (a copy) is offered at once.
    assert.equal(await p.isVisible('#textEdit'), true);
    assert.equal(await p.isVisible('#textSave'), true);
    assert.match(await p.textContent('#status'), /Opened as Markdown\. Edit it if you like/);
  };
  const text = (selector) => p.$$eval(selector, (els) => els.map((e) => e.textContent.trim()));

  await open('Informe.docx', docx());
  assert.deepEqual(await text('#textBody h1'), ['Informe trimestral']);
  assert.deepEqual(await text('#textBody strong'), ['marzo']);
  assert.deepEqual(await text('#textBody ol li'), ['Primer punto', 'Segundo punto']);
  assert.deepEqual(await text('#textBody td'), ['Marzo', '1|200']);
  assert.deepEqual(vendor, ['mammoth/mammoth.browser.min.js']);
  if (DIR) await p.screenshot({ path: DIR + 'docx.png' });
  console.log('· .docx opened as Markdown (headings, bold, list, table)');
  // Save keeps a .md copy of what is shown.
  const [saved] = await Promise.all([p.waitForEvent('download'), p.click('#textSave')]);
  assert.equal(saved.suggestedFilename(), 'Informe.md');
  assert.match(readFileSync(await saved.path(), 'utf8'), /^# Informe trimestral\n\nVentas de \*\*marzo\*\*/);
  console.log('· Save wrote Informe.md');

  // Pictures: shown from the converted file, editable, and saved with a folder of their own.
  await open('Informe con foto.docx', docx({ image: PNG }));
  await p.waitForSelector('#textBody img');
  assert.equal(await p.$eval('#textBody img', (img) => img.complete && img.naturalWidth), 1, 'the picture is drawn');
  assert.match(await p.$eval('#textBody img', (img) => img.src), /^blob:/);
  assert.equal(await p.$eval('#textBody img', (img) => img.alt), 'Esquema del circuito');
  assert.match(await p.textContent('#status'), /and its pictures/);
  if (DIR) await p.screenshot({ path: DIR + 'docx-picture.png' });
  await p.click('#textEdit');
  await p.waitForSelector('#textEditor .TinyMDE', { timeout: 20000 });
  await p.click('#textEditor .TinyMDE');
  await p.keyboard.press('Control+Home');
  await p.keyboard.type('Nota mía. ');
  const [zipped] = await Promise.all([p.waitForEvent('download'), p.click('#textSave')]);
  assert.equal(zipped.suggestedFilename(), 'Informe con foto.zip');
  const archive = new Uint8Array(readFileSync(await zipped.path()));
  assert.match(new TextDecoder().decode(await zipEntry(archive, 'Informe con foto.md')), /Nota mía\. .*Informe trimestral[\s\S]*!\[Esquema del circuito\]\(Informe%20con%20foto_files\/image1\.png\)/);
  assert.deepEqual([...await zipEntry(archive, 'Informe con foto_files/image1.png')], [...PNG]);
  assert.match(await p.textContent('#status'), /Unzip it together/);
  console.log('· a .docx picture is shown, the text is editable, and Save keeps a .zip with the pictures folder');

  await open('Ventas.xlsx', workbook('xlsx'));
  assert.deepEqual(await text('#textBody h2'), ['Ventas', 'Notas']);
  assert.deepEqual(await text('#textBody table:first-of-type th'), ['Producto', 'Precio', 'Fecha']);
  assert.ok((await text('#textBody td')).includes('Lápiz'));
  assert.ok(vendor.includes('sheetjs/xlsx.mini.min.js'));
  // Find in the document (Ctrl F) sees the cells.
  await p.click('#textBody');
  await p.keyboard.press('Control+f');
  await p.waitForSelector('#textFindBar:not([hidden])');
  await p.fill('#textFindInput', 'stock');
  await p.waitForFunction(() => /1/.test(document.getElementById('textFindCount').textContent));
  await p.keyboard.press('Escape');
  if (DIR) await p.screenshot({ path: DIR + 'xlsx.png' });
  console.log('· .xlsx opened, a heading per sheet, searchable');

  await open('Notas.ods', workbook('ods'));
  assert.deepEqual(await text('#textBody h2'), ['Ventas', 'Notas']);
  console.log('· .ods opened');

  await open('Lista.csv', CSV, 'text/csv');
  assert.deepEqual(await text('#textBody th'), ['name', 'quote', 'notes']);
  assert.ok((await text('#textBody td')).includes('Hello, world'));
  assert.ok((await text('#textBody td')).includes('She said "hi"'));
  console.log('· .csv opened as a table');

  await open('Apuntes.odt', odt());
  assert.deepEqual(await text('#textBody h1'), ['Apuntes de física']);
  assert.deepEqual(await text('#textBody em'), ['conserva']);
  assert.ok((await text('#textBody td')).includes('N | newton'));
  if (DIR) await p.screenshot({ path: DIR + 'odt.png' });
  console.log('· .odt opened');

  // New from Markdown starts from the open document.
  await p.evaluate(() => document.getElementById('newHandwritten').click());
  await p.waitForSelector('#hwMarkdown');
  assert.match(await p.inputValue('#hwMarkdown'), /^# Apuntes de física/);
  await p.keyboard.press('Escape');
  console.log('· New from Markdown starts from it');

  // A damaged file: a plain message.
  await p.setInputFiles('#file', { name: 'Roto.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip') });
  await p.waitForFunction(() => /could not be read/.test(document.getElementById('status').textContent));
  assert.equal(await p.textContent('#status'), 'Could not open: This Word document could not be read. It may be damaged or protected with a password.');
  console.log('· a damaged file gives a plain message');
  assert.deepEqual(errors, []);
  console.log('Office import: .docx, .xlsx, .ods, .csv and .odt open as Markdown.');
} finally {
  await b.close();
  await server.stop();
}
