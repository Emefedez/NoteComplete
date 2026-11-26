// One search over every text source of a note. Units are added per page and
// source; each word may carry a box (page units) or a time (seconds).
//   text   typed text boxes         pdf    PDF text layer
//   ocr    on-demand recognition    audio  Whisper transcripts
export const SOURCES = ['text', 'pdf', 'ocr', 'audio'];
// Recognised text has errors, so it also accepts one edit on longer words.
const FUZZY = new Set(['ocr', 'audio']);

// Case- and accent-insensitive: "Memória" and "memoria" are the same word.
export function normalize(text) {
  return unaccent(text).toLowerCase();
}
// Accents dropped, case kept (Match case).
const unaccent = (text) => String(text).normalize('NFD').replace(/\p{M}+/gu, '');
// Chinese and Japanese are written without spaces between words, so each of their
// characters is a word of its own: a query of several characters then matches them in a
// row, wherever OCR or the PDF happened to break the line into "words".
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;
const pieces = token => (CJK.test(token) ? token.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) : [token]);
export function words(text) {
  return (normalize(text).match(/[\p{L}\p{N}]+/gu) || []).flatMap(pieces);
}

// True when a and b differ by at most one insertion, deletion or substitution.
export function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// 3 exact, 2 prefix, 1 fuzzy, 0 no match. A single letter or digit ("n" in a formula) is a
// whole word, never the start of every word that begins with it.
export function matchWord(query, word, fuzzy, whole = false) {
  if (word === query) return 3;
  if (whole || query.length < 2) return 0;
  if (word.startsWith(query)) return 2;
  if (fuzzy && query.length >= 5 && (withinOneEdit(query, word) || (word.length > query.length && withinOneEdit(query, word.slice(0, query.length))))) return 1;
  return 0;
}

// A word may carry other readings of the same spot (`alts`, from a second OCR pass).
// `o`: { matchCase, wholeWord } (the Find bar's Aa and ab).
const wordScore = (term, word, fuzzy, o = {}) => {
  const key = o.matchCase ? 'normCase' : 'norm', alts = o.matchCase ? 'altCase' : 'altNorms';
  return Math.max(matchWord(term, word[key], fuzzy && !o.wholeWord, o.wholeWord), ...(word[alts] || []).map(a => matchWord(term, a, fuzzy && !o.wholeWord, o.wholeWord)));
};
const strip = text => text.replace(/[^\p{L}\p{N}]+/gu, '');
const clean = text => strip(normalize(text));
const cleanCase = text => strip(unaccent(text));

// The query's terms. A token written without spaces that has signs inside, like a formula
// ("B(n,p)", "P(X≤3)", "x-ray"), is one term of its letters and digits, not its letters
// apart (which matched nearly every page); Chinese stays a character per term.
export function queryTerms(query, { matchCase = false } = {}) {
  const form = matchCase ? unaccent : normalize;
  return String(query).trim().split(/\s+/).filter(Boolean).flatMap((token) => {
    const parts = form(token).match(/[\p{L}\p{N}]+/gu) || [];
    if (parts.length > 1 && !CJK.test(token)) return [parts.join('')];
    return parts.flatMap(pieces);
  });
}

// A regular expression (the Find bar's .*), or null with the reason when it does not compile.
export function findPattern(query, { matchCase = false, wholeWord = false } = {}) {
  try {
    const body = wholeWord ? `(?<![\\p{L}\\p{N}])(?:${query})(?![\\p{L}\\p{N}])` : query;
    return { pattern: new RegExp(body, matchCase ? 'gu' : 'giu') };
  } catch (error) {
    return { error: error.message };
  }
}

// A word with Chinese or Japanese characters becomes one word per character (and per run
// of other letters), sharing its box in equal slices across it.
function split(word) {
  if (!CJK.test(word.text)) return [word];
  const parts = word.text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]+/gu) || [];
  if (parts.length < 2) return [word];
  const { alts, ...rest } = word;
  return parts.map((text, i) => ({ ...rest, text, ...(word.box ? { box: [word.box[0] + (word.box[2] * i) / parts.length, word.box[1], word.box[2] / parts.length, word.box[3]] } : {}) }));
}

// [score, last word] of `term` at word j: the word itself, or Chinese characters from j on
// whose readings (`py`, toneless, from addPinyin) spell it: "nihao" and "ni hao" find 你好.
function scoreAt(term, list, j, fuzzy, o = {}) {
  const m = wordScore(term, list[j], fuzzy, o);
  if (m) return [m, j];
  // A formula the PDF or OCR broke into pieces ("B(n," "p)") is found across them.
  const key = o.matchCase ? 'normCase' : 'norm';
  if (term.length > 1 && term.startsWith(list[j][key]) && list[j][key]) {
    let joined = '';
    for (let k = j; k < list.length && k < j + 12; k++) {
      joined += list[k][key];
      if (joined === term) return [3, k];
      if (!term.startsWith(joined)) break;
    }
  }
  if (!list[j].py) return [0, j];
  let spelled = '';
  for (let k = j; k < list.length && list[k].py; k++) {
    spelled += list[k].py;
    if (spelled === term) return [3, k];
    if (!term.startsWith(spelled)) break;
  }
  return [0, j];
}
const span = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

export class SearchIndex {
  constructor() { this.units = []; }
  // unit: { page, source, words: [{ text, box?, time? }], label?, recordingId? }
  add(unit) {
    const prepared = { ...unit, words: unit.words.flatMap(split).map(w => ({ ...w, norm: clean(w.text), normCase: cleanCase(w.text), ...(w.alts?.length ? { altNorms: w.alts.map(clean).filter(Boolean), altCase: w.alts.map(cleanCase).filter(Boolean) } : {}) })).filter(w => w.norm) };
    if (prepared.words.length) this.units.push(prepared);
  }
  remove(predicate) { this.units = this.units.filter(u => !predicate(u)); }
  // Units with Chinese characters whose readings are not known yet.
  needsPinyin() { return this.units.some(u => !u.pinyin && u.words.some(w => HAN.test(w.text))); }
  // Readings for the Chinese characters: `annotate(text)` → [{start, end, text, pinyin: [...]}]
  // (chinese/client.js), over each unit's words joined.
  async addPinyin(annotate) {
    for (const unit of this.units) {
      if (unit.pinyin || !unit.words.some(w => HAN.test(w.text))) continue;
      unit.pinyin = true;
      const text = unit.words.map(w => w.text).join(''), at = [];
      unit.words.forEach((w, i) => { for (let k = 0; k < w.text.length; k++) at.push(i); });
      for (const a of await annotate(text).catch(() => [])) {
        let index = a.start;
        [...(a.text ?? text.slice(a.start, a.end))].forEach((char, k) => {
          const word = unit.words[at[index]];
          if (a.pinyin?.[k] && word && word.text === char) word.py = clean(a.pinyin[k]);
          index += char.length;
        });
      }
    }
  }
  has(predicate) { return this.units.some(predicate); }
  // Hits where every query word appears within a short window, best matches first
  // inside each unit; results are ordered by page, then source, then position.
  // `options`: { matchCase, wholeWord, regex } — the Find bar's Aa, ab and .* toggles.
  search(query, limit = 500, options = {}) {
    if (options.regex) return this.searchPattern(query, limit, options);
    const terms = queryTerms(query, options);
    if (!terms.length) return [];
    const hits = [];
    for (const unit of this.units) {
      const fuzzy = FUZZY.has(unit.source), list = unit.words;
      const window = Math.max(terms.length * 4, 6);
      const used = new Set();
      for (let i = 0; i < list.length; i++) {
        const [first, firstEnd] = scoreAt(terms[0], list, i, fuzzy, options);
        if (!first || used.has(i)) continue;
        const matched = span(i, firstEnd);
        let score = first, at = firstEnd, extra = firstEnd - i;
        for (const term of terms.slice(1)) {
          let found = -1, end = -1, best = 0;
          for (let j = at + 1; j < Math.min(list.length, i + window + extra); j++) {
            const [m, last] = scoreAt(term, list, j, fuzzy, options);
            if (m > best) { best = m; found = j; end = last; if (m === 3) break; }
          }
          if (found < 0) { score = 0; break; }
          score += best + (found === at + 1 ? 1 : 0);
          matched.push(...span(found, end));
          extra += end - found;
          at = end;
        }
        if (!score) continue;
        for (const k of matched) used.add(k);
        const from = Math.max(0, i - 6), to = Math.min(list.length, at + 7);
        hits.push({
          page: unit.page, source: unit.source, label: unit.label, recordingId: unit.recordingId,
          position: i, score,
          boxes: matched.map(k => list[k].box).filter(Boolean),
          time: list[i].time,
          snippet: list.slice(from, to).reduce((s, w, k, all) => s + (k && !(CJK.test(w.text) && CJK.test(all[k - 1].text)) ? ' ' : '') + w.text, ''),
          matched: matched.map(k => list[k].text),
        });
      }
    }
    return sortHits(hits, limit);
  }
  // Regular expression search over each unit's words joined by spaces (accents ignored, case
  // too unless Match case); a match covers the words it touches. An invalid pattern finds
  // nothing; `patternError` says why.
  searchPattern(query, limit = 500, options = {}) {
    this.patternError = '';
    if (!String(query).length) return [];
    const { pattern, error } = findPattern(query, options);
    if (!pattern) { this.patternError = error; return []; }
    const hits = [];
    for (const unit of this.units) {
      const list = unit.words, starts = [];
      let text = '';
      for (const w of list) { starts.push(text.length); text += unaccent(w.text) + ' '; }
      pattern.lastIndex = 0;
      for (let m; (m = pattern.exec(text)) && hits.length < limit * 4;) {
        if (!m[0].length) { pattern.lastIndex++; continue; }
        const wordAt = (offset) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo; };
        const i = wordAt(m.index), end = wordAt(m.index + m[0].length - 1);
        const from = Math.max(0, i - 6), to = Math.min(list.length, end + 7);
        hits.push({
          page: unit.page, source: unit.source, label: unit.label, recordingId: unit.recordingId,
          position: i, score: 3,
          boxes: span(i, end).map(k => list[k].box).filter(Boolean),
          time: list[i].time,
          snippet: list.slice(from, to).map(w => w.text).join(' '),
          matched: span(i, end).map(k => list[k].text),
        });
      }
    }
    return sortHits(hits, limit);
  }
}
function sortHits(hits, limit) {
  const order = s => SOURCES.indexOf(s);
  hits.sort((a, b) => a.page - b.page || order(a.source) - order(b.source) || (a.time ?? a.position) - (b.time ?? b.position));
  return hits.slice(0, limit);
}
