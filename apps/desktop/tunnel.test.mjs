import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assetFor, ensureCloudflared, startTunnel, tarFile, tunnelAddress, CLOUDFLARED_VERSION } from './tunnel.js';

const response = (bytes) => ({ ok: true, status: 200, headers: new Map([['content-length', String(bytes.length)]]), body: [bytes] });

test('the pinned cloudflared for each computer, and nothing for unknown ones', () => {
  assert.equal(assetFor('linux', 'x64').url, `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`);
  assert.equal(assetFor('darwin', 'arm64').tgz, true);
  assert.match(assetFor('win32', 'x64').sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => assetFor('freebsd', 'x64'), /not available/);
});

test('a download that does not match its checksum is never kept or run', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cf-'));
  await assert.rejects(ensureCloudflared({ dir, platform: 'linux', arch: 'x64', fetch: async () => response(Buffer.from('not cloudflared')) }), /checksum/);
  await assert.rejects(readFile(path.join(dir, 'cloudflared')));
  // A kept binary changed afterwards is not used: it is downloaded again (and refused here).
  await writeFile(path.join(dir, 'cloudflared'), 'tampered');
  await writeFile(path.join(dir, 'cloudflared.sha256'), `${assetFor('linux', 'x64').sha256} ${'0'.repeat(64)}`);
  let fetched = 0;
  await assert.rejects(ensureCloudflared({ dir, platform: 'linux', arch: 'x64', fetch: async () => { fetched++; return response(Buffer.from('x')); } }));
  assert.equal(fetched, 1);
});

test('the macOS archive holds the program', () => {
  const header = Buffer.alloc(512);
  header.write('cloudflared', 0);
  header.write('0000000005\0', 124);
  const tar = Buffer.concat([header, Buffer.from('hello'), Buffer.alloc(507), Buffer.alloc(1024)]);
  assert.equal(tarFile(tar, 'cloudflared').toString(), 'hello');
  assert.throws(() => tarFile(Buffer.alloc(1024), 'cloudflared'), /missing/);
});

test('the tunnel address is read from cloudflared output; a silent tunnel fails', async () => {
  assert.equal(tunnelAddress('INF |  https://ab-cd-12.trycloudflare.com    |'), 'https://ab-cd-12.trycloudflare.com');
  assert.equal(tunnelAddress('https://evil.example.com/trycloudflare.com'), '');
  const quiet = () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => c.emit('exit', 1); return c; };
  await assert.rejects(startTunnel({ binary: 'x', port: 1, spawn: quiet, timeout: 50 }), /did not answer/);
  const dies = () => { const c = quiet(); setTimeout(() => { c.stderr.emit('data', Buffer.from('failed to request quick Tunnel')); c.emit('exit', 1); }, 5); return c; };
  await assert.rejects(startTunnel({ binary: 'x', port: 1, spawn: dies }), /stopped \(1\): failed to request quick Tunnel/);
});
