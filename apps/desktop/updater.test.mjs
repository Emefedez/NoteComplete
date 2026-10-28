import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newer, latestRelease, pickAsset, parseSums, updater } from './updater.js';

test('versions compare numerically, pre-releases before their release', () => {
  assert.equal(newer('v1.0.10', '1.0.9'), true);
  assert.equal(newer('1.0.0', '1.0.0'), false);
  assert.equal(newer('1.1.0-beta.2', '1.1.0-beta.1'), true);
  assert.equal(newer('1.1.0', '1.1.0-beta.3'), true);
  assert.equal(newer('1.1.0-beta.1', '1.1.0'), false);
  assert.equal(newer('nonsense', '1.0.0'), false);
});

test('the newest non-draft release and this machine\'s installer are picked', () => {
  const releases = [{ tag_name: 'v1.1.0', draft: true }, { tag_name: 'v1.0.2', assets: [] }, { tag_name: 'v1.0.10', assets: [
    { name: 'NoteComplete-1.0.10-linux-x86_64.AppImage' }, { name: 'NoteComplete-1.0.10-linux-arm64.AppImage' }, { name: 'NoteComplete-1.0.10-mac-arm64.dmg' }, { name: 'NoteComplete Setup 1.0.10.exe' }] }];
  const r = latestRelease(releases);
  assert.equal(r.tag_name, 'v1.0.10');
  assert.equal(pickAsset(r, 'linux', 'arm64').name, 'NoteComplete-1.0.10-linux-arm64.AppImage');
  assert.equal(pickAsset(r, 'linux', 'x64').name, 'NoteComplete-1.0.10-linux-x86_64.AppImage');
  assert.equal(pickAsset(r, 'darwin', 'arm64').name, 'NoteComplete-1.0.10-mac-arm64.dmg');
  assert.equal(pickAsset(r, 'win32', 'x64').name, 'NoteComplete Setup 1.0.10.exe');
});

test('checksums are read from sha256sum output', () => {
  const sums = parseSums(`${'a'.repeat(64)}  ./NoteComplete-1.0.1-linux-arm64.AppImage\n${'b'.repeat(64)} *other.zip\n`);
  assert.equal(sums.get('NoteComplete-1.0.1-linux-arm64.AppImage'), 'a'.repeat(64));
  assert.equal(sums.get('other.zip'), 'b'.repeat(64));
});

test('an AppImage updates itself only with a matching checksum, keeping the old copy', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-update-'));
  const appImage = path.join(dir, 'NoteComplete.AppImage');
  await writeFile(appImage, 'old', { mode: 0o755 });
  const payload = Buffer.from('new build'), hash = createHash('sha256').update(payload).digest('hex');
  let sums = `${hash}  ./NoteComplete-1.2.0-linux-arm64.AppImage\n`;
  const release = { tag_name: 'v1.2.0', html_url: 'https://example/r', assets: [
    { name: 'NoteComplete-1.2.0-linux-arm64.AppImage', browser_download_url: 'asset', size: payload.length },
    { name: 'SHA256SUMS.txt', browser_download_url: 'sums' }] };
  const fetch = async url => url.includes('api.github.com') ? { ok: true, json: async () => [release] }
    : url === 'sums' ? { ok: true, text: async () => sums }
    : { ok: true, headers: new Map([['content-length', String(payload.length)]]), body: [payload] };
  const u = updater({ app: { getVersion: () => '1.0.0' }, fetch, stateFile: path.join(dir, 'state.json'), appImage, platform: 'linux', arch: 'arm64' });
  const found = await u.check({ manual: true });
  assert.deepEqual([found.version, found.install], ['1.2.0', 'appimage']);
  sums = `${'0'.repeat(64)}  ./NoteComplete-1.2.0-linux-arm64.AppImage\n`;
  await assert.rejects(u.install(), /checksum/);
  assert.equal(await readFile(appImage, 'utf8'), 'old');
  sums = `${hash}  ./NoteComplete-1.2.0-linux-arm64.AppImage\n`;
  const progress = [];
  assert.equal((await u.install(p => progress.push(p))).version, '1.2.0');
  assert.equal(await readFile(appImage, 'utf8'), 'new build');
  assert.equal(await readFile(`${appImage}.previous`, 'utf8'), 'old');
  assert.equal(progress.at(-1), 1);
  // No newer release: nothing to offer; a skipped version is reported as skipped on open.
  const same = updater({ app: { getVersion: () => '1.2.0' }, fetch, stateFile: path.join(dir, 's2.json'), appImage, platform: 'linux', arch: 'arm64' });
  assert.equal((await same.check({ manual: true })).version, undefined);
});
