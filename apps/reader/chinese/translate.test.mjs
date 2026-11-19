// Translation of selections, Spanish meanings and the colour matching (chinese/translate.js).
import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { translate, translateMany, localizeLookup, isPinyin, pinyinToHanzi, alignWords, forgetTranslations, SERVICES } from './translate.js';

const json = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => body });
const google = (text) => [[[text, 'x', null, null]]];
beforeEach(() => forgetTranslations());

test('a sentence goes to the first service, and is asked once', async () => {
  const urls = [];
  const fetch = (url) => { urls.push(url); return json(google('Me gusta aprender chino')); };
  const out = await translate('我喜欢学中文', { to: 'es', fetch });
  assert.deepEqual(out, { text: 'Me gusta aprender chino', by: 'Google' });
  assert.match(urls[0], /sl=zh-CN&tl=es/);
  await translate('我喜欢学中文', { to: 'es', fetch });
  assert.equal(urls.length, 1, 'the second time comes from the cache');
});

test('when the first service fails the second answers; none answering is an error', async () => {
  const fetch = (url) => (url.includes('googleapis') ? json({}, false, 429) : json({ responseStatus: 200, responseData: { translatedText: 'I like it' } }));
  assert.deepEqual(await translate('我喜欢', { to: 'en', fetch }), { text: 'I like it', by: 'MyMemory' });
  await assert.rejects(translate('好', { to: 'en', fetch: () => json({}, false, 500) }), /No translation service answered/);
});

test('MyMemory is skipped for text over its 500-byte limit', () => {
  assert.equal(SERVICES[1].fits('好'.repeat(160)), true);
  assert.equal(SERVICES[1].fits('好'.repeat(200)), false);
});

test('several words go in one request, one per line', async () => {
  let calls = 0;
  const fetch = (url) => { calls++; const q = decodeURIComponent(new URL(url).searchParams.get('q')); return json(google(q.split('\n').map((l) => `<${l}>`).join('\n'))); };
  assert.deepEqual(await translateMany(['喜欢', '学', '喜欢'], { to: 'es', fetch }), ['<喜欢>', '<学>', '<喜欢>']);
  assert.equal(calls, 1);
  // A service that merges the lines: each is asked alone.
  forgetTranslations();
  let n = 0;
  const merging = () => { n++; return json(google(n === 1 ? 'merged' : `w${n}`)); };
  assert.deepEqual(await translateMany(['一', '二'], { to: 'es', fetch: merging }), ['w2', 'w3']);
});

test('a look-up keeps English for en and has its meanings in Spanish for es', async () => {
  const result = { entries: [{ simp: '好', pinyin: 'hǎo', gloss: ['good', 'well'] }], words: [{ text: '好人', gloss: 'good person' }], char: { definition: 'good' } };
  assert.equal(await localizeLookup(result, 'en'), result);
  const es = { good: 'bueno', well: 'bien', 'good person': 'buena persona' };
  const fetch = (url) => { const q = decodeURIComponent(new URL(url).searchParams.get('q')); return json(google(q.split('\n').map((l) => es[l]).join('\n'))); };
  const out = await localizeLookup(result, 'es', { fetch });
  assert.deepEqual(out.entries[0].gloss, ['bueno', 'bien']);
  assert.equal(out.words[0].gloss, 'buena persona');
  assert.equal(out.char.definition, 'bueno');
  assert.deepEqual(result.entries[0].gloss, ['good', 'well'], 'the original is not changed');
});

test('pinyin is told from English and from Chinese', () => {
  for (const t of ['nǐ hǎo', 'Wǒ xǐhuan xué zhōngwén', 'ni3 hao3', 'ni3hao3 ma5']) assert.equal(isPinyin(t), true, t);
  for (const t of ['hello there', 'he is', '你好', 'nihao', 'mama mia', 'la canción de él']) assert.equal(isPinyin(t), false, t);
});

test('pinyin becomes characters with the best candidate for each part', async () => {
  const dict = { 'ni3 hao3': ['你好', 8], 'ni3': ['你', 3] };
  const candidates = async (input) => {
    for (const [k, [text, consumed]] of Object.entries(dict)) if (input.startsWith(k)) return { items: [{ text, consumed }] };
    return { items: [] };
  };
  assert.equal(await pinyinToHanzi('nǐ hǎo', candidates), '你好');
  assert.equal(await pinyinToHanzi('xyz', candidates), '');
});

test('words are matched to the parts of the translation they mean', () => {
  const words = [
    { text: '我', meanings: ['I', 'me', 'yo'] },
    { text: '喜欢', meanings: ['gustar', 'to like; to be fond of'] },
    { text: '学', meanings: ['aprender', 'to learn; to study'] },
    { text: '中文', meanings: ['chino', 'Chinese language'] },
    { text: '。', meanings: [] },
  ];
  const tr = 'Me gusta aprender chino.';
  const got = alignWords(words, tr).map(({ word, start, end }) => [words[word].text, tr.slice(start, end)]);
  assert.deepEqual(got, [['我', 'Me'], ['喜欢', 'gusta'], ['学', 'aprender'], ['中文', 'chino']]);
  // English, with dictionary meanings only; a word used once.
  const en = 'I like studying Chinese';
  const got2 = alignWords([{ text: '我', meanings: ['I; me'] }, { text: '喜欢', meanings: ['to like'] }, { text: '学', meanings: ['to study'] }, { text: '中文', meanings: ['Chinese (language)'] }], en)
    .map(({ start, end }) => en.slice(start, end));
  assert.deepEqual(got2, ['I', 'like', 'studying', 'Chinese']);
});
