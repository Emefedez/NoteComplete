import test from 'node:test';
import assert from 'node:assert/strict';
import { autosaveStore, autosaveController, memoryBackend, pruned, offerRecovery, when, projectSize, sizeLabel, bytesText, contentDigestCache, SLOTS } from './autosave.js';

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

test('contentDigestCache skips recomputing when the history mark has not moved', async () => {
  let calls = 0;
  const digest = contentDigestCache(async () => `d${++calls}`);
  assert.equal(await digest({ edits: 2, digest: 'm1' }, 1), 'd1');
  assert.equal(await digest({ edits: 2, digest: 'm1' }, 1), 'd1', 'same mark and epoch reuse the digest');
  assert.equal(calls, 1);
  assert.equal(await digest({ edits: 3, digest: 'm2' }, 1), 'd2', 'new history mark recomputes');
  assert.equal(await digest({ edits: 3, digest: 'm2' }, 2), 'd3', 'new note epoch recomputes');
  assert.equal(calls, 3);

  const failing = contentDigestCache(async () => { throw Error('canvas'); });
  assert.equal(await failing({ edits: 0, digest: 'm0' }, 1), null);
});

test('autosaveController saves changed notes, offers recovery only when different, and compacts history', async () => {
  const store = autosaveStore(memoryBackend());
  let doc = { edit_count: 2, history_floor: 0, can_redo: false };
  let revision = 1, epoch = 1, mark = { edits: 2, digest: 'h1' }, content = 'c1', project = '{"v":1}';
  const elements = new Map();
  const makeEl = () => ({
    textContent: '', title: '', hidden: false, disabled: false, open: false,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {},
    replaceChildren() {},
    showModal() { this.shown = true; },
    close() { this.shown = false; },
  });
  for (const id of ['title', 'autosaveToggle', 'recoverDialog', 'recoverText', 'recoverAuto', 'recoverManual']) {
    elements.set(id, makeEl());
  }
  elements.get('title').textContent = 'Physics';
  const statuses = [];
  let compacted = null;

  const ctrl = autosaveController({
    store,
    state: {
      doc: () => doc,
      editing: () => false,
      busy: () => false,
      revision: () => revision,
      epoch: () => epoch,
      collab: () => null,
      fingerprint: () => 'fp-physics',
    },
    call: async (op) => {
      if (op === 'save') return project;
      if (op === 'historyMark') return mark;
      if (op === 'contentDigest') return content;
      if (op === 'compactPreview') return { bytes_before: 20480, bytes_after: 10240 };
      if (op === 'compactHistory') return { report: { edits_before: 2, edits_after: 1, bytes_before: 20480, bytes_after: 10240 }, view: { edit_count: 1 } };
      return null;
    },
    status: (msg) => statuses.push(msg),
    $: (id) => elements.get(id) || null,
    win: null,
    storage: null,
    confirmFn: () => true,
    intervalMs: 0,
    onCompacted: (view, msg) => { compacted = { view, msg }; },
  });

  await ctrl.opened(null);
  assert.equal(await ctrl.now(), null, 'no save when revision has not changed since open');
  revision = 2;
  const saved = await ctrl.now();
  assert.equal(saved.key, 'fp-physics');
  assert.equal(saved.content, 'c1');
  assert.equal(await ctrl.now(), null, 'no duplicate save at the same revision');

  // Reopening with the same content digest suppresses the recovery dialog.
  mark = { edits: 0, digest: 'reopened' };
  project = '{"v":2}';
  await ctrl.opened(null);
  assert.ok(!elements.get('recoverDialog').shown);

  // A newer slot with different content offers recovery.
  await store.save({ key: 'fp-physics', title: 'Physics', project: '{"v":3}', time: Date.now() + 5000, mark: { edits: 4, digest: 'h4' }, content: 'c4' });
  await ctrl.opened(null);
  assert.equal(elements.get('recoverDialog').shown, true);

  await ctrl.compact(2, 'up to now');
  assert.equal(compacted.view.edit_count, 1);
  assert.match(compacted.msg, /1 edit fewer, 10 KB smaller/);
  assert.equal(bytesText(1572864), '1.5 MB');
});
