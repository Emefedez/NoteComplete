import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, readdir, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { checkFiles, lineReader, listTargets, sendHub, sendSocketPath } from './send-hub.js';
import { browserFolders, browserSend, hostManifest, untar, wrapperScript, EXTENSION_ID } from './browser-send.js';

test('lines are parsed one by one, also across chunks', () => {
  const got = [], bad = [];
  const feed = lineReader((m) => got.push(m), (e) => bad.push(e.message));
  feed('{"a":1}\n{"b"');
  feed(':2}\nnot json\n\n');
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }]);
  assert.equal(bad.length, 1);
});

test('sent files are checked', () => {
  const [f] = checkFiles([{ name: '../../etc/x.gif', type: 'image/gif', base64: Buffer.from('GIF89a').toString('base64') }]);
  assert.equal(f.name, 'x.gif');
  assert.equal(f.bytes.toString(), 'GIF89a');
  assert.throws(() => checkFiles([]), /No files/);
  assert.throws(() => checkFiles([{ name: 'a' }]), /without its contents/);
  assert.throws(() => checkFiles(Array.from({ length: 21 }, () => ({ name: 'a', base64: '' }))), /at most 20/);
});

test('targets: the focused window’s notebook is the default; Recent skips what is open', () => {
  const states = new Map([[1, { kind: 'note', title: 'A', path: '/a.noteful' }], [2, { kind: null }], [3, { kind: 'note', title: 'B', path: '/b.noteful' }]]);
  const list = listTargets({
    windowsInOrder: [{ id: 9, focused: true, tabs: [{ id: 2, active: false }, { id: 3, active: true }] }, { id: 8, focused: false, tabs: [{ id: 1, active: true }] }],
    states,
    recent: [{ path: '/a.noteful', title: 'A' }, { path: '/c.noteful', title: 'C' }, { path: '/c.noteful', title: 'C again' }],
  });
  assert.deepEqual(list.open.map((t) => t.id), ['tab:3', 'tab:1']);
  assert.equal(list.default, 'tab:3');
  assert.deepEqual(list.recent, [{ id: 'path:/c.noteful', title: 'C', path: '/c.noteful' }]);
  // No focused window (the browser has the focus): the active notebook of the first window.
  assert.equal(listTargets({ windowsInOrder: [{ id: 8, focused: false, tabs: [{ id: 1, active: true }] }], states, recent: [] }).default, 'tab:1');
});

test('socket paths', () => {
  assert.equal(sendSocketPath('/home/u/.config/nc', 'linux'), '/home/u/.config/nc/send.sock');
  assert.equal(sendSocketPath('C:\\x', 'win32', 'ana'), '\\\\.\\pipe\\notecomplete-send-ana');
});

test('installer pieces: manifest, wrapper, browser folders, tar', () => {
  const m = hostManifest('/h/notecomplete-send-host');
  assert.deepEqual(m.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
  assert.equal(m.type, 'stdio');
  assert.match(wrapperScript({ platform: 'linux', exe: "/A/NoteComplete's.AppImage", script: '/h/send-host.cjs' }), /^#!\/bin\/sh\nELECTRON_RUN_AS_NODE=1 exec '\/A\/NoteComplete'\\''s\.AppImage' '\/h\/send-host\.cjs' "\$@"\n$/);
  assert.ok(browserFolders('linux', '/home/u').some((b) => b.hosts === '/home/u/.config/chromium/NativeMessagingHosts'));
  assert.ok(browserFolders('win32').every((b) => b.key.endsWith('\\com.notecomplete.send')));
  const header = (name, size, type = '0') => {
    const h = Buffer.alloc(512);
    h.write(name, 0); h.write(size.toString(8).padStart(11, '0'), 124); h.write(type, 156); h.write('ustar', 257);
    return h;
  };
  const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  const pax = Buffer.from('30 path=repo-1/extension/long.js\n');
  const tar = Buffer.concat([header('pax_global_header', 0, 'g'), header('repo-1/extension/manifest.json', 2), pad(Buffer.from('{}')), header('x', pax.length, 'x'), pad(pax), header('short', 3), pad(Buffer.from('abc')), Buffer.alloc(1024)]);
  assert.deepEqual(untar(tar).map((f) => [f.name, f.bytes.toString()]), [['repo-1/extension/manifest.json', '{}'], ['repo-1/extension/long.js', 'abc']]);
});

test('install: helper registered only in browsers that exist, extension unpacked from the release', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nc-send-'));
  const home = path.join(dir, 'home');
  await mkdir(path.join(home, '.config', 'chromium'), { recursive: true });
  const header = (name, size) => { const h = Buffer.alloc(512); h.write(name, 0); h.write(size.toString(8).padStart(11, '0'), 124); h.write('0', 156); return h; };
  const body = Buffer.from('{"version":"0.1.0"}');
  const tgz = gzipSync(Buffer.concat([header('r/manifest.json', body.length), body, Buffer.alloc(512 - body.length), header('r/test/e2e.mjs', 0), header('r/.github/x.yml', 0), header('r/README.md', 0), Buffer.alloc(1024)]));
  const fetchImpl = async (url) => url.includes('/releases/latest')
    ? { ok: true, json: async () => ({ tag_name: 'v0.1.0', tarball_url: 'https://x/t.tgz' }) }
    : { ok: true, arrayBuffer: async () => tgz };
  const s = browserSend({ userData: path.join(dir, 'data'), exe: '/usr/bin/nc', hostSource: new URL('./send-host.cjs', import.meta.url), platform: 'linux', home, fetchImpl, socketPath: '/s', targetsFile: '/t', launch: ['/usr/bin/nc'] });
  assert.equal((await s.status()).installed, false);
  const res = await s.install();
  assert.deepEqual(res.browsers, ['Chromium']);
  const st = await s.status();
  assert.equal(st.installed, true);
  assert.equal(st.version, '0.1.0');
  assert.deepEqual((await readdir(path.join(dir, 'data', 'browser-extension'))).sort(), ['README.md', 'manifest.json']);
  const manifest = JSON.parse(await readFile(path.join(home, '.config', 'chromium', 'NativeMessagingHosts', 'com.notecomplete.send.json'), 'utf8'));
  assert.equal(manifest.path, path.join(dir, 'data', 'send-host', 'notecomplete-send-host'));
  await s.uninstall();
  assert.equal((await s.status()).installed, false);
  await rm(dir, { recursive: true, force: true });
});

// The browser's side of the host: length-prefixed JSON.
function hostClient(child) {
  let buffered = Buffer.alloc(0);
  const queue = [], waiters = [];
  child.stdout.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32LE(0)) {
      const len = buffered.readUInt32LE(0);
      const m = JSON.parse(buffered.subarray(4, 4 + len).toString());
      buffered = buffered.subarray(4 + len);
      const w = waiters.shift();
      w ? w(m) : queue.push(m);
    }
  });
  return {
    send(m) { const b = Buffer.from(JSON.stringify(m)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); child.stdin.write(Buffer.concat([h, b])); },
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))),
  };
}

test('end to end: the host relays the browser to the app, and answers from Recent while it is closed', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nc-send-'));
  const socketPath = path.join(dir, 's.sock'), targetsFile = path.join(dir, 'targets.json'), config = path.join(dir, 'host-config.json');
  await writeFile(targetsFile, JSON.stringify({ recent: [{ id: 'path:/r.noteful', title: 'R', path: '/r.noteful' }] }));
  await writeFile(config, JSON.stringify({ socketPath, targetsFile, launch: [] }));
  const child = spawn(process.execPath, [new URL('./send-host.cjs', import.meta.url).pathname], { env: { ...process.env, NOTECOMPLETE_SEND_CONFIG: config } });
  const browser = hostClient(child);
  browser.send({ id: 1, op: 'targets' });
  const offline = await browser.next();
  assert.equal(offline.running, false);
  assert.deepEqual(offline.recent.map((r) => r.title), ['R']);
  const delivered = [];
  const hub = sendHub({
    socketPath,
    targets: () => ({ open: [{ id: 'tab:4', title: 'A' }], recent: [], default: 'tab:4' }),
    deliver: async ({ target, files }) => { delivered.push([target, files.map((f) => f.name)]); return { ok: true, text: 'Added 1 picture' }; },
  });
  await hub.start();
  browser.send({ id: 2, op: 'targets' });
  assert.equal((await browser.next()).default, 'tab:4');
  browser.send({ id: 3, op: 'send', target: 'tab:4', files: [{ name: 'cat.gif', type: 'image/gif', base64: Buffer.from('GIF89a').toString('base64') }] });
  assert.deepEqual(await browser.next(), { id: 3, ok: true, text: 'Added 1 picture' });
  assert.deepEqual(delivered, [['tab:4', ['cat.gif']]]);
  browser.send({ id: 4, op: 'send', files: [] });
  const refused = await browser.next();
  assert.equal(refused.ok, false);
  child.stdin.end();
  await hub.stop();
  await rm(dir, { recursive: true, force: true });
});
