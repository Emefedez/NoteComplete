import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeNoteName,
  extractExclusiveIds,
  scanDuplicates,
  combineDuplicateGroup,
} from './duplicates.js';
import { Library, memoryStore } from './library.js';
import { groupStore } from './groups.js';
import { noteFingerprint } from './find.js';
import initWasm, { EditorSession } from './pkg/noteful_wasm.js';

await initWasm({ module_or_path: readFileSync(new URL('./pkg/noteful_wasm_bg.wasm', import.meta.url)) });

const SAMPLE_EMPTY = readFileSync(new URL('../../samples/nota_vacia.noteful', import.meta.url));
const SAMPLE_EXAM = readFileSync(new URL('../../samples/Examen wuolah.noteful', import.meta.url));

function legacyImportedNoteful(salt = 1) {
  // Minimal valid .noteful binary containing tag 10 key "n:imported" (and extra salt byte so two files differ in hash).
  const enc = new TextEncoder();
  const str = enc.encode('n:imported');
  const payload = Buffer.from([salt & 0xff]);
  const indexBuf = Buffer.alloc(4 + 4 + 4 + str.length);
  indexBuf.writeUInt16LE(10, 0);
  indexBuf.writeUInt16LE(0x0405, 2);
  indexBuf.writeUInt32LE(1, 4);
  indexBuf.writeUInt32LE(str.length, 8);
  Buffer.from(str).copy(indexBuf, 12);

  const head = Buffer.from([0xaa, 0xbb, 0xcc, 0xde]);
  const indexAt = head.length + payload.length;
  const trailer = Buffer.alloc(16);
  head.copy(trailer, 0);
  trailer.writeBigUInt64LE(BigInt(indexAt), 4);
  trailer.writeUInt32LE(indexBuf.length, 12);
  return new Uint8Array(Buffer.concat([head, payload, indexBuf, trailer]));
}

function patchSampleUuid(bytes, fromHex, toHex) {
  const copy = Buffer.from(bytes);
  const idx = copy.indexOf(fromHex);
  if (idx >= 0) copy.write(toHex, idx, 'ascii');
  return new Uint8Array(copy);
}

test('normalizeNoteName strips extensions and copy suffixes accurately', () => {
  assert.equal(normalizeNoteName('Tema 1 (1).nfedit'), 'tema 1');
  assert.equal(normalizeNoteName('Tema 1 (a1b2c3).noteful'), 'tema 1');
  assert.equal(normalizeNoteName('Temario_Final copy 2.pdf'), 'temario final');
});

test('extractExclusiveIds ignores shared n:imported and extracts .noteful + .nfedit source_base64 UUIDs', async () => {
  const importedNote = new File([legacyImportedNoteful(1)], 'Legacy.noteful');
  assert.deepEqual(await extractExclusiveIds({ name: 'Legacy.noteful' }, importedNote), []);

  const uniqueNote = new File([SAMPLE_EMPTY], 'Original.noteful');
  const noteIds = await extractExclusiveIds({ name: 'Original.noteful' }, uniqueNote);
  assert.deepEqual(noteIds, ['noteful:cde005b6f97a4da0a240fc6071b776f4']);

  const base64 = Buffer.from(SAMPLE_EMPTY).toString('base64');
  const nfeditFile = new File(
    [JSON.stringify({ format: 'nfedit', version: 12, source_base64: base64, history: [], cursor: 0 })],
    'Renamed Copy.nfedit',
  );
  const nfeditIds = await extractExclusiveIds({ name: 'Renamed Copy.nfedit' }, nfeditFile);
  assert.deepEqual(nfeditIds, ['noteful:cde005b6f97a4da0a240fc6071b776f4']);
});

test('scanDuplicates groups by content hash, exclusive ID (ignoring n:imported), and normalized name', async () => {
  const store = memoryStore();
  const memFiles = new Map();
  const library = new Library({ store });
  library.folder = {
    kind: 'folder',
    label: 'Memory',
    read: async (name) => memFiles.get(name) || null,
    write: async (name, blob) => { memFiles.set(name, blob); },
    remove: async (name) => { memFiles.delete(name); },
  };

  // Group 1: exact same PDF content under different names (Hash match)
  const samePdf = new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 1, 2, 3])], 'RandomNameA.pdf', { type: 'application/pdf' });
  const samePdf2 = new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 1, 2, 3])], 'DifferentNameB.pdf', { type: 'application/pdf' });
  await library.rememberImported(samePdf, { origin: 'File picker' });
  await library.keep({ id: 'drv-pdf', name: 'DifferentNameB.pdf' }, samePdf2);

  // Group 2: .noteful and renamed .nfedit sharing exclusive noteful UUID (Note ID match)
  const origBytes = patchSampleUuid(SAMPLE_EXAM, '7A218A7B854042129E7BC21136141F5E', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  const orig = new File([origBytes], 'Original Note.noteful');
  const b64 = Buffer.from(origBytes).toString('base64');
  const proj = new File(
    [JSON.stringify({ format: 'nfedit', version: 12, source_base64: b64, history: [], cursor: 0 })],
    'Totally Different Title.nfedit',
  );
  await library.keep({ id: 'drv-orig', name: 'Original Note.noteful', modifiedTime: '2026-01-01T00:00:00Z' }, orig);
  await library.rememberImported(proj, { origin: 'File picker' });

  // Group 3 (Non-match): Two DIFFERENT notes that both use legacy n:imported — must NOT match by Note ID or hash.
  const leg1 = new File([legacyImportedNoteful(1)], 'Physics.noteful');
  const leg2 = new File([legacyImportedNoteful(2)], 'Chemistry.noteful');
  await library.keep({ id: 'drv-phy', name: 'Physics.noteful' }, leg1);
  await library.keep({ id: 'drv-chem', name: 'Chemistry.noteful' }, leg2);

  // Group 4: Normalized name match ("Algebra (2).pdf" vs "Algebra.pdf" with different bytes)
  await library.keep({ id: 'drv-alg1', name: 'Algebra.pdf' }, new File(['pdf-v1'], 'Algebra.pdf'));
  await library.keep({ id: 'drv-alg2', name: 'Algebra (2).pdf' }, new File(['pdf-v2'], 'Algebra (2).pdf'));

  const result = await scanDuplicates({ library });
  assert.equal(result.total, 8);
  assert.equal(result.groups.length, 3);

  const hashGroup = result.groups.find((g) => g.items.some((i) => i.entry.name === 'RandomNameA.pdf'));
  assert.ok(hashGroup);
  assert.ok(hashGroup.reasons.includes('Hash'));

  const idGroup = result.groups.find((g) => g.items.some((i) => i.entry.name === 'Totally Different Title.nfedit'));
  assert.ok(idGroup);
  assert.deepEqual(idGroup.reasons, ['Note ID']);
  assert.match(idGroup.recommendedKeepKey, /^imported:/);

  const nameGroup = result.groups.find((g) => g.items.some((i) => i.entry.name === 'Algebra.pdf'));
  assert.ok(nameGroup);
  assert.deepEqual(nameGroup.reasons, ['Name']);
  assert.ok(!result.groups.some((g) => g.items.some((i) => i.entry.name === 'Physics.noteful')));
});

test('combineDuplicateGroup merges study resources, cover, groups/stars, exams, and removes extra copies', async () => {
  const store = memoryStore();
  const memFiles = new Map();
  const library = new Library({ store });
  library.folder = {
    kind: 'folder',
    label: 'Memory',
    read: async (name) => memFiles.get(name) || null,
    write: async (name, blob) => { memFiles.set(name, blob); },
    remove: async (name) => { memFiles.delete(name); },
  };
  const groups = groupStore({ store });

  const f1 = new File([SAMPLE_EMPTY], 'Topic 1.noteful');
  const b64 = Buffer.from(SAMPLE_EMPTY).toString('base64');
  const f2 = new File([JSON.stringify({ format: 'nfedit', version: 12, source_base64: b64, history: [], cursor: 0 })], 'Topic 1.nfedit');

  const e1 = await library.keep({ id: 'drv-1', name: 'Topic 1.noteful' }, f1);
  const e2 = await library.rememberImported(f2, { origin: 'Imported' });
  const fp1 = await noteFingerprint(f1);
  const fp2 = await noteFingerprint(f2);

  await library.saveCover(library.coverKey({ id: e1.driveId, modifiedTime: e1.modifiedTime }), 'data:image/jpeg;base64,COVER1');
  await store.set('settings', `decks:${fp1}`, [{ id: 'd1', name: 'Deck 1' }]);
  await store.set('settings', `quizzes:${fp1}`, [{ id: 'q1', q: 'Question' }]);
  await store.set('settings', `scratch:${fp1}`, [{ id: 's1', title: 'Chat' }]);
  await store.set('settings', `notes:${fp1}`, 'Notes from v1');
  await store.set('settings', `notes:${fp2}`, 'Notes from v2');
  await store.set('settings', 'exams', [{ id: 'ex1', title: 'Mock', entryKey: e1.key }]);
  await groups.save({
    id: 'folder-study',
    name: 'SO',
    kind: 'folder',
    members: [{ key: e1.key, name: e1.name, source: 'drive' }],
    starred: [e1.key],
  });

  const scan = await scanDuplicates({ library });
  assert.equal(scan.groups.length, 1);
  const group = scan.groups[0];

  const res = await combineDuplicateGroup({
    group,
    keepKey: e2.key,
    library,
    groups,
  });
  assert.equal(res.kept.key, e2.key);
  assert.equal(res.removed, 1);

  assert.equal(await store.get('entries', e1.key), undefined);
  assert.ok(await store.get('entries', e2.key));
  assert.equal(await library.cover(e2.key), 'data:image/jpeg;base64,COVER1');
  assert.equal((await store.get('settings', `decks:${fp2}`)).length, 1);
  assert.equal((await store.get('settings', `quizzes:${fp2}`)).length, 1);
  assert.equal((await store.get('settings', `scratch:${fp2}`)).length, 1);
  assert.match(await store.get('settings', `notes:${fp2}`), /Notes from v1/);
  assert.match(await store.get('settings', `notes:${fp2}`), /Notes from v2/);
  assert.equal((await store.get('settings', 'exams'))[0].entryKey, e2.key);

  const grp = (await groups.all())[0];
  assert.deepEqual(grp.members.map((m) => m.key), [e2.key]);
  assert.deepEqual(grp.starred, [e2.key]);
});

test('normalizeNoteName also drops the Drive id tags older versions put in file names', () => {
  assert.equal(normalizeNoteName('Tema 3 (12oD0v).noteful'), 'tema 3');
  assert.equal(normalizeNoteName('Resumen T1+2 (1PdNjm).noteful'), 'resumen t1 2');
  assert.equal(normalizeNoteName('Tema 3 (2).noteful'), 'tema 3');
  assert.equal(normalizeNoteName('Apuntes (Tema12)'), 'apuntes tema12', 'a word in brackets is kept');
});
