import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationMarkdown, keepEntry, parseConversation } from './scratchpad.js';

test('a kept conversation reads as questions in bold followed by answers', () => {
  assert.equal(conversationMarkdown([{ role: 'user', content: '¿Qué es\nla FAT?' }, { role: 'assistant', content: 'Una tabla.' }]), '**¿Qué es la FAT?**\n\nUna tabla.');
});

test('the same conversation rewrites its entry; another one is added on top', () => {
  let list = keepEntry([], { id: 'a', text: '1' });
  list = keepEntry(list, { id: 'b', text: '2' });
  list = keepEntry(list, { id: 'a', text: '1+' });
  assert.deepEqual(list.map(e => [e.id, e.text]), [['a', '1+'], ['b', '2']]);
});

test('an older entry (Markdown only) is split back into questions and answers', () => {
  const md = conversationMarkdown([{ role: 'user', content: 'P1' }, { role: 'assistant', content: 'R1\n\nmás R1' }, { role: 'user', content: 'P2' }, { role: 'assistant', content: 'R2' }]);
  assert.deepEqual(parseConversation(md), [
    { role: 'user', content: 'P1' }, { role: 'assistant', content: 'R1\n\nmás R1' },
    { role: 'user', content: 'P2' }, { role: 'assistant', content: 'R2' }]);
});
