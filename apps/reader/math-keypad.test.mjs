import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplate, nextSlot, KEY_TABS } from './math-keypad.js';

test('a key puts its LaTeX at the cursor, with the cursor where the next thing goes', () => {
  assert.deepEqual(applyTemplate('y = ', 4, 4, '\\frac{‸}{}'), { value: 'y = \\frac{}{}', cursor: 10 });
  assert.deepEqual(applyTemplate('ab', 1, 1, '+'), { value: 'a+b', cursor: 2 });
});

test('a selection goes inside the template', () => {
  assert.deepEqual(applyTemplate('x+1', 0, 3, '\\sqrt{‸}'), { value: '\\sqrt{x+1}', cursor: 9 });
});

test('Tab moves to the next empty place, Shift Tab to the one before', () => {
  const v = '\\frac{a}{}+\\sqrt[]{}';
  assert.equal(nextSlot(v, 7), 9);
  assert.equal(nextSlot(v, 9), 17);
  assert.equal(nextSlot(v, 17), 19);
  assert.equal(nextSlot(v, 19), v.length);
  assert.equal(nextSlot(v, 17, true), 9);
});

test('every key template has at most one cursor mark, and every tab a title', () => {
  for (const [name, keys, title] of KEY_TABS) {
    assert.ok(title, name);
    for (const [label, template = label] of keys) assert.ok((template.match(/‸/g) || []).length <= 1, template);
  }
});
