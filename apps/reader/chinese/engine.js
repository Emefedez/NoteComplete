// The Chinese dictionary engine (docs/CHINESE-INPUT.md §4.3–4.4, §6.4, §8): pure, used by
// engine-worker.js and the Node tests. It reads the packs written by tools/build_chinese_data.mjs
// (container: pack.js) without building an object per entry:
//
// ime-*.bin (meta.kind "ime"), rows sorted by the alphabetical rank of their syllables, then tones,
// then frequency, so every "words whose syllables start with ni, h…" is one contiguous range:
//   1 nsyl u8           syllables per row
//   2 keys u16          per syllable: id << 3 | tone (1–5); id indexes meta.syllables (pinyin.js order)
//   3 fs, 4 ft u16      log2(count + 1) × meta.freqScale from FrequencyWords zh_cn / zh_tw; single
//                       characters weighted per reading by kHanyuPinlu (so 先 xiān beats 见 xiàn)
//   5 level u8          HSK 3.0 level 1–6, 7 = 7–9, 0 = none
//   6 flags u8          1 proper noun / surname, 2 only "variant of", 4 frequency estimated, 8 from the HSK list
//   7–8 simplified, 9–10 traditional ("" = same as simplified), 11–12 first gloss (≤ 40 chars):
//                       string columns (u8 lengths in UTF-16 units + UTF-8 blob)
//   13 index u32        first row per first-syllable rank (rank = position in sorted meta.syllables)
// chars.bin (kind "chars"): 1 code points u32 sorted, 2 total strokes u8, then string columns in
//   meta.fields order (u16 lengths + blob): readings "xíng:2943 háng:218 xìng", radical "144.0",
//   definition, simplified, traditional, variants, decomposition "⿰彳亍", etymology "type|hint|phonetic|semantic".
import { readContainer } from './pack.js';
import { segment, markTone, SYLLABLES } from './pinyin.js';

const W_USER = 3, W_SPLIT = 6, WORD_PENALTY = 2, MAX_WORD = 8, UNKNOWN_COST = 30, HALF_LIFE = 30 * 864e5;
const sc = s => String(s || 's')[0] === 't' ? 't' : 's'; // 's' | 't' | 'simplified' | 'traditional'
const isHan = ch => /\p{Script=Han}/u.test(ch);
const HAN_RUN = /\p{Script=Han}+/gu;

export function decodeIme(bytes) {
  const p = readContainer(bytes), m = p.meta, n = m.rows;
  if (m.kind !== 'ime') throw new Error('not an IME pack');
  const nsyl = p.u8(1), keyStart = new Uint32Array(n + 1);
  for (let r = 0; r < n; r++) keyStart[r + 1] = keyStart[r] + nsyl[r];
  const names = m.syllables, sorted = [...names].sort();
  const rankOf = new Map(sorted.map((s, i) => [s, i]));
  return {
    meta: m, rows: n, nsyl, keyStart, keys: p.u16(2), fs: p.u16(3), ft: p.u16(4), level: p.u8(5), flags: p.u8(6),
    simp: p.strings(7, n), trad: p.strings(9, n), gloss: p.strings(11, n), index: p.u32(13),
    names, sorted, rankOf, rankById: Uint16Array.from(names, s => rankOf.get(s)), scale: m.freqScale || 1024,
    logTotal: m.logTotal || { s: 25, t: 25 },
  };
}

export function decodeChars(bytes) {
  const p = readContainer(bytes), m = p.meta, n = m.rows;
  if (m.kind !== 'chars') throw new Error('not a character pack');
  const fields = Object.fromEntries(m.fields.map((f, i) => [f, p.strings(3 + i * 2, n)]));
  return { meta: m, cps: p.u32(1), strokes: p.u8(2), fields };
}

// A syllable's rank range: exact ("hao") or every syllable starting with an unfinished one ("h").
function rankRange(pack, syl, partial) {
  if (!partial) { const r = pack.rankOf.get(syl); return r == null ? null : [r, r]; }
  let lo = -1, hi = -1;
  pack.sorted.forEach((s, i) => { if (s.startsWith(syl)) { if (lo < 0) lo = i; hi = i; } });
  return lo < 0 ? null : [lo, hi];
}

// The input as syllables, in up to 4 ways ("xian" → xian | xi'an), each syllable with its rank range,
// tone and the input length it ends at. rest: trailing letters that fit no syllable.
export function parseInput(pack, input) {
  const chunks = [...String(input).matchAll(/[^0-5'\s]+[0-5]?|['\s]+/g)];
  let ways = [{ syls: [], penalty: 0 }], rest = '';
  for (let k = 0; k < chunks.length; k++) {
    const c = chunks[k], text = c[0];
    if (/^['\s]+$/.test(text)) { for (const w of ways) if (w.syls.length) w.syls.at(-1).end = c.index + text.length; continue; }
    const m = /^(.*?)([0-5])?$/.exec(text), letters = m[1].toLowerCase(), tone = m[2] == null ? null : +m[2] || 5;
    const last = !chunks.slice(k + 1).some(c => !/^['\s]+$/.test(c[0]));
    // Letters that fit no syllable end the parse: the longest start that fits is used, the rest kept.
    let cut = letters.length, splits = segment(letters, { partial: last && tone == null, limit: 4 });
    while (!splits && --cut > 0) splits = segment(letters.slice(0, cut), { partial: false, limit: 4 });
    const whole = cut === letters.length, end = whole ? c.index + text.length : c.index + cut;
    const parsed = splits?.map(parts => {
      let at = c.index;
      const syls = parts.map((p, i) => {
        const s = p.toLowerCase(), partial = !SYLLABLES.has(s), range = rankRange(pack, s, partial);
        at += p.length;
        return range && { syl: s, range, partial, tone: i === parts.length - 1 && whole ? tone : null, end: i === parts.length - 1 ? end : at };
      });
      return syls.every(Boolean) ? syls : null;
    }).filter(Boolean);
    if (!parsed?.length) { rest = input.slice(c.index); break; }
    if (!whole) rest = input.slice(end);
    const next = [];
    for (const w of ways) parsed.forEach((syls, i) => next.push({ syls: [...w.syls, ...syls], penalty: w.penalty + i }));
    ways = next.sort((a, b) => a.penalty - b.penalty).slice(0, 4);
    if (rest) break;
  }
  return { ways: ways.filter(w => w.syls.length), rest };
}

export function createEngine({ ime, chars = null }) {
  const pack = ime.meta ? ime : decodeIme(ime);
  let charPack = chars && (chars.meta ? chars : decodeChars(chars));
  let extras = [], extraBuckets = new Map(), levelOverride = new Map(), user = new Map(), userWords = [];
  let formMap = null, reverse = null;

  const lfOf = (r, script) => (script === 't' ? pack.ft : pack.fs)[r] / pack.scale;
  const rowSyls = r => { const out = []; for (let i = pack.keyStart[r]; i < pack.keyStart[r + 1]; i++) out.push(pack.keys[i]); return out; };
  const pinyinOf = keys => keys.map(k => markTone(pack.names[k >> 3], (k & 7) === 5 ? 0 : k & 7)).join(' ');
  const tonelessKey = keys => keys.map(k => pack.names[k >> 3]).join("'");
  const rowView = r => {
    const keys = rowSyls(r), simp = pack.simp.get(r);
    return { row: r, simp, trad: pack.trad.get(r) || simp, keys, lfS: lfOf(r, 's'), lfT: lfOf(r, 't'), level: levelOverride.get(r) ?? pack.level[r], gloss: pack.gloss.get(r), flags: pack.flags[r] };
  };
  const lfView = (v, script) => script === 't' ? v.lfT : v.lfS;

  // Rows (and extras) whose first syllables match the given ranges/tones exactly in count `len`.
  function matches(seq, len, visit) {
    const first = seq[0];
    let a = pack.index[first.range[0]], b = pack.index[first.range[1] + 1];
    for (let i = 1; i < seq.length && a < b; i++) {
      const [lo, hi] = seq[i].range;
      const v = r => pack.nsyl[r] > i ? pack.rankById[pack.keys[pack.keyStart[r] + i] >> 3] : -1;
      a = bound(a, b, r => v(r) >= lo); b = bound(a, b, r => v(r) > hi);
    }
    const exact = seq.every(s => s.range[0] === s.range[1]);
    for (let r = a; r < b; r++) {
      if (pack.nsyl[r] !== len) { if (exact && pack.nsyl[r] > len) break; continue; }
      let ok = true;
      for (let i = 0; i < len && ok; i++) { const t = seq[i].tone; if (t != null && (pack.keys[pack.keyStart[r] + i] & 7) !== t) ok = false; }
      if (ok) visit(rowView(r));
    }
    for (let k = first.range[0]; k <= first.range[1]; k++) for (const x of extraBuckets.get(k) || []) {
      if (x.keys.length !== len) continue;
      if (x.keys.every((key, i) => { const rk = pack.rankById[key >> 3]; return rk >= seq[i].range[0] && rk <= seq[i].range[1] && (seq[i].tone == null || (key & 7) === seq[i].tone); })) visit(x);
    }
  }
  function bound(a, b, test) { while (a < b) { const m = (a + b) >> 1; if (test(m)) b = m; else a = m + 1; } return a; }

  const display = (v, script) => script === 't' ? v.trad : v.simp;
  function userBoost(v, script, now) {
    const u = user.get(`${script}:${tonelessKey(v.keys)}:${display(v, script)}`);
    if (!u) return 0;
    const eff = u.count * Math.pow(0.5, Math.max(0, now - (u.last || now)) / HALF_LIFE);
    return W_USER * Math.log2(1 + eff);
  }
  const item = (v, script, consumed, extra = {}) => ({ text: display(v, script), pinyin: pinyinOf(v.keys), consumed, level: v.level || 0, gloss: v.gloss || '', sentence: false, ...extra });

  // Best word for syllables i..j of one way (for the sentence).
  function viterbi(syls, script, now) {
    const n = syls.length, best = Array(n + 1).fill(null);
    best[0] = { cost: 0, words: [] };
    const total = pack.logTotal[script === 't' ? 't' : 's'];
    for (let i = 0; i < n; i++) {
      if (!best[i]) continue;
      for (let j = i + 1; j <= Math.min(n, i + MAX_WORD); j++) {
        let top = null, topScore = -Infinity;
        matches(syls.slice(i, j), j - i, v => { const s = lfView(v, script) + userBoost(v, script, now); if (s > topScore) { top = v; topScore = s; } });
        if (!top) continue;
        const cost = best[i].cost + total - topScore + WORD_PENALTY;
        if (!best[j] || cost < best[j].cost) best[j] = { cost, words: [...best[i].words, top] };
      }
    }
    return best[n];
  }

  function candidates(input, { script = 's', limit = 60, now = Date.now() } = {}) {
    script = sc(script);
    const { ways, rest } = parseInput(pack, input);
    if (!ways.length) return { reading: '', rest: String(input), items: [] };
    // One item per written form and coverage: the best-scoring reading of it (的 de5 over di1).
    const found = new Map();
    ways.forEach((way, wi) => {
      for (let k = way.syls.length; k >= 1; k--) {
        const consumed = way.syls[k - 1].end;
        matches(way.syls.slice(0, k), k, v => {
          const score = lfView(v, script) + userBoost(v, script, now) - wi * W_SPLIT;
          const it = item(v, script, consumed), key = it.text + '\t' + consumed;
          const old = found.get(key);
          if (!old || old.score < score) found.set(key, { ...it, score, level: Math.max(it.level, old?.level || 0) });
        });
      }
    });
    let items = [...found.values()].sort((a, b) => b.consumed - a.consumed || b.score - a.score);
    // The sentence: the cheapest path over the whole input (any way of splitting it), shown
    // when it has several words.
    let best = null;
    ways.forEach((way, wi) => {
      const path = viterbi(way.syls, script, now);
      if (path && (!best || path.cost + wi * W_SPLIT < best.cost)) best = { cost: path.cost + wi * W_SPLIT, words: path.words, end: way.syls.at(-1).end };
    });
    if (best?.words.length > 1) {
      const text = best.words.map(v => display(v, script)).join('');
      items = items.filter(it => !(it.text === text && it.consumed === best.end));
      items.unshift({ text, pinyin: best.words.map(v => pinyinOf(v.keys)).join(' '), consumed: best.end, level: Math.max(...best.words.map(v => v.level || 0)), gloss: '', sentence: true });
    }
    const first = ways[0].syls;
    return {
      reading: first.map(s => markTone(s.syl, s.tone === 5 ? 0 : s.tone)).join(' '), rest,
      items: items.slice(0, limit).map(({ score, ...it }) => it),
    };
  }

  // Written form → best entry per script (for annotate) and all entries (for lookup).
  function forms() {
    if (formMap) return formMap;
    formMap = new Map();
    const add = (form, v) => { if (!formMap.has(form)) formMap.set(form, []); formMap.get(form).push(v); };
    for (let r = 0; r < pack.rows; r++) { const s = pack.simp.get(r), t = pack.trad.get(r); add(s, r); if (t) add(t, r); }
    for (const x of extras) { add(x.simp, x); if (x.trad !== x.simp) add(x.trad, x); }
    return formMap;
  }
  const view = v => typeof v === 'number' ? rowView(v) : v;
  function bestOf(form, script) {
    let best = null;
    for (const v of forms().get(form) || []) {
      const x = view(v), own = script === 't' ? x.trad === form : x.simp === form;
      const s = lfView(x, script) + (own ? 0.5 : 0) - (x.flags & 1 ? 4 : 0);
      if (!best || s > best.s) best = { s, x };
    }
    return best?.x || null;
  }

  // Han runs → words, each with the reading of its most frequent entry (no tone sandhi).
  function annotate(text, { script = 's' } = {}) {
    script = sc(script);
    const out = [], total = pack.logTotal[script === 't' ? 't' : 's'];
    for (const m of String(text).matchAll(HAN_RUN)) {
      const run = [...m[0]], at = [];
      let pos = m.index;
      for (const ch of run) { at.push(pos); pos += ch.length; }
      at.push(pos);
      const best = Array(run.length + 1).fill(null);
      best[0] = { cost: 0, words: [] };
      for (let i = 0; i < run.length; i++) {
        if (!best[i]) continue;
        for (let j = i + 1; j <= Math.min(run.length, i + MAX_WORD); j++) {
          const v = bestOf(run.slice(i, j).join(''), script);
          if (!v && j > i + 1) continue;
          const cost = best[i].cost + (v ? total - lfView(v, script) + WORD_PENALTY : UNKNOWN_COST);
          if (!best[j] || cost < best[j].cost) best[j] = { cost, words: [...best[i].words, { i, j, v }] };
        }
      }
      for (const { i, j, v } of best[run.length].words)
        out.push({ start: at[i], end: at[j], text: run.slice(i, j).join(''), pinyin: v ? v.keys.map(k => markTone(pack.names[k >> 3], (k & 7) === 5 ? 0 : k & 7)) : [''], level: v?.level || 0 });
    }
    return out;
  }

  function charInfo(ch) {
    if (!charPack) return null;
    const cp = ch.codePointAt(0), { cps, fields } = charPack;
    const r = bound(0, cps.length, i => cps[i] >= cp);
    if (cps[r] !== cp) return null;
    const f = name => fields[name].get(r);
    const [rad, residual] = f('radical').split('.');
    const number = parseInt(rad);
    const [type, hint, phonetic, semantic] = f('etymology').split('|');
    return {
      char: ch,
      readings: f('readings').split(' ').filter(Boolean).map(x => { const [pinyin, n] = x.split(':'); return { pinyin, count: n ? +n : 0 }; }),
      strokes: charPack.strokes[r] || 0,
      radical: number ? { number, char: String.fromCodePoint(0x2f00 + number - 1).normalize('NFKC'), residual: +residual || 0, simplified: rad.includes("'") } : null,
      definition: f('definition'),
      variants: { simp: f('simplified'), trad: f('traditional'), other: f('variants') },
      decomposition: f('decomposition'),
      etymology: type ? { type, hint, phonetic, semantic } : null,
    };
  }

  // Character → rows of multi-character words containing it, built on first use.
  function wordsWith(text, script, max = 30) {
    if (!reverse) {
      reverse = new Map();
      const add = (ch, v) => { if (!reverse.has(ch)) reverse.set(ch, []); reverse.get(ch).push(v); };
      for (let r = 0; r < pack.rows; r++) if (pack.nsyl[r] > 1) { const s = pack.simp.get(r), t = pack.trad.get(r) || s; for (const ch of new Set([...s, ...t])) add(ch, r); }
      for (const x of extras) if (x.keys.length > 1) for (const ch of new Set([...x.simp, ...x.trad])) add(ch, x);
    }
    const seen = new Set(), out = [];
    for (const v of (reverse.get([...text][0]) || []).map(view)) {
      if (!(v.simp.includes(text) || v.trad.includes(text)) || v.simp === text || v.trad === text) continue;
      const shown = display(v, script);
      if (seen.has(shown)) continue;
      seen.add(shown); out.push(v);
    }
    return out.sort((a, b) => lfView(b, script) - lfView(a, script)).slice(0, max)
      .map(v => ({ text: display(v, script), pinyin: pinyinOf(v.keys), gloss: v.gloss, level: v.level || 0 }));
  }

  function lookup(text, { script = 's' } = {}) {
    script = sc(script);
    text = String(text).trim();
    const entries = (forms().get(text) || []).map(view).sort((a, b) => lfView(b, script) - lfView(a, script))
      .map(v => ({ simp: v.simp, trad: v.trad, pinyin: pinyinOf(v.keys), gloss: v.gloss ? [v.gloss] : [], level: v.level || 0 }));
    const out = { entries, words: text ? wordsWith(text, script) : [] };
    if ([...text].length === 1 && isHan(text)) out.char = charInfo(text);
    return out;
  }

  // Extra words: installed HSK expansions and the user's own words.
  // rows: [{simp, trad, n: "ni3 hao3", gloss, level, user?}]
  function keysOf(n) {
    const keys = [];
    for (const s of String(n).toLowerCase().replace(/u:|v/g, 'ü').trim().split(/\s+/)) {
      const m = /^([a-zü]+)([1-5])?$/.exec(s), id = m ? pack.names.indexOf(m[1]) : -1;
      if (id < 0) return null;
      keys.push(id << 3 | (m[2] ? +m[2] : 5));
    }
    return keys;
  }
  function setExtras(rows) {
    extras = []; levelOverride = new Map(); formMap = null; reverse = null;
    const index = new Map();
    for (let r = 0; r < pack.rows; r++) { const k = pack.simp.get(r); if (!index.has(k)) index.set(k, []); index.get(k).push(r); }
    for (const row of [...rows, ...userWords]) {
      const keys = keysOf(row.n);
      if (!keys || [...row.simp].length !== keys.length) continue;
      const own = index.get(row.simp) || [];
      const same = own.find(r => rowSyls(r).every((k, i) => k === keys[i]));
      if (row.level && own.length) {
        const r = same ?? own.reduce((a, b) => pack.fs[b] > pack.fs[a] ? b : a);
        const old = levelOverride.get(r) ?? pack.level[r];
        if (!old || old > row.level) levelOverride.set(r, row.level);
      }
      if (same != null || (own.length && !row.user)) continue;
      extras.push({ simp: row.simp, trad: row.trad || row.simp, keys, lfS: row.user ? 8 : 3, lfT: row.user ? 8 : 3, level: row.level || 0, gloss: (row.gloss || '').slice(0, 80), flags: 0, user: !!row.user });
    }
    extraBuckets = new Map();
    for (const x of extras) { const k = pack.rankById[x.keys[0] >> 3]; if (!extraBuckets.has(k)) extraBuckets.set(k, []); extraBuckets.get(k).push(x); }
  }
  let expansionRows = [], storedWords = [];
  // A sequence chosen twice that the dictionary lacks as one word becomes one (§4.6): chosen rows
  // with `word` (its numbered pinyin) and count ≥ 2.
  function refreshUser() {
    userWords = [...storedWords, ...[...user.values()].filter(c => c.word && c.count >= 2).map(c => { const h = c.key.split(':')[2]; return { simp: h, trad: h, n: c.word, user: true }; })];
    setExtras(expansionRows);
  }
  return {
    pack, candidates, annotate, lookup, charInfo, parseInput: input => parseInput(pack, input),
    hasChars: () => !!charPack, setChars(bytes) { charPack = bytes.meta ? bytes : decodeChars(bytes); },
    // rows: [{simp, trad, n: "ni3 hao3", gloss, level}] of the installed HSK expansions.
    setExpansions(rows) { expansionRows = rows; setExtras(expansionRows); },
    // chosen: [{key: "s:ni'hao:你好", count, last, word?}], words: [{hanzi, pinyin: "xiao3 ming2"}]
    setUser({ chosen = [], words = [] } = {}) {
      user = new Map(chosen.map(c => [c.key, c]));
      storedWords = words.map(w => ({ simp: w.hanzi, trad: w.hanzi, n: w.pinyin, user: true }));
      refreshUser();
    },
    learn(row) {
      const had = user.get(row.key);
      user.set(row.key, row);
      if (row.word && row.count >= 2 && !(had?.count >= 2)) refreshUser();
    },
  };
}
