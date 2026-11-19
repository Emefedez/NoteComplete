// The pure parts of the character panel (lookup-panel.js), its entry points (zh-menu.js) and
// the convert dialog's model (convert-dialog.js).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { readingsFor, meaningsOf, formsOf, lowestLevel, toneOf } from './lookup-panel.js';
import { charAround, wordAround, boxIndex, rubyIndex, lookupLabel, lookupable } from './zh-menu.js';
import { guessDirection, partsText, ambiguousAt, choose, changes } from './convert-dialog.js';
import { decodeOpenCC, convertParts } from './convert.js';

const HAO = {
  entries: [
    { simp: '好', trad: '好', pinyin: 'hǎo', gloss: ['good'], level: 1 },
    { simp: '好', trad: '好', pinyin: 'hào', gloss: ['to be fond of'], level: 1 },
  ],
  char: { char: '好', readings: [{ pinyin: 'hǎo', count: 6060 }, { pinyin: 'hāo', count: 142 }, { pinyin: 'hào', count: 115 }], variants: { simp: '', trad: '', other: '' } },
};
const NI = {
  entries: [
    { simp: '你', trad: '你', pinyin: 'nǐ', gloss: ['you'], level: 1 },
    { simp: '你', trad: '妳', pinyin: 'nǐ', gloss: ['you (female)'], level: 1 },
  ],
  char: { char: '你', readings: [{ pinyin: 'nǐ', count: 1 }], variants: { simp: '', trad: '', other: '伱妳您' } },
};

test('readings: the one used here first', () => {
  assert.deepEqual(readingsFor(HAO).map((r) => r.pinyin), ['hǎo', 'hāo', 'hào']);
  assert.deepEqual(readingsFor(HAO, 'hào'), [{ pinyin: 'hào', here: true }, { pinyin: 'hǎo', here: false }, { pinyin: 'hāo', here: false }]);
  assert.deepEqual(readingsFor({ entries: [{ pinyin: 'nǐ hǎo' }] }).map((r) => r.pinyin), ['nǐ hǎo'], 'a word: its entries');
  assert.deepEqual(readingsFor({ entries: [] }, 'zì'), [{ pinyin: 'zì', here: true }]);
  assert.deepEqual([toneOf('mā'), toneOf('má'), toneOf('mǎ'), toneOf('mà'), toneOf('ma'), toneOf('lǜ')], [1, 2, 3, 4, 5, 4]);
});

test('meanings by reading, forms and level', () => {
  assert.deepEqual(meaningsOf(HAO, '好').map((m) => [m.pinyin, m.gloss.join()]), [['hǎo', 'good'], ['hào', 'to be fond of']]);
  const ni = meaningsOf(NI, '你');
  assert.equal(ni.length, 1, 'one reading, one row');
  assert.deepEqual(ni[0].gloss, ['you', 'you (female)']);
  assert.deepEqual(ni[0].forms, ['妳']);
  assert.deepEqual(formsOf(NI, '你'), [{ label: 'Traditional', chars: ['妳'] }, { label: 'Variants', chars: ['伱', '您'] }]);
  assert.deepEqual(formsOf({ entries: [{ simp: '发', trad: '發' }, { simp: '发', trad: '髮' }] }, '发'), [{ label: 'Traditional', chars: ['發', '髮'] }]);
  assert.deepEqual(formsOf(HAO, '好'), []);
  assert.equal(lowestLevel({ entries: [{ level: 0 }, { level: 3 }, { level: 2 }] }), 2);
});

test('the character and word at a place', () => {
  assert.deepEqual(charAround('a你好', 2), { char: '好', start: 2, end: 3 });
  assert.deepEqual(charAround('x𠀀y', 2), { char: '𠀀', start: 1, end: 3 }, 'the low half of a pair: the whole character');
  assert.equal(charAround('ab', 5), null);
  const runs = [{ start: 0, end: 2, text: '银行' }, { start: 2, end: 3, text: '在' }];
  assert.equal(wordAround(runs, 1).text, '银行');
  assert.equal(wordAround(runs, 3), null);
  assert.equal(lookupLabel('你好'), 'Look up 你好');
  assert.equal(lookupLabel('一二三四五六七八九'), 'Look up 一二三四五六七八…');
  assert.ok(lookupable(' 你好 ') && !lookupable('你 好') && !lookupable('hello') && !lookupable('一二三四五六七八九'));
});

test('a drawn line back to its text box', () => {
  // Wrapped: "我喜欢学习中文" drawn as "我喜欢学" + "习中文", then a second paragraph.
  const box = '我喜欢学习中文\n你好', lines = ['我喜欢学', '习中文', '你好'];
  assert.equal(boxIndex(box, lines, 1, 1), 5);
  assert.equal(box[boxIndex(box, lines, 2, 1)], '好');
  assert.equal(boxIndex(box, ['别的'], 0, 0), -1, 'a line the box no longer has');
  // ruby.js counts each drawn line plus one.
  assert.equal(rubyIndex(lines, 2, 1), 4 + 1 + 3 + 1 + 1);
  assert.equal(rubyIndex(lines, 0, 2), 2);
});

const PARTS = [{ text: '头发', source: '頭髮' }, { text: '干', source: '乾', alternatives: ['干', '乾'] }, { text: '了', source: '了' }];
test('convert dialog model', () => {
  assert.equal(guessDirection('头发', '頭髮', '头发'), 's2t');
  assert.equal(guessDirection('頭髮', '頭髮', '头发'), 't2s');
  assert.equal(guessDirection('abc', 'abc', 'abc'), 's2t');
  assert.equal(partsText(PARTS), '头发干了');
  assert.deepEqual(ambiguousAt(PARTS), [1]);
  const chosen = choose(PARTS, 1, '乾');
  assert.equal(partsText(chosen), '头发乾了');
  assert.equal(PARTS[1].text, '干', 'not changed in place');
  assert.equal(partsText(choose(PARTS, 1, '幹')), '头发干了', 'only one of its alternatives');
  assert.equal(changes(PARTS), 3);
  assert.equal(changes(chosen), 2);
  assert.equal(changes([{ text: 'abc', source: 'abc' }]), 0);
});

const OPENCC = new URL('../vendor/chinese/opencc.bin', import.meta.url);
test('convert dialog over the built tables', { skip: !existsSync(OPENCC) && 'not built' }, () => {
  const t = decodeOpenCC(readFileSync(OPENCC));
  const parts = convertParts('頭髮乾了', 't2s', t);
  assert.equal(partsText(parts), '头发干了');
  const at = ambiguousAt(parts);
  assert.ok(at.length >= 1, 'a character with more than one simplified form');
  assert.equal(partsText(choose(parts, at[0], parts[at[0]].alternatives.at(-1))).length, 4);
});
