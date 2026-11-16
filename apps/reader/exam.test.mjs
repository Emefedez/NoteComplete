import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanExamData, buildPaginatedExamHtml, examPrompt, FOCUS_MODES, PROBLEM_TYPES,
  ensureExamMathRenderer, renderRichExamHtml, EXAM_PRINT_CSS,
  buildFallbackExamPlan, cleanExamPlan, mergeExamSections,
  splitExamHeuristically, cleanSplitExercises, cleanSolvedExercise,
  buildSolvedExamHtml, buildSolvedExamMcpMarkdown,
} from './exam-html.js';
import { tapeLinesFromNormalized, A4_UNITS } from './exam-pdf.js';
import { collectSourceLinks, uniqueExamTitle, resolveUniqueExamTitle } from './exam.js';
import { detectExpandMode, buildExpandGuidance, summarizeExistingDocument, dedupeNewExamProblems, dedupeNewMarkdownSections, mergeEmbeddedExam } from './expand.js';

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
  assert.match(autoComprehensive, /CRITICAL EXERCISE MIX RULE/);
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

test('collectSourceLinks awaits async groups.members when linking folder sources', async () => {
  const sources = [
    { kind: 'recent', entry: { key: 'local:/docs/Resumen T1+2.noteful', name: 'Resumen T1+2.noteful', title: 'Resumen T1+2' } },
    { kind: 'group', group: { id: 'folder:/docs/Examenes', name: 'Examenes' } },
  ];
  const resolved = [{ title: 'Resumen T1+2', name: 'Resumen T1+2.noteful', folderName: '' }];
  const groups = {
    async members(g) {
      assert.equal(g.id, 'folder:/docs/Examenes');
      return [{ key: 'local:/docs/Examenes/2026/2026_1.jpeg', name: '2026/2026_1.jpeg' }];
    },
  };
  const links = await collectSourceLinks(sources, resolved, { groups });
  assert.ok(links.resourceKeys.includes('local:/docs/Resumen T1+2.noteful'));
  assert.ok(links.resourceKeys.includes('folder:/docs/Examenes'));
  assert.ok(links.resourceKeys.includes('group:folder:/docs/Examenes'));
  assert.ok(links.resourceKeys.includes('local:/docs/Examenes/2026/2026_1.jpeg'));
  assert.ok(links.resourceLabels.includes('2026/2026_1.jpeg'));
});

test('detectExpandMode and buildExpandGuidance support both exam question mode and note mode', () => {
  assert.equal(detectExpandMode({ existingExam: {}, hasTapeOnPages: false, openTitle: 'Temas1+2' }), 'exam');
  assert.equal(detectExpandMode({ existingExam: null, hasTapeOnPages: true, openTitle: 'Untitled' }), 'exam');
  assert.equal(detectExpandMode({ existingExam: null, hasTapeOnPages: false, openTitle: 'Examen SO' }), 'exam');
  assert.equal(detectExpandMode({ existingExam: null, hasTapeOnPages: false, openTitle: 'Apuntes Tema 1' }), 'note');

  const selfExam = buildExpandGuidance({
    existingSummary: '1.1 Explain fork()',
    kind: 'exam',
    openTitle: 'Examen SO',
    openPages: 4,
    selfOnly: true,
  });
  assert.match(selfExam, /NEW, complementary exam problems/);
  assert.match(selfExam, /DO NOT repeat/);

  const noteMode = buildExpandGuidance({
    existingSummary: 'Paging basics',
    kind: 'note',
    openTitle: 'Temas1+2',
    openPages: 12,
  });
  assert.match(noteMode, /EXPANDING an existing handwritten notebook/);
});

test('summarizeExistingDocument and dedupe helpers prevent re-asking existing exam questions or note sections', () => {
  const existingExam = [
    '[Page 1]',
    '1.1 Explica qué valores devuelve fork() en el proceso padre y en el proceso hijo en POSIX.',
    'Answer: Padre recibe PID del hijo, hijo recibe 0.',
    '1.2 Calcula el tiempo efectivo de acceso (EAT) con TLB hit rate del 90% y memoria 100 ns.',
    '[Page 6]',
    '3.4 Describe la inversión de prioridades y cómo la resuelve el protocolo de herencia de prioridad.',
  ].join('\n');

  const summary = summarizeExistingDocument(existingExam, { kind: 'exam', maxChars: 400 });
  assert.match(summary, /fork\(\)/);
  assert.match(summary, /inversión de prioridades/);

  const candidate = {
    title: 'Expansion',
    sections: [{
      heading: 'Procesos y Memoria',
      problems: [
        {
          number: '4.1',
          kind: 'open',
          prompt: 'Explica qué valores devuelve la llamada al sistema fork() en el proceso padre y en el hijo.',
          answerBox: { summary: 'PID hijo y 0' },
        },
        {
          number: '4.2',
          kind: 'calculation',
          prompt: 'Dado un disco con latencia rotacional de 4 ms y seek de 6 ms, calcula el tiempo medio de E/S.',
          answerBox: { summary: '10 ms + transferencia' },
        },
      ],
    }],
  };
  const deduped = dedupeNewExamProblems(candidate, existingExam);
  assert.equal(deduped.removed, 1);
  assert.equal(deduped.exam.sections[0].problems.length, 1);
  assert.match(deduped.exam.sections[0].problems[0].prompt, /latencia rotacional/);

  const existingNote = '## Planificación de CPU\nRound-Robin asigna un quantum fijo por turno.';
  const mdOut = dedupeNewMarkdownSections(
    '## Planificación de CPU\nRound-Robin asigna un quantum fijo por turno.\n\n## Memoria Virtual\nLa paginación bajo demanda carga páginas cuando ocurre un fallo.',
    existingNote,
  );
  assert.equal(mdOut.removed, 1);
  assert.doesNotMatch(mdOut.markdown, /Planificación de CPU/);
  assert.match(mdOut.markdown, /Memoria Virtual/);
});

test('renderRichExamHtml lazily loads bundled KaTeX MathML and leaves currency dollar signs literal', async () => {
  const katex = await ensureExamMathRenderer();
  assert.ok(katex && typeof katex.renderToString === 'function');
  const html = renderRichExamHtml('Energy is $E = mc^2$ and costs $5 or $$\\frac{a}{b}$$');
  assert.match(html, /<math/);
  assert.match(html, /\$5/);
  assert.match(html, /class="math-block"/);
});

test('Stage-1 exam plan helpers balance sources into parallel chunks and Stage-3 merges them', () => {
  const docs = [
    { title: 'Tema 1', text: 'a'.repeat(18000) },
    { title: 'Tema 2', text: 'b'.repeat(17000) },
    { title: 'Tema 3', text: 'c'.repeat(5000) },
  ];
  const fallback = buildFallbackExamPlan(docs, { countMode: 'exact', count: 9, maxChunks: 4 });
  assert.ok(fallback.length >= 2);
  assert.equal(fallback.reduce((s, c) => s + c.count, 0), 9);

  const plan = cleanExamPlan(
    {
      title: 'Parcial SO',
      chunks: [
        { heading: 'Procesos', badge: 'BLOCK 1', badgeKind: 'exam', docIndices: [0], count: 4 },
        { heading: 'Memoria', badge: 'BLOCK 2', badgeKind: 'src', docIndices: [1], count: 3 },
      ],
    },
    docs,
    { countMode: 'exact', count: 10 },
  );
  // Missing doc index 2 gets auto-assigned and total exact count reconciles to 10.
  assert.ok(plan.chunks.flatMap((c) => c.docIndices).includes(2));
  assert.equal(plan.chunks.reduce((s, c) => s + c.count, 0), 10);

  const merged = mergeExamSections(
    [
      { sections: [{ badge: 'B1', badgeKind: 'exam', heading: 'Sec 1', problems: [{ kind: 'open', prompt: 'Define fork() syscall.' }] }] },
      { sections: [{ badge: 'B2', badgeKind: 'src', heading: 'Sec 2', problems: [{ kind: 'open', prompt: 'Define fork() syscall.' }, { kind: 'calculation', prompt: 'Compute CPI for 2GHz CPU.' }] }] },
    ],
    { title: 'Final SO', subtitle: 'Merged parallel exam' },
  );
  assert.equal(merged.title, 'Final SO');
  assert.equal(merged.sections.length, 2);
  assert.equal(merged.sections[1].problems.length, 1);
  assert.equal(merged.sections[1].problems[0].number, '2.1');
});

test('Solve-exam Stage-1 splitter, Stage-2 cleaner, and Stage-3 alternating PDF & MCP composers preserve per-exercise new pages and math', async () => {
  await ensureExamMathRenderer();
  const sampleRaw = [
    'Ejercicio 1: Planificación',
    'Calcula el tiempo medio.',
    'a) FIFO',
    'b) RR',
    '',
    'Ejercicio 2: Paginación',
    'Traduce direcciones virtuales.',
  ].join('\n');
  const heuristic = splitExamHeuristically(sampleRaw, 'Examen SO');
  assert.equal(heuristic.length, 2);

  const split = cleanSplitExercises(null, sampleRaw, 'Examen SO');
  assert.equal(split.exercises.length, 2);

  const solved1 = cleanSolvedExercise(
    {
      number: '1',
      title: 'Planificación',
      exerciseHeading: 'Ejercicio 1: Planificación',
      stepsHeading: 'Pasos',
      solutionHeading: 'Solución (Ejercicio 1)',
      statement: 'Calcula el tiempo medio con $T_q = 2\\text{ ms}$.',
      theory: 'FIFO atiende por orden de llegada.',
      partSteps: [
        { label: 'a)', hint: 'Ordena procesos por tiempo de llegada.' },
        { label: 'b)', hint: 'Aplica quantum $q=2$.' },
      ],
      partSolutions: [
        { label: 'a)', answer: '4.5 ms', work: '$$\\bar{T} = \\frac{0+4+9.5}{3}$$' },
        { label: 'b)', answer: '5.0 ms', work: 'Con $q=2$ alternan cada 2 ms.' },
      ],
    },
    heuristic[0],
    0,
  );
  const solved2 = cleanSolvedExercise(
    {
      number: '2',
      title: 'Paginación',
      exerciseHeading: 'Ejercicio 2: Paginación',
      stepsHeading: 'Pasos',
      solutionHeading: 'Solución (Ejercicio 2)',
      statement: 'Traduce $0x1A04$.',
      partSteps: [{ label: 'a)', hint: 'Extrae offset.' }],
      partSolutions: [{ label: 'a)', answer: '0x0204', work: 'Offset de 12 bits.' }],
    },
    heuristic[1],
    1,
  );

  const html = buildSolvedExamHtml({ title: 'Examen SO Resuelto', exercises: [solved1, solved2] }, { showTheory: true, tapeSolutions: true });
  // Structure: Ex1 -> page-break -> Solution (Ex 1) -> page-break -> Ex2 -> page-break -> Solution (Ex 2)
  assert.equal((html.match(/<div class="page-break"><\/div>/g) || []).length, 3);
  assert.match(html, /Pasos:/);
  assert.match(html, /Solución \(Ejercicio 1\)/);
  assert.match(html, /data-tape-answer="solution"/);
  assert.match(html, /<math/);

  const noTapeHtml = buildSolvedExamHtml({ title: 'No Tape', exercises: [solved1] }, { tapeSolutions: false });
  assert.doesNotMatch(noTapeHtml, /data-tape-answer="solution"/);

  const md = buildSolvedExamMcpMarkdown({ title: 'Examen SO Resuelto', exercises: [solved1, solved2] }, { tapeSolutions: true, showTheory: true });
  assert.equal((md.match(/\\pagebreak/g) || []).length, 3);
  assert.match(md, /### Pasos:/);
  assert.match(md, /## Solución \(Ejercicio 1\):/);
  assert.match(md, /!tape yellow/);
  assert.match(md, /!tape sky/);
  assert.match(md, /\$\$\\bar\{T\}/);
});

test('jsonFrom repairs unescaped inner double quotes, LaTeX backslashes, and trailing commas in large AI outputs', async () => {
  const { jsonFrom } = await import('./ai-context.js');
  const malformed = '{"title":"Examen SO","sections":[{"heading":"Bloque 1","problems":[{"kind":"open","prompt":"Si un proceso llama a exec("ls") en estado "Listo", pasa a \\frac{1}{2}.","answerBox":{"summary":"Devuelve {"ok": 1}"},},]}]}';
  const parsed = jsonFrom(malformed);
  assert.equal(parsed.title, 'Examen SO');
  assert.match(parsed.sections[0].problems[0].prompt, /exec\("ls"\)/);
  assert.match(parsed.sections[0].problems[0].prompt, /"Listo", pasa/);
  assert.match(parsed.sections[0].problems[0].answerBox.summary, /\{"ok": 1\}/);
});

test('uniqueExamTitle and resolveUniqueExamTitle never collide with existing entries, indexed exams, or disk files', async () => {
  assert.equal(uniqueExamTitle('Examen SO', []), 'Examen SO');
  assert.equal(uniqueExamTitle('Examen SO', ['examen so.nfedit']), 'Examen SO (2)');
  assert.equal(uniqueExamTitle('Examen SO', ['Examen SO', 'Examen SO (2).nfedit']), 'Examen SO (3)');
  assert.equal(uniqueExamTitle('Examen SO (2)', ['Examen SO (2)']), 'Examen SO (3)');

  const diskFiles = new Map([['Examen SO.nfedit', new Uint8Array([1, 2, 3])]]);
  const fakeStore = {
    values: async (name) => (name === 'entries'
      ? [{ key: 'imported:1', name: 'Examen SO (2).nfedit', filename: 'Examen SO (2).nfedit' }]
      : []),
    get: async (_store, key) => (key === 'exams:index'
      ? [{ id: 'e3', title: 'Examen SO (3)', fileName: 'Examen SO (3).nfedit' }]
      : null),
  };
  const fakeLibrary = {
    store: fakeStore,
    location: async () => ({
      read: async (name) => (diskFiles.has(name) ? new Blob([diskFiles.get(name)]) : null),
    }),
  };
  const chosen = await resolveUniqueExamTitle('Examen SO', { library: fakeLibrary });
  assert.equal(chosen, 'Examen SO (4)');
});

test('mergeEmbeddedExam appends structured sections cleanly and splices fallback HTML without dropping header', async () => {
  await ensureExamMathRenderer();
  const baseExam = {
    title: 'Parcial SO',
    sections: [{ heading: 'Bloque 1', problems: [{ kind: 'open', prompt: 'Describe PCB.', answerBox: { summary: 'Struct.' } }] }],
  };
  const extraExam = {
    title: 'Parcial SO',
    sections: [{ heading: 'Bloque 2', problems: [{ kind: 'calculation', prompt: 'Calc TT for $$2+3$$.', answerBox: { summary: '5' } }] }],
  };
  const initialHtml = buildPaginatedExamHtml(baseExam, { showTheory: true, interactiveFallback: true });

  const mergedStructured = mergeEmbeddedExam(
    { html: initialHtml, source: { mode: 'create', exam: baseExam, prefs: { includeTheory: true } } },
    extraExam,
    { showTheory: true },
  );
  assert.equal(mergedStructured.source.exam.sections.length, 2);
  assert.match(mergedStructured.html, /Bloque 1/);
  assert.match(mergedStructured.html, /Bloque 2/);
  assert.match(mergedStructured.html, /<math/);

  const mergedRawHtml = mergeEmbeddedExam(
    { html: initialHtml.replace('Describe PCB.', 'Edited PCB prompt.'), source: null },
    extraExam,
    { showTheory: true },
  );
  assert.match(mergedRawHtml.html, /Edited PCB prompt\./);
  assert.match(mergedRawHtml.html, /Bloque 2/);
  assert.equal((mergedRawHtml.html.match(/<header class="exam-hdr"/g) || []).length, 1);
});

test('EXAM_PRINT_CSS uses >= 10pt body typography and generous solution spacing', () => {
  const bodySize = /html,\s*body\s*\{[^}]*font-size:\s*([\d.]+)pt/.exec(EXAM_PRINT_CSS);
  assert.ok(bodySize && Number(bodySize[1]) >= 10);
  const keyBlock = /\.key\s*\{[^}]+\}/.exec(EXAM_PRINT_CSS)?.[0] || '';
  // Solutions are unboxed (no side padding) with room to write between them.
  assert.match(keyBlock, /margin-top:\s*16px/);
  assert.match(keyBlock, /padding:\s*6px 0 4px 0/);
  assert.match(keyBlock, /font-size:\s*10\.6pt/);
  assert.doesNotMatch(keyBlock, /border:/);
  const partBlock = /\.solve-part-ans\s*\{[^}]+\}/.exec(EXAM_PRINT_CSS)?.[0] || '';
  assert.match(partBlock, /margin:\s*14px 0/);
  assert.match(partBlock, /padding:\s*4px 0/);

  const md = buildSolvedExamMcpMarkdown({
    title: 'Spacing Check',
    exercises: [{
      exerciseHeading: 'Ex 1',
      statement: 'Q?',
      stepsHeading: 'Steps',
      partSteps: [],
      solutionHeading: 'Sol',
      partSolutions: [{ label: 'a)', answer: '42', work: '6 * 7' }],
    }],
  });
  assert.match(md, /\*\*a\)\*\* 42\n\n6 \* 7/);
});
