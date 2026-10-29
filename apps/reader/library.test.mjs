import test from 'node:test';
import assert from 'node:assert/strict';
import { Library, memoryStore, safeName } from './library.js';

function fakeDirectory(name = 'Notes') {
  const files = new Map();
  return {
    name, files,
    async removeEntry(file) { files.delete(file); },
    async getFileHandle(file, options) {
      if (!files.has(file) && !options?.create) throw Error('NotFound');
      return {
        getFile: async () => new File([files.get(file)], file),
        createWritable: async () => ({ write: async blob => files.set(file, new Uint8Array(await blob.arrayBuffer())), close: async () => {} }),
      };
    },
  };
}
const drive = (over = {}) => ({ id: 'abc123xyz', name: 'Memoria 1.noteful', modifiedTime: '2026-10-25T18:46:46Z', size: '4', ...over });

test('a kept Drive note is reused only while Drive reports the same version', async () => {
  const dir = fakeDirectory();
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => dir } });
  assert.equal(await library.cached(drive()), null);
  await library.keep(drive(), new Blob([new Uint8Array([170, 187, 204, 222])]));
  assert.ok(dir.files.has('Memoria 1.noteful'));
  const hit = await library.cached(drive());
  assert.deepEqual([...new Uint8Array(await hit.arrayBuffer())], [170, 187, 204, 222]);
  assert.equal(await library.cached(drive({ modifiedTime: '2026-10-26T00:00:00Z' })), null);
  assert.equal(await library.cached(drive({ size: '5' })), null);
  assert.equal((await library.location()).label, 'Browser storage');
});

test('same-named notes from different Drive folders get distinct files', async () => {
  const dir = fakeDirectory();
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => dir } });
  await library.keep(drive({ id: 'first1' }), new Blob(['a']));
  await library.keep(drive({ id: 'second' }), new Blob(['b']));
  assert.deepEqual([...dir.files.keys()].sort(), ['Memoria 1 (second).noteful', 'Memoria 1.noteful']);
  // Updating a note keeps its filename instead of creating another copy.
  await library.keep(drive({ id: 'second', modifiedTime: 'later' }), new Blob(['c']));
  assert.equal(dir.files.size, 2);
  assert.deepEqual((await library.recent()).map(e => e.driveId), ['second', 'first1']);
});

test('a chosen directory replaces browser storage and desktop uses its bridge', async () => {
  const chosen = fakeDirectory('Apuntes');
  const store = memoryStore();
  const library = new Library({ store, storage: { getDirectory: async () => fakeDirectory() }, picker: async () => chosen });
  assert.ok(library.canChoose);
  await library.choose();
  await library.keep(drive(), new Blob(['x']));
  assert.ok(chosen.files.has('Memoria 1.noteful'));
  assert.equal((await new Library({ store }).location()).label, 'Apuntes');

  const written = new Map();
  const bridge = { folder: async () => '/home/me/Documents/NoteComplete', choose: async () => '/data/notes', read: async n => written.get(n) || null, write: async (n, b) => written.set(n, b), readRecent: async () => new Uint8Array([1]) };
  const desktop = new Library({ store: memoryStore(), bridge });
  assert.equal((await desktop.location()).label, '/home/me/Documents/NoteComplete');
  await desktop.keep(drive(), new Blob(['zz']));
  assert.ok(await desktop.cached(drive({ size: '2' })));
  const local = await desktop.rememberLocal('/tmp/a.noteful', 'a.noteful', 1);
  assert.equal((await desktop.open(local)).size, 1);
});

test('folder names drop separators and control characters only', () => {
  assert.equal(safeName('Temas1+2.noteful'), 'Temas1+2.noteful');
  assert.equal(safeName('../a/b:c.noteful'), '__a_b_c.noteful');
  assert.equal(safeName(''), 'Note');
});
test('forgetting a Drive note can delete its kept copy and cover; local originals stay', async () => {
  const dir = fakeDirectory();
  dir.removeEntry = async name => dir.files.delete(name);
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => dir } });
  const entry = await library.keep(drive(), new Blob(['x']));
  await library.saveCover(library.coverKey(drive()), 'data:cover');
  await library.forget(entry.key, { deleteFile: true });
  assert.equal(dir.files.size, 0);
  assert.equal(await library.cover(library.coverKey(drive())), undefined);
  assert.deepEqual(await library.recent(), []);
});

// A stand-in for the core's md5_hex: the tests only need equal bytes to give equal sums.
const fakeMd5 = async bytes => 'md5:' + [...bytes].join(',');

test('a re-uploaded Drive note with the same content is not downloaded again', async () => {
  const dir = fakeDirectory();
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => dir }, md5: fakeMd5 });
  await library.keep(drive({ id: 'old', md5Checksum: 'md5:1,2,3,4', parents: ['folder'] }), new Blob([new Uint8Array([1, 2, 3, 4])]));
  // Noteful re-uploaded it: new id and date, same bytes.
  const again = drive({ id: 'new', modifiedTime: '2026-10-28T09:00:00Z', md5Checksum: 'md5:1,2,3,4', parents: ['folder'] });
  const hit = await library.cached(again);
  assert.deepEqual([...new Uint8Array(await hit.arrayBuffer())], [1, 2, 3, 4]);
  const recent = await library.recent();
  assert.deepEqual(recent.map(e => [e.key, e.modifiedTime]), [['drive:new', '2026-10-28T09:00:00Z']]);
  assert.equal(dir.files.size, 1);
  // Different content is never reused.
  assert.equal(await library.cached(drive({ id: 'other', md5Checksum: 'md5:9' })), null);
});

test('copies kept before checksums were stored are matched once by name and size', async () => {
  const dir = fakeDirectory();
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => dir }, md5: fakeMd5 });
  await library.keep(drive({ id: 'legacy' }), new Blob([new Uint8Array([5, 6, 7, 8])]));
  assert.equal((await library.entry(drive({ id: 'legacy' }))).md5, null);
  const hit = await library.cached(drive({ id: 'fresh', modifiedTime: 'later', md5Checksum: 'md5:5,6,7,8' }));
  assert.ok(hit);
  assert.deepEqual((await library.recent()).map(e => e.key), ['drive:fresh']);
});

test('identical duplicates already in Recent are merged into the newest', async () => {
  const dir = fakeDirectory();
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => dir }, md5: fakeMd5 });
  await library.keep(drive({ id: 'aaa111', modifiedTime: '2026-10-20T00:00:00Z' }), new Blob([new Uint8Array([1, 1, 1, 1])]));
  await library.keep(drive({ id: 'bbb222', modifiedTime: '2026-10-27T00:00:00Z' }), new Blob([new Uint8Array([1, 1, 1, 1])]));
  await library.keep(drive({ id: 'ccc333', name: 'Tema 3.noteful' }), new Blob([new Uint8Array([2, 2, 2, 2])]));
  assert.equal(dir.files.size, 3);
  assert.equal(await library.mergeDuplicates(), 1);
  assert.deepEqual((await library.recent()).map(e => e.key).sort(), ['drive:bbb222', 'drive:ccc333']);
  assert.equal(dir.files.size, 2);
});

test('rename changes only the title Recent shows and survives re-downloads and reopening', async () => {
  const { entryTitle } = await import('./library.js');
  const dir = fakeDirectory();
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => dir } });
  const kept = await library.keep(drive(), new Blob(['a']));
  assert.equal(entryTitle(kept), 'Memoria 1');
  const renamed = await library.rename(kept.key, '  Memoria · tema 1  ');
  assert.equal(renamed.title, 'Memoria · tema 1');
  assert.equal(renamed.name, 'Memoria 1.noteful');
  const again = await library.keep(drive({ modifiedTime: 'later' }), new Blob(['b']));
  assert.equal(again.title, 'Memoria · tema 1');
  assert.equal(again.name, 'Memoria 1.noteful');
  assert.ok(dir.files.has('Memoria 1.noteful'));
  assert.equal((await library.rename(kept.key, 'Memoria 1')).title, undefined);
  const local = await library.rememberLocal('/tmp/Test.html', 'Test.html', 10);
  await library.rename(local.key, 'Test PO1');
  assert.equal((await library.rememberLocal('/tmp/Test.html', 'Test.html', 10)).title, 'Test PO1');
  assert.equal(entryTitle(await library.rename(local.key, '')), 'Test.html');
});

test('web links are kept in Recent without a file, and keep a rename', async () => {
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => fakeDirectory() } });
  const entry = await library.rememberWeb('https://curso.notion.site/Temario', 'Temario');
  assert.equal(entry.key, 'web:https://curso.notion.site/Temario');
  assert.equal(await library.open(entry), null);
  await library.rename(entry.key, 'Temario SO');
  assert.equal((await library.rememberWeb('https://curso.notion.site/Temario', 'Temario · Notion')).title, 'Temario SO');
});

test('a local file renamed on disk keeps its Recent entry, title and cover', async () => {
  const library = new Library({ store: memoryStore(), storage: { getDirectory: async () => null } });
  await library.rememberLocal('/d/tema1.md', 'tema1.md', 10);
  await library.rename('local:/d/tema1.md', 'Tema uno');
  await library.saveCover('local:/d/tema1.md', 'data:image/png;base64,AA');
  const moved = await library.moveLocal('/d/tema1.md', '/d/Tema 1.md', 'Tema 1.md');
  assert.deepEqual([moved.key, moved.path, moved.name, moved.title], ['local:/d/Tema 1.md', '/d/Tema 1.md', 'Tema 1.md', 'Tema uno']);
  assert.equal(await library.store.get('entries', 'local:/d/tema1.md'), undefined);
  assert.equal(await library.cover('local:/d/Tema 1.md'), 'data:image/png;base64,AA');
  assert.equal(await library.moveLocal('/d/none.md', '/d/x.md', 'x.md'), null);
});
