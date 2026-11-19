// Stroke-order data (docs/CHINESE-INPUT.md §7.1): the 3 000 most frequent characters from the
// shards in vendor/chinese/strokes/ (tools/build_chinese_strokes.mjs; Arphic Public License,
// ARPHICPL.TXT beside them), the other ≈ 6 500 from jsDelivr (hanzi-writer-data@2.0.1), checked
// against the hash in the index and kept in Cache Storage "notecomplete-chinese". Works in the
// browser and in Node (tests, MCP add_prefab), where file: URLs are read from disk.
//   strokeData("你") → { strokes: [svgPath…], medians: [[[x,y]…]…], radStrokes?: [i…] } | null
// Coordinates: the 1024 box of Make Me a Hanzi, y up (drawn with y' = 900 − y).
export const REMOTE = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/';
export const CACHE = 'notecomplete-chinese';
const base = new URL('../vendor/chinese/strokes/', import.meta.url).href;
const shards = new Map(), chars = new Map();
let indexing = null;

async function readText(url) {
  if (url.startsWith('file:')) {
    const { readFile } = await import('node:fs/promises');
    return readFile(new URL(url), 'utf8');
  }
  const res = await fetch(url);
  if (!res.ok) throw Error(`${url}: ${res.status}`);
  return res.text();
}
// The index: { shardOf: Map(char → shard), hashOf: Map(char → 12 hex) }.
export function strokeIndex() {
  indexing ||= readText(base + 'index.json').then((text) => {
    const j = JSON.parse(text);
    const shardOf = new Map(), hashOf = new Map();
    j.shards.forEach((s, i) => { for (const c of s) shardOf.set(c, i); });
    const hex = j.hashes.length / [...j.remote].length;
    [...j.remote].forEach((c, i) => hashOf.set(c, j.hashes.slice(i * hex, (i + 1) * hex)));
    return { shardOf, hashOf, shards: j.shards.length };
  }).catch((e) => { indexing = null; throw e; });
  return indexing;
}
// The shard file holding a character (null: not bundled), from the index.
export async function shardOf(char) {
  const i = (await strokeIndex()).shardOf.get(char);
  return i === undefined ? null : i;
}
export const shardName = (i) => `${String(i).padStart(2, '0')}.json`;
// A shard's compact entry → the hanzi-writer-data shape.
export function expand(e) {
  const medians = e.m.map((flat) => { const pts = []; for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]); return pts; });
  return { strokes: e.s, medians, ...(e.r ? { radStrokes: e.r } : {}) };
}
async function loadShard(i) {
  if (!shards.has(i)) shards.set(i, readText(base + shardName(i)).then(JSON.parse).catch((e) => { shards.delete(i); throw e; }));
  return shards.get(i);
}
async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// A character outside the shards: Cache Storage first, then jsDelivr; kept only when its hash is
// the index's.
async function loadRemote(char, hash) {
  const url = REMOTE + encodeURIComponent(char) + '.json';
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  const hit = await cache?.match(url);
  let text = hit ? await hit.text() : null;
  if (text === null || !(await sha256Hex(text)).startsWith(hash)) {
    const res = await fetch(url);
    if (!res.ok) throw Error(`Stroke data for ${char}: ${res.status}`);
    text = await res.text();
    if (!(await sha256Hex(text)).startsWith(hash)) throw Error(`Stroke data for ${char} does not match its hash`);
    await cache?.put(url, new Response(text, { headers: { 'content-type': 'application/json' } })).catch(() => {});
  }
  const j = JSON.parse(text);
  return { strokes: j.strokes, medians: j.medians, ...(j.radStrokes?.length ? { radStrokes: j.radStrokes } : {}) };
}
// Whether stroke data exists for a character, without fetching it.
export async function hasStrokes(char) {
  const idx = await strokeIndex();
  return idx.shardOf.has(char) || idx.hashOf.has(char);
}
export function strokeData(char) {
  char = [...String(char || '')][0] || '';
  if (!chars.has(char)) {
    chars.set(char, (async () => {
      const idx = await strokeIndex();
      const i = idx.shardOf.get(char);
      if (i !== undefined) { const e = (await loadShard(i))[char]; return e ? expand(e) : null; }
      const hash = idx.hashOf.get(char);
      return hash ? loadRemote(char, hash) : null;
    })().catch((e) => { chars.delete(char); throw e; }));
  }
  return chars.get(char);
}
// Several characters at once: { char: data } for those that have data (others left out).
export async function strokesFor(text) {
  const out = {};
  for (const c of new Set(text)) {
    const d = await strokeData(c).catch(() => null);
    if (d) out[c] = d;
  }
  return out;
}
