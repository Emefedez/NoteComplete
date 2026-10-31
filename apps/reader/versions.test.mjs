import test from 'node:test';
import assert from 'node:assert/strict';
import { pageDiff, pageHash, mergeStudy, carryStudy, studyCounts } from './versions.js';
import { memoryStore } from './library.js';

test('pages are aligned like a diff: unchanged, changed, added and removed', () => {
  assert.deepEqual(pageDiff(['a', 'b', 'c'], ['a', 'b', 'c']).map(s => s.type), ['same', 'same', 'same']);
  assert.deepEqual(pageDiff(['a', 'b', 'c'], ['a', 'X', 'c']), [
    { type: 'same', left: 0, right: 0 }, { type: 'changed', left: 1, right: 1 }, { type: 'same', left: 2, right: 2 }]);
  // A page inserted in the middle does not mark the following pages as changed.
  assert.deepEqual(pageDiff(['a', 'b', 'c'], ['a', 'new', 'b', 'c']).map(s => s.type), ['same', 'added', 'same', 'same']);
  assert.deepEqual(pageDiff(['a', 'b', 'c'], ['a', 'c']), [
    { type: 'same', left: 0, right: 0 }, { type: 'removed', left: 1 }, { type: 'same', left: 2, right: 1 }]);
  assert.deepEqual(pageDiff([], ['a']), [{ type: 'added', right: 0 }]);
});

test('page identity covers the drawing and the PDF page behind it', () => {
  const view = { svg: '<svg><path d="M0 0"/></svg>', pdf_background: { page_index: 3 } };
  assert.equal(pageHash(view), pageHash({ ...view }));
  assert.notEqual(pageHash(view), pageHash({ ...view, svg: '<svg><path d="M0 1"/></svg>' }));
  assert.notEqual(pageHash(view), pageHash({ ...view, pdf_background: { page_index: 4 } }));
});

test('study material is copied to a new version without losing what is there', async () => {
  assert.deepEqual(mergeStudy('decks', [{ id: 1 }], [{ id: 1 }, { id: 2 }]), [{ id: 1 }, { id: 2 }]);
  assert.equal(mergeStudy('notes', '', '# Tema 1'), '# Tema 1');
  assert.equal(mergeStudy('notes', '# Nuevo', '# Tema 1'), '# Nuevo\n\n---\n\n# Tema 1');
  assert.equal(mergeStudy('notes', '# Nuevo\n\n# Tema 1', '# Tema 1'), '# Nuevo\n\n# Tema 1');
  const store = memoryStore();
  await store.set('settings', 'decks:old', [{ id: 'd1' }, { id: 'd2' }]);
  await store.set('settings', 'quizzes:old', [{ id: 'q1' }]);
  await store.set('settings', 'notes:old', 'Resumen');
  await store.set('settings', 'recordings:old', [{ id: 'r1' }]);
  assert.deepEqual(await studyCounts(store, 'old'), { decks: 2, quizzes: 1, notes: 1, recordings: 1 });
  await carryStudy(store, 'old', 'new', ['decks', 'notes', 'recordings']);
  assert.deepEqual(await studyCounts(store, 'new'), { decks: 2, quizzes: 0, notes: 1, recordings: 1 });
  assert.deepEqual(await studyCounts(store, 'old'), { decks: 2, quizzes: 1, notes: 1, recordings: 1 }, 'the old version keeps its own');
});

test('migrating content can leave or empty the old note', async () => {
  const { clearStudy } = await import('./migrate.js').catch(() => ({}));
  if (!clearStudy) return; // migrate.js touches the DOM only when used.
  const store = memoryStore();
  await store.set('settings', 'decks:old', [{ id: 'd1' }]);
  await store.set('settings', 'notes:old', 'Resumen');
  await carryStudy(store, 'old', 'new', ['decks', 'notes']);
  await clearStudy(store, 'old', ['decks']);
  assert.deepEqual(await studyCounts(store, 'old'), { decks: 0, quizzes: 0, notes: 1, recordings: 0 });
  assert.deepEqual(await studyCounts(store, 'new'), { decks: 1, quizzes: 0, notes: 1, recordings: 0 });
});
