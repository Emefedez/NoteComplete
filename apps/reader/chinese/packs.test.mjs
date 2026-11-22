// HSK expansion packs with a fake download and a Map store; the pack container round trip.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { packManager, extractLevels, parseCustomDictionary, forgetDownload, PACKS, HSK_URL } from './packs.js';
import { memoryStore } from './user-dict.js';
import { writeContainer, readContainer, encodeStrings } from './pack.js';

const LIST = [
  { s: '你好', l: ['n1', 't1'], f: [{ t: '你好', i: { n: 'ni3 hao3' }, m: ['hello'] }] },
  { s: '阿姨', l: ['t3', 'n4', 'o3'], f: [{ t: '阿姨', i: { n: 'a1 yi2' }, m: ['maternal aunt', 'step-mother'] }] },
  { s: '绿化', l: ['n5'], f: [{ t: '綠化', i: { n: 'lv4 hua4' }, m: ['to make green'] }] },
  { s: '呵护', l: ['t7', 'n7'], f: [{ t: '呵護', i: { n: 'he1 hu4' }, m: ['to bless'] }] },
  { s: '老字号', l: ['t6'], f: [{ t: '老字號', i: { n: 'lao3 zi4 hao4' }, m: ['old brand'] }] },
];
const bytes = new TextEncoder().encode(JSON.stringify(LIST));
const sha = createHash('sha256').update(bytes).digest('hex');
function fakeFetch(body = bytes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    let sent = false;
    return { ok: true, headers: { get: () => String(body.length) }, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: body }) }) } };
  };
  f.calls = calls;
  return f;
}

test('extractLevels: a word belongs to its lowest HSK 3.0 level; ü normalised', () => {
  assert.deepEqual(extractLevels(LIST, [4]).map(w => w.simp), ['阿姨']);
  assert.deepEqual(extractLevels(LIST, [5])[0], { simp: '绿化', trad: '綠化', n: 'lü4 hua4', gloss: 'to make green', level: 5 });
  assert.deepEqual(extractLevels(LIST, [7]).map(w => w.simp), ['呵护']);
  assert.equal(extractLevels(LIST, [6]).length, 0);
  assert.equal(extractLevels(LIST, [4])[0].gloss, 'maternal aunt; step-mother');
});

test('install, list and remove expansions; core is not removable', async () => {
  forgetDownload();
  const store = memoryStore(), fetch = fakeFetch(), progress = [];
  const pm = packManager({ store, fetch, sha256: sha, core: async () => ({ words: 38000, bytes: 1500000 }) });
  let list = await pm.packs();
  assert.deepEqual(list.map(p => p.id), PACKS.map(p => p.id));
  assert.deepEqual(list[0], { ...PACKS[0], installed: true, words: 38000, bytes: 1500000 });
  assert.ok(list.slice(1).every(p => !p.installed && !p.bundled));
  await pm.installPack('hsk4', p => progress.push(p.fraction));
  await pm.installPack('hsk7-9');
  assert.equal(fetch.calls.length, 1, 'the list is downloaded once');
  assert.equal(fetch.calls[0], HSK_URL);
  assert.equal(progress.at(-1), 1);
  list = await pm.packs();
  assert.equal(list.find(p => p.id === 'hsk4').installed, true);
  assert.equal(list.find(p => p.id === 'hsk4').words, 1);
  assert.deepEqual((await pm.installedWords()).map(w => w.simp).sort(), ['呵护', '阿姨'].sort());
  await pm.removePack('hsk4');
  assert.deepEqual((await pm.installedWords()).map(w => w.simp), ['呵护']);
  await assert.rejects(pm.removePack('core'));
  await assert.rejects(pm.installPack('hsk99'));
});

test('a download that does not match the checksum installs nothing', async () => {
  forgetDownload();
  const store = memoryStore();
  const pm = packManager({ store, fetch: fakeFetch(new TextEncoder().encode('[]')), sha256: sha });
  await assert.rejects(pm.installPack('hsk5'), /checksum/);
  assert.equal(store.map.size, 0);
  forgetDownload();
  const failing = packManager({ store, fetch: async () => ({ ok: false, status: 404 }), sha256: sha });
  await assert.rejects(failing.installPack('hsk5'), /404/);
  forgetDownload();
});

test('pack container round trip', () => {
  const out = writeContainer({ kind: 'x', rows: 3 }, [Uint16Array.of(1, 2, 3), ...encodeStrings(['你好', '', '𠀀a'])]);
  const p = readContainer(out.buffer);
  assert.equal(p.meta.kind, 'x');
  assert.deepEqual([...p.u16(1)], [1, 2, 3]);
  const s = p.strings(2, 3);
  assert.deepEqual([s.get(0), s.get(1), s.get(2)], ['你好', '', '𠀀a']);
  assert.throws(() => readContainer(new Uint8Array(16)), /Not a Chinese data pack/);
  const shifted = new Uint8Array(out.length + 1); shifted.set(out, 1);
  assert.equal(readContainer(shifted.subarray(1)).strings(2, 3).get(0), '你好');
});

test('local dictionary import parses CC-CEDICT, JSON, and TSV and persists in packManager', async () => {
  const cedict = '# comment\n中文 中文 [Zhong1 wen2] /Chinese language/\n電腦 电脑 [dian4 nao3] /computer/\n';
  assert.deepEqual(parseCustomDictionary(cedict), [
    { simp: '中文', trad: '中文', n: 'zhong1 wen2', gloss: 'Chinese language', level: 0 },
    { simp: '电脑', trad: '電腦', n: 'dian4 nao3', gloss: 'computer', level: 0 },
  ]);
  const tsv = '学习\txué xí\tto study\t學習\n';
  assert.deepEqual(parseCustomDictionary(tsv)[0], { simp: '学习', trad: '學習', n: 'xue2 xi2', gloss: 'to study', level: 0 });
  const store = memoryStore();
  const pm = packManager({ store, core: async () => ({ words: 100, bytes: 1000 }) });
  const row = await pm.installLocalPack('MyClass.u8', cedict);
  assert.equal(row.name, 'MyClass');
  assert.equal(row.words.length, 2);
  const all = await pm.packs();
  const custom = all.find(p => p.id === row.id);
  assert.equal(custom.custom, true);
  assert.equal(custom.installed, true);
  assert.equal(custom.words, 2);
  assert.equal((await pm.installedWords()).length, 2);
  await pm.removePack(row.id);
  assert.equal((await pm.installedWords()).length, 0);
});
