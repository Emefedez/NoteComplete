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

test('an edited text file is saved only over a file that was opened, keeping its mode', async () => {
  const { mkdtemp, writeFile: put, mkdir: dir, stat: info, chmod: mode, readFile: get, readdir: list } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'nc-save-'));
  const folder = path.join(root, 'examen-1');
  await dir(folder);
  await put(path.join(folder, 'ciudades'), 'old');
  await mode(path.join(folder, 'ciudades'), 0o640);
  await put(path.join(root, 'other.md'), 'keep');
  const files = libraryFiles({ settingsFile: path.join(root, 'library.json'), defaultFolder: path.join(root, 'NoteComplete') });
  await assert.rejects(files.writeOpened(path.join(folder, 'ciudades'), new Uint8Array([1])), /not opened/);
  await files.rememberFolder(folder);
  await files.writeOpened(path.join(folder, 'ciudades'), new TextEncoder().encode('Madrid\n'));
  assert.equal(await get(path.join(folder, 'ciudades'), 'utf8'), 'Madrid\n');
  assert.equal((await info(path.join(folder, 'ciudades'))).mode & 0o777, 0o640);
  assert.deepEqual(await list(folder), ['ciudades'], 'no partial file left');
  await assert.rejects(files.writeOpened(path.join(root, 'other.md'), new Uint8Array([1])), /not opened/);
  assert.equal(await get(path.join(root, 'other.md'), 'utf8'), 'keep');
});

test('an opened file can be renamed in its folder, never over another file or out of it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nc-rename-'));
  const folder = path.join(root, 'Tema 1'), other = path.join(root, 'picked.md');
  const { mkdir: dir } = await import('node:fs/promises');
  await dir(folder);
  for (const name of ['a.md', 'b.md']) await writeFile(path.join(folder, name), name);
  await writeFile(other, 'p');
  const files = libraryFiles({ settingsFile: path.join(root, 'library.json'), defaultFolder: root });
  await assert.rejects(files.renameOpened(path.join(folder, 'a.md'), 'c.md'), /not opened/);
  await files.rememberFolder(folder);
  assert.equal(await files.renameOpened(path.join(folder, 'a.md'), 'Apuntes 1.md'), path.join(folder, 'Apuntes 1.md'));
  assert.deepEqual((await readdir(folder)).sort(), ['Apuntes 1.md', 'b.md']);
  await assert.rejects(files.renameOpened(path.join(folder, 'b.md'), 'Apuntes 1.md'), /already exists/);
  assert.equal(await readFile(path.join(folder, 'Apuntes 1.md'), 'utf8'), 'a.md', 'the other file is untouched');
  for (const bad of ['../x.md', 'sub/x.md', '.x.md', 'x.exe', ''])
    await assert.rejects(files.renameOpened(path.join(folder, 'b.md'), bad), /Invalid file name/, bad);
  // A file picked in the open dialog: Recent follows the new name.
  await files.remember(other);
  const moved = await files.renameOpened(other, 'renamed.md');
  assert.equal(new TextDecoder().decode(await files.readRecent(moved)), 'p');
  await assert.rejects(files.readRecent(other), /not opened/);
});

test('only an opened file can be moved to the trash, and Recent forgets it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nc-trash-'));
  const file = path.join(root, 'a.md'), trashed = [];
  await writeFile(file, 'a');
  const files = libraryFiles({ settingsFile: path.join(root, 'library.json'), defaultFolder: root, trash: async (p) => { trashed.push(p); } });
  await assert.rejects(files.trashOpened(file), /not opened/);
  await assert.rejects(files.trashOpened('/etc/hosts'), /not opened/);
  assert.deepEqual(trashed, []);
  await files.remember(file);
  await files.trashOpened(file);
  assert.deepEqual(trashed, [file]);
  await assert.rejects(files.readRecent(file), /not opened/);
});

test('a document shows pictures from beside it, and nothing outside its folder', async () => {
  const { mkdir, symlink, writeFile: put } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'nc-pics-'));
  const folder = path.join(root, 'notas'), nested = path.join(folder, 'Tema 3_files');
  await mkdir(nested, { recursive: true });
  await put(path.join(folder, 'tema.md'), '![a](Tema%203_files/image1.png)');
  await put(path.join(nested, 'image1.png'), new Uint8Array([1, 2, 3]));
  await put(path.join(root, 'secreto.png'), new Uint8Array([9]));
  await put(path.join(folder, 'nota.txt'), 'no es una imagen');
  await symlink(path.join(root, 'secreto.png'), path.join(nested, 'enlace.png'));
  const files = libraryFiles({ settingsFile: path.join(root, 'library.json'), defaultFolder: path.join(root, 'NoteComplete') });
  const doc = path.join(folder, 'tema.md');
  await assert.rejects(files.readSibling(doc, 'Tema 3_files/image1.png'), /not opened/);
  await files.remember(doc);
  assert.deepEqual([...await files.readSibling(doc, 'Tema 3_files/image1.png')], [1, 2, 3]);
  assert.equal(await files.readSibling(doc, 'Tema 3_files/falta.png'), null);
  for (const bad of ['../secreto.png', '/etc/passwd', 'Tema 3_files/enlace.png', 'nota.txt', '', 'a\0.png']) await assert.rejects(files.readSibling(doc, bad), /Invalid|outside/, bad);
  // From an opened folder, a picture one level up (a shared "img" folder) is reachable; beyond it is not.
  await mkdir(path.join(folder, 'sub'));
  await put(path.join(folder, 'sub', 'otro.md'), 'x');
  await files.rememberFolder(folder);
  await files.remember(path.join(folder, 'sub', 'otro.md'));
  assert.deepEqual([...await files.readSibling(path.join(folder, 'sub', 'otro.md'), '../Tema 3_files/image1.png')], [1, 2, 3]);
  await assert.rejects(files.readSibling(path.join(folder, 'sub', 'otro.md'), '../../secreto.png'), /outside/);
});

test('a converted document is saved as a copy, never over a file, with its pictures beside it', async () => {
  const { mkdir, writeFile: put, readdir: list } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'nc-copy-'));
  const folder = path.join(root, 'clase');
  await mkdir(folder);
  await put(path.join(folder, 'Informe.docx'), 'original');
  await put(path.join(folder, 'Informe.md'), 'mío');
  const files = libraryFiles({ settingsFile: path.join(root, 'library.json'), defaultFolder: path.join(root, 'NoteComplete') });
  const original = path.join(folder, 'Informe.docx');
  const pic = (n) => ({ name: 'image1.png', bytes: new Uint8Array([n]) });
  const text = '# Informe\n\n![x](Informe_files/image1.png)\n';
  await assert.rejects(files.saveCopy(original, { name: 'Informe.md', text }), /not opened/);
  await files.remember(original);
  // The name is taken: the copy is "Informe (2).md"; the original and the other file are untouched.
  const first = await files.saveCopy(original, { name: 'Informe.md', text, images: [pic(1)], folder: 'Informe_files' });
  assert.equal(first.name, 'Informe (2).md');
  assert.equal(first.folder, 'Informe_files');
  assert.equal(await readFile(original, 'utf8'), 'original');
  assert.equal(await readFile(path.join(folder, 'Informe.md'), 'utf8'), 'mío');
  assert.deepEqual([...await readFile(path.join(folder, 'Informe_files', 'image1.png'))], [1]);
  // Saving again in the same session updates that copy instead of piling up more.
  const second = await files.saveCopy(original, { name: 'Informe.md', text: text + 'más\n', images: [pic(1)], folder: 'Informe_files', replace: first });
  assert.equal(second.path, first.path);
  assert.match(await readFile(first.path, 'utf8'), /más/);
  // A later session with different pictures finds the folder taken: a new folder, and the links follow it.
  const third = await files.saveCopy(original, { name: 'Informe.md', text, images: [pic(2)], folder: 'Informe_files' });
  assert.equal(third.name, 'Informe (3).md');
  assert.equal(third.folder, 'Informe (2)_files');
  assert.match(await readFile(third.path, 'utf8'), /\(Informe%20%282%29_files\/image1\.png\)/);
  assert.deepEqual([...await readFile(path.join(folder, 'Informe_files', 'image1.png'))], [1], 'the earlier pictures stay');
  // Without an original (a copy kept from Drive) it goes to the downloads folder.
  const kept = await files.saveCopy(null, { name: 'Drive.md', text: 'x' });
  assert.equal(path.dirname(kept.path), path.join(root, 'NoteComplete'));
  // Bad requests.
  await assert.rejects(files.saveCopy(original, { name: 'x.txt', text }), /Markdown/);
  await assert.rejects(files.saveCopy(original, { name: 'x.md', text, images: [{ name: '../x.png', bytes: new Uint8Array(1) }], folder: 'x_files' }), /Invalid picture/);
  await assert.rejects(files.saveCopy(original, { name: 'x.md', text, images: [pic(1)], folder: '../fuera_files' }), /Invalid pictures folder/);
  assert.ok((await list(folder)).every((n) => !n.endsWith('.partial')));
});
