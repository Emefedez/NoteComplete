import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveCorsUrl, archiveId, archiveListing, archiveUrl, supportedArchiveFile, PRELOADED_ARCHIVE, ArchiveClient } from './archive-client.js';

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
  assert.equal((await client.download('id', { name: 'a.pdf', path: 'A B/a.pdf' })).name, 'a.pdf');
  // In a web page the file comes from /cors/, the path Internet Archive serves with CORS headers.
  assert.equal(seen.at(-1), 'https://archive.org/cors/id/A%20B/a.pdf');
});

test('on the desktop the download goes through the app and can be cancelled', async () => {
  const calls = [];
  let cancelled = 0, settle;
  globalThis.notecompleteFiles = {
    downloadUrl: (url, onProgress, onCancel) => {
      calls.push(url);
      onProgress(2, 0);
      onCancel(() => { cancelled += 1; settle.reject(Error("Error invoking remote method 'files:download-url': AbortError: Download cancelled.")); });
      return new Promise((resolve, reject) => { settle = { resolve, reject }; });
    },
  };
  try {
    const client = new ArchiveClient(async () => assert.fail('fetched in the page'));
    const progress = [];
    const done = client.download('id', { name: 'a.pdf', path: 'P/a.pdf', size: 9 }, new AbortController().signal, (received, total) => progress.push([received, total]));
    settle.resolve(new Uint8Array([1, 2, 3]));
    const file = await done;
    assert.equal(file.name, 'a.pdf');
    assert.equal(file.type, 'application/pdf');
    assert.equal(file.size, 3);
    assert.deepEqual(calls, ['https://archive.org/download/id/P/a.pdf']);
    assert.deepEqual(progress, [[2, 9]]);

    // Aborting tells the app to stop, and the caller sees an AbortError as with fetch.
    const controller = new AbortController();
    const pending = client.download('id', { name: 'b.noteful', path: 'b.noteful' }, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(cancelled, 1);
    // A signal that fired earlier starts nothing.
    await assert.rejects(client.download('id', { name: 'c.pdf', path: 'c.pdf' }, controller.signal), { name: 'AbortError' });
    assert.equal(calls.length, 2);
    // Other failures pass through, and no signal at all still downloads.
    const failing = client.download('id', { name: 'd.pdf', path: 'd.pdf' });
    settle.reject(Error('Download answered 404'));
    await assert.rejects(failing, /answered 404/);
  } finally { delete globalThis.notecompleteFiles; }
});
