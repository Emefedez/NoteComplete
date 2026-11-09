// A function of x from LaTeX, to graph it (docs/SHAPES-TABLES-MATH.md, G1): what study notes
// write (polynomials, fractions, roots, powers, trigonometry, exponentials and logarithms,
// absolute values, implicit products like 2x or x\sin x). Parsed into closures: no eval, so
// it runs under the app's content security policy. Anything else is refused with a reason.
const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: (v) => 1 / Math.tan(v), sec: (v) => 1 / Math.cos(v), csc: (v) => 1 / Math.sin(v),
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  ln: Math.log, log: Math.log10, exp: Math.exp,
};
const CONSTANTS = { pi: Math.PI };

// The right side of `y = …`, `f(x) = …` or a bare expression.
export function functionSource(tex) {
  const source = String(tex ?? '').replace(/^\s*\$+|\$+\s*$/g, '').trim();
  const parts = source.split('=');
  if (parts.length === 1) return source;
  if (parts.length === 2 && /^\s*(y|[a-zA-Z](\s*\\left)?\s*\(\s*x\s*(\\right)?\s*\))\s*$/.test(parts[0])) return parts[1].trim();
  throw new Error('Write the function as y = … (in x) to graph it.');
}

function tokenize(tex) {
  const s = tex
    .replace(/\\(left|right|displaystyle|textstyle|bigl?|bigr?|Bigl?|Bigr?)\b/g, '')
    .replace(/\\[,;:! ]|~/g, ' ')
    .replace(/\\operatorname\{([a-z]+)\}/g, '\\$1')
    .replace(/\\[dt]frac/g, '\\frac');
  const tokens = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const number = /^\d*\.?\d+/.exec(s.slice(i));
    if (number) { tokens.push({ t: 'num', v: number[0] }); i += number[0].length; continue; }
    if (c === '\\') {
      const name = /^[a-zA-Z]+/.exec(s.slice(i + 1))?.[0];
      if (!name) { i += 2; continue; }
      tokens.push({ t: 'cmd', v: name });
      i += 1 + name.length;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) { tokens.push({ t: 'id', v: c }); i++; continue; }
    if ('+-*/^_()[]{}|!'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error(`“${c}” is not something the graph can draw.`);
  }
  return tokens;
}

// Recursive descent: sum → product (explicit or implied) → sign → power → atom.
export function compileFunction(tex) {
  const tokens = tokenize(functionSource(tex));
  if (!tokens.length) throw new Error('Nothing to graph yet.');
  let at = 0;
  const peek = () => tokens[at], next = () => tokens[at++];
  const expect = (t) => { if (peek()?.t !== t) throw new Error(`Missing “${t === '}' ? '}' : t}”.`); next(); };
  const group = () => {
    if (peek()?.t === '{') { next(); const e = sum(); expect('}'); return e; }
    // \frac12, x^2: one character or symbol.
    const tok = peek();
    if (tok?.t === 'num' && tok.v.length > 1) { tokens[at] = { t: 'num', v: tok.v.slice(1) }; const d = Number(tok.v[0]); return () => d; }
    return atom();
  };
  const startsAtom = (tok) => tok && (tok.t === 'num' || tok.t === 'id' || tok.t === '(' || tok.t === '{' || (tok.t === 'cmd' && tok.v !== 'cdot' && tok.v !== 'times' && tok.v !== 'div'));
  function sum() {
    let left = product();
    while (peek()?.t === '+' || peek()?.t === '-') {
      const op = next().t, a = left, b = product();
      left = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
    }
    return left;
  }
  function product() {
    let left = sign();
    for (;;) {
      const tok = peek();
      const divide = tok?.t === '/' || (tok?.t === 'cmd' && tok.v === 'div');
      if (tok?.t === '*' || divide || (tok?.t === 'cmd' && (tok.v === 'cdot' || tok.v === 'times'))) {
        next();
        const a = left, b = sign();
        left = divide ? (x) => a(x) / b(x) : (x) => a(x) * b(x);
      } else if (startsAtom(tok)) {
        const a = left, b = power();
        left = (x) => a(x) * b(x);
      } else return left;
    }
  }
  function sign() {
    if (peek()?.t === '-') { next(); const a = sign(); return (x) => -a(x); }
    if (peek()?.t === '+') { next(); return sign(); }
    return power();
  }
  function power() {
    let base = atom();
    while (peek()?.t === '!') { next(); const a = base; base = (x) => factorial(a(x)); }
    if (peek()?.t === '^') {
      next();
      const b = peek()?.t === '-' ? (next(), ((e) => (x) => -e(x))(group())) : group();
      const a = base;
      return (x) => Math.pow(a(x), b(x));
    }
    return base;
  }
  // A function's argument without brackets: \sin 2x is sin(2x), \sin x + 1 is sin(x) + 1.
  function argument() {
    if (peek()?.t === '(' || peek()?.t === '{') return power();
    let a = power();
    while (peek() && (peek().t === 'num' || peek().t === 'id' || (peek().t === 'cmd' && CONSTANTS[peek().v] != null))) {
      const left = a, b = power();
      a = (x) => left(x) * b(x);
    }
    return a;
  }
  function atom() {
    const tok = next();
    if (!tok) throw new Error('The formula ends too soon.');
    if (tok.t === 'num') { const v = Number(tok.v); return () => v; }
    if (tok.t === 'id') {
      if (tok.v === 'x') return (x) => x;
      if (tok.v === 'e') return () => Math.E;
      throw new Error(`Only x can vary in a graph (found ${tok.v}).`);
    }
    if (tok.t === '(' || tok.t === '[') { const e = sum(); expect(tok.t === '(' ? ')' : ']'); return e; }
    if (tok.t === '{') { const e = sum(); expect('}'); return e; }
    if (tok.t === '|') { const e = sum(); expect('|'); return (x) => Math.abs(e(x)); }
    if (tok.t === 'cmd') {
      if (CONSTANTS[tok.v] != null) { const v = CONSTANTS[tok.v]; return () => v; }
      if (tok.v === 'infty') throw new Error('∞ cannot be drawn.');
      if (tok.v === 'frac') { const a = group(), b = group(); return (x) => a(x) / b(x); }
      if (tok.v === 'sqrt') {
        let n = null;
        if (peek()?.t === '[') { next(); n = sum(); expect(']'); }
        const a = group();
        return n ? (x) => nthRoot(a(x), n(x)) : (x) => Math.sqrt(a(x));
      }
      if (tok.v === 'abs') { const a = group(); return (x) => Math.abs(a(x)); }
      const f = FUNCTIONS[tok.v];
      if (f) {
        // \log_2 x, \sin^2 x (the square of the sine), \sin^{-1} x (the arcsine).
        let base = null, exponent = null;
        if (tok.v === 'log' && peek()?.t === '_') { next(); base = group(); }
        if (peek()?.t === '^') { next(); exponent = peek()?.t === '-' ? (next(), ((e) => (x) => -e(x))(group())) : group(); }
        const arg = argument();
        const inverse = { sin: Math.asin, cos: Math.acos, tan: Math.atan }[tok.v];
        const g = base ? (x) => Math.log(arg(x)) / Math.log(base(x)) : (x) => f(arg(x));
        if (!exponent) return g;
        return (x) => { const e = exponent(x); return e === -1 && inverse ? inverse(arg(x)) : Math.pow(g(x), e); };
      }
      throw new Error(`\\${tok.v} is not something the graph can draw.`);
    }
    throw new Error(`Unexpected “${tok.t}”.`);
  }
  const fn = sum();
  if (at < tokens.length) throw new Error(`Unexpected “${tokens[at].v ?? tokens[at].t}”.`);
  return fn;
}
function nthRoot(v, n) {
  // Odd roots of negative numbers are real.
  return v < 0 && Math.round(n) === n && n % 2 === 1 ? -Math.pow(-v, 1 / n) : Math.pow(v, 1 / n);
}
function factorial(v) {
  if (v < 0 || v !== Math.round(v) || v > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= v; i++) r *= i;
  return r;
}
