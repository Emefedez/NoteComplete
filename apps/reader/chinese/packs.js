// Dictionaries (docs/CHINESE-INPUT.md §15, answer 2): the bundled common pack "core"
// (vendor/chinese/ime-core.bin: frequent words, every character, HSK 1–3) and downloadable,
// deletable expansions by HSK level. An expansion is cut on the device from the pinned
// complete-hsk-vocabulary list (MIT), checked against its SHA-256, and kept in IndexedDB
// "notecomplete-chinese" store "packs" as {key: id, id, levels, words: [{simp, trad, n, gloss,
// level}], bytes, installed}. The worker merges installed expansions into search and look-up.
import { withStore } from './db.js';
import { marksToNumbers } from './pinyin.js';

export const HSK_URL = 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/7ac65bf1a6387d35f1ade478906172a19311c7f9/complete.min.json';
export const HSK_SHA256 = '52d8e64ba65a6db4a38ea34302c6de5df53cdb5145254b25edcbf93b80676434';
export const PACKS = [
  { id: 'core', name: 'Common words and HSK 1–3', levels: [1, 2, 3], bundled: true },
  { id: 'hsk4', name: 'HSK 4', levels: [4] },
  { id: 'hsk5', name: 'HSK 5', levels: [5] },
  { id: 'hsk6', name: 'HSK 6', levels: [6] },
  { id: 'hsk7-9', name: 'HSK 7–9', levels: [7] },
];

// Parse a locally imported Chinese dictionary file:
// - CC-CEDICT (.u8/.txt/.cedict): "傳統 传统 [chuan2 tong3] /tradition/traditional/"
// - JSON (.json): array of {simp, trad?, n|pinyin, gloss|m, level?} or complete-hsk-vocabulary [{s, f:[...]}]
// - TSV/CSV (.tsv/.csv): "simp\tpinyin\tgloss[\ttrad]"
export function parseCustomDictionary(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('The dictionary file is empty.');
  const normPy = (p) => marksToNumbers(String(p || '')).toLowerCase().replace(/u:|v/g, 'ü').replace(/\s+/g, ' ').trim();
  const out = [];
  if (raw.startsWith('[') || raw.startsWith('{')) {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.words) ? parsed.words : Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const w of list) {
      if (!w || typeof w !== 'object') continue;
      if (w.s && Array.isArray(w.f)) {
        const ns = (w.l || []).filter((l) => l[0] === 'n').map((l) => +l.slice(1));
        const level = ns.length ? Math.min(...ns) : 0;
        for (const f of w.f) {
          const n = normPy(f.i?.n || f.i?.y || '');
          if (w.s && n) out.push({ simp: String(w.s), trad: String(f.t || w.s), n, gloss: (f.m || []).slice(0, 4).join('; ').slice(0, 160), level });
        }
      } else {
        const simp = String(w.simp || w.s || w.hanzi || w.word || '').trim();
        const trad = String(w.trad || w.t || simp).trim();
        const n = normPy(w.n || w.pinyin || '');
        const gloss = Array.isArray(w.gloss || w.m) ? (w.gloss || w.m).join('; ') : String(w.gloss || w.meaning || w.def || '').trim();
        if (simp && n) out.push({ simp, trad, n, gloss: gloss.slice(0, 160), level: Number(w.level) || 0 });
      }
    }
    if (!out.length) throw new Error('No valid entries found in JSON dictionary.');
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith('//')) continue;
    // CC-CEDICT: 傳統 传统 [chuan2 tong3] /tradition/traditional/
    const cedict = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/.exec(s);
    if (cedict) {
      const trad = cedict[1], simp = cedict[2], n = normPy(cedict[3]);
      const gloss = cedict[4].split('/').map((g) => g.trim()).filter(Boolean).slice(0, 4).join('; ').slice(0, 160);
      if (simp && n) out.push({ simp, trad, n, gloss, level: 0 });
      continue;
    }
    // TSV / CSV: simp, pinyin, gloss[, trad]
    const parts = s.includes('\t') ? s.split('\t') : s.split(',');
    if (parts.length >= 2) {
      const simp = parts[0].trim().replace(/^"|"$/g, '');
      const n = normPy(parts[1].trim().replace(/^"|"$/g, ''));
      const gloss = (parts[2] || '').trim().replace(/^"|"$/g, '').slice(0, 160);
      const trad = (parts[3] || simp).trim().replace(/^"|"$/g, '');
      if (/[\p{Script=Han}]/u.test(simp) && n) out.push({ simp, trad, n, gloss, level: 0 });
    }
  }
  if (!out.length) throw new Error('No valid entries found. Supported formats: CC-CEDICT (.u8/.txt), JSON, TSV, or CSV.');
  return out;
}

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
    // → [{id, name, levels, bundled, installed, custom, words, bytes}]
    async packs() {
      const rows = await store.all().catch(() => []);
      const have = new Map(rows.map(r => [r.id, r]));
      const c = await core();
      const base = PACKS.map(p => p.bundled
        ? { ...p, installed: true, words: c.words || 0, bytes: c.bytes || 0 }
        : { ...p, bundled: false, installed: have.has(p.id), words: have.get(p.id)?.words.length || 0, bytes: have.get(p.id)?.bytes || 0 });
      const known = new Set(PACKS.map(p => p.id));
      const custom = rows.filter(r => r && !known.has(r.id)).map(r => ({
        id: r.id, name: r.name || r.id, levels: r.levels || [], bundled: false, custom: true,
        installed: true, words: r.words?.length || 0, bytes: r.bytes || 0,
      }));
      return [...base, ...custom];
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
    async installLocalPack(name, text) {
      const words = parseCustomDictionary(text);
      const clean = String(name || 'Local dictionary').replace(/\.[^.]+$/, '').trim() || 'Local dictionary';
      const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'custom';
      const id = `local-${slug}-${Date.now().toString(36)}`;
      const row = { key: id, id, name: clean, custom: true, levels: [], words, bytes: JSON.stringify(words).length, installed: Date.now() };
      await store.put(row);
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
