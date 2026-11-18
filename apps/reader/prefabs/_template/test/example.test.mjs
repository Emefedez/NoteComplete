import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, render, name } from '../render.js';

test('the template module makes its spec whole and draws it', () => {
  assert.deepEqual(normalize({}), { type: 'example', title: '', lines: [] });
  assert.equal(normalize({ lines: [{ text: 3 }] }).lines[0].text, '3');
  const { svg, width, height } = render({ title: 'T', lines: [{ text: 'a<b' }, { text: 'c' }] });
  assert.ok(svg.startsWith('<svg') && width === 420 && height > 60);
  assert.match(svg, /a&lt;b/, 'text is escaped');
  assert.equal(name({}), 'Example list');
});
