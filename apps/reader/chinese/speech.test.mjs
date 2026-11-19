// Pronunciation on demand (speech.js): which clip each request streams, in which order.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { syllableFile, sourcesFor, SYLLABLE_BASE } from './speech.js';

test('syllable recordings: tone digit, ü as v, none for the neutral tone', () => {
  assert.equal(syllableFile('nǐ'), 'ni3');
  assert.equal(syllableFile('hǎo'), 'hao3');
  assert.equal(syllableFile('Zhōng'), 'zhong1');
  assert.equal(syllableFile('nǚ'), 'nv3');
  assert.equal(syllableFile('lǜ'), 'lv4');
  assert.equal(syllableFile('ma'), '');
  assert.equal(syllableFile('nǐ hǎo'), '', 'only one syllable');
  assert.equal(syllableFile(''), '');
});

test('a character read a known way: its syllable first, then online TTS, then the system voice', () => {
  const s = sourcesFor('好', { reading: 'hào' });
  assert.equal(s[0].url, `${SYLLABLE_BASE}hao4.mp3`);
  assert.match(s[1].url, /^https:\/\/translate\.google\.com\/translate_tts\?.*tl=zh-CN.*q=%E5%A5%BD/);
  assert.match(s[2].url, /^https:\/\/dict\.youdao\.com\/dictvoice\?/);
  assert.deepEqual(s.at(-1), { kind: 'voice', text: '好', lang: 'zh-CN' });
});

test('words: no syllable recording; traditional script asks for zh-TW', () => {
  const s = sourcesFor('你好', { reading: 'nǐ hǎo', script: 'traditional' });
  assert.equal(s.length, 3);
  assert.match(s[0].url, /tl=zh-TW/);
  assert.equal(s[2].lang, 'zh-TW');
});

test('offline: only the system voice; pinyin alone is never sent to a Chinese voice', () => {
  assert.deepEqual(sourcesFor('你', { online: false }).map((x) => x.kind), ['voice']);
  assert.deepEqual(sourcesFor('', { reading: 'mā' }).map((x) => x.url), [`${SYLLABLE_BASE}ma1.mp3`]);
  assert.deepEqual(sourcesFor('', { reading: 'ma' }), []);
});

test('long text is cut to what online voices accept', () => {
  const s = sourcesFor('好'.repeat(500));
  assert.equal(s.at(-1).text.length, 180);
});
