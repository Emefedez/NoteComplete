import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMath,
  symbolicDerivative,
  numericIntegral,
  solveEquation,
  isPlottable,
  asSimpleFraction,
  evalAst,
} from './cas.js';

test('evaluateMath handles LaTeX, implicit multiplication, trig deg/rad, and exact fractions', () => {
  const frac = evaluateMath('\\frac{1}{2} + \\frac{1}{3}');
  assert.ok(Math.abs(frac.value - 5 / 6) < 1e-12);
  assert.equal(asSimpleFraction(5 / 6)?.text, '5/6');
  assert.equal(asSimpleFraction(5 / 6)?.latex, '\\frac{5}{6}');

  const rad = evaluateMath('\\sin(\\pi / 6)', { angleUnit: 'rad' });
  assert.ok(Math.abs(rad.value - 0.5) < 1e-12);

  const deg = evaluateMath('sin(30) + cos(60)', { angleUnit: 'deg' });
  assert.ok(Math.abs(deg.value - 1) < 1e-12);

  const pow = evaluateMath('2^3 + \\sqrt{16}');
  assert.equal(pow.value, 12);
});

test('symbolicDerivative differentiates polynomials, trig, exponentials, and products', () => {
  const poly = symbolicDerivative('3x^2 + 2x - 5');
  assert.ok(poly.latex.includes('x'));
  // Evaluate derivative numerically at x=4 -> 6*4 + 2 = 26
  assert.ok(Math.abs(evalAst(poly.ast, { x: 4 }) - 26) < 1e-9);

  const trig = symbolicDerivative('sin(2x)');
  assert.ok(Math.abs(evalAst(trig.ast, { x: 0 }) - 2) < 1e-9);
});

test('numericIntegral computes definite integrals accurately via Simpson rule', () => {
  const sq = numericIntegral('x^2', 0, 3);
  assert.ok(Math.abs(sq.value - 9) < 1e-6);

  const sine = numericIntegral('sin(x)', 0, Math.PI, { angleUnit: 'rad' });
  assert.ok(Math.abs(sine.value - 2) < 1e-6);
});

test('solveEquation finds real roots of linear and quadratic equations', () => {
  const quad = solveEquation('2x^2 - 8 = 0');
  assert.equal(quad.roots.length, 2);
  assert.ok(Math.abs(quad.roots[0] + 2) < 1e-6);
  assert.ok(Math.abs(quad.roots[1] - 2) < 1e-6);

  const lin = solveEquation('3x + 6 = 0');
  assert.equal(lin.roots.length, 1);
  assert.ok(Math.abs(lin.roots[0] + 2) < 1e-6);
});

test('isPlottable distinguishes functions of x from invalid input', () => {
  assert.equal(isPlottable('x^2 - 1'), true);
  assert.equal(isPlottable('y = sin(x)'), true);
  assert.equal(isPlottable('3 + 4'), true);
  assert.equal(isPlottable('2x = 5'), false);
  assert.equal(isPlottable(''), false);
});
