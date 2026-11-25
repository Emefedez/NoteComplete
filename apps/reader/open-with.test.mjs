import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from './open-with.js';
import { OFFICE_FORMATS } from './office-formats.js';
import { OFFICE_EXTENSIONS } from './text-types.js';
import { officeModule, officeInstalled } from './office-module.js';

const memory = (data = {}) => ({ getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } });
const prefs = (p) => memory({ 'notecomplete-open-with': JSON.stringify(p) });

test('the built-in list: the module manifest minus images and zip', () => {
  const table = W.formatTable();
  assert.equal(table.size, 75);
  assert.equal(OFFICE_FORMATS.length, 75);
  assert.ok(table.get('docx').mime.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  assert.equal(table.has('png'), false);
  // A manifest's own entries read the same way.
  const manifest = [{ name: 'xyz', type: 'cell', actions: ['view', 'edit'], mime: [] }, { name: 'zip', type: '', actions: [] }];
  assert.equal(W.euroOfficeMode('a.xyz', manifest), 'edit');
  assert.equal(W.fileKindOf('a.xyz', manifest), 'spreadsheets');
  assert.equal(W.euroOfficeMode('a.zip', manifest), null);
});

test('kinds by extension', () => {
  assert.equal(W.fileKindOf('Report.DOCX'), 'documents');
  assert.equal(W.fileKindOf('a.odt'), 'documents');
  assert.equal(W.fileKindOf('book.epub'), 'documents');
  assert.equal(W.fileKindOf('a.xlsx'), 'spreadsheets');
  assert.equal(W.fileKindOf('a.csv'), 'spreadsheets');
  assert.equal(W.fileKindOf('a.tsv'), 'spreadsheets');
  assert.equal(W.fileKindOf('a.ppsx'), 'presentations');
  assert.equal(W.fileKindOf('a.pdf'), 'pdf');
  assert.equal(W.fileKindOf('a.djvu'), 'pdf');
  assert.equal(W.fileKindOf('a.vsdx'), 'other');
  assert.equal(W.fileKindOf('a.ipynb'), 'other');
  assert.equal(W.fileKindOf('a.noteful'), 'other');
  assert.equal(W.fileKindOf('README'), 'other');
});

test('the text view opens exactly what office.js handles', () => {
  for (const ext of OFFICE_EXTENSIONS) assert.ok(W.textViewOpens(`a.${ext}`), ext);
  assert.ok(W.textViewOpens('a.csv') && W.textViewOpens('a.tsv'));
  for (const ext of ['ppsx', 'potx', 'xltx', 'dotm', 'ott', 'djvu', 'xps', 'vsdx', 'pdf', 'md', 'noteful']) assert.equal(W.textViewOpens(`a.${ext}`), false, ext);
});

test('Euro-Office modes: edit, lossy edit, convert on open, view', () => {
  assert.equal(W.euroOfficeMode('a.docx'), 'edit');
  assert.equal(W.euroOfficeMode('a.xlsm'), 'edit');
  assert.equal(W.euroOfficeMode('a.ppsx'), 'edit');
  assert.equal(W.euroOfficeMode('a.csv'), 'lossy-edit');
  assert.equal(W.euroOfficeMode('a.doc'), 'convert');
  assert.equal(W.euroOfficeMode('a.odt'), 'convert');
  assert.equal(W.euroOfficeMode('a.xls'), 'convert');
  assert.equal(W.euroOfficeMode('a.gdoc'), 'view');
  assert.equal(W.euroOfficeMode('a.djvu'), 'view');
  assert.equal(W.euroOfficeMode('a.vsdx'), 'view');
  // NoteComplete's own: never sent to Euro-Office.
  for (const ext of ['pdf', 'txt', 'md', 'xml', 'html', 'htm']) assert.equal(W.euroOfficeMode(`a.${ext}`), null, ext);
  assert.equal(W.euroOfficeMode('a.ipynb'), null);
  assert.equal(W.euroOfficeMode('noext'), null);
});

test('files only Euro-Office opens', () => {
  for (const ext of ['ppsx', 'potx', 'xltx', 'djvu', 'xps', 'vsdx', 'dotm', 'key', 'pages']) assert.ok(W.onlyEuroOffice(`a.${ext}`), ext);
  for (const ext of ['docx', 'csv', 'ipynb', 'pdf', 'md', 'png']) assert.equal(W.onlyEuroOffice(`a.${ext}`), false, ext);
  assert.match(W.needsOfficeMessage('Show.ppsx'), /\.ppsx files open in the Office suite \(Euro-Office\).*Modules/);
  assert.ok(W.hasOpenWith('a.docx') && W.hasOpenWith('a.ppsx') && W.hasOpenWith('a.ipynb'));
  assert.equal(W.hasOpenWith('a.pdf') || W.hasOpenWith('a.md') || W.hasOpenWith('a.noteful'), false);
});

test('openers: text always, Euro-Office listed but unavailable until installed', () => {
  assert.deepEqual(W.openersFor('a.docx').map((o) => [o.id, o.available]), [['text', true], ['euro-office', false]]);
  assert.deepEqual(W.openersFor('a.docx', { installed: true }).map((o) => [o.id, o.available, o.mode]), [['text', true, undefined], ['euro-office', true, 'edit']]);
  assert.deepEqual(W.openersFor('a.ipynb').map((o) => o.id), ['text']);
  assert.deepEqual(W.openersFor('a.ppsx').map((o) => [o.id, o.available]), [['euro-office', false]]);
  assert.deepEqual(W.openersFor('a.pdf'), []);
});

test('the default: the kind\'s choice, falling back to the text view', () => {
  // Nothing chosen: the text view.
  assert.deepEqual(W.decideOpener('a.docx', { storage: memory() }), { kind: 'documents', openers: W.openersFor('a.docx'), opener: 'text', ask: false });
  // Euro-Office chosen but not installed: text, no error.
  const eo = prefs({ documents: 'euro-office', spreadsheets: 'text', presentations: 'ask' });
  assert.equal(W.decideOpener('a.docx', { storage: eo }).opener, 'text');
  assert.equal(W.decideOpener('a.docx', { storage: eo, installed: true }).opener, 'euro-office');
  // Euro-Office cannot open .ipynb: text even with the module.
  assert.equal(W.decideOpener('a.ipynb', { pref: 'euro-office', installed: true }).opener, 'text');
  // Spreadsheets stay text when documents go to Euro-Office.
  assert.equal(W.decideOpener('a.xlsx', { storage: eo, installed: true }).opener, 'text');
  // Text chosen, but only Euro-Office opens .ppsx: Euro-Office when installed, else nothing.
  assert.equal(W.decideOpener('a.ppsx', { pref: 'text', installed: true }).opener, 'euro-office');
  assert.equal(W.decideOpener('a.ppsx', { pref: 'text' }).opener, null);
  assert.equal(W.decideOpener('a.vsdx', { storage: memory(), installed: true }).opener, 'euro-office');
  assert.equal(W.decideOpener('a.pdf', { storage: memory(), installed: true }).opener, null);
});

test('ask each time', () => {
  const ask = prefs({ documents: 'ask', spreadsheets: 'ask', presentations: 'ask' });
  // Two ways known: ask (Euro-Office shown disabled while not installed), suggesting the text view.
  assert.deepEqual(W.decideOpener('a.pptx', { storage: ask }), { kind: 'presentations', openers: W.openersFor('a.pptx'), opener: 'text', ask: true });
  assert.equal(W.decideOpener('a.pptx', { storage: ask, installed: true }).ask, true);
  // One way only: no question.
  assert.equal(W.decideOpener('a.ppsx', { storage: ask, installed: true }).ask, false);
  assert.equal(W.decideOpener('a.ipynb', { pref: 'ask' }).ask, false);
  assert.equal(W.decideOpener('a.ppsx', { storage: ask }).opener, null);
});

test('a menu choice applies to the next opening of that file only', () => {
  W.openOnceWith('a.docx', 'euro-office', 1000);
  assert.equal(W.takeOpenOnce('b.docx', 1000), null);
  assert.equal(W.takeOpenOnce('a.docx', 2000), 'euro-office');
  assert.equal(W.takeOpenOnce('a.docx', 2000), null);
  W.openOnceWith('a.docx', 'text', 0);
  assert.equal(W.takeOpenOnce('a.docx', 700000), null);
});

test('the module hook reports not installed', async () => {
  assert.deepEqual(await officeModule.status(), { state: 'soon', installed: false });
  assert.equal(await officeInstalled(), false);
  assert.equal(await officeInstalled({ status: async () => ({ installed: true }) }), true);
  assert.equal(await officeInstalled({ status: async () => { throw Error('down'); } }), false);
  await assert.rejects(officeModule.open(new Uint8Array()), /not installed/);
});
