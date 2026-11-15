import test from 'node:test';
import assert from 'node:assert/strict';
import { batchNotePrompt } from './batch-notes.js';

test('batchNotePrompt builds focused handwriting-dialect prompts with language and custom instructions', () => {
  const p = batchNotePrompt({
    request: 'MESI cache coherence protocol states',
    title: 'Cache Coherence',
    dialect: 'HANDWRITING-DIALECT',
    look: 'study',
    language: 'Spanish',
    instructions: 'Include a state diagram using !draw and highlight pitfalls.',
  });
  assert.match(p, /Heading \/ note title: "Cache Coherence"/);
  assert.match(p, /strictly in Spanish/);
  assert.match(p, /Include a state diagram using !draw/);
  assert.match(p, /HANDWRITING-DIALECT/);
  assert.match(p, /MESI cache coherence protocol states/);
});
