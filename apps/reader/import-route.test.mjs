import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImport } from './import-route.js';

const file = (name, text) => ({ name, size: text.length, text: async () => text });
const quiz = '## 1. Q\n\n### Q1 · multichoice — ✅ verified\n\n**¿?**\n\n- A. a\n- B. ✅ **b**\n';

test('files are told apart by name and content', async () => {
  assert.equal(await classifyImport(file('x.ncstudy', '{}')), 'study-pack');
  assert.equal(await classifyImport(file('x.json', '{"format":"notecomplete-study"}')), 'study-pack');
  assert.equal(await classifyImport(file('d.json', '{"title":"d","cards":[{"front":"a","back":"b"}]}')), 'deck');
  assert.equal(await classifyImport(file('d.json', '[1,2')), 'document');
  assert.equal(await classifyImport(file('q.md', quiz)), 'quiz-markdown');
  assert.equal(await classifyImport(file('notes.md', '# Just notes\n\ntext')), 'document');
  assert.equal(await classifyImport(file('a.pdf', '')), 'document');
});
