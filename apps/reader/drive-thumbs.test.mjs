import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { driveThumbnails } from './drive-thumbs.js';
import { Library, memoryStore } from './library.js';
import { FOLDER_MIME } from './drive-client.js';

const note = new Uint8Array(readFileSync(new URL('../../samples/Examen%20wuolah.noteful', import.meta.url)));
const file = (id, over = {}) => ({ id, name: `${id}.noteful`, size: String(note.length), modifiedTime: 't1', ...over });

function client() {
  const ranges = [];
  return {
    ranges,
    async range(f, start, end) { ranges.push([f.id, start, end]); return note.slice(start, end); },
    async download() { throw Error('whole downloads are not allowed for previews'); },
  };
}

test('note previews use the native cover via ranges and are kept per version', async () => {
  const drive = client(), library = new Library({ store: memoryStore() });
  const resized = [];
  const thumbs = driveThumbnails(drive, { library, resize: async blob => { resized.push(blob.type); return 'data:image/jpeg;base64,AAAA'; } });
  assert.equal(await thumbs.get(file('a')), 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(resized, ['image/jpeg']);
  assert.ok(drive.ranges.reduce((n, [, a, b]) => n + b - a, 0) < note.length);
  const before = drive.ranges.length;
  assert.equal(await thumbs.get(file('a')), 'data:image/jpeg;base64,AAAA');
  assert.equal(drive.ranges.length, before, 'kept cover is reused without network');
  await thumbs.get(file('a', { modifiedTime: 't2' }));
  assert.ok(drive.ranges.length > before, 'a new version fetches a new cover');
});

test('folders, projects and restricted files get no preview; cancelled work resolves null so it can be retried', async () => {
  const drive = client();
  const thumbs = driveThumbnails(drive, { resize: async () => 'data:x', parallel: 1 });
  assert.equal(await thumbs.get({ id: 'f', name: 'Noteful', mimeType: FOLDER_MIME }), '');
  assert.equal(await thumbs.get({ id: 'p', name: 'x.nfedit', size: '10' }), '');
  assert.equal(await thumbs.get(file('r', { capabilities: { canDownload: false } })), '');
  const pending = [thumbs.get(file('one')), thumbs.get(file('two')), thumbs.get(file('three'))];
  thumbs.cancel();
  assert.deepEqual(await Promise.all(pending), [null, null, null]);
  assert.equal(await thumbs.get(file('one')), 'data:x');
});

test('a note whose Google thumbnail fails falls back to its own cover', async () => {
  const drive = client();
  const thumbs = driveThumbnails({ ...drive, range: drive.range, thumbnail: async () => '' }, { resize: async () => 'data:own' });
  assert.equal(await thumbs.get(file('n', { thumbnailLink: 'https://lh3/thumb' })), 'data:own');
});

test('PDFs and images keep using Google thumbnails', async () => {
  const thumbs = driveThumbnails({ thumbnail: async () => 'blob:google', range: async () => { throw Error('no'); } });
  assert.equal(await thumbs.get({ id: 'p', name: 'slides.pdf', thumbnailLink: 'https://lh3/thumb' }), 'blob:google');
});
