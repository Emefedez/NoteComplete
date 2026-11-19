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

// A syllable (any case, v / u: allowed) followed by a tone digit: "ni3 hao3, Zhong1guo2" → "nǐ hǎo, Zhōngguó".
export function numbersToMarks(text) {
  return String(text).replace(/([A-Za-zÜüÊê:]+)([0-5])/g, (all, letters, d) => {
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
  const chunks = String(buffer ?? '').match(/[^0-5']+[0-5]?|'/g) || [];
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
