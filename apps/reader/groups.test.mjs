import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStore, mergeMembers, localMember } from './groups.js';
import { memoryStore } from './library.js';

test('folder groups list the folder first, then added documents, once each', () => {
  const listed = [{ path: '/u/so/a.md', name: 'a.md' }, { path: '/u/so/b.pdf', name: 'b.pdf' }];
  const merged = mergeMembers(listed, [localMember('/u/so/a.md', 'a.md'), localMember('/x/c.txt', 'c.txt')]);
  assert.deepEqual(merged.map((m) => [m.name, Boolean(m.inFolder)]), [['a.md', true], ['b.pdf', true], ['c.txt', false]]);
});

test('adding documents starts a group with the open one; removing down to one dissolves it', async () => {
  const groups = groupStore({ store: memoryStore(), bridge: null });
  const note = { key: 'drive:abc', name: 'Memoria 1.noteful', source: 'drive' };
  assert.equal(await groups.of(note), null);
  const g = await groups.add(note, [localMember('/d/Tema 1.md', 'Tema 1.md'), localMember('/d/test.html', 'test.html')], 'Memoria 1');
  assert.equal(g.name, 'Memoria 1');
  assert.deepEqual(g.members.map((m) => m.key), ['drive:abc', 'local:/d/Tema 1.md', 'local:/d/test.html']);
  assert.equal((await groups.of(localMember('/d/test.html', 'test.html'))).id, g.id);
  await groups.add(localMember('/d/test.html', 'test.html'), [localMember('/d/Tema 1.md', 'Tema 1.md')], 'x');
  assert.equal((await groups.all()).length, 1, 'no duplicate group or member');
  await groups.remove(g, 'local:/d/test.html');
  assert.equal((await groups.of(note)).members.length, 2);
  await groups.remove(g, 'local:/d/Tema 1.md');
  assert.equal(await groups.of(note), null);
});

test('a file in an opened folder belongs to that folder group', async () => {
  const bridge = { listFolder: async () => [{ path: '/u/so/a.md', name: 'a.md' }] };
  const groups = groupStore({ store: memoryStore(), bridge });
  const g = await groups.openFolder({ folder: '/u/so', name: 'so' });
  assert.equal((await groups.of(localMember('/u/so/z.txt', 'z.txt'))).id, g.id);
  assert.equal(await groups.of(localMember('/u/other/z.txt', 'z.txt')), null);
  assert.deepEqual((await groups.members(g)).map((m) => m.name), ['a.md']);
});
