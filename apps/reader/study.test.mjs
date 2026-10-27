import test from 'node:test';
import assert from 'node:assert/strict';
import { ankiText, cleanCards, cleanQuestions, prompts, listLines } from './study.js';
import { jsonFrom, textBlock, notesBlock } from './ai-context.js';
import { renderAnswer } from './chat.js';

test('Anki export escapes tabs and newlines and tags pages', () => {
  const text = ankiText('ACII::Memoria', [{ front: 'a\tb', back: 'l1\nl2', page: 7 }, { front: 'x', back: 'y' }]);
  assert.equal(text, '#separator:tab\n#html:true\n#deck:ACII::Memoria\n#tags column:3\na    b\tl1<br>l2\tp7\nx\ty\t\n');
});

test('AI replies are parsed leniently but only well-formed items survive', () => {
  const reply = 'Here you go:\n```json\n{"cards":[{"front":"¿Qué es DRAM?","back":"Un condensador y un transistor","page":7},{"front":"","back":"x"},{"front":"q"}]}\n```';
  assert.deepEqual(cleanCards(jsonFrom(reply)), [{ front: '¿Qué es DRAM?', back: 'Un condensador y un transistor', page: 7 }]);
  const quiz = cleanQuestions({ questions: [
    { question: 'SRAM cell?', options: ['biestable', 'condensador', 'fusible', 'diodo'], answer: 0, explanation: 'Flip-flop', page: 8 },
    { question: 'bad', options: ['a'], answer: 0 },
    { question: 'bad index', options: ['a', 'b'], answer: 5 },
  ] });
  assert.equal(quiz.length, 1);
  assert.throws(() => jsonFrom('no json here'), /expected JSON/);
});

test('prompts ask for the JSON shape and respect the chosen language', () => {
  assert.match(prompts('cards', { amount: 4, language: '', title: 'Memoria 1' }), /about 4 flashcards per page[\s\S]*"cards"/);
  assert.match(prompts('quiz', { amount: 2, language: 'English', title: 'T' }), /Write in English[\s\S]*"questions"/);
  assert.match(textBlock(2, { pdf: 'DRAM', ocr: 'condensador' }), /Page 3[\s\S]*PDF text:\nDRAM[\s\S]*Recognized handwriting/);
  assert.match(textBlock(0, {}), /read the image/);
});

test('chat answers render as text, never as HTML', () => {
  globalThis.document ??= {
    createDocumentFragment: () => ({ children: [], append(...n) { this.children.push(...n); } }),
    createElement: tag => ({ tag, children: [], textContent: '', append(...n) { this.children.push(...n); } }),
  };
  const fragment = renderAnswer('**Bold** and `code` <script>alert(1)</script>\n\nSecond');
  assert.equal(fragment.children.length, 2);
  const first = fragment.children[0].children;
  assert.equal(first[0].tag, 'strong');
  assert.ok(first.some(n => typeof n === 'string' && n.includes('<script>')), 'markup stays literal text');
});

test('inline numbered lists from the model are split into one item per line', () => {
  const back = '1) No fallan P1P2P3 ni P4: todo perfecto. 2) No fallan P1P2P3 y sí falla P4: error en P4 (invertir P4). 3) Fallan P1P2P3 y P4: error simple corregible dentro de H(7,4). 4) Fallan P1P2P3 pero no falla P4: error doble.';
  assert.equal(listLines(back).split('\n').length, 4);
  assert.match(listLines(back), /^1\) No fallan[^\n]*perfecto\.\n2\) No fallan/);
  assert.equal(listLines('Casos: a) lectura b) escritura'), 'Casos:\na) lectura\nb) escritura');
  for (const same of ['Hamming (8,4) y H(7,4)', 'Solo el paso 2) importa', '1) ya\n2) separado']) assert.equal(listLines(same), same);
  assert.match(prompts('cards', { amount: 1, language: '', title: 'T' }), /own line/);
});

test('A double-checked card keeps what the AI leaves out and splits list answers', async () => {
  const { cardCheckPrompt, cardVerdict } = await import('./study.js');
  const card = { front: '¿Qué guarda la DRAM?', back: 'Un bit en un biestable', page: 7 };
  const prompt = cardCheckPrompt(card, true);
  assert.match(prompt, /Question: ¿Qué guarda la DRAM\?\nAnswer: Un bit en un biestable\n/);
  assert.match(prompt, /attached image/);
  assert.doesNotMatch(cardCheckPrompt(card, false), /attached image/);
  assert.deepEqual(cardVerdict({ correct: false, back: 'Tipos: 1) SRAM 2) DRAM', reason: ' Página 7. ' }, card),
    { correct: false, front: card.front, back: 'Tipos:\n1) SRAM\n2) DRAM', reason: 'Página 7.' });
  assert.deepEqual(cardVerdict(null, card), { correct: false, front: card.front, back: card.back, reason: '' });
  assert.equal(cardVerdict({ correct: true, front: '  ', back: '' }, card).back, card.back);
});

test('Asking AI about a card carries the card, the thread and the follow-up', async () => {
  const { cardAskPrompt } = await import('./study.js');
  const card = { front: '¿Qué es la DRAM?', back: 'Memoria con condensadores', page: 3 };
  const first = cardAskPrompt(card, true);
  assert.match(first, /Question: ¿Qué es la DRAM\?\nAnswer: Memoria con condensadores/);
  assert.match(first, /attached image/);
  assert.doesNotMatch(first, /Student:/);
  const next = cardAskPrompt(card, false, [{ role: 'user', content: 'Explain this card.' }, { role: 'assistant', content: 'Guarda carga.' }], '¿Y el refresco?');
  assert.match(next, /Conversation so far:\nStudent: Explain this card\.\n\nYou: Guarda carga\./);
  assert.match(next, /Student: ¿Y el refresco\?$/);
  assert.doesNotMatch(next, /attached image/);
});

test('Markdown notes go to AI requests as one capped block', () => {
  assert.equal(notesBlock(''), '');
  assert.equal(notesBlock('   \n'), '');
  assert.match(notesBlock('# Tema 1\n[p. 3]\nLa DRAM se refresca.'), /own Markdown notes[\s\S]*La DRAM se refresca\.$/);
  const long = notesBlock('x'.repeat(25), 10);
  assert.match(long, /^[\s\S]*\nx{10}\n\[… 15 more characters not included\]$/);
});
