import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { correctWord, correctWords, deepCorrect, parseFrequencies, makeLexicon, isWord } from './ocr-dictionary.js';
const spanish = parseFrequencies(`el 900000
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
trabajando 9000
se 700000
ce 600
tiempo 200000
lempo 2
`);
const english = parseFrequencies(`the 900000
working 30000
cache 2000
`);
const words = makeLexicon([{ frequencies: spanish, all: new Set(['el', 'la', 'cache', 'mitocondria', 'procesador', 'memoria', 'tamaño', 'casa', 'cosa', 'trabajando']) }]);
const both = makeLexicon([{ frequencies: spanish, all: new Set(['el', 'la', 'cache']) }, { frequencies: english, all: new Set(['the', 'working', 'cache', 'framework']) }]);
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

test('a word of another chosen language is left as read', () => {
  assert.equal(correctWord('working', both), null);
  assert.equal(correctWord('framework', both), null, 'in the full English list only');
  assert.equal(isWord('working,', both), true);
  assert.equal(isWord('trabjndo', both), false);
});
test('deep mode reaches a long word two changes away; normal mode does not', () => {
  assert.equal(correctWord('trabjndo', words), null);
  assert.equal(correctWord('trabjndo', words, 0, { deep: true }), 'trabajando');
  assert.equal(correctWord('Trabjando.', words, 0, { deep: true }), 'Trabajando.', 'one change: also normal');
  assert.equal(correctWord('xqzwkv', words, 0, { deep: true }), null, 'nothing near');
});

test('deep mode picks the word most likely meant, by how common it is and what the change costs', () => {
  assert.equal(deepCorrect('ce', both, 60), 'se', 'a rare reading next to a very common word');
  assert.equal(deepCorrect('Lempo', both, 60), 'tiempo');
  assert.equal(deepCorrect('trabjndo', words, 60), 'trabajando');
  assert.equal(deepCorrect('working', both, 60), null, 'English in Spanish notes');
  assert.equal(deepCorrect('caché', both, 60), null, 'a word with the accent the engine saw');
  assert.equal(deepCorrect('memoria', both, 60), null);
  assert.equal(deepCorrect('CPU', both, 60), null);
  // Another pass's reading counts: a real word read there wins over a near-miss here.
  assert.equal(deepCorrect('memorla', both, 60, ['memoria']), 'memoria');
});
test('deep correction keeps the reading for Find', () => {
  const [w] = correctWords([{ text: 'ce', confidence: 60, box: [0, 0, 1, 1] }], both, { deep: true });
  assert.deepEqual([w.text, w.alts], ['se', ['ce']]);
});
