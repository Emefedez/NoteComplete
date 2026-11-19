// Java subset library: java.lang (Math, Integer, Long, Double, Character, Boolean, String,
// StringBuilder, Objects, System), Arrays, Collections, List.of/Set.of/Map.of, Scanner, Random.
// Static methods are `(rt, args) => value` in STATICS[class][method]; static fields are in
// STATIC_FIELDS. String and boxed-value instance methods are in stringMethod / boxedMethod.

import { LibObject, JIterator, listString } from './base.js';
import { JList, JSet, JMap, toArray } from './util.js';
import {
  JArray, JChar, JDouble, jchar, dbl, isStr, sv, nkind, toNumber, doubleToString, stringHash,
  javaHash, javaEquals,
} from '../values.js';

const INT_MIN = -2147483648, INT_MAX = 2147483647;
const LONG_MIN = -9223372036854775808n, LONG_MAX = 9223372036854775807n;

// result kind of a binary numeric operation: d, l or i
function kindOf(...vs) {
  let k = 'i';
  for (const v of vs) {
    const x = nkind(v);
    if (x === 'd') return 'd';
    if (x === 'l') k = 'l';
  }
  return k;
}
const asBig = (v) => (typeof v === 'bigint' ? v : BigInt(Math.trunc(toNumber(v))));
const mk = (k, n) => (k === 'd' ? dbl(n) : k === 'l' ? BigInt.asIntN(64, BigInt(n)) : n | 0);

function parseIntJava(rt, s, radix = 10, long = false) {
  if (s === null) rt.throwJava('NumberFormatException', 'Cannot parse null string: null');
  const str = sv(s);
  const re = radix === 10 ? /^[+-]?\d+$/ : radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : radix === 2 ? /^[+-]?[01]+$/ : radix === 8 ? /^[+-]?[0-7]+$/ : /^[+-]?[0-9a-zA-Z]+$/;
  if (!re.test(str)) rt.throwJava('NumberFormatException', 'For input string: "' + str + '"' + (radix !== 10 ? ' under radix ' + radix : ''));
  if (long || radix !== 10) {
    let neg = false, body = str;
    if (body[0] === '-' || body[0] === '+') { neg = body[0] === '-'; body = body.slice(1); }
    let v = 0n;
    for (const ch of body.toLowerCase()) v = v * BigInt(radix) + BigInt(parseInt(ch, 36));
    if (neg) v = -v;
    if (long) { if (v < LONG_MIN || v > LONG_MAX) rt.throwJava('NumberFormatException', 'For input string: "' + str + '"'); return v; }
    if (v < INT_MIN || v > INT_MAX) rt.throwJava('NumberFormatException', 'For input string: "' + str + '"' + (radix !== 10 ? ' under radix ' + radix : ''));
    return Number(v);
  }
  const v = Number(str);
  if (v < INT_MIN || v > INT_MAX) rt.throwJava('NumberFormatException', 'For input string: "' + str + '"');
  return v;
}

function parseDoubleJava(rt, s) {
  if (s === null) rt.throwJava('NullPointerException', null);
  const str = sv(s).trim();
  if (!/^[+-]?(NaN|Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?)$/.test(str)) rt.throwJava('NumberFormatException', 'For input string: "' + sv(s) + '"');
  return dbl(Number(str.replace(/[fFdD]$/, '')));
}

// String.format with the usual conversions: %d %s %f %.2f %c %b %x %n %%, widths and flags
export function formatJava(rt, fmt, args) {
  let k = 0;
  return sv(fmt).replace(/%([-#+ 0,(]*)(\d+)?(\.\d+)?([a-zA-Z%])/g, (m, flags, width, prec, conv) => {
    if (conv === 'n') return '\n';
    if (conv === '%') return '%';
    const v = args[k++];
    let s;
    switch (conv) {
      case 'd': {
        if (!(typeof v === 'number' || typeof v === 'bigint')) rt.throwJava('IllegalFormatConversionException', 'd != ' + rt.className(v));
        s = String(v);
        if (flags.includes(',')) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (flags.includes('+') && !s.startsWith('-')) s = '+' + s;
        break;
      }
      case 'f': case 'e': {
        const n = toNumber(v);
        const p = prec ? +prec.slice(1) : 6;
        s = conv === 'f' ? n.toFixed(p) : n.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
        if (flags.includes('+') && n >= 0) s = '+' + s;
        break;
      }
      case 's': case 'S': s = rt.str(v); if (prec) s = s.slice(0, +prec.slice(1)); if (conv === 'S') s = s.toUpperCase(); break;
      case 'c': s = v instanceof JChar ? String.fromCharCode(v.c) : String.fromCharCode(toNumber(v)); break;
      case 'b': case 'B': s = v === null ? 'false' : typeof v === 'boolean' ? String(v) : 'true'; break;
      case 'x': case 'X': s = (typeof v === 'bigint' ? BigInt.asUintN(64, v) : (v >>> 0)).toString(16); if (conv === 'X') s = s.toUpperCase(); break;
      case 'o': s = (v >>> 0).toString(8); break;
      default: rt.throwJava('UnknownFormatConversionException', "Conversion = '" + conv + "'");
    }
    if (width && s.length < +width) {
      if (flags.includes('-')) s = s.padEnd(+width);
      else if (flags.includes('0') && /[dfex]/.test(conv)) { const neg = s[0] === '-' || s[0] === '+'; s = (neg ? s[0] : '') + s.slice(neg ? 1 : 0).padStart(+width - (neg ? 1 : 0), '0'); }
      else s = s.padStart(+width);
    }
    return s;
  });
}

// ── StringBuilder ─────────────────────────────────────────────────
export class StringBuilder extends LibObject {
  constructor(rt, init) {
    super(rt);
    this.s = init === undefined || typeof init === 'number' ? '' : rt.str(init);
  }
  get _jname() { return 'StringBuilder'; }
  get _pkg() { return 'java.lang'; }
  get _types() { return ['StringBuilder', 'CharSequence', 'Object']; }
  _kind() { return 'text'; }
  _snap() { return { text: this.s }; }
  _set(s) { const o = this.s; this.s = s; this._mut('set', [], o, s); return this; }
  _idx(i, n = this.s.length) { if (i < 0 || i >= n) this.rt.throwJava('StringIndexOutOfBoundsException', 'index ' + i + ',length ' + this.s.length); }
  append(x, start, end) {
    if (x instanceof JArray) return this._set(this.s + x.a.map((c) => String.fromCharCode(c.c)).join(''));
    let t = this.rt.str(x);
    if (start !== undefined) t = t.slice(start, end);
    return this._set(this.s + t);
  }
  insert(i, x) { if (i < 0 || i > this.s.length) this._idx(i, 0); return this._set(this.s.slice(0, i) + this.rt.str(x) + this.s.slice(i)); }
  reverse() { return this._set(this.s.split('').reverse().join('')); }
  length() { return this.s.length; }
  isEmpty() { return this.s.length === 0; }
  charAt(i) { this._idx(i); return jchar(this.s.charCodeAt(i)); }
  setCharAt(i, c) { this._idx(i); this._set(this.s.slice(0, i) + String.fromCharCode(c.c) + this.s.slice(i + 1)); }
  deleteCharAt(i) { this._idx(i); return this._set(this.s.slice(0, i) + this.s.slice(i + 1)); }
  delete(a, b) { if (a < 0 || a > b || a > this.s.length) this.rt.throwJava('StringIndexOutOfBoundsException', 'start ' + a + ', end ' + b + ', length ' + this.s.length); return this._set(this.s.slice(0, a) + this.s.slice(Math.min(b, this.s.length))); }
  replace(a, b, str) { return this._set(this.s.slice(0, a) + sv(str) + this.s.slice(Math.min(b, this.s.length))); }
  indexOf(str, from = 0) { return this.s.indexOf(sv(str), from); }
  lastIndexOf(str) { return this.s.lastIndexOf(sv(str)); }
  substring(a, b) { return stringMethod(this.rt, this.s, 'substring', b === undefined ? [a] : [a, b]); }
  setLength(n) { this._set(n <= this.s.length ? this.s.slice(0, n) : this.s + '\0'.repeat(n - this.s.length)); }
  chars() { this.rt.throwJava('UnsupportedOperationException', 'streams are not supported by the simulator'); }
  compareTo(o) { return stringMethod(this.rt, this.s, 'compareTo', [o.s]); }
  toString() { return new String(this.s); }
}

// ── Scanner (System.in reads the run's `input`) ───────────────────
export class Scanner extends LibObject {
  constructor(rt, src) {
    super(rt);
    this.text = src === 'stdin' || src === undefined ? rt.input : isStr(src) ? sv(src) : rt.input;
    this.pos = 0;
  }
  get _jname() { return 'Scanner'; }
  get _pkg() { return 'java.util'; }
  _skipWs() { while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++; }
  _peekToken() { this._skipWs(); const m = /^\S+/.exec(this.text.slice(this.pos)); return m ? m[0] : null; }
  hasNext() { return this._peekToken() !== null; }
  next() { const t = this._peekToken(); if (t === null) this.rt.throwJava('NoSuchElementException', null); this.pos += t.length; return new String(t); }
  hasNextInt() { const t = this._peekToken(); return t !== null && /^[+-]?\d+$/.test(t) && Math.abs(+t) <= INT_MAX + 1; }
  nextInt() { const t = this._peekToken(); if (t === null) this.rt.throwJava('NoSuchElementException', null); if (!/^[+-]?\d+$/.test(t)) this.rt.throwJava('InputMismatchException', 'For input string: "' + t + '"'); this.pos += t.length; return parseIntJava(this.rt, t); }
  nextLong() { const t = this.next(); return parseIntJava(this.rt, t, 10, true); }
  hasNextDouble() { const t = this._peekToken(); return t !== null && !Number.isNaN(Number(t)); }
  nextDouble() { const t = this._peekToken(); if (t === null) this.rt.throwJava('NoSuchElementException', null); if (Number.isNaN(Number(t))) this.rt.throwJava('InputMismatchException', null); this.pos += t.length; return dbl(Number(t)); }
  nextBoolean() { const t = sv(this.next()); return t.toLowerCase() === 'true'; }
  hasNextLine() { return this.pos < this.text.length; }
  nextLine() {
    if (this.pos >= this.text.length) this.rt.throwJava('NoSuchElementException', 'No line found');
    const nl = this.text.indexOf('\n', this.pos);
    const line = nl < 0 ? this.text.slice(this.pos) : this.text.slice(this.pos, nl);
    this.pos = nl < 0 ? this.text.length : nl + 1;
    return new String(line.replace(/\r$/, ''));
  }
  close() {}
}

// ── Random (Java's 48-bit linear congruential generator) ──────────
export class Random extends LibObject {
  constructor(rt, seed) {
    super(rt);
    const s = seed === undefined ? 42n : asBig(seed);
    this.seed = (s ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
  }
  get _jname() { return 'Random'; }
  get _pkg() { return 'java.util'; }
  _next(bits) {
    this.seed = (this.seed * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n);
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }
  nextInt(bound, hi) {
    if (hi !== undefined) return bound + this.nextInt(hi - bound);
    if (bound === undefined) return this._next(32);
    if (bound <= 0) this.rt.throwJava('IllegalArgumentException', 'bound must be positive');
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this._next(31))) >> 31n);
    let bits, val;
    do { bits = this._next(31); val = bits % bound; } while (bits - val + (bound - 1) < 0 || bits - val + (bound - 1) > INT_MAX);
    return val;
  }
  nextDouble() { return dbl((this._next(26) * 134217728 + this._next(27)) * 2 ** -53); }
  nextBoolean() { return this._next(1) !== 0; }
  nextLong() { return BigInt.asIntN(64, (BigInt(this._next(32)) << 32n) + BigInt(this._next(32))); }
}

// ── System.out ────────────────────────────────────────────────────
export class PrintStream extends LibObject {
  constructor(rt, err) { super(rt); this.err = err; }
  get _jname() { return 'PrintStream'; }
  get _pkg() { return 'java.io'; }
  println(x) { this.rt.print((arguments.length ? this._s(x) : '') + '\n', this.err); }
  print(x) { this.rt.print(this._s(x), this.err); }
  printf(fmt, ...args) { this.rt.print(formatJava(this.rt, fmt, flatVarargs(args)), this.err); return this; }
  format(fmt, ...args) { return this.printf(fmt, ...args); }
  flush() {}
  _s(x) { return x instanceof JArray && x.t && x.t.name === 'char' && !x.t.dims ? x.a.map((c) => String.fromCharCode(c.c)).join('') : this.rt.str(x); }
}

function flatVarargs(args) { return args.length === 1 && args[0] instanceof JArray && args[0].t && args[0].t.name === 'Object' ? args[0].a : args; }

// ── strings ───────────────────────────────────────────────────────
const S = (x) => new String(x); // a string made at run time (its own identity)

export function stringMethod(rt, s0, name, args) {
  const s = sv(s0);
  const sidx = (i, n = s.length) => { if (typeof i !== 'number' || i < 0 || i >= n) rt.throwJava('StringIndexOutOfBoundsException', (name === 'charAt' ? 'Index ' + i + ' out of bounds for length ' : 'index ' + i + ', length ') + s.length); };
  const strArg = (k) => { const v = args[k]; if (v === null || v === undefined) rt.throwJava('NullPointerException', null); return v instanceof JChar ? String.fromCharCode(v.c) : sv(v); };
  switch (name) {
    case 'length': return s.length;
    case 'charAt': sidx(args[0]); return jchar(s.charCodeAt(args[0]));
    case 'codePointAt': sidx(args[0]); return s.codePointAt(args[0]);
    case 'isEmpty': return s.length === 0;
    case 'isBlank': return s.trim().length === 0;
    case 'substring': {
      const a = args[0], b = args.length > 1 ? args[1] : s.length;
      if (a < 0 || b > s.length || a > b) rt.throwJava('StringIndexOutOfBoundsException', 'begin ' + a + ', end ' + b + ', length ' + s.length);
      return S(s.slice(a, b));
    }
    case 'subSequence': return stringMethod(rt, s, 'substring', args);
    case 'indexOf': return s.indexOf(strArg(0), args[1] || 0);
    case 'lastIndexOf': return args.length > 1 ? s.lastIndexOf(strArg(0), args[1]) : s.lastIndexOf(strArg(0));
    case 'contains': return s.includes(strArg(0));
    case 'startsWith': return s.startsWith(strArg(0), args[1] || 0);
    case 'endsWith': return s.endsWith(strArg(0));
    case 'equals': return isStr(args[0]) && sv(args[0]) === s;
    case 'equalsIgnoreCase': return isStr(args[0]) && sv(args[0]).toLowerCase() === s.toLowerCase();
    case 'contentEquals': return rt.str(args[0]) === s;
    case 'compareTo': {
      const o = strArg(0);
      const n = Math.min(s.length, o.length);
      for (let i = 0; i < n; i++) { const d = s.charCodeAt(i) - o.charCodeAt(i); if (d) return d; }
      return s.length - o.length;
    }
    case 'compareToIgnoreCase': return stringMethod(rt, s.toLowerCase(), 'compareTo', [strArg(0).toLowerCase()]);
    case 'toUpperCase': return S(s.toUpperCase());
    case 'toLowerCase': return S(s.toLowerCase());
    case 'trim': return S(s.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, ''));
    case 'strip': return S(s.trim());
    case 'stripLeading': return S(s.trimStart());
    case 'stripTrailing': return S(s.trimEnd());
    case 'concat': return S(s + strArg(0));
    case 'repeat': if (args[0] < 0) rt.throwJava('IllegalArgumentException', 'count is negative: ' + args[0]); return S(s.repeat(args[0]));
    case 'replace': return S(s.split(strArg(0)).join(strArg(1)));
    case 'replaceAll': return S(s.replace(new RegExp(javaRegex(strArg(0)), 'g'), javaReplacement(strArg(1))));
    case 'replaceFirst': return S(s.replace(new RegExp(javaRegex(strArg(0))), javaReplacement(strArg(1))));
    case 'matches': return new RegExp('^(?:' + javaRegex(strArg(0)) + ')$').test(s);
    case 'split': {
      const re = new RegExp(javaRegex(strArg(0)), 'g');
      const limit = args.length > 1 ? args[1] : 0;
      let parts = [];
      if (s.length === 0) parts = [''];
      else {
        let last = 0, m;
        while ((m = re.exec(s)) !== null) {
          if (m[0].length === 0) { if (m.index >= s.length) break; if (m.index === 0) { re.lastIndex++; continue; } }
          if (limit > 0 && parts.length === limit - 1) break;
          if (!(m.index === 0 && m[0].length > 0 && last === 0 && parts.length === 0 && false)) parts.push(s.slice(last, m.index));
          last = m.index + m[0].length;
          if (m[0].length === 0) re.lastIndex++;
        }
        parts.push(s.slice(last));
        // a leading empty string from a zero-width match at 0 is removed by Java
        if (limit === 0) while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
        if (limit === 0 && parts.length === 1 && parts[0] === '' && s.length) parts = [];
      }
      return new JArray({ name: 'String', dims: 0 }, parts.map(S));
    }
    case 'toCharArray': return new JArray({ name: 'char', dims: 0 }, Array.from(s, (c) => jchar(c.charCodeAt(0))));
    case 'chars': rt.throwJava('UnsupportedOperationException', 'streams are not supported by the simulator'); break;
    case 'hashCode': return stringHash(s);
    case 'toString': return s0;
    case 'intern': return s;
    case 'formatted': return S(formatJava(rt, s, flatVarargs(args)));
    case 'lines': rt.throwJava('UnsupportedOperationException', 'streams are not supported by the simulator'); break;
    case 'getClass': return rt.classRefOf(s0);
    default: break;
  }
  return rt.noMethod('String', name, args);
}

function javaRegex(r) { return r.replace(/\\p\{Alpha\}/g, '[A-Za-z]').replace(/\\p\{Punct\}/g, '[!-\\/:-@\\[-`{-~]').replace(/\(\?<([a-zA-Z])/g, '(?<$1'); }
function javaReplacement(r) { return r.replace(/\$(\d)/g, '$$$1'); }

// methods on boxed values (Integer, Long, Double, Character, Boolean)
export function boxedMethod(rt, v, name, args) {
  const k = nkind(v);
  switch (name) {
    case 'equals': return javaEquals(v, args[0], rt);
    case 'hashCode': return javaHash(v, rt);
    case 'toString': return S(rt.str(v));
    case 'compareTo': case 'compare': {
      const o = args[0];
      if (o === null) rt.throwJava('NullPointerException', null);
      if (typeof v === 'boolean') return v === o ? 0 : v ? 1 : -1;
      if (k === 'c') return v.c - o.c;
      const a = toNumber(v), b = toNumber(o);
      if (k === 'l') { const x = asBig(v), y = asBig(o); return x < y ? -1 : x > y ? 1 : 0; }
      return a < b ? -1 : a > b ? 1 : 0;
    }
    case 'intValue': return k === 'l' ? Number(BigInt.asIntN(32, v)) : Math.trunc(toNumber(v)) | 0;
    case 'longValue': return asBig(v);
    case 'doubleValue': case 'floatValue': return dbl(toNumber(v));
    case 'shortValue': return (toNumber(v) << 16) >> 16;
    case 'byteValue': return (toNumber(v) << 24) >> 24;
    case 'charValue': return v;
    case 'booleanValue': return v;
    case 'isNaN': return Number.isNaN(toNumber(v));
    case 'getClass': return rt.classRefOf(v);
    default: break;
  }
  return rt.noMethod(rt.className(v), name, args);
}

// ── static methods ────────────────────────────────────────────────
const num = (v) => toNumber(v);
function chk(rt, v) { if (v === null || v === undefined) rt.throwJava('NullPointerException', null); return v; }
const isUpper = (c) => { const s = String.fromCharCode(c); return s !== s.toLowerCase() && s === s.toUpperCase(); };
const isLower = (c) => { const s = String.fromCharCode(c); return s !== s.toUpperCase() && s === s.toLowerCase(); };
const ch = (v) => (v instanceof JChar ? v.c : num(v));

function arrayOf(rt, v) {
  chk(rt, v);
  if (!(v instanceof JArray)) rt.throwJava('ClassCastException', 'not an array');
  return v;
}
function rangeCheck(rt, len, from, to) {
  if (from > to) rt.throwJava('IllegalArgumentException', 'fromIndex(' + from + ') > toIndex(' + to + ')');
  if (from < 0) rt.throwJava('ArrayIndexOutOfBoundsException', 'Array index out of range: ' + from);
  if (to > len) rt.throwJava('ArrayIndexOutOfBoundsException', 'Array index out of range: ' + to);
}
function defaultFor(t) {
  if (t.dims) return null;
  switch (t.name) {
    case 'int': case 'short': case 'byte': return 0;
    case 'long': return 0n;
    case 'double': case 'float': return dbl(0);
    case 'char': return jchar(0);
    case 'boolean': return false;
    default: return null;
  }
}

function arraysToString(rt, a) {
  if (a === null) return 'null';
  return listString(rt, a.a);
}
function deepToString(rt, a) {
  if (a === null) return 'null';
  return '[' + a.a.map((x) => (x instanceof JArray ? deepToString(rt, x) : rt.str(x))).join(', ') + ']';
}

export const STATIC_FIELDS = {
  Integer: { MAX_VALUE: INT_MAX, MIN_VALUE: INT_MIN, SIZE: 32 },
  Long: { MAX_VALUE: LONG_MAX, MIN_VALUE: LONG_MIN, SIZE: 64 },
  Double: { MAX_VALUE: dbl(Number.MAX_VALUE), MIN_VALUE: dbl(Number.MIN_VALUE), POSITIVE_INFINITY: dbl(Infinity), NEGATIVE_INFINITY: dbl(-Infinity), NaN: dbl(NaN) },
  Float: { MAX_VALUE: dbl(3.4028234663852886e38), MIN_VALUE: dbl(1.401298464324817e-45), POSITIVE_INFINITY: dbl(Infinity), NEGATIVE_INFINITY: dbl(-Infinity), NaN: dbl(NaN) },
  Short: { MAX_VALUE: 32767, MIN_VALUE: -32768 },
  Byte: { MAX_VALUE: 127, MIN_VALUE: -128 },
  Character: { MAX_VALUE: jchar(0xFFFF), MIN_VALUE: jchar(0) },
  Boolean: { TRUE: true, FALSE: false },
  Math: { PI: dbl(Math.PI), E: dbl(Math.E) },
};

const mathOverflow = (rt, k) => rt.throwJava('ArithmeticException', k === 'l' ? 'long overflow' : 'integer overflow');

export const STATICS = {
  Math: {
    abs: (rt, [a]) => { const k = kindOf(a); if (k === 'd') return dbl(Math.abs(a.v)); if (k === 'l') return BigInt.asIntN(64, a < 0n ? -a : a); return Math.abs(ch(a)) | 0; },
    max: (rt, [a, b]) => { const k = kindOf(a, b); if (k === 'l') { const x = asBig(a), y = asBig(b); return x > y ? x : y; } return mk(k, Math.max(num(a), num(b))); },
    min: (rt, [a, b]) => { const k = kindOf(a, b); if (k === 'l') { const x = asBig(a), y = asBig(b); return x < y ? x : y; } return mk(k, Math.min(num(a), num(b))); },
    pow: (rt, [a, b]) => dbl(Math.pow(num(a), num(b))),
    sqrt: (rt, [a]) => dbl(Math.sqrt(num(a))),
    cbrt: (rt, [a]) => dbl(Math.cbrt(num(a))),
    floor: (rt, [a]) => dbl(Math.floor(num(a))),
    ceil: (rt, [a]) => dbl(Math.ceil(num(a))),
    rint: (rt, [a]) => { const x = num(a); const r = Math.round(x); return dbl(Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r); },
    round: (rt, [a]) => { const r = Math.floor(num(a) + 0.5); return nkind(a) === 'd' ? BigInt(Number.isFinite(r) ? r : 0) : r | 0; },
    random: (rt) => rt.random().nextDouble(),
    log: (rt, [a]) => dbl(Math.log(num(a))),
    log10: (rt, [a]) => dbl(Math.log10(num(a))),
    exp: (rt, [a]) => dbl(Math.exp(num(a))),
    sin: (rt, [a]) => dbl(Math.sin(num(a))),
    cos: (rt, [a]) => dbl(Math.cos(num(a))),
    tan: (rt, [a]) => dbl(Math.tan(num(a))),
    atan: (rt, [a]) => dbl(Math.atan(num(a))),
    atan2: (rt, [a, b]) => dbl(Math.atan2(num(a), num(b))),
    hypot: (rt, [a, b]) => dbl(Math.hypot(num(a), num(b))),
    signum: (rt, [a]) => dbl(Math.sign(num(a))),
    toRadians: (rt, [a]) => dbl(num(a) * Math.PI / 180),
    toDegrees: (rt, [a]) => dbl(num(a) * 180 / Math.PI),
    floorDiv: (rt, [a, b]) => { const k = kindOf(a, b); if (num(b) === 0) rt.throwJava('ArithmeticException', '/ by zero'); if (k === 'l') { const x = asBig(a), y = asBig(b); let q = x / y; if ((x % y !== 0n) && ((x < 0n) !== (y < 0n))) q--; return q; } return Math.floor(num(a) / num(b)) | 0; },
    floorMod: (rt, [a, b]) => { const k = kindOf(a, b); if (num(b) === 0) rt.throwJava('ArithmeticException', '/ by zero'); if (k === 'l') { const x = asBig(a), y = asBig(b); return ((x % y) + y) % y; } const x = num(a), y = num(b); return (((x % y) + y) % y) | 0; },
    addExact: (rt, [a, b]) => { const k = kindOf(a, b); if (k === 'l') { const r = asBig(a) + asBig(b); if (r !== BigInt.asIntN(64, r)) mathOverflow(rt, k); return r; } const r = num(a) + num(b); if (r !== (r | 0)) mathOverflow(rt, k); return r; },
    subtractExact: (rt, [a, b]) => { const k = kindOf(a, b); if (k === 'l') { const r = asBig(a) - asBig(b); if (r !== BigInt.asIntN(64, r)) mathOverflow(rt, k); return r; } const r = num(a) - num(b); if (r !== (r | 0)) mathOverflow(rt, k); return r; },
    multiplyExact: (rt, [a, b]) => { const k = kindOf(a, b); if (k === 'l') { const r = asBig(a) * asBig(b); if (r !== BigInt.asIntN(64, r)) mathOverflow(rt, k); return r; } const r = num(a) * num(b); if (r !== (r | 0)) mathOverflow(rt, k); return r; },
    toIntExact: (rt, [a]) => { const r = asBig(a); if (r !== BigInt.asIntN(32, r)) mathOverflow(rt, 'i'); return Number(r); },
  },
  Integer: {
    parseInt: (rt, [s, r]) => parseIntJava(rt, s, r || 10),
    valueOf: (rt, [s, r]) => (isStr(s) ? parseIntJava(rt, s, r || 10) : ch(s) | 0),
    toString: (rt, [i, r]) => S(r ? (i | 0).toString(r) : String(i)),
    compare: (rt, [a, b]) => (a < b ? -1 : a > b ? 1 : 0),
    max: (rt, [a, b]) => Math.max(a, b),
    min: (rt, [a, b]) => Math.min(a, b),
    sum: (rt, [a, b]) => (a + b) | 0,
    signum: (rt, [a]) => Math.sign(a),
    abs: (rt, [a]) => Math.abs(a) | 0,
    bitCount: (rt, [a]) => { let n = 0, x = a >>> 0; while (x) { n += x & 1; x >>>= 1; } return n; },
    toBinaryString: (rt, [a]) => S((a >>> 0).toString(2)),
    toHexString: (rt, [a]) => S((a >>> 0).toString(16)),
    toOctalString: (rt, [a]) => S((a >>> 0).toString(8)),
    hashCode: (rt, [a]) => a | 0,
  },
  Long: {
    parseLong: (rt, [s]) => parseIntJava(rt, s, 10, true),
    valueOf: (rt, [s]) => (isStr(s) ? parseIntJava(rt, s, 10, true) : asBig(s)),
    toString: (rt, [i]) => S(String(i)),
    compare: (rt, [a, b]) => { const x = asBig(a), y = asBig(b); return x < y ? -1 : x > y ? 1 : 0; },
    max: (rt, [a, b]) => { const x = asBig(a), y = asBig(b); return x > y ? x : y; },
    min: (rt, [a, b]) => { const x = asBig(a), y = asBig(b); return x < y ? x : y; },
    sum: (rt, [a, b]) => BigInt.asIntN(64, asBig(a) + asBig(b)),
    abs: (rt, [a]) => BigInt.asIntN(64, asBig(a) < 0n ? -asBig(a) : asBig(a)),
  },
  Double: {
    parseDouble: (rt, [s]) => parseDoubleJava(rt, s),
    valueOf: (rt, [s]) => (isStr(s) ? parseDoubleJava(rt, s) : dbl(num(s))),
    toString: (rt, [d]) => S(doubleToString(num(d))),
    compare: (rt, [a, b]) => { const x = num(a), y = num(b); return x < y ? -1 : x > y ? 1 : 0; },
    isNaN: (rt, [a]) => Number.isNaN(num(a)),
    isInfinite: (rt, [a]) => Math.abs(num(a)) === Infinity,
    max: (rt, [a, b]) => dbl(Math.max(num(a), num(b))),
    min: (rt, [a, b]) => dbl(Math.min(num(a), num(b))),
    sum: (rt, [a, b]) => dbl(num(a) + num(b)),
  },
  Float: {
    parseFloat: (rt, [s]) => dbl(Math.fround(parseDoubleJava(rt, s).v)),
    valueOf: (rt, [s]) => (isStr(s) ? dbl(Math.fround(parseDoubleJava(rt, s).v)) : dbl(Math.fround(num(s)))),
    compare: (rt, [a, b]) => { const x = num(a), y = num(b); return x < y ? -1 : x > y ? 1 : 0; },
  },
  Boolean: {
    parseBoolean: (rt, [s]) => s !== null && sv(s).toLowerCase() === 'true',
    valueOf: (rt, [s]) => (typeof s === 'boolean' ? s : s !== null && sv(s).toLowerCase() === 'true'),
    toString: (rt, [b]) => S(String(b)),
    compare: (rt, [a, b]) => (a === b ? 0 : a ? 1 : -1),
    logicalAnd: (rt, [a, b]) => a && b,
    logicalOr: (rt, [a, b]) => a || b,
    logicalXor: (rt, [a, b]) => a !== b,
  },
  Character: {
    isDigit: (rt, [c]) => /\p{Nd}/u.test(String.fromCharCode(ch(c))),
    isLetter: (rt, [c]) => /\p{L}/u.test(String.fromCharCode(ch(c))),
    isLetterOrDigit: (rt, [c]) => /[\p{L}\p{Nd}]/u.test(String.fromCharCode(ch(c))),
    isAlphabetic: (rt, [c]) => /\p{Alphabetic}/u.test(String.fromCharCode(ch(c))),
    isUpperCase: (rt, [c]) => isUpper(ch(c)),
    isLowerCase: (rt, [c]) => isLower(ch(c)),
    isWhitespace: (rt, [c]) => /[\t\n\u000B\f\r\u001C-\u001F ]/.test(String.fromCharCode(ch(c))),
    isSpaceChar: (rt, [c]) => /\p{Zs}/u.test(String.fromCharCode(ch(c))),
    toUpperCase: (rt, [c]) => { const r = String.fromCharCode(ch(c)).toUpperCase(); return c instanceof JChar ? jchar(r.length === 1 ? r.charCodeAt(0) : ch(c)) : r.charCodeAt(0); },
    toLowerCase: (rt, [c]) => { const r = String.fromCharCode(ch(c)).toLowerCase(); return c instanceof JChar ? jchar(r.length === 1 ? r.charCodeAt(0) : ch(c)) : r.charCodeAt(0); },
    getNumericValue: (rt, [c]) => { const x = ch(c); const s = String.fromCharCode(x); if (/[0-9]/.test(s)) return x - 48; if (/[a-zA-Z]/.test(s)) return s.toLowerCase().charCodeAt(0) - 87; return -1; },
    digit: (rt, [c, r]) => { const v = parseInt(String.fromCharCode(ch(c)), r); return Number.isNaN(v) ? -1 : v; },
    forDigit: (rt, [d, r]) => (d >= 0 && d < r ? jchar(d.toString(r).charCodeAt(0)) : jchar(0)),
    valueOf: (rt, [c]) => c,
    toString: (rt, [c]) => S(String.fromCharCode(ch(c))),
    compare: (rt, [a, b]) => ch(a) - ch(b),
    toChars: (rt, [c]) => new JArray({ name: 'char', dims: 0 }, [jchar(c)]),
    isDefined: () => true,
  },
  String: {
    valueOf: (rt, [x, off, count]) => {
      if (x instanceof JArray) { let cs = x.a; if (off !== undefined) cs = cs.slice(off, off + count); return S(cs.map((c) => String.fromCharCode(c.c)).join('')); }
      return S(rt.str(x));
    },
    copyValueOf: (rt, [x]) => S(x.a.map((c) => String.fromCharCode(c.c)).join('')),
    join: (rt, [sep, ...rest]) => {
      const items = rest.length === 1 && (rest[0] instanceof JArray || (rest[0] && typeof rest[0]._items === 'function')) ? toArray(rt, rest[0]) : rest;
      return S(items.map((x) => rt.str(x)).join(sv(sep)));
    },
    format: (rt, [fmt, ...args]) => S(formatJava(rt, fmt, flatVarargs(args))),
  },
  Objects: {
    equals: (rt, [a, b]) => (a === null ? b === null : rt.equals(a, b)),
    hash: (rt, args) => { const xs = flatVarargs(args); let h = 1; for (const x of xs) h = (Math.imul(31, h) + rt.hash(x)) | 0; return h; },
    hashCode: (rt, [a]) => (a === null ? 0 : rt.hash(a)),
    isNull: (rt, [a]) => a === null,
    nonNull: (rt, [a]) => a !== null,
    toString: (rt, [a, d]) => S(a === null && d !== undefined ? rt.str(d) : rt.str(a)),
    requireNonNull: (rt, [a, msg]) => { if (a === null) rt.throwJava('NullPointerException', msg === undefined ? null : rt.str(msg)); return a; },
    requireNonNullElse: (rt, [a, d]) => (a === null ? d : a),
    compare: (rt, [a, b, c]) => (a === b ? 0 : rt.intOf(rt.callFn(c, 'compare', [a, b]))),
  },
  System: {
    currentTimeMillis: (rt) => BigInt(rt.clock()),
    nanoTime: (rt) => BigInt(rt.clock()) * 1000000n,
    arraycopy: (rt, [src, sp, dst, dp, len]) => {
      arrayOf(rt, src); arrayOf(rt, dst);
      if (sp < 0 || dp < 0 || len < 0 || sp + len > src.a.length || dp + len > dst.a.length) rt.throwJava('ArrayIndexOutOfBoundsException', 'arraycopy: last source index ' + (sp + len) + ' out of bounds for length ' + src.a.length);
      const tmp = src.a.slice(sp, sp + len);
      for (let i = 0; i < len; i++) rt.arraySet(dst, dp + i, tmp[i]);
    },
    exit: (rt, [code]) => rt.exit(code),
    lineSeparator: () => '\n',
    identityHashCode: (rt, [o]) => (o === null ? 0 : o.hash || 0),
  },
  Thread: { sleep: () => undefined },
  Arrays: {
    toString: (rt, [a]) => S(arraysToString(rt, a)),
    deepToString: (rt, [a]) => S(deepToString(rt, a)),
    sort: (rt, args) => {
      const a = arrayOf(rt, args[0]);
      let from = 0, to = a.a.length, cmp = null;
      if (args.length === 2) cmp = args[1];
      if (args.length >= 3) { from = args[1]; to = args[2]; cmp = args[3] || null; rangeCheck(rt, a.a.length, from, to); }
      const part = a.a.slice(from, to);
      rt.sortArray(part, cmp);
      for (let i = 0; i < part.length; i++) rt.arraySet(a, from + i, part[i]);
    },
    fill: (rt, args) => {
      const a = arrayOf(rt, args[0]);
      let from = 0, to = a.a.length, v = args[1];
      if (args.length === 4) { from = args[1]; to = args[2]; v = args[3]; rangeCheck(rt, a.a.length, from, to); }
      for (let i = from; i < to; i++) rt.arraySet(a, i, v);
    },
    copyOf: (rt, [a, n]) => { arrayOf(rt, a); if (n < 0) rt.throwJava('NegativeArraySizeException', String(n)); const out = a.a.slice(0, n); while (out.length < n) out.push(defaultFor(a.t)); return new JArray(a.t, out); },
    copyOfRange: (rt, [a, from, to]) => { arrayOf(rt, a); if (from < 0 || from > a.a.length) rt.throwJava('ArrayIndexOutOfBoundsException', 'Array index out of range: ' + from); if (from > to) rt.throwJava('IllegalArgumentException', from + ' > ' + to); const out = a.a.slice(from, to); while (out.length < to - from) out.push(defaultFor(a.t)); return new JArray(a.t, out); },
    asList: (rt, args) => new JList(rt, 'Arrays$ArrayList', args.length === 1 && args[0] instanceof JArray && !['int', 'long', 'double', 'char', 'boolean', 'short', 'byte', 'float'].includes(args[0].t.name) ? args[0].a.slice() : args.slice()),
    equals: (rt, [a, b]) => a === b || (a !== null && b !== null && a.a.length === b.a.length && a.a.every((x, i) => (x === null ? b.a[i] === null : rt.equals(x, b.a[i])))),
    deepEquals: (rt, [a, b]) => { const eq = (x, y) => (x instanceof JArray && y instanceof JArray ? x.a.length === y.a.length && x.a.every((v, i) => eq(v, y.a[i])) : x === null ? y === null : rt.equals(x, y)); return eq(a, b); },
    hashCode: (rt, [a]) => { if (a === null) return 0; let h = 1; for (const x of a.a) h = (Math.imul(31, h) + rt.hash(x)) | 0; return h; },
    binarySearch: (rt, [a, k]) => { let lo = 0, hi = a.a.length - 1; while (lo <= hi) { const mid = (lo + hi) >>> 1; const c = rt.compare(a.a[mid], k); if (c < 0) lo = mid + 1; else if (c > 0) hi = mid - 1; else return mid; } return -(lo + 1); },
    stream: (rt) => rt.throwJava('UnsupportedOperationException', 'streams are not supported by the simulator'),
  },
  Collections: {
    sort: (rt, [l, cmp]) => l.sort(cmp === undefined ? null : cmp),
    reverse: (rt, [l]) => { const a = toArray(rt, l).reverse(); for (let i = 0; i < a.length; i++) l.set(i, a[i]); },
    swap: (rt, [l, i, j]) => { const t = l.get(i); l.set(i, l.get(j)); l.set(j, t); },
    max: (rt, [c, cmp]) => { const a = toArray(rt, c); if (!a.length) rt.throwJava('NoSuchElementException', null); return a.reduce((m, x) => ((cmp ? rt.intOf(rt.callFn(cmp, 'compare', [x, m])) : rt.compare(x, m)) > 0 ? x : m)); },
    min: (rt, [c, cmp]) => { const a = toArray(rt, c); if (!a.length) rt.throwJava('NoSuchElementException', null); return a.reduce((m, x) => ((cmp ? rt.intOf(rt.callFn(cmp, 'compare', [x, m])) : rt.compare(x, m)) < 0 ? x : m)); },
    frequency: (rt, [c, x]) => toArray(rt, c).filter((y) => (x === null ? y === null : rt.equals(x, y))).length,
    shuffle: (rt, [l, rnd]) => { const r = rnd || rt.random(); const a = toArray(rt, l); for (let i = a.length - 1; i > 0; i--) { const j = r.nextInt(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } for (let i = 0; i < a.length; i++) l.set(i, a[i]); },
    unmodifiableList: (rt, [l]) => new JList(rt, 'ArrayList', toArray(rt, l), { immutable: true }),
    unmodifiableSet: (rt, [s]) => JSet.fromItems(rt, toArray(rt, s), 'linked', { immutable: true }),
    emptyList: (rt) => new JList(rt, 'ArrayList', [], { immutable: true }),
    emptySet: (rt) => JSet.fromItems(rt, [], 'linked', { immutable: true }),
    emptyMap: (rt) => new JMap(rt, 'linked', { immutable: true }),
    singletonList: (rt, [x]) => new JList(rt, 'ArrayList', [x], { immutable: true }),
    nCopies: (rt, [n, x]) => new JList(rt, 'ArrayList', Array(n).fill(x), { immutable: true }),
    addAll: (rt, [c, ...xs]) => { let ch2 = false; for (const x of flatVarargs(xs)) if (c.add(x) !== false) ch2 = true; return ch2; },
    reverseOrder: (rt, [cmp]) => rt.makeComparator((a, b) => (cmp ? rt.intOf(rt.callFn(cmp, 'compare', [b, a])) : rt.compare(b, a))),
  },
  List: {
    of: (rt, args) => { const xs = flatVarargsAny(args); for (const x of xs) chk(rt, x); return new JList(rt, 'ArrayList', xs, { immutable: true }); },
    copyOf: (rt, [c]) => new JList(rt, 'ArrayList', toArray(rt, c), { immutable: true }),
  },
  Set: {
    of: (rt, args) => {
      const xs = flatVarargsAny(args);
      const s = JSet.fromItems(rt, [], 'linked');
      for (const x of xs) { chk(rt, x); if (!s.add(x)) rt.throwJava('IllegalArgumentException', 'duplicate element: ' + rt.str(x)); }
      s.immutable = true;
      return s;
    },
    copyOf: (rt, [c]) => JSet.fromItems(rt, toArray(rt, c), 'linked', { immutable: true }),
  },
  Map: {
    of: (rt, args) => {
      const m = new JMap(rt, 'linked');
      for (let i = 0; i + 1 < args.length; i += 2) { chk(rt, args[i]); if (m.containsKey(args[i])) rt.throwJava('IllegalArgumentException', 'duplicate key: ' + rt.str(args[i])); m.put(args[i], args[i + 1]); }
      m.immutable = true;
      return m;
    },
    entry: (rt, [k, v]) => { const m = new JMap(rt, 'linked'); m.put(k, v); const e = m._entries()[0]; e.map = null; return e; },
  },
  Comparator: {
    naturalOrder: (rt) => rt.makeComparator((a, b) => rt.compare(a, b)),
    reverseOrder: (rt) => rt.makeComparator((a, b) => rt.compare(b, a)),
    comparing: (rt, [key, cmp]) => rt.makeComparator((a, b) => { const x = rt.callFn(key, 'apply', [a]), y = rt.callFn(key, 'apply', [b]); return cmp ? rt.intOf(rt.callFn(cmp, 'compare', [x, y])) : rt.compare(x, y); }),
    comparingInt: (rt, [key]) => rt.makeComparator((a, b) => rt.compare(rt.callFn(key, 'applyAsInt', [a]), rt.callFn(key, 'applyAsInt', [b]))),
    comparingDouble: (rt, [key]) => rt.makeComparator((a, b) => rt.compare(rt.callFn(key, 'applyAsDouble', [a]), rt.callFn(key, 'applyAsDouble', [b]))),
  },
};
for (const [box, k] of [['Boolean', 0], ['Double', 0], ['Long', 0], ['Character', 0], ['Float', 0], ['Integer', 0]]) {
  void k;
  STATICS[box].hashCode = (rt, [v]) => javaHash(v, rt);
  if (!STATICS[box].toString) STATICS[box].toString = (rt, [v]) => S(rt.str(v));
}
STATICS.Short = { parseShort: (rt, [s]) => parseIntJava(rt, s), valueOf: (rt, [s]) => (isStr(s) ? parseIntJava(rt, s) : s) };
STATICS.Byte = { parseByte: (rt, [s]) => parseIntJava(rt, s), valueOf: (rt, [s]) => (isStr(s) ? parseIntJava(rt, s) : s) };
STATICS.StrictMath = STATICS.Math;

function flatVarargsAny(args) { return args.length === 1 && args[0] instanceof JArray && !['int', 'long', 'double', 'char', 'boolean'].includes(args[0].t.name) ? args[0].a.slice() : args.slice(); }

export { parseIntJava, defaultFor, JIterator, JDouble };
