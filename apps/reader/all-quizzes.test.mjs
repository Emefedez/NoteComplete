import test from 'node:test';
import assert from 'node:assert/strict';
import { groupQuizzes } from './all-quizzes.js';
import { ankiDecks, studyGroups } from './study.js';

test('quizzes are grouped by document, newest first, unknown ones last', () => {
  const groups = groupQuizzes([['quizzes:a', [{ id: 1 }]], ['quizzes:b', [{ id: 2 }, { id: 3 }]], ['quizzes:c', []], ['quizzes:d', [{ id: 4 }]]],
    new Map([['a', { title: 'Tema 1', at: 1 }], ['b', { title: 'Tema 2', at: 5 }]]));
  assert.deepEqual(groups.map(g => [g.fp, g.quizzes.length]), [['b', 2], ['a', 1], ['d', 1]]);
});

test('a note exports its decks and quizzes as Anki decks named Note::Deck', () => {
  const groups = studyGroups('ACII', [{ title: 'Tema 1', cards: [{ front: 'F', back: 'B', page: 2 }] }],
    [{ title: 'Quiz', questions: [{ question: 'Q', options: ['a', 'b'], answer: 1 }] }]);
  const text = ankiDecks(groups).split('\n');
  assert.equal(text[3], '#deck column:4');
  assert.equal(text[4], 'F\tB\tp2\tACII::Tema 1');
  assert.equal(text[5], 'Q<br><br>A. a<br>B. b\tB. b\t\tACII::Quiz');
});
