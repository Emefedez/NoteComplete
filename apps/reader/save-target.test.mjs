import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMatchingExtension, saveDocumentInPlace } from './save-target.js';

test('hasMatchingExtension matches case-insensitively and rejects mismatched extensions', () => {
  assert.equal(hasMatchingExtension('/notes/Exam.NFEDIT', '.nfedit'), true);
  assert.equal(hasMatchingExtension('/notes/Exam.noteful', '.noteful'), true);
  assert.equal(hasMatchingExtension('/notes/Exam.noteful', '.nfedit'), false);
  assert.equal(hasMatchingExtension(null, '.nfedit'), false);
});

test('Ctrl+S overwrites desktop local: file when extension matches and never writes .nfedit over .noteful', async () => {
  const writes = [];
  const bridge = {
    writeOpened: async (file, bytes) => { writes.push({ file, size: bytes.byteLength }); },
    saveFile: async (suggestedName, bytes) => ({ path: `/picked/${suggestedName}`, name: suggestedName, size: bytes.byteLength }),
  };

  // Matching .nfedit -> writes directly over the opened path via writeOpened.
  const sameExt = await saveDocumentInPlace({
    bytes: new Uint8Array([1, 2, 3, 4]),
    suggestedName: 'Calc.nfedit',
    targetExt: '.nfedit',
    docMember: { source: 'local', path: '/notes/Calc.nfedit', name: 'Calc.nfedit' },
    bridge,
  });
  assert.equal(sameExt.kind, 'local');
  assert.equal(sameExt.overwritten, true);
  assert.deepEqual(writes, [{ file: '/notes/Calc.nfedit', size: 4 }]);

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
  const stored = new Map([['entries:imported:abc', { key: 'imported:abc', source: 'imported', name: 'HW.nfedit', filename: 'HW.nfedit', size: '1' }]]);
  let wroteBlobSize = 0;
  const library = {
    now: () => 9999,
    entry: async (k) => stored.get(`entries:${k}`) || null,
    location: async () => ({ kind: 'browser', write: async (_f, blob) => { wroteBlobSize = blob.size; } }),
    store: { set: async (s, k, v) => stored.set(`${s}:${k}`, v) },
  };
  const viaImported = await saveDocumentInPlace({
    bytes: new Uint8Array([10, 20, 30, 40, 50]),
    suggestedName: 'HW.nfedit',
    targetExt: '.nfedit',
    docMember: { source: 'imported', key: 'imported:abc', name: 'HW.nfedit' },
    library,
  });
  assert.equal(viaImported.kind, 'imported');
  assert.equal(viaImported.overwritten, true);
  assert.equal(wroteBlobSize, 5);
  assert.equal(stored.get('entries:imported:abc').size, '5');
});
