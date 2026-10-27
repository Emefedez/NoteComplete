import test from 'node:test';
import assert from 'node:assert/strict';
import { blankSize, pdfPages, insertAt, mmToUnits, unitsToMm } from './insert-pages.js';

const close = (a, b) => Math.abs(a - b) < 0.01;

test('A4 in Noteful page units matches the corpus size', () => {
  const [w, h] = blankSize('a4', [1, 1]);
  assert.ok(close(w, 1091.34) && close(h, 1543.46), `${w}×${h}`);
  assert.deepEqual(blankSize('current', [2242.6, 990]), [2242.6, 990]);
  assert.ok(close(unitsToMm(mmToUnits(123.4)), 123.4));
  assert.ok(close(blankSize('custom', [0, 0], [100, 50])[0], mmToUnits(100)));
});

test('PDF pages keep their scale and widen like Temas1+2 when space is added', () => {
  // 720×540 pt slides, extra space to the right: 1320×990 PDF on a 2640-wide page.
  const pages = pdfPages('slides', [[720, 540], [720, 540], [595, 842]], 0, 1, 'right100');
  assert.equal(pages.length, 2);
  assert.ok(close(pages[0].size[0], 2640) && close(pages[0].size[1], 990));
  assert.deepEqual(pages[1].pdf.rect.map(Math.round), [0, 0, 1320, 990]);
  assert.equal(pages[1].pdf.page_index, 1);
  const plain = pdfPages('slides', [[720, 540]], 0, 0, 'none');
  assert.equal(plain[0].pdf.rect, undefined, 'no rect: the PDF fills the page');
});

test('insert positions are display indices', () => {
  assert.equal(insertAt('after', 2, 5), 3);
  assert.equal(insertAt('before', 2, 5), 2);
  assert.equal(insertAt('end', 2, 5), 5);
});
