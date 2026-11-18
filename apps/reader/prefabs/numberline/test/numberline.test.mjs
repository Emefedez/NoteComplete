import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, render } from '../render.js';

test('a number line is made whole and drawn with its ticks, points and interval ends', () => {
  assert.deepEqual(normalize({ min: 3, max: 3 }).max, 4, 'max above min');
  assert.ok(normalize({ min: 0, max: 10000, step: 1 }).step >= 50, 'at most 200 ticks');
  const { svg, width, height } = render({ min: -2, max: 2, step: 1, points: [{ x: 1, label: 'a<b' }], intervals: [{ from: -1, to: 1, closedFrom: true, closedTo: false }] });
  assert.ok(width === 600 && height > 100);
  assert.equal(svg.match(/<text [^>]*fill="#3b4250"/g).length, 5, 'ticks -2 … 2');
  assert.match(svg, />a&lt;b</, 'labels are escaped');
  assert.match(svg, /fill="#2563eb"/, 'a closed end is filled');
  assert.match(svg, /fill="#fff" stroke="#2563eb"/, 'an open end is hollow');
});
