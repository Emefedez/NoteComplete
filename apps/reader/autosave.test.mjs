import test from 'node:test';
import assert from 'node:assert/strict';
import { autosaveStore, memoryBackend, pruned, offerRecovery, when, SLOTS } from './autosave.js';

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
