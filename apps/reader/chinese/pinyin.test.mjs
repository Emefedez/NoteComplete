import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { SYLLABLES, SYLLABLE_LIST, normalise, markTone, numbersToMarks, marksToNumbers, segment, splitInput, readingOf, hasMarkedPinyin } from './pinyin.js';

test('the syllable table', () => {
  assert.equal(new Set(SYLLABLE_LIST).size, SYLLABLE_LIST.length);
  for (const s of ['lü', 'nüe', 'lüe', 'r', 'ê', 'm', 'n', 'ng', 'hm', 'hng', 'zhuang', 'er']) assert.ok(SYLLABLES.has(s), s);
  assert.ok(SYLLABLE_LIST.length > 400);
  assert.equal(SYLLABLE_LIST[0], 'a'); // ids are indexes; the order is frozen
  assert.ok(Object.isFrozen(SYLLABLE_LIST));
});

test('normalise', () => {
  assert.equal(normalise('Lv3'), 'lü3');
  assert.equal(normalise('lu:4'), 'lü4');
  assert.equal(normalise('NV3'), 'nü3');
  assert.equal(normalise('jv2'), 'ju2');
  assert.equal(normalise('nǚ'), 'nü3');
  assert.equal(normalise('nǐ hǎo'), 'ni3 hao3');
});

test('markTone follows the placement rules', () => {
  const cases = { hao3: 'hǎo', mei2: 'méi', xue3: 'xuě', dou3: 'dǒu', zhou1: 'zhōu', liu4: 'liù', jiu3: 'jiǔ', dui4: 'duì', hui2: 'huí',
    lv4: 'lǜ', 'lu:4': 'lǜ', 'lü4': 'lǜ', nve4: 'nüè', ju2: 'jú', er2: 'ér', ma5: 'ma', ma0: 'ma', ng2: 'ńg', Ni3: 'Nǐ', A1: 'Ā', lüe4: 'lüè' };
  for (const [k, v] of Object.entries(cases)) assert.equal(markTone(k.slice(0, -1), +k.at(-1)), v, k);
  assert.equal(markTone('hao', null), 'hao');
});

test('numbersToMarks and marksToNumbers', () => {
  assert.equal(numbersToMarks('ni3 hao3, Zhong1guo2'), 'nǐ hǎo, Zhōngguó');
  assert.equal(numbersToMarks('ni3hao3'), 'nǐhǎo');
  assert.equal(numbersToMarks('lv4se4'), 'lǜsè');
  assert.equal(numbersToMarks('MP3 and h2o'), 'MP3 and h2o');
  assert.equal(marksToNumbers('nǐ hǎo'), 'ni3 hao3');
  assert.equal(marksToNumbers('Zhōngguó'), 'Zhong1guo2');
  assert.equal(marksToNumbers('lǜsè, plain text'), 'lü4se4, plain text');
  assert.equal(marksToNumbers("Xī'ān"), "Xi1'an1");
});

test('round trip over every syllable and tone', () => {
  for (const s of SYLLABLE_LIST) for (const t of [1, 2, 3, 4, 5]) {
    const marked = markTone(s, t);
    const back = marksToNumbers(marked);
    assert.equal(back, t === 5 || marked === s ? s : s + t, `${s}${t}`);
    assert.equal(numbersToMarks(back), marked, `${s}${t}`);
  }
});

test('segment', () => {
  assert.deepEqual(segment('nihao')[0], ['ni', 'hao']);
  const xian = segment('xian');
  assert.deepEqual(xian[0], ['xian']);
  assert.deepEqual(xian[1], ['xi', 'an']);
  assert.deepEqual(segment("xi'an")[0], ['xi', 'an']);
  assert.deepEqual(segment("Xi'an")[0], ['Xi', 'an']);
  const fangan = segment('fangan').map(p => p.join(' '));
  assert.equal(fangan[0], 'fan gan');
  assert.ok(fangan.includes('fang an'));
  assert.deepEqual(segment('zhuang')[0], ['zhuang']);
  assert.deepEqual(segment('zh')[0], ['zh']);
  assert.equal(segment('zh', { partial: false }), null);
  assert.equal(segment('qqq'), null);
  assert.deepEqual(segment('jintiantianqihenhao')[0], ['jin', 'tian', 'tian', 'qi', 'hen', 'hao']);
  assert.deepEqual(segment('lvse')[0], ['lü', 'se']);
});

test('splitInput', () => {
  assert.deepEqual(splitInput('ni3hao'), [{ syl: 'ni', tone: 3 }, { syl: 'hao', tone: null }]);
  assert.deepEqual(splitInput('zhongg'), [{ syl: 'zhong', tone: null }, { syl: 'g', tone: null, partial: true }]);
  assert.deepEqual(splitInput("xi'an1"), [{ syl: 'xi', tone: null }, { syl: 'an', tone: 1 }]);
  assert.equal(splitInput('qqq')[0].invalid, true);
  assert.equal(readingOf('ni3hao3'), 'nǐ hǎo');
  assert.ok(hasMarkedPinyin('wǒ shì'));
  assert.ok(!hasMarkedPinyin('cafe'));
});
