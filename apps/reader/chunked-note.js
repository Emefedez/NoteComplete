// Auto-chunked collaborative notebook storage (GitHub & Nextcloud/WebDAV) and PIN-encrypted
// capability invite links (docs/COLLAB-PLATFORMS.md).
// Large notes (.nfedit, .noteful, PDFs, audio) are split into content-addressed <= 4 MiB
// chunks (chunks/sha256-<hash>.bin) + manifest.json so free hosts (GitHub, Nextcloud) never
// hit file-size limits and subsequent saves upload only modified chunks.

export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB
export const CHUNKED_FORMAT = 'notecomplete-chunked-v1';
const NOTE_EXT = /\.(noteful|nfedit|notecomp|notecomplete|notepart|pdf|md|markdown|txt|html?|png|jpe?g|webp|gif|bmp|avif|mp3|m4a|wav|ogg|flac|mp4|webm|mkv|mov|docx|docm|dotx|doc|rtf|odt|fodt|xlsx|xlsm|xlsb|xls|ods|fods|pptx|pptm|ppt|odp|epub|ipynb|csv|tsv)$/i;

const toBase64Url = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (str) => {
  const b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const toBase64 = (bytes) => {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
};
const fromBase64 = (str) => {
  const clean = String(str || '').replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export async function sha256Hex(bytes, subtle = globalThis.crypto?.subtle) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Splits a note/file into deduplicated content-addressed chunks (<= chunkSize bytes)
 * and a small manifest.json.
 */
export async function splitNoteBytes(input, { name = 'Note.nfedit', mimeType = 'application/octet-stream', chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const step = Math.max(1024, Number(chunkSize) || DEFAULT_CHUNK_SIZE);
  const sha256 = await sha256Hex(bytes);
  const chunks = [];
  const chunkBlobs = new Map();
  let index = 0;
  for (let offset = 0; offset < bytes.byteLength || (bytes.byteLength === 0 && offset === 0); offset += step) {
    const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + step));
    const hash = await sha256Hex(slice);
    chunks.push({ index: index++, hash, size: slice.byteLength });
    if (!chunkBlobs.has(hash)) chunkBlobs.set(hash, slice);
    if (bytes.byteLength === 0) break;
  }
  return {
    manifest: {
      format: CHUNKED_FORMAT,
      name: String(name || 'Note.nfedit'),
      mimeType: String(mimeType || 'application/octet-stream'),
      size: bytes.byteLength,
      sha256,
      chunkSize: step,
      updatedAt: new Date().toISOString(),
      chunks,
    },
    chunkBlobs,
  };
}

/**
 * Reassembles a chunked notebook from its manifest and a chunk fetcher `getChunk(hash, index)`.
 */
export async function reassembleNoteBytes(manifest, getChunk) {
  if (!manifest || manifest.format !== CHUNKED_FORMAT || !Array.isArray(manifest.chunks)) {
    throw Error('Invalid chunked note manifest.');
  }
  const parts = [];
  let total = 0;
  for (const c of manifest.chunks) {
    const raw = await getChunk(c.hash, c.index);
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const actualHash = await sha256Hex(bytes);
    if (c.hash && actualHash !== c.hash) {
      throw Error(`Chunk ${c.index} integrity check failed.`);
    }
    parts.push(bytes);
    total += bytes.byteLength;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.byteLength;
  }
  if (manifest.sha256) {
    const fullHash = await sha256Hex(out);
    if (fullHash !== manifest.sha256) throw Error('Reassembled note checksum mismatch.');
  }
  return out;
}

// --- PIN-encrypted capability invite links (PBKDF2 + AES-GCM) ---
async function derivePinKey(pin, salt, subtle = globalThis.crypto.subtle) {
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey('raw', enc.encode(String(pin || '').trim()), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 50000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptInvite(payload, pin, cryptoObj = globalThis.crypto) {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) throw Error('Choose a group PIN to encrypt the invite link.');
  const salt = cryptoObj.getRandomValues(new Uint8Array(12));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const key = await derivePinKey(cleanPin, salt, cryptoObj.subtle);
  const plain = new TextEncoder().encode(JSON.stringify({ v: 1, ...payload }));
  const cipher = new Uint8Array(await cryptoObj.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return `nc1.${toBase64Url(salt)}.${toBase64Url(iv)}.${toBase64Url(cipher)}`;
}

export async function decryptInvite(inviteText, pin, cryptoObj = globalThis.crypto) {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) throw Error('Enter the group PIN to unlock this invite.');
  const raw = String(inviteText || '').trim();
  const match = raw.match(/(?:^|[#?&]nc-cloud=)(nc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  const code = match ? match[1] : raw;
  const parts = code.split('.');
  if (parts.length !== 4 || parts[0] !== 'nc1') throw Error('Invalid invite code or link.');
  const salt = fromBase64Url(parts[1]);
  const iv = fromBase64Url(parts[2]);
  const cipher = fromBase64Url(parts[3]);
  try {
    const key = await derivePinKey(cleanPin, salt, cryptoObj.subtle);
    const plain = await cryptoObj.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw Error('Wrong group PIN or corrupted invite link.');
  }
}

// --- GitHub Auto-Chunked Repository Client ---
export function parseGitHubRepo(input) {
  const s = String(input || '').trim().replace(/\.git$/i, '');
  if (!s) return null;
  const urlMatch = s.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      slug: `${urlMatch[1]}/${urlMatch[2]}`,
      branch: urlMatch[3] || '',
      path: (urlMatch[4] || '').replace(/^\/+|\/+$/g, ''),
    };
  }
  const shortMatch = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^:/]+))?(?::\/?(.*))?$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      slug: `${shortMatch[1]}/${shortMatch[2]}`,
      branch: shortMatch[3] || '',
      path: (shortMatch[4] || '').replace(/^\/+|\/+$/g, ''),
    };
  }
  return null;
}

export class GitHubCloudClient {
  constructor({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
    this.fetcher = fetcher;
    this.owner = '';
    this.repo = '';
    this.branch = 'main';
    this.basePath = '';
    this.token = '';
  }

  configure({ repo, branch = '', path = '', token = '' } = {}) {
    const parsed = typeof repo === 'object' && repo?.owner ? repo : parseGitHubRepo(repo);
    if (!parsed) throw Error('Enter a GitHub repository as owner/repo or a github.com URL.');
    this.owner = parsed.owner;
    this.repo = parsed.repo;
    this.branch = String(branch || parsed.branch || 'main').trim() || 'main';
    this.basePath = String(path || parsed.path || '').replace(/^\/+|\/+$/g, '');
    this.token = String(token || '').trim();
    return this;
  }

  get configured() {
    return Boolean(this.owner && this.repo);
  }

  get slug() {
    return this.configured ? `${this.owner}/${this.repo}` : '';
  }

  headers(extra = {}) {
    return {
      Accept: 'application/vnd.github+json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  apiUrl(subpath) {
    return `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${subpath}`;
  }

  async requestJson(url, options = {}) {
    const res = await this.fetcher(url, { ...options, headers: this.headers(options.headers) });
    if (!res.ok) {
      let msg = `GitHub HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.message) msg = j.message; } catch { /* Ignore */ }
      throw Error(msg);
    }
    return res.json();
  }

  async list(folder = this.basePath) {
    if (!this.configured) throw Error('Connect a GitHub repository first.');
    const clean = String(folder || '').replace(/^\/+|\/+$/g, '');
    const encodedPath = clean ? '/' + clean.split('/').map(encodeURIComponent).join('/') : '';
    const refQuery = this.branch ? `?ref=${encodeURIComponent(this.branch)}` : '';
    const items = await this.requestJson(this.apiUrl(`/contents${encodedPath}${refQuery}`));
    if (!Array.isArray(items)) return [];
    const out = [];
    for (const it of items) {
      if (it.type === 'dir' && /\.ncchunk$/i.test(it.name)) {
        const displayName = it.name.replace(/\.ncchunk$/i, '');
        out.push({
          id: `${this.slug}:${it.path}`,
          source: 'github',
          repo: this.slug,
          branch: this.branch,
          name: displayName,
          path: it.path,
          sha: it.sha,
          isFolder: false,
          chunked: true,
          size: 0,
        });
      } else if (it.type === 'dir') {
        if (it.name === 'chunks' || it.name.startsWith('.')) continue;
        out.push({
          id: `${this.slug}:${it.path}`,
          source: 'github',
          repo: this.slug,
          branch: this.branch,
          name: it.name,
          path: it.path,
          sha: it.sha,
          isFolder: true,
        });
      } else if (it.type === 'file' && NOTE_EXT.test(it.name)) {
        out.push({
          id: `${this.slug}:${it.path}`,
          source: 'github',
          repo: this.slug,
          branch: this.branch,
          name: it.name,
          path: it.path,
          sha: it.sha,
          size: Number(it.size) || 0,
          downloadUrl: it.download_url || '',
          isFolder: false,
          chunked: false,
        });
      }
    }
    return out;
  }

  async readRawFile(path) {
    const clean = String(path || '').replace(/^\/+/, '');
    const encodedPath = clean.split('/').map(encodeURIComponent).join('/');
    if (!this.token) {
      const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/${encodeURIComponent(this.branch)}/${encodedPath}`;
      const res = await this.fetcher(rawUrl);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    }
    const refQuery = this.branch ? `?ref=${encodeURIComponent(this.branch)}` : '';
    const meta = await this.requestJson(this.apiUrl(`/contents/${encodedPath}${refQuery}`));
    if (meta?.content) return fromBase64(meta.content);
    if (meta?.sha) {
      const blob = await this.requestJson(this.apiUrl(`/git/blobs/${encodeURIComponent(meta.sha)}`));
      if (blob?.content) return fromBase64(blob.content);
    }
    throw Error(`Could not download ${path} from GitHub.`);
  }

  async download(item, { onProgress = () => {} } = {}) {
    if (item.chunked || /\.ncchunk$/i.test(item.path)) {
      const manifestBytes = await this.readRawFile(`${item.path}/manifest.json`);
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
      const total = manifest.chunks?.length || 1;
      let done = 0;
      const bytes = await reassembleNoteBytes(manifest, async (hash) => {
        const chunk = await this.readRawFile(`${item.path}/chunks/sha256-${hash}.bin`);
        done++;
        onProgress(done / total);
        return chunk;
      });
      return new File([bytes], manifest.name || item.name, { type: manifest.mimeType || 'application/octet-stream' });
    }
    const bytes = await this.readRawFile(item.path);
    onProgress(1);
    return new File([bytes], item.name);
  }

  async putFile(path, bytes, message) {
    const clean = String(path || '').replace(/^\/+/, '');
    const encodedPath = clean.split('/').map(encodeURIComponent).join('/');
    let existingSha = '';
    try {
      const refQuery = this.branch ? `?ref=${encodeURIComponent(this.branch)}` : '';
      const cur = await this.requestJson(this.apiUrl(`/contents/${encodedPath}${refQuery}`));
      if (cur?.sha) existingSha = cur.sha;
    } catch { /* New file. */ }
    return this.requestJson(this.apiUrl(`/contents/${encodedPath}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: toBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
        branch: this.branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });
  }

  /**
   * Splits a note into <= 4 MiB content-addressed chunks and uploads only missing chunks
   * plus manifest.json to `<folder>/<name>.ncchunk/`.
   */
  async publishNote(file, { folder = this.basePath, chunkSize = DEFAULT_CHUNK_SIZE, onProgress = () => {} } = {}) {
    if (!this.configured) throw Error('Configure a GitHub repository first.');
    if (!this.token) throw Error('A GitHub write token (or Creator invite) is required to publish notes.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { manifest, chunkBlobs } = await splitNoteBytes(bytes, { name: file.name || 'Note.nfedit', mimeType: file.type, chunkSize });
    const baseDir = [String(folder || '').replace(/^\/+|\/+$/g, ''), `${manifest.name}.ncchunk`].filter(Boolean).join('/');

    // Check which chunks already exist in `<baseDir>/chunks` so we skip uploading them.
    const existingHashes = new Set();
    try {
      const encodedChunks = `${baseDir}/chunks`.split('/').map(encodeURIComponent).join('/');
      const list = await this.requestJson(this.apiUrl(`/contents/${encodedChunks}?ref=${encodeURIComponent(this.branch)}`));
      if (Array.isArray(list)) {
        for (const entry of list) {
          const m = String(entry.name || '').match(/^sha256-([0-9a-f]{64})\.bin$/i);
          if (m) existingHashes.add(m[1].toLowerCase());
        }
      }
    } catch { /* No chunks directory yet. */ }

    const missing = [...chunkBlobs.entries()].filter(([hash]) => !existingHashes.has(hash));
    const totalSteps = missing.length + 1;
    let step = 0;
    for (const [hash, chunkBytes] of missing) {
      await this.putFile(`${baseDir}/chunks/sha256-${hash}.bin`, chunkBytes, `chunk ${hash.slice(0, 12)} for ${manifest.name}`);
      step++;
      onProgress(step / totalSteps);
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    await this.putFile(`${baseDir}/manifest.json`, manifestBytes, `Update ${manifest.name} (${manifest.chunks.length} chunks)`);
    onProgress(1);
    return {
      path: baseDir,
      manifest,
      uploadedChunks: missing.length,
      reusedChunks: chunkBlobs.size - missing.length,
    };
  }
}

// --- Nextcloud / OwnCloud / WebDAV Shared Folder Client ---
export function parseWebDavTarget(rawUrl, password = '') {
  const input = String(rawUrl || '').trim();
  if (!input) return null;
  let u;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  // Detect Nextcloud / OwnCloud public share links: https://host/[index.php/]s/<token>
  const shareMatch = u.pathname.match(/^(.*?)(?:\/index\.php)?\/s\/([A-Za-z0-9]+)(?:\/.*)?$/);
  if (shareMatch) {
    const prefix = shareMatch[1].replace(/\/$/, '');
    const token = shareMatch[2];
    const endpoint = `${u.origin}${prefix}/public.php/webdav`;
    const auth = 'Basic ' + btoa(`${token}:${password || ''}`);
    return { endpoint, shareToken: token, isPublicShare: true, authHeader: auth, host: u.host };
  }
  const auth = password ? 'Basic ' + btoa(password.includes(':') ? password : `user:${password}`) : '';
  return { endpoint: u.href.replace(/\/+$/, ''), shareToken: '', isPublicShare: false, authHeader: auth, host: u.host };
}

export function parseWebDavPropfindXml(xmlText, baseEndpoint = '') {
  const basePath = (() => {
    try { return decodeURIComponent(new URL(baseEndpoint).pathname).replace(/\/+$/, ''); }
    catch { return ''; }
  })();
  const responses = [...String(xmlText || '').matchAll(/<(?:\w+:)?response\b[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/gi)];
  const items = [];
  for (const [, block] of responses) {
    const hrefRaw = block.match(/<(?:\w+:)?href\b[^>]*>([^<]+)<\/(?:\w+:)?href>/i)?.[1]?.trim() || '';
    if (!hrefRaw) continue;
    let decodedHref = hrefRaw;
    try { decodedHref = decodeURIComponent(hrefRaw); } catch { /* Keep as is */ }
    const cleanHref = decodedHref.replace(/\/+$/, '');
    const relPath = basePath && cleanHref.startsWith(basePath) ? cleanHref.slice(basePath.length).replace(/^\/+/, '') : cleanHref.replace(/^\/+/, '');
    if (!relPath) continue; // The folder itself
    const name = relPath.split('/').filter(Boolean).pop() || '';
    if (!name || name.startsWith('.')) continue;
    const isCollection = /<(?:\w+:)?collection\b/i.test(block);
    if (!isCollection && !NOTE_EXT.test(name)) continue;
    const size = Number(block.match(/<(?:\w+:)?getcontentlength\b[^>]*>(\d+)<\/(?:\w+:)?getcontentlength>/i)?.[1] || 0);
    const lastMod = block.match(/<(?:\w+:)?getlastmodified\b[^>]*>([^<]+)<\/(?:\w+:)?getlastmodified>/i)?.[1]?.trim() || '';
    const etag = (block.match(/<(?:\w+:)?getetag\b[^>]*>([^<]+)<\/(?:\w+:)?getetag>/i)?.[1] || '').replace(/^"|"$|&quot;/g, '').trim();
    items.push({
      id: `webdav:${relPath}`,
      source: 'webdav',
      name,
      path: relPath,
      isFolder: isCollection,
      size,
      modifiedTime: lastMod ? new Date(lastMod).toISOString() : '',
      etag,
    });
  }
  return items;
}

export class WebDavCloudClient {
  constructor({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
    this.fetcher = fetcher;
    this.target = null;
  }

  configure({ url, password = '' } = {}) {
    const parsed = parseWebDavTarget(url, password);
    if (!parsed) throw Error('Enter a valid Nextcloud shared link (…/s/token) or WebDAV address.');
    this.target = parsed;
    return this;
  }

  get configured() {
    return Boolean(this.target?.endpoint);
  }

  headers(extra = {}) {
    return {
      ...(this.target?.authHeader ? { Authorization: this.target.authHeader } : {}),
      ...extra,
    };
  }

  itemUrl(relPath = '') {
    const clean = String(relPath || '').replace(/^\/+|\/+$/g, '');
    const encoded = clean ? '/' + clean.split('/').map(encodeURIComponent).join('/') : '';
    return `${this.target.endpoint}${encoded}`;
  }

  async list(relPath = '') {
    if (!this.configured) throw Error('Connect a Nextcloud or WebDAV link first.');
    const url = this.itemUrl(relPath);
    const res = await this.fetcher(url, {
      method: 'PROPFIND',
      headers: this.headers({ Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }),
    });
    if (!res.ok) throw Error(`WebDAV answered ${res.status}`);
    const xml = await res.text();
    return parseWebDavPropfindXml(xml, url);
  }

  async download(item) {
    if (!this.configured) throw Error('Connect a Nextcloud or WebDAV link first.');
    const res = await this.fetcher(this.itemUrl(item.path), { headers: this.headers() });
    if (!res.ok) throw Error(`WebDAV download failed (${res.status})`);
    return new File([await res.arrayBuffer()], item.name);
  }

  async upload(name, bytes, folder = '') {
    if (!this.configured) throw Error('Connect a Nextcloud or WebDAV link first.');
    const relPath = [String(folder || '').replace(/^\/+|\/+$/g, ''), name].filter(Boolean).join('/');
    const res = await this.fetcher(this.itemUrl(relPath), {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/octet-stream' }),
      body: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    });
    if (!res.ok) throw Error(`WebDAV upload failed (${res.status}). Check that the shared link allows editing.`);
    return { path: relPath, name };
  }
}
