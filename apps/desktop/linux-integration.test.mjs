import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { desktopEntry, integrateLinux, mimeXml } from './linux-integration.js';

test('desktop entry passes file URLs and lists every type', () => {
  const e = desktopEntry('/opt/My Apps/NoteComplete.AppImage');
  assert.match(e, /Exec=env ELECTRON_OZONE_PLATFORM_HINT=auto "\/opt\/My Apps\/NoteComplete.AppImage" %U/);
  assert.match(e, /MimeType=application\/x-noteful;application\/x-nfedit;/);
  assert.match(e, /application\/pdf;/);
});
test('mime xml globs the own extensions', () => {
  const x = mimeXml();
  for (const g of ['*.noteful', '*.nfedit', '*.notecomp', '*.notecomplete', '*.notepart']) assert.ok(x.includes(`pattern="${g}"`), g);
});
test('integrates once, then is a no-op', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'nc-int-'));
  const calls = [];
  const exec = async (f, a) => { calls.push([f, ...a]); return ''; };
  const env = process.env.XDG_DATA_HOME; delete process.env.XDG_DATA_HOME;
  try {
    assert.equal(await integrateLinux({ appImage: '/x/NC.AppImage', platform: 'linux', home, exec }), true);
    assert.deepEqual(calls.map(c => c[0]), ['update-mime-database', 'update-desktop-database', 'xdg-mime']);
    assert.ok((await readFile(path.join(home, '.local/share/applications/notecomplete.desktop'), 'utf8')).includes('%U'));
    calls.length = 0;
    assert.equal(await integrateLinux({ appImage: '/x/NC.AppImage', platform: 'linux', home, exec }), false);
    assert.equal(calls.length, 0);
    assert.equal(await integrateLinux({ appImage: '', platform: 'linux', home, exec }), false);
  } finally { if (env !== undefined) process.env.XDG_DATA_HOME = env; }
});
