import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { OFFICE_IMAGE, gunzipTo, imageArch, imageRef, pullImage } from './office-image.js';

const sha256 = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');

test('imageArch and imageRef map Node architectures to pinned digests', () => {
  assert.equal(imageArch('arm64'), 'arm64');
  assert.equal(imageArch('x64'), 'amd64');
  assert.equal(imageArch('ia32'), null);
  assert.equal(imageRef('arm64'), `ghcr.io/euro-office/documentserver@${OFFICE_IMAGE.arch.arm64.digest}`);
  assert.equal(imageRef('amd64'), `ghcr.io/euro-office/documentserver@${OFFICE_IMAGE.arch.amd64.digest}`);
  assert.equal(OFFICE_IMAGE.tag, 'v9.3.8');
  assert.equal(OFFICE_IMAGE.version, '9.3.8');
});

test('pullImage downloads, verifies sha256, resumes existing layers, and rejects tampered digests', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nc-office-img-'));
  try {
    const configBytes = Buffer.from(JSON.stringify({ architecture: 'arm64' }));
    const layer1Bytes = Buffer.from('fake-layer-one-content');
    const layer2Bytes = Buffer.from('fake-layer-two-content');
    const manifestObj = {
      schemaVersion: 2,
      config: { digest: sha256(configBytes), size: configBytes.length },
      layers: [
        { digest: sha256(layer1Bytes), size: layer1Bytes.length },
        { digest: sha256(layer2Bytes), size: layer2Bytes.length },
      ],
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifestObj));
    const manifestDigest = sha256(manifestBytes);
    const fakeImage = {
      registry: 'ghcr.io',
      repo: 'euro-office/documentserver',
      tag: 'v9.3.8',
      version: '9.3.8',
      arch: { arm64: { tag: 'v9.3.8-arm64', digest: manifestDigest, bytes: configBytes.length + layer1Bytes.length + layer2Bytes.length } },
    };

    const blobs = new Map([
      [manifestObj.config.digest, configBytes],
      [manifestObj.layers[0].digest, layer1Bytes],
      [manifestObj.layers[1].digest, layer2Bytes],
    ]);
    const calls = [];
    const fakeFetch = async (url) => {
      calls.push(url);
      if (url.includes('/token?')) return { ok: true, json: async () => ({ token: 'tok123' }) };
      if (url.includes('/manifests/')) return { ok: true, arrayBuffer: async () => manifestBytes };
      const digest = url.split('/blobs/')[1];
      const data = blobs.get(digest);
      if (!data) return { ok: false, status: 404 };
      return {
        ok: true,
        body: (async function* () { yield data.subarray(0, 5); yield data.subarray(5); })(),
      };
    };

    const dir = path.join(tmp, 'pull1');
    const progress = [];
    const res = await pullImage({ arch: 'arm64', dir, image: fakeImage, fetch: fakeFetch, onProgress: (p) => progress.push(p) });
    assert.equal(res.layers.length, 2);
    assert.ok(progress.some((p) => p.phase === 'downloading'));
    assert.deepEqual(await readFile(res.layers[0]), layer1Bytes);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8')), { architecture: 'arm64' });

    // Local copy mode (like NOTECOMPLETE_OFFICE_IMAGE_DIR) does not hit the network.
    const localSrc = path.join(tmp, 'local-src');
    await mkdir(path.join(localSrc, 'blobs'), { recursive: true });
    await writeFile(path.join(localSrc, 'manifest.json'), manifestBytes);
    for (const [d, b] of blobs) await writeFile(path.join(localSrc, 'blobs', d.split(':')[1]), b);
    const dir2 = path.join(tmp, 'pull-local');
    const res2 = await pullImage({ arch: 'arm64', dir: dir2, image: fakeImage, localDir: localSrc, fetch: () => { throw Error('should not fetch'); } });
    assert.equal(res2.layers.length, 2);

    // Tampered manifest is rejected.
    await assert.rejects(
      pullImage({
        arch: 'arm64', dir: path.join(tmp, 'bad'), image: fakeImage,
        fetch: async (url) => (url.includes('/token?') ? { ok: true, json: async () => ({ token: 't' }) } : { ok: true, arrayBuffer: async () => Buffer.from('{"tampered":true}') }),
      }),
      /digest mismatch/,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('gunzipTo decompresses a gzipped layer into a plain tar file', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nc-office-gz-'));
  try {
    const src = path.join(tmp, 'layer.tar.gz');
    const dst = path.join(tmp, 'layer.tar');
    await writeFile(src, gzipSync(Buffer.from('plain-tar-payload')));
    await gunzipTo(src, dst);
    assert.equal(await readFile(dst, 'utf8'), 'plain-tar-payload');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
