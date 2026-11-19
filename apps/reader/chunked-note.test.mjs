import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHUNK_SIZE,
  sha256Hex,
  splitNoteBytes,
  reassembleNoteBytes,
  encryptInvite,
  decryptInvite,
  parseGitHubRepo,
  GitHubCloudClient,
  parseWebDavTarget,
  parseWebDavPropfindXml,
  WebDavCloudClient,
} from './chunked-note.js';

test('splitNoteBytes and reassembleNoteBytes round-trip with deduplication and SHA-256 verification', async () => {
  assert.equal(DEFAULT_CHUNK_SIZE, 4 * 1024 * 1024);
  const blockA = new Uint8Array(1024);
  for (let i = 0; i < blockA.length; i++) blockA[i] = (i * 31) & 0xff;
  const blockB = new Uint8Array(600);
  for (let i = 0; i < blockB.length; i++) blockB[i] = (i * 17 + 9) & 0xff;

  // Construct a payload of [blockA, blockA, blockB] so the first two 1024-byte chunks deduplicate
  const combined = new Uint8Array(blockA.length * 2 + blockB.length);
  combined.set(blockA, 0);
  combined.set(blockA, blockA.length);
  combined.set(blockB, blockA.length * 2);

  const { manifest, chunkBlobs } = await splitNoteBytes(combined, {
    name: 'Calculus II.nfedit',
    chunkSize: 1024,
  });

  assert.equal(manifest.format, 'notecomplete-chunked-v1');
  assert.equal(manifest.name, 'Calculus II.nfedit');
  assert.equal(manifest.size, combined.byteLength);
  assert.equal(manifest.chunks.length, 3);
  assert.equal(manifest.chunks[0].hash, manifest.chunks[1].hash);
  // Only 2 unique chunks need to be uploaded because chunk 0 and chunk 1 are identical
  assert.equal(chunkBlobs.size, 2);

  let fetchCalls = 0;
  const restored = await reassembleNoteBytes(
    manifest,
    async (hash) => { fetchCalls++; return chunkBlobs.get(hash); },
  );
  assert.equal(fetchCalls, 3);
  assert.deepEqual(restored, combined);

  // Tampering with a chunk must fail SHA-256 verification
  const badMap = new Map(chunkBlobs);
  const firstHash = manifest.chunks[0].hash;
  const corrupted = new Uint8Array(badMap.get(firstHash));
  corrupted[0] ^= 0xff;
  badMap.set(firstHash, corrupted);
  await assert.rejects(
    () => reassembleNoteBytes(manifest, async (hash) => badMap.get(hash)),
    /integrity check failed/i,
  );
});

test('encryptInvite and decryptInvite round-trip with PIN and reject wrong PIN', async () => {
  const payload = {
    p: 'github',
    r: 'alice/shared-notes',
    b: 'main',
    d: 'notes',
    t: 'github_pat_1234567890abcdef',
  };
  const code = await encryptInvite(payload, '482910');
  assert.match(code, /^nc1\./);

  const unlocked = await decryptInvite(code, '482910');
  assert.deepEqual(unlocked, { v: 1, ...payload });

  await assert.rejects(
    () => decryptInvite(code, '000000'),
    /Wrong group PIN|corrupted invite/i,
  );
});

test('parseGitHubRepo parses shorthand, HTTPS URLs, and tree/branch paths', () => {
  assert.deepEqual(parseGitHubRepo('Emefedez/study-notes'), {
    owner: 'Emefedez',
    repo: 'study-notes',
    slug: 'Emefedez/study-notes',
    branch: '',
    path: '',
  });
  assert.deepEqual(parseGitHubRepo('https://github.com/Emefedez/study-notes/tree/master/Semester1/Math'), {
    owner: 'Emefedez',
    repo: 'study-notes',
    slug: 'Emefedez/study-notes',
    branch: 'master',
    path: 'Semester1/Math',
  });
  assert.equal(parseGitHubRepo('not-a-repo'), null);
});

test('GitHubCloudClient lists directory, skips existing chunks on publishNote, and downloads .ncchunk', async () => {
  const store = new Map();
  const putCalls = [];

  const mockFetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const u = new URL(url);
    if (u.hostname === 'api.github.com') {
      const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/?(.*)$/);
      if (!m) return new Response('Not found', { status: 404 });
      const path = m[3].split('/').map(decodeURIComponent).join('/');
      if (method === 'GET') {
        if (store.has(path)) {
          const item = store.get(path);
          return new Response(JSON.stringify({ type: 'file', name: path.split('/').pop(), path, sha: item.sha, size: item.bytes.byteLength, content: Buffer.from(item.bytes).toString('base64') }), { status: 200 });
        }
        // Directory listing
        const prefix = path ? `${path}/` : '';
        const children = new Map();
        for (const [k, v] of store.entries()) {
          if (!k.startsWith(prefix)) continue;
          const rest = k.slice(prefix.length);
          const seg = rest.split('/')[0];
          if (!seg) continue;
          if (rest.includes('/')) {
            children.set(seg, { type: 'dir', name: seg, path: `${prefix}${seg}`, sha: `dir-${seg}`, size: 0 });
          } else {
            children.set(seg, { type: 'file', name: seg, path: k, sha: v.sha, size: v.bytes.byteLength });
          }
        }
        if (!children.size && path) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
        return new Response(JSON.stringify([...children.values()]), { status: 200 });
      }
      if (method === 'PUT') {
        const body = JSON.parse(init.body);
        const bytes = Uint8Array.from(Buffer.from(body.content, 'base64'));
        const sha = await sha256Hex(bytes);
        store.set(path, { bytes, sha });
        putCalls.push(path);
        return new Response(JSON.stringify({ content: { path, sha } }), { status: 201 });
      }
    }
    if (u.hostname === 'raw.githubusercontent.com') {
      const parts = u.pathname.split('/').slice(4);
      const path = parts.map(decodeURIComponent).join('/');
      if (!store.has(path)) return new Response('Not found', { status: 404 });
      return new Response(store.get(path).bytes, { status: 200 });
    }
    return new Response('Unhandled', { status: 500 });
  };

  const client = new GitHubCloudClient({ fetcher: mockFetch }).configure({
    repo: 'alice/notes',
    token: 'ghp_testToken',
  });

  const noteBytes = new TextEncoder().encode('Hello collaborative auto-chunked GitHub notes! '.repeat(60));
  const noteFile = new File([noteBytes], 'LinearAlgebra.nfedit');
  const res1 = await client.publishNote(noteFile, {
    folder: 'math',
    chunkSize: 1024,
  });
  assert.equal(res1.path, 'math/LinearAlgebra.nfedit.ncchunk');
  assert.ok(res1.uploadedChunks >= 1);

  // Publishing the exact same note again should skip already-uploaded chunks
  const beforePuts = putCalls.length;
  const res2 = await client.publishNote(noteFile, {
    folder: 'math',
    chunkSize: 1024,
  });
  assert.equal(res2.uploadedChunks, 0);
  assert.ok(res2.reusedChunks >= 1);
  // Only manifest.json is updated; all chunk files already exist
  assert.equal(putCalls.length - beforePuts, 1);
  assert.match(putCalls.at(-1), /manifest\.json$/);

  // Listing `math` returns the `.ncchunk` virtual note entry
  const items = await client.list('math');
  assert.equal(items.length, 1);
  assert.equal(items[0].chunked, true);
  assert.equal(items[0].name, 'LinearAlgebra.nfedit');

  // Downloading the `.ncchunk` entry reassembles the exact note bytes
  const file = await client.download(items[0]);
  const downloadedBytes = new Uint8Array(await file.arrayBuffer());
  assert.deepEqual(downloadedBytes, noteBytes);
});

test('parseWebDavTarget converts Nextcloud public share links and WebDavCloudClient lists/downloads/uploads', async () => {
  const parsed = parseWebDavTarget('https://cloud.university.edu/index.php/s/AbCdEf12345');
  assert.equal(parsed.endpoint, 'https://cloud.university.edu/public.php/webdav');
  assert.equal(parsed.shareToken, 'AbCdEf12345');
  assert.equal(parsed.isPublicShare, true);

  const xml = `<?xml version="1.0"?>
  <d:multistatus xmlns:d="DAV:">
    <d:response>
      <d:href>/public.php/webdav/</d:href>
      <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
    </d:response>
    <d:response>
      <d:href>/public.php/webdav/Lecture%201.nfedit</d:href>
      <d:propstat><d:prop>
        <d:displayname>Lecture 1.nfedit</d:displayname>
        <d:getcontentlength>4096</d:getcontentlength>
        <d:getlastmodified>Wed, 19 Nov 2026 10:00:00 GMT</d:getlastmodified>
        <d:getetag>"etag-1"</d:getetag>
        <d:resourcetype/>
      </d:prop></d:propstat>
    </d:response>
  </d:multistatus>`;

  const entries = parseWebDavPropfindXml(xml, 'https://cloud.university.edu/public.php/webdav');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Lecture 1.nfedit');
  assert.equal(entries[0].size, 4096);

  let uploadedBytes = null;
  const client = new WebDavCloudClient({
    fetcher: async (url, init = {}) => {
      if (init.method === 'PROPFIND') return new Response(xml, { status: 207 });
      if (init.method === 'PUT') {
        uploadedBytes = new Uint8Array(init.body);
        return new Response('', { status: 201 });
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    },
  }).configure({ url: 'https://cloud.university.edu/s/AbCdEf12345' });

  const listed = await client.list('');
  assert.equal(listed.length, 1);
  const dl = await client.download(listed[0]);
  assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));

  await client.upload('NewNote.md', new Uint8Array([9, 8, 7]), '');
  assert.deepEqual(uploadedBytes, new Uint8Array([9, 8, 7]));
});
