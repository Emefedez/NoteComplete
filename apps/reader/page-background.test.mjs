import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPageBackgroundChanges,
  fitPdfRect,
  formatBytes,
  parsePageSelection,
  shouldSuggestCompact,
  usedPdfPageIndices,
} from './page-background.js';

test('parsePageSelection parses singles, ranges, and detects invalid input', () => {
  assert.deepEqual(parsePageSelection('1, 3-5, 4', 8), { indices: [0, 2, 3, 4] });
  assert.deepEqual(parsePageSelection('2', 8), { indices: [1] });
  assert.ok(parsePageSelection('0', 8).error);
  assert.ok(parsePageSelection('5-3', 8).error);
  assert.ok(parsePageSelection('3-10', 8).error);
  assert.ok(parsePageSelection('abc', 8).error);
  assert.ok(parsePageSelection(' ', 8).error);
});

test('fitPdfRect centers PDF proportionally inside the current page', () => {
  const rect = fitPdfRect([800, 400], [1000, 1000]);
  assert.deepEqual(rect, [0, 250, 1000, 500]);
});

test('buildPageBackgroundChanges supports sequence, repeat, compact remap, and none', () => {
  const changes = buildPageBackgroundChanges({
    noteIndices: [1, 2],
    currentSizes: [
      [1000, 1400],
      [1000, 1400],
      [1000, 1400],
    ],
    source: { kind: 'pdf', resourceId: 'pdf-1' },
    pdfSizesPt: [
      [600, 800],
      [600, 800],
      [800, 400],
      [600, 600],
    ],
    startPdfPage: 1,
    mode: 'sequence',
    sizeMode: 'fit',
    remapIndices: new Map([
      [1, 0],
      [2, 1],
    ]),
  });
  assert.equal(changes.length, 2);
  assert.equal(changes[0].page, 1);
  assert.equal(changes[0].pdf.page_index, 0);
  assert.deepEqual(changes[0].size, [1000, 1400]);
  assert.equal(changes[1].page, 2);
  assert.equal(changes[1].pdf.page_index, 1);
  assert.deepEqual(changes[1].pdf.rect, [0, 450, 1000, 500]);

  const widthChanges = buildPageBackgroundChanges({
    noteIndices: [0],
    currentSizes: [[1000, 1400]],
    source: { kind: 'pdf', resourceId: 'pdf-1' },
    pdfSizesPt: [[800, 400]],
    sizeMode: 'width',
  });
  assert.deepEqual(widthChanges[0].size, [1000, 500]);
  assert.deepEqual(widthChanges[0].pdf.rect, [0, 0, 1000, 500]);

  const cleared = buildPageBackgroundChanges({
    noteIndices: [0],
    currentSizes: [[1000, 1400]],
    source: { kind: 'none' },
  });
  assert.deepEqual(cleared, [{ page: 0, size: [1000, 1400], pdf: null }]);
});

test('usedPdfPageIndices and shouldSuggestCompact flag partial large PDFs', () => {
  assert.deepEqual(usedPdfPageIndices({ noteCount: 2, pdfPageCount: 20, startPdfPage: 4, mode: 'sequence' }), [4, 5]);
  assert.deepEqual(usedPdfPageIndices({ noteCount: 5, pdfPageCount: 20, startPdfPage: 4, mode: 'repeat' }), [4]);
  assert.equal(shouldSuggestCompact(2 * 1024 * 1024, 20, 2), true);
  assert.equal(shouldSuggestCompact(500 * 1024, 20, 2), false);
  assert.equal(shouldSuggestCompact(5 * 1024 * 1024, 2, 2), false);
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2.5 * 1024 * 1024), '2.5 MB');
});
