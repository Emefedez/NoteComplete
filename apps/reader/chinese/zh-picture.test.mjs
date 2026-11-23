// The pure part of reading Chinese in a picture (zh-picture.js): the character at the pointer
// among Tesseract's symbols, and the snapshot's size.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { hanAt, snapshotSize, MIN_CONFIDENCE } from './zh-picture.js';

const sym = (text, x0, confidence = 90) => ({ text, confidence, bbox: { x0, y0: 10, x1: x0 + 30, y1: 40 } });
// Tesseract's blocks for one line read as "你 好 , 世界" (spaces between words, a comma).
const data = (symbols) => ({ blocks: [{ paragraphs: [{ lines: [{ words: symbols.map((s) => ({ symbols: [s] })) }] }] }] });
const LINE = data([sym('你', 0), sym('好', 32), sym('，', 64), sym('世', 96), sym('界', 128)]);

test('the character under the pointer, in its line of Chinese', () => {
  assert.deepEqual(hanAt(LINE, [40, 20]), { text: '你好世界', index: 1 });
  assert.deepEqual(hanAt(LINE, [130, 25]), { text: '你好世界', index: 3 });
});
test('near a character (within half its height) still counts; farther does not', () => {
  assert.deepEqual(hanAt(LINE, [10, 50]), { text: '你好世界', index: 0 });
  assert.equal(hanAt(LINE, [10, 80]), null);
});
test('a doubtful read is not offered, nor Latin text', () => {
  assert.equal(hanAt(data([sym('你', 0, MIN_CONFIDENCE - 1)]), [10, 20]), null);
  assert.equal(hanAt(data([sym('A', 0)]), [10, 20]), null);
  assert.equal(hanAt({}, [0, 0]), null);
});
test('the snapshot is a strip a few characters wide, sized to the page within bounds', () => {
  assert.deepEqual(snapshotSize(1000), { width: 300, height: 100 });
  assert.equal(snapshotSize(100).height, 96);
  assert.equal(snapshotSize(10000).height, 260);
});
