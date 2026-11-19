// Stroke data (shards, index), the pure SVG and practice scoring (docs/CHINESE-INPUT.md §11).
// Needs the shards built: node tools/build_chinese_strokes.mjs (build_web.py runs it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { strokeData, shardOf, strokeIndex, hasStrokes, expand, strokesFor } from './strokes.js';
import { glyphSvg, extendStart, toScreen, fromScreen } from './stroke-svg.js';
import { scoreStroke, resample, averageDistance } from './practice.js';
import { compactPath } from '../../../tools/build_chinese_strokes.mjs';

const built = existsSync(new URL('../vendor/chinese/strokes/index.json', import.meta.url));
const raw = (c) => JSON.parse(readFileSync(new URL(`../node_modules/hanzi-writer-data/${c}.json`, import.meta.url), 'utf8'));

test('shards: frequent characters are bundled, rare ones are on demand with a hash', { skip: !built && 'shards not built' }, async () => {
  const idx = await strokeIndex();
  assert.equal(idx.shards, 64);
  assert.equal(idx.shardOf.size, 3000);
  for (const c of '的我你好是中国们') assert.notEqual(await shardOf(c), null, c);
  assert.equal(await shardOf('的'), 0, 'most frequent first');
  assert.equal(await shardOf('a'), null);
  assert.equal(await shardOf('龘'), null);
  assert.ok(await hasStrokes('㐆'), 'a rare one is listed for download');
  assert.match(idx.hashOf.get('㐆'), /^[0-9a-f]{12}$/);
  assert.equal(await hasStrokes('x'), false);
});

test('strokeData gives the hanzi-writer-data shape, equal to the source', { skip: !built && 'shards not built' }, async () => {
  for (const c of '你好永') {
    const d = await strokeData(c), src = raw(c);
    assert.equal(d.strokes.length, src.strokes.length, c);
    assert.deepEqual(d.medians, src.medians, `${c} medians`);
    assert.deepEqual(d.strokes, src.strokes.map(compactPath), `${c} outlines`);
  }
  assert.equal((await strokeData('你')).strokes.length, 7);
  assert.equal((await strokeData('好')).strokes.length, 6);
  assert.equal(await strokeData('A'), null);
  assert.deepEqual(Object.keys(await strokesFor('你好A你')), ['你', '好']);
});

test('compact entries expand back', () => {
  assert.deepEqual(expand({ s: ['M1 2Z'], m: [[1, 2, 3, 4]], r: [0] }), { strokes: ['M1 2Z'], medians: [[[1, 2], [3, 4]]], radStrokes: [0] });
  assert.equal(compactPath('M 330 202 Q 361 175 399 134 L 1 2 Z'), 'M330 202Q361 175 399 134L1 2Z');
});

test('glyphs: y up, n strokes drawn at step n, a mask for the current one', () => {
  const d = raw('你');
  const svg = (o) => glyphSvg(d, { size: 100, ...o });
  assert.equal((svg({ done: 3 }).match(/<path d=/g) || []).length, 3);
  assert.equal((svg({}).match(/<path d=/g) || []).length, 7);
  assert.match(svg({ done: 2, current: { index: 2, t: 0.5 } }), /clip-path="url\(#hz-c2\)"/);
  assert.match(svg({}), /scale\(0\.09765625 -0\.09765625\) translate\(0 -900\)/);
  assert.deepEqual(toScreen([0, 900], 10, 20, 1024), [10, 20], 'y = 900 is the top');
  assert.deepEqual(fromScreen(toScreen([300, 450], 5, 5, 200), 5, 5, 200).map(Math.round), [300, 450]);
  const e = extendStart([[0, 0], [100, 0]], 85);
  assert.deepEqual(e[0], [-85, 0]);
});

test('scoring accepts the median itself and rejects reversed and wrong strokes', () => {
  for (const c of '你好永国') {
    const { medians } = raw(c);
    medians.forEach((m, i) => {
      assert.ok(scoreStroke(m, medians, i).ok, `${c} stroke ${i + 1}: its own median`);
      const wobbly = resample(m, 40).map(([x, y], k) => [x + 25 * Math.sin(k / 5), y + 15]);
      assert.ok(scoreStroke(wobbly, medians, i).ok, `${c} stroke ${i + 1}: a little off`);
      if (m.length > 1 && Math.hypot(m[0][0] - m.at(-1)[0], m[0][1] - m.at(-1)[1]) > 120) assert.equal(scoreStroke([...m].reverse(), medians, i).ok, false, `${c} stroke ${i + 1} reversed`);
    });
    // Another stroke's median in place of the expected one.
    for (let i = 0; i + 1 < medians.length; i++) assert.equal(scoreStroke(medians[i + 1], medians, i).ok, false, `${c}: stroke ${i + 2} drawn for ${i + 1}`);
  }
  const { medians } = raw('一');
  const far = medians[0].map(([x, y]) => [x, y - 400]);
  assert.equal(scoreStroke(far, medians, 0).ok, false, 'far from it');
  assert.equal(scoreStroke([], medians, 0).ok, false);
  assert.equal(averageDistance(medians[0], medians[0]), 0);
});
