import test from 'node:test';
import assert from 'node:assert/strict';
import { mathliveTemplate } from './math-field.js';

test('keypad templates become MathLive inserts: the cursor first, the other empty places after', () => {
  assert.equal(mathliveTemplate('\\frac{‸}{}'), '\\frac{#0}{#?}');
  assert.equal(mathliveTemplate('\\sqrt[‸]{}'), '\\sqrt[#0]{#?}');
  assert.equal(mathliveTemplate('\\log_{‸}()'), '\\log_{#0}(#?)');
  assert.equal(mathliveTemplate('\\pi '), '\\pi ');
  assert.equal(mathliveTemplate('^{2}‸'), '^{2}', 'nothing to fill after a square');
});
