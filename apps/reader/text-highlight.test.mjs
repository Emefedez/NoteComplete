import test from 'node:test';
import assert from 'node:assert/strict';
import { textLines } from './text-layer.js';
import { readingOrder, nearestWord, bandsFor, bandLine } from './text-highlight.js';

// Two lines of a PDF page: "El modelo OSI" and "tiene siete capas".
const word = (text, x, y, w = 40, h = 12) => ({ text, box: [x, y, w, h] });
const page = [word('El', 20, 100, 16), word('modelo', 44, 100, 50), word('OSI', 102, 100, 30), word('tiene', 20, 120, 40), word('siete', 68, 120, 40), word('capas', 116, 120, 44)];
const words = readingOrder(textLines({ pdf: page }));

test('words come in reading order, each with its line', () => {
  assert.deepEqual(words.map((w) => w.text), ['El', 'modelo', 'OSI', 'tiene', 'siete', 'capas']);
  assert.deepEqual(words.map((w) => w.line), [0, 0, 0, 1, 1, 1]);
});

test('the nearest word is the one under the point, else the closest on the line it is on', () => {
  assert.equal(words[nearestWord(words, [60, 105])].text, 'modelo');
  assert.equal(words[nearestWord(words, [150, 106])].text, 'OSI', 'past the end of the line');
  assert.equal(words[nearestWord(words, [5, 126])].text, 'tiene', 'before the start of a line');
  assert.equal(words[nearestWord(words, [90, 140])].text, 'siete', 'below the last line');
  assert.equal(words[nearestWord(words, [60, 114])].text, 'modelo', 'between lines, the line it is closer to');
  assert.equal(nearestWord([], [1, 1]), -1);
});

test('a selection is one band per line, from the first word to the last, in either direction', () => {
  const across = bandsFor(words, 1, 4);   // modelo OSI / tiene siete
  assert.equal(across.length, 2);
  assert.deepEqual(across[0], { line: 0, x0: 44, x1: 132, y0: 100, y1: 112 });
  assert.deepEqual(across[1], { line: 1, x0: 20, x1: 108, y0: 120, y1: 132 });
  assert.deepEqual(bandsFor(words, 4, 1), across, 'dragging backwards selects the same words');
  assert.deepEqual(bandsFor(words, 2, 2), [{ line: 0, x0: 102, x1: 132, y0: 100, y1: 112 }], 'one word');
  assert.deepEqual(bandsFor(words, -1, 3), []);
  assert.deepEqual(bandsFor([], 0, 0), []);
});

test('a band becomes the highlighter\'s own square line, the later ones joined to the first', () => {
  const [a, b] = bandsFor(words, 1, 4);
  const first = bandLine(a, [1, 0.9, 0.2, 0.5]), second = bandLine(b, [1, 0.9, 0.2, 0.5], 0, true);
  assert.equal(first.tool, 1);
  assert.equal(first.square, true);
  assert.equal(first.joined, undefined);
  assert.equal(second.joined, true);
  assert.deepEqual(first.rgba, [1, 0.9, 0.2, 1]);
  // Along the middle of the text, as wide as the text is tall (a little over).
  assert.ok(first.points[0][0] < 44 && first.points[1][0] > 132);
  assert.equal(first.points[0][1], 106);
  assert.ok(first.width >= 12 && first.width < 14);
});

test('how far a point is from a word', async () => {
  const { distanceTo } = await import('./text-highlight.js');
  const w = { x: 20, y: 100, w: 40, h: 12 };
  assert.equal(distanceTo(w, [30, 105]), 0);
  assert.equal(distanceTo(w, [10, 105]), 10);
  assert.equal(distanceTo(w, [30, 120]), 8);
  assert.equal(Math.round(distanceTo(w, [70, 120])), 13);
});
