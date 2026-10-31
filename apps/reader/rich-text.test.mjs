import test from 'node:test';
import assert from 'node:assert/strict';
import { plainText, texToText } from './rich-text.js';

test('AI answers become plain text for a text box', () => {
  const answer = '1. Root Directory (5 clusters): Empieza en 02 $\\rightarrow$ ocupa 02, 03.\n* Cadena en la FAT: 02$\\rightarrow$03(FF)\n**Total**: `0F` y $x^{2} \\le \\frac{a}{b}$';
  assert.equal(plainText(answer), '1. Root Directory (5 clusters): Empieza en 02 → ocupa 02, 03.\n• Cadena en la FAT: 02→03(FF)\nTotal: 0F y x^2 ≤ (a)/(b)');
  assert.equal(texToText('\\alpha + \\unknown'), 'α + unknown');
});
