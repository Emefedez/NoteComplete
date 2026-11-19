// Chinese flashcards (docs/CHINESE-INPUT.md §10): vocabulary cards from Chinese text, the Anki
// layouts for them and the characters a deck has for writing practice. Pure; study.js's deck
// model { front, back, page } plus an optional `zh: { hanzi, pinyin, gloss, level }`.
//   vocabCards(annotations, lookups, { levels }) → [{ front: "你好", back: "nǐ hǎo — hello · HSK 1", zh }]
//   ankiChinese(deck, cards, "plain" | "ruby" | "furigana" | "fields") → Anki text import
//   deckHanzi(cards, { levels }) → ["你", "好"]; levelsIn(cards) → [0, 1, 2]
export const HAN = /\p{Script=Han}/u;
export const hasHan = (s) => HAN.test(String(s ?? ''));
// HSK 1–6, and the 2021 levels 7–9 as one.
export const levelLabel = (level) => (!level ? '' : level >= 7 ? 'HSK 7–9' : `HSK ${level}`);
export const LEVELS = [1, 2, 3, 4, 5, 6, 7];

export function cardBack({ pinyin = '', gloss = '', level = 0 } = {}) {
  const head = [pinyin, gloss].filter(Boolean).join(' — ');
  return level ? `${head}${head ? ' · ' : ''}${levelLabel(level)}` : head;
}
// The fields back out of a card's back (cards saved without `zh`, or edited).
export function parseBack(back) {
  let text = String(back ?? '').trim(), level = 0;
  const m = /(?:^|\s·\s)HSK (\d)(?:–9)?$/.exec(text);
  if (m) { level = Number(m[1]); text = text.slice(0, m.index).trim(); }
  const at = text.indexOf(' — ');
  return at < 0 ? { pinyin: text, gloss: '', level } : { pinyin: text.slice(0, at).trim(), gloss: text.slice(at + 3).trim(), level };
}
// A card's Chinese fields, or null when its front is not a Chinese word. Read from the card as
// it is now (it may have been edited); `zh` only adds the level a back without one lost.
export function cardZh(card) {
  const front = String(card?.front ?? '').trim();
  if (!hasHan(front) || /\s/.test(front) || [...front].length > 12) return null;
  const back = parseBack(card.back);
  return { hanzi: front, ...back, level: back.level || (card.zh?.hanzi === front ? card.zh.level || 0 : 0) };
}

// The best dictionary entry for a word read as `pinyin` ("nǐ hǎo"): that reading's, else the first.
export function entryFor(lookup, pinyin = '') {
  const entries = lookup?.entries || [];
  const want = String(pinyin).toLowerCase();
  return entries.find((e) => e.pinyin?.toLowerCase() === want) || entries[0] || null;
}
// Every word of the text once, in order: annotate() runs, glossed from `lookups` (Map word →
// lookup()). `levels`: the HSK levels to keep (0 = words of no level); null keeps all.
export function vocabWords(annotations, lookups = new Map(), { levels = null } = {}) {
  const seen = new Set(), out = [];
  for (const a of annotations || []) {
    const hanzi = a.text;
    if (!hanzi || !hasHan(hanzi) || seen.has(hanzi)) continue;
    seen.add(hanzi);
    const pinyin = (a.pinyin || []).join(' ');
    const e = entryFor(lookups.get?.(hanzi), pinyin);
    const level = a.level || e?.level || 0;
    if (levels && !levels.includes(Math.min(level, 7))) continue;
    out.push({ hanzi, pinyin: pinyin || e?.pinyin || '', gloss: e?.gloss?.[0] || '', level });
  }
  return out;
}
export const vocabCard = (w) => ({ front: w.hanzi, back: cardBack(w), zh: { hanzi: w.hanzi, pinyin: w.pinyin, gloss: w.gloss, level: w.level || 0 } });
export const vocabCards = (annotations, lookups, opts) => vocabWords(annotations, lookups, opts).map(vocabCard);

// The HSK levels of a deck's Chinese cards (0: no level), lowest first.
export function levelsIn(cards) {
  const set = new Set();
  for (const c of cards || []) { const z = cardZh(c); if (z) set.add(Math.min(z.level || 0, 7)); }
  return [...set].sort((a, b) => a - b);
}
// The characters of a deck's Chinese cards, each once, in order, with the reading they first
// had: [{ char, pinyin, level }].
export function deckHanzi(cards, { levels = null } = {}) {
  const seen = new Set(), out = [];
  for (const c of cards || []) {
    const z = cardZh(c);
    if (!z || (levels && !levels.includes(Math.min(z.level || 0, 7)))) continue;
    const syllables = z.pinyin.split(/\s+/);
    [...z.hanzi].forEach((char, i) => {
      if (!HAN.test(char) || seen.has(char)) return;
      seen.add(char);
      out.push({ char, pinyin: syllables.length === [...z.hanzi].length ? syllables[i] : '', level: z.level || 0 });
    });
  }
  return out;
}

// Anki's text import. "plain": the deck's own front/back (study.js ankiText's layout); "ruby":
// front <ruby>你好<rt>nǐ hǎo</rt></ruby>, back the meaning; "furigana": front 你好[nǐhǎo] for
// Anki's {{furigana:}} filter; "fields": three fields Hanzi / Pinyin / Meaning (+ tags).
const cell = (s) => String(s ?? '').replace(/\t/g, '    ').replace(/\r?\n/g, '<br>');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const meaning = (z) => [z.gloss, levelLabel(z.level)].filter(Boolean).join(' · ');
export const ANKI_FORMATS = [
  ['plain', 'Front and back'],
  ['ruby', 'Pinyin as ruby (over the characters)'],
  ['furigana', 'Anki furigana syntax 你好[nǐhǎo]'],
  ['fields', 'Chinese vocabulary: Hanzi / Pinyin / Meaning'],
];
export function ankiChinese(deck, cards, format = 'plain') {
  const name = cell(deck).replace(/<br>/g, ' ');
  const tag = (c) => [c.page ? `p${c.page}` : '', ...(cardZh(c)?.level ? [`HSK${Math.min(cardZh(c).level, 7)}`] : [])].filter(Boolean).join(' ');
  const kept = (cards || []).filter((c) => String(c.front ?? '').trim() && String(c.back ?? '').trim());
  if (format === 'fields') {
    return ['#separator:tab', '#html:true', `#deck:${name}`, '#columns:Hanzi\tPinyin\tMeaning\tTags', '#tags column:4',
      ...kept.map((c) => { const z = cardZh(c); return z ? `${cell(z.hanzi)}\t${cell(z.pinyin)}\t${cell(meaning(z))}\t${tag(c)}` : `${cell(c.front)}\t\t${cell(c.back)}\t${tag(c)}`; })].join('\n') + '\n';
  }
  const row = (c) => {
    const z = cardZh(c);
    if (!z || format === 'plain' || !z.pinyin) return `${cell(c.front)}\t${cell(c.back)}\t${tag(c)}`;
    const front = format === 'ruby' ? `<ruby>${esc(z.hanzi)}<rt>${esc(z.pinyin)}</rt></ruby>` : `${z.hanzi}[${z.pinyin.replace(/\s+/g, '')}]`;
    return `${cell(front)}\t${cell(meaning(z) || z.pinyin)}\t${tag(c)}`;
  };
  return ['#separator:tab', '#html:true', `#deck:${name}`, '#tags column:3', ...kept.map(row)].join('\n') + '\n';
}
