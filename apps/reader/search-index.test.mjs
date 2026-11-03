import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchIndex, normalize, words, withinOneEdit, matchWord } from './search-index.js';

const unit = (page, source, text, extra = {}) => ({
  page, source, ...extra,
  words: text.split(/\s+/).map((t, i) => ({ text: t, box: [i * 10, 0, 9, 10], time: source === 'audio' ? i : undefined })),
});

test('normalization ignores case and accents', () => {
  assert.equal(normalize('Memória CACHÉ'), 'memoria cache');
  assert.deepEqual(words('¿Qué es la DRAM? 6T-cell'), ['que', 'es', 'la', 'dram', '6t', 'cell']);
});

test('one-edit tolerance and match grades', () => {
  assert.ok(withinOneEdit('memoria', 'memorla'));
  assert.ok(withinOneEdit('memoria', 'memora'));
  assert.ok(!withinOneEdit('memoria', 'mmria'));
  assert.equal(matchWord('dram', 'dram', false), 3);
  assert.equal(matchWord('cond', 'condensador', false), 2);
  assert.equal(matchWord('condensador', 'condensadr', false), 0);
  assert.equal(matchWord('condensador', 'condensadr', true), 1);
  assert.equal(matchWord('dram', 'dran', true), 0, 'short words stay exact');
});

test('typed and PDF text need prefix matches; OCR and audio tolerate one typo', () => {
  const index = new SearchIndex();
  index.add(unit(0, 'pdf', 'SRAM vs. DRAM Static RAM'));
  index.add(unit(1, 'ocr', 'El condensadr se descarga'));
  index.add(unit(1, 'text', 'El condensadr se descarga'));
  index.add(unit(2, 'audio', 'el condensador pierde la carga', { recordingId: 'r1', label: 'Recording 1' }));
  const hits = index.search('condensador');
  assert.deepEqual(hits.map(h => [h.page, h.source]), [[1, 'ocr'], [2, 'audio']]);
  assert.equal(hits[1].time, 1);
  assert.equal(hits[1].recordingId, 'r1');
  assert.deepEqual(index.search('dram').map(h => h.page), [0]);
});

test('several words match within a short window, with their boxes', () => {
  const index = new SearchIndex();
  index.add(unit(4, 'pdf', 'La memoria cache de nivel uno es muy rápida'));
  index.add(unit(5, 'pdf', 'memoria ' + 'x '.repeat(40) + 'cache'));
  const hits = index.search('memória caché');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].page, 4);
  assert.equal(hits[0].boxes.length, 2);
  assert.match(hits[0].snippet, /memoria cache de nivel/);
});

test('results order by page, then source, and repeat per occurrence', () => {
  const index = new SearchIndex();
  index.add(unit(3, 'audio', 'cache y más cache'));
  index.add(unit(3, 'text', 'cache'));
  index.add(unit(1, 'ocr', 'cache'));
  assert.deepEqual(index.search('cache').map(h => `${h.page}:${h.source}`), ['1:ocr', '3:text', '3:audio', '3:audio']);
  index.remove(u => u.source === 'audio');
  assert.equal(index.search('cache').length, 2);
  assert.deepEqual(index.search('  '), []);
});
import { ocrWords } from './ocr.js';
test('OCR words come back in page units without low-confidence noise', () => {
  const data = { blocks: [{ paragraphs: [{ lines: [{ words: [
    { text: 'Memoria', confidence: 91, bbox: { x0: 200, y0: 100, x1: 400, y1: 140 } },
    { text: '~', confidence: 12, bbox: { x0: 410, y0: 100, x1: 420, y1: 140 } },
  ] }] }] }] };
  assert.deepEqual(ocrWords(data, 2), [{ text: 'Memoria', box: [100, 50, 100, 20], confidence: 91 }]);
  assert.deepEqual(ocrWords(null, 1), []);
});

import { mergeWords } from './ocr.js';
test('two OCR readings of one handwritten word are one hit, found by either', () => {
  const words = mergeWords(
    [{ text: 'Sectov', box: [10, 10, 60, 20], confidence: 70 }, { text: '600B', box: [80, 10, 40, 20], confidence: 60 }],
    [{ text: 'Sector', box: [11, 11, 58, 19], confidence: 55 }],
  );
  assert.deepEqual(words.map(w => [w.text, w.alts || []]), [['Sectov', ['Sector']], ['600B', []]]);
  const index = new SearchIndex();
  index.add({ page: 129, source: 'ocr', words });
  assert.equal(index.search('sector').length, 1);
  assert.equal(index.search('sector')[0].page, 129);
});

test('Chinese is searched character by character, wherever OCR broke it into words', () => {
  assert.deepEqual(words('学习中文 abc'), ['学', '习', '中', '文', 'abc']);
  const index = new SearchIndex();
  index.add({ page: 3, source: 'ocr', words: [
    { text: '我们学', box: [0, 0, 30, 10], confidence: 80 },
    { text: '习中文', box: [32, 0, 30, 10], confidence: 80 },
    { text: 'Tesseract', box: [70, 0, 40, 10], confidence: 90 },
  ] });
  const hit = index.search('学习')[0];
  assert.equal(hit.page, 3);
  assert.deepEqual(hit.matched, ['学', '习']);
  assert.deepEqual(hit.boxes, [[20, 0, 10, 10], [32, 0, 10, 10]]);
  assert.match(hit.snippet, /^我们学习中文 Tesseract$/);
  assert.equal(index.search('中文')[0].page, 3);
  assert.equal(index.search('tesseract').length, 1);
  assert.equal(index.search('英文').length, 0);
});

test('OCR readings agreed by several passes win over one confident guess', () => {
  const words = mergeWords(
    [{ text: 'cabaza', box: [10, 10, 60, 20], confidence: 75 }],
    [{ text: 'cabeza', box: [11, 10, 59, 20], confidence: 60 }],
    [{ text: 'Cabeza', box: [10, 11, 60, 19], confidence: 58 }],
    [{ text: 'otra', box: [100, 10, 40, 20], confidence: 90 }],
  );
  assert.deepEqual(words.map(w => [w.text, w.alts || []]), [['cabeza', ['cabaza']], ['otra', []]]);
});

import { ocrPasses, OCR_LANGUAGES, readingOrder } from './ocr.js';
test('high-quality OCR reads more, at more sizes, in more ways; the normal passes are part of it', () => {
  assert.ok(OCR_LANGUAGES.chi_sim && OCR_LANGUAGES.chi_tra, 'Chinese is offered');
  const normal = ocrPasses('normal'), high = ocrPasses('high'), extra = ocrPasses('high', { extra: true });
  assert.ok(high.ink.length > normal.ink.length && Math.max(...high.ink.map(p => p.width)) > Math.max(...normal.ink.map(p => p.width)));
  assert.ok(high.ink.some(p => p.sparse) && high.ink.some(p => p.bold) && high.whole.some(p => p.sparse) && high.lines);
  // A quick normal reading is kept and improved by the rest: together they are high quality.
  assert.deepEqual([...normal.whole, ...extra.whole], high.whole);
  assert.deepEqual([...normal.ink, ...extra.ink], high.ink);
});

test('words of one pass never merge, and read line by line', () => {
  const merged = mergeWords([
    { text: '数据', box: [0, 0, 20, 10], confidence: 90 },
    { text: '存储', box: [12, 0, 20, 10], confidence: 80 },
  ]);
  assert.deepEqual(merged.map(w => w.text), ['数据', '存储']);
  const order = readingOrder([
    { text: 'b', box: [30, 1, 10, 10] }, { text: 'a', box: [0, 2, 10, 10] }, { text: 'c', box: [60, 0, 10, 10] },
    { text: 'd', box: [0, 20, 10, 10] },
  ]);
  assert.deepEqual(order.map(w => w.text), ['a', 'b', 'c', 'd']);
});
