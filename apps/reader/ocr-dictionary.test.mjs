import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { correctWord, correctWords, parseFrequencies } from './ocr-dictionary.js';
const words = parseFrequencies(`el 900000
la 800000
los 500000
esta 300000
está 280000
dirección 44229
memoria 23432
tamaño 16359
casa 50000
cosa 48000
procesador 542
calcula 900
caché 400
mientras 60000
camaro 3
coche 30000
`);
words.all = new Set(['el', 'la', 'cache', 'mitocondria', 'procesador', 'memoria', 'tamaño', 'casa', 'cosa']);
test('a common word is never changed', () => {
  for (const w of ['memoria', 'Dirección', 'caché.', 'el', 'esta', 'está']) assert.equal(correctWord(w, words), null, w);
  // Not common, but a word of the language: not turned into a common one ("coche").
  assert.equal(correctWord('caché', words), null);
  assert.equal(correctWord('mitocondria', words), null);
});
test('a word read without its accent gets it back when there is one way to write it', () => {
  assert.equal(correctWord('direccion', words), 'dirección');
  assert.equal(correctWord('Direccion,', words), 'Dirección,');
  assert.equal(correctWord('tamano', words), 'tamaño');
});
test('look-alikes and one-letter misreads become the likeliest word', () => {
  assert.equal(correctWord('procecador', words), 'procesador');
  assert.equal(correctWord('e/', words), 'el');
  assert.equal(correctWord('Jos', words), 'los', 'a capital the engine made of another letter goes');
  assert.equal(correctWord('memorla,', words), 'memoria,');
  assert.equal(correctWord('Camano', words), 'tamaño', 'the common word, not the rare one a change away');
});
test('unsure, sure or not a word: left as read', () => {
  assert.equal(correctWord('cbsa', words), null, 'casa or cosa, as common as each other');
  assert.equal(correctWord('procecador', words, 98), null, 'the engine was sure: a name or a term');
  assert.equal(correctWord('merioria', words), null, 'two changes away');
  assert.equal(correctWord('x', words), null);
  assert.equal(correctWord('CPU', words), null, 'an acronym');
  assert.equal(correctWord('2024', words), null);
  assert.equal(correctWord('=6-8', words), null);
});
test('corrected words keep the reading for Find; a real-word alternative wins', () => {
  const [a, b] = correctWords([{ text: 'procecador', box: [0, 0, 1, 1], confidence: 50 }, { text: 'mientraz', alts: ['mientras'], box: [0, 0, 1, 1], confidence: 95 }], words);
  assert.deepEqual([a.text, a.alts], ['procesador', ['procecador']]);
  assert.deepEqual([b.text, b.alts], ['mientras', ['mientraz']]);
});
