import test from 'node:test';
import assert from 'node:assert/strict';
import { segments, realign, reviseWords, revisePrompt } from './transcript-revise.js';

const words = text => text.split(' ').map((t, i) => ({ text: t, start: i, end: i + 1 }));

test('corrected words keep the times of the words they replace', () => {
  const original = words('la memoria s ram usa biestables y la de ram condensadores');
  const fixed = realign(original, 'La memoria SRAM usa biestables, y la DRAM, condensadores.');
  assert.deepEqual(fixed.map(w => w.text), ['La', 'memoria', 'SRAM', 'usa', 'biestables,', 'y', 'la', 'DRAM,', 'condensadores.']);
  assert.equal(fixed[0].start, 0);
  assert.equal(fixed[3].start, 4);
  assert.equal(fixed[4].start, 5);
  assert.equal(fixed.at(-1).start, 10);
  for (let i = 1; i < fixed.length; i++) assert.ok(fixed[i].start >= fixed[i - 1].start);
});

test('segments end at sentences and cover every word once', () => {
  const list = words(Array.from({ length: 300 }, (_, i) => (i % 50 === 49 ? 'fin.' : 'palabra')).join(' '));
  const parts = segments(list, 120);
  assert.equal(parts.at(-1).to, 300);
  assert.ok(parts.every((p, i) => i === 0 || p.from === parts[i - 1].to));
  assert.match(list[parts[0].to - 1].text, /\.$/);
});

test('revision applies per segment and refuses summaries', async () => {
  const list = words('uno dos tres cuatro cinco seis siete ocho');
  const prompts = [];
  const result = await reviseWords(list, {
    ask: async p => { prompts.push(p); return '{"segments":[{"i":0,"text":"Uno, dos, tres, cuatro, cinco, seis, siete, ocho."}]}'; },
    parse: JSON.parse, title: 'Memoria 1', language: 'Castellano',
  });
  assert.equal(result.changed, 1);
  assert.equal(result.words[0].text, 'Uno,');
  assert.equal(result.words.length, 8);
  assert.match(prompts[0], /Memoria 1[\s\S]*Castellano[\s\S]*\[0\] uno dos/);
  const summary = await reviseWords(list, { ask: async () => '{"segments":[{"i":0,"text":"Números."}]}', parse: JSON.parse });
  assert.equal(summary.changed, 0);
  assert.equal(summary.words.map(w => w.text).join(' '), 'uno dos tres cuatro cinco seis siete ocho');
  assert.match(revisePrompt([{ i: 3, text: 'x' }]), /do not summarize/);
});
