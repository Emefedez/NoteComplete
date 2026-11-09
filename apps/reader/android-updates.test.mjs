import test from 'node:test';
import assert from 'node:assert/strict';
import { androidUpdates, newer } from './android-updates.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const releases = [
  { tag_name: 'v1.1.39', draft: false, html_url: 'https://github.com/x/r/1.1.39', assets: [] },
  { tag_name: 'v1.1.40', draft: false, html_url: 'https://github.com/x/r/1.1.40', assets: [{ name: 'NoteComplete-android.apk', browser_download_url: 'https://github.com/x/r/1.1.40/NoteComplete-android.apk' }] },
  { tag_name: 'v1.2.0', draft: true, assets: [] },
];
const ok = (body) => async () => ({ ok: true, json: async () => body });

test('a newer release offers its APK, downloaded in the browser', async () => {
  const opened = [];
  const bridge = androidUpdates({ app: { version: '1.1.38' }, fetch: ok(releases), storage: memory(), open: (u) => opened.push(u) });
  const result = await bridge.check(true);
  assert.equal(result.version, '1.1.40', 'drafts are not offered');
  assert.equal(result.install, 'apk');
  assert.match(result.page, /NoteComplete-android\.apk$/);
  await bridge.openPage(result.page);
  assert.deepEqual(opened, [result.page]);
});

test('the latest version, skipped versions, the setting and errors', async () => {
  const storage = memory();
  const latest = androidUpdates({ app: { version: '1.1.40' }, fetch: ok(releases), storage });
  assert.equal((await latest.check(true)).version, undefined);
  const old = androidUpdates({ app: { version: '1.1.39' }, fetch: ok(releases), storage });
  await old.skip('1.1.40');
  assert.equal((await old.check(false)).skipped, true);
  await old.setCheckOnOpen(false);
  assert.equal((await old.check(false)).version, undefined, 'no check on open when it is off');
  assert.equal((await old.check(true)).version, '1.1.40', 'Help → Check for updates still asks');
  assert.equal((await old.settings()).checkOnOpen, false);
  const offline = androidUpdates({ app: { version: '1.1.39' }, fetch: async () => { throw new Error('offline'); }, storage: memory() });
  assert.equal((await offline.check(true)).error, 'offline');
  const unknown = androidUpdates({ app: {}, fetch: ok(releases), storage: memory() });
  assert.match((await unknown.check(true)).error, /version/);
  assert.equal(newer('1.1.40', '1.1.40-beta.1'), true);
});
