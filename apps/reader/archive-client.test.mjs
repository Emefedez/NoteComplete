import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveId, archiveListing, archiveUrl, supportedArchiveFile, PRELOADED_ARCHIVE, ArchiveClient } from './archive-client.js';

test('item links and identifiers are recognised', () => {
  assert.equal(archiveId('https://archive.org/details/1GREIUvigo'), '1GREIUvigo');
  assert.equal(archiveId('archive.org/download/1GREIUvigo/PDF/a.pdf'), '1GREIUvigo');
  assert.equal(archiveId(' my-item_2 '), 'my-item_2');
  assert.equal(archiveId('https://example.com/x'), null);
  assert.equal(archiveId('a b'), null);
  assert.equal(PRELOADED_ARCHIVE[0].id, '1GREIUvigo');
});
test('a listing shows one folder level of original, openable documents', () => {
  const files = [
    { name: 'x_meta.xml', source: 'original', format: 'Metadata' }, { name: 'README.txt', source: 'original', size: '5' },
    { name: 'PDF/.DS_Store', source: 'original' }, { name: 'PDF/ACI/a.pdf', source: 'original', size: '10', mtime: '1788820657' },
    { name: 'PDF/ACI/a_djvu.txt', source: 'derivative' }, { name: 'PDF/b.pdf', source: 'original' }, { name: 'PDF/b.zip', source: 'original' },
  ];
  assert.deepEqual(archiveListing(files), { folders: ['PDF'], documents: [{ name: 'README.txt', path: 'README.txt', size: 5, modifiedTime: '' }] });
  const pdf = archiveListing(files, ['PDF']);
  assert.deepEqual(pdf.folders, ['ACI']);
  assert.deepEqual(pdf.documents.map(d => d.path), ['PDF/b.pdf']);
  assert.deepEqual(archiveListing(files, ['PDF', 'ACI']).documents.map(d => d.name), ['a.pdf']);
  assert.ok(supportedArchiveFile('a.noteful') && !supportedArchiveFile('a.zip'));
});
test('downloads encode the path and the metadata call reports missing items', async () => {
  assert.equal(archiveUrl('id', 'A B/c#.pdf'), 'https://archive.org/download/id/A%20B/c%23.pdf');
  const seen = [];
  const client = new ArchiveClient(async url => { seen.push(url); return { ok: true, json: async () => url.includes('missing') ? {} : { metadata: { title: 'T' }, files: [] }, blob: async () => new Blob(['x']), headers: new Map() }; });
  assert.equal((await client.item('real')).title, 'T');
  await assert.rejects(client.item('missing'), /No Internet Archive item/);
  assert.equal((await client.download('id', { name: 'a.pdf', path: 'a.pdf' })).name, 'a.pdf');
});
