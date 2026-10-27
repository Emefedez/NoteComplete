import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { noteFacts, matches } from './note-facts.js';

const ranged = bytes => { const calls = []; return { calls, read: async (a, b) => { calls.push(b - a); return bytes.slice(a, b); } }; };
const sample = name => new Uint8Array(readFileSync(new URL(`../../samples/${encodeURIComponent(name)}`, import.meta.url)));

test('recordings and pages come from the index and drawing block', async () => {
  const book = sample('Practice book (vol. 1).noteful');
  const { read } = ranged(book);
  const facts = await noteFacts(read, book.length);
  assert.equal(facts.pages, 193);
  assert.equal(facts.audio.count, 1);
  assert.ok(facts.audio.seconds > 10);
  const exam = sample('Examen wuolah.noteful');
  const f = await noteFacts(ranged(exam).read, exam.length);
  assert.deepEqual([f.pages, f.audio.count, f.tags], [3, 0, []]);
});

// The owner's electronics note has one Noteful tag; it is outside the repository.
const owner = process.env.NOTECOMPLETE_TAG_NOTE;
test('Noteful tags (kind 19) are listed when the note is available', { skip: !owner || !existsSync(owner) }, async () => {
  const bytes = new Uint8Array(readFileSync(owner));
  const { read, calls } = ranged(bytes);
  const facts = await noteFacts(read, bytes.length);
  assert.deepEqual(facts.tags, ['SD I']);
  assert.ok(calls.reduce((a, b) => a + b, 0) < bytes.length / 4);
});

test('filters stack: period, audio, all selected tags and any selected size', () => {
  const now = Date.now();
  const note = { modified: now - 3 * 864e5, size: 42e6, facts: { audio: { count: 2 }, tags: ['SD I', 'Tema 1'] } };
  assert.ok(matches(note, {}));
  assert.ok(matches(note, { since: now - 7 * 864e5, audio: true, tags: ['SD I'], sizes: ['medium'] }));
  assert.ok(!matches(note, { since: now - 864e5 }));
  assert.ok(!matches(note, { tags: ['SD I', 'Otro'] }));
  assert.ok(!matches(note, { sizes: ['small', 'large'] }));
  assert.ok(!matches({ ...note, facts: { audio: { count: 0 }, tags: null } }, { audio: true }));
});
import { compareNotes } from './note-facts.js';
test('sorting is natural A–Z by default, or by date and size', () => {
  const notes = [{ name: 'Tema 10', modified: 3, size: 5 }, { name: 'tema 2', modified: 1, size: 50 }, { name: 'Álgebra', modified: 2, size: 1 }];
  assert.deepEqual([...notes].sort(compareNotes()).map(n => n.name), ['Álgebra', 'tema 2', 'Tema 10']);
  assert.deepEqual([...notes].sort(compareNotes('newest')).map(n => n.modified), [3, 2, 1]);
  assert.deepEqual([...notes].sort(compareNotes('largest')).map(n => n.size), [50, 5, 1]);
});
