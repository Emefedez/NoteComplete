import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanExamData, buildPaginatedExamHtml, examPrompt, FOCUS_MODES, PROBLEM_TYPES } from './exam-html.js';
import { tapeLinesFromNormalized, A4_UNITS } from './exam-pdf.js';

test('examPrompt encodes focus modes (important, everything, random), auto vs exact count, and diverse problem kinds', () => {
  assert.deepEqual(FOCUS_MODES.map(([id]) => id), ['important', 'everything', 'random']);
  assert.ok(PROBLEM_TYPES.some(([id]) => id === 'fill'));
  assert.ok(PROBLEM_TYPES.some(([id]) => id === 'open'));
  assert.ok(PROBLEM_TYPES.some(([id]) => id === 'code'));

  const autoComprehensive = examPrompt({
    title: 'ACII Parcial 1',
    sourcesText: 'Branch prediction and cache coherence',
    types: ['mcq', 'fill', 'calculation', 'open', 'table', 'code'],
    countMode: 'auto',
    focus: 'everything',
    language: 'Spanish',
    includeTheory: true,
  });
  assert.match(autoComprehensive, /Choose the optimal number of problems yourself/);
  assert.match(autoComprehensive, /Comprehensive coverage/);
  assert.match(autoComprehensive, /strictly in Spanish/);
  assert.match(autoComprehensive, /NOT inside dropdowns/);

  const randomExact = examPrompt({
    sourcesText: 'Pipeline hazards',
    countMode: 'exact',
    count: 9,
    focus: 'random',
    includeTheory: false,
  });
  assert.match(randomExact, /exactly 9 distinct problems/);
  assert.match(randomExact, /Random sampling/);
  assert.match(randomExact, /Omit standalone theory boxes/);
});

test('cleanExamData and buildPaginatedExamHtml emit ACII-styled HTML with [data-tape-answer] instead of <details> dropdowns', () => {
  const cleaned = cleanExamData({
    title: 'Examen Extenso Temario 1',
    subtitle: 'RISC-V & Caches',
    sections: [{
      heading: 'Aritmetica y Punteros',
      badge: 'BLOQUE 1',
      badgeKind: 'exam',
      theory: 'Little-endian stores the least significant byte at the lowest address.',
      problems: [
        {
          number: '1.1',
          kind: 'mcq',
          points: 1,
          prompt: 'Which byte sits at 0x1000 for 0x12345678 in little-endian?',
          options: ['0x12', '0x34', '0x78', '0x56'],
          answerBox: { summary: 'C) 0x78', steps: 'LSB is 0x78.', trap: 'Do not reverse nibbles inside a byte.' },
        },
        {
          number: '1.2',
          kind: 'fill',
          prompt: 'Complete the conversions:',
          expressions: [{ label: '0b10110110 -> hex:' }],
          answerBox: { summary: '0xB6' },
        },
        {
          number: '1.3',
          kind: 'table',
          prompt: 'Complete the cache table:',
          table: { headers: ['Hit', 'Miss'], rows: [['Fast', '']] },
          answerBox: { summary: 'Penalty stall' },
        },
        {
          number: '1.4',
          kind: 'code',
          prompt: 'Find the bug:',
          code: 'lw t0, 0(sp)\naddi sp, sp, -4',
          writingLines: 3,
          answerBox: { summary: 'Order of sp adjustment is reversed' },
        },
      ],
    }],
  });

  const html = buildPaginatedExamHtml(cleaned, { showTheory: true });
  assert.doesNotMatch(html, /<details\b/i);
  assert.match(html, /data-tape-answer="theory"/);
  assert.match(html, /data-tape-answer="solution"/);
  assert.match(html, /class="fill-line"/);
  assert.match(html, /class="writing-lines"/);
  assert.match(html, /<table class="exam-tbl">/);
  assert.match(html, /<pre class="exam-code"><code>/);
  assert.match(html, /Watch out:/);
});

test('tapeLinesFromNormalized turns measured answer/theory rects into yellow and blue Noteful tape coordinates', () => {
  const tapes = tapeLinesFromNormalized([
    { page: 0, rx: 0.1, ry: 0.2, rw: 0.8, rh: 0.12, kind: 'solution' },
    { page: 0, rx: 0.1, ry: 0.05, rw: 0.8, rh: 0.08, kind: 'theory' },
  ]);
  assert.equal(tapes.length, 2);
  assert.ok(tapes[0].x >= 0 && tapes[0].w <= A4_UNITS[0]);
  assert.ok(tapes[0].rgba[0] > 0.9); // gold/yellow solution tape
  assert.ok(tapes[1].rgba[2] > 0.9); // sky/blue theory tape
});
