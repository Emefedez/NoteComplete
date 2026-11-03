import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchFiles, openablePath, OWN_TYPES, OTHER_TYPES, SYSTEM_EXTENSIONS } from './open-with.js';

test('launch arguments give the supported files, skipping the executable, app folder and flags', () => {
  assert.deepEqual(launchFiles(['/opt/NoteComplete/notecomplete', '--no-sandbox', '/home/a/Memoria 1.noteful', '/home/a/b.PDF']),
    ['/home/a/Memoria 1.noteful', '/home/a/b.PDF']);
  // electron . (development): the second argument is the app folder.
  assert.deepEqual(launchFiles(['/usr/bin/electron', '.', 'notes/x.md'], { cwd: '/home/a', packaged: false }), ['/home/a/notes/x.md']);
  assert.deepEqual(launchFiles(['/usr/bin/electron', '.'], { packaged: false }), []);
  // Linux desktop entries pass URLs (%U); remote URLs are not files.
  assert.deepEqual(launchFiles(['app', 'file:///home/a/My%20note.nfedit', 'https://example.com/a.pdf', 'notecomplete://reader/x.pdf']), ['/home/a/My note.nfedit']);
  // A second instance's argv carries Chromium switches; macOS adds -psn_….
  assert.deepEqual(launchFiles(['app', '--allow-file-access-from-files', '--original-process-start-time=1', '-psn_0_123', '/tmp/a.docx', '/tmp/a.docx']), ['/tmp/a.docx']);
  for (const bad of [null, undefined, 'x', {}]) assert.deepEqual(launchFiles(bad), []);
});

test('only supported extensions are opened', () => {
  for (const ok of ['/a/b.noteful', '/a/b.nfedit', '/a/b.notecomp', '/a/b.notepart', '/a/b.notecomplete', '/a/b.pdf', '/a/b.JPG', '/a/b.webp',
    '/a/b.md', '/a/b.txt', '/a/b.html', '/a/b.docx', '/a/b.odt', '/a/b.xlsx', '/a/b.ods', '/a/b.csv', '/a/b.tsv'])
    assert.equal(openablePath(ok), true, ok);
  for (const bad of ['/a/b.exe', '/a/b.pdf.exe', '/a/noext', '/a/b.mp3', 'b.pdf', '', null, 42, '/a/b.pdf/'])
    assert.equal(openablePath(bad), false, String(bad));
});

test('the installer configuration lists the same types', async () => {
  const { build } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  assert.ok(build.files.includes('open-with.js'));
  // Own formats on every platform, as their owner (Editor, Owner rank, a MIME type).
  const own = OWN_TYPES.flatMap(t => t.ext);
  assert.deepEqual(build.fileAssociations.map(a => a.ext), own);
  for (const a of build.fileAssociations) assert.ok(a.role === 'Editor' && a.rank === 'Owner' && a.mimeType && a.name, a.ext);
  // Common files: only "Open with" (Viewer, Alternate on macOS; MimeType= on Linux; OpenWithProgids on Windows).
  const other = OTHER_TYPES.flatMap(t => t.ext);
  assert.deepEqual(build.mac.fileAssociations.flatMap(a => a.ext), other);
  for (const a of build.mac.fileAssociations) assert.ok(a.role === 'Viewer' && a.rank === 'Alternate', a.ext);
  assert.deepEqual(build.linux.mimeTypes, OTHER_TYPES.map(t => t.mimeType));
  assert.equal(build.win?.fileAssociations, undefined, 'Windows associations from electron-builder would take over the default');
  const nsis = await readFile(new URL('./build/installer.nsh', import.meta.url), 'utf8');
  assert.deepEqual([...nsis.matchAll(/noteCompleteOpenWith "(\w+)"/g)].map(m => m[1]), other);
  assert.deepEqual([...nsis.matchAll(/noteCompleteForget "(\w+)"/g)].map(m => m[1]), other);
  // macOS exports a UTI for each own format.
  const utis = build.mac.extendInfo.UTExportedTypeDeclarations;
  assert.deepEqual(utis.map(u => u.UTTypeIdentifier), OWN_TYPES.map(t => t.uti));
  assert.deepEqual(utis.flatMap(u => u.UTTypeTagSpecification['public.filename-extension']), own);
  assert.equal(new Set(SYSTEM_EXTENSIONS).size, SYSTEM_EXTENSIONS.length);
});

test('main.js handles every way the system hands over files', async () => {
  const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
  for (const piece of ["app.on('open-file'", "app.on('second-instance', (_event, argv, workingDirectory)", 'requestSingleInstanceLock()', "ipcMain.handle('files:launched'", 'launchFiles(process.argv'])
    assert.ok(main.includes(piece), piece);
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /launched: \(\) => ipcRenderer\.invoke\('files:launched'\)/);
});
