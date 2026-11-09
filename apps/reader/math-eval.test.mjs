import test from 'node:test';
import assert from 'node:assert/strict';
import { compileFunction, functionSource } from './math-eval.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;
const at = (tex, x) => compileFunction(tex)(x);

test('y = … and f(x) = … give their right side; other equations are refused', () => {
  assert.equal(functionSource('y = x^2'), 'x^2');
  assert.equal(functionSource('f(x)=2x'), '2x');
  assert.equal(functionSource('$x+1$'), 'x+1');
  assert.throws(() => functionSource('x^2 + y^2 = 1'), /y = /);
});

test('arithmetic, precedence, implied products and signs', () => {
  assert.equal(at('2x+1', 3), 7);
  assert.equal(at('-x^2', 3), -9);
  assert.equal(at('x^23', 2), 12, 'x^23 is x² · 3, as LaTeX typesets it');
  assert.equal(at('x^{-1}', 4), 0.25);
  assert.equal(at('(x+1)(x-1)', 3), 8);
  assert.equal(at('3 \\cdot x \\div 2', 4), 6);
  assert.equal(at('\\frac{1}{x}', 4), 0.25);
  assert.equal(at('\\frac12x', 4), 2);
  assert.equal(at('\\left|x-5\\right|', 2), 3);
  assert.equal(at('2\\pi', 0), 2 * Math.PI);
  assert.equal(at('3!', 0), 6);
});

test('roots, powers of e, logarithms and trigonometry', () => {
  assert.equal(at('\\sqrt{x}', 9), 3);
  assert.ok(near(at('\\sqrt[3]{x}', -8), -2));
  assert.ok(near(at('e^{x}', 1), Math.E));
  assert.ok(near(at('\\ln x', Math.E), 1));
  assert.ok(near(at('\\log_2 x', 8), 3));
  assert.ok(near(at('\\log x', 1000), 3));
  assert.ok(near(at('\\sin 2x', Math.PI / 4), 1), 'sin 2x is sin(2x)');
  assert.ok(near(at('\\sin x + 1', 0), 1));
  assert.ok(near(at('\\sin^2 x + \\cos^2 x', 0.7), 1));
  assert.ok(near(at('\\sin^{-1} x', 1), Math.PI / 2));
  assert.ok(near(at('x\\sin(x)', Math.PI / 2), Math.PI / 2));
});

test('what cannot be drawn says why', () => {
  assert.throws(() => compileFunction('a x + b'), /Only x/);
  assert.throws(() => compileFunction('\\int_0^1 x\\,dx'), /graph can draw/);
  assert.throws(() => compileFunction(''), /Nothing/);
  assert.throws(() => compileFunction('(x+1'), /Missing/);
});
