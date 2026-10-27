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
