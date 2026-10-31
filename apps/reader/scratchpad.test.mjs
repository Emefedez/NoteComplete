import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationMarkdown, keepEntry } from './scratchpad.js';

test('a kept conversation reads as questions in bold followed by answers', () => {
  assert.equal(conversationMarkdown([{ role: 'user', content: '¿Qué es\nla FAT?' }, { role: 'assistant', content: 'Una tabla.' }]), '**¿Qué es la FAT?**\n\nUna tabla.');
});

test('the same conversation rewrites its entry; another one is added on top', () => {
  let list = keepEntry([], { id: 'a', text: '1' });
  list = keepEntry(list, { id: 'b', text: '2' });
  list = keepEntry(list, { id: 'a', text: '1+' });
  assert.deepEqual(list.map(e => [e.id, e.text]), [['a', '1+'], ['b', '2']]);
});
