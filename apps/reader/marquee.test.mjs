import test from 'node:test';
import assert from 'node:assert/strict';
import { slideDistance, slideSeconds } from './marquee.js';

test('only an overflowing name slides, at a steady speed', () => {
  assert.equal(slideDistance(100, 120), 0);
  assert.equal(slideDistance(300.4, 120), 181);
  assert.equal(slideSeconds(10), 0.6);
  assert.equal(slideSeconds(140), 2);
});
