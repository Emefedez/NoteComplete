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

test('PDF text keeps the file’s order: two columns read one after the other', () => {
  // Left column "a b" / "c d", right column "x y" / "z", written column by column.
  const pdf = [word('a', 10, 100), word('b', 60, 100), word('c', 10, 120), word('d', 60, 120), word('x', 300, 100), word('y', 350, 100), word('z', 300, 120)];
  assert.deepEqual(textLines({ pdf }).map(l => l.words.map(w => w.text).join(' ')), ['a b', 'c d', 'x y', 'z']);
});

test('text drawn twice at one spot (a fake bold) is there once', () => {
  const pdf = [word('Bold', 10, 100), word('Bold', 10.4, 100.3), word('text', 60, 100), word('text', 60.4, 100.3), word('next', 10, 120)];
  assert.deepEqual(textLines({ pdf }).map(l => l.words.map(w => w.text).join(' ')), ['Bold text', 'next']);
});

test('a PDF written in no order is read by place', () => {
  const pdf = [word('four', 160, 100), word('three', 110, 100), word('two', 60, 100), word('one', 10, 100), word('six', 60, 120), word('five', 10, 120)];
  assert.deepEqual(textLines({ pdf }).map(l => l.words.map(w => w.text).join(' ')), ['one two three four', 'five six']);
});

test('pieces of one word that touch take no space between them', async () => {
  const { spaced } = await import('./text-layer.js');
  const at = (text, x, w) => ({ text, x, w, h: 12 });
  assert.equal(spaced(at('certi', 10, 25), at('fi', 35.2, 8)), false, 'a ligature split');
  assert.equal(spaced(at('cursos', 10, 30), at(',', 40, 3)), false);
  assert.equal(spaced(at('A', 10, 8), at('R', 20.5, 8)), false, 'a spaced-out title');
  assert.equal(spaced(at('word', 10, 30), at('next', 43.5, 30)), true, 'a word space');
});

test('a spaced-out title read by glyph copies as its words', async () => {
  const { spaced } = await import('./text-layer.js');
  // pdf-background.js textWords joins the letters ("ARQUITECTURA", "DE"); the PDF's space before
  // "DE" keeps the space even where the gap is narrow, and none comes inside a joined word.
  const lines = textLines({ pdf: [
    { text: 'AC', box: [46, 32, 8, 5], space: false },
    { text: 'ARQUITECTURA', box: [64, 30, 76, 8], space: true },
    { text: 'DE', box: [144, 30, 12, 8], space: true },
    { text: 'II', box: [246, 30, 6, 8], space: true },
  ] });
  const [line] = lines;
  assert.equal(line.words.map((w, i) => w.text + (line.words[i + 1] && spaced(w, line.words[i + 1]) ? ' ' : '')).join(''), 'AC ARQUITECTURA DE II');
});
