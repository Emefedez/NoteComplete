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
