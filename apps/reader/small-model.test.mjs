import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  smallSetting, rememberSmall, validBox, readPrompt, cleanReading, readPage, runAI, forgetReadings, imageKey,
  packStep, packMaterial, packPrompt, packSchema, questionsWithRegions, similar, mergeItems, smallStudy, compactDialect,
  READ_SCHEMA, SHORT_PAGE, locateQuote, guessLanguage,
} from './small-model.js';
import { cleanCards } from './study.js';
import { prepareQuestions } from './quiz.js';
import { cleanFindings } from './fact-check.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const jpeg = (n = 1) => ({ bytes: new Uint8Array([n, 2, 3]), type: 'image/jpeg', label: `page-${n}` });
// A fake `ai` that answers by what the prompt asks and records every request.
function fakeAI(answer) {
  const calls = [];
  return { calls, run: async (request, onDelta) => { calls.push({ ...request, streamed: typeof onDelta === 'function' }); const text = await answer(request, calls.length); onDelta?.(text); return { text }; } };
}
const reading = (content, points = []) => JSON.stringify({ content, points });

test('small model is on by default only where the provider says so, and remembered either way', () => {
  const ai = { smallByDefault: p => p === 'webllm' };
  const storage = memory();
  assert.equal(smallSetting('webllm', { storage, ai }), true);
  assert.equal(smallSetting('claude', { storage, ai }), false);
  assert.equal(smallSetting('claude', { storage, ai: null }), false);
  rememberSmall('claude', true, storage);
  rememberSmall('webllm', false, storage);
  assert.equal(smallSetting('claude', { storage, ai }), true);
  assert.equal(smallSetting('webllm', { storage, ai }), false);
});

test('a reading keeps the content and the points whose regions are usable', () => {
  const text = `Sure: ${reading('# Deadlock\nFour conditions', [
    { text: 'Coffman conditions', box: [0.1, 0.2, 0.9, 0.35] },
    { text: 'outside the page', box: [0.1, 0.2, 1.4, 0.3] },
    { text: 'a sliver', box: [0.1, 0.2, 0.11, 0.3] },
    { text: '  ', box: [0, 0, 1, 1] },
  ])}`;
  const r = cleanReading(text);
  assert.equal(r.content, '# Deadlock\nFour conditions');
  assert.deepEqual(r.points.map(p => [p.text, p.box]), [['Coffman conditions', [0.1, 0.2, 0.9, 0.35]], ['outside the page', null], ['a sliver', null]]);
  // An answer that is not JSON is kept as the content.
  assert.deepEqual(cleanReading('Just text about mutexes'), { content: 'Just text about mutexes', points: [] });
  assert.ok(validBox([0, 0, 1, 1]) && !validBox([0, 0, 1]) && !validBox([0.5, 0, 0.4, 1]));
  assert.match(readPrompt({ extracted: 'x'.repeat(5000) }), /Reply with ONLY JSON/);
  assert.ok(readPrompt({ extracted: 'x'.repeat(5000) }).length < 3000, 'the hint is capped');
  assert.deepEqual(READ_SCHEMA.required, ['content', 'points']);
});

test('repeated points and placeholder boxes from a small model are not trusted', () => {
  // As Phi 3.5 Vision answered on a handwritten page: every point with the same box, points repeated.
  const same = [0.1, 0.2, 0.9, 0.3];
  const r = cleanReading(reading('maths', [
    { text: 'A = 1/2(bh)', box: same }, { text: 'L = (1/2)p(x)', box: same }, { text: 'A = 1/2(bh)', box: same }, { text: 'Group A', box: same },
    { text: 'Real one', box: [0.2, 0.5, 0.6, 0.6] },
  ]));
  assert.deepEqual(r.points.map(p => p.text), ['A = 1/2(bh)', 'L = (1/2)p(x)', 'Group A', 'Real one']);
  assert.deepEqual(r.points.map(p => p.box), [null, null, null, [0.2, 0.5, 0.6, 0.6]]);
  // The prompt gives no example numbers to copy.
  assert.doesNotMatch(readPrompt({}), /\[0\.\d/);
  assert.equal(READ_SCHEMA.properties.points.maxItems, 8);
});

test('a page is read once per image, with the image, by a vision model only', async () => {
  forgetReadings();
  const ai = fakeAI(() => reading('page text', [{ text: 'key', box: [0, 0, 0.5, 0.5] }]));
  const base = { provider: 'webllm', model: '', tag: 'study' };
  const first = await readPage(ai, base, { image: jpeg(1), extracted: 'ocr', vision: true });
  await readPage(ai, base, { image: jpeg(1), extracted: 'ocr', vision: true });
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].images.length, 1);
  assert.equal(ai.calls[0].maxTokens, 1600);
  assert.deepEqual(ai.calls[0].schema, READ_SCHEMA);
  assert.equal(first.points[0].text, 'key');
  // Text only: the extracted text is the content, without asking.
  assert.deepEqual(await readPage(ai, base, { image: jpeg(2), extracted: ' typed ', vision: false }), { content: 'typed', points: [] });
  assert.equal(ai.calls.length, 1);
  assert.notEqual(imageKey(jpeg(1)), imageKey(jpeg(2)));
});

test('questions: unchanged when off; read first, then asked with text only when on', async () => {
  forgetReadings();
  const ai = fakeAI(request => (request.schema ? reading('a matrix A with a=0') : 'answer'));
  const request = { provider: 'webllm', model: '', prompt: 'Why is it singular?', images: [jpeg(5), { bytes: new Uint8Array(1), type: 'application/pdf', label: 'source' }], tag: 'chat' };
  await runAI(ai, request, null, { small: false });
  assert.equal(ai.calls[0].images.length, 2);
  assert.equal(ai.calls[0].streamed, false, 'no callback is invented for tools that stream only when asked');
  const deltas = [];
  const { text } = await runAI(ai, request, d => deltas.push(d), { small: true, vision: true });
  assert.equal(text, 'answer');
  const [read, ask] = ai.calls.slice(1);
  assert.equal(read.images.length, 1);
  assert.equal(read.tag, 'chat', 'Stop cancels the reading step too');
  assert.deepEqual(ask.images, []);
  assert.match(ask.prompt, /^Why is it singular\?\n\nWhat the image "page-5" shows \(read from it\):\na matrix A with a=0/);
  assert.deepEqual(deltas, ['answer']);
  // Text only: no reading step, the images are left out and the prompt says so.
  await runAI(ai, request, null, { small: true, vision: false });
  assert.equal(ai.calls.length, 4);
  assert.match(ai.calls[3].prompt, /\(1 attached image was not sent; use the text\.\)/);
});

test('only near-empty pages are packed, up to three and the budget', () => {
  const page = (n, len) => ({ page: n, content: 'x'.repeat(len), points: [] });
  assert.equal(packStep([], page(0, 2000)), 'alone');
  assert.equal(packStep([], page(0, 50)), 'add');
  assert.equal(packStep([page(0, 50)], page(1, 50)), 'add');
  assert.equal(packStep([page(0, 50), page(1, 50), page(2, 50)], page(3, 50)), 'flush');
  assert.equal(packStep([page(0, SHORT_PAGE - 1)], page(1, SHORT_PAGE - 1), { budget: 500 }), 'flush');
});

test('a pack’s prompt is short and single-purpose, and its schema only allows its pages', () => {
  const pack = [{ page: 2, content: 'Title slide', points: [] }, { page: 3, content: 'Mutex: one thread at a time', points: [{ text: 'mutex', box: [0.1, 0.1, 0.9, 0.3] }] }];
  const material = packMaterial(pack);
  assert.match(material, /--- Page 3 ---\nTitle slide/);
  assert.match(material, /--- Page 4 ---\nMutex: one thread at a time\nKey points:\n\[1\] mutex/);
  const cards = packPrompt('cards', pack, { count: 9, language: 'Spanish', title: 'SO' });
  assert.match(cards, /^Make 9 flashcards/);
  assert.match(cards, /Write in Spanish/);
  assert.ok(cards.length < 1000);
  assert.deepEqual(packSchema('cards', pack).properties.cards.items.properties.page.enum, [3, 4]);
  assert.deepEqual(packSchema('quiz', pack).properties.questions.items.required, ['question', 'options', 'answer', 'page', 'quote', 'point']);
  assert.match(packPrompt('quiz', pack), /"quote" to the exact words of that page/);
  assert.deepEqual(packSchema('check', pack).properties.pages.items.properties.page.enum, [3, 4]);
  assert.match(packPrompt('quiz', pack, { instructions: 'Only theory.' }), /student's instructions for questions:\nOnly theory\./);
});

test('a question that cites a point gets that point’s region as its hint', () => {
  const pack = [{ page: 0, content: 'a', points: [{ text: 'p1', box: [0.1, 0.1, 0.5, 0.2] }] }, { page: 1, content: 'b', points: [{ text: 'p2', box: null }, { text: 'p3', box: [0.2, 0.5, 0.8, 0.7] }] }];
  const value = questionsWithRegions({ questions: [
    { question: 'Q1', options: ['a', 'b', 'c', 'd'], answer: 0, page: 1, point: 1 },
    { question: 'Q2', options: ['a', 'b', 'c', 'd'], answer: 1, page: 2, point: 3 },
    { question: 'Q3', options: ['a', 'b', 'c', 'd'], answer: 2, page: 2, point: 1 },
    { question: 'Q4', options: ['a', 'b', 'c', 'd'], answer: 3, page: 2, point: 0 },
  ] }, pack);
  assert.deepEqual(value.questions.map(q => q.source), [{ page: 1, box: [0.1, 0.1, 0.5, 0.2] }, { page: 2, box: [0.2, 0.5, 0.8, 0.7] }, { page: 2, box: null }, { page: 2, box: null }]);
  // The quiz's own preparation keeps the region.
  assert.deepEqual(prepareQuestions(value, [0, 1], () => 0.5)[0].source.box, [0.1, 0.1, 0.5, 0.2]);
});

test('merging drops duplicates and keeps at most the requested number per page', () => {
  assert.ok(similar('What is a mutex?', 'what is a MUTEX'));
  assert.ok(similar('¿Qué es un interbloqueo en sistemas operativos?', '¿Que es un interbloqueo en los sistemas operativos?'));
  assert.ok(!similar('What is a mutex?', 'What is a semaphore?'));
  const cards = [
    { front: 'What is a mutex?', back: 'a', page: 1 }, { front: 'What is a MUTEX', back: 'b', page: 2 },
    { front: 'What is a thread?', back: 'c', page: 1 }, { front: 'What is a process?', back: 'd', page: 1 },
    { front: 'What is paging?', back: 'e', page: 2 },
  ];
  assert.deepEqual(mergeItems(cards, { kind: 'cards', perPage: 2 }).map(c => c.back), ['a', 'c', 'e']);
  const questions = [{ question: 'Q one about locks', source: { page: 1 } }, { question: 'Q one about locks!', source: { page: 1 } }, { question: 'Another', source: null }];
  assert.equal(mergeItems(questions, { kind: 'quiz', perPage: 4 }).length, 2);
});

const clean = (k, value, batch) => (k === 'cards' ? cleanCards(value, batch) : k === 'check' ? cleanFindings(value, batch) : prepareQuestions(value, batch, () => 0.5));

test('flashcards page by page: read, then made from each page alone, then merged', async () => {
  forgetReadings();
  const texts = ['Process: a program in execution. '.repeat(20), 'Title', 'Thread: unit of scheduling. '.repeat(20)];
  const ai = fakeAI(request => {
    if (request.schema?.required?.includes('content')) return reading(`read ${request.images[0].label}`);
    const page = request.schema.properties.cards.items.properties.page.enum[0];
    return JSON.stringify({ cards: [
      { front: `Q${page}a`, back: 'x', page }, { front: `Q${page}b`, back: 'y', page }, { front: `Q${page}a`, back: 'dup', page }, { front: `Q${page}c`, back: 'z', page },
    ] });
  });
  const phases = [];
  const out = await smallStudy({
    ai, provider: 'webllm', kind: 'cards', pages: [0, 1, 2], amount: 2, title: 'SO', vision: true, contextTokens: 6144,
    pageImage: async p => jpeg(p + 10), pageText: async p => texts[p], clean, onProgress: p => phases.push(p.phase),
  });
  const reads = ai.calls.filter(c => c.images.length), makes = ai.calls.filter(c => !c.images.length);
  assert.equal(reads.length, 3);
  // Readings are short pages here, so they are packed (up to three).
  assert.equal(makes.length, 1);
  assert.match(makes[0].prompt, /^Make 7 flashcards/);
  assert.deepEqual(out.failures, []);
  assert.deepEqual(out.done, [0, 1, 2]);
  assert.ok(phases.includes('page 1 of 3 · reading'));
  assert.ok(phases.some(p => / · making cards$/.test(p)));
  // Duplicates dropped, then two per page.
  assert.deepEqual(out.items.map(c => c.front), ['Q1a', 'Q1b']);
});

test('a long page goes alone, a failed page is skipped and the others are kept', async () => {
  forgetReadings();
  const ai = fakeAI(request => {
    const page = request.schema.properties.questions.items.properties.page.enum[0];
    if (page === 2) throw Error('The GPU ran out of memory for this model.');
    return JSON.stringify({ questions: [{ question: `About page ${page}`, options: ['a', 'b', 'c', 'd'], answer: 0, page, point: 0 }] });
  });
  const out = await smallStudy({
    ai, provider: 'webllm', kind: 'quiz', pages: [0, 1, 2], amount: 1, vision: false,
    pageText: async p => `Page ${p} `.repeat(200), clean,
  });
  assert.equal(ai.calls.length, 3, 'text only: no reading step, one request per page');
  assert.deepEqual(out.items.map(q => q.question), ['About page 1', 'About page 3']);
  assert.deepEqual(out.failures, [{ page: 1, error: 'The GPU ran out of memory for this model.' }]);
});

test('cancelling stops before the next page and keeps what came back', async () => {
  forgetReadings();
  let stop = false;
  const ai = fakeAI(request => {
    const page = request.schema.properties.pages.items.properties.page.enum[0];
    stop = true;
    return JSON.stringify({ pages: [{ page, issues: [{ kind: 'error', quote: 'q', problem: 'wrong', correction: 'right' }] }] });
  });
  const out = await smallStudy({ ai, provider: 'webllm', kind: 'check', pages: [0, 1, 2], vision: false, pageText: async () => 'x'.repeat(1000), clean, cancelled: () => stop });
  assert.equal(ai.calls.length, 1);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].issues[0].correction, 'right');
});

test('the compact dialect keeps the core syntax and drops drawings and options', async () => {
  const dialect = await readFile(new URL('../../crates/noteful-core/src/ink/dialect.md', import.meta.url), 'utf8');
  const compact = compactDialect(dialect);
  assert.ok(compact.length < dialect.length * 0.6, `${compact.length} of ${dialect.length}`);
  assert.match(compact, /==phrase==/);
  assert.match(compact, /> \[sky\] TITLE/);
  assert.doesNotMatch(compact, /!draw|Options:|Classic look/);
});

// A page of 1000 × 1400 units with two lines of OCR words, as find.js gives them.
const layout = { size: [1000, 1400], words: [
  { text: 'Se', box: [100, 200, 40, 30] }, { text: 'puede', box: [150, 200, 90, 30] }, { text: 'factorizar', box: [250, 200, 160, 30] },
  { text: 'si', box: [100, 300, 30, 30] }, { text: 'a', box: [140, 300, 20, 30] }, { text: '≠', box: [170, 300, 20, 30] }, { text: '0', box: [200, 300, 20, 30] },
  { text: 'determinante', box: [100, 500, 200, 30] }, { text: 'nulo', box: [310, 500, 80, 30] },
] };

test('a quote is found among the page’s words, also when OCR misread a letter', () => {
  assert.deepEqual(locateQuote('Se puede factorizar', layout), [0.09, 0.133, 0.42, 0.174]);
  // "factorisar" for "factorizar", accents and case ignored.
  assert.deepEqual(locateQuote('se PUEDE factorisar', layout), [0.09, 0.133, 0.42, 0.174]);
  // A quote over two lines takes both.
  assert.deepEqual(locateQuote('factorizar si a', layout), [0.09, 0.133, 0.42, 0.246]);
  assert.equal(locateQuote('matriz inversa simétrica', layout), null);
  assert.equal(locateQuote('nulo', layout), null, 'one word is too little to place');
  // As Qwen quoted on a page of maths: short numbers match anywhere.
  assert.equal(locateQuote('0 - a', layout), null);
  assert.equal(locateQuote('determinante nulo', layout).length, 4);
  assert.equal(locateQuote('Se puede', { size: [0, 0], words: layout.words }), null);
});

test('quiz questions get their quote’s region as the hint, page by page', async () => {
  forgetReadings();
  const ai = fakeAI(request => {
    const page = request.schema.properties.questions.items.properties.page.enum[0];
    return JSON.stringify({ questions: [
      { question: '¿Cuándo se puede factorizar?', options: ['a≠0', 'a=0', 'siempre', 'nunca'], answer: 0, page, quote: 'Se puede factorizar', point: 0 },
      { question: '¿Qué pasa si el determinante es nulo?', options: ['w', 'x', 'y', 'z'], answer: 1, page, quote: 'algo que no está', point: 0 },
    ] });
  });
  const asked = [];
  const out = await smallStudy({
    ai, provider: 'webllm', kind: 'quiz', pages: [0], amount: 2, vision: false,
    pageText: async () => 'Se puede factorizar si a ≠ 0. '.repeat(20), pageWords: async p => { asked.push(p); return layout; }, clean,
  });
  assert.deepEqual(asked, [0]);
  assert.deepEqual(out.items.map(q => q.source.box), [[0.09, 0.133, 0.42, 0.174], null]);
  assert.equal(out.items[0].source.quote, 'Se puede factorizar');
});

test('the notes’ language is named for the model when the student left it to the note', () => {
  assert.equal(guessLanguage('Se puede factorizar si a es distinto de 0, y la matriz es invertible para todos los valores'), 'Spanish');
  assert.equal(guessLanguage('The determinant of the matrix is not zero, so it is invertible for all values of a'), 'English');
  assert.equal(guessLanguage('Δ1 = 1 ≠ 0  Δ2 = 6 − 8 = −2'), '');
  const pack = [{ page: 0, content: 'Se puede factorizar si a es distinto de 0 y la matriz es invertible para los valores', points: [] }];
  assert.match(packPrompt('quiz', pack), /Write in Spanish\./);
  assert.match(packPrompt('quiz', pack, { language: 'English' }), /Write in English\./);
});
