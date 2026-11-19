// One search over every text source of a note. Units are added per page and
// source; each word may carry a box (page units) or a time (seconds).
//   text   typed text boxes         pdf    PDF text layer
//   ocr    on-demand recognition    audio  Whisper transcripts
export const SOURCES = ['text', 'pdf', 'ocr', 'audio'];
// Recognised text has errors, so it also accepts one edit on longer words.
const FUZZY = new Set(['ocr', 'audio']);

// Case- and accent-insensitive: "Memória" and "memoria" are the same word.
export function normalize(text) {
  return String(text).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}
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

// 3 exact, 2 prefix, 1 fuzzy, 0 no match.
export function matchWord(query, word, fuzzy) {
  if (word === query) return 3;
  if (word.startsWith(query)) return 2;
  if (fuzzy && query.length >= 5 && (withinOneEdit(query, word) || (word.length > query.length && withinOneEdit(query, word.slice(0, query.length))))) return 1;
  return 0;
}

// A word may carry other readings of the same spot (`alts`, from a second OCR pass).
const wordScore = (term, word, fuzzy) => Math.max(matchWord(term, word.norm, fuzzy), ...(word.altNorms || []).map(a => matchWord(term, a, fuzzy)));
const clean = text => normalize(text).replace(/[^\p{L}\p{N}]+/gu, '');

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
function scoreAt(term, list, j, fuzzy) {
  const m = wordScore(term, list[j], fuzzy);
  if (m || !list[j].py) return [m, j];
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
    const prepared = { ...unit, words: unit.words.flatMap(split).map(w => ({ ...w, norm: clean(w.text), ...(w.alts?.length ? { altNorms: w.alts.map(clean).filter(Boolean) } : {}) })).filter(w => w.norm) };
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
  search(query, limit = 500) {
    const terms = words(query);
    if (!terms.length) return [];
    const hits = [];
    for (const unit of this.units) {
      const fuzzy = FUZZY.has(unit.source), list = unit.words;
      const window = Math.max(terms.length * 4, 6);
      const used = new Set();
      for (let i = 0; i < list.length; i++) {
        const [first, firstEnd] = scoreAt(terms[0], list, i, fuzzy);
        if (!first || used.has(i)) continue;
        const matched = span(i, firstEnd);
        let score = first, at = firstEnd, extra = firstEnd - i;
        for (const term of terms.slice(1)) {
          let found = -1, end = -1, best = 0;
          for (let j = at + 1; j < Math.min(list.length, i + window + extra); j++) {
            const [m, last] = scoreAt(term, list, j, fuzzy);
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
    const order = s => SOURCES.indexOf(s);
    hits.sort((a, b) => a.page - b.page || order(a.source) - order(b.source) || (a.time ?? a.position) - (b.time ?? b.position));
    return hits.slice(0, limit);
  }
}
