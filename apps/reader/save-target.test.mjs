import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMatchingExtension, saveDocumentInPlace } from './save-target.js';
import { Library, memoryStore } from './library.js';

test('hasMatchingExtension matches case-insensitively and rejects mismatched extensions', () => {
  assert.equal(hasMatchingExtension('/notes/Exam.NFEDIT', '.nfedit'), true);
  assert.equal(hasMatchingExtension('/notes/Exam.noteful', '.noteful'), true);
  assert.equal(hasMatchingExtension('/notes/Exam.noteful', '.nfedit'), false);
  assert.equal(hasMatchingExtension(null, '.nfedit'), false);
});

test('Ctrl+S overwrites desktop local: file when extension matches and never writes .nfedit over .noteful', async () => {
  const writes = [];
  const bridge = {
    writeOpened: async (file, bytes) => {
      assert.ok(bytes instanceof Uint8Array, 'writeOpened must always receive Uint8Array');
      writes.push({ file, size: bytes.byteLength, text: new TextDecoder().decode(bytes) });
    },
    saveFile: async (suggestedName, bytes) => {
      assert.ok(bytes instanceof Uint8Array, 'saveFile must always receive Uint8Array');
      return { path: `/picked/${suggestedName}`, name: suggestedName, size: bytes.byteLength };
    },
  };

  // Matching .nfedit with worker string payload -> encoded to Uint8Array before writeOpened.
  const sameExt = await saveDocumentInPlace({
    bytes: '{"version":12}',
    suggestedName: 'Calc.nfedit',
    targetExt: '.nfedit',
    docMember: { source: 'local', path: '/notes/Calc.nfedit', name: 'Calc.nfedit' },
    bridge,
  });
  assert.equal(sameExt.kind, 'local');
  assert.equal(sameExt.overwritten, true);
  assert.equal(sameExt.size, 14);
  assert.deepEqual(writes, [{ file: '/notes/Calc.nfedit', size: 14, text: '{"version":12}' }]);

  // Mismatched .noteful saved as .nfedit -> must prompt Save dialog (never clobber .noteful).
  const switched = await saveDocumentInPlace({
    bytes: new Uint8Array([9, 8]),
    suggestedName: 'Calc.nfedit',
    targetExt: '.nfedit',
    docMember: { source: 'local', path: '/notes/Calc.noteful', name: 'Calc.noteful' },
    bridge,
  });
  assert.equal(switched.kind, 'local');
  assert.equal(switched.overwritten, false);
  assert.equal(switched.path, '/picked/Calc.nfedit');
  assert.equal(writes.length, 1);
});

test('Ctrl+S overwrites browser FileSystemFileHandle and imported library entries in place', async () => {
  let written = null;
  let closed = false;
  const handle = {
    name: 'Week1.nfedit',
    queryPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (b) => { written = b; },
      close: async () => { closed = true; },
    }),
  };
  const viaHandle = await saveDocumentInPlace({
    bytes: new Uint8Array([5, 6, 7]),
    suggestedName: 'Week1.nfedit',
    targetExt: '.nfedit',
    saveFileHandle: handle,
  });
  assert.equal(viaHandle.kind, 'handle');
  assert.equal(viaHandle.overwritten, true);
  assert.equal(closed, true);
  assert.deepEqual([...written], [5, 6, 7]);

  // Cancelling showSaveFilePicker returns cancelled cleanly without falling back to download.
  let downloaded = false;
  const cancelled = await saveDocumentInPlace({
    bytes: new Uint8Array([1]),
    suggestedName: 'New.nfedit',
    targetExt: '.nfedit',
    showSaveFilePicker: async () => { const e = Error('cancel'); e.name = 'AbortError'; throw e; },
    download: async () => { downloaded = true; return { cancelled: false, shared: false }; },
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(downloaded, false);

  // Imported library copy with matching extension updates stored file in place.
  const library = new Library({ store: memoryStore(), storage: null });
  const imported = await library.rememberImported(new File([new Uint8Array([1])], 'HW.nfedit'), { origin: 'File picker' });
  const viaImported = await saveDocumentInPlace({
    bytes: new Uint8Array([10, 20, 30, 40, 50]),
    suggestedName: 'HW.nfedit',
    targetExt: '.nfedit',
    docMember: { source: 'imported', key: imported.key, name: 'HW.nfedit' },
    library,
  });
  assert.equal(viaImported.kind, 'imported');
  assert.equal(viaImported.overwritten, true);
  assert.equal(viaImported.entry.key, imported.key);
  assert.equal((await library.entry(imported.key)).size, '5');
  assert.equal((await library.open(await library.entry(imported.key))).size, 5);
});

test('web and phone: a new note is kept in the library, listed in Recent, and saved over after', async () => {
  const library = new Library({ store: memoryStore(), storage: null });
  let picked = false, downloaded = false;
  const options = {
    targetExt: '.nfedit',
    library,
    showSaveFilePicker: async () => { picked = true; },
    download: async () => { downloaded = true; return {}; },
  };
  const first = await saveDocumentInPlace({ ...options, bytes: new Uint8Array([1, 2]), suggestedName: 'Lecture 4.nfedit' });
  assert.equal(first.kind, 'imported');
  assert.equal(first.created, true);
  assert.equal(picked || downloaded, false);
  assert.deepEqual((await library.recent()).map(e => e.name), ['Lecture 4.nfedit']);
  const again = await saveDocumentInPlace({ ...options, bytes: new Uint8Array([1, 2, 3]), suggestedName: 'Lecture 4.nfedit', docMember: { source: 'imported', key: first.entry.key, name: first.entry.name } });
  assert.equal(again.overwritten, true);
  assert.equal(again.entry.key, first.entry.key);
  const recent = await library.recent();
  assert.equal(recent.length, 1);
  assert.deepEqual([...new Uint8Array(await (await library.open(recent[0])).arrayBuffer())], [1, 2, 3]);
});

test('an imported .noteful saved as a project moves its Recent entry to the .nfedit copy', async () => {
  const library = new Library({ store: memoryStore(), storage: null });
  const imported = await library.rememberImported(new File([new Uint8Array([7, 7])], 'Tema 3.noteful'), { origin: 'WhatsApp' });
  const saved = await saveDocumentInPlace({
    bytes: new Uint8Array([9]),
    suggestedName: 'Tema 3.nfedit',
    targetExt: '.nfedit',
    docMember: { source: 'imported', key: imported.key, name: imported.name },
    library,
  });
  assert.equal(saved.kind, 'imported');
  assert.equal(saved.overwritten, false);
  const [entry] = await library.recent();
  assert.equal(entry.key, imported.key);
  assert.equal(entry.filename, 'Tema 3.nfedit');
  assert.equal(entry.origin, 'WhatsApp');
  assert.equal(await (await library.location()).read('Tema 3.noteful'), null);
  // Opening the original again keeps the edited copy and lists the original beside it.
  const reopened = await library.rememberImported(new File([new Uint8Array([7, 7])], 'Tema 3.noteful'), { origin: 'WhatsApp' });
  assert.notEqual(reopened.key, imported.key);
  assert.equal((await library.entry(imported.key)).filename, 'Tema 3.nfedit');
  const twice = await library.rememberImported(new File([new Uint8Array([7, 7])], 'Tema 3.noteful'), { origin: 'WhatsApp' });
  assert.equal(twice.key, reopened.key);
  assert.equal((await library.recent()).length, 2);
});
