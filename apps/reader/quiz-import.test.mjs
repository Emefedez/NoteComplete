import test from 'node:test';
import assert from 'node:assert/strict';
import { quizzesFromMarkdown, packFromMarkdown } from './quiz-import.js';

const md = `# Quiz Backlog

## Contents

1. Quiz 1 — 3 Qs

---

## 1. Quiz 1

**Course:** SO

### Q1 · Moodle · multichoice — ✅ verified

**¿Cuál?  
linea2**

![](data:image/png;base64,AAAA)

- A. uno
- B. ✅ **dos**
- C. ❌ tres *(picked)*

**Answer:** B — dos

> porque sí

### Q2 · match — 🤖 AI suggestion

**Relaciona**

| # | Item | Answer |
|---|------|--------|
| 1 | a | x |

### Q3 · multichoice — ❔ no answer

**Sin respuesta**

- A. a
- B. b
`;

test('parses options, image, explanation and skips the rest', () => {
  const { quizzes, skipped } = quizzesFromMarkdown(md, { now: 1 });
  assert.equal(quizzes.length, 1);
  assert.equal(skipped, 2);
  const q = quizzes[0].questions[0];
  assert.equal(q.question, '¿Cuál?\nlinea2');
  assert.deepEqual(q.options, ['uno', 'dos', 'tres']);
  assert.equal(q.answer, 1);
  assert.deepEqual(q.images, ['data:image/png;base64,AAAA']);
  assert.equal(q.explanation.text, 'porque sí');
  assert.equal(quizzes[0].title, 'Quiz 1');
});
test('pack and empty input', () => {
  assert.equal(packFromMarkdown(md).pack.quizzes.length, 1);
  assert.throws(() => packFromMarkdown('# nothing'));
});

test('pictures kept as separate files are counted as left out', () => {
  const m = md.replace('![](data:image/png;base64,AAAA)', '![](images/img-001.png)\n\n![](data:image/png;base64,BBBB)');
  const r = packFromMarkdown(m);
  assert.equal(r.missingImages, 1);
  assert.deepEqual(r.pack.quizzes[0].questions[0].images, ['data:image/png;base64,BBBB']);
});

test('a question with several marked answers becomes a choose-all question', () => {
  const m = '## 1. Q\n\n### Q1 · multichoice — ✅ verified\n\n**¿Cuáles?**\n\n- A. ✅ **a**\n- B. b\n- C. ✅ **c**\n';
  const q = quizzesFromMarkdown(m).quizzes[0].questions[0];
  assert.deepEqual(q.answers, [0, 2]);
  assert.equal(q.answer, 0);
  assert.equal(q.multi, true);
});
