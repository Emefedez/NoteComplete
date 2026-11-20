// Translating Chinese (docs/CHINESE-INPUT.md §16): a selection to Spanish or English with a free
// online service (Google's public translate endpoint, MyMemory when that fails; no key, no
// account), the dictionary's English meanings put into Spanish the same way for the es | en
// toggle, and the parts of a sentence matched to the parts of its translation (alignWords) for
// the colours. Everything is cached on this device, so a sentence is fetched once.
//   translate("我喜欢学中文", { to: "es" }) → { text: "Me gusta aprender chino", by: "Google" }
//   translateMany(["喜欢", "学"], { to: "es" }) → ["gustar", "aprender"]
//   localizeLookup(result, "es") → the look-up with its meanings in Spanish
import { zhSettings } from './settings.js';
import { marksToNumbers } from './pinyin.js';

export const LANGS = Object.freeze({ es: 'Español', en: 'English' });
export const zhLang = () => (zhSettings().lang in LANGS ? zhSettings().lang : 'en');
export const setZhLang = (lang) => { if (lang in LANGS) zhSettings({ lang }); };

// Universal translation languages (favorites default to Spanish, English, Simplified Chinese).
export const TRANSLATE_LANGUAGES = Object.freeze([
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '中文 (简体)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '中文 (繁體)' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'eu', name: 'Basque', native: 'Euskara' },
  { code: 'gl', name: 'Galician', native: 'Galego' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'la', name: 'Latin', native: 'Latina' },
]);
export const DEFAULT_FAV_LANGS = Object.freeze(['es', 'en', 'zh-CN']);
const FAV_LANGS_KEY = 'notecomplete-translate-favs';
const LANG_MAP = new Map(TRANSLATE_LANGUAGES.map((l) => [l.code, l]));
export const translateLangInfo = (code) => LANG_MAP.get(code) || { code, name: code, native: code };
export function favoriteTranslateLangs() {
  try {
    const raw = JSON.parse(store()?.getItem(FAV_LANGS_KEY) || 'null');
    if (Array.isArray(raw)) {
      const valid = raw.filter((c) => LANG_MAP.has(c));
      if (valid.length) return valid;
    }
  } catch { /* Default. */ }
  return [...DEFAULT_FAV_LANGS];
}
export function toggleFavoriteTranslateLang(code) {
  if (!LANG_MAP.has(code)) return favoriteTranslateLangs();
  const cur = favoriteTranslateLangs();
  const next = cur.includes(code)
    ? (cur.length > 1 ? cur.filter((c) => c !== code) : cur)
    : [...cur, code];
  try { store()?.setItem(FAV_LANGS_KEY, JSON.stringify(next)); } catch { /* Optional. */ }
  return next;
}

const HAN = /\p{Script=Han}/u;
// Pinyin written out (with tone marks or numbers), such as "nǐ hǎo" or "ni3 hao3": two syllables
// or more, nearly every word one, so English words are not taken for it.
const SYL = '(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?[aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+(?:ng|n|r)?[1-5]?';
const WORD = new RegExp(`^(?:${SYL})+$`, 'i');
export function isPinyin(text) {
  const s = String(text ?? '').trim();
  if (!s || HAN.test(s) || s.length > 400) return false;
  const words = s.split(/[\s,.;:!?'’"“”，。！？、()（）-]+/).filter(Boolean);
  if (words.length < 2) return false;
  const marked = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]|[a-zü][1-5]\b/i.test(s.normalize('NFC'));
  const fit = words.filter((w) => WORD.test(w.normalize('NFC'))).length;
  return marked && fit / words.length >= 0.8;
}

// ---- Cache: memory, and up to 600 answers in localStorage ----
const CACHE_KEY = 'notecomplete-zh-translations', CACHE_MAX = 600;
let cache = null;
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
function cached() {
  if (cache) return cache;
  cache = new Map();
  try { for (const [k, v] of JSON.parse(store()?.getItem(CACHE_KEY) || '[]')) cache.set(k, v); } catch { /* Empty. */ }
  return cache;
}
let saveTimer = 0;
function remember(key, value) {
  const c = cached();
  c.delete(key);
  c.set(key, value);
  while (c.size > CACHE_MAX) c.delete(c.keys().next().value);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { store()?.setItem(CACHE_KEY, JSON.stringify([...c])); } catch { /* Full. */ } }, 400);
}
export const forgetTranslations = () => { cache = new Map(); try { store()?.removeItem(CACHE_KEY); } catch { /* Not kept. */ } };

// ---- Services ----
// Each: the address for a text, and the translation in its answer (null when it has none).
export const SERVICES = [
  {
    name: 'Google',
    url: (q, from, to) => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(q)}`,
    read: (j) => (Array.isArray(j?.[0]) ? j[0].map((s) => s?.[0] || '').join('') : null),
  },
  {
    name: 'MyMemory',
    // Up to 500 bytes a request; longer text goes to the first service only.
    fits: (q) => new TextEncoder().encode(q).length <= 500,
    url: (q, from, to) => `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${from === 'auto' ? 'autodetect' : from}|${to}`,
    read: (j) => (Number(j?.responseStatus) === 200 && j?.responseData?.translatedText ? String(j.responseData.translatedText) : null),
  },
];

// `text` from `from` to `to` ("es" | "en"): { text, by }. Throws when no service answers.
export async function translate(text, { from = 'zh-CN', to = zhLang(), fetch: fetchFn = (...a) => globalThis.fetch(...a), services = SERVICES, signal } = {}) {
  const q = String(text ?? '').trim();
  if (!q) return { text: '', by: '' };
  const key = `${from}>${to}:${q}`;
  const hit = cached().get(key);
  if (hit) return hit;
  let last = null;
  for (const s of services) {
    if (s.fits && !s.fits(q)) continue;
    try {
      // A service that does not answer in 8 s is passed over.
      const r = await fetchFn(s.url(q, from, to), { signal: signal || globalThis.AbortSignal?.timeout?.(8000) });
      if (!r.ok) throw new Error(`${s.name}: HTTP ${r.status}`);
      const out = s.read(await r.json());
      if (!out) throw new Error(`${s.name}: no translation`);
      const answer = { text: out.trim(), by: s.name };
      remember(key, answer);
      return answer;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
    }
  }
  throw new Error(globalThis.navigator?.onLine === false ? 'Translation needs a connection.' : `No translation service answered${last ? ` (${last.message})` : ''}.`);
}

// Several short texts in one request (one per line): their translations in the same order. When
// the service merges or splits lines, each is asked alone (at most 24).
export async function translateMany(list, opts = {}) {
  const from = opts.from || 'zh-CN', to = opts.to || zhLang();
  const items = list.map((t) => String(t ?? '').replace(/\s*\n\s*/g, ' ').trim());
  const out = items.map((t) => (t ? cached().get(`${from}>${to}:${t}`)?.text ?? null : ''));
  const missing = [...new Set(items.filter((t, i) => out[i] == null))];
  // Chunks of about 1 500 characters, so the address stays short enough.
  const chunks = [];
  for (const t of missing) {
    const last = chunks.at(-1);
    if (last && last.join('\n').length + t.length < 1500) last.push(t); else chunks.push([t]);
  }
  const got = new Map();
  for (const chunk of chunks) {
    const lines = chunk.length === 1 ? null : (await translate(chunk.join('\n'), { ...opts, from, to })).text.split(/\n/).map((l) => l.trim());
    if (lines && lines.length === chunk.length) chunk.forEach((t, i) => { got.set(t, lines[i]); remember(`${from}>${to}:${t}`, { text: lines[i], by: 'batch' }); });
    else for (const t of chunk.slice(0, 24)) got.set(t, (await translate(t, { ...opts, from, to }).catch(() => ({ text: '' }))).text);
  }
  return items.map((t, i) => out[i] ?? got.get(t) ?? '');
}

// A dictionary look-up (client.lookup) with its English meanings in `lang`; the same object for
// English. Meanings that cannot be translated stay in English, as do the words with it after
// the first 30 (one request for all).
const LOCALIZED_WORDS = 30;
export async function localizeLookup(result, lang = zhLang(), opts = {}) {
  if (!result || lang === 'en') return result;
  const glosses = [...new Set([
    ...(result.entries || []).flatMap((e) => e.gloss || []),
    ...(result.words || []).slice(0, LOCALIZED_WORDS).map((w) => w.gloss || ''),
    result.char?.definition || '',
  ].filter(Boolean))];
  if (!glosses.length) return result;
  const tr = await translateMany(glosses, { ...opts, from: 'en', to: lang }).catch(() => glosses);
  const map = new Map(glosses.map((g, i) => [g, tr[i] || g]));
  const t = (g) => map.get(g) || g;
  const dedup = (arr) => {
    const seen = new Set(), out = [];
    for (const x of arr) { const s = String(x || '').trim(), k = s.toLowerCase(); if (s && !seen.has(k)) { seen.add(k); out.push(s); } }
    return out;
  };
  return {
    ...result,
    entries: (result.entries || []).map((e) => ({ ...e, gloss: dedup((e.gloss || []).map(t)) })),
    words: (result.words || []).map((w, i) => ({ ...w, gloss: w.gloss && i < LOCALIZED_WORDS ? t(w.gloss) : w.gloss })),
    ...(result.char ? { char: { ...result.char, definition: result.char.definition ? t(result.char.definition) : result.char.definition } } : {}),
  };
}

// Pinyin to characters with the input method's dictionary: each step takes the best candidate
// for what is left. `candidates(input)` is the client's. "" when it cannot.
export async function pinyinToHanzi(text, candidates) {
  let rest = marksToNumbers(String(text ?? '').normalize('NFC')).toLowerCase().replace(/[^a-zü1-5\s']/g, ' ').replace(/\s+/g, ' ').trim();
  let out = '';
  for (let step = 0; rest && step < 60; step++) {
    const res = await candidates(rest, { limit: 1 });
    const item = res?.items?.[0];
    if (!item?.text || !item.consumed) break;
    out += item.text;
    rest = rest.slice(item.consumed).replace(/^[\s']+/, '');
  }
  return rest ? '' : out;
}

// ---- Colours: which part of the sentence is which part of its translation ----
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['to', 'a', 'an', 'the', 'of', 'be', 'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'se', 'lo', 'sth', 'sb', 'something', 'someone', 'algo', 'alguien']);
// The words worth finding in a meaning: "(literary) to be fond of sth" → ["fond"] (longest first).
function keys(meaning) {
  const m = fold(meaning).replace(/\([^)]*\)|\[[^\]]*\]|CL:.*$/g, ' ');
  const phrase = m.split(/[;,/]/).map((p) => p.trim().split(/[^a-z0-9ñ]+/).filter((w) => w && !STOP.has(w)).join(' ')).filter(Boolean);
  const words = phrase.flatMap((p) => p.split(' ')).filter((w) => w.length >= 2);
  return [...new Set([...phrase, ...words])].sort((a, b) => b.length - a.length);
}
// Spans of the translation's words: [{ text (folded), start, end }].
function tokens(text) {
  const out = [];
  for (const m of String(text).matchAll(/[\p{L}\p{N}]+/gu)) out.push({ text: fold(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}
// Same word, allowing endings (gustar ~ gusta, study ~ studies): a shared start of 4+ letters
// covering most of the shorter one.
const near = (a, b) => {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 4) return false;
  let k = 0;
  while (k < n && a[k] === b[k]) k++;
  return k >= 4 && k >= n - 2;
};

// `words`: the sentence's words in order, [{ text, meanings: [..] }] (each word's own translation
// and dictionary meanings). → [{ word, start, end }]: where each word is in `translation`
// (no two on the same place; words not found are left out).
export function alignWords(words, translation) {
  const toks = tokens(translation), used = new Set(), out = [];
  words.forEach((w, word) => {
    if (!HAN.test(w.text)) return;
    let best = null;
    for (const meaning of w.meanings || []) {
      for (const key of keys(meaning)) {
        const parts = key.split(' ');
        for (let i = 0; i + parts.length <= toks.length; i++) {
          if (parts.some((p, k) => used.has(i + k) || !near(p, toks[i + k].text))) continue;
          // The first free place, and among meanings the longest match.
          if (!best || parts.length > best.n) best = { i, n: parts.length };
          break;
        }
        if (best && best.n >= parts.length) break;
      }
    }
    if (!best) return;
    for (let k = 0; k < best.n; k++) used.add(best.i + k);
    out.push({ word, start: toks[best.i].start, end: toks[best.i + best.n - 1].end });
  });
  return out;
}

// Eight colours that stay apart for colour-blind readers (Okabe–Ito, without black), as soft
// highlights; the n-th matched word gets the n-th.
export const ALIGN_COLOURS = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999'];
