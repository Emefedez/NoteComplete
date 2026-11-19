// Dictionaries (docs/CHINESE-INPUT.md §15, answer 2): the bundled common pack "core"
// (vendor/chinese/ime-core.bin: frequent words, every character, HSK 1–3) and downloadable,
// deletable expansions by HSK level. An expansion is cut on the device from the pinned
// complete-hsk-vocabulary list (MIT), checked against its SHA-256, and kept in IndexedDB
// "notecomplete-chinese" store "packs" as {key: id, id, levels, words: [{simp, trad, n, gloss,
// level}], bytes, installed}. The worker merges installed expansions into search and look-up.
import { withStore } from './db.js';

export const HSK_URL = 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/7ac65bf1a6387d35f1ade478906172a19311c7f9/complete.min.json';
export const HSK_SHA256 = '52d8e64ba65a6db4a38ea34302c6de5df53cdb5145254b25edcbf93b80676434';
export const PACKS = [
  { id: 'core', name: 'Common words and HSK 1–3', levels: [1, 2, 3], bundled: true },
  { id: 'hsk4', name: 'HSK 4', levels: [4] },
  { id: 'hsk5', name: 'HSK 5', levels: [5] },
  { id: 'hsk6', name: 'HSK 6', levels: [6] },
  { id: 'hsk7-9', name: 'HSK 7–9', levels: [7] },
];

// The words of the given HSK 3.0 levels (a word's level is its lowest "n" level; 7 = 7–9).
export function extractLevels(list, levels) {
  const out = [];
  for (const w of list) {
    const ns = (w.l || []).filter(l => l[0] === 'n').map(l => +l.slice(1));
    if (!ns.length || !levels.includes(Math.min(...ns))) continue;
    const level = Math.min(...ns);
    for (const f of w.f || []) out.push({ simp: w.s, trad: f.t || w.s, n: String(f.i?.n || '').toLowerCase().replace(/u:|v/g, 'ü'), gloss: (f.m || []).slice(0, 3).join('; ').slice(0, 120), level });
  }
  return out;
}

export const idbPackStore = () => ({
  all: () => withStore('packs', 'readonly', s => s.getAll()),
  put: row => withStore('packs', 'readwrite', s => s.put(row, row.key)),
  delete: key => withStore('packs', 'readwrite', s => s.delete(key)),
});

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// The HSK list, downloaded once per session (and from the HTTP cache after), checked before use.
let listPromise = null;
async function download(fetchFn, onProgress, expected) {
  const r = await fetchFn(HSK_URL, { cache: 'force-cache' });
  if (!r.ok) throw new Error(`HSK word list: HTTP ${r.status}`);
  const total = +r.headers?.get?.('content-length') || 2974371;
  let bytes;
  if (r.body?.getReader) {
    const reader = r.body.getReader(), parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); loaded += value.length;
      onProgress?.({ loaded, total, fraction: Math.min(0.95, loaded / total) });
    }
    bytes = new Uint8Array(loaded);
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.length; }
  } else bytes = new Uint8Array(await r.arrayBuffer());
  const sum = await sha256Hex(bytes);
  if (sum !== expected) throw new Error('The HSK word list did not match its checksum; nothing was installed.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function packManager({ store = idbPackStore(), fetch: fetchFn = (...a) => fetch(...a), core = async () => ({}), sha256 = HSK_SHA256 } = {}) {
  return {
    // → [{id, name, levels, bundled, installed, words, bytes}]
    async packs() {
      const have = new Map((await store.all().catch(() => [])).map(r => [r.id, r]));
      const c = await core();
      return PACKS.map(p => p.bundled
        ? { ...p, installed: true, words: c.words || 0, bytes: c.bytes || 0 }
        : { ...p, bundled: false, installed: have.has(p.id), words: have.get(p.id)?.words.length || 0, bytes: have.get(p.id)?.bytes || 0 });
    },
    async installPack(id, onProgress) {
      const p = PACKS.find(p => p.id === id);
      if (!p) throw new Error(`No dictionary ${id}`);
      if (p.bundled) return;
      const list = await (listPromise ||= download(fetchFn, onProgress, sha256).catch(e => { listPromise = null; throw e; }));
      const words = extractLevels(list, p.levels);
      const row = { key: id, id, levels: p.levels, words, bytes: JSON.stringify(words).length, installed: Date.now() };
      await store.put(row);
      onProgress?.({ loaded: 1, total: 1, fraction: 1 });
      return row;
    },
    async removePack(id) {
      if (PACKS.find(p => p.id === id)?.bundled) throw new Error('The built-in dictionary cannot be removed.');
      await store.delete(id);
    },
    // Every installed expansion's words, for the worker.
    async installedWords() { return (await store.all().catch(() => [])).flatMap(r => r.words); },
  };
}
// Tests reset the per-session download.
export const forgetDownload = () => { listPromise = null; };
