import test from 'node:test';
import assert from 'node:assert/strict';
import { autosaveStore, memoryBackend, pruned, offerRecovery, when, projectSize, sizeLabel, SLOTS } from './autosave.js';

const bytes = (text) => new TextEncoder().encode(text);

test('a note keeps its last slots; the oldest go, other notes are untouched', async () => {
  const store = autosaveStore(memoryBackend());
  for (let i = 0; i < SLOTS + 2; i++) await store.save({ key: 'exam', title: 'Exam', project: bytes(`v${i}`), time: 1000 + i });
  await store.save({ key: 'other', title: 'Other', project: bytes('o'), time: 500 });
  const exam = await store.list('exam');
  assert.equal(exam.length, SLOTS);
  assert.equal(new TextDecoder().decode(await store.load(exam[0].id)), `v${SLOTS + 1}`, 'newest first');
  assert.equal((await store.list('other')).length, 1);
  assert.equal((await store.list()).length, SLOTS + 1);
});

test('the cap across notes drops the oldest slots of any note', () => {
  const slots = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, key: `n${i}`, time: i }));
  assert.deepEqual(pruned(slots, 5, 4).sort(), ['s0', 's1']);
});

test('recovery is offered only for an automatic save newer than the last manual one', async () => {
  const store = autosaveStore(memoryBackend());
  await store.markManual('exam', 5000);
  assert.equal(offerRecovery(null, 5000), false);
  const old = await store.save({ key: 'exam', project: bytes('a'), time: 4000 });
  assert.equal(offerRecovery(old, await store.manualAt('exam')), false);
  const newer = await store.save({ key: 'exam', project: bytes('b'), time: 9000 });
  assert.equal(offerRecovery(newer, await store.manualAt('exam')), true);
  assert.equal((await store.list()).some((s) => s.manual), false, 'the manual mark is not a slot');
});

test('slot times read as today, yesterday or a date', () => {
  const now = new Date(2026, 10, 2, 12, 0).getTime();
  assert.match(when(new Date(2026, 10, 2, 10, 32).getTime(), now), /^Today /);
  assert.match(when(new Date(2026, 10, 1, 18, 5).getTime(), now), /^Yesterday /);
  assert.doesNotMatch(when(new Date(2026, 9, 20, 9, 0).getTime(), now), /Today|Yesterday/);
});

test('a slot records the size of a project given as text, in UTF-8 bytes', async () => {
  const store = autosaveStore(memoryBackend());
  // The reader's case: the engine's `save` answers with a string.
  const text = '{"title":"Año","ink":"…"}';
  const slot = await store.save({ key: 'exam', title: 'Exam', project: text, time: 1000 });
  assert.equal(slot.size, bytes(text).length);
  assert.ok(slot.size > text.length, 'counted in bytes, not characters');
  assert.equal((await store.list('exam'))[0].size, slot.size);
  assert.equal(await store.load(slot.id), text, 'the project is stored as given');
  const binary = await store.save({ key: 'exam', project: bytes('abcd'), time: 2000 });
  assert.equal(binary.size, 4);
});

test('sizes of strings, bytes, buffers and blobs; a row never reads NaN', () => {
  assert.equal(projectSize(''), 0);
  assert.equal(projectSize('é'), 2);
  assert.equal(projectSize(new Uint8Array(7)), 7);
  assert.equal(projectSize(new ArrayBuffer(9)), 9);
  assert.equal(projectSize(new Blob(['abc'])), 3);
  assert.equal(projectSize(null), 0);
  assert.equal(sizeLabel(1572864), ' · 1.5 MB');
  assert.equal(sizeLabel(0), ' · 0.0 MB');
  assert.equal(sizeLabel(undefined), '', 'a slot saved without a size shows none');
});
