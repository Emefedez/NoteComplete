// Spelling help for recognized handwriting: a word the engine read that is not a word of
// the chosen languages becomes the likeliest common word it could be, one look-alike or
// one letter away ("procecador" → "procesador", "e/" → "el"), and a word read without its
// accent gets it back when the language writes it only one way ("direccion" →
// "dirección"). In the deep mode (high quality) a long word may be two changes away
// ("trabjndo" → "trabajando"). Words of any chosen language, an English word in Spanish
// notes too, words the engine was sure of, and words with no clear candidate are left as
// read; the reading stays an alternative for Find either way.
// Two word lists per language download once on first use: the 50,000 most frequent words
// with how often each appears (Hermit Dave's FrequencyWords from OpenSubtitles, CC BY-SA
// 4.0), which picks corrections, and every word of the language (the an-array-of-*-words
// lists: MIT; Catalan GPL/LGPL/MPL), so that a real but rarer word (caché, mitocondria)
// is never "corrected" into a common one.
const FREQUENCIES = code => `https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/${code}/${code}_50k.txt`;
const ALL = (pkg, file = 'index.json') => `https://cdn.jsdelivr.net/npm/${pkg}/${file}`;
const LISTS = {
  spa: { frequencies: FREQUENCIES('es'), all: ALL('an-array-of-spanish-words@2.0.0') },
  eng: { frequencies: FREQUENCIES('en'), all: ALL('an-array-of-english-words@2.0.0') },
  fra: { frequencies: FREQUENCIES('fr'), all: ALL('an-array-of-french-words@2.0.0') },
  deu: { frequencies: FREQUENCIES('de'), all: ALL('an-array-of-german-words@1.2.0', 'words.json') },
  ita: { frequencies: FREQUENCIES('it'), all: ALL('an-array-of-italian-words@1.2.0', 'words.json') },
  por: { frequencies: FREQUENCIES('pt'), all: ALL('an-array-of-portuguese-words@1.2.0', 'words.json') },
  cat: { frequencies: FREQUENCIES('ca'), all: ALL('an-array-of-catalan-words@1.0.3') },
};
export const DICTIONARY_LANGUAGES = Object.keys(LISTS);

// Compared in lower case without accents; ñ is a letter of its own.
export const fold = text => text.toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD').replace(/\p{M}+/gu, '').replace(/\u0001/g, 'ñ');

// "word count" lines → folded word → { forms: [[word, count]…] most frequent first, count }.
export function parseFrequencies(text) {
  const words = new Map();
  for (const line of text.split('\n')) {
    const [word, n] = line.trim().split(/\s+/);
    if (!word || !/^\p{L}+$/u.test(word)) continue;
    const key = fold(word), count = Number(n) || 1, entry = words.get(key);
    if (entry) { entry.forms.push([word, count]); entry.count += count; }
    else words.set(key, { forms: [[word, count]], count });
  }
  for (const entry of words.values()) entry.forms.sort((a, b) => b[1] - a[1]);
  return words;
}

// One lexicon over the chosen languages: how common each word is (per million words of
// its language, so languages compare), and whether it is a word of any of them.
export function makeLexicon(languages) {
  const words = new Map(), all = [];
  for (const { frequencies, all: every } of languages) {
    let total = 0;
    for (const e of frequencies.values()) total += e.count;
    for (const [key, e] of frequencies) {
      const scale = 1e6 / (total || 1), entry = { forms: e.forms.map(([w, n]) => [w, n * scale]), count: e.count * scale };
      if (!(words.get(key)?.count >= entry.count)) words.set(key, entry);
    }
    if (every) all.push(every);
  }
  words.all = { has: key => all.some(set => set.has(key)) };
  return words;
}
// Whether a read text is a word of the lexicon (its letters only).
export function isWord(text, lexicon) {
  const key = fold(text.replace(/[^\p{L}]/gu, ''));
  return key.length > 1 && (lexicon.has(key) || lexicon.all?.has(key));
}

const loaded = new Map();
const download = url => fetch(url, { cache: 'force-cache' }).then(r => { if (!r.ok) throw new Error(`word list ${r.status}`); return r; });
function loadLanguage(language) {
  const lists = LISTS[language];
  if (!lists) return Promise.resolve(null);
  if (!loaded.has(language))
    loaded.set(language, Promise.all([download(lists.frequencies).then(r => r.text()), download(lists.all).then(r => r.json())])
      .then(([frequencies, all]) => ({ frequencies: parseFrequencies(frequencies), all: new Set(all.map(fold)) }))
      .catch(error => { loaded.delete(language); throw error; }));
  return loaded.get(language);
}
// The lexicon of the chosen languages that have word lists; null when none has.
export async function loadDictionary(languages) {
  const chosen = [].concat(languages).filter(l => LISTS[l]);
  return chosen.length ? makeLexicon(await Promise.all(chosen.map(loadLanguage))) : null;
}
// The full lists are large (tens of MB in memory): let go of them when a run ends.
export function releaseDictionaries() { loaded.clear(); }

// Characters the engine reads in place of handwritten letters, and what they may be.
const LOOKALIKE = { '/': ['l'], '|': ['l'], ']': ['l'], '[': ['l'], '1': ['l', 'i'], '0': ['o'], '5': ['s'], '€': ['e'], '£': ['e', 'l'], '(': ['c', 'l'], ')': ['l'], '$': ['s'], '9': ['g', 'q'], '{': ['l'], '}': ['l'], '!': ['l', 'i'], 'j': ['j', 'l'], 'n': ['n', 'ñ'] };
// Letters handwriting turns into each other: a change between these counts first.
const NEAR = new Set(['n:ñ', 'c:e', 'e:c', 'a:o', 'o:a', 'n:h', 'h:n', 'u:v', 'v:u', 'n:u', 'u:n', 'c:s', 's:c', 'l:t', 't:l', 'i:l', 'l:i', 'r:n', 'n:r', 'a:e', 'e:a', 'g:q', 'q:g', 'b:h', 'h:b', 'm:n', 'n:m', 'c:t', 't:c', 'j:l', 'l:j', 'f:t', 't:f', 'y:g', 'r:p', 'p:r', 'd:a', 'a:d', 'i:r', 'r:i']);
const ALPHABET = [...'abcdefghijklmnñopqrstuvwxyz'];
// The engine was sure: an unknown word it read this confidently is a name or a term.
const SURE = 97;
// Candidates rarer than this (per million words) are left out: odd words a misreading lands on by chance.
const RARE = 0.05;
// Two changes away only for words this long (deep mode): shorter ones have too many.
const LONG = 6;

function variants(core) {
  let out = [''];
  for (const ch of fold(core)) {
    const options = LOOKALIKE[ch] || [ch];
    out = out.flatMap(v => options.map(o => v + o));
    if (out.length > 16) out = out.slice(0, 16);
  }
  const extra = [];
  for (const v of out) for (const [a, b] of [['rn', 'm'], ['m', 'rn'], ['cl', 'd'], ['li', 'h'], ['ii', 'u'], ['vv', 'w']]) if (v.includes(a)) extra.push(v.replace(a, b));
  return [...new Set([...out, ...extra])];
}

// Every text one change away, with how likely the change is (1 look-alike letters, 2 any).
function edits(word, visit) {
  for (let i = 0; i < word.length; i++) {
    visit(word.slice(0, i) + word.slice(i + 1), 2);
    for (const c of ALPHABET) if (c !== word[i]) visit(word.slice(0, i) + c + word.slice(i + 1), NEAR.has(`${word[i]}:${c}`) ? 1 : 2);
  }
  for (let i = 0; i <= word.length; i++) for (const c of ALPHABET) visit(word.slice(0, i) + c + word.slice(i), 2);
}

// The corrected text of one recognized word, or null to leave it as read.
export function correctWord(text, words, confidence = 0, { deep = false } = {}) {
  const [, lead, core, tail] = text.match(/^([^\p{L}\p{N}/|\][€£$(){}!]*)(.*?)([.,;:!?»"')]*)$/u) || [];
  if (!core || core.length < 2 || /\d{2}|^\d+$/.test(core)) return null;
  if (!/\p{L}/u.test(core) && core.length < 3) return null;
  // An acronym (CPU, JS) is written as meant.
  if (core.length > 1 && /^[\p{Lu}\d]+$/u.test(core)) return null;
  const known = words.get(fold(core));
  if (known) {
    // A known word read without its accent gets the one way the language writes it.
    const [top, next] = known.forms;
    if (top[0] !== core.toLowerCase() && fold(top[0]) === core.toLowerCase() && top[0] !== fold(top[0]) && (!next || top[1] > 5 * next[1]) && !known.forms.some(([f]) => f === core.toLowerCase() && f !== top[0]))
      return lead + shape(core, top[0]) + tail;
    return null;
  }
  // A word of a chosen language, if a rare one: as read.
  if (words.all?.has(fold(core)) || confidence >= SURE) return null;
  const found = new Map();
  const add = (w, rank) => { const e = words.get(w); if (e && e.count >= RARE && !(found.get(w)?.rank <= rank)) found.set(w, { rank, count: e.count, word: e.forms[0][0] }); };
  const options = variants(core);
  for (const v of options) add(v, 0);
  if (!found.size && fold(core).length >= 4) for (const v of options) edits(v, add);
  // Deep mode: two changes away for a long word, from the reading as it is.
  if (!found.size && deep && fold(core).length >= LONG) {
    const seen = new Set();
    edits(options[0], (once, r1) => { if (seen.has(once)) return; seen.add(once); edits(once, (w, r2) => add(w, 2 + Math.max(r1, r2))); });
  }
  if (!found.size) return null;
  // The likeliest change first, then the commoner word; a close second means unsure.
  const ranked = [...found.values()].sort((a, b) => a.rank - b.rank || b.count - a.count);
  const [best, second] = ranked;
  if (second && second.rank === best.rank && best.count < (best.rank > 2 ? 5 : 3) * second.count) return null;
  return lead + shape(core, best.word) + tail;
}

// The dictionary word, with the reading's capital (unless the engine made it of another letter).
function shape(core, word) {
  return /^\p{Lu}/u.test(core) && fold(core[0]) === fold(word[0]) ? word[0].toUpperCase() + word.slice(1) : word;
}

// Deep mode: the word most likely meant, as a spelling checker picks it. Every candidate
// (the reading, what other passes read there, and texts one or two changes from them)
// scores how common it is in the chosen languages (log10 of its count per million words)
// minus what its change costs: a look-alike character little, a letter handwriting
// confuses more, any other letter more again, and each unit costs more the surer the
// engine was of its reading. A word of a language that is not common counts as rare.
// So "ce" becomes "se" and "Lempo" "tiempo", but "fall" (English) and "caché" stay.
const COST = { lookalike: 0.5, alternative: 0.3, near: 1, any: 1.5 };
const UNCOMMON = 0.01; // per million: a word of the full list only
// A reading with an accent or ñ that is a word of the language: the engine saw that mark,
// so the word is very likely what was written (caché, not coche).
const MARKED = 5;
export function deepCorrect(text, words, confidence = 0, alternatives = []) {
  const [, lead, core, tail] = text.match(/^([^\p{L}\p{N}/|\][€£$(){}!]*)(.*?)([.,;:!?»"')]*)$/u) || [];
  if (!core || /\d{2}|^\d+$/.test(core) || (!/\p{L}/u.test(core) && core.length < 3)) return null;
  if (core.length > 1 && /^[\p{Lu}\d]+$/u.test(core)) return null;
  const lambda = 1.2 + Math.min(100, Math.max(0, confidence)) / 100;
  const reading = fold(core), marked = /[^\p{ASCII}]/u.test(core.normalize('NFC')) && /\p{L}/u.test(core);
  const frequency = key => Math.max(words.get(key)?.count ?? (words.all?.has(key) ? UNCOMMON : 0), marked && key === reading && (words.has(key) || words.all?.has(key)) ? MARKED : 0);
  const cost = new Map();
  const consider = (key, c) => { if (key.length > 0 && !(cost.get(key) <= c) && frequency(key) > 0) cost.set(key, c); };
  const sources = [[core, 0], ...alternatives.map(a => [a.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''), COST.alternative])].filter(([t]) => t);
  for (const [source, base] of sources) {
    const plain = fold(source);
    consider(plain, base);
    for (const v of variants(source)) {
      const c = base + (v === plain ? 0 : COST.lookalike);
      consider(v, c);
      edits(v, (w, rank) => consider(w, c + (rank === 1 ? COST.near : COST.any)));
    }
  }
  // Two changes only for a long reading that is not a common word.
  if (reading.length >= 5 && !(words.get(reading)?.count >= 1)) {
    const seen = new Set();
    edits(reading, (once, r1) => { if (seen.has(once)) return; seen.add(once); edits(once, (w, r2) => consider(w, (r1 === 1 ? COST.near : COST.any) + (r2 === 1 ? COST.near : COST.any))); });
  }
  let best = null, bestScore = -Infinity;
  for (const [key, c] of cost) {
    const score = Math.log10(frequency(key)) - lambda * c;
    if (score > bestScore) { best = key; bestScore = score; }
  }
  if (!best || best === reading) return null;
  // The way the language writes it (its accents), with the reading's capital.
  return lead + shape(core, words.get(best)?.forms[0][0] ?? best) + tail;
}

// Recognized words with their spelling corrected; the reading stays among `alts`. When
// the reading is not a word but another pass read the spot as one, that reading wins.
export function correctWords(list, words, { deep = false } = {}) {
  return list.map(w => {
    let fixed = null;
    if (deep) fixed = deepCorrect(w.text, words, w.confidence, w.alts || []) || correctWord(w.text, words, w.confidence);
    else if (!isWord(w.text, words)) fixed = w.alts?.find(a => isWord(a, words)) || correctWord(w.text, words, w.confidence);
    else fixed = correctWord(w.text, words, w.confidence);
    if (!fixed || fixed === w.text) return w;
    return { ...w, text: fixed, alts: [w.text, ...(w.alts || []).filter(a => a !== fixed)] };
  });
}
