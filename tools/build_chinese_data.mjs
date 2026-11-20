#!/usr/bin/env node
// Chinese data packs for the reader (docs/CHINESE-INPUT.md §3, §4.3): downloads the pinned sources
// of tools/chinese-data.lock.json into work/zh-src/ (kept between runs), checks their SHA-256, and
// writes apps/reader/vendor/chinese/{ime-core.bin, chars.bin, opencc.bin} with their licence
// files. Run by tools/build_web.py; on its own: node tools/build_chinese_data.mjs
//   --update-lock  record the SHA-256 (and CC-CEDICT date) of the files in work/zh-src/ instead of failing
//   --fixture      also write the small test packs in apps/reader/chinese/test-fixtures/
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync, inflateRawSync, brotliCompressSync, constants } from 'node:zlib';
import { writeContainer, encodeStrings, readContainer } from '../apps/reader/chinese/pack.js';
import { SYLLABLES, SYLLABLE_LIST } from '../apps/reader/chinese/pinyin.js';

const ROOT = new URL('..', import.meta.url);
const SRC = new URL('work/zh-src/', ROOT), OUT = new URL('apps/reader/vendor/chinese/', ROOT);
const FIXTURES = new URL('apps/reader/chinese/test-fixtures/', ROOT);
const LOCK = new URL('tools/chinese-data.lock.json', ROOT);
const args = new Set(process.argv.slice(2));
const CORE_BUDGET = 900 * 1024; // brotli bytes (§15: frequent words + every character + HSK 1–3, with multi-sense definitions)
const GLOSS_MAX = 96, FREQ_SCALE = 32;

// ---- sources -------------------------------------------------------------------------------
const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
const sha256 = b => createHash('sha256').update(b).digest('hex');
let lockChanged = false;
async function source(name) {
  const s = lock.sources[name], path = new URL(s.file, SRC);
  if (!existsSync(path) && s.repo) { mkdirSync(SRC, { recursive: true }); writeFileSync(path, readFileSync(new URL(`../${s.repo}`, import.meta.url))); }
  if (!existsSync(path)) {
    mkdirSync(SRC, { recursive: true });
    console.log(`downloading ${s.url}`);
    const r = await fetch(s.url);
    if (!r.ok) throw new Error(`${s.url}: HTTP ${r.status}`);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  }
  const bytes = readFileSync(path), sum = sha256(bytes);
  if (sum !== s.sha256) {
    if (!args.has('--update-lock')) throw new Error(`${s.file} (${name}) has SHA-256 ${sum}, the lock says ${s.sha256}.\n` +
      (name === 'cedict' ? 'MDBG publishes only the latest CC-CEDICT. To build with this release run: node tools/build_chinese_data.mjs --update-lock (and commit tools/chinese-data.lock.json); to rebuild the pinned release, put that file in work/zh-src/cedict.txt.gz.'
        : `Delete work/zh-src/${s.file} to download it again, or run with --update-lock if the pinned source really changed.`));
    s.sha256 = sum; lockChanged = true;
  }
  return bytes;
}
// Entries of a zip file (Unihan.zip): central directory → local headers → inflate.
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n--;) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(data, data + size);
    files[name] = method === 8 ? inflateRawSync(raw) : raw;
    at += 46 + nameLen + extra + comment;
  }
  return files;
}

const cedictText = gunzipSync(await source('cedict')).toString('utf8');
const date = /^#! date=(\S+)/m.exec(cedictText)?.[1];
if (date !== lock.sources.cedict.date) {
  if (!args.has('--update-lock')) throw new Error(`CC-CEDICT release ${date} is not the pinned ${lock.sources.cedict.date}: run with --update-lock to accept it.`);
  lock.sources.cedict.date = date; lockChanged = true;
}
const text = async name => (await source(name)).toString('utf8');
const zhCn = await text('zh_cn'), zhTw = await text('zh_tw');
const unihanZip = unzip(await source('unihan'));
const opencc = {};
for (const t of ['STCharacters', 'STPhrases', 'TSCharacters', 'TSPhrases']) opencc[t] = await text(`opencc-${t}`);
const mmah = await text('mmah-dictionary'), hskJson = JSON.parse(await text('hsk'));
const licences = { unicode: await text('unicode-license'), opencc: await text('opencc-LICENSE'), mmah: await text('mmah-COPYING') };
if (lockChanged) { writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n'); console.log('updated tools/chinese-data.lock.json'); }

// ---- parsing -------------------------------------------------------------------------------
const HAN = /^\p{Script=Han}+$/u;
const chars = s => [...s];
function frequencies(txt) {
  const words = new Map(), perChar = new Map();
  let total = 0;
  for (const line of txt.split('\n')) {
    const [w, c] = line.trim().split(' '), n = +c;
    if (!w || !n) continue;
    words.set(w, (words.get(w) || 0) + n); total += n;
    for (const ch of chars(w)) perChar.set(ch, (perChar.get(ch) || 0) + n);
  }
  return { words, perChar, total, min: Math.min(...words.values()) };
}
const freq = { s: frequencies(zhCn), t: frequencies(zhTw) };

// Unihan: { cp: { field: value } } for the fields used here.
const unihan = new Map();
const FIELDS = new Set(['kMandarin', 'kHanyuPinlu', 'kTGHZ2013', 'kDefinition', 'kRSUnicode', 'kTotalStrokes', 'kSimplifiedVariant', 'kTraditionalVariant', 'kSemanticVariant', 'kSpecializedSemanticVariant', 'kZVariant']);
for (const file of ['Unihan_Readings.txt', 'Unihan_IRGSources.txt', 'Unihan_Variants.txt']) {
  for (const line of unihanZip[file].toString('utf8').split('\n')) {
    const [u, field, value] = line.split('\t');
    if (!value || !FIELDS.has(field)) continue;
    const ch = String.fromCodePoint(parseInt(u.slice(2), 16));
    if (!unihan.has(ch)) unihan.set(ch, {});
    unihan.get(ch)[field] = value.trim();
  }
}
// "nǐ" → "ni3" for single syllables (Unihan readings); neutral → 5.
const TONE = { '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 };
function numbered(marked) {
  let tone = 5, base = '';
  for (const ch of marked.normalize('NFD')) if (TONE[ch]) tone = TONE[ch]; else base += ch;
  return base.normalize('NFC') + tone;
}
// Per-reading counts of a character: kHanyuPinlu "xíng(2943) háng(218)" → {xing2: 2943, hang2: 218}.
function pinlu(ch) {
  const v = unihan.get(ch)?.kHanyuPinlu, out = {};
  if (v) for (const m of v.matchAll(/(\S+?)\((\d+)\)/g)) out[numbered(m[1])] = (out[numbered(m[1])] || 0) + +m[2];
  return out;
}

// CC-CEDICT lines → entries merged by (simplified, traditional, lower-case pinyin).
const merged = new Map();
let cedictLines = 0, dropped = 0;
for (const line of cedictText.split('\n')) {
  const m = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/.exec(line);
  if (!m) continue;
  cedictLines++;
  const [, trad, simp, py, defs] = m;
  const syl = py.replace(/u:/gi, 'ü').split(' ');
  const parsed = syl.map(s => /^([a-zü]+)([1-5])$/i.exec(s));
  if (!HAN.test(simp) || !HAN.test(trad) || parsed.some(p => !p || !SYLLABLES.has(p[1].toLowerCase())) || chars(simp).length !== syl.length || chars(trad).length !== syl.length) { dropped++; continue; }
  const lower = parsed.map(p => p[1].toLowerCase() + p[2]).join(' ');
  const key = `${simp}\t${trad}\t${lower}`;
  const proper = /^[A-ZÜ]/.test(syl[0]);
  const glosses = defs.split('/');
  const e = merged.get(key);
  if (e) { e.glosses = proper ? [...e.glosses, ...glosses] : [...glosses, ...e.glosses]; e.proper &&= proper; e.lines.push(line); }
  else merged.set(key, { simp, trad, py: lower, syl: parsed.map(p => p[1].toLowerCase()), tones: parsed.map(p => +p[2]), glosses, proper, lines: [line] });
}
const entries = [...merged.values()];
const bySimp = new Map();
for (const e of entries) { if (!bySimp.has(e.simp)) bySimp.set(e.simp, []); bySimp.get(e.simp).push(e); }

// Clean multi-sense gloss: skips classifier-only lines, strips verbose parenthetical notes and
// pinyin brackets, and keeps multiple senses separated by "; " without chopping mid-word.
const WEAK = /^(surname |CL:|(old |archaic |Japanese )?variant of |see |used in |also written |abbr\. for |\(Tw\)|\(old\))/i;
function cleanSense(raw) {
  let s = String(raw || '')
    .replace(/\s*\(CL:[^)]*\)/gi, '')
    .replace(/\s*\(Note:[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/[\p{Script=Han}]+\|([\p{Script=Han}]+)/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || /^CL:/i.test(s)) return '';
  // Drop verbose parenthetical commentary (> 24 chars) when real meaning remains outside it.
  const trimmed = s.replace(/\s*\([^)]{24,}\)/g, '').replace(/\s+/g, ' ').trim();
  if (trimmed && /[a-zA-Z]/.test(trimmed)) s = trimmed;
  // Drop leading grammatical labels like "(third-person singular)" or "(bound form)" when meaning follows.
  const noLead = s.replace(/^(?:\((?:third-person[^)]*|bound form|before a [^)]*|after a [^)]*|of two [^)]*|verb complement[^)]*)\)\s*)+/i, '').trim();
  if (noLead && /[a-zA-Z]/.test(noLead)) s = noLead;
  return s.replace(/^[;,\s]+|[;,\s]+$/g, '');
}
function truncateClean(s, max) {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.45) cut = cut.slice(0, sp);
  // Never leave an unclosed parenthesis.
  const open = cut.lastIndexOf('('), close = cut.lastIndexOf(')');
  if (open > close) cut = cut.slice(0, open);
  return cut.replace(/[\s;,(-]+$/, '') + '…';
}
function shortGloss(glosses, syls = []) {
  const cleaned = [];
  const seen = new Set();
  const strong = glosses.filter(g => g && !WEAK.test(g));
  const pool = strong.length ? strong : glosses.filter(Boolean);
  for (const raw of pool) {
    const c = cleanSense(raw);
    if (!c) continue;
    for (const part of c.split(/\s*;\s*/)) {
      const p = part.trim();
      const k = p.toLowerCase();
      if (!p || seen.has(k)) continue;
      seen.add(k);
      cleaned.push(p);
    }
  }
  if (!cleaned.length) return '';
  // If a sense is just the bare pinyin spelling itself (e.g. "ma" for 妈 ma1) and real translations
  // exist, put the real meanings first so single-gloss previews and translations are meaningful.
  const barePy = syls.join('').toLowerCase();
  if (barePy && cleaned.length > 1) {
    const bare = [], real = [];
    for (const p of cleaned) (p.toLowerCase().replace(/\s+/g, '') === barePy ? bare : real).push(p);
    if (real.length) cleaned.splice(0, cleaned.length, ...real, ...bare);
  }
  const kept = [];
  let len = 0;
  for (const p of cleaned) {
    const add = (kept.length ? 2 : 0) + p.length;
    if (kept.length && len + add > GLOSS_MAX) break;
    if (!kept.length && p.length > GLOSS_MAX) { kept.push(truncateClean(p, GLOSS_MAX)); break; }
    kept.push(p);
    len += add;
    if (kept.length >= 6) break;
  }
  return kept.join('; ');
}

// Reading share of one character's reading: kHanyuPinlu counts, else the kMandarin reading
// first, else even; a reading only used as a surname counts little.
const shareCache = new Map();
function charShares(ch) {
  if (shareCache.has(ch)) return shareCache.get(ch);
  const readings = [...new Set((bySimp.get(ch) || []).map(e => e.py))];
  const counts = pinlu(ch), total = Object.values(counts).reduce((a, b) => a + b, 0);
  const mandarin = unihan.get(ch)?.kMandarin?.split(' ').map(numbered) ?? [];
  const out = {};
  for (const r of readings) {
    if (total) out[r] = counts[r] ? counts[r] / total : 0.004;
    else if (mandarin.length) out[r] = mandarin[0] === r ? 1 : 0.12;
    else out[r] = 1 / readings.length;
  }
  shareCache.set(ch, out);
  return out;
}
// Share of each reading of a written form (several readings of the same characters).
function readingShare(e, form) {
  const same = bySimp.get(e.simp) || [e], list = form === 's' ? same : same.filter(o => o.trad === e.trad);
  // A single-character reading only "used in" a compound (吗 mǎ in 吗啡) is not typed alone.
  const bound = e => e.syl.length === 1 && e.glosses.length && e.glosses.every(g => /^(used in|see )/i.test(g));
  const own = e => chars(e.simp).reduce((p, ch, i) => p * (charShares(ch)[e.syl[i] + e.tones[i]] ?? 0.1), 1) * (e.proper && e.syl.length === 1 ? 0.08 : 1) * (bound(e) ? 0.05 : 1);
  const readings = new Map();
  for (const o of list) readings.set(o.py, Math.max(readings.get(o.py) || 0, own(o)));
  const sum = [...readings.values()].reduce((a, b) => a + b, 0);
  return sum ? own(e) / sum : 1 / readings.size;
}
// Log-frequency × FREQ_SCALE (u16; 1/32 of a doubling is plenty to rank and compresses well): words from FrequencyWords; single characters from their corpus count;
// other words estimated from their characters, below the lists' smallest count.
function logFreq(e, form) {
  const f = freq[form], other = freq[form === 's' ? 't' : 's'], ratio = f.total / other.total;
  const [word, alt] = form === 's' ? [e.simp, e.trad] : [e.trad, e.simp];
  // Subtitles mix scripts: a form missing from its own list is looked up in the other one.
  let count = f.words.get(word) || f.words.get(alt) || (other.words.get(alt) || other.words.get(word) || 0) * ratio, estimated = false;
  const listed = count > 0;
  // A character is typed for every word it starts in the input too, so its corpus count counts.
  if (e.syl.length === 1) count = Math.max(count, (f.perChar.get(word) || f.perChar.get(alt) || 0) / 8);
  if (!count) {
    estimated = true;
    const p = chars(word).reduce((p, ch) => p * ((f.perChar.get(ch) || 1) / f.total), 1);
    count = Math.min(f.min / 2, f.total * p * 0.05);
  }
  // Forms only listed as "variant of …" (以 written 㕥) borrow their counts: they rank last.
  const variant = e.glosses.every(g => !g || WEAK.test(g)) && e.glosses.some(g => /variant of/i.test(g));
  return { lf: Math.min(65535, Math.round(Math.log2(1 + count * readingShare(e, form) / (variant ? 256 : 1)) * FREQ_SCALE)), estimated, listed };
}

// HSK 3.0 levels ("n1".."n7"; 7 = levels 7–9) by simplified + numbered pinyin, and by simplified.
function hskWords(json) {
  const out = [];
  for (const w of json) {
    const levels = w.l.filter(l => l[0] === 'n').map(l => +l.slice(1));
    if (!levels.length) continue;
    for (const f of w.f) out.push({ simp: w.s, trad: f.t, py: f.i.n.toLowerCase().replace(/u:|v/g, 'ü'), gloss: f.m[0] || '', level: Math.min(...levels) });
  }
  return out;
}
const hsk = hskWords(hskJson);
const hskExact = new Map(), hskBySimp = new Map();
for (const h of hsk) {
  const k = `${h.simp}\t${h.py}`;
  hskExact.set(k, Math.min(hskExact.get(k) || 9, h.level));
  hskBySimp.set(h.simp, Math.min(hskBySimp.get(h.simp) || 9, h.level));
}

for (const e of entries) {
  const s = logFreq(e, 's'), t = logFreq(e, 't');
  e.fs = s.lf; e.ft = t.lf; e.listed = s.listed || t.listed; e.estimated = s.estimated && t.estimated;
  e.level = hskExact.get(`${e.simp}\t${e.py}`) || 0;
  e.gloss = shortGloss(e.glosses, e.syl);
  e.variant = e.glosses.every(g => !g || WEAK.test(g)) && e.glosses.some(g => /variant of/i.test(g));
}
// HSK words whose reading differs from CC-CEDICT's: the level goes to that word's most frequent
// entry; words CC-CEDICT lacks become entries of their own (flag 8).
const hskOnly = [];
for (const h of hsk) {
  if (hskExact.get(`${h.simp}\t${h.py}`) !== h.level) continue;
  const list = bySimp.get(h.simp);
  if (list?.some(e => e.py === h.py)) continue;
  if (list) { const best = list.reduce((a, b) => b.fs > a.fs ? b : a); if (!best.level || best.level > h.level) best.level = h.level; continue; }
  const py = h.py.split(' ').map(s => /^([a-zü]+)([1-5])$/.exec(s));
  if (!HAN.test(h.simp) || py.some(p => !p || !SYLLABLES.has(p[1])) || chars(h.simp).length !== py.length || chars(h.trad).length !== py.length || hskOnly.some(o => o.simp === h.simp && o.py === h.py)) continue;
  const e = { simp: h.simp, trad: h.trad, py: h.py, syl: py.map(p => p[1]), tones: py.map(p => +p[2]), glosses: [h.gloss], gloss: shortGloss([h.gloss]), level: h.level, hsk: true, lines: [] };
  e.fs = logFreq(e, 's').lf; e.ft = logFreq(e, 't').lf; e.estimated = true;
  hskOnly.push(e);
}

// ---- IME pack ------------------------------------------------------------------------------
// Sections (docs/CHINESE-INPUT.md §4.3): 0 meta, 1 syllable count u8, 2 keys u16 (syllable id << 3 |
// tone, ids of meta.syllables), 3 log-frequency simplified u16, 4 traditional u16, 5 HSK level u8,
// 6 flags u8, 7–8 simplified, 9–10 traditional ("" = same), 11–12 gloss, 13 first row per first
// syllable rank u32. Rows are sorted by the syllables' alphabetical rank, then tones, then frequency.
const FLAG = { proper: 1, variant: 2, estimated: 4, hsk: 8 };
const ALPHA = [...SYLLABLE_LIST].sort();
const rank = new Map(ALPHA.map((s, i) => [s, i]));
function compare(a, b) {
  for (let i = 0; i < Math.min(a.syl.length, b.syl.length); i++) { const d = rank.get(a.syl[i]) - rank.get(b.syl[i]); if (d) return d; }
  if (a.syl.length !== b.syl.length) return a.syl.length - b.syl.length;
  for (let i = 0; i < a.tones.length; i++) if (a.tones[i] !== b.tones[i]) return a.tones[i] - b.tones[i];
  return b.fs - a.fs || (a.simp < b.simp ? -1 : a.simp > b.simp ? 1 : a.trad < b.trad ? -1 : 1);
}
function imePack(list, id) {
  const rows = [...list].sort(compare);
  const ids = new Map(SYLLABLE_LIST.map((s, i) => [s, i]));
  const nsyl = Uint8Array.from(rows, r => r.syl.length);
  const keys = Uint16Array.from(rows.flatMap(r => r.syl.map((s, i) => ids.get(s) << 3 | r.tones[i])));
  const index = new Uint32Array(ALPHA.length + 1);
  let at = 0;
  for (let k = 0; k <= ALPHA.length; k++) { while (at < rows.length && rank.get(rows[at].syl[0]) < k) at++; index[k] = at; }
  const flags = Uint8Array.from(rows, r => (r.proper ? FLAG.proper : 0) | (r.variant ? FLAG.variant : 0) | (r.estimated ? FLAG.estimated : 0) | (r.hsk ? FLAG.hsk : 0));
  const meta = {
    kind: 'ime', id, version: 1, rows: rows.length, cedict: date, freqScale: FREQ_SCALE, syllables: SYLLABLE_LIST,
    logTotal: { s: Math.log2(freq.s.total), t: Math.log2(freq.t.total) },
    sections: ['meta', 'nsyl', 'keys', 'fs', 'ft', 'level', 'flags', 'simpLen', 'simp', 'tradLen', 'trad', 'glossLen', 'gloss', 'index'],
  };
  return writeContainer(meta, [nsyl, keys, Uint16Array.from(rows, r => r.fs), Uint16Array.from(rows, r => r.ft), Uint8Array.from(rows, r => r.level), flags,
    ...encodeStrings(rows.map(r => r.simp)), ...encodeStrings(rows.map(r => r.trad === r.simp ? '' : r.trad)), ...encodeStrings(rows.map(r => r.gloss)), index]);
}
const all = [...entries, ...hskOnly];
const core = all.filter(e => e.listed || e.syl.length === 1 || (e.level && e.level <= 3));

// ---- character pack ------------------------------------------------------------------------
// Sections: 0 meta, 1 code points u32 (sorted), 2 total strokes u8, then string columns
// (lengths u16 + blob) in meta.fields order.
const CHAR_FIELDS = ['readings', 'radical', 'definition', 'simplified', 'traditional', 'variants', 'decomposition', 'etymology'];
const mmahChars = new Map();
for (const line of mmah.split('\n')) if (line.trim()) { const j = JSON.parse(line); mmahChars.set(j.character, j); }
const variantChars = v => (v || '').split(' ').map(u => /^U\+([0-9A-F]+)/.exec(u)).filter(Boolean).map(m => String.fromCodePoint(parseInt(m[1], 16))).filter((c, i, a) => a.indexOf(c) === i).join('');
function charsPack(set) {
  const list = [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  const cols = Object.fromEntries(CHAR_FIELDS.map(f => [f, []]));
  const strokes = new Uint8Array(list.length);
  list.forEach((ch, i) => {
    const u = unihan.get(ch) || {}, m = mmahChars.get(ch);
    const readings = [];
    const add = (r, n) => { if (!readings.some(x => x.r === r)) readings.push({ r, n }); };
    Object.entries(u.kHanyuPinlu ? Object.fromEntries([...u.kHanyuPinlu.matchAll(/(\S+?)\((\d+)\)/g)].map(m => [m[1], +m[2]])) : {}).forEach(([r, n]) => add(r, n));
    (u.kMandarin || '').split(' ').filter(Boolean).forEach(r => add(r));
    (u.kTGHZ2013 || '').split(' ').forEach(x => (x.split(':')[1] || '').split(',').filter(Boolean).forEach(r => add(r)));
    cols.readings.push(readings.map(x => x.n ? `${x.r}:${x.n}` : x.r).join(' '));
    strokes[i] = Math.min(255, parseInt(u.kTotalStrokes) || 0);
    cols.radical.push((u.kRSUnicode || '').split(' ')[0]);
    const def = u.kDefinition || m?.definition || '';
    cols.definition.push(def.length > 160 ? truncateClean(def, 160) : def);
    cols.simplified.push(variantChars(u.kSimplifiedVariant).replace(ch, ''));
    cols.traditional.push(variantChars(u.kTraditionalVariant).replace(ch, ''));
    cols.variants.push(variantChars([u.kSemanticVariant, u.kSpecializedSemanticVariant, u.kZVariant].filter(Boolean).join(' ')).replace(ch, ''));
    cols.decomposition.push(m?.decomposition && m.decomposition !== '？' ? m.decomposition : '');
    const et = m?.etymology;
    cols.etymology.push(et ? [et.type, et.hint || '', et.phonetic || '', et.semantic || ''].join('|') : '');
  });
  const meta = { kind: 'chars', version: 1, rows: list.length, fields: CHAR_FIELDS, unihan: '17.0.0', sections: ['meta', 'codePoints', 'strokes', ...CHAR_FIELDS.flatMap(f => [f + 'Len', f])] };
  return writeContainer(meta, [Uint32Array.from(list, c => c.codePointAt(0)), strokes, ...CHAR_FIELDS.flatMap(f => encodeStrings(cols[f], true))]);
}
const charSet = new Set([...unihan.keys()].filter(ch => unihan.get(ch).kMandarin));
for (const ch of mmahChars.keys()) if (HAN.test(ch)) charSet.add(ch);
for (const e of core) for (const ch of chars(e.simp + e.trad)) charSet.add(ch);

// ---- OpenCC pack ---------------------------------------------------------------------------
// Sections: 0 meta, then per table of meta.tables: keys (lengths u16 + blob), values (lengths u16 +
// blob; alternatives separated by spaces, the first is OpenCC's default).
const OPENCC_TABLES = ['STPhrases', 'STCharacters', 'TSPhrases', 'TSCharacters'];
const openccRows = t => opencc[t].split('\n').map(l => l.split('\t')).filter(r => r.length === 2 && r[0] && !r[0].startsWith('#')).map(([k, v]) => [k, v.trim()]);
function openccPack(filter = () => true) {
  const cols = [], counts = {};
  for (const t of OPENCC_TABLES) {
    const rows = openccRows(t).filter(filter);
    counts[t] = rows.length;
    cols.push(...encodeStrings(rows.map(r => r[0]), true), ...encodeStrings(rows.map(r => r[1]), true));
  }
  return writeContainer({ kind: 'opencc', version: 1, opencc: 'ver.1.4.2', tables: OPENCC_TABLES, counts }, cols);
}

// ---- write, check, measure -----------------------------------------------------------------
const br = b => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
const kb = n => `${(n / 1024).toFixed(0)} KB`;
mkdirSync(OUT, { recursive: true });
const outputs = { 'ime-core.bin': imePack(core, 'core'), 'chars.bin': charsPack(charSet), 'opencc.bin': openccPack() };
for (const [name, bytes] of Object.entries(outputs)) writeFileSync(new URL(name, OUT), bytes);
writeLicences(OUT);

// Self-checks (§11): every row decodes; a sample of CC-CEDICT lines round-trips; budgets.
function check(bytes, source) {
  const p = readContainer(bytes), m = p.meta, n = m.rows;
  if (m.kind !== 'ime') throw new Error('not an IME pack');
  const nsyl = p.u8(1), keys = p.u16(2), simp = p.strings(7, n), trad = p.strings(9, n), gloss = p.strings(11, n), index = p.u32(13);
  if (nsyl.length !== n || p.u16(3).length !== n || p.u16(4).length !== n || p.u8(5).length !== n || p.u8(6).length !== n) throw new Error('column lengths differ from the row count');
  if (index[index.length - 1] !== n) throw new Error('index does not end at the row count');
  const found = new Map();
  let at = 0;
  for (let r = 0; r < n; r++) {
    const s = simp.get(r), t = trad.get(r) || s, py = [];
    for (let i = 0; i < nsyl[r]; i++) { const k = keys[at++]; const name = m.syllables[k >> 3]; if (!name || !(k & 7)) throw new Error(`row ${r}: bad key ${k}`); py.push(name + (k & 7)); }
    if (chars(s).length !== nsyl[r] || chars(t).length !== nsyl[r]) throw new Error(`row ${r} (${s}): characters and syllables differ`);
    found.set(`${s}\t${t}\t${py.join(' ')}`, gloss.get(r));
  }
  if (at !== keys.length) throw new Error('keys left over');
  let sampled = 0;
  for (let i = 0; i < source.length && sampled < 1000; i += Math.max(1, Math.floor(source.length / 1000))) {
    const e = source[i];
    if (!found.has(`${e.simp}\t${e.trad}\t${e.py}`)) throw new Error(`entry missing after packing: ${e.lines[0] || e.simp}`);
    if (found.get(`${e.simp}\t${e.trad}\t${e.py}`) !== e.gloss) throw new Error(`gloss differs for ${e.simp}`);
    sampled++;
  }
  return sampled;
}
const sampled = check(outputs['ime-core.bin'], core);
const sizes = Object.fromEntries(Object.entries(outputs).map(([k, b]) => [k, { raw: b.length, br: br(b) }]));
console.log(`CC-CEDICT ${date}: ${cedictLines} lines, ${entries.length} entries (${dropped} with non-syllable readings dropped), ${hskOnly.length} HSK words added`);
console.log(`ime-core.bin: ${core.length} entries (${core.filter(e => e.syl.length === 1).length} characters, ${core.filter(e => e.level && e.level <= 3).length} HSK 1–3), ${sampled} sampled lines round-trip`);
console.log(`chars.bin: ${charSet.size} characters`);
for (const [k, s] of Object.entries(sizes)) console.log(`  ${k.padEnd(14)} ${kb(s.raw).padStart(8)} raw  ${kb(s.br).padStart(7)} brotli`);
if (sizes['ime-core.bin'].br > CORE_BUDGET) throw new Error(`ime-core.bin is ${kb(sizes['ime-core.bin'].br)} brotli, over the ${kb(CORE_BUDGET)} budget`);

// Test fixtures: ≈ 200 entries around the characters the tests type, with real frequencies.
if (args.has('--fixture')) {
  const set = new Set(chars('你好呢尼泥拟腻我不知道银行在哪里那先见现线县险西安马码蚂妈吗么的得地德后後以候厚头发干净部皇方案反感今天气很学习中文喜欢小明是了一个人'));
  const pick = all.filter(e => chars(e.simp).every(c => set.has(c)) && (e.syl.length === 1 || e.listed || e.level)).sort((a, b) => b.fs - a.fs);
  const keep = [...pick.filter(e => e.syl.length === 1).slice(0, 120), ...pick.filter(e => e.syl.length > 1).slice(0, 110)];
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(new URL('ime-fixture.bin', FIXTURES), imePack(keep, 'fixture'));
  writeFileSync(new URL('chars-fixture.bin', FIXTURES), charsPack(new Set([...set].filter(c => unihan.has(c)))));
  writeFileSync(new URL('opencc-fixture.bin', FIXTURES), openccPack(([k]) => k.length <= 4 && chars(k).every(c => set.has(c) || '頭髮發現乾淨幹後'.includes(c))));
  writeLicences(FIXTURES);
  console.log(`fixtures: ${keep.length} entries in apps/reader/chinese/test-fixtures/`);
}

function writeLicences(dir) {
  writeFileSync(new URL('LICENSE-cc-cedict.txt', dir), `Chinese dictionary data from CC-CEDICT (https://cc-cedict.org/wiki/), © MDBG and
contributors, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
Word frequencies from FrequencyWords by Hermit Dave (OpenSubtitles 2018), CC BY-SA 4.0
(https://github.com/hermitdave/FrequencyWords).
HSK levels and the glosses of words CC-CEDICT lacks from complete-hsk-vocabulary by drkameleon
(https://github.com/drkameleon/complete-hsk-vocabulary), MIT.
Converted and reduced for NoteComplete (fields removed, re-encoded); the converted pack
(ime-*.bin, layout in docs/CHINESE-INPUT.md §4.3) is available under the same licence, CC BY-SA 4.0.
CC-CEDICT release: ${date}.
`);
  writeFileSync(new URL('LICENSE-unihan.txt', dir), `chars.bin contains data derived from the Unicode Character Database (Unihan 17.0.0,
https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip), under this licence:

${licences.unicode}`);
  writeFileSync(new URL('LICENSE-opencc.txt', dir), licences.opencc);
  writeFileSync(new URL('NOTICE-opencc.txt', dir), `opencc.bin contains the STCharacters, STPhrases, TSCharacters and TSPhrases tables of OpenCC
(https://github.com/BYVoid/OpenCC, tag ver.1.4.2), Copyright (c) Carbo Kuo and contributors,
licensed under the Apache License 2.0 (LICENSE-opencc.txt). Re-encoded for NoteComplete; the
mappings are unchanged.
`);
  writeFileSync(new URL('LICENSE-makemeahanzi.txt', dir), `The decomposition and etymology fields of chars.bin come from Make Me a Hanzi dictionary.txt
(https://github.com/skishore/makemeahanzi, commit bddc96d41bef78427ed0e034e9f7e31d71fd1b92),
licensed under the GNU Lesser General Public License, version 3 or later
(https://www.gnu.org/licenses/lgpl-3.0.txt). They are kept in this separate, replaceable data
file; tools/build_chinese_data.mjs rebuilds it from the source. The source's own notice:

${licences.mmah}`);
}
