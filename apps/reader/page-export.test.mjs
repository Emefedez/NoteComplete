import test from 'node:test';
import assert from 'node:assert/strict';
import { packPages, IMAGE_TYPES } from './page-export.js';

test('pages are packed one after another with the layout the core reads', () => {
  const a = Uint8Array.of(0xff, 0xd8, 1), b = Uint8Array.of(0xff, 0xd8, 2, 3);
  const { data, layout } = packPages([
    { bytes: a, widthPx: 1800, heightPx: 2546, widthPt: 595, heightPt: 842 },
    { bytes: b, widthPx: 1800, heightPx: 1273, widthPt: 842, heightPt: 595 },
  ]);
  assert.deepEqual([...data], [0xff, 0xd8, 1, 0xff, 0xd8, 2, 3]);
  assert.deepEqual(JSON.parse(layout), [
    { offset: 0, length: 3, widthPx: 1800, heightPx: 2546, widthPt: 595, heightPt: 842 },
    { offset: 3, length: 4, widthPx: 1800, heightPx: 1273, widthPt: 842, heightPt: 595 },
  ]);
});

test('image formats: compressed ones first, PNG for lossless', () => {
  assert.deepEqual(IMAGE_TYPES.map(t => t.id), ['jpeg', 'webp', 'png']);
  assert.ok(IMAGE_TYPES.every(t => t.mime.startsWith('image/') && t.ext));
});
