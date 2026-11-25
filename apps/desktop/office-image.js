// The Euro-Office image NoteComplete installs (docs/TABLES-AND-OFFICE.md phases 3c and 6): the
// official, unmodified DocumentServer image, pinned by tag and by digest for each architecture,
// fetched layer by layer from the registry without docker and checked against its sha256.
// The spike (~/Work/euro-office-spike/REPORT.md) proved this image and these steps.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

// Pinned 2026-11-25. v9.3.8 is the first release with the NOTICE the licence terms ask for
// (document-server-package#21). Digests are the per-architecture manifests of the tag's index.
export const OFFICE_IMAGE = Object.freeze({
  registry: 'ghcr.io',
  repo: 'euro-office/documentserver',
  tag: 'v9.3.8',
  version: '9.3.8',
  index: 'sha256:0f19cb676d48f85b826e199ac9e773ea12130f7d32bfc9a45e86aea320441b8a',
  arch: Object.freeze({
    arm64: Object.freeze({ tag: 'v9.3.8-arm64', digest: 'sha256:65616e579d3c103c4b2b29afa26353269c2a5c71035b5786892b80d02a91994b', bytes: 1036902674 }),
    amd64: Object.freeze({ tag: 'v9.3.8-amd64', digest: 'sha256:532e89eda4c69c6eb72b6645102a4b7c7858686661c63e4741a4232d9349bc7b', bytes: 1039727374 }),
  }),
  diskBytes: 3.2e9,
  sourceUrl: 'https://github.com/Euro-Office/DocumentServer/tree/v9.3.8',
  licence: 'AGPL-3.0-only; illustrations and icons CC BY-SA 4.0',
});

// Node's arch name → the image's.
export const imageArch = (arch = process.arch) => (arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : null);
// "ghcr.io/euro-office/documentserver@sha256:…" for container runtimes.
export const imageRef = (arch, image = OFFICE_IMAGE) => `${image.registry}/${image.repo}@${image.arch[arch].digest}`;

const MANIFEST = 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';
const sha256 = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
async function fileDigest(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return 'sha256:' + hash.digest('hex');
}
const exists = async (file) => { try { return (await stat(file)).isFile(); } catch { return false; } };

// Downloads (or copies from `localDir`, a folder of a previous pull: manifest.json + blobs/)
// the image for `arch` into `dir` (manifest.json, config.json, blobs/<hex>). Every file is
// checked: the manifest against the pinned digest, the config and each layer against the
// manifest. Layers already there with the right digest are kept (a pull that stopped resumes).
// onProgress({ phase: 'downloading' | 'verifying', received, total, layer, layers }).
export async function pullImage({ arch, dir, image = OFFICE_IMAGE, fetch = globalThis.fetch, localDir = '', onProgress = () => {}, signal } = {}) {
  const pin = image.arch[arch];
  if (!pin) throw Error(`No Euro-Office image for ${arch}.`);
  await mkdir(path.join(dir, 'blobs'), { recursive: true });
  let token = '';
  const base = `https://${image.registry}/v2/${image.repo}`;
  const auth = async () => {
    if (token || localDir) return;
    const r = await fetch(`https://${image.registry}/token?scope=repository:${image.repo}:pull`, { signal });
    if (!r.ok) throw Error(`The image registry refused access (HTTP ${r.status}).`);
    token = (await r.json()).token;
  };
  const get = async (route, accept) => {
    await auth();
    const r = await fetch(`${base}/${route}`, { headers: { Authorization: `Bearer ${token}`, ...(accept ? { Accept: accept } : {}) }, redirect: 'follow', signal });
    if (!r.ok) throw Error(`Download failed: ${route} (HTTP ${r.status}).`);
    return r;
  };
  // The manifest: its digest must be the pinned one.
  const manifestBytes = localDir
    ? await readFile(path.join(localDir, 'manifest.json'))
    : Buffer.from(await (await get(`manifests/${pin.digest}`, MANIFEST)).arrayBuffer());
  if (sha256(manifestBytes) !== pin.digest) throw Error('The image manifest is not the pinned one (digest mismatch).');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  await writeFile(path.join(dir, 'manifest.json'), manifestBytes);
  const blobs = [manifest.config, ...manifest.layers];
  const total = blobs.reduce((n, b) => n + b.size, 0);
  let done = 0;
  for (const [i, blob] of blobs.entries()) {
    const hex = blob.digest.split(':')[1];
    const target = path.join(dir, 'blobs', hex);
    const report = (phase, extra = 0) => onProgress({ phase, received: done + extra, total, layer: i, layers: blobs.length });
    if (await exists(target) && (await stat(target)).size === blob.size) {
      report('verifying');
      if (await fileDigest(target) === blob.digest) { done += blob.size; report('verifying'); continue; }
    }
    const partial = `${target}.partial`;
    if (localDir) {
      let from = path.join(localDir, 'blobs', hex);
      if (i === 0 && !(await exists(from)) && await exists(path.join(localDir, 'config.json'))) {
        from = path.join(localDir, 'config.json');
      }
      if (path.resolve(from) === path.resolve(target)) throw Error('The local image folder is the install folder.');
      await pipeline(createReadStream(from), createWriteStream(partial));
      report('verifying', blob.size);
    } else {
      const r = await get(`blobs/${blob.digest}`);
      let got = 0;
      const out = createWriteStream(partial);
      for await (const chunk of r.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
        report('downloading', got);
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    }
    if (await fileDigest(partial) !== blob.digest) { await rm(partial, { force: true }); throw Error(`A download was damaged (${blob.digest.slice(0, 19)}…): try again.`); }
    await rename(partial, target);
    done += blob.size;
    report(localDir ? 'verifying' : 'downloading');
  }
  await rename(path.join(dir, 'blobs', manifest.config.digest.split(':')[1]), path.join(dir, 'config.json')).catch(() => {});
  return { manifest, layers: manifest.layers.map((l) => path.join(dir, 'blobs', l.digest.split(':')[1])), bytes: total };
}

// A gzip layer as a plain tar (WSL imports a .tar; the first layer is the Ubuntu base).
export async function gunzipTo(from, to) {
  await pipeline(createReadStream(from), createGunzip(), createWriteStream(to));
  return to;
}
