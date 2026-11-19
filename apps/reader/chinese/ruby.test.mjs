import test from 'node:test';
import assert from 'node:assert/strict';
import { rubyChars, rubySegments, rubyLabel, toneOf } from './ruby.js';

// annotate("我不知道银行在哪里") as client.js answers it (§15 contract).
const text = '我不知道银行在哪里';
const annotations = [
  { start: 0, end: 1, text: '我', pinyin: ['wǒ'], level: 1 },
  { start: 1, end: 4, text: '不知道', pinyin: ['bù', 'zhī', 'dào'], level: 1 },
  { start: 4, end: 6, text: '银行', pinyin: ['yín', 'háng'], level: 3 },
  { start: 6, end: 7, text: '在', pinyin: ['zài'], level: 1 },
  { start: 7, end: 9, text: '哪里', pinyin: ['nǎ', 'lǐ'], level: 1 },
];

test('every character gets its reading, 行 háng in 银行', () => {
  const chars = rubyChars(text, annotations);
  assert.equal(chars.length, 9);
  assert.deepEqual(chars[5], { index: 5, char: '行', pinyin: 'háng' });
  assert.deepEqual(chars.slice(7).map(c => c.pinyin), ['nǎ', 'lǐ']);
});

test('a reading chosen for one place wins; words below the level stay bare', () => {
  assert.equal(rubyChars(text, annotations, { overrides: new Map([[5, 'xíng']]) })[5].pinyin, 'xíng');
  const hard = rubyChars(text, annotations, { minLevel: 2 });
  assert.deepEqual(hard.map(c => c.char).join(''), '银行');
  // Words of no level (not in HSK) always get pinyin.
  assert.equal(rubyChars('龘', [{ start: 0, end: 1, text: '龘', pinyin: ['dá'], level: 0 }], { minLevel: 6 }).length, 1);
});

test('segments keep the text between readings, also characters outside the BMP', () => {
  const mixed = 'A 你好, 𠀀!';
  const chars = rubyChars(mixed, [{ start: 2, end: 4, text: '你好', pinyin: ['nǐ', 'hǎo'], level: 1 }, { start: 6, end: 8, text: '𠀀', pinyin: ['qiū'], level: 0 }]);
  assert.deepEqual(rubySegments(mixed, chars), ['A ', { char: '你', pinyin: 'nǐ' }, { char: '好', pinyin: 'hǎo' }, ', ', { char: '𠀀', pinyin: 'qiū' }, '!']);
});

test('tone numbers and tones', () => {
  assert.equal(rubyLabel('hǎo', 'numbers'), 'hao3');
  assert.equal(rubyLabel('ma', 'numbers'), 'ma5');
  assert.equal(rubyLabel('lǜ', 'marks'), 'lǜ');
  assert.deepEqual(['zhōng', 'guó', 'nǐ', 'shì', 'de'].map(toneOf), [1, 2, 3, 4, 5]);
});

test('setRuby overrides note "off" state even before Han text is seen and sets aria-pressed', async () => {
  const { configureRuby, noteOpened, setRuby, rubyOn, refreshRuby } = await import('./ruby.js');
  const saved = [];
  const attrs = new Map();
  const toggle = { setAttribute: (k, v) => attrs.set(k, v) };
  globalThis.document = { getElementById: (id) => (id === 'zhRubyToggle' ? toggle : null) };
  configureRuby({
    getNote: async () => ({ ruby: 'off' }),
    setNote: async (next) => { saved.push(next); },
    roots: () => [],
  });
  await noteOpened();
  assert.equal(rubyOn(), false);
  setRuby(true);
  await Promise.resolve();
  assert.equal(rubyOn(), true);
  assert.deepEqual(saved, [{ ruby: 'on' }]);
  refreshRuby();
  assert.equal(attrs.get('aria-pressed'), 'true');
});
