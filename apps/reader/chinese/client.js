// The dictionary on the main thread (docs/CHINESE-INPUT.md §15): `chinese()` is one client whose
// worker (engine-worker.js) starts on the first call, never at app start. Every method is async.
//   candidates(input, {script, limit}) → {reading, rest, items: [{text, pinyin, consumed, level, gloss, sentence}]},
//     or null when a newer candidates() call was made meanwhile (a stale answer is dropped)
//   choose(input, item, script)            learn a chosen candidate (user dictionary)
//   chooseSequence(parts, script)          several candidates chosen for one input (小 + 明): learnt
//                                          as a word; offered as one after the second time
//   favourites() → [hanzi…]; isFavourite(hanzi); setFavourite(hanzi, on, pinyin): the ☆ of the
//                                          panels; a favourite comes first among the candidates
//   annotate(text, {script})               → [{start, end, text, pinyin: ["nǐ"…], level}] per word of the Han runs
//   lookup(text, {script})                 → {entries: [{simp, trad, pinyin, gloss: [], level}], words: [{text,
//     pinyin, gloss, level}], char?: {char, readings: [{pinyin, count}], strokes, radical: {number, char,
//     residual, simplified}, definition, variants: {simp, trad, other}, decomposition, etymology}}
//   convert(text, "s2t" | "t2s") → string; convertParts(text, dir) → [{text, source, alternatives?}]
//   packs() → [{id, name, levels, bundled, installed, words, bytes}]; installPack(id, onProgress); removePack(id)
// script: "simplified" | "traditional" (or "s" | "t").
import { userDict, joinChoices } from './user-dict.js';
import { packManager } from './packs.js';

let instance = null;
export function chinese() { return (instance ||= createClient()); }

export function createClient({
  createWorker = () => new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' }),
  dict = userDict(), packs = null,
} = {}) {
  let worker = null, started = null, next = 0, latest = 0;
  const waiting = new Map();
  const call = async (op, ...args) => {
    start();
    await started;
    return post(op, args);
  };
  const post = (op, args) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
  function start() {
    if (worker) return;
    worker = createWorker();
    worker.onmessage = ({ data }) => {
      const w = waiting.get(data.id);
      if (!w) return;
      waiting.delete(data.id);
      if ('error' in data) w.reject(new Error(data.error)); else w.resolve(data.result);
    };
    worker.onerror = e => {
      e?.preventDefault?.();
      const error = new Error(e?.message || 'The Chinese dictionary stopped');
      for (const w of waiting.values()) w.reject(error);
      waiting.clear();
      worker?.terminate?.();
      worker = null;
    };
    // The user's rows and installed expansions go first, so the first answer already uses them.
    started = Promise.all([dict.all().catch(() => null), pm.installedWords().catch(() => [])]).then(([user, words]) => {
      if (user) post('user', [user]).catch(() => {});
      if (words.length) post('expansions', [words]).catch(() => {});
    });
  }
  const pm = packs || packManager({ core: () => call('info') });
  const refreshExpansions = async () => { if (worker) await post('expansions', [await pm.installedWords()]); };
  const refreshUser = async () => { if (worker) await post('user', [await dict.all()]); };

  return {
    async candidates(input, opts = {}) {
      const n = ++latest;
      const result = await call('candidates', input, opts);
      return n === latest ? result : null;
    },
    async choose(input, item, script) {
      if (!item?.text || !item.pinyin) return;
      const row = await dict.choose(item, script);
      if (worker) await post('learn', [row]);
    },
    async chooseSequence(parts, script) {
      const joined = joinChoices(parts || []);
      if (!joined) return;
      const row = await dict.choose(joined, script, { word: true });
      if (worker) await post('learn', [row]);
    },
    favourites: () => dict.favourites(),
    isFavourite: async (hanzi) => (await dict.favourites()).includes(hanzi),
    async setFavourite(hanzi, on, pinyin = '') {
      await dict.setFavourite(hanzi, on, pinyin);
      await refreshUser();
      globalThis.dispatchEvent?.(new CustomEvent('zh-favourites'));
    },
    annotate: (text, opts = {}) => call('annotate', text, opts),
    lookup: (text, opts = {}) => call('lookup', text, opts),
    convert: (text, direction) => call('convert', text, direction),
    convertParts: (text, direction) => call('convertParts', text, direction),
    packs: () => pm.packs(),
    async installPack(id, onProgress) { await pm.installPack(id, onProgress); await refreshExpansions(); },
    async removePack(id) { await pm.removePack(id); await refreshExpansions(); },
    // The user dictionary for Settings → Chinese export / import.
    exportUser: () => dict.export(),
    async importUser(data) { await dict.import(data); await refreshUser(); },
  };
}
