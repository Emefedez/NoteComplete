// Stroke-order data for Chinese mode (docs/CHINESE-INPUT.md §7.1): the 3 000 most frequent
// characters of hanzi-writer-data 2.0.1 (Make Me a Hanzi, Arphic Public License) into 64 shards
// of compact JSON, apps/reader/vendor/chinese/strokes/NN.json, plus index.json and ARPHICPL.TXT.
//
// Frequency: every character of FrequencyWords zh_cn + zh_tw (OpenSubtitles 2018, pinned commit,
// SHA-256 checked, cached in work/zh-src/) counted by the words it appears in, times their counts.
// Shards are cut in frequency order (shard 0 = the 47 most frequent characters), so a sentence
// usually needs one or two of them. JSON rather than a binary: the web host compresses JSON
// (≈ 30 % of raw), installers compress anyway, and it stays readable data under its own licence.
//
// Shard  NN.json: {"你": {"s": ["M…Z", …], "m": [[x,y, x,y, …], …], "r": [i…]?}, …}
//        s = stroke outlines (SVG paths, spaces around commands dropped), m = medians flattened,
//        r = radical strokes; coordinates in the 1024 box, y up (Make Me a Hanzi).
// Index  index.json: {version, source, shards: ["<chars of shard 0>", …], remote: "<chars>",
//        hashes: "<12 hex of SHA-256 per remote char, in order>"}: the other characters are
//        fetched from jsDelivr (hanzi-writer-data@2.0.1/<char>.json) and checked against these.
//   node tools/build_chinese_strokes.mjs [--check]
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = path.join(ROOT, 'apps/reader/node_modules/hanzi-writer-data');
const OUT = path.join(ROOT, 'apps/reader/vendor/chinese/strokes');
const SRC = path.join(ROOT, 'work/zh-src');
const COMMIT = '525f9b560de45753a5ea01069454e72e9aa541c6';
const LISTS = {
  zh_cn: '25599e00347b893e55c3058a748819b3fe19403291cd12f7c03af128e7f3fe45',
  zh_tw: 'b3bfa426ebd05225b1963cd557ce844d52912c5534c08b40ebeaec8768f36034',
};
export const TOP = 3000, SHARDS = 64, HASH_HEX = 12;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function list(code) {
  const file = path.join(SRC, `${code}_50k.txt`);
  if (!existsSync(file)) {
    const url = `https://raw.githubusercontent.com/hermitdave/FrequencyWords/${COMMIT}/content/2018/${code}/${code}_50k.txt`;
    const res = await fetch(url);
    if (!res.ok) throw Error(`${url}: ${res.status}`);
    mkdirSync(SRC, { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(file);
  if (sha(buf) !== LISTS[code]) throw Error(`${file}: SHA-256 ${sha(buf)}, expected ${LISTS[code]} (delete it to fetch again)`);
  return buf.toString('utf8');
}
// Path text without the spaces around commands: "M 330 202 Q 361 175" → "M330 202Q361 175".
export const compactPath = (d) => d.trim().replace(/\s*([A-Za-z])\s*/g, '$1').replace(/\s+/g, ' ');
export const compactChar = (j) => ({ s: j.strokes.map(compactPath), m: j.medians.map((m) => m.flat().map(Math.round)), ...(j.radStrokes?.length ? { r: j.radStrokes } : {}) });

export async function build({ write = true } = {}) {
  const counts = new Map();
  for (const code of Object.keys(LISTS)) {
    for (const line of (await list(code)).split('\n')) {
      const [word, n] = line.trim().split(/\s+/);
      if (!word || !(+n > 0)) continue;
      for (const ch of word) if (/\p{Script=Han}/u.test(ch)) counts.set(ch, (counts.get(ch) || 0) + +n);
    }
  }
  const all = readdirSync(DATA).filter((f) => f.endsWith('.json') && f !== 'package.json').map((f) => f.slice(0, -5)).sort();
  const ranked = all.filter((c) => counts.has(c)).sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : 1));
  const top = ranked.slice(0, TOP);
  const inTop = new Set(top);
  const per = Math.ceil(top.length / SHARDS);
  const shards = Array.from({ length: SHARDS }, (_, i) => top.slice(i * per, (i + 1) * per));
  const remote = all.filter((c) => !inTop.has(c));
  const index = {
    version: 1, source: 'hanzi-writer-data@2.0.1', licence: 'ARPHICPL.TXT',
    shards: shards.map((s) => s.join('')),
    remote: remote.join(''),
    hashes: remote.map((c) => sha(readFileSync(path.join(DATA, `${c}.json`))).slice(0, HASH_HEX)).join(''),
  };
  const files = shards.map((s) => JSON.stringify(Object.fromEntries(s.map((c) => [c, compactChar(JSON.parse(readFileSync(path.join(DATA, `${c}.json`), 'utf8')))]))));
  if (write) {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    files.forEach((text, i) => writeFileSync(path.join(OUT, `${String(i).padStart(2, '0')}.json`), text + '\n'));
    writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index) + '\n');
    copyFileSync(path.join(DATA, 'ARPHICPL.TXT'), path.join(OUT, 'ARPHICPL.TXT'));
    writeFileSync(path.join(OUT, 'README.txt'), 'Stroke-order data from hanzi-writer-data 2.0.1 (https://github.com/chanind/hanzi-writer-data),\nderived from Make Me a Hanzi (https://github.com/skishore/makemeahanzi), re-encoded for\nNoteComplete (whitespace removed, keys shortened). Licensed under the Arphic Public License:\nsee ARPHICPL.TXT. These files are data, separate from the app\'s code.\n');
  }
  const bytes = files.reduce((n, f) => n + Buffer.byteLength(f), 0);
  return { top: top.length, remote: remote.length, bytes, indexBytes: Buffer.byteLength(JSON.stringify(index)), biggest: Math.max(...files.map((f) => Buffer.byteLength(f))) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = await build({ write: !process.argv.includes('--check') });
  console.log(`strokes: ${r.top} characters in ${SHARDS} shards, ${(r.bytes / 1e6).toFixed(2)} MB (largest ${(r.biggest / 1e3).toFixed(0)} KB); index ${(r.indexBytes / 1e3).toFixed(0)} KB; ${r.remote} on demand`);
}
