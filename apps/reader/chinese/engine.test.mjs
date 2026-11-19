// The dictionary engine on the fixture pack (test-fixtures/, ≈ 230 entries built by
// tools/build_chinese_data.mjs --fixture), and on the real packs when they were built.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { createEngine } from './engine.js';
import { userDict, memoryStore } from './user-dict.js';
import { createClient } from './client.js';

const fixture = name => readFileSync(new URL(`./test-fixtures/${name}`, import.meta.url));
const make = () => createEngine({ ime: fixture('ime-fixture.bin'), chars: fixture('chars-fixture.bin') });
const texts = r => r.items.map(i => i.text);

test('nihao gives 你好 first; the reading has tone marks', () => {
  const r = make().candidates('nihao');
  assert.equal(r.items[0].text, '你好');
  assert.equal(r.items[0].pinyin, 'nǐ hǎo');
  assert.equal(r.items[0].consumed, 5);
  assert.equal(r.reading, 'ni hao');
  assert.equal(r.rest, '');
  assert.equal(make().candidates('ni3hao').reading, 'nǐ hao');
});

test('a tone digit filters candidates (ma3: 马 码 蚂, not 妈 or 吗 ma5)', () => {
  const r = make().candidates('ma3');
  const whole = r.items.filter(i => i.consumed === 3);
  assert.ok(whole.length);
  assert.ok(whole.every(i => i.pinyin === 'mǎ'), whole.map(i => i.pinyin).join());
  for (const ch of ['马', '码', '蚂']) assert.ok(texts(r).includes(ch), ch);
  assert.ok(!whole.some(i => i.text === '妈'));
});

test('the sentence candidate and partial choice', () => {
  const e = make(), r = e.candidates('wobuzhidao');
  assert.equal(r.items[0].text, '我不知道');
  assert.equal(r.items[0].sentence, true);
  assert.equal(r.items[0].consumed, 10);
  const wo = r.items.find(i => i.text === '我');
  assert.equal(wo.consumed, 2);
  const rest = e.candidates('wobuzhidao'.slice(wo.consumed));
  assert.equal(rest.items[0].text, '不知道');
  // A whole-input word is not repeated as a sentence.
  assert.ok(!e.candidates('nihao').items.some(i => i.sentence));
});

test('an apostrophe and a partial last syllable', () => {
  const e = make();
  assert.equal(e.candidates("xi'an").items[0].text, '西安');
  const r = e.candidates('ni h');
  assert.equal(r.items[0].text, '你好');
  assert.equal(r.items[0].consumed, 4);
  assert.equal(e.candidates('qqq').items.length, 0);
  assert.equal(e.candidates('nihaoqqq').rest, 'qqq');
});

test('per-reading weights put 先 above 见 for xian', () => {
  const t = texts(make().candidates('xian'));
  assert.ok(t.indexOf('先') >= 0 && t.indexOf('见') >= 0);
  assert.ok(t.indexOf('先') < t.indexOf('见'), t.join(' '));
});

test('traditional output ranks 後 for hou4 and 以後 for yihou; duplicates merge', () => {
  const e = make();
  assert.equal(e.candidates('hou4', { script: 'traditional' }).items[0].text, '後');
  assert.equal(e.candidates('yihou', { script: 't' }).items[0].text, '以後');
  assert.equal(e.candidates('yihou', { script: 's' }).items[0].text, '以后');
  const hou = texts(e.candidates('hou4'));
  assert.equal(hou.filter(t => t === '后').length, 1);
});

test('user history moves 得 above 的 after 3 choices', async () => {
  const e = make(), dict = userDict({ chosen: memoryStore(), words: memoryStore() });
  const before = texts(e.candidates('de'));
  assert.ok(before.indexOf('的') < before.indexOf('得'));
  const de = e.candidates('de').items.find(i => i.text === '得');
  for (let i = 0; i < 3; i++) e.learn(await dict.choose(de, 'simplified'));
  const after = texts(e.candidates('de'));
  assert.ok(after.indexOf('得') < after.indexOf('的'), after.join(' '));
  // The same rows given at start (setUser) do the same.
  const fresh = make();
  fresh.setUser(await dict.all());
  assert.equal(texts(fresh.candidates('de'))[0], '得');
});

test('a sequence chosen twice becomes a word', async () => {
  const e = make(), dict = userDict({ chosen: memoryStore(), words: memoryStore() });
  const joined = { text: '小明', pinyin: 'xiǎo míng' };
  e.learn(await dict.choose(joined, 's', { word: true }));
  assert.ok(!e.candidates('xiaoming').items.some(i => i.text === '小明' && !i.sentence));
  e.learn(await dict.choose(joined, 's', { word: true }));
  assert.ok(e.candidates('xiaoming').items.some(i => i.text === '小明' && !i.sentence));
});

test('annotate: words of Han runs with their most frequent reading', () => {
  const a = make().annotate('我不知道银行在哪里。OK');
  const by = Object.fromEntries(a.map(w => [w.text, w]));
  assert.deepEqual(by['银行'].pinyin, ['yín', 'háng']);
  assert.deepEqual(by['哪里'].pinyin, ['nǎ', 'lǐ']);
  assert.equal(a.map(w => w.text).join(''), '我不知道银行在哪里');
  assert.deepEqual([by['银行'].start, by['银行'].end], [4, 6]);
  assert.ok(a.every(w => w.pinyin.length === [...w.text].length));
  assert.ok(by['我'].level >= 1);
});

test('lookup: entries, words containing the character, character data', () => {
  const l = make().lookup('好');
  assert.ok(l.entries.some(e => e.pinyin === 'hǎo' && e.gloss.length));
  assert.ok(l.words.some(w => w.text === '你好'));
  assert.equal(l.char.strokes, 6);
  assert.equal(l.char.radical.char, '女');
  assert.equal(l.char.decomposition, '⿰女子');
  assert.ok(l.char.readings.some(r => r.pinyin === 'hǎo'));
  const hou = make().lookup('后');
  assert.ok(hou.char.variants.trad.includes('後'));
  assert.ok(make().lookup('後').entries.some(e => e.simp === '后'));
});

test('expansions add words and levels', () => {
  const e = make();
  e.setExpansions([{ simp: '好好', trad: '好好', n: 'hao3 hao3', gloss: 'well', level: 4 }, { simp: '尼好', trad: '尼好', n: 'ni2 hao3', gloss: 'test word', level: 6 }]);
  const r = e.candidates('nihao');
  const extra = r.items.find(i => i.text === '尼好');
  assert.ok(extra);
  assert.equal(extra.level, 6);
  assert.ok(e.lookup('尼好').entries.length);
  e.setExpansions([]);
  assert.ok(!e.candidates('nihao').items.some(i => i.text === '尼好'));
});

test('client: lazy worker, stale answers dropped, choices learnt', async () => {
  let made = 0;
  const posted = [];
  const createWorker = () => {
    made++;
    const engine = make(), w = {
      postMessage(msg) {
        posted.push(msg.op);
        const ops = { candidates: (i, o) => engine.candidates(i, o), user: rows => engine.setUser(rows), learn: row => engine.learn(row), expansions: rows => engine.setExpansions(rows), info: () => ({ words: engine.pack.rows, bytes: 1 }) };
        setTimeout(() => w.onmessage({ data: { id: msg.id, result: ops[msg.op](...msg.args) } }), msg.op === 'candidates' && msg.args[0] === 'ni' ? 20 : 1);
      },
    };
    return w;
  };
  const packs = { installedWords: async () => [], packs: async () => [] };
  const client = createClient({ createWorker, dict: userDict({ chosen: memoryStore(), words: memoryStore() }), packs });
  assert.equal(made, 0);
  const slow = client.candidates('ni'), fast = client.candidates('nihao');
  assert.equal(await slow, null);
  assert.equal((await fast).items[0].text, '你好');
  assert.equal(made, 1);
  assert.equal(posted[0], 'user');
  const de = (await client.candidates('de')).items.find(i => i.text === '得');
  for (let i = 0; i < 3; i++) await client.choose('de', de, 'simplified');
  assert.equal((await client.candidates('de')).items[0].text, '得');
});

// The real packs (tools/build_chinese_data.mjs); skipped when they were not built.
const vendor = new URL('../vendor/chinese/', import.meta.url);
const real = existsSync(new URL('ime-core.bin', vendor)) && existsSync(new URL('chars.bin', vendor));
test('the built ime-core.bin', { skip: !real && 'vendor/chinese not built' }, () => {
  const e = createEngine({ ime: readFileSync(new URL('ime-core.bin', vendor)), chars: readFileSync(new URL('chars.bin', vendor)) });
  assert.equal(e.candidates('nihao').items[0].text, '你好');
  const s = e.candidates('wobuzhidao').items[0];
  assert.equal(s.text, '我不知道'); assert.equal(s.sentence, true);
  assert.equal(e.candidates('jintiantianqihenhao').items[0].text, '今天天气很好');
  const xian = texts(e.candidates('xian'));
  assert.ok(xian.indexOf('先') < xian.indexOf('见'), xian.slice(0, 10).join(' '));
  assert.ok(e.candidates('ma3').items.filter(i => i.consumed === 3).every(i => i.pinyin === 'mǎ'));
  assert.equal(e.candidates('ma3').items[0].text, '马'); // not 吗, whose mǎ is only used in 吗啡
  assert.equal(e.candidates('hou4', { script: 'traditional' }).items[0].text, '後');
  const a = Object.fromEntries(e.annotate('我不知道银行在哪里').map(w => [w.text, w.pinyin.join('')]));
  assert.equal(a['银行'], 'yínháng');
  assert.equal(a['哪里'], 'nǎlǐ');
  assert.equal(e.lookup('行').char.readings[0].pinyin, 'xíng');
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) e.candidates('woxihuanxuexizhongwen');
  assert.ok((performance.now() - t0) / 50 < 20, 'a keystroke stays far below a frame');
  // Single-letter syllables like n/m/r fall back to partial prefix matching instead of empty lists.
  assert.ok(e.candidates('n').items.length > 0, 'typing n shows candidates without needing another letter');
  assert.ok(e.candidates('m').items.length > 0, 'typing m shows candidates');
});
