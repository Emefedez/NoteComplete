// Spelling help for recognized handwriting: a word the engine read that is not a common
// word of the language becomes the likeliest common word it could be, one look-alike or
// one letter away ("procecador" → "procesador", "e/" → "el"), and a word read without its
// accent gets it back when the language writes it only one way ("direccion" →
// "dirección"). Words the engine was sure of, and words with no clear candidate, are left
// as read; the reading stays an alternative for Find either way.
// Two word lists download once on first use: the 50,000 most frequent words with how
// often each appears (Hermit Dave's FrequencyWords from OpenSubtitles, CC BY-SA 4.0),
// which picks corrections, and every word of the language (an-array-of-spanish-words,
// MIT, about 636,000), so that a real but rarer word (caché, mitocondria) is never
// "corrected" into a common one.
const LISTS = {
  spa: {
    frequencies: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/es/es_50k.txt',
    all: 'https://cdn.jsdelivr.net/npm/an-array-of-spanish-words@2.0.0/index.json',
  },
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

const loaded = new Map();
const download = url => fetch(url, { cache: 'force-cache' }).then(r => { if (!r.ok) throw new Error(`word list ${r.status}`); return r; });
// The language's word lists: the frequency Map, with `all` (a Set of every word, folded).
export function loadDictionary(language) {
  const lists = LISTS[language];
  if (!lists) return Promise.resolve(null);
  if (!loaded.has(language))
    loaded.set(language, Promise.all([download(lists.frequencies).then(r => r.text()), download(lists.all).then(r => r.json())])
      .then(([frequencies, all]) => Object.assign(parseFrequencies(frequencies), { all: new Set(all.map(fold)) }))
      .catch(error => { loaded.delete(language); throw error; }));
  return loaded.get(language);
}
// The full list is large (about 40 MB in memory): let go of it when a run ends.
export function releaseDictionaries() { loaded.clear(); }

// Characters the engine reads in place of handwritten letters, and what they may be.
const LOOKALIKE = { '/': ['l'], '|': ['l'], ']': ['l'], '[': ['l'], '1': ['l', 'i'], '0': ['o'], '5': ['s'], '€': ['e'], '£': ['e', 'l'], '(': ['c', 'l'], ')': ['l'], '$': ['s'], '9': ['g', 'q'], '{': ['l'], '}': ['l'], '!': ['l', 'i'], 'j': ['j', 'l'], 'n': ['n', 'ñ'] };
// Letters handwriting turns into each other: a change between these counts first.
const NEAR = new Set(['n:ñ', 'c:e', 'e:c', 'a:o', 'o:a', 'n:h', 'h:n', 'u:v', 'v:u', 'n:u', 'u:n', 'c:s', 's:c', 'l:t', 't:l', 'i:l', 'l:i', 'r:n', 'n:r', 'a:e', 'e:a', 'g:q', 'q:g', 'b:h', 'h:b', 'm:n', 'n:m', 'c:t', 't:c', 'j:l', 'l:j', 'f:t', 't:f', 'y:g', 'r:p', 'p:r', 'd:a', 'a:d', 'i:r', 'r:i']);
const ALPHABET = [...'abcdefghijklmnñopqrstuvwxyz'];
// The engine was sure: an unknown word it read this confidently is a name or a term.
const SURE = 97;
// Candidates rarer than this are left out: odd words a misreading lands on by chance.
const RARE = 20;

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

// Words of the list one change away, with how likely the change is (1 look-alike letters, 2 any).
function neighbours(word, words, add) {
  for (let i = 0; i < word.length; i++) {
    add(word.slice(0, i) + word.slice(i + 1), 2);
    for (const c of ALPHABET) if (c !== word[i]) add(word.slice(0, i) + c + word.slice(i + 1), NEAR.has(`${word[i]}:${c}`) ? 1 : 2);
  }
  for (let i = 0; i <= word.length; i++) for (const c of ALPHABET) add(word.slice(0, i) + c + word.slice(i), 2);
}

// The corrected text of one recognized word, or null to leave it as read.
export function correctWord(text, words, confidence = 0) {
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
  // A word of the language, if a rare one: as read.
  if (words.all?.has(fold(core)) || confidence >= SURE) return null;
  const found = new Map();
  const add = (w, rank) => { const e = words.get(w); if (e && e.count >= RARE && !(found.get(w)?.rank <= rank)) found.set(w, { rank, count: e.count, word: e.forms[0][0] }); };
  const options = variants(core);
  for (const v of options) add(v, 0);
  if (!found.size && fold(core).length >= 4) for (const v of options) neighbours(v, words, add);
  if (!found.size) return null;
  // The likeliest change first, then the commoner word; a close second means unsure.
  const ranked = [...found.values()].sort((a, b) => a.rank - b.rank || b.count - a.count);
  const [best, second] = ranked;
  if (second && second.rank === best.rank && best.count < 3 * second.count) return null;
  return lead + shape(core, best.word) + tail;
}

// The dictionary word, with the reading's capital (unless the engine made it of another letter).
function shape(core, word) {
  return /^\p{Lu}/u.test(core) && fold(core[0]) === fold(word[0]) ? word[0].toUpperCase() + word.slice(1) : word;
}

// Recognized words with their spelling corrected; the reading stays among `alts`.
export function correctWords(list, words) {
  return list.map(w => {
    let fixed = correctWord(w.text, words, w.confidence);
    // Else an alternative reading that is a word wins over one that is not.
    const plain = fold(w.text.replace(/[^\p{L}]/gu, ''));
    if (!fixed && !words.has(plain) && !words.all?.has(plain)) fixed = w.alts?.find(a => words.has(fold(a.replace(/[^\p{L}]/gu, '')))) || null;
    if (!fixed || fixed === w.text) return w;
    return { ...w, text: fixed, alts: [w.text, ...(w.alts || []).filter(a => a !== fixed)] };
  });
}
