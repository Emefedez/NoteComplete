import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { applyTextDiff, packSnapshot, unpackSnapshot, parseInvite } from './sync.js';
import { toIndex, toRowCol, moveIndex } from './notes.js';

function pair(text) {
  const a = new Y.Doc(), b = new Y.Doc();
  a.getText('t').insert(0, text);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}
const exchange = (a, b) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

test('an editor change becomes the smallest Y.Text edit, so others’ edits survive', () => {
  const [a, b] = pair('# Tema 2\n\nuno\ndos\n');
  // Each side replaces its whole text from the editor, changing one line each.
  applyTextDiff(a.getText('t'), '# Tema 2\n\nUNO\ndos\n');
  applyTextDiff(b.getText('t'), '# Tema 2\n\nuno\ndos\ntres\n');
  exchange(a, b);
  assert.equal(a.getText('t').toString(), '# Tema 2\n\nUNO\ndos\ntres\n');
  assert.equal(b.getText('t').toString(), a.getText('t').toString());
  // No change, no update.
  let updates = 0;
  a.on('update', () => updates++);
  applyTextDiff(a.getText('t'), a.getText('t').toString());
  assert.equal(updates, 0);
});

test('emoji are never split between the deleted and inserted parts', () => {
  const [a, b] = pair('a😀b');
  applyTextDiff(a.getText('t'), 'a😃b');
  exchange(a, b);
  assert.equal(b.getText('t').toString(), 'a😃b');
  applyTextDiff(a.getText('t'), 'a😃😀b');
  exchange(a, b);
  assert.equal(b.getText('t').toString(), 'a😃😀b');
});

test('the caret stays on the same text when others edit before or after it', () => {
  const text = 'line one\nline two\n';
  const caret = { row: 1, col: 5 };
  const index = toIndex(text, caret);
  assert.equal(text.slice(index), 'two\n');
  assert.deepEqual(toRowCol(text, index), caret);
  const [a, b] = pair(text);
  let delta = null;
  b.getText('t').observe((event) => { delta = event.delta; });
  // Someone inserts at the start and deletes after the caret.
  a.getText('t').insert(0, 'NEW ');
  a.getText('t').delete(4 + 14, 3);
  exchange(a, b);
  const moved = moveIndex(index, delta);
  assert.equal(b.getText('t').toString().slice(moved), '\n');
  assert.equal(b.getText('t').toString().slice(moved - 5, moved), 'line ');
  // A deletion around the caret puts it where the text was removed.
  assert.equal(moveIndex(10, [{ retain: 8 }, { delete: 5 }]), 8);
  assert.equal(moveIndex(3, [{ retain: 8 }, { insert: 'xx' }]), 3);
});

test('snapshots carry their header and the project unchanged', () => {
  const project = JSON.stringify({ format: 'noteful-re-project', history: ['ñ', '😀'] });
  const { header, payload } = unpackSnapshot(packSnapshot({ gen: 3, seq: 41, title: 'Tema 2' }, project));
  assert.deepEqual(header, { gen: 3, seq: 41, title: 'Tema 2' });
  assert.equal(new TextDecoder().decode(payload), project);
});

test('a tablet link keeps its token in the fragment only', () => {
  const invite = parseInvite('http://192.168.1.20:41237/tablet#0a1b2c3d.abcDEF_-123');
  assert.equal(invite.token, 'abcDEF_-123');
  assert.equal(invite.url, 'ws://192.168.1.20:41237/sync');
});

test('an address and a code join as a tablet, or as a guest when asked', () => {
  assert.deepEqual(parseInvite('192.168.1.20:41237', '123 456'), { url: 'ws://192.168.1.20:41237/sync', code: '123456', role: 'tablet' });
  assert.deepEqual(parseInvite('192.168.1.20:41237', '123 456', 'guest'), { url: 'ws://192.168.1.20:41237/sync', code: '123456', role: 'guest' });
  assert.throws(() => parseInvite('192.168.1.20:41237', '12', 'guest'), /6-digit/);
  // A link still decides by its path.
  assert.equal(parseInvite('http://192.168.1.20:41237/join#abc.def', '', 'tablet').role, 'guest');
});

test('an invite link or an address and a code can be used to send study material', () => {
  assert.equal(parseInvite('http://192.168.1.20:41237/join#abc.def', '', 'sender').role, 'sender');
  assert.equal(parseInvite('192.168.1.20:41237', '123456', 'sender').role, 'sender');
  // A drawing tablet link stays a tablet's.
  assert.equal(parseInvite('http://192.168.1.20:41237/tablet#abc.def', '', 'sender').role, 'tablet');
});
