import test from 'node:test';
import assert from 'node:assert/strict';
import { textLines } from './text-layer.js';

const word = (text, x, y, w = 40, h = 12) => ({ text, box: [x, y, w, h] });

test('words become lines in reading order', () => {
  const lines = textLines({ ocr: [word('world', 60, 101), word('second', 10, 130), word('hello', 10, 100), word('line', 70, 129)] });
  assert.deepEqual(lines.map(l => l.words.map(w => w.text).join(' ')), ['hello world', 'second line']);
});

test('PDF text wins over an OCR reading of the same spot', () => {
  const lines = textLines({ pdf: [word('Sector', 10, 100)], ocr: [word('Sectov', 11, 100), word('ink', 200, 100)] });
  assert.deepEqual(lines[0].words.map(w => w.text), ['Sector', 'ink']);
});

test('side-by-side columns at one height stay separate words, bad boxes are skipped', () => {
  const lines = textLines({ ocr: [word('a', 10, 100), word('b', 20, 100), { text: 'x', box: [0, 0, 0, 5] }, { text: '', box: [1, 1, 1, 1] }] });
  assert.equal(lines.length, 2);
});
