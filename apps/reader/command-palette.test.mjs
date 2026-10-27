import test from 'node:test';
import assert from 'node:assert/strict';
import { score, rank } from './command-palette.js';

const commands = [
  { id: 'open', title: 'Open file…', group: 'File' },
  { id: 'native', title: 'Export .noteful', group: 'Export' },
  { id: 'svg', title: 'Export page SVG', group: 'Export' },
  { id: 'anki', title: 'Export Anki deck…', group: 'Study', keywords: 'flashcards' },
  { id: 'save', title: 'Save project', group: 'File', enabled: () => false },
];

test('fuzzy matching prefers word starts and contiguous runs', () => {
  assert.equal(score('xyz', 'Export page SVG'), null);
  assert.ok(score('svg', 'Export page SVG') > score('svg', 'Save a very good thing'));
  assert.ok(score('exp', 'Export .noteful') > score('exp', 'Open the explorer'));
  assert.equal(score('', 'anything'), 0);
});

test('ranking hides disabled commands and searches keywords', () => {
  assert.deepEqual(rank(commands, '').map(c => c.id), ['open', 'native', 'svg', 'anki']);
  assert.deepEqual(rank(commands, 'flash').map(c => c.id), ['anki']);
  assert.equal(rank(commands, 'export svg')[0].id, 'svg');
  assert.ok(!rank(commands, 'save').some(c => c.id === 'save'));
});
