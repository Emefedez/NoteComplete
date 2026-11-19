// Vocabulary cards, Anki layouts and writing-practice characters (vocab.js), and the built
// dictionary end to end when it is there.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { cardBack, parseBack, cardZh, vocabWords, vocabCards, ankiChinese, deckHanzi, levelsIn, levelLabel, entryFor } from './vocab.js';
import { createEngine } from './engine.js';

const RUNS = [
  { start: 0, end: 2, text: '你好', pinyin: ['nǐ', 'hǎo'], level: 1 },
  { start: 2, end: 3, text: '，', pinyin: [], level: 0 },
  { start: 3, end: 5, text: '银行', pinyin: ['yín', 'háng'], level: 2 },
  { start: 5, end: 7, text: '你好', pinyin: ['nǐ', 'hǎo'], level: 1 },
  { start: 7, end: 9, text: '好笑', pinyin: ['hǎo', 'xiào'], level: 0 },
];
const LOOKUPS = new Map([
  ['你好', { entries: [{ simp: '你好', trad: '你好', pinyin: 'nǐ hǎo', gloss: ['hello; hi'], level: 0 }] }],
  ['银行', { entries: [{ simp: '银行', trad: '銀行', pinyin: 'yín xíng', gloss: ['wrong reading'], level: 0 }, { simp: '银行', trad: '銀行', pinyin: 'yín háng', gloss: ['bank'], level: 2 }] }],
  ['好笑', { entries: [{ simp: '好笑', trad: '好笑', pinyin: 'hǎo xiào', gloss: ['funny'], level: 7 }] }],
]);

test('card back: pinyin — gloss · HSK n, and back again', () => {
  assert.equal(cardBack({ pinyin: 'nǐ hǎo', gloss: 'hello', level: 1 }), 'nǐ hǎo — hello · HSK 1');
  assert.equal(cardBack({ pinyin: 'nǐ hǎo', gloss: '' }), 'nǐ hǎo');
  assert.equal(cardBack({ pinyin: 'hǎo xiào', gloss: 'funny', level: 8 }), 'hǎo xiào — funny · HSK 7–9');
  assert.equal(levelLabel(0), '');
  assert.deepEqual(parseBack('nǐ hǎo — hello · HSK 1'), { pinyin: 'nǐ hǎo', gloss: 'hello', level: 1 });
  assert.deepEqual(parseBack('hǎo xiào — funny · HSK 7–9'), { pinyin: 'hǎo xiào', gloss: 'funny', level: 7 });
  assert.deepEqual(parseBack('nǐ hǎo'), { pinyin: 'nǐ hǎo', gloss: '', level: 0 });
  // A gloss with a dash of its own keeps it.
  assert.deepEqual(parseBack('a — b — c'), { pinyin: 'a', gloss: 'b — c', level: 0 });
});

test('every word once, glossed by its reading, filtered by level', () => {
  const words = vocabWords(RUNS, LOOKUPS);
  assert.deepEqual(words.map((w) => w.hanzi), ['你好', '银行', '好笑']);
  assert.equal(words[1].gloss, 'bank', 'the entry of the reading used (háng), not the first');
  assert.equal(words[2].level, 7, 'a level from the dictionary when annotate has none');
  assert.deepEqual(vocabWords(RUNS, LOOKUPS, { levels: [1] }).map((w) => w.hanzi), ['你好']);
  assert.deepEqual(vocabWords(RUNS, new Map(), { levels: [0] }).map((w) => w.hanzi), ['好笑']);
  const [card] = vocabCards(RUNS, LOOKUPS);
  assert.deepEqual(card, { front: '你好', back: 'nǐ hǎo — hello; hi · HSK 1', zh: { hanzi: '你好', pinyin: 'nǐ hǎo', gloss: 'hello; hi', level: 1 } });
  assert.equal(entryFor(null), null);
});

test('a card read as it is now: edits win over the saved fields', () => {
  assert.deepEqual(cardZh({ front: '你好', back: 'nǐ hǎo — hi there', zh: { hanzi: '你好', pinyin: 'nǐ hǎo', gloss: 'hello', level: 1 } }), { hanzi: '你好', pinyin: 'nǐ hǎo', gloss: 'hi there', level: 1 });
  assert.equal(cardZh({ front: 'What is 你好?', back: 'hello' }), null, 'a question with Chinese in it is not a word card');
  assert.equal(cardZh({ front: 'Photosynthesis', back: 'x' }), null);
  assert.deepEqual(cardZh({ front: '银行', back: 'yín háng — bank · HSK 2' }), { hanzi: '银行', pinyin: 'yín háng', gloss: 'bank', level: 2 });
});

test('Anki: plain, ruby, furigana and three fields', () => {
  const cards = [...vocabCards(RUNS, LOOKUPS), { front: 'Capital of France?', back: 'Paris', page: 3 }, { front: '', back: 'empty' }];
  const plain = ankiChinese('Deck\tone', cards, 'plain').split('\n');
  assert.deepEqual(plain.slice(0, 4), ['#separator:tab', '#html:true', '#deck:Deck    one', '#tags column:3']);
  assert.equal(plain[4], '你好\tnǐ hǎo — hello; hi · HSK 1\tHSK1');
  assert.equal(plain[7], 'Capital of France?\tParis\tp3');
  assert.equal(plain.length, 9, 'the empty card left out; ends with a newline');
  const ruby = ankiChinese('D', cards, 'ruby').split('\n');
  assert.equal(ruby[4], '<ruby>你好<rt>nǐ hǎo</rt></ruby>\thello; hi · HSK 1\tHSK1');
  assert.equal(ruby[7], 'Capital of France?\tParis\tp3', 'other cards as they are');
  const furigana = ankiChinese('D', cards, 'furigana').split('\n');
  assert.equal(furigana[4], '你好[nǐhǎo]\thello; hi · HSK 1\tHSK1');
  assert.equal(furigana[5], '银行[yínháng]\tbank · HSK 2\tHSK2');
  const fields = ankiChinese('D', cards, 'fields').split('\n');
  assert.deepEqual(fields.slice(3, 5), ['#columns:Hanzi\tPinyin\tMeaning\tTags', '#tags column:4']);
  assert.equal(fields[5], '你好\tnǐ hǎo\thello; hi · HSK 1\tHSK1');
  assert.equal(fields[7], '好笑\thǎo xiào\tfunny · HSK 7–9\tHSK7');
  assert.equal(fields[8], 'Capital of France?\t\tParis\tp3');
  // Line breaks and tabs in a cell stay inside it.
  assert.match(ankiChinese('D', [{ front: '好', back: 'hǎo — good\nfine' }], 'fields'), /好\thǎo\tgood<br>fine\t\n$/);
});

test('characters for writing practice, by level', () => {
  const cards = vocabCards(RUNS, LOOKUPS);
  assert.deepEqual(deckHanzi(cards).map((c) => c.char), ['你', '好', '银', '行', '笑']);
  assert.deepEqual(deckHanzi(cards)[3], { char: '行', pinyin: 'háng', level: 2 });
  assert.deepEqual(deckHanzi(cards, { levels: [2] }).map((c) => c.char), ['银', '行']);
  assert.deepEqual(levelsIn([...cards, { front: 'x', back: 'y' }]), [1, 2, 7]);
});

const VENDOR = new URL('../vendor/chinese/', import.meta.url);
test('vocabulary cards from the built dictionary', { skip: !existsSync(new URL('chars.bin', VENDOR)) && 'not built' }, () => {
  const buf = (n) => { const b = readFileSync(new URL(n, VENDOR)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const e = createEngine({ ime: buf('ime-core.bin') });
  e.setChars(buf('chars.bin'));
  const text = '我不知道银行在哪里。';
  const runs = e.annotate(text, { script: 'simplified' });
  const lookups = new Map(runs.map((r) => [r.text, e.lookup(r.text, { script: 'simplified' })]));
  const cards = vocabCards(runs, lookups);
  const bank = cards.find((c) => c.front === '银行');
  assert.ok(bank, 'a card for 银行');
  assert.match(bank.back, /^yín háng — \S/);
  assert.ok(cards.every((c) => c.back.trim()));
});
