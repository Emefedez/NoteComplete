// Search inside notes (content-search.js), shared OCR passes (ocr.js), transcript noise flags
// (transcript-revise.js) and the transcript caveat the AI always gets (ai-context.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contentIndex, normalizeContent, hasContent, contentSearcher, contentSearchable } from './content-search.js';
import { readPagePasses, pageHasInk, hasPdfText, ocrPasses } from './ocr.js';
import { markNoise, noiseRun, noiseRuns, reviseWords, revisePrompt } from './transcript-revise.js';
import { transcriptText, labelledText, textBlock, notesBlock, SOURCE_NAMES } from './ai-context.js';
import { PDF_WORDS } from './find.js';

const words = (text, from = 0) => text.split(' ').map((t, i) => ({ text: t, start: from + i, end: from + i + 0.5 }));

describe('content search over kept note data', () => {
  const data = normalizeContent({
    pdf: { 3: [{ text: 'Teorema', box: [0, 0, 1, 1] }, { text: 'de', box: [1, 0, 1, 1] }, { text: 'Bayes', box: [2, 0, 1, 1] }] },
    ocr: { 5: [{ text: 'derivada', box: [0, 0, 1, 1] }, { text: 'parcial', box: [1, 0, 1, 1] }] },
    text: { 3: { typed: 'resumen del tema', ink: '' }, 7: { typed: '', ink: 'escrito a mano' } },
    audio: { rec1: { label: 'Clase 1', text: 'hoy vemos la probabilidad condicionada' } },
    pages: { 3: 0, 5: 1, 7: 2 },
    pdfWords: PDF_WORDS,
  });
  const index = contentIndex(data);
  it('finds PDF, OCR, typed, handwriting and transcript words on the right pages', () => {
    assert.deepEqual(index.search('bayes').map((h) => [h.source, h.page]), [['pdf', 0]]);
    assert.deepEqual(index.search('derivada parcial').map((h) => [h.source, h.page]), [['ocr', 1]]);
    assert.deepEqual(index.search('resumen').map((h) => h.source), ['text']);
    assert.deepEqual(index.search('mano').map((h) => [h.source, h.page]), [['ocr', 2]]);
    const audio = index.search('probabilidad');
    assert.equal(audio[0].source, 'audio');
    assert.equal(audio[0].label, 'Clase 1');
  });
  it('accepts one misread letter in recognized text, as Find does', () => {
    assert.equal(index.search('derivoda').length, 1);
  });
  it('drops PDF words measured by an older version and fills missing fields', () => {
    const old = normalizeContent({ pdf: { 0: [{ text: 'x' }] }, pdfWords: 1, ocr: { 0: [{ text: 'y' }] } });
    assert.deepEqual(old.pdf, {});
    assert.deepEqual(old.ocr, { 0: [{ text: 'y' }] });
    assert.deepEqual(old.audio, {});
    assert.equal(hasContent(old), true);
    assert.equal(hasContent(normalizeContent(null)), false);
  });
  it('searches only documents it can read, and lists the ones with nothing kept', async () => {
    const kept = new Map([['fp-a', data]]);
    const files = { a: 'fp-a', b: 'fp-b' };
    const settings = new Map();
    const library = {
      store: { get: async (_, k) => settings.get(k), set: async (_, k, v) => settings.set(k, v) },
      open: async (entry) => ({ name: entry.name, size: 10, slice: () => new Blob(['x']), fp: files[entry.key] }),
      searchData: async (fp) => kept.get(fp) || null,
    };
    // The fingerprint of a file is cached under the entry; give each entry its own.
    for (const key of Object.keys(files)) settings.set(`content-fp:${key}`, { version: '10||', fingerprint: files[key] });
    const entries = [
      { key: 'a', name: 'Tema 1.nfedit', size: 10 },
      { key: 'b', name: 'Tema 2.noteful', size: 10 },
      { key: 'w', name: 'page', source: 'web' },
    ];
    assert.equal(contentSearchable(entries[2]), false);
    const { results, unindexed } = await contentSearcher(library).search(entries, 'bayes');
    assert.deepEqual(results.map((r) => r.entry.key), ['a']);
    assert.deepEqual(results[0].counts, { pdf: 1 });
    assert.deepEqual(unindexed.map((e) => e.key), ['b']);
  });
});

describe('OCR passes shared by Recognize text and Batch OCR', () => {
  const canvas = () => ({ width: 10, height: 10 });
  it('reads the whole page and the ink, and skips the ink when there is none', async () => {
    const asked = [];
    const pageCanvas = async (page, width, { inkOnly = false } = {}) => (inkOnly && page === 1 ? null : { canvas: canvas(), scale: width / 100 });
    const read = async (_, scale, { sparse }) => { asked.push([scale, !!sparse]); return [{ text: 'a', box: [0, 0, 1, 1], confidence: 90 }]; };
    const withInk = await readPagePasses(0, ocrPasses('normal'), { pageCanvas, read });
    assert.equal(withInk.length, 3);
    const noInk = await readPagePasses(1, ocrPasses('normal'), { pageCanvas, read });
    assert.equal(noInk.length, 1);
    const inkOnly = await readPagePasses(0, ocrPasses('normal'), { pageCanvas, read, whole: false });
    assert.equal(inkOnly.length, 2);
    assert.equal((await readPagePasses(0, ocrPasses('normal'), { pageCanvas, read, alive: () => false })).length, 0);
  });
  it('tells pages with handwriting and PDFs with printed text', () => {
    assert.equal(pageHasInk({ svg: '<g data-item="stroke:4">' }), true);
    assert.equal(pageHasInk({ svg: '<g data-item="text:4">' }), false);
    assert.equal(hasPdfText(new Array(21).fill({})), true);
    assert.equal(hasPdfText([]), false);
  });
});

describe('transcript noise: flagged, never removed on its own', () => {
  it('marks the words of a quoted stretch, ignoring case, accents and punctuation', () => {
    const list = words('la derivada es el límite , oye pásame el boli , del cociente');
    assert.equal(markNoise(list, ['Oye, pásame el boli']), 1);
    assert.deepEqual(list.filter((w) => w.noise).map((w) => w.text), ['oye', 'pásame', 'el', 'boli']);
    assert.deepEqual(noiseRun(list, 8), [6, 10]);
    assert.equal(noiseRun(list, 0), null);
    assert.equal(noiseRuns(list), 1);
    assert.equal(markNoise(list, ['no está aquí', 42]), 0);
  });
  it('the revision asks for noise only when chosen, and keeps every word', async () => {
    const original = words('entonces la integral de x ¿vienes luego al bar? es x cuadrado medios');
    assert.doesNotMatch(revisePrompt([{ i: 0, text: 'a' }]), /"noise"/);
    assert.match(revisePrompt([{ i: 0, text: 'a' }], { flagNoise: true }), /"noise"/);
    assert.match(revisePrompt([{ i: 0, text: 'a' }]), /students talking among themselves/);
    const ask = async (prompt) => {
      assert.match(prompt, /"noise"/);
      return JSON.stringify({ segments: [{ i: 0, text: 'Entonces la integral de x, ¿vienes luego al bar? es x cuadrado medios.', noise: ['¿vienes luego al bar?'] }] });
    };
    const result = await reviseWords(original, { ask, parse: JSON.parse, flagNoise: true });
    assert.equal(result.words.length, original.length);
    assert.equal(result.flagged, 1);
    assert.deepEqual(result.words.filter((w) => w.noise).map((w) => w.text), ['¿vienes', 'luego', 'al', 'bar?']);
    // The words shown are not touched until the revision is taken.
    assert.equal(original.some((w) => w.noise), false);
  });
  it('a far shorter reply is not taken, but its noise flags still are', async () => {
    const original = words('uno dos tres cuatro cinco seis siete ocho nueve diez');
    const ask = async () => JSON.stringify({ segments: [{ i: 0, text: 'uno dos', noise: ['siete ocho'] }] });
    const result = await reviseWords(original, { ask, parse: JSON.parse, flagNoise: true });
    assert.deepEqual(result.words.map((w) => w.text), original.map((w) => w.text));
    assert.deepEqual(result.words.filter((w) => w.noise).map((w) => w.text), ['siete', 'ocho']);
  });
});

describe('what the AI is told about transcripts', () => {
  it('names the transcript with its caveat in every page block', () => {
    assert.match(SOURCE_NAMES.audio, /not part of the lesson/);
    assert.match(textBlock(0, { audio: 'hola' }), /Lecture transcript \(automatic speech recognition of a live class/);
    assert.match(labelledText({ pdf: 'a', audio: 'b' }), /^PDF text: a\nLecture transcript \(.*\): b$/);
    assert.equal(labelledText(' plain '), 'plain');
  });
  it('marks flagged runs instead of dropping them', () => {
    assert.equal(transcriptText([{ text: 'la' }, { text: 'oye', noise: true }, { text: 'tú', noise: true }, { text: 'derivada' }]), 'la [likely noise: oye tú] derivada');
    assert.equal(transcriptText([{ text: 'fin' }, { text: 'adiós', noise: true }]), 'fin [likely noise: adiós]');
  });
  it('warns about transcripts appended to the Markdown notes', () => {
    assert.match(notesBlock('# Tema\n\n## Transcript — Clase 1\n\nhola'), /sections headed "Transcript" are automatic speech recognition/);
    assert.doesNotMatch(notesBlock('# Tema'), /Transcript/);
  });
});
