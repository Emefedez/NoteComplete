import test from 'node:test';
import assert from 'node:assert/strict';
import { modelOptions, filterModels } from './model-picker.js';

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

test('searching a long model list needs every word, in any order and case', () => {
  const many = [{ id: 'anthropic/claude-opus-5', label: 'Claude Opus 5' }, { id: 'openai/gpt-5', label: 'GPT 5' }, { id: 'google/gemini-3', label: 'Gemini 3' }];
  assert.deepEqual(filterModels(many, 'opus claude').map(m => m.id), ['anthropic/claude-opus-5']);
  assert.deepEqual(filterModels(many, 'OPENAI').map(m => m.id), ['openai/gpt-5']);
  assert.equal(filterModels(many, '  ').length, 3);
  assert.equal(filterModels(many, 'llama').length, 0);
});
