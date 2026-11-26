// Pure, CSP-safe symbolic & numeric math engine for NoteComplete Math Mode (no eval/Function).
// Parses LaTeX or plain expressions into an AST supporting numeric evaluation, exact symbolic
// differentiation, algebraic simplification, adaptive Simpson definite integration, and root solving.

import { normalizeUnicodeMath } from './unicode-math.js';

const TRIG_FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc']);
const INV_TRIG_FUNCS = new Set(['asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan']);
const ALL_FUNCS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh',
  'ln', 'log', 'log10', 'log2', 'exp', 'sqrt', 'cbrt', 'abs', 'floor', 'ceil', 'round',
  'binom', 'nCr', 'nPr',
]);

function factorial(n) {
  if (!Number.isFinite(n) || n < 0 || n > 170 || Math.abs(n - Math.round(n)) > 1e-9) return NaN;
  let r = 1;
  for (let i = 2; i <= Math.round(n); i++) r *= i;
  return r;
}

function binom(n, k) {
  if (!Number.isFinite(n) || !Number.isFinite(k)) return NaN;
  const ni = Math.round(n), ki = Math.round(k);
  if (Math.abs(n - ni) > 1e-9 || Math.abs(k - ki) > 1e-9 || ki < 0 || ki > ni || ni > 170) return NaN;
  const m = Math.min(ki, ni - ki);
  let r = 1;
  for (let i = 1; i <= m; i++) r = (r * (ni - m + i)) / i;
  return Math.round(r);
}

// Convert common LaTeX constructs into a clean expression token stream.
function preprocessLatex(raw) {
  let s = normalizeUnicodeMath(raw)
    .replace(/^\s*\$+|\$+\s*$/g, '')
    .replace(/\\(left|right|displaystyle|textstyle|bigl?|bigr?|Bigl?|Bigr?)\b/g, '')
    .replace(/\\[,;:! ]|~/g, ' ')
    .replace(/\\operatorname\{([A-Za-z]+)\}/g, '\\$1')
    .replace(/\\[dt]frac\b/g, '\\frac')
    .replace(/\\cdot\b|\\times\b/g, '*')
    .replace(/\\div\b/g, '/')
    .replace(/\*\*/g, '^')
    .trim();
  return s;
}

function tokenize(raw) {
  const s = preprocessLatex(raw);
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (numMatch) {
      tokens.push({ t: 'num', v: Number(numMatch[0]) });
      i += numMatch[0].length;
      continue;
    }
    if (c === '\\') {
      const cmdMatch = /^[a-zA-Z]+/.exec(s.slice(i + 1));
      if (!cmdMatch) { i += 2; continue; }
      tokens.push({ t: 'cmd', v: cmdMatch[0] });
      i += 1 + cmdMatch[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      // Recognize multi-letter function names like sin, cos, sqrt, ln, log, exp, abs, pi, binom
      const wordMatch = /^[a-zA-Z][a-zA-Z0-9]*/.exec(s.slice(i));
      const word = wordMatch[0];
      if (ALL_FUNCS.has(word) || word === 'pi' || word === 'tau') {
        tokens.push({ t: word === 'pi' || word === 'tau' ? 'const' : 'func', v: word });
        i += word.length;
      } else {
        // Single-letter variables so `2xy` parses as `2 * x * y`; an index stays on its
        // letter, so x_1 (or x₁) and x_{12} are variables of their own.
        const index = /^_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9])/.exec(s.slice(i + 1));
        const name = index ? `${c}_{${index[0].replace(/^_\{?|\}$/g, '')}}` : c;
        tokens.push({ t: 'var', v: name });
        i += 1 + (index ? index[0].length : 0);
      }
      continue;
    }
    if ('+-*/^_()[]{},|!'.includes(c)) {
      tokens.push({ t: c, v: c });
      i++;
      continue;
    }
    throw new Error(`Unsupported symbol “${c}”`);
  }
  return tokens;
}

export function parseAst(raw) {
  const tokens = tokenize(raw);
  if (!tokens.length) throw new Error('Enter a math expression.');
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const expect = (t) => {
    if (peek()?.t !== t) throw new Error(`Expected “${t}”.`);
    next();
  };

  const startsAtom = (tok) =>
    tok && (
      tok.t === 'num' || tok.t === 'var' || tok.t === 'const' ||
      tok.t === 'func' || tok.t === 'cmd' || tok.t === '(' || tok.t === '{'
    );

  function parseSum() {
    let left = parseProduct();
    while (peek()?.t === '+' || peek()?.t === '-') {
      const op = next().t;
      const right = parseProduct();
      left = { type: 'bin', op, left, right };
    }
    return left;
  }

  function parseProduct() {
    let left = parseUnary();
    for (;;) {
      const tok = peek();
      if (tok?.t === '*' || tok?.t === '/') {
        next();
        left = { type: 'bin', op: tok.t, left, right: parseUnary() };
      } else if (startsAtom(tok)) {
        left = { type: 'bin', op: '*', left, right: parsePower() };
      } else {
        return left;
      }
    }
  }

  function parseUnary() {
    if (peek()?.t === '-') { next(); return { type: 'neg', arg: parseUnary() }; }
    if (peek()?.t === '+') { next(); return parseUnary(); }
    return parsePower();
  }

  function parseGroup() {
    if (peek()?.t === '{') {
      next();
      const e = parseSum();
      expect('}');
      return e;
    }
    return parseAtom();
  }

  function parsePower() {
    let base = parseAtom();
    while (peek()?.t === '!') {
      next();
      base = { type: 'fact', arg: base };
    }
    if (peek()?.t === '^') {
      next();
      const exp = peek()?.t === '-' ? (next(), { type: 'neg', arg: parseGroup() }) : parseGroup();
      return { type: 'bin', op: '^', left: base, right: exp };
    }
    return base;
  }

  function parseFuncArg() {
    if (peek()?.t === '(' || peek()?.t === '{') {
      const open = next().t;
      const close = open === '(' ? ')' : '}';
      const args = [parseSum()];
      while (peek()?.t === ',') { next(); args.push(parseSum()); }
      expect(close);
      return args;
    }
    return [parsePower()];
  }

  // log_b(x), log₂ x, \log_{10} x: the change of base ln x / ln b.
  function parseLogBase() {
    next();
    const base = parseGroup();
    const [arg] = parseFuncArg();
    return { type: 'bin', op: '/', left: { type: 'call', name: 'ln', args: [arg] }, right: { type: 'call', name: 'ln', args: [base] } };
  }

  function parseAtom() {
    const tok = next();
    if (!tok) throw new Error('Expression ended unexpectedly.');
    if (tok.t === 'num') return { type: 'num', value: tok.v };
    if (tok.t === 'const') return { type: 'const', name: tok.v };
    if (tok.t === 'var') {
      if (tok.v === 'e') return { type: 'const', name: 'e' };
      return { type: 'var', name: tok.v };
    }
    if (tok.t === '(' || tok.t === '[' || tok.t === '{') {
      const close = tok.t === '(' ? ')' : tok.t === '[' ? ']' : '}';
      const e = parseSum();
      expect(close);
      return e;
    }
    if (tok.t === '|') {
      const e = parseSum();
      expect('|');
      return { type: 'call', name: 'abs', args: [e] };
    }
    if (tok.t === 'func') {
      if (tok.v === 'log' && peek()?.t === '_') return parseLogBase();
      const args = parseFuncArg();
      return { type: 'call', name: tok.v, args };
    }
    if (tok.t === 'cmd') {
      if (tok.v === 'pi') return { type: 'const', name: 'pi' };
      if (tok.v === 'frac') {
        const a = parseGroup(), b = parseGroup();
        return { type: 'bin', op: '/', left: a, right: b };
      }
      if (tok.v === 'binom') {
        const n = parseGroup(), k = parseGroup();
        return { type: 'call', name: 'binom', args: [n, k] };
      }
      if (tok.v === 'sqrt') {
        let index = null;
        if (peek()?.t === '[') { next(); index = parseSum(); expect(']'); }
        const body = parseGroup();
        if (index) return { type: 'bin', op: '^', left: body, right: { type: 'bin', op: '/', left: { type: 'num', value: 1 }, right: index } };
        return { type: 'call', name: 'sqrt', args: [body] };
      }
      if (ALL_FUNCS.has(tok.v)) {
        // Optional subscript on \log_b(x)
        if (tok.v === 'log' && peek()?.t === '_') return parseLogBase();
        return { type: 'call', name: tok.v, args: parseFuncArg() };
      }
      throw new Error(`Unsupported command “\\${tok.v}”.`);
    }
    throw new Error(`Unexpected token “${tok.v}”.`);
  }

  const ast = parseSum();
  if (at < tokens.length) throw new Error(`Unexpected “${tokens[at].v}”.`);
  return ast;
}

export function evalAst(node, vars = {}, { angleUnit = 'rad' } = {}) {
  const toRad = angleUnit === 'deg' ? Math.PI / 180 : 1;
  const fromRad = angleUnit === 'deg' ? 180 / Math.PI : 1;
  switch (node.type) {
    case 'num': return node.value;
    case 'const': return node.name === 'pi' ? Math.PI : node.name === 'tau' ? Math.PI * 2 : Math.E;
    case 'var': {
      if (Object.prototype.hasOwnProperty.call(vars, node.name)) return Number(vars[node.name]);
      return NaN;
    }
    case 'neg': return -evalAst(node.arg, vars, { angleUnit });
    case 'fact': return factorial(evalAst(node.arg, vars, { angleUnit }));
    case 'bin': {
      const a = evalAst(node.left, vars, { angleUnit });
      const b = evalAst(node.right, vars, { angleUnit });
      if (node.op === '+') return a + b;
      if (node.op === '-') return a - b;
      if (node.op === '*') return a * b;
      if (node.op === '/') return a / b;
      if (node.op === '^') return Math.pow(a, b);
      return NaN;
    }
    case 'call': {
      const vals = node.args.map((a) => evalAst(a, vars, { angleUnit }));
      const x = vals[0];
      switch (node.name) {
        case 'sin': return Math.sin(x * toRad);
        case 'cos': return Math.cos(x * toRad);
        case 'tan': return Math.tan(x * toRad);
        case 'cot': return 1 / Math.tan(x * toRad);
        case 'sec': return 1 / Math.cos(x * toRad);
        case 'csc': return 1 / Math.sin(x * toRad);
        case 'asin': case 'arcsin': return Math.asin(x) * fromRad;
        case 'acos': case 'arccos': return Math.acos(x) * fromRad;
        case 'atan': case 'arctan': return Math.atan(x) * fromRad;
        case 'sinh': return Math.sinh(x);
        case 'cosh': return Math.cosh(x);
        case 'tanh': return Math.tanh(x);
        case 'ln': return Math.log(x);
        case 'log': return vals.length > 1 ? Math.log(x) / Math.log(vals[1]) : Math.log10(x);
        case 'log10': return Math.log10(x);
        case 'log2': return Math.log2(x);
        case 'exp': return Math.exp(x);
        case 'sqrt': return Math.sqrt(x);
        case 'cbrt': return Math.cbrt(x);
        case 'abs': return Math.abs(x);
        case 'floor': return Math.floor(x);
        case 'ceil': return Math.ceil(x);
        case 'round': return Math.round(x);
        case 'binom': case 'nCr': return binom(vals[0], vals[1]);
        case 'nPr': return binom(vals[0], vals[1]) * factorial(vals[1]);
        default: return NaN;
      }
    }
    default: return NaN;
  }
}

export function collectVars(node, out = new Set()) {
  if (!node) return out;
  if (node.type === 'var') out.add(node.name);
  else if (node.type === 'neg' || node.type === 'fact') collectVars(node.arg, out);
  else if (node.type === 'bin') { collectVars(node.left, out); collectVars(node.right, out); }
  else if (node.type === 'call') for (const a of node.args) collectVars(a, out);
  return out;
}

const N = (value) => ({ type: 'num', value });
const bin = (op, left, right) => ({ type: 'bin', op, left, right });
const neg = (arg) => ({ type: 'neg', arg });
const call = (name, args) => ({ type: 'call', name, args });

function isNum(n, v = null) {
  return n?.type === 'num' && (v === null || Math.abs(n.value - v) < 1e-12);
}

export function simplifyAst(node) {
  if (!node) return node;
  if (node.type === 'neg') {
    const a = simplifyAst(node.arg);
    if (isNum(a)) return N(-a.value);
    if (a.type === 'neg') return a.arg;
    return neg(a);
  }
  if (node.type === 'fact') {
    const a = simplifyAst(node.arg);
    if (isNum(a)) { const f = factorial(a.value); if (Number.isFinite(f)) return N(f); }
    return { type: 'fact', arg: a };
  }
  if (node.type === 'call') {
    return call(node.name, node.args.map(simplifyAst));
  }
  if (node.type !== 'bin') return node;
  const l = simplifyAst(node.left);
  const r = simplifyAst(node.right);
  if (isNum(l) && isNum(r)) {
    const v = evalAst(bin(node.op, l, r));
    if (Number.isFinite(v) && (node.op !== '/' || Number.isInteger(v))) return N(v);
  }
  switch (node.op) {
    case '+':
      if (isNum(l, 0)) return r;
      if (isNum(r, 0)) return l;
      if (r.type === 'neg') return simplifyAst(bin('-', l, r.arg));
      return bin('+', l, r);
    case '-':
      if (isNum(r, 0)) return l;
      if (isNum(l, 0)) return simplifyAst(neg(r));
      if (r.type === 'neg') return simplifyAst(bin('+', l, r.arg));
      return bin('-', l, r);
    case '*':
      if (isNum(l, 0) || isNum(r, 0)) return N(0);
      if (isNum(l, 1)) return r;
      if (isNum(r, 1)) return l;
      if (isNum(l, -1)) return simplifyAst(neg(r));
      if (isNum(r, -1)) return simplifyAst(neg(l));
      // Combine numeric coefficients: (a * (b * x)) -> (a*b) * x
      if (isNum(l) && r.type === 'bin' && r.op === '*' && isNum(r.left)) {
        return simplifyAst(bin('*', N(l.value * r.left.value), r.right));
      }
      if (isNum(r) && !isNum(l)) return simplifyAst(bin('*', r, l));
      return bin('*', l, r);
    case '/':
      if (isNum(l, 0)) return N(0);
      if (isNum(r, 1)) return l;
      return bin('/', l, r);
    case '^':
      if (isNum(r, 0)) return N(1);
      if (isNum(r, 1)) return l;
      if (isNum(l, 0)) return N(0);
      if (isNum(l, 1)) return N(1);
      return bin('^', l, r);
    default:
      return bin(node.op, l, r);
  }
}

export function diffAst(node, v = 'x') {
  switch (node.type) {
    case 'num':
    case 'const':
      return N(0);
    case 'var':
      return N(node.name === v ? 1 : 0);
    case 'neg':
      return neg(diffAst(node.arg, v));
    case 'bin': {
      const f = node.left, g = node.right;
      const df = diffAst(f, v), dg = diffAst(g, v);
      switch (node.op) {
        case '+': return bin('+', df, dg);
        case '-': return bin('-', df, dg);
        case '*': return bin('+', bin('*', df, g), bin('*', f, dg));
        case '/': return bin('/', bin('-', bin('*', df, g), bin('*', f, dg)), bin('^', g, N(2)));
        case '^': {
          const gHasV = collectVars(g).has(v);
          const fHasV = collectVars(f).has(v);
          if (!gHasV) {
            return bin('*', bin('*', g, bin('^', f, bin('-', g, N(1)))), df);
          }
          if (!fHasV) {
            const lnF = f.type === 'const' && f.name === 'e' ? N(1) : call('ln', [f]);
            return bin('*', bin('*', bin('^', f, g), lnF), dg);
          }
          // General f(x)^g(x)
          return bin('*', bin('^', f, g), bin('+', bin('*', dg, call('ln', [f])), bin('*', g, bin('/', df, f))));
        }
        default: throw new Error(`Cannot differentiate operator ${node.op}.`);
      }
    }
    case 'call': {
      const u = node.args[0];
      const du = diffAst(u, v);
      switch (node.name) {
        case 'sin': return bin('*', call('cos', [u]), du);
        case 'cos': return bin('*', neg(call('sin', [u])), du);
        case 'tan': return bin('/', du, bin('^', call('cos', [u]), N(2)));
        case 'exp': return bin('*', call('exp', [u]), du);
        case 'ln': return bin('/', du, u);
        case 'log':
        case 'log10': return bin('/', du, bin('*', u, call('ln', [N(10)])));
        case 'sqrt': return bin('/', du, bin('*', N(2), call('sqrt', [u])));
        case 'asin': case 'arcsin': return bin('/', du, call('sqrt', [bin('-', N(1), bin('^', u, N(2)))]));
        case 'acos': case 'arccos': return neg(bin('/', du, call('sqrt', [bin('-', N(1), bin('^', u, N(2)))])));
        case 'atan': case 'arctan': return bin('/', du, bin('+', N(1), bin('^', u, N(2))));
        case 'sinh': return bin('*', call('cosh', [u]), du);
        case 'cosh': return bin('*', call('sinh', [u]), du);
        default: throw new Error(`Symbolic derivative not supported for ${node.name}.`);
      }
    }
    default:
      throw new Error('Cannot differentiate this expression.');
  }
}

function prec(node) {
  if (!node) return 99;
  if (node.type === 'bin') {
    if (node.op === '+' || node.op === '-') return 1;
    if (node.op === '*' || node.op === '/') return 2;
    if (node.op === '^') return 4;
  }
  if (node.type === 'neg') return 3;
  return 5;
}

export function astToLatex(node, parentPrec = 0) {
  if (!node) return '';
  const wrap = (s, myPrec) => (myPrec < parentPrec ? `\\left(${s}\\right)` : s);
  switch (node.type) {
    case 'num': return String(Math.round(node.value * 1e10) / 1e10);
    case 'const': return node.name === 'pi' ? '\\pi' : node.name === 'tau' ? '2\\pi' : 'e';
    case 'var': return node.name;
    case 'neg': return wrap(`-${astToLatex(node.arg, 3)}`, 3);
    case 'fact': return `${astToLatex(node.arg, 5)}!`;
    case 'bin': {
      if (node.op === '/') return `\\frac{${astToLatex(node.left, 0)}}{${astToLatex(node.right, 0)}}`;
      if (node.op === '^') {
        const base = astToLatex(node.left, 5);
        const exp = astToLatex(node.right, 0);
        return wrap(`${base}^{${exp}}`, 4);
      }
      if (node.op === '*') {
        const l = astToLatex(node.left, 2);
        const r = astToLatex(node.right, 2);
        const implicit = isNum(node.left) && (node.right.type === 'var' || node.right.type === 'const' || node.right.type === 'call' || (node.right.type === 'bin' && node.right.op === '^' && node.right.left.type === 'var'));
        return wrap(implicit ? `${l}${r}` : `${l} \\cdot ${r}`, 2);
      }
      const p = prec(node);
      const l = astToLatex(node.left, p);
      const r = astToLatex(node.right, node.op === '-' ? p + 1 : p);
      return wrap(`${l} ${node.op} ${r}`, p);
    }
    case 'call': {
      if (node.name === 'sqrt') return `\\sqrt{${astToLatex(node.args[0], 0)}}`;
      if (node.name === 'abs') return `\\left|${astToLatex(node.args[0], 0)}\\right|`;
      if (node.name === 'binom' || node.name === 'nCr') return `\\binom{${astToLatex(node.args[0], 0)}}{${astToLatex(node.args[1], 0)}}`;
      if (node.name === 'exp') return `e^{${astToLatex(node.args[0], 0)}}`;
      const cmd = ALL_FUNCS.has(node.name) ? `\\${node.name}` : `\\operatorname{${node.name}}`;
      return `${cmd}\\left(${node.args.map((a) => astToLatex(a, 0)).join(', ')}\\right)`;
    }
    default: return '';
  }
}

export function formatNumber(value, precision = 6) {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) < 1e-12) return '0';
  const rounded = Number(value.toPrecision(Math.max(1, Math.min(12, precision))));
  return String(rounded);
}

// Simple continued-fraction rational approximation when close to a small fraction.
export function asSimpleFraction(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e6 || Math.abs(value - Math.round(value)) < 1e-9) return null;
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  for (let d = 2; d <= 64; d++) {
    const n = Math.round(x * d);
    if (Math.abs(x - n / d) < 1e-9) {
      return { num: sign * n, den: d, latex: `${sign < 0 ? '-' : ''}\\frac{${n}}{${d}}`, text: `${sign * n}/${d}` };
    }
  }
  return null;
}

export function evaluateMath(input, { angleUnit = 'rad', precision = 6, vars = {} } = {}) {
  const ast = parseAst(input);
  const free = [...collectVars(ast)].filter((v) => !Object.prototype.hasOwnProperty.call(vars, v));
  if (free.length) {
    throw new Error(`Contains variable${free.length > 1 ? 's' : ''} ${free.join(', ')} (use d/dx, Solve, or Plot).`);
  }
  const value = evalAst(ast, vars, { angleUnit });
  if (!Number.isFinite(value)) throw new Error('Result is undefined or infinite.');
  const frac = asSimpleFraction(value);
  const text = formatNumber(value, precision);
  return { value, text, latex: frac ? `${frac.latex} \\approx ${text}` : text, fraction: frac };
}

export function symbolicDerivative(input, variable = 'x') {
  const cleaned = String(input ?? '').replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
  const ast = parseAst(cleaned);
  const deriv = simplifyAst(diffAst(ast, variable));
  return { ast: deriv, latex: astToLatex(deriv) };
}

export function numericIntegral(input, a, b, { angleUnit = 'rad', precision = 6, steps = 200 } = {}) {
  const lo = Number(a), hi = Number(b);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('Enter numeric integration bounds.');
  const cleaned = String(input ?? '').replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
  const ast = parseAst(cleaned);
  const n = Math.max(20, Math.min(2000, steps % 2 === 0 ? steps : steps + 1));
  const h = (hi - lo) / n;
  const f = (x) => evalAst(ast, { x }, { angleUnit });
  let sum = f(lo) + f(hi);
  for (let i = 1; i < n; i++) {
    const y = f(lo + i * h);
    if (!Number.isFinite(y)) throw new Error('Function is undefined inside the interval.');
    sum += (i % 2 === 0 ? 2 : 4) * y;
  }
  const value = (sum * h) / 3;
  if (!Number.isFinite(value)) throw new Error('Integral did not converge.');
  return { value, text: formatNumber(value, precision), latex: formatNumber(value, precision) };
}

export function solveEquation(input, { angleUnit = 'rad', precision = 6, min = -20, max = 20 } = {}) {
  const raw = String(input ?? '').replace(/^\s*\$+|\$+\s*$/g, '').trim();
  const parts = raw.split('=');
  if (parts.length > 2) throw new Error('Use at most one “=” sign.');
  const expr = parts.length === 2 ? `(${parts[0]}) - (${parts[1]})` : parts[0];
  const ast = parseAst(expr);
  const free = [...collectVars(ast)];
  const variable = free[0] || 'x';
  if (free.length > 1) throw new Error(`Solve supports one variable (found ${free.join(', ')}).`);
  const f = (x) => evalAst(ast, { [variable]: x }, { angleUnit });

  const roots = [];
  const pushRoot = (r) => {
    const clean = Math.abs(r) < 1e-10 ? 0 : r;
    if (!roots.some((existing) => Math.abs(existing - clean) < 1e-5)) roots.push(clean);
  };

  // Scan [min, max] for sign changes and near-zero minima, then refine via bisection.
  const samples = 400;
  const step = (max - min) / samples;
  let prevX = min, prevY = f(min);
  if (Number.isFinite(prevY) && Math.abs(prevY) < 1e-9) pushRoot(prevX);
  for (let i = 1; i <= samples; i++) {
    const x = min + i * step;
    const y = f(x);
    if (Number.isFinite(y) && Math.abs(y) < 1e-9) {
      pushRoot(x);
    } else if (Number.isFinite(prevY) && Number.isFinite(y) && prevY * y < 0) {
      let lo = prevX, hi = x, yLo = prevY;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) * 0.5;
        const yMid = f(mid);
        if (!Number.isFinite(yMid)) break;
        if (Math.abs(yMid) < 1e-12) { lo = hi = mid; break; }
        if (yLo * yMid <= 0) hi = mid; else { lo = mid; yLo = yMid; }
      }
      const root = (lo + hi) * 0.5;
      if (Math.abs(f(root)) < 1e-4) pushRoot(root);
    }
    prevX = x; prevY = y;
  }
  roots.sort((a, b) => a - b);
  return {
    variable,
    roots,
    latex: roots.length
      ? `${variable} \\approx ${roots.map((r) => formatNumber(r, precision)).join(',\\; ')}`
      : `\\text{No real roots in } [${min}, ${max}]`,
  };
}

export function isPlottable(input) {
  try {
    const cleaned = String(input ?? '').replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
    const ast = parseAst(cleaned);
    const vars = [...collectVars(ast)];
    return vars.length <= 1 && (vars.length === 0 || vars[0] === 'x');
  } catch {
    return false;
  }
}
