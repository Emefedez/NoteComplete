import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptMathToLatex,
  adaptMath,
  MATH_ADAPT_CHEATSHEET,
} from './math-adapt.js';

test('prefix-over diacritics and named diacritic helpers', () => {
  assert.equal(adaptMathToLatex('-^5'), '\\bar{5}');
  assert.equal(adaptMathToLatex('-^x'), '\\bar{x}');
  assert.equal(adaptMathToLatex('-^X'), '\\bar{X}');
  assert.equal(adaptMathToLatex('-^(x+y)'), '\\overline{x+y}');

  assert.equal(adaptMathToLatex('contraryOf(x)'), '\\bar{x}');
  assert.equal(adaptMathToLatex('contraryof(A)'), '\\bar{A}');
  assert.equal(adaptMathToLatex('contraryOf(A + B)'), '\\overline{A + B}');

  assert.equal(adaptMathToLatex('~^X'), '\\tilde{X}');
  assert.equal(adaptMathToLatex('~^u'), '\\tilde{u}');
  assert.equal(adaptMathToLatex('~^(X+Y)'), '\\widetilde{X+Y}');

  assert.equal(adaptMathToLatex('~^='), '\\approx');
  assert.equal(adaptMathToLatex('x ~= 0.82'), 'x \\approx 0.82');

  assert.equal(adaptMathToLatex('^^theta'), '\\hat{\\theta}');
  assert.equal(adaptMathToLatex('^^p'), '\\hat{p}');
  assert.equal(adaptMathToLatex('hat(theta)'), '\\hat{\\theta}');
  assert.equal(adaptMathToLatex('hat(p)'), '\\hat{p}');

  assert.equal(adaptMathToLatex('->^v'), '\\vec{v}');
  assert.equal(adaptMathToLatex('vec(v)'), '\\vec{v}');
  assert.equal(adaptMathToLatex('->^(AB)'), '\\overrightarrow{AB}');
});

test('Omarchy Unicode quirk repair and exponents', () => {
  assert.equal(adaptMathToLatex('0.82⁵'), '0.82^{5}');
  assert.equal(adaptMathToLatex('(1-0.82)⁽8-5⁾'), '(1-0.82)^{8-5}');
  assert.equal(adaptMathToLatex('10⁻²'), '10^{-2}');
  assert.equal(adaptMathToLatex('e⁻^(lambda*15)'), 'e^{-\\lambda \\cdot 15}');
  assert.equal(adaptMathToLatex('e⁻(0.1535*15)'), 'e^{-0.1535 \\cdot 15}');
  assert.equal(adaptMathToLatex('e⁽-lambda*15)'), 'e^{-\\lambda \\cdot 15}');
  assert.equal(adaptMathToLatex('x² + y³'), 'x^{2} + y^{3}');
  assert.equal(adaptMathToLatex('x₀ + x₁'), 'x_{0} + x_{1}');

  // Parenthesized & simple ASCII exponents
  assert.equal(adaptMathToLatex('5^(-5)'), '5^{-5}');
  assert.equal(adaptMathToLatex('x^(n-1)'), 'x^{n-1}');
  assert.equal(adaptMathToLatex('(1-p)^(n-k)'), '(1-p)^{n-k}');
  assert.equal(adaptMathToLatex('x^2'), 'x^{2}');
  assert.equal(adaptMathToLatex('10^-2'), '10^{-2}');
});

test('subscripts including indexed C_(5,6), quantiles, and IC', () => {
  assert.equal(adaptMathToLatex('N_i'), 'N_{i}');
  assert.equal(adaptMathToLatex('x_0.75'), 'x_{0.75}');
  assert.equal(adaptMathToLatex('Z_0.99'), 'Z_{0.99}');
  assert.equal(adaptMathToLatex('C_(5,6)'), 'C_{5,6}');
  assert.equal(adaptMathToLatex('t_(n-1; alpha/2)'), 't_{n-1;\\,\\alpha/2}');
  assert.equal(adaptMathToLatex('H_0'), 'H_{0}');
  assert.equal(adaptMathToLatex('IC_(1-alpha)'), '\\text{IC}_{1-\\alpha}');
});

test('combinations with sobre and over', () => {
  assert.equal(adaptMathToLatex('(8 sobre 5)'), '\\binom{8}{5}');
  assert.equal(adaptMathToLatex('(8 over 5)'), '\\binom{8}{5}');
  assert.equal(adaptMathToLatex('C(5 sobre 8)'), '\\binom{5}{8}');
  assert.equal(adaptMathToLatex('C(5 over 8)'), '\\binom{5}{8}');
  assert.equal(adaptMathToLatex('(n-1 sobre k+1)'), '\\binom{n-1}{k+1}');
  // Must NOT turn C_(5,6) into \binom
  assert.equal(adaptMathToLatex('C_(5,6)'), 'C_{5,6}');
});

test('calculus and big operators: sqrt, intr/int, lim, sum, prod, inf', () => {
  assert.equal(adaptMathToLatex('sqrt(x)'), '\\sqrt{x}');
  assert.equal(adaptMathToLatex('sqrt[n](x)'), '\\sqrt[n]{x}');
  assert.equal(adaptMathToLatex('sqrt(x^2 + 1)'), '\\sqrt{x^{2} + 1}');

  assert.equal(adaptMathToLatex('intr(f(x))'), '\\int f(x)\\,dx');
  assert.equal(adaptMathToLatex('intr(a, b, f(x))'), '\\int_{a}^{b} f(x)\\,dx');
  assert.equal(adaptMathToLatex('intr(a, b, f(x), t)'), '\\int_{a}^{b} f(x)\\,dt');
  assert.equal(adaptMathToLatex('int(0, inf, e^(-lambda*x))'), '\\int_{0}^{\\infty} e^{-\\lambda \\cdot x}\\,dx');
  assert.equal(adaptMathToLatex('int(-inf, inf, f(x))'), '\\int_{-\\infty}^{\\infty} f(x)\\,dx');

  assert.equal(adaptMathToLatex('lim(x->inf)'), '\\lim_{x \\to \\infty}');
  assert.equal(adaptMathToLatex('lim(x)'), '\\lim_{x \\to \\infty}');
  assert.equal(adaptMathToLatex('lim(x->8)'), '\\lim_{x \\to 8}');
  assert.equal(adaptMathToLatex('lim(n->inf)'), '\\lim_{n \\to \\infty}');

  assert.equal(adaptMathToLatex('sum(i=1, n)'), '\\sum_{i=1}^{n}');
  assert.equal(adaptMathToLatex('sum(i=1..n)'), '\\sum_{i=1}^{n}');
  assert.equal(adaptMathToLatex('sum()'), '\\sum');
  assert.equal(adaptMathToLatex('prod(i=1, n)'), '\\prod_{i=1}^{n}');
  assert.equal(adaptMathToLatex('prod(i=1..n)'), '\\prod_{i=1}^{n}');

  assert.equal(adaptMathToLatex('inf'), '\\infty');
  assert.equal(adaptMathToLatex('-inf'), '-\\infty');
});

test('statistics / EST operators, conditional probability, and distributions', () => {
  assert.equal(adaptMathToLatex('desv(X)'), '\\operatorname{desv}(X)');
  assert.equal(adaptMathToLatex('desv[X]'), '\\operatorname{desv}[X]');
  assert.equal(adaptMathToLatex('sd(X)'), '\\operatorname{sd}(X)');
  assert.equal(adaptMathToLatex('std(X)'), '\\operatorname{std}(X)');
  assert.equal(adaptMathToLatex('var(X)'), '\\operatorname{Var}(X)');
  assert.equal(adaptMathToLatex('Var(X)'), '\\operatorname{Var}(X)');
  assert.equal(adaptMathToLatex('Var[X]'), '\\operatorname{Var}[X]');
  assert.equal(adaptMathToLatex('cov(X,Y)'), '\\operatorname{Cov}(X,Y)');
  assert.equal(adaptMathToLatex('Cov(X,Y)'), '\\operatorname{Cov}(X,Y)');
  assert.equal(adaptMathToLatex('corr(X,Y)'), '\\operatorname{corr}(X,Y)');
  assert.equal(adaptMathToLatex('ECM(theta)'), '\\operatorname{ECM}(\\theta)');
  assert.equal(adaptMathToLatex('MSE(theta)'), '\\operatorname{MSE}(\\theta)');
  assert.equal(adaptMathToLatex('mediana(X)'), '\\operatorname{mediana}(X)');
  assert.equal(adaptMathToLatex('median(X)'), '\\operatorname{median}(X)');
  assert.equal(adaptMathToLatex('moda(X)'), '\\operatorname{moda}(X)');
  assert.equal(adaptMathToLatex('mode(X)'), '\\operatorname{mode}(X)');
  assert.equal(adaptMathToLatex('E[X]'), 'E[X]');
  assert.equal(adaptMathToLatex('esp(X)'), 'E[X]');

  assert.equal(adaptMathToLatex('P(X>8 / X>5)'), 'P(X > 8 \\mid X > 5)');
  assert.equal(adaptMathToLatex('P(A / B)'), 'P(A \\mid B)');
  // Numeric fraction inside P(...) must stay a fraction, not \mid
  assert.equal(adaptMathToLatex('P(X = 1/2)'), 'P(X = 1/2)');

  assert.equal(adaptMathToLatex('X ~ N(0,1)'), 'X \\sim N(0,1)');
  assert.equal(adaptMathToLatex('Y ~ Bin(8, 0.82)'), 'Y \\sim Bin(8, 0.82)');
  assert.equal(adaptMathToLatex('X ~ Exp(lambda)'), 'X \\sim Exp(\\lambda)');
});

test('annotated equals and arrows (parenthesized, unparenthesized, and Omarchy ≤)', () => {
  assert.equal(adaptMathToLatex('=(como y=7)='), '\\overset{\\text{como } y=7}{=}');
  assert.equal(adaptMathToLatex('=como y=7='), '\\overset{\\text{como } y=7}{=}');
  assert.equal(
    adaptMathToLatex('x + y =(como y=7)= x + 7'),
    'x + y \\overset{\\text{como } y=7}{=} x + 7',
  );

  assert.equal(
    adaptMathToLatex('=(propiedad noseque)=>'),
    '\\overset{\\text{propiedad noseque}}{\\Rightarrow}',
  );
  assert.equal(
    adaptMathToLatex('=propiedad noseque=>'),
    '\\overset{\\text{propiedad noseque}}{\\Rightarrow}',
  );

  assert.equal(
    adaptMathToLatex('<=(debido a noseque)=>'),
    '\\overset{\\text{debido a noseque}}{\\iff}',
  );
  assert.equal(
    adaptMathToLatex('<=debido a noseque=>'),
    '\\overset{\\text{debido a noseque}}{\\iff}',
  );
  assert.equal(
    adaptMathToLatex('<=y = sqrt(n))=>'),
    '\\overset{y = \\sqrt{n}}{\\iff}',
  );
  assert.equal(
    adaptMathToLatex('≤debido a noseque=>'),
    '\\overset{\\text{debido a noseque}}{\\iff}',
  );

  assert.equal(
    adaptMathToLatex('-(por def)->'),
    '\\overset{\\text{por def}}{\\longrightarrow}',
  );
  assert.equal(
    adaptMathToLatex('->(por def)->'),
    '\\overset{\\text{por def}}{\\longrightarrow}',
  );

  // Regular inequalities/arrows must NOT be misparsed as annotations
  assert.equal(adaptMathToLatex('x <= 5 => y >= 3'), 'x \\le 5 \\Rightarrow y \\ge 3');
  assert.equal(adaptMathToLatex('a = b = c'), 'a = b = c');
});

test('relations, Greek letters with strict word boundaries, operators, and fractions', () => {
  assert.equal(adaptMathToLatex('a +- b'), 'a \\pm b');
  assert.equal(adaptMathToLatex('a <= b >= c != d'), 'a \\le b \\ge c \\neq d');
  assert.equal(adaptMathToLatex('a ≤ b ≥ c ≠ d'), 'a \\le b \\ge c \\neq d');
  assert.equal(adaptMathToLatex('A <=> B => C -> D <- E'), 'A \\iff B \\Rightarrow C \\to D \\leftarrow E');
  assert.equal(adaptMathToLatex('2*x + 3*y'), '2 \\cdot x + 3 \\cdot y');

  // All Greek letters
  assert.equal(
    adaptMathToLatex('alpha beta gamma delta epsilon theta lambda mu pi rho sigma tau phi chi omega Sigma Omega Delta'),
    '\\alpha \\beta \\gamma \\delta \\epsilon \\theta \\lambda \\mu \\pi \\rho \\sigma \\tau \\phi \\chi \\omega \\Sigma \\Omega \\Delta',
  );

  // Strict word boundaries: Spanish/English words must NOT be corrupted
  assert.equal(adaptMathToLatex('\\text{información pilas tema}'), '\\text{información pilas tema}');
  assert.equal(adaptMathToLatex('información pilas tema'), 'información pilas tema');

  // Parenthesized fractions
  assert.equal(adaptMathToLatex('(a + b) / (c + d)'), '\\frac{a + b}{c + d}');
  assert.equal(adaptMathToLatex('(x - mu) / (sigma / sqrt(n))'), '\\frac{x - \\mu}{\\sigma / \\sqrt{n}}');
});

test('real EST boletin2.r and info.md snippets', () => {
  // Binomial with Omarchy superscripts
  assert.equal(
    adaptMathToLatex('P(X = 5) = (8 sobre 5) * 0.82⁵ * (1-0.82)⁽8-5⁾'),
    'P(X = 5) = \\binom{8}{5} \\cdot 0.82^{5} \\cdot (1-0.82)^{8-5}',
  );

  // Exponential memoryless property with Omarchy quirks & conditional probability
  assert.equal(
    adaptMathToLatex('P(X>8 / X>5) = e⁻^(lambda*15) = e⁻(0.1535*15)'),
    'P(X > 8 \\mid X > 5) = e^{-\\lambda \\cdot 15} = e^{-0.1535 \\cdot 15}',
  );

  // Confidence interval for mean
  assert.equal(
    adaptMathToLatex('IC_(1-alpha) = -^X +- t_(n-1; alpha/2) * (S) / (sqrt(n))'),
    '\\text{IC}_{1-\\alpha} = \\bar{X} \\pm t_{n-1;\\,\\alpha/2} \\cdot \\frac{S}{\\sqrt{n}}',
  );

  // MSE decomposition
  assert.equal(
    adaptMathToLatex('ECM(^^theta) = var(^^theta) + (E[^^theta] - theta)^2'),
    '\\operatorname{ECM}(\\hat{\\theta}) = \\operatorname{Var}(\\hat{\\theta}) + (E[\\hat{\\theta}] - \\theta)^{2}',
  );

  // Sum / sample variance
  assert.equal(
    adaptMathToLatex('S^2 = (1) / (n-1) * sum(i=1, n) (X_i - -^X)^2'),
    'S^{2} = \\frac{1}{n-1} \\cdot \\sum_{i=1}^{n} (X_{i} - \\bar{X})^{2}',
  );
});

test('adaptMath wrapping modes and delimiter unwrapping', () => {
  assert.equal(adaptMath('x^2', { wrap: 'none' }), 'x^{2}');
  assert.equal(adaptMath('x^2', { wrap: 'inline' }), '$x^{2}$');
  assert.equal(adaptMath('x^2', { wrap: 'block' }), '$$x^{2}$$');
  assert.equal(adaptMath('x^2'), '$x^{2}$');

  // Multiline auto -> block with \begin{aligned}
  assert.equal(
    adaptMath('X ~ Bin(8, 0.82)\nP(X = 5) = (8 sobre 5) * 0.82⁵'),
    '$$\n\\begin{aligned}\nX \\sim Bin(8, 0.82) \\\\\nP(X = 5) = \\binom{8}{5} \\cdot 0.82^{5}\n\\end{aligned}\n$$',
  );

  // Already wrapped in $...$ or $$...$$ -> unwrap, adapt, re-wrap cleanly
  assert.equal(adaptMath('$-^X +- Z_0.99$'), '$\\bar{X} \\pm Z_{0.99}$');
  assert.equal(adaptMath('$$-^X +- Z_0.99$$'), '$$\\bar{X} \\pm Z_{0.99}$$');
  assert.equal(adaptMath('$$-^X$$', { wrap: 'inline' }), '$\\bar{X}$');
  assert.equal(adaptMath('$-^X$', { wrap: 'block' }), '$$\\bar{X}$$');
  assert.equal(adaptMath('$$-^X$$', { wrap: 'none' }), '\\bar{X}');

  // Empty input
  assert.equal(adaptMath(''), '');
  assert.equal(adaptMath('   '), '');
});

test('MATH_ADAPT_CHEATSHEET is well-formed and every example matches adaptMathToLatex', () => {
  assert.ok(Array.isArray(MATH_ADAPT_CHEATSHEET));
  assert.ok(MATH_ADAPT_CHEATSHEET.length >= 6);
  for (const group of MATH_ADAPT_CHEATSHEET) {
    assert.equal(typeof group.titleEn, 'string');
    assert.equal(typeof group.titleEs, 'string');
    assert.ok(Array.isArray(group.items) && group.items.length > 0);
    for (const item of group.items) {
      assert.equal(typeof item.notation, 'string');
      assert.equal(typeof item.example, 'string');
      assert.equal(typeof item.latex, 'string');
      assert.equal(typeof item.en, 'string');
      assert.equal(typeof item.es, 'string');
      assert.ok(Array.isArray(item.tags) && item.tags.length > 0);
      assert.equal(
        adaptMathToLatex(item.example),
        item.latex,
        `Cheatsheet example "${item.example}" mismatch`,
      );
    }
  }
});
