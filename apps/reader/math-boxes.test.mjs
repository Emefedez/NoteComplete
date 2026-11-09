import test from 'node:test';
import assert from 'node:assert/strict';
import { mathSegments } from './math-boxes.js';

test('text with no $ is one display formula', () => {
  assert.deepEqual(mathSegments('\\frac{a}{b} = c'), [{ tex: '\\frac{a}{b} = c', display: true }]);
  assert.deepEqual(mathSegments('   '), []);
});

test('$…$ inline and $$…$$ display parts among words', () => {
  assert.deepEqual(mathSegments('Area: $\\pi r^2$ and $$E = mc^2$$ done'), [
    { text: 'Area: ' }, { tex: '\\pi r^2', display: false }, { text: ' and ' }, { tex: 'E = mc^2', display: true }, { text: ' done' },
  ]);
});

test('an escaped dollar is a dollar sign, not math', () => {
  assert.deepEqual(mathSegments('Costs \\$5, and $x$'), [{ text: 'Costs $5, and ' }, { tex: 'x', display: false }]);
});
