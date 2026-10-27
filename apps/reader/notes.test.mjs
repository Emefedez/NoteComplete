import test from 'node:test';
import assert from 'node:assert/strict';
import { markerLine } from './notes.js';

test('Follow finds the line of a page marker', () => {
  const text = '# Notas\n<!-- page 2 -->\nuno\n  <!--page 10-->  \ndos';
  assert.equal(markerLine(text, 2), 1);
  assert.equal(markerLine(text, 10), 3);
  assert.equal(markerLine(text, 3), null);
});
