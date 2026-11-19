// Simplified ↔ traditional with the OpenCC tables (fixture, and the built opencc.bin when present).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { decodeOpenCC, convertText, convertParts } from './convert.js';

const packs = [['fixture', new URL('./test-fixtures/opencc-fixture.bin', import.meta.url)], ['built', new URL('../vendor/chinese/opencc.bin', import.meta.url)]];
const CASES = [['头发', '頭髮'], ['发现', '發現'], ['干净', '乾淨'], ['干部', '幹部'], ['以后', '以後'], ['皇后', '皇后'], ['我的头发很干净。OK', '我的頭髮很乾淨。OK']];

for (const [name, url] of packs) {
  test(`OpenCC conversion (${name})`, { skip: !existsSync(url) && 'not built' }, () => {
    const t = decodeOpenCC(readFileSync(url));
    for (const [s, tr] of CASES) {
      assert.equal(convertText(s, 's2t', t), tr, s);
      assert.equal(convertText(tr, 't2s', t), s, tr);
    }
    assert.equal(convertText('', 's2t', t), '');
    assert.throws(() => convertText('x', 'x2y', t));
  });
}

test('a character with several targets is reported with its alternatives', () => {
  const t = decodeOpenCC(readFileSync(packs[0][1]));
  const parts = convertParts('发', 's2t', t);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, '發');
  assert.deepEqual(parts[0].alternatives.slice(0, 2), ['發', '髮']);
  const joined = convertParts('头发很好', 's2t', t);
  assert.equal(joined.map(p => p.text).join(''), '頭髮很好');
  assert.equal(joined.map(p => p.source).join(''), '头发很好');
  assert.ok(!joined.some(p => p.alternatives && p.source === '头发'));
});
