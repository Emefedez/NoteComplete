import test from 'node:test';
import assert from 'node:assert/strict';
import { insertText } from './dictate.js';

test('dictated words go in at the cursor with single spaces', () => {
  assert.deepEqual(insertText('', 0, 0, ' hola '), { value: 'hola', caret: 4 });
  assert.deepEqual(insertText('Explica', 7, 7, 'la FAT'), { value: 'Explica la FAT', caret: 14 });
  assert.deepEqual(insertText('¿Qué es ?', 8, 8, 'un clúster'), { value: '¿Qué es un clúster ?', caret: 18 });
  assert.deepEqual(insertText('abc', 1, 2, ''), { value: 'abc', caret: 2 });
});
