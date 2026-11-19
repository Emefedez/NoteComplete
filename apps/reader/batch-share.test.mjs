import test from 'node:test';
import assert from 'node:assert/strict';
import { zipNames, bundleName, shareSheetFiles, shareable } from './batch-share.js';

test('zip names are safe and never repeat', () => {
  assert.deepEqual(
    zipNames(['Notes.nfedit', 'notes.nfedit', 'Notes.nfedit', 'a/b:c.pdf', '', 'README']),
    ['Notes.nfedit', 'notes (2).nfedit', 'Notes (3).nfedit', 'a_b_c.pdf', 'Note', 'README'],
  );
});

test('the .zip is named after the count and the day', () => {
  assert.equal(bundleName(1, new Date(2026, 10, 9)), 'NoteComplete 1 note 2026-11-09.zip');
  assert.equal(bundleName(3, new Date(2026, 0, 31)), 'NoteComplete 3 notes 2026-01-31.zip');
});

test('the share sheet is offered only where files can be shared', () => {
  const files = [{ name: 'a' }];
  assert.equal(shareSheetFiles(files, {}), null);
  assert.equal(shareSheetFiles([], { share() {}, canShare: () => true }), null);
  assert.equal(shareSheetFiles(files, { share() {}, canShare: () => false }), null);
  assert.equal(shareSheetFiles(files, { share() {}, canShare: () => { throw Error('no'); } }), null);
  assert.equal(shareSheetFiles(files, { share() {}, canShare: () => true }), files);
});

test('links and archive members are not shareable from Recent', () => {
  assert.equal(shareable({ source: 'web' }), false);
  assert.equal(shareable({ source: 'archive' }), false);
  assert.equal(shareable({ source: 'local' }), true);
  assert.equal(shareable({ source: 'drive' }), true);
  assert.equal(shareable(null), false);
});
