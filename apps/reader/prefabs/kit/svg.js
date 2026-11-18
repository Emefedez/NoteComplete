// The prefab kit's SVG helpers (docs/PREFAB-MODULES.md): text escaping, the safe maths
// evaluator plots use, and the SVG sanitizer. Shared by the modules' renderers and the exam
// HTML (exam-html.js re-exports them, so its importers are unchanged).
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MATH_FUNCS = Object.assign(Object.create(null), {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: (v, base) => (base == null ? Math.log(v) : Math.log(v) / Math.log(base)),
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
});

const MATH_CONSTS = Object.assign(Object.create(null), {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
});

/**
 * Pure, safe recursive-descent mathematical expression evaluator (no eval/Function).
 * Supports +, -, *, /, %, ^, **, parentheses, implicit multiplication (2x, 2sin(x)), and common math functions.
 */
export function evalMathExpr(expr, vars = { x: 0 }) {
  const src = String(expr ?? '').trim();
  if (!src || src.length > 300) return NaN;
  const normSrc = src
    .replace(/−/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi');

  // Tokenize
  const rawTokens = [];
  let i = 0;
  while (i < normSrc.length) {
    const ch = normSrc[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(normSrc[i + 1] || ''))) {
      let end = i + 1;
      while (end < normSrc.length && /[\d.]/.test(normSrc[end])) end++;
      if ((normSrc[end] === 'e' || normSrc[end] === 'E') && /[+\-\d]/.test(normSrc[end + 1] || '')) {
        end++;
        if (normSrc[end] === '+' || normSrc[end] === '-') end++;
        while (end < normSrc.length && /\d/.test(normSrc[end])) end++;
      }
      const num = Number(normSrc.slice(i, end));
      if (!Number.isFinite(num)) return NaN;
      rawTokens.push({ t: 'num', v: num });
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < normSrc.length && /[A-Za-z0-9_]/.test(normSrc[end])) end++;
      rawTokens.push({ t: 'id', v: normSrc.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === '*' && normSrc[i + 1] === '*') {
      rawTokens.push({ t: 'op', v: '^' });
      i += 2;
      continue;
    }
    if ('+-*/%^(),'.includes(ch)) {
      rawTokens.push({ t: ch === '(' || ch === ')' || ch === ',' ? ch : 'op', v: ch });
      i++;
      continue;
    }
    return NaN;
  }

  // Insert implicit multiplication tokens (e.g. 2x, 3(x+1), (x+1)(x-1), 2sin(x))
  const tokens = [];
  for (let k = 0; k < rawTokens.length; k++) {
    const cur = rawTokens[k];
    const prev = tokens[tokens.length - 1];
    if (prev) {
      const prevIsVal = prev.t === 'num' || prev.t === ')' || (prev.t === 'id' && !(prev.v.toLowerCase() in MATH_FUNCS));
      const curStartsVal = cur.t === 'num' || cur.t === '(' || cur.t === 'id';
      if (prevIsVal && curStartsVal) tokens.push({ t: 'op', v: '*' });
    }
    tokens.push(cur);
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let val = parseTerm();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm() {
    let val = parseUnary();
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = next().v;
      const rhs = parseUnary();
      val = op === '*' ? val * rhs : op === '/' ? val / rhs : val % rhs;
    }
    return val;
  }

  function parseUnary() {
    if (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const v = parseUnary();
      return op === '-' ? -v : v;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (peek()?.t === 'op' && peek().v === '^') {
      next();
      const exp = parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseAtom() {
    const tok = next();
    if (!tok) return NaN;
    if (tok.t === 'num') return tok.v;
    if (tok.t === '(') {
      const val = parseExpr();
      if (next()?.t !== ')') return NaN;
      return val;
    }
    if (tok.t === 'id') {
      const lower = tok.v.toLowerCase();
      if (peek()?.t === '(' && lower in MATH_FUNCS) {
        next(); // consume '('
        const args = [];
        if (peek()?.t !== ')') {
          args.push(parseExpr());
          while (peek()?.t === ',') {
            next();
            args.push(parseExpr());
          }
        }
        if (next()?.t !== ')') return NaN;
        return MATH_FUNCS[lower](...args);
      }
      if (vars && Object.prototype.hasOwnProperty.call(vars, tok.v)) return Number(vars[tok.v]);
      if (vars && Object.prototype.hasOwnProperty.call(vars, lower)) return Number(vars[lower]);
      if (lower in MATH_CONSTS) return MATH_CONSTS[lower];
      return NaN;
    }
    return NaN;
  }

  const out = parseExpr();
  if (pos !== tokens.length || !Number.isFinite(out)) return NaN;
  return out;
}

const SAFE_SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'line', 'rect', 'circle', 'ellipse',
  'path', 'polygon', 'polyline', 'text', 'tspan', 'marker',
]);
const DROP_WITH_CONTENT_TAGS = new Set([
  'script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video',
]);
const SVG_ATTR_CASE = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
  refx: 'refX',
  refy: 'refY',
  markerunits: 'markerUnits',
};
const SAFE_SVG_ATTRS = new Set([
  'xmlns', 'viewbox', 'preserveaspectratio', 'width', 'height',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'id', 'class', 'style',
  'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'markerunits',
  'marker-start', 'marker-mid', 'marker-end',
]);
const SAFE_STYLE_PROPS = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity',
  'font-size', 'font-weight', 'font-style', 'font-family', 'text-anchor',
  'dominant-baseline', 'display',
]);

function sanitizeSvgStyle(rawStyle) {
  return String(rawStyle || '')
    .split(';')
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx === -1) return '';
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (!SAFE_STYLE_PROPS.has(prop) || !val) return '';
      if (/url\(|expression\(|javascript:|vbscript:|data:/i.test(val)) return '';
      return `${prop}:${val}`;
    })
    .filter(Boolean)
    .join(';');
}

/**
 * Strictly sanitizes raw SVG markup into safe pure SVG primitives (`<svg>`, `<g>`, `<defs>`,
 * `<line>`, `<rect>`, `<circle>`, `<ellipse>`, `<path>`, `<polygon>`, `<polyline>`, `<text>`, `<tspan>`, `<marker>`).
 * Strips scripts, foreignObject, images, use, event handlers, and unsafe URLs.
 */
export function sanitizeSvg(rawSvg) {
  const src = String(rawSvg ?? '').trim();
  if (!src) return '';
  const match = src.match(/<svg\b[\s\S]*?<\/svg>|<svg\b[^>]*\/>/i);
  if (!match) return '';
  let body = match[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '');

  for (const dangerous of DROP_WITH_CONTENT_TAGS) {
    body = body.replace(new RegExp(`<${dangerous}\\b[\\s\\S]*?<\\/${dangerous}>`, 'gi'), '');
    body = body.replace(new RegExp(`<${dangerous}\\b[^>]*\\/?>`, 'gi'), '');
  }

  const out = [];
  const stack = [];
  let cursor = 0;
  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9:_-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(body)) !== null) {
    if (m.index > cursor) {
      const txt = body.slice(cursor, m.index)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (txt) out.push(escapeHtml(txt));
    }
    cursor = m.index + m[0].length;
    const isClose = m[1] === '/';
    const rawName = m[2].includes(':') ? m[2].split(':').pop() : m[2];
    const tag = rawName.toLowerCase();
    const attrText = m[3] || '';
    const selfClose = m[4] === '/';

    if (!SAFE_SVG_TAGS.has(tag)) continue;
    if (isClose) {
      while (stack.length) {
        const top = stack.pop();
        out.push(`</${top}>`);
        if (top === tag) break;
      }
      continue;
    }

    const attrs = new Map();
    const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let am;
    while ((am = attrRe.exec(attrText)) !== null) {
      const rawKey = am[1];
      const lowerKey = rawKey.toLowerCase();
      if (lowerKey.startsWith('on') || !SAFE_SVG_ATTRS.has(lowerKey)) continue;
      const val = am[2] ?? am[3] ?? am[4] ?? '';
      if (/javascript:|vbscript:|data:|expression\s*\(/i.test(val)) continue;
      if (/url\(/i.test(val)) {
        if (!/^marker-(start|mid|end)$/.test(lowerKey) || !/^url\(\s*#[A-Za-z_][A-Za-z0-9_-]*\s*\)$/.test(val.trim())) {
          continue;
        }
      }
      const cleanVal = lowerKey === 'style' ? sanitizeSvgStyle(val) : val;
      if (lowerKey === 'style' && !cleanVal) continue;
      const canonKey = SVG_ATTR_CASE[lowerKey] || lowerKey;
      attrs.set(canonKey, cleanVal);
    }

    if (tag === 'svg') {
      attrs.set('xmlns', 'http://www.w3.org/2000/svg');
      if (!attrs.has('viewBox')) attrs.set('viewBox', '0 0 520 260');
    }

    const attrStr = [...attrs.entries()]
      .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
      .join('');
    out.push(`<${tag}${attrStr}${selfClose ? '/>' : '>'}`);
    if (!selfClose) stack.push(tag);
  }
  if (cursor < body.length) {
    out.push(escapeHtml(body.slice(cursor)));
  }
  while (stack.length) {
    out.push(`</${stack.pop()}>`);
  }
  const finalSvg = out.join('');
  return finalSvg.startsWith('<svg') ? finalSvg : '';
}
