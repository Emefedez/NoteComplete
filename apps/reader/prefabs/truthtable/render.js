// The truth table module's drawing (docs/PREFAB-MODULES-GUIDE.md): a row for every
// combination of the variables (the first one changes slowest, from all false to all true),
// and a column with a boolean expression's value in each row, or empty to fill in, or none.
// Pure: no DOM, so it also runs in Node (MCP add_prefab, the tests).
import { escapeHtml } from '../kit/svg.js';

const ROW = 26, HEAD = 30, PAD = 1;
const KEYWORDS = new Set(['and', 'or', 'not', 'xor', 'nand', 'nor', 'xnor', 'implies', 'iff', 'true', 'false']);
const NOTATIONS = { '10': ['0', '1'], VF: ['F', 'V'], TF: ['F', 'T'] };
const OUTPUTS = ['values', 'blank', 'none'];
export const MAX_VARIABLES = 6;
export const MAX_COLUMNS = 8;

const isName = (v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v) && !KEYWORDS.has(v.toLowerCase());

// The spec, made whole: valid, distinct variable names (1 to 6), a known output and notation,
// and optional extra relation columns (`extraColumns`: [{ expr, label, output }]).
export function normalize(raw = {}) {
  const given = Array.isArray(raw.variables) ? raw.variables : typeof raw.variables === 'string' ? raw.variables.split(/[\s,;]+/) : ['A', 'B'];
  const variables = [...new Set(given.map((v) => String(v ?? '').trim()).filter(isName))].slice(0, MAX_VARIABLES);
  const extraColumns = Array.isArray(raw.extraColumns)
    ? raw.extraColumns.slice(0, MAX_COLUMNS - 1).map((c) => ({
        expr: String(c?.expr ?? ''),
        label: String(c?.label ?? ''),
        output: OUTPUTS.includes(c?.output) ? c.output : 'values',
      })).filter((c) => c.expr.trim() || c.label.trim())
    : [];
  return {
    type: 'truthtable',
    title: String(raw.title ?? ''),
    variables: variables.length ? variables : ['A'],
    expr: String(raw.expr ?? ''),
    label: String(raw.label ?? ''),
    output: OUTPUTS.includes(raw.output) ? raw.output : 'values',
    notation: raw.notation in NOTATIONS ? raw.notation : '10',
    ...(extraColumns.length ? { extraColumns } : {}),
  };
}

// A boolean expression → a function of the variables' values, or throws with what is wrong.
// Operators, loosest first: ↔ <-> <=> iff, → -> => implies, or ∨ | +, nor ⊽, xor ⊕ ^, xnor ⊙,
// and ∧ & · *, nand ⊼, not ¬ ! ~ (before) or ' (after); 1/0 true/false; parentheses.
export function parseBool(text, variables) {
  const src = String(text ?? '');
  const tokens = [];
  const SYMBOLS = [
    ['<->', 'iff'], ['<=>', 'iff'], ['↔', 'iff'],
    ['->', 'imp'], ['=>', 'imp'], ['→', 'imp'],
    ['⊽', 'nor'], ['⊼', 'nand'], ['⊙', 'iff'],
    ['∨', 'or'], ['|', 'or'], ['+', 'or'],
    ['⊕', 'xor'], ['^', 'xor'],
    ['∧', 'and'], ['&', 'and'], ['·', 'and'], ['*', 'and'],
    ['¬', 'not'], ['!', 'not'], ['~', 'not'], ["'", 'prime'],
    ['(', '('], [')', ')'],
  ];
  for (let i = 0; i < src.length;) {
    if (/\s/.test(src[i])) { i++; continue; }
    const sym = SYMBOLS.find(([s]) => src.startsWith(s, i));
    if (sym) { tokens.push({ t: sym[1] }); i += sym[0].length; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_]*|^[01]/.exec(src.slice(i))?.[0];
    if (!word) throw Error(`“${src[i]}” is not an operator`);
    const lower = word.toLowerCase();
    if (word === '1' || lower === 'true') tokens.push({ t: 'const', v: true });
    else if (word === '0' || lower === 'false') tokens.push({ t: 'const', v: false });
    else if (lower === 'implies') tokens.push({ t: 'imp' });
    else if (lower === 'xnor') tokens.push({ t: 'iff' });
    else if (KEYWORDS.has(lower)) tokens.push({ t: lower });
    else if (variables.includes(word)) tokens.push({ t: 'var', v: variables.indexOf(word) });
    else throw Error(`${word} is not one of the variables`);
    i += word.length;
  }
  if (!tokens.length) throw Error('No expression');
  let pos = 0;
  const peek = () => tokens[pos]?.t;
  const binary = (op, next, fn, right = false) => () => {
    const a = next();
    if (peek() !== op) return a;
    pos++;
    const b = right ? binary(op, next, fn, true)() : next();
    let f = (v) => fn(a(v), b(v));
    while (!right && peek() === op) { pos++; const c = next(), g = f; f = (v) => fn(g(v), c(v)); }
    return f;
  };
  function atom() {
    const tok = tokens[pos++];
    if (!tok) throw Error('The expression ends too soon');
    let f;
    if (tok.t === 'not') { const a = atom(); f = (v) => !a(v); }
    else if (tok.t === 'const') f = () => tok.v;
    else if (tok.t === 'var') f = (v) => v[tok.v];
    else if (tok.t === '(') { f = iff(); if (tokens[pos++]?.t !== ')') throw Error('A “)” is missing'); }
    else throw Error(`Unexpected ${tok.t === ')' ? '“)”' : tok.t}`);
    while (peek() === 'prime') { pos++; const g = f; f = (v) => !g(v); }
    return f;
  }
  const nand = binary('nand', atom, (a, b) => !(a && b));
  const and = binary('and', nand, (a, b) => a && b);
  const xor = binary('xor', and, (a, b) => a !== b);
  const nor = binary('nor', xor, (a, b) => !(a || b));
  const or = binary('or', nor, (a, b) => a || b);
  const imp = binary('imp', or, (a, b) => !a || b, true);
  const iff = binary('iff', imp, (a, b) => a === b);
  const f = iff();
  if (pos < tokens.length) throw Error(`Unexpected ${tokens[pos].t === ')' ? '“)”' : tokens[pos].t} at the end`);
  return f;
}

// Extract intermediate sub-expressions inside parentheses or unary negations for step-by-step columns.
export function extractSubExpressions(expr, variables) {
  const src = String(expr ?? '').trim();
  if (!src) return [];
  const subs = [];
  const add = (s) => {
    const clean = s.trim();
    if (!clean || clean === src || variables.includes(clean) || subs.includes(clean)) return;
    try { parseBool(clean, variables); subs.push(clean); } catch { /* Ignore partial */ }
  };
  // Negated variables like "not A", "¬B", "A'"
  for (const m of src.matchAll(/(?:\bnot\s+|[¬!~]\s*)([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)'/gi)) {
    add(m[0]);
  }
  // Parenthesized groups from innermost to outermost
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '(') stack.push(i);
    else if (src[i] === ')' && stack.length) {
      const start = stack.pop();
      add(src.slice(start + 1, i));
    }
  }
  return subs.slice(0, MAX_COLUMNS - 2);
}

// Build a canonical Disjunctive Normal Form (Sum of Products) expression from row boolean outputs.
export function synthesizeDnf(variables, outs) {
  const trueRows = [];
  const n = variables.length;
  for (let r = 0; r < 2 ** n; r++) {
    if (!outs[r]) continue;
    const vals = variables.map((_, i) => Boolean((r >> (n - 1 - i)) & 1));
    const term = variables.map((v, i) => (vals[i] ? v : `¬${v}`)).join(' ∧ ');
    trueRows.push(variables.length > 1 ? `(${term})` : term);
  }
  if (!trueRows.length) return '0';
  if (trueRows.length === 2 ** n) return '1';
  return trueRows.join(' ∨ ');
}

// Every row: { values: [booleans], out: boolean | null, extraOuts: [boolean | null] }, and the
// expression's problem ('' when none). Without an expression, out is null.
export function evaluate(raw) {
  const s = normalize(raw);
  let f = null, error = '';
  if (s.expr.trim()) { try { f = parseBool(s.expr, s.variables); } catch (e) { error = e.message; } }
  const extraFns = (s.extraColumns || []).map((c) => {
    if (!c.expr.trim()) return { fn: null, err: '' };
    try { return { fn: parseBool(c.expr, s.variables), err: '' }; }
    catch (e) { if (!error) error = e.message; return { fn: null, err: e.message }; }
  });
  const n = s.variables.length, rows = [];
  for (let r = 0; r < 2 ** n; r++) {
    const values = s.variables.map((_, i) => Boolean((r >> (n - 1 - i)) & 1));
    rows.push({
      values,
      out: f ? Boolean(f(values)) : null,
      extraOuts: extraFns.map((ef) => (ef.fn ? Boolean(ef.fn(values)) : null)),
    });
  }
  return { rows, error };
}

// Text width, roughly, for column widths (no DOM to measure with).
const textWidth = (t, size) => [...t].reduce((w, c) => w + (/[A-Z0-9]/.test(c) ? 0.68 : /[ilj'.,]/.test(c) ? 0.3 : 0.56), 0) * size;

export function render(raw) {
  const s = normalize(raw);
  const { rows } = evaluate(s);
  const [no, yes] = NOTATIONS[s.notation];
  const cols = s.variables.map((v) => ({ head: v, w: Math.max(40, textWidth(v, 14) + 24) }));
  (s.extraColumns || []).forEach((ec, idx) => {
    if (ec.output === 'none') return;
    const h = ec.label || ec.expr || `Step ${idx + 1}`;
    cols.push({ head: h, w: Math.max(56, Math.min(360, textWidth(h, 14) + 28)), out: true, extraIdx: idx, mode: ec.output });
  });
  if (s.output !== 'none') {
    const heading = s.label || s.expr || 'Output';
    cols.push({ head: heading, w: Math.max(56, Math.min(360, textWidth(heading, 14) + 28)), out: true, mainOut: true, mode: s.output });
  }
  const width = Math.round(cols.reduce((w, c) => w + c.w, 0) + 2 * PAD);
  const top = s.title ? 30 : 0, height = top + HEAD + rows.length * ROW + 2 * PAD;
  const parts = [];
  if (s.title) parts.push(`<text x="${width / 2}" y="20" text-anchor="middle" font-size="15" font-weight="600" fill="#1f2328">${escapeHtml(s.title)}</text>`);
  const y0 = top + PAD, inner = cols.reduce((w, c) => w + c.w, 0);
  parts.push(`<rect x="${PAD}" y="${y0}" width="${inner}" height="${HEAD}" fill="#eef2f7"/>`);
  let x = PAD;
  for (const c of cols) {
    if (c.mainOut) parts.push(`<line x1="${x - 2}" y1="${y0}" x2="${x - 2}" y2="${y0 + HEAD + rows.length * ROW}" stroke="#1f2328" stroke-width="1"/>`);
    else if (x > PAD) parts.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + HEAD + rows.length * ROW}" stroke="#c4cad3" stroke-width="1"/>`);
    parts.push(`<text x="${x + c.w / 2}" y="${y0 + 20}" text-anchor="middle" font-size="14" font-weight="600" ${c.out ? '' : 'font-style="italic" '}fill="#1f2328">${escapeHtml(c.head)}</text>`);
    x += c.w;
  }
  parts.push(`<line x1="${PAD}" y1="${y0 + HEAD}" x2="${PAD + inner}" y2="${y0 + HEAD}" stroke="#1f2328" stroke-width="1.4"/>`);
  rows.forEach((row, r) => {
    const y = y0 + HEAD + r * ROW;
    if (r) parts.push(`<line x1="${PAD}" y1="${y}" x2="${PAD + inner}" y2="${y}" stroke="#e1e5ea" stroke-width="1"/>`);
    let cx = PAD;
    cols.forEach((c, i) => {
      let value = '';
      if (c.out) {
        const outVal = c.mainOut ? row.out : row.extraOuts?.[c.extraIdx];
        value = c.mode === 'blank' ? '' : outVal == null ? '?' : outVal ? yes : no;
        parts.push(`<rect x="${cx}" y="${y}" width="${c.w}" height="${ROW}" fill="transparent" data-tt-row="${r}" data-tt-col="${c.mainOut ? 'main' : c.extraIdx}"/>`);
      } else {
        value = row.values[i] ? yes : no;
      }
      if (value) parts.push(`<text x="${cx + c.w / 2}" y="${y + 18}" text-anchor="middle" font-size="14" ${c.out ? 'font-weight="600" ' : ''}fill="${c.out ? '#1d4ed8' : '#1f2328'}">${value}</text>`);
      cx += c.w;
    });
  });
  parts.push(`<rect x="${PAD}" y="${y0}" width="${inner}" height="${HEAD + rows.length * ROW}" fill="none" stroke="#1f2328" stroke-width="1.4"/>`);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`, width, height };
}

export const name = () => 'Truth table';
