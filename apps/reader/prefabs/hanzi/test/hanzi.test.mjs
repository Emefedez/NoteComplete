import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, render, prepare, name, strokeCount, pinyinFor } from '../render.js';

// The card's spec has no stroke data (Arphic-licensed data stays out of the app's code): added here.
const card = await prepare(JSON.parse(readFileSync(new URL('../module.json', import.meta.url), 'utf8')).prefabs[0].spec);
// Filled strokes and outlines (clip paths are not drawn).
const paths = (svg) => (svg.match(/<path d=/g) || []).length - (svg.match(/<clipPath/g) || []).length;

test('a hanzi spec is made whole', () => {
  const m = normalize({ text: ' 你 好 ', pinyin: 'ni3 hao3', show: 'x', grid: 'y', step: '3', colour: 'red', data: { 你: { strokes: ['M1 2"/><script>'], medians: [[[1, 2]]] } } });
  assert.equal(m.text, '你好');
  assert.equal(m.pinyin, 'nǐ hǎo');
  assert.equal(m.show, 'strokes');
  assert.equal(m.grid, 'mi');
  assert.equal(m.step, 3);
  assert.equal(m.colour, '#1f2328');
  assert.deepEqual(m.data, {}, 'paths that are not paths are dropped');
  assert.equal(normalize({ text: '一二三四五六七八九十百千万' }).text.length, 12);
  assert.equal(normalize({}).step, null);
  assert.equal(name({ text: '中' }), 'Stroke order 中');
  assert.deepEqual(pinyinFor(normalize({ text: '你好!', pinyin: 'nǐ hǎo' })), ['nǐ', 'hǎo', '']);
  assert.equal(pinyinFor(normalize({ text: '你好', pinyin: 'nǐhǎo' })), null);
});

test('render at step n draws n strokes, all without a step', () => {
  assert.equal(strokeCount(card), 13);
  const all = render(card);
  assert.ok(all.svg.startsWith('<svg') && all.width > all.height);
  assert.equal(paths(all.svg) - 13, 13, 'every stroke, over its outline');
  for (const n of [0, 1, 5, 7, 9, 13]) {
    const { svg } = render({ ...card, step: n, outline: false });
    // Strokes before the last drawn one are filled paths; the last is a masked polyline.
    assert.equal(paths(svg), Math.max(0, n - 1), `step ${n}`);
    assert.equal((svg.match(/clip-path=/g) || []).length, n ? 1 : 0, `step ${n}: the last stroke marked`);
  }
  assert.equal((render({ ...card, show: 'numbers' }).svg.match(/<circle/g) || []).length, 13, 'a number per stroke, from 1 in each character');
  const steps = render({ ...card, show: 'steps' });
  assert.ok(steps.height > all.height, 'a row per character');
  assert.equal((steps.svg.match(/clip-path=/g) || []).length, 13, 'the sequence: one box per stroke');
  assert.equal(render({ text: '' }), null);
  assert.match(render({ text: '你' }).svg, /你<\/text>/, 'no data: the character as text');
  assert.equal(JSON.parse(readFileSync(new URL('../module.json', import.meta.url), 'utf8')).prefabs.some((c) => c.spec.data), false, 'no stroke data in the manifest');
});

test('prepare adds the stroke data (needs the shards: node tools/build_chinese_strokes.mjs)', async () => {
  const m = await prepare({ text: '我们' });
  assert.deepEqual(Object.keys(m.data), ['我', '们']);
  assert.equal(m.data.我.strokes.length, 7);
  assert.equal(strokeCount(m), 12);
});
