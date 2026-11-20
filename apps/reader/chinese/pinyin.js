// Pinyin rules: syllables, normalisation, tone marks, segmentation (docs/CHINESE-INPUT.md §4.2).
// Pure: main thread, module worker and Node. ü is always written "ü" (never v or u:).

// Stable order: a syllable's id is its index here. Packs store these ids; only append, never reorder.
export const SYLLABLE_LIST = Object.freeze((
  'a o e ê ai ei ao ou an en ang eng er ' +
  'ba bo bai bei bao ban ben bang beng bi bie biao bian bin bing bu ' +
  'pa po pai pei pao pou pan pen pang peng pi pie piao pian pin ping pu ' +
  'ma mo me mai mei mao mou man men mang meng mi mie miao miu mian min ming mu ' +
  'fa fo fei fou fan fen fang feng fu ' +
  'da de dai dei dao dou dan den dang deng dong di dia die diao diu dian ding du duo dui duan dun ' +
  'ta te tai tei tao tou tan tang teng tong ti tie tiao tian ting tu tuo tui tuan tun ' +
  'na ne nai nei nao nou nan nen nang neng nong ni nie niao niu nian nin niang ning nu nuo nuan nun nü nüe ' +
  'la le lo lai lei lao lou lan lang leng long li lia lie liao liu lian lin liang ling lu luo luan lun lü lüe ' +
  'ga ge gai gei gao gou gan gen gang geng gong gu gua guo guai gui guan gun guang ' +
  'ka ke kai kei kao kou kan ken kang keng kong ku kua kuo kuai kui kuan kun kuang ' +
  'ha he hai hei hao hou han hen hang heng hong hu hua huo huai hui huan hun huang ' +
  'ji jia jie jiao jiu jian jin jiang jing jiong ju jue juan jun ' +
  'qi qia qie qiao qiu qian qin qiang qing qiong qu que quan qun ' +
  'xi xia xie xiao xiu xian xin xiang xing xiong xu xue xuan xun ' +
  'zha zhe zhi zhai zhei zhao zhou zhan zhen zhang zheng zhong zhu zhua zhuo zhuai zhui zhuan zhun zhuang ' +
  'cha che chi chai chao chou chan chen chang cheng chong chu chua chuo chuai chui chuan chun chuang ' +
  'sha she shi shai shei shao shou shan shen shang sheng shu shua shuo shuai shui shuan shun shuang ' +
  're ri rao rou ran ren rang reng rong ru rua ruo rui ruan run ' +
  'za ze zi zai zei zao zou zan zen zang zeng zong zu zuo zui zuan zun ' +
  'ca ce ci cai cao cou can cen cang ceng cong cu cuo cui cuan cun ' +
  'sa se si sai sao sou san sen sang seng song su suo sui suan sun ' +
  'ya yo ye yao you yan yin yang ying yong yi yu yue yuan yun ' +
  'wa wo wai wei wan wen wang weng wu ' +
  'm n ng hm hng r yai cei sei kiu biang'
).split(' '));
export const SYLLABLES = new Set(SYLLABLE_LIST);
// Syllables almost never meant when a split is ambiguous (interjections, erhua, rare readings).
const RARE = new Set(['m', 'n', 'ng', 'hm', 'hng', 'r', 'ê', 'yai', 'cei', 'sei', 'kiu', 'biang', 'o', 'e', 'lo', 'yo', 'den', 'nun', 'tei', 'pou']);
const PREFIXES = new Set(SYLLABLE_LIST.flatMap(s => [...s].map((_, i) => s.slice(0, i + 1))));
const MARKS = ['', '̄', '́', '̌', '̀', ''];
const TONE_OF = { '̄': 1, '́': 2, '̌': 3, '̀': 4 };
const VOWELS = 'aeiouüê';

// "Lv3" → "lü3", "u:" / "v" → ü, ü after j q x y written u, NFC, lower case, marks → numbers.
export function normalise(raw) { return normaliseInfo(raw).text; }
export function normaliseInfo(raw) {
  const s = String(raw ?? '').normalize('NFC');
  const capital = /^\p{Lu}/u.test(s);
  return { text: fixU(marksToNumbers(s).toLowerCase()), capital };
}
function fixU(s) {
  return s.replace(/u:|v/g, 'ü').replace(/U:|V/g, 'Ü').replace(/([jqxyJQXY])([üÜ])/g, (_, c, u) => c + (u === 'ü' ? 'u' : 'U'));
}

// ("hao", 3) → "hǎo"; tone 5/0/null → unmarked; keeps an initial capital.
export function markTone(syl, tone) {
  const s = fixU(String(syl).normalize('NFC'));
  const t = Number(tone);
  if (!(t >= 1 && t <= 4)) return s;
  const low = s.toLowerCase();
  let i = low.search(/[aeê]/);
  if (i < 0 && low.includes('ou')) i = low.indexOf('o');
  if (i < 0) for (let k = low.length - 1; k >= 0; k--) if (VOWELS.includes(low[k])) { i = k; break; }
  if (i < 0) i = low.search(/[mn]/); // m, n, ng, hm, hng
  if (i < 0) return s;
  return (s.slice(0, i + 1) + MARKS[t] + s.slice(i + 1)).normalize('NFC');
}

// Move mid-syllable tone digits to the end of their syllable: "zho1ngwén" → "zhong1wen2",
// "zhongwe2n" → "zhongwen2", "zho1ngwe2n" → "zhong1wen2", "zh1ong" → "zhong1", "ha3o" → "hao3",
// while keeping "ni3hao" and "ma1ne" intact.
export function normalizeToneDigits(text) {
  const s = marksToNumbers(String(text ?? '').normalize('NFC'));
  // Tokenize into alternating runs of letters, digits, and separators so adjacent digits never mask each other.
  const toks = s.match(/[A-Za-zÜüÊê:]+|[0-5]|[^A-Za-zÜüÊê:0-5]+/g);
  if (!toks || toks.length < 3) return s;
  const isWord = (t) => /^[A-Za-zÜüÊê:]+$/.test(t);
  const isDigit = (t) => /^[0-5]$/.test(t);
  for (let i = 1; i < toks.length - 1; i++) {
    if (!isDigit(toks[i]) || !isWord(toks[i - 1]) || !isWord(toks[i + 1])) continue;
    const left = toks[i - 1], right = toks[i + 1];
    const leftSeg = segment(left, { partial: false, limit: 1 });
    const leftOk = Boolean(leftSeg);
    const rightSeg = segment(right, { partial: true, limit: 1 });
    const rightStartsRare = !rightSeg || RARE.has(rightSeg[0][0].toLowerCase());
    // Find the shortest coda completing the syllable before the digit (preferring "ng" over "n" when valid).
    let pick = 0;
    const maxTake = Math.min(5, right.length);
    for (let take = 1; take <= maxTake; take++) {
      const coda = right.slice(0, take), codaLow = fixU(coda).toLowerCase();
      const rest = right.slice(take);
      if (leftOk && codaLow !== 'ng' && !rightStartsRare) continue;
      // Ensure `coda` completes ONE syllable (not a second whole syllable): check tail of left + coda.
      const combined = segment(left + coda, { partial: false, limit: 1 });
      if (!combined) continue;
      if (leftSeg && combined[0].length > leftSeg[0].length) continue;
      // If `rest` is non-empty and the next token isn't a mid-syllable digit of `rest`, check `rest` can start a syllable.
      const nextIsDigit = i + 2 < toks.length && isDigit(toks[i + 2]);
      if (rest && !nextIsDigit && !segment(rest, { partial: true, limit: 1 })) continue;
      pick = take;
      // If `coda` ended in "n" and next char is "g" forming "-ng" (e.g. "zho1ng"), extend to "ng".
      if (codaLow.endsWith('n') && right[take]?.toLowerCase() === 'g') {
        const ngCombined = segment(left + right.slice(0, take + 1), { partial: false, limit: 1 });
        const ngRest = right.slice(take + 1);
        if (ngCombined && (!leftSeg || ngCombined[0].length <= leftSeg[0].length)
          && (!ngRest || nextIsDigit || segment(ngRest, { partial: true, limit: 1 }))) {
          pick = take + 1;
        }
      }
      break;
    }
    if (pick > 0) {
      toks[i - 1] = left + right.slice(0, pick);
      toks[i + 1] = right.slice(pick);
    }
  }
  return toks.join('');
}

// Fast edit-distance <= 1 check (returns 'transpose' | 'sub' | 'insdel' | false).
function editDist1(a, b) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    if (i === la) return false;
    // Substitution
    if (a.slice(i + 1) === b.slice(i + 1)) return 'sub';
    // Adjacent transposition
    return (i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)) ? 'transpose' : false;
  }
  const [short, long] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0, diff = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; }
    else { if (diff) return false; diff = true; j++; }
  }
  return 'insdel';
}

const SYL_BY_LEN = new Map();
for (const s of SYLLABLE_LIST) {
  if (RARE.has(s)) continue;
  const arr = SYL_BY_LEN.get(s.length) || [];
  arr.push(s);
  SYL_BY_LEN.set(s.length, arr);
}
const FUZZY_CACHE = new Map();
function nearSyllables(piece) {
  let hit = FUZZY_CACHE.get(piece);
  if (hit) return hit;
  const out = [];
  const len = piece.length;
  if (len >= 2 && len <= 7) {
    for (let l = Math.max(1, len - 1); l <= Math.min(6, len + 1); l++) {
      for (const cand of SYL_BY_LEN.get(l) || []) {
        const kind = editDist1(piece, cand);
        if (!kind) continue;
        // Prefer transpositions (xei→xie, hoa→hao, zhnog→zhong), missing g in -on→-ong, or same initial.
        let bonus = 0;
        if (kind === 'transpose') bonus = -6;
        else if (piece + 'g' === cand) bonus = -5;
        else if (cand[0] === piece[0] && cand.at(-1) === piece.at(-1)) bonus = -3;
        else if (cand[0] === piece[0]) bonus = -2;
        out.push({ syl: cand, extra: 18 + bonus });
      }
    }
  }
  out.sort((a, b) => a.extra - b.extra || a.syl.localeCompare(b.syl));
  hit = out.slice(0, 6);
  if (FUZZY_CACHE.size > 500) FUZZY_CACHE.clear();
  FUZZY_CACHE.set(piece, hit);
  return hit;
}

// Typo-tolerant segmentation: finds up to `limit` valid syllable sequences within `maxEdits`
// single-character typos (e.g. "zhonwen" → [["zhong","wen"]], "nihoa" → [["ni","hao"]]).
export function fuzzySegment(letters, { limit = 4, maxEdits = 2 } = {}) {
  const src = fixU(String(letters ?? '').normalize('NFC'));
  const low = src.toLowerCase();
  if (!low || low.length > 24 || /[^a-zü']/.test(low)) return null;
  const n = low.length;
  const best = Array.from({ length: n + 1 }, () => []);
  best[0] = [{ parts: [], cost: 0, edits: 0 }];
  const keep = (list, item) => {
    const key = item.parts.join("'");
    const idx = list.findIndex((x) => x.parts.join("'") === key);
    if (idx >= 0) { if (item.cost < list[idx].cost) list[idx] = item; else return; }
    else list.push(item);
    list.sort((a, b) => a.cost - b.cost || a.edits - b.edits);
    if (list.length > 8) list.length = 8;
  };
  for (let i = 0; i < n; i++) {
    if (!best[i].length) continue;
    if (low[i] === "'") {
      for (const b of best[i]) keep(best[i + 1], { ...b, apos: true });
      continue;
    }
    for (let j = i + 1; j <= Math.min(n, i + 7); j++) {
      const piece = low.slice(i, j);
      if (piece.includes("'")) break;
      if (SYLLABLES.has(piece)) {
        for (const b of best[i]) {
          let cost = b.cost + 10 + (RARE.has(piece) ? 25 : 0);
          if (b.parts.length && !b.apos && /^[aeoê]/.test(piece)) cost += 12;
          keep(best[j], { parts: [...b.parts, piece], cost, edits: b.edits });
        }
      } else if (piece.length >= 2) {
        const nears = nearSyllables(piece);
        for (const { syl, extra } of nears) {
          for (const b of best[i]) {
            if (b.edits >= maxEdits) continue;
            let cost = b.cost + 10 + extra;
            if (b.parts.length && !b.apos && /^[aeoê]/.test(syl)) cost += 12;
            keep(best[j], { parts: [...b.parts, syl], cost, edits: b.edits + 1 });
          }
        }
      }
    }
  }
  const out = best[n].filter((b) => b.parts.length && b.edits > 0);
  return out.length ? out.slice(0, limit).map((b) => b.parts) : null;
}

// A syllable (any case, v / u: allowed) followed by a tone digit: "ni3 hao3, Zhong1guo2" → "nǐ hǎo, Zhōngguó".
export function numbersToMarks(text) {
  return normalizeToneDigits(text).replace(/([A-Za-zÜüÊê:]+)([0-5])/g, (all, letters, d) => {
    const n = fixU(letters).toLowerCase();
    if (SYLLABLES.has(n)) return markTone(letters, +d);
    const split = segment(letters, { partial: false });
    if (!split) return all;
    const parts = split[0], last = parts.pop();
    return parts.join('') + markTone(last, +d);
  });
}

// "nǐ hǎo" → "ni3 hao3"; "Zhōngguó" → "Zhong1guo2". Only words with tone marks change; neutral syllables get no digit.
export function marksToNumbers(text) {
  return String(text).normalize('NFC').replace(/[\p{L}̀-ͯ]+/gu, word => {
    const d = word.normalize('NFD');
    if (!/[̀́̄̌]/.test(d)) return word;
    let base = '', tones = [];
    for (const ch of d) {
      if (TONE_OF[ch]) tones[base.length - 1] = TONE_OF[ch];
      else base += ch;
    }
    // Recompose ü / ê while keeping tone positions: map index by index.
    let nfc = '', at = [];
    for (let k = 0; k < base.length; k++) {
      const ch = base[k];
      if (/[̀-ͯ]/.test(ch)) { nfc = (nfc + ch).normalize('NFC'); if (tones[k]) at[nfc.length - 1] = tones[k]; continue; }
      nfc += ch; if (tones[k]) at[nfc.length - 1] = tones[k];
    }
    const splits = segment(nfc, { partial: false, limit: 16 }) || [];
    for (const parts of splits) {
      let out = '', pos = 0, ok = true;
      for (const p of parts) {
        const ts = [];
        for (let k = pos; k < pos + p.length; k++) if (at[k]) ts.push(at[k]);
        if (ts.length > 1) { ok = false; break; }
        out += p + (ts[0] || '');
        pos += p.length;
      }
      if (ok) return out;
    }
    const t = at.find(Boolean);
    return nfc + (t || '');
  });
}

// Continuous pinyin → ranked splits, e.g. "xian" → [["xian"], ["xi","an"]]. "'" is a hard boundary.
// partial: the last part may be the start of a syllable ("zh", "xia" for xiang). Returns null when nothing fits.
export function segment(letters, { partial = true, limit = 8 } = {}) {
  const src = fixU(String(letters ?? '').normalize('NFC'));
  const low = src.toLowerCase();
  if (!low || /[^a-zü']/.test(low)) return null;
  const n = low.length;
  // best[i]: up to `limit` splits of low[0..i) as {parts, cost, cut}; cut = index where the last part starts.
  const best = Array.from({ length: n + 1 }, () => []);
  best[0] = [{ parts: [], cost: 0 }];
  for (let i = 0; i < n; i++) {
    if (!best[i].length) continue;
    if (low[i] === "'") { // a boundary: carry over, marking that the next part was separated by the user
      for (const b of best[i]) push(best[i + 1], { parts: b.parts, cost: b.cost, apos: true }, limit);
      continue;
    }
    for (let j = i + 1; j <= Math.min(n, i + 6); j++) {
      const piece = low.slice(i, j);
      if (piece.includes("'")) break;
      const whole = SYLLABLES.has(piece), pre = !whole && partial && j === n && PREFIXES.has(piece);
      if (!whole && !pre) continue;
      for (const b of best[i]) {
        let cost = b.cost + 10;
        if (RARE.has(piece)) cost += 25;
        if (pre) cost += 3;
        // A vowel-initial syllable right after another syllable needs an apostrophe (xi'an, fang'an).
        if (b.parts.length && !b.apos && /^[aeoê]/.test(piece)) cost += 12;
        push(best[j], { parts: [...b.parts, src.slice(i, j)], cost }, limit);
      }
    }
  }
  const out = best[n].filter(b => b.parts.length);
  return out.length ? out.map(b => b.parts) : null;
}
function push(list, item, limit) {
  list.push(item);
  list.sort((a, b) => a.cost - b.cost || b.parts.at(-1).length - a.parts.at(-1).length);
  if (list.length > limit) list.length = limit;
}

// The IME buffer → syllables with tones: "ni3hao" → [{syl:"ni", tone:3}, {syl:"hao", tone:null}].
// A part that is only the start of a syllable gets partial:true; letters that fit nothing get invalid:true.
export function splitInput(buffer) {
  const out = [];
  const norm = normalizeToneDigits(buffer);
  const chunks = norm.match(/[^0-5']+[0-5]?|'/g) || [];
  chunks.forEach((chunk, k) => {
    if (chunk === "'") return;
    const m = /^(.*?)([0-5])?$/.exec(chunk);
    const letters = m[1], tone = m[2] == null ? null : +m[2];
    const lastChunk = k === chunks.length - 1;
    const split = segment(letters, { partial: lastChunk && tone == null, limit: 1 });
    if (!split) { out.push({ syl: fixU(letters).toLowerCase(), tone, invalid: true }); return; }
    split[0].forEach((p, i) => {
      const syl = p.toLowerCase(), last = i === split[0].length - 1;
      const item = { syl, tone: last ? tone : null };
      if (!SYLLABLES.has(syl)) item.partial = true;
      out.push(item);
    });
  });
  return out;
}

// The reading shown while typing: "ni3hao" → "nǐ hao".
export function readingOf(buffer) {
  return splitInput(buffer).map(s => markTone(s.syl, s.tone)).join(' ');
}
// Does this text contain pinyin with tone marks (for Enter = "Auto")?
export const hasMarkedPinyin = text => /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(String(text).normalize('NFC'));
