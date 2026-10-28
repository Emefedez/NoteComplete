import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { libraryFiles, plainName } from './library-files.js';

test('only plain note names inside the chosen folder can be read or written', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nc-lib-'));
  const files = libraryFiles({ settingsFile: path.join(root, 'config/library.json'), defaultFolder: path.join(root, 'NoteComplete') });
  assert.equal(await files.read('Memoria 1.noteful'), null);
  await files.write('Memoria 1.noteful', new Uint8Array([170, 187, 204, 222]));
  assert.deepEqual([...await files.read('Memoria 1.noteful')], [170, 187, 204, 222]);
  assert.deepEqual(await readdir(path.join(root, 'NoteComplete')), ['Memoria 1.noteful'], 'no partial files left');
  for (const bad of ['../x.noteful', '/etc/passwd', 'a/b.noteful', '.hidden.noteful', 'notes.exe', '', 'x\u0000.pdf'])
    await assert.rejects(files.write(bad, new Uint8Array([1])), /Invalid file name/, bad);
  await assert.rejects(files.write('a.noteful', 'text'), /Expected file bytes/);
  const elsewhere = path.join(root, 'Apuntes');
  await files.setFolder(elsewhere);
  await files.write('Temas1+2.noteful', new Uint8Array([1]));
  assert.ok(await readFile(path.join(elsewhere, 'Temas1+2.noteful')));
  // The folder choice persists for the next launch.
  const again = libraryFiles({ settingsFile: path.join(root, 'config/library.json'), defaultFolder: '/nowhere' });
  assert.equal(await again.folder(), elsewhere);
});

test('Recent reopens only paths picked in the open dialog', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nc-recent-'));
  const note = path.join(root, 'picked.noteful');
  await writeFile(note, new Uint8Array([9]));
  const files = libraryFiles({ settingsFile: path.join(root, 'library.json'), defaultFolder: root });
  await assert.rejects(files.readRecent(note), /not opened from this device/);
  await files.remember(note);
  assert.deepEqual([...await files.readRecent(note)], [9]);
  await assert.rejects(files.readRecent('/etc/shadow'), /not opened/);
  assert.equal(plainName('Temas1+2.noteful'), 'Temas1+2.noteful');
});

test('a chosen folder lists its notes and opens them; other folders stay closed', async () => {
  const { mkdtemp, writeFile: put, mkdir: dir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'nc-folder-'));
  const folder = path.join(root, 'Tema 1');
  await dir(folder);
  for (const name of ['b.md', 'a 10.pdf', 'a 2.txt', '.hidden.md', 'script.sh', 'ciudades', 'tool.exe']) await put(path.join(folder, name), 'x');
  await put(path.join(folder, 'programa'), new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 0]));
  await dir(path.join(folder, 'sub.md'));
  await put(path.join(root, 'outside.md'), 'secret');
  const files = libraryFiles({ settingsFile: path.join(root, 'library.json'), defaultFolder: path.join(root, 'NoteComplete') });
  await assert.rejects(files.listFolder(folder), /not opened/);
  await files.rememberFolder(folder);
  assert.deepEqual((await files.listFolder(folder)).map(f => f.name), ['a 2.txt', 'a 10.pdf', 'b.md', 'ciudades', 'script.sh']);
  assert.equal(new TextDecoder().decode(await files.readRecent(path.join(folder, 'b.md'))), 'x');
  await assert.rejects(files.readRecent(path.join(root, 'outside.md')), /not opened/);
  await assert.rejects(files.readRecent(path.join(folder, '..', 'outside.md')), /not opened/);
  assert.equal(new TextDecoder().decode(await files.readRecent(path.join(folder, 'ciudades'))), 'x');
  await assert.rejects(files.readRecent(path.join(folder, 'tool.exe')), /not opened/);
});
