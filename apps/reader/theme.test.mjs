import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTheme } from './theme.js';
test('a chosen theme wins over the system', () => {
  assert.equal(effectiveTheme('system', true), 'dark');
  assert.equal(effectiveTheme('system', false), 'light');
  assert.equal(effectiveTheme('light', true), 'light');
  assert.equal(effectiveTheme('dark', false), 'dark');
});
