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

test('folders made in NoteComplete keep documents, move them between folders, and never dissolve', async () => {
  const groups = groupStore({ store: memoryStore(), bridge: null });
  const so = await groups.create('SO'), aci = await groups.create('ACII');
  const tema = localMember('/u/Tema 1.md', 'Tema 1.md');
  await groups.move(tema, so);
  assert.equal((await groups.of(tema)).id, so.id);
  await groups.move(tema, aci);
  assert.equal((await groups.of(tema)).id, aci.id);
  assert.deepEqual((await groups.all()).find((g) => g.id === so.id).members, [], 'taken out of SO');
  await groups.remove(await groups.of(tema), tema.key);
  assert.equal((await groups.all()).length, 2, 'empty folders stay');
  await groups.rename(so, 'Sistemas Operativos');
  await groups.touch(so);
  assert.deepEqual((await groups.folders()).map((g) => g.name)[0], 'Sistemas Operativos');
  await groups.delete(aci);
  assert.deepEqual((await groups.all()).map((g) => g.name), ['Sistemas Operativos']);
});

test('starred documents come first in their folder and follow a rename', async () => {
  const { starredFirst } = await import('./groups.js');
  const members = ['a', 'b', 'c', 'd'].map((n) => localMember(`/f/${n}.md`, `${n}.md`));
  assert.deepEqual(starredFirst(members, ['local:/f/d.md', 'local:/f/b.md']).map((m) => [m.name, !!m.starred]), [['b.md', true], ['d.md', true], ['a.md', false], ['c.md', false]]);
  const groups = groupStore({ store: memoryStore(), bridge: null });
  const g = await groups.create('Tema 1');
  await groups.move(members[0], g); await groups.move(members[1], g);
  await groups.star(g, 'local:/f/b.md', true);
  assert.deepEqual((await groups.members((await groups.folders())[0])).map((m) => m.name), ['b.md', 'a.md']);
  await groups.renamed('local:/f/b.md', localMember('/f/B 2.md', 'B 2.md'));
  const fresh = (await groups.folders())[0];
  assert.deepEqual((await groups.members(fresh)).map((m) => [m.name, !!m.starred]), [['B 2.md', true], ['a.md', false]]);
  await groups.star(fresh, 'local:/f/B 2.md', false);
  assert.deepEqual((await groups.members((await groups.folders())[0])).map((m) => m.name), ['a.md', 'B 2.md']);
});
