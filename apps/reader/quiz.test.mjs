import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareQuestions, score, wrongQuestions, quizPrompt, DEFAULT_QUIZ_PROMPT, correctOf, quizCards, barStates } from './quiz.js';
import { progressAt, createAiMonitor } from './jobs.js';

const reply = { questions: [
  { question: '¿Qué almacena una celda DRAM?', options: ['Un bit en un condensador', 'Un bit en un biestable', 'Dos bits', 'Nada'], answer: 0, source: { page: 7, box: [0.05, 0.3, 0.95, 0.5] } },
  { question: 'Mal formada', options: ['a'], answer: 0 },
  { question: '**NUEVO EJERCICIO** ¿…?', options: ['1', '2', '3', '4'], answer: 3, source: { page: 99, box: [0, 0, 1, 1] } },
  { question: 'Caja inválida', options: ['a', 'b'], answer: 1, source: { page: 8, box: [0.5, 0.5, 0.4, 0.6] } },
] };

test('questions keep their correct option through the shuffle and cite only chosen pages', () => {
  let n = 0;
  const qs = prepareQuestions(reply, [6, 7], () => (n++ % 3) / 3);
  assert.equal(qs.length, 3);
  assert.equal(qs[0].options[qs[0].answer], 'Un bit en un condensador');
  assert.deepEqual(qs[0].source, { page: 7, box: [0.05, 0.3, 0.95, 0.5] });
  assert.equal(qs[1].source, null, 'page 99 was not sent, so no source');
  assert.deepEqual(qs[2].source, { page: 8, box: null }, 'a bad box falls back to the whole page');
});

test('scoring: 2 correct, 1 with the hint, 0 wrong; disputed questions do not count', () => {
  const quiz = { questions: [{ answer: 0 }, { answer: 1 }, { answer: 2 }, { answer: 0, disputed: true }], answers: { 0: { choice: 0 }, 1: { choice: 1, hinted: true }, 2: { choice: 0 }, 3: { choice: 1 } } };
  assert.deepEqual(score(quiz), { points: 3, answered: 3, max: 6 });
  quiz.questions[2].correction = { answer: 0, note: 'The notes say 0' };
  assert.equal(correctOf(quiz.questions[2]), 0);
  assert.equal(score(quiz).points, 5, 'a correction makes the earlier answer right');
});

test('retake collects wrong, undisputed questions once across quizzes', () => {
  const a = { questions: [{ question: 'A', answer: 0 }, { question: 'B', answer: 1 }, { question: 'C', answer: 0, disputed: true }], answers: { 0: { choice: 1 }, 1: { choice: 1 }, 2: { choice: 1 } } };
  const b = { questions: [{ question: 'A', answer: 0 }, { question: 'D', answer: 2 }], answers: { 0: { choice: 3 }, 1: { choice: 0 } } };
  assert.deepEqual(wrongQuestions([a, b]).map(q => q.question), ['A', 'D']);
});

test('the quiz prompt carries the instructions, language and JSON shape', () => {
  const p = quizPrompt(DEFAULT_QUIZ_PROMPT, { amount: 3, language: '', title: 'Memoria 1' });
  assert.match(p, /NUEVO EJERCICIO/);
  assert.match(p, /similar length/);
  assert.match(p, /note's own language/);
  assert.match(p, /"source":\{"page"/);
  assert.doesNotMatch(p, /explanation/);

  const multi = quizPrompt(DEFAULT_QUIZ_PROMPT, { amount: 4, language: 'Spanish', title: 'Tema 1', pages: [2, 3, 4] });
  assert.match(multi, /TOTAL of about 12 questions/);
  assert.match(multi, /3 pages \(3, 4, 5\)/);
});

test('job progress moves continuously within each batch', () => {
  const base = { pages: 12, prepared: 12, batches: 2, done: 0, inflight: [1000] };
  assert.equal(progressAt({ ...base, prepared: 6, inflight: [] }), 0.1);
  const early = progressAt(base, 1000 + 5000), later = progressAt(base, 1000 + 40000);
  assert.ok(early > 0.2 && later > early && later < 0.6, `${early} ${later}`);
  assert.ok(Math.abs(progressAt({ ...base, done: 1, inflight: [] }) - 0.6) < 1e-9);
});

test('job progress grows while preparation and answers interleave', () => {
  // 36 pages in 6 batches, 3 in flight: the bar must not wait for all pages.
  const p = progressAt({ pages: 36, prepared: 18, batches: 6, done: 2, inflight: [0, 0, 0] }, 20000);
  assert.ok(p > 0.35 && p < 0.8, String(p));
});

test('a quiz exports as flashcards: options on the front, accepted answer and notes on the back', () => {
  const quiz = { questions: [
    { question: 'Q1', options: ['a', 'b', 'c'], answer: 1, source: { page: 3 }, explanation: { text: 'Because.' } },
    { question: 'Q2', options: ['x', 'y'], answer: 0, correction: { answer: 1, note: 'The slide says y.' } },
    { question: 'Q3', options: ['m', 'n'], answer: 0, disputed: true },
  ] };
  assert.deepEqual(quizCards(quiz), [
    { front: 'Q1\n\nA. a\nB. b\nC. c', back: 'B. b\n\nBecause.', page: 3 },
    { front: 'Q2\n\nA. x\nB. y', back: 'B. y\n\nCorrection: The slide says y.', page: undefined },
  ]);
});

test('the progress bar shows right, right with the hint, wrong and disputed', () => {
  const quiz = { questions: [{ answer: 0 }, { answer: 1 }, { answer: 0 }, { answer: 0, disputed: true }, { answer: 1, correction: { answer: 0 } }, { answer: 0 }],
    answers: { 0: { choice: 0 }, 1: { choice: 1, hinted: true }, 2: { choice: 1 }, 3: { choice: 0 }, 4: { choice: 0 } } };
  assert.deepEqual(barStates(quiz), ['right', 'hinted', 'wrong', 'disputed', 'right', '']);
});

import { isMulti, isRight, correctSet, reorderQuizQuestions } from './quiz.js';
test('choose-all-that-apply: only the exact set is right, scored like any question', () => {
  const q = { question: 'q', options: ['a', 'b', 'c', 'd'], answer: 0, answers: [0, 2], multi: true };
  assert.ok(isMulti(q));
  assert.deepEqual(correctSet(q), [0, 2]);
  assert.ok(isRight(q, { choices: [2, 0] }));
  assert.ok(!isRight(q, { choices: [0] }));
  assert.ok(!isRight(q, { choices: [0, 1, 2] }));
  const quiz = { questions: [q, { question: 's', options: ['a', 'b'], answer: 1 }], answers: { 0: { choices: [0, 2], choice: 0 }, 1: { choice: 1, hinted: true } } };
  assert.deepEqual(score(quiz), { points: 3, answered: 2, max: 4 });
  assert.deepEqual(barStates(quiz), ['right', 'hinted']);
  assert.ok(isRight({ ...q, correction: { answer: 1, answers: [1, 3] } }, { choices: [1, 3] }));
  assert.ok(!isMulti({ question: 's', options: ['a', 'b'], answer: 1 }));
});
test('a multi-answer question on the back of a card lists every right option', () => {
  const [card] = quizCards({ questions: [{ question: 'q', options: ['a', 'b', 'c'], answer: 0, answers: [0, 2], multi: true }] });
  assert.match(card.back, /A\. a\n\nC\. c/);
});
test('reorderQuizQuestions shuffles and restores original question order while keeping answers and current question', () => {
  const quiz = {
    questions: [{ question: 'Q0', answer: 0 }, { question: 'Q1', answer: 1 }, { question: 'Q2', answer: 2 }],
    answers: { 0: { choice: 0 }, 2: { choice: 1 } },
    at: 0,
  };
  reorderQuizQuestions(quiz, true, () => 0);
  assert.deepEqual(quiz.questions.map(q => q.question), ['Q1', 'Q2', 'Q0']);
  assert.deepEqual(quiz.answers[quiz.questions.findIndex(q => q.question === 'Q0')], { choice: 0 });
  assert.deepEqual(quiz.answers[quiz.questions.findIndex(q => q.question === 'Q2')], { choice: 1 });
  reorderQuizQuestions(quiz, false);
  assert.deepEqual(quiz.questions.map(q => q.question), ['Q0', 'Q1', 'Q2']);
  assert.deepEqual(quiz.answers, { 0: { choice: 0 }, 2: { choice: 1 } });
});

test('createAiMonitor skips buffering while closed, tracks parallel streams when open, and discards buffers on close or completion', async () => {
  const monitor = createAiMonitor({ maxChars: 20 });
  assert.equal(monitor.wrap(null), null);

  let releaseA, releaseB;
  const seenOnDelta = [];
  const rawAi = {
    run(req, onDelta) {
      seenOnDelta.push(typeof onDelta);
      if (req.tag === 'exam') {
        onDelta?.('hidden-chunk');
        return new Promise((r) => { releaseA = () => r({ text: 'doneA' }); });
      }
      if (req.tag === 'study') {
        onDelta?.('hello ');
        onDelta?.('world-1234567890-tail');
        return new Promise((r) => { releaseB = () => r({ text: 'doneB' }); });
      }
      return Promise.resolve({ text: 'ok' });
    },
  };
  const ai = monitor.wrap(rawAi);

  // 1. Not watching + non-streaming caller: onDelta is not passed at all.
  await ai.run({ tag: 'chat', provider: 'claude' });
  assert.equal(seenOnDelta.at(-1), 'undefined');
  assert.equal(monitor.active().length, 0);

  try {
    // 2. Not watching + streaming caller: caller gets chunk, monitor keeps 0 chars.
    const callerChunks = [];
    const pA = ai.run({ tag: 'exam', provider: 'claude' }, c => callerChunks.push(c));
    assert.deepEqual(callerChunks, ['hidden-chunk']);
    assert.equal(monitor.active().length, 1);
    assert.equal(monitor.active()[0].text, '');

    // 3. Open live inspector: newly started non-streaming agent now streams in parallel!
    monitor.setWatching(true);
    const pB = ai.run({ tag: 'study', provider: 'codex' });
    assert.equal(seenOnDelta.at(-1), 'function');
    const active = monitor.active();
    assert.equal(active.length, 2);
    assert.equal(active[1].label, 'Study');
    assert.equal(active[1].text.length, 20);
    assert.equal(active[1].text, 'rld-1234567890-tail'.padStart(20, 'o'));

    // Closing the inspector immediately clears all buffered text.
    monitor.setWatching(false);
    assert.equal(monitor.active()[1].text, '');

    // Finishing removes active agents so zero history stays.
    releaseA(); releaseB();
    await Promise.all([pA, pB]);
    assert.equal(monitor.active().length, 0);
  } finally {
    releaseA?.();
    releaseB?.();
  }
});

test('createAiMonitor reads caller peek buffer immediately upon opening and strips label/peek before rawAi.run', async () => {
  const { createAiMonitor } = await import('./jobs.js');
  const monitor = createAiMonitor({ maxChars: 120 });
  let release = null;
  let seenReq = null;
  let callerBuf = '';
  const rawAi = {
    run(req, onDelta) {
      seenReq = req;
      onDelta?.('first token before inspect ');
      return new Promise((r) => { release = () => r({ text: callerBuf }); });
    },
  };
  const ai = monitor.wrap(rawAi);
  try {
    const pending = ai.run(
      { tag: 'solve-chunk', label: 'Solver subagent · Ex 1', provider: 'codex', peek: () => callerBuf },
      (chunk) => { callerBuf += chunk; },
    );
    assert.equal('label' in seenReq, false);
    assert.equal('peek' in seenReq, false);
    assert.equal(monitor.active()[0].label, 'Solver subagent · Ex 1');
    assert.equal(monitor.active()[0].streams, true);
    // Watching while already mid-run immediately reflects callerBuf without extra monitor copy.
    monitor.setWatching(true);
    assert.equal(monitor.active()[0].text, 'first token before inspect ');
    release();
    await pending;
    assert.equal(monitor.active().length, 0);
  } finally {
    release?.();
  }
});
