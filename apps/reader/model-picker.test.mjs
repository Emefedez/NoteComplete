import test from 'node:test';
import assert from 'node:assert/strict';
import { modelOptions } from './model-picker.js';

const list = [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }];

test('a refreshed list keeps the chosen model while it is offered', () => {
  assert.equal(modelOptions(list, 'sonnet').value, 'sonnet');
  assert.deepEqual(modelOptions(list, '').options.map(([, id]) => id), ['', 'opus', 'sonnet', '__other']);
});

test('a listed model that is gone falls back to the default; a typed name stays under Other', () => {
  assert.deepEqual(modelOptions([{ id: 'opus', label: 'Opus' }], 'sonnet'), { options: [['Tool default', ''], ['Opus', 'opus'], ['Other…', '__other']], value: '', other: '' });
  assert.deepEqual([modelOptions(list.slice(0, 1), 'my-model', true).value, modelOptions(list.slice(0, 1), 'my-model', true).other], ['__other', 'my-model']);
  // A name kept before the list was known is selected once the list offers it.
  assert.equal(modelOptions(list, 'opus', true).value, 'opus');
});
