// The user dictionary (docs/CHINESE-INPUT.md §4.6): candidates the person chose and their
// favourites (the ☆ of the look-up panel and the stroke order window), in IndexedDB
// "notecomplete-chinese" (db.js), stores "chosen" and "words". Rows keep their key inside: chosen
// {key: "<s|t>:<toneless syllables joined by '>:<hanzi>", count, last, tones, word?} (word: the
// numbered pinyin of a sequence the dictionary lacks, which becomes a word after two choices);
// words {key: hanzi, hanzi, pinyin: "xiao3 ming2" or "", added}: one favourite each (rows from
// before favourites, "My words", have the key hanzi + "\t" + pinyin and count as favourites too).
// The worker gets every row when it starts and each change after (client.js).
import { withStore } from './db.js';
import { marksToNumbers } from './pinyin.js';

export const MAX_ROWS = 50000;
const HALF_LIFE = 30 * 864e5;
export const scriptOf = s => String(s || 's')[0] === 't' ? 't' : 's';
// "nǐ hǎo" → "ni'hao" (tones dropped, ü kept).
export const toneless = pinyin => String(pinyin).normalize('NFD').replace(/[̀́̄̌]/g, '').normalize('NFC').toLowerCase().trim().split(/\s+/).join("'");
export const numbered = pinyin => marksToNumbers(String(pinyin).trim()).toLowerCase();
export const chosenKey = (script, pinyin, hanzi) => `${scriptOf(script)}:${toneless(pinyin)}:${hanzi}`;
const score = (r, now) => r.count * Math.pow(0.5, Math.max(0, now - r.last) / HALF_LIFE);

// IndexedDB stores (db.js); tests pass Map-backed stores with the same three methods.
export const idbStore = name => ({
  all: () => withStore(name, 'readonly', s => s.getAll()),
  put: row => withStore(name, 'readwrite', s => s.put(row, row.key)),
  delete: key => withStore(name, 'readwrite', s => s.delete(key)),
});
export const memoryStore = (map = new Map()) => ({
  map, all: async () => [...map.values()], put: async row => { map.set(row.key, row); }, delete: async key => { map.delete(key); },
});

export function userDict({ chosen = idbStore('chosen'), words = idbStore('words'), now = () => Date.now() } = {}) {
  let rows = null;
  const load = () => (rows ||= chosen.all().then(list => new Map(list.map(r => [r.key, r]))).catch(() => new Map()));
  return {
    async all() { return { chosen: [...(await load()).values()], words: await words.all().catch(() => []) }; },
    // A chosen candidate ({text, pinyin}); `word`: true for a sequence of several choices.
    async choose(item, script, { word = false } = {}) {
      const map = await load(), key = chosenKey(script, item.pinyin, item.text), t = now();
      const old = map.get(key);
      const row = { key, count: (old?.count || 0) + 1, last: t, tones: numbered(item.pinyin) };
      if (word || old?.word) row.word = numbered(item.pinyin);
      map.set(key, row);
      await chosen.put(row);
      if (map.size > MAX_ROWS) await prune(map, t);
      return row;
    },
    async favourites() { return [...new Set((await words.all().catch(() => [])).map(w => w.hanzi))]; },
    // `pinyin`: its reading, so a favourite the dictionary lacks is still offered.
    async setFavourite(hanzi, on, pinyin = '') {
      for (const r of await words.all()) if (r.hanzi === hanzi) await words.delete(r.key);
      if (on) await words.put({ key: hanzi, hanzi, pinyin: pinyin ? numbered(pinyin) : '', added: now() });
    },
    // Settings → Chinese export / import (moving devices).
    async export() { return { chosen: [...(await load()).values()], words: await words.all() }; },
    async import(data) {
      const map = await load();
      for (const r of data?.chosen || []) if (r?.key && r.count > 0) { const old = map.get(r.key); const row = { ...r, count: Math.max(r.count, old?.count || 0), last: Math.max(r.last || 0, old?.last || 0) }; map.set(r.key, row); await chosen.put(row); }
      for (const w of data?.words || []) if (w?.hanzi) await words.put({ ...w, key: w.hanzi });
    },
  };
  async function prune(map, t) {
    const drop = [...map.values()].sort((a, b) => score(a, t) - score(b, t)).slice(0, map.size - MAX_ROWS);
    for (const r of drop) { map.delete(r.key); await chosen.delete(r.key); }
  }
}

// Several candidates chosen one after another for one input (小 then 明 for "xiaoming"): the
// joined choice, to be learnt as a word when the dictionary lacks it.
export const joinChoices = parts => parts.length > 1 ? { text: parts.map(p => p.text).join(''), pinyin: parts.map(p => p.pinyin).join(' ') } : null;
