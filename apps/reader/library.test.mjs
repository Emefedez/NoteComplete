import test from 'node:test';
import assert from 'node:assert/strict';
import { Library, memoryStore, safeName } from './library.js';

function fakeDirectory(name = 'Notes') {
  const files = new Map();
  return {
    name, files,
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
