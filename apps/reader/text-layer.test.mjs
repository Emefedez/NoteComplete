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

test('links written in handwriting become link targets; only web links and app actions', async () => {
  const { linkAllowed } = await import('./text-layer.js');
  assert.equal(linkAllowed('https://github.com/x'), true);
  assert.equal(linkAllowed('notecomplete:install'), true);
  assert.equal(linkAllowed('javascript:alert(1)'), false);
  assert.equal(linkAllowed('https://a b'), false);
  assert.equal(linkAllowed(undefined), false);
  const lines = textLines({ ocr: [{ text: 'GitHub', box: [10, 10, 50, 20], link: 'https://github.com/x' }] });
  assert.equal(lines[0].words[0].link, 'https://github.com/x');
});
