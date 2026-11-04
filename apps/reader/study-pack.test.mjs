import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from './library.js';
import { studyOf, summary, describePack, buildPack, readPack, importPack, PACK_FORMAT } from './study-pack.js';

const deck = (id, n) => ({ id, title: `Deck ${id}`, created: 1, cards: Array.from({ length: n }, (_, i) => ({ front: `q${i}`, back: `a${i}` })) });
const quiz = (id, n) => ({ id, title: `Quiz ${id}`, questions: Array.from({ length: n }, (_, i) => ({ q: `p${i}`, options: ['a', 'b'], answer: 0 })) });

test('a note\'s study material is read from the store, empty kinds left out', async () => {
  const store = memoryStore();
  await store.set('settings', 'decks:fp1', [deck('d1', 3)]);
  await store.set('settings', 'quizzes:fp1', []);
  await store.set('settings', 'notes:fp1', '  \n');
  assert.deepEqual(Object.keys(await studyOf(store, 'fp1')), ['decks']);
  await store.set('settings', 'notes:fp1', '# Tema 1\n');
  assert.deepEqual(Object.keys(await studyOf(store, 'fp1')), ['decks', 'notes']);
  assert.deepEqual(await studyOf(store, 'nothing'), {});
});

test('a pack says what it holds, and builds only what is chosen', () => {
  const study = { decks: [deck('d1', 3), deck('d2', 2)], quizzes: [quiz('q1', 4)], notes: '# Tema 1\n' };
  const all = buildPack({ title: 'Tema 1', fingerprint: 'fp1', from: 'Ana', study });
  assert.deepEqual(summary(all), { decks: 2, cards: 5, quizzes: 1, questions: 4, notes: 9 });
  assert.equal(describePack(all), '2 flashcard decks (5 cards), 1 quiz (4 questions), Markdown notes');
  const some = buildPack({ title: 'Tema 1', study, include: { quizzes: false, notes: false } });
  assert.deepEqual(Object.keys(some).filter((k) => ['decks', 'quizzes', 'notes'].includes(k)), ['decks']);
  assert.throws(() => buildPack({ title: 'x', study: {} }), /no study material/);
  assert.throws(() => buildPack({ title: 'x', study, include: { decks: false, quizzes: false, notes: false } }), /no study material/);
});

test('a pack read from outside is checked and cleaned', () => {
  const pack = buildPack({ title: 'Tema 1', fingerprint: 'fp1', study: { decks: [deck('d1', 2)], notes: 'hi' } });
  const back = readPack(JSON.stringify(pack));
  assert.equal(back.format, PACK_FORMAT);
  assert.deepEqual(summary(back), summary(pack));
  assert.throws(() => readPack('{"format":"other"}'), /not a NoteComplete study pack/);
  assert.throws(() => readPack({ ...pack, version: 99 }), /newer NoteComplete/);
  assert.throws(() => readPack({ format: PACK_FORMAT, version: 1, decks: [{ nope: true }], quizzes: [] }), /empty/);
  // Unknown fields and broken records are dropped, not trusted.
  const dirty = readPack({ ...pack, extra: 'x', decks: [deck('d1', 1), null, 5, { cards: 'no' }], __proto__: { polluted: 1 } });
  assert.deepEqual(Object.keys(dirty).sort(), ['created', 'decks', 'format', 'fingerprint', 'from', 'notes', 'title', 'version'].sort());
  assert.equal(dirty.decks.length, 1);
  assert.equal(({}).polluted, undefined);
});

test('a pack for a document this device has is merged into it; otherwise it is a document of its own', async () => {
  const store = memoryStore();
  // This device already has the document and one of the decks.
  await store.set('settings', 'doc:fp1', { title: 'Tema 1', at: 1 });
  await store.set('settings', 'decks:fp1', [deck('d1', 3)]);
  await store.set('settings', 'notes:fp1', 'mis apuntes');
  const pack = readPack(buildPack({ title: 'Tema 1', fingerprint: 'fp1', from: 'Ana', study: { decks: [deck('d1', 3), deck('d2', 2)], quizzes: [quiz('q1', 1)], notes: 'apuntes de Ana' } }));
  const first = await importPack(store, pack);
  assert.equal(first.merged, true);
  assert.equal(first.fingerprint, 'fp1');
  assert.deepEqual((await store.get('settings', 'decks:fp1')).map((d) => d.id), ['d1', 'd2'], 'the deck it had is not doubled');
  assert.equal((await store.get('settings', 'quizzes:fp1')).length, 1);
  assert.match(await store.get('settings', 'notes:fp1'), /mis apuntes[\s\S]*apuntes de Ana/);
  // Importing it again changes nothing.
  await importPack(store, pack);
  assert.equal((await store.get('settings', 'decks:fp1')).length, 2);
  // Another device does not have the document: it becomes one of its own.
  const other = memoryStore();
  const kept = await importPack(other, pack, { now: () => 1700000000000 });
  assert.equal(kept.merged, false);
  assert.match(kept.fingerprint, /^received:/);
  assert.deepEqual(await other.get('settings', `doc:${kept.fingerprint}`), { title: 'Tema 1 (from Ana)', entryKey: '', at: 1700000000000 });
  assert.equal((await other.get('settings', `decks:${kept.fingerprint}`)).length, 2);
});

test('the description is in the singular where it should be', () => {
  const one = buildPack({ title: 'x', study: { decks: [deck('d1', 1)], quizzes: [quiz('q1', 1)] } });
  assert.equal(describePack(one), '1 flashcard deck (1 card), 1 quiz (1 question)');
});
