import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, render, evaluate, parseBool, name, prettyBool, detectVariables } from '../render.js';

test('symbol, ASCII and word forms of every operator agree', () => {
  const vars = ['A', 'B'];
  const table = (e) => [0, 1, 2, 3].map((n) => (parseBool(e, vars)([!!(n & 2), !!(n & 1)]) ? 1 : 0)).join('');
  const same = (...forms) => forms.forEach((f) => assert.equal(table(f), table(forms[0]), f));
  same('A ∧ B', 'A & B', 'A && B', 'A · B', 'A AND B', 'A and B');
  same('A ∨ B', 'A | B', 'A || B', 'A + B', 'A OR B');
  same('¬A', '!A', '~A', 'NOT A', "A'");
  same('A → B', 'A -> B', 'A => B', 'A IMPLIES B');
  same('A ↔ B', 'A <-> B', 'A <=> B', 'A Iff B');
  same('A ⊕ B', 'A ^ B', 'A xor B');
  assert.equal(table('A && B'), '0001');
  assert.equal(table('A || B'), '0111');
});

test('the preview prints math symbols and variables are detected', () => {
  assert.equal(prettyBool('(A and not B) -> C'), '(A ∧ ¬B) → C');
  assert.equal(prettyBool('A && B || !C'), 'A ∧ B ∨ ¬C');
  assert.deepEqual(detectVariables('P and (Q or not R) implies P'), ['P', 'Q', 'R']);
  assert.throws(() => parseBool('A and Z', ['A']), /Z is not one of the variables/);
});

test('a truth table spec is made whole', () => {
  assert.deepEqual(normalize({}).variables, ['A', 'B']);
  assert.deepEqual(normalize({ variables: 'p, q;r' }).variables, ['p', 'q', 'r'], 'a typed list');
  assert.deepEqual(normalize({ variables: ['A', 'A', '1x', 'and', 'B'] }).variables, ['A', 'B'], 'distinct names, no keywords');
  assert.equal(normalize({ variables: 'a b c d e f g h' }).variables.length, 6, 'at most 6');
  assert.deepEqual(normalize({ variables: [] }).variables, ['A']);
  assert.equal(normalize({ output: 'x', notation: 'y' }).output, 'values');
  assert.equal(normalize({ notation: 'y' }).notation, '10');
  assert.equal(name({}), 'Truth table');
});

test('boolean expressions: every operator and its precedence', () => {
  const at = (expr, ...values) => parseBool(expr, ['A', 'B', 'C'])(values);
  assert.equal(at('A and B', true, false), false);
  assert.equal(at('A ∨ B', true, false), true);
  assert.equal(at("¬A + B'", false, true), true);
  assert.equal(at('A ⊕ B', true, true), false);
  assert.equal(at('A -> B', true, false), false);
  assert.equal(at('A → B', false, false), true);
  assert.equal(at('A <-> B', false, false), true);
  assert.equal(at('A or B and C', true, false, false), true, 'and binds tighter than or');
  assert.equal(at('not (A or B)', false, false), true);
  assert.equal(at('A -> B -> C', false, false, false), true, 'implies is right-associative');
  assert.equal(at('1 & !0'), true);
  assert.throws(() => parseBool('A and D', ['A']), /D is not one of the variables/);
  assert.throws(() => parseBool('(A', ['A']), /missing/);
  assert.throws(() => parseBool('A B', ['A', 'B']), /Unexpected/);
  assert.throws(() => parseBool('A $ B', ['A', 'B']), /not an operator/);
});

test('rows go from all false to all true and are drawn as a table', () => {
  const { rows, error } = evaluate({ variables: ['A', 'B'], expr: 'A xor B' });
  assert.equal(error, '');
  assert.deepEqual(rows.map((r) => [...r.values.map(Number), Number(r.out)]), [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]]);
  const { svg, width, height } = render({ title: 'x<y', variables: ['A', 'B', 'C'], expr: 'A and B', notation: 'VF' });
  assert.ok(svg.startsWith('<svg') && width > 100 && height > 8 * 26);
  assert.match(svg, /x&lt;y/, 'the title is escaped');
  assert.equal(svg.match(/fill="#1d4ed8">V</g).length, 2, 'A and B is true in 2 of 8 rows');
  assert.equal(svg.match(/fill="#1d4ed8">F</g).length, 6);
  const blank = render({ variables: ['A'], expr: 'A', output: 'blank' }).svg;
  assert.equal((blank.match(/fill="#1d4ed8"/g) || []).length, 0, 'an empty column to fill in');
  assert.match(blank, />A<\/text>/, 'its heading is the expression');
  assert.ok(render({ variables: ['A', 'B'], output: 'none' }).width < render({ variables: ['A', 'B'], expr: 'A' }).width, 'no output column');
  assert.match(render({ variables: ['A'], expr: 'A and' }).svg, />\?</, 'a broken expression draws ? and does not throw');
  assert.equal(evaluate({ variables: ['A'], expr: 'A and' }).error, 'The expression ends too soon');
});
