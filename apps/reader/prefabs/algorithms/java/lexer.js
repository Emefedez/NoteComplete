// Java subset: the lexer. Pure (no DOM), turns source text into tokens with 1-based line and
// column. Literals keep Java's kinds: int (number), long (BigInt), double/float, char, string,
// text blocks. Comments are skipped.

export class CompileError extends Error {
  constructor(message, line, column, file) {
    super(message);
    this.name = 'CompileError';
    this.line = line;
    this.column = column;
    this.file = file || null;
  }
}

export const KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null',
]);

// Longest first, so ">>>=" wins over ">>" and ">".
const OPS = [
  '>>>=', '<<=', '>>=', '>>>', '...', '->', '::', '++', '--', '&&', '||', '==', '!=', '<=', '>=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
  '(', ')', '{', '}', '[', ']', ';', ',', '.', '@', '=', '>', '<', '!', '~', '?', ':', '+', '-',
  '*', '/', '&', '|', '^', '%',
];

const isIdStart = (c) => /[A-Za-z_$À-￿]/.test(c);
const isIdPart = (c) => /[A-Za-z0-9_$À-￿]/.test(c);

export function tokenize(src, file) {
  const toks = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = src.length;
  const err = (msg, at = i) => { throw new CompileError(msg, line, at - lineStart + 1, file); };
  const push = (t, v, start, sl, sc, extra) => {
    toks.push({ t, v, line: sl, col: sc, pos: start, end: i, ...extra });
  };
  const readEscape = () => {
    // at a backslash inside a char or string literal
    i++;
    const c = src[i];
    const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', s: ' ', '0': '\0', "'": "'", '"': '"', '\\': '\\' };
    if (c === 'u') {
      while (src[i] === 'u') i++;
      const hex = src.slice(i, i + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) err('illegal unicode escape');
      i += 4;
      return String.fromCharCode(parseInt(hex, 16));
    }
    if (/[0-7]/.test(c)) {
      let j = i;
      while (j < i + 3 && /[0-7]/.test(src[j])) j++;
      const v = parseInt(src.slice(i, j), 8);
      i = j;
      return String.fromCharCode(v);
    }
    if (!(c in map)) err('illegal escape character in literal');
    i++;
    return map[c];
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { i++; line++; lineStart = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const sl = line, sc = i - lineStart + 1;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { line++; lineStart = i + 1; }
        i++;
      }
      if (i >= n) throw new CompileError('unclosed comment', sl, sc, file);
      i += 2;
      continue;
    }
    const start = i, sl = line, sc = i - lineStart + 1;
    if (isIdStart(c)) {
      while (i < n && isIdPart(src[i])) i++;
      const w = src.slice(start, i);
      push(KEYWORDS.has(w) ? 'kw' : 'id', w, start, sl, sc);
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      readNumber();
      continue;
    }
    if (c === '"') {
      if (src.startsWith('"""', i)) { readTextBlock(start, sl, sc); continue; }
      i++;
      let s = '';
      while (true) {
        if (i >= n || src[i] === '\n') throw new CompileError('unclosed string literal', sl, sc, file);
        const d = src[i];
        if (d === '"') { i++; break; }
        if (d === '\\') { s += readEscape(); continue; }
        s += d;
        i++;
      }
      push('str', s, start, sl, sc);
      continue;
    }
    if (c === "'") {
      i++;
      let s;
      if (src[i] === '\\') s = readEscape();
      else if (src[i] === "'" || src[i] === '\n' || i >= n) throw new CompileError('empty character literal', sl, sc, file);
      else { s = src[i]; i++; }
      if (src[i] !== "'") throw new CompileError('unclosed character literal', sl, sc, file);
      i++;
      push('char', s.charCodeAt(0), start, sl, sc);
      continue;
    }
    let op = null;
    for (const o of OPS) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) err("illegal character: '" + c + "'");
    i += op.length;
    push('op', op, start, sl, sc);
  }
  toks.push({ t: 'eof', v: '<end of file>', line, col: i - lineStart + 1, pos: i, end: i });
  return toks;

  function readNumber() {
    const start = i, sl = line, sc = i - lineStart + 1;
    let text;
    let radix = 10;
    let isFloat = false;
    if (src[i] === '0' && /[xX]/.test(src[i + 1] || '')) {
      i += 2;
      while (/[0-9a-fA-F_]/.test(src[i] || '')) i++;
      radix = 16;
      text = src.slice(start + 2, i);
    } else if (src[i] === '0' && /[bB]/.test(src[i + 1] || '')) {
      i += 2;
      while (/[01_]/.test(src[i] || '')) i++;
      radix = 2;
      text = src.slice(start + 2, i);
    } else {
      while (/[0-9_]/.test(src[i] || '')) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) { isFloat = true; i++; while (/[0-9_]/.test(src[i] || '')) i++; }
      else if (src[i] === '.' && !/[A-Za-z_.]/.test(src[i + 1] || '')) { isFloat = true; i++; }
      if (/[eE]/.test(src[i] || '')) {
        isFloat = true;
        i++;
        if (/[+-]/.test(src[i])) i++;
        if (!/[0-9]/.test(src[i] || '')) err('malformed floating-point literal');
        while (/[0-9_]/.test(src[i] || '')) i++;
      }
      text = src.slice(start, i);
      if (text.length > 1 && text[0] === '0' && !isFloat && !/[fFdD]/.test(src[i] || '')) radix = 8;
    }
    text = text.replace(/_/g, '');
    const suf = src[i] || '';
    if (/[lL]/.test(suf)) {
      i++;
      let v;
      try { v = BigInt(radix === 10 ? text : (radix === 16 ? '0x' : radix === 2 ? '0b' : '0o') + text); } catch { err('malformed long literal', start); }
      if (radix === 10 && v > 9223372036854775808n) err('long number too large', start);
      toks.push({ t: 'long', v: BigInt.asIntN(64, v), line: sl, col: sc, pos: start, end: i, big: v === 9223372036854775808n });
      return;
    }
    if (/[fFdD]/.test(suf)) { i++; isFloat = true; }
    if (isFloat) {
      const v = Number(text);
      toks.push({ t: /[fF]/.test(suf) ? 'float' : 'double', v: /[fF]/.test(suf) ? Math.fround(v) : v, line: sl, col: sc, pos: start, end: i });
      return;
    }
    if (isIdPart(suf)) err('illegal character in number', i);
    let v = radix === 10 ? Number(text) : parseInt(text || '0', radix);
    if (radix === 10) {
      if (v > 2147483648) err('integer number too large', start);
      toks.push({ t: 'int', v, line: sl, col: sc, pos: start, end: i, big: v === 2147483648 });
      return;
    }
    if (v > 0xFFFFFFFF) err('integer number too large', start);
    toks.push({ t: 'int', v: v | 0, line: sl, col: sc, pos: start, end: i });
  }

  function readTextBlock(start, sl, sc) {
    i += 3;
    while (src[i] === ' ' || src[i] === '\t') i++;
    if (src[i] === '\r') i++;
    if (src[i] !== '\n') err('text block must start with a new line');
    i++; line++; lineStart = i;
    let raw = '';
    while (true) {
      if (i >= n) throw new CompileError('unclosed text block', sl, sc, file);
      if (src.startsWith('"""', i)) { i += 3; break; }
      if (src[i] === '\\') { raw += '\u0000ESC' + readEscape() + '\u0000'; continue; }
      if (src[i] === '\n') { line++; lineStart = i + 1; }
      raw += src[i];
      i++;
    }
    // strip incidental indentation (the minimum over non-blank lines and the closing line)
    const lines = raw.split('\n');
    const closingOnOwnLine = /^[ \t]*$/.test(lines[lines.length - 1]);
    const ind = lines
      .filter((l, k) => l.trim() !== '' || (k === lines.length - 1 && closingOnOwnLine))
      .map((l) => l.match(/^[ \t]*/)[0].length);
    const min = ind.length ? Math.min(...ind) : 0;
    let out = lines.map((l) => l.slice(min).replace(/[ \t]+$/, '')).join('\n');
    if (closingOnOwnLine) out = out.replace(/[^\n]*$/, '');
    out = out.replace(/\u0000ESC([\s\S])\u0000/g, '$1');
    toks.push({ t: 'str', v: out, line: sl, col: sc, pos: start, end: i });
  }
}
