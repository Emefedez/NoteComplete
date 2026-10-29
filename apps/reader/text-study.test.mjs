import test from 'node:test';
import assert from 'node:assert/strict';
import { textSections, normalize, findPassage } from './text-study.js';
import { headingFor, headingSlug } from './text-view.js';
import { prepareQuestions, quizPrompt } from './quiz.js';
import { prompts, cardCheckPrompt } from './study.js';
import { textBlock, pagesContext } from './ai-context.js';
import { normalizeMarkdown } from './rich-text.js';

const slice = (text, sections) => sections.map((s) => text.slice(s.start, s.end));

test('a short text is one section; an empty one still has one', () => {
  assert.deepEqual(textSections('Hola\n\nmundo'), [{ start: 0, end: 11 }]);
  assert.equal(textSections('').length, 1);
});

test('sections pack paragraphs up to the size and start at headings once half full', () => {
  const para = (c) => `${c.repeat(40)}\n`;
  const text = `# Uno\n\n${para('a')}\n${para('b')}\n# Dos\n\n${para('c')}`;
  const parts = slice(text, textSections(text, 100));
  assert.equal(parts.length, 2);
  assert.ok(parts[0].startsWith('# Uno') && parts[0].includes('b'.repeat(40)));
  assert.ok(parts[1].startsWith('# Dos') && parts[1].includes('c'.repeat(40)));
  // Nothing is lost or repeated between sections.
  assert.equal(parts.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('a block longer than the size is cut at whitespace', () => {
  const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const parts = slice(text, textSections(text, 100));
  assert.ok(parts.length > 3);
  for (const part of parts) assert.ok(part.length <= 100 && !/^\s|\s$/.test(part) && /^word\d+( word\d+)*$/.test(part));
});

test('quotes are found in rendered text despite Markdown marks, case and spacing', () => {
  assert.equal(normalize('  **La  memoria**\n_virtual_ '), 'la memoria virtual');
  const chunks = ['Intro. ', 'La memoria', ' virtual usa ', 'páginas', ' de 4 KiB.'];
  const hit = findPassage(chunks, 'la **memoria virtual** usa páginas');
  assert.deepEqual(hit.from, [1, 0]);
  assert.deepEqual(hit.to, [3, 7]);
  // A quote whose end differs (a rendered link or formula) is found by its first words.
  assert.deepEqual(findPassage(chunks, 'La memoria virtual usa [páginas](x) of 4096 bytes').from, [1, 0]);
  assert.equal(findPassage(chunks, 'nada de esto'), null);
});

test('in-document links find their heading like GitHub anchors', () => {
  assert.equal(headingSlug('Tema 1: Introducción'), 'tema-1-introducción');
  const headings = ['Índice', 'Tema 1: Introducción', 'Ejemplos', 'Ejemplos'];
  assert.equal(headingFor(headings, 'tema-1-introducción'), 1);
  assert.equal(headingFor(headings, 'tema-1-introducci%C3%B3n'), 1);
  assert.equal(headingFor(headings, 'tema-1-introduccion'), 1, 'accents may be left out');
  assert.equal(headingFor(headings, 'ejemplos-1'), 3);
  assert.equal(headingFor(headings, 'falta'), -1);
});

test("a document's own links are not rewritten as AI page links", () => {
  assert.equal(normalizeMarkdown('[Página 3](#pagina-3)', { links: false }), '[Página 3](#pagina-3)');
  assert.equal(normalizeMarkdown('[Página 3](#pagina-3)'), '[Página 3](#page-3)');
});

test('text sections go to the AI as text, without images', async () => {
  const context = await pagesContext([0, 1], { pageCanvas: async () => null, pageText: async (p) => ({ document: `parte ${p + 1}` }), unit: 'section' });
  assert.deepEqual(context.images, []);
  assert.equal(context.text, '--- Section 1 ---\nText:\nparte 1\n\n--- Section 2 ---\nText:\nparte 2');
  assert.equal(textBlock(0, {}), '--- Page 1 ---\n(no extracted text; read the image)');
});

test('quizzes on text documents cite a quote, which is kept with the source', () => {
  const prompt = quizPrompt('Ask well.', { amount: 3, title: 'Tema 1', unit: 'section' });
  assert.match(prompt, /per section/);
  assert.match(prompt, /"quote"/);
  assert.doesNotMatch(quizPrompt('Ask well.', { amount: 3, title: 'Tema 1' }), /"quote"/);
  const [q] = prepareQuestions({ questions: [{ question: 'Q?', options: ['a', 'b'], answer: 0, source: { page: 2, quote: ' la memoria virtual ' } }] }, [0, 1], () => 0.9);
  assert.deepEqual(q.source, { page: 2, box: null, quote: 'la memoria virtual' });
});

test('flashcard prompts speak of sections for text documents', () => {
  const cards = prompts('cards', { amount: 4, title: 'Tema 1', unit: 'section' });
  assert.match(cards, /per section/);
  assert.doesNotMatch(cards, /image/);
  assert.match(cardCheckPrompt({ front: 'a', back: 'b' }, 'section'), /section of the document/);
  assert.match(cardCheckPrompt({ front: 'a', back: 'b' }, true), /attached image/);
});

test('find in a text document ignores case and accents and spans text nodes', async () => {
  const { findAll } = await import('./text-find.js');
  const hits = findAll(['La Memoria', ' virtual; la memória ', 'VIRTUAL'], 'memoria virtual');
  assert.deepEqual(hits, [{ from: [0, 3], to: [1, 8] }, { from: [1, 13], to: [2, 7] }]);
  assert.deepEqual(findAll(['abc'], '   '), []);
  assert.equal(findAll(['aaaa'], 'aa').length, 2, 'matches do not overlap');
});
