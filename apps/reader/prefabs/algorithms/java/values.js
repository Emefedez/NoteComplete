// Java subset: runtime values.
//
//   int, short, byte  → JS number (always a 32-bit integer)
//   long              → BigInt (kept in 64 bits)
//   double, float     → JDouble { v }   (so 5.0 / 2 stays a double division)
//   char              → JChar { c }     (cached: one object per code unit)
//   boolean           → JS boolean
//   String            → JS string for literals (interned) or a String object for strings made
//                       at run time, so == compares references like Java while equals() compares
//                       the text
//   arrays            → JArray { t: element type, a: [] }
//   objects           → JObject { cls, f: fields } (user classes) or a library object (lib/*.js)

export class JDouble {
  constructor(v, isFloat) { this.v = v; if (isFloat) this.f = true; }
}

export class JChar {
  constructor(c) { this.c = c; }
}
const charCache = new Map();
export function jchar(code) {
  code &= 0xFFFF;
  let ch = charCache.get(code);
  if (!ch) { ch = new JChar(code); charCache.set(code, ch); }
  return ch;
}

export const dbl = (v) => new JDouble(v);
export const flt = (v) => new JDouble(Math.fround(v), true);

let nextId = 1;
export function newIdentity() {
  const id = nextId++;
  // Java identity hash codes look random; this keeps them deterministic per run
  let h = Math.imul(id ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return { id, hash: h & 0x7fffffff };
}
export function resetIdentities() { nextId = 1; }

export class JArray {
  constructor(t, a) {
    this.t = t; // element type node ({ name, dims })
    this.a = a;
    const ident = newIdentity();
    this.id = ident.id;
    this.hash = ident.hash;
    this._sid = null; // structure id when tracked
    this._owner = null; // outer tracked matrix
  }
}

export class JObject {
  constructor(cls) {
    this.cls = cls;
    this.f = Object.create(null);
    const ident = newIdentity();
    this.id = ident.id;
    this.hash = ident.hash;
    this.outer = null;
  }
}

// a lambda or method reference (functional interface instance)
export class JLambda {
  constructor(params, body, expr, scope, frame, line) {
    this.params = params;
    this.body = body;
    this.expr = expr;
    this.scope = scope;
    this.frame = frame;
    this.line = line;
    const ident = newIdentity();
    this.id = ident.id;
    this.hash = ident.hash;
  }
}

// a reference to a class used as a value (static access target, X.class)
export class ClassRef {
  constructor(cls, lib) { this.cls = cls; this.lib = lib; }
}

export const isStr = (v) => typeof v === 'string' || v instanceof String;
export const sv = (v) => (typeof v === 'string' ? v : v.valueOf());

// numeric kind: i int, l long, d double, c char
export function nkind(v) {
  if (typeof v === 'number') return 'i';
  if (typeof v === 'bigint') return 'l';
  if (v instanceof JDouble) return 'd';
  if (v instanceof JChar) return 'c';
  return null;
}
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof JDouble) return v.v;
  if (v instanceof JChar) return v.c;
  return NaN;
}

// Java's Double.toString
export function doubleToString(d) {
  if (Number.isNaN(d)) return 'NaN';
  if (d === Infinity) return 'Infinity';
  if (d === -Infinity) return '-Infinity';
  if (d === 0) return Object.is(d, -0) ? '-0.0' : '0.0';
  const a = Math.abs(d);
  if (a >= 1e-3 && a < 1e7) {
    const s = String(d);
    return s.includes('.') ? s : s + '.0';
  }
  // scientific: 1.0E10, 1.234E-5
  let s = d.toExponential(); // "1.234e-5"
  let [m, e] = s.split('e');
  if (!m.includes('.')) m += '.0';
  return m + 'E' + (e.startsWith('+') ? e.slice(1) : e);
}

// Java's Float.toString: the shortest decimal that reads back as the same float
export function floatToString(d) {
  if (!Number.isFinite(d) || d === 0) return doubleToString(d);
  for (let p = 1; p <= 9; p++) {
    const s = d.toPrecision(p);
    if (Math.fround(Number(s)) === d) return doubleToString(Number(s));
  }
  return doubleToString(d);
}

// Java's String.valueOf / implicit toString in concatenation. User objects are handed to `user`
// (the interpreter, which may call their toString()).
export function jstr(v, user) {
  if (v === null || v === undefined) return 'null';
  switch (typeof v) {
    case 'string': return v;
    case 'number': return String(v);
    case 'bigint': return v.toString();
    case 'boolean': return v ? 'true' : 'false';
    default: break;
  }
  if (v instanceof String) return v.valueOf();
  if (v instanceof JDouble) return v.f ? floatToString(v.v) : doubleToString(v.v);
  if (v instanceof JChar) return String.fromCharCode(v.c);
  if (v instanceof JArray) return arrayTypeCode(v) + '@' + v.hash.toString(16);
  if (v instanceof JLambda) return 'Lambda$' + v.id + '@' + v.hash.toString(16);
  if (v instanceof ClassRef) return (v.cls ? (v.cls.isInterface ? 'interface ' : 'class ') + v.cls.fullName : 'class ' + v.lib);
  if (user && v instanceof JObject) return user(v);
  if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) return v.toString();
  if (v instanceof JObject) return v.cls.name + '@' + v.hash.toString(16);
  return String(v);
}

function arrayTypeCode(arr) {
  const codes = { int: 'I', long: 'J', double: 'D', float: 'F', char: 'C', boolean: 'Z', byte: 'B', short: 'S' };
  const t = arr.t || { name: 'Object', dims: 0 };
  const inner = codes[t.name] && !t.dims ? codes[t.name] : 'L' + (t.name === 'String' ? 'java.lang.String' : t.name) + ';';
  return '['.repeat((t.dims || 0) + 1) + inner;
}

// ── hashing and equality (as Java's equals/hashCode) ───────────────
export function stringHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
export function doubleHash(d) {
  if (d === 0 && !Object.is(d, -0)) return 0;
  f64[0] = Number.isNaN(d) ? NaN : d;
  // little-endian: u32[0] low, u32[1] high
  return (u32[0] ^ u32[1]) | 0;
}
export function longHash(b) {
  const x = BigInt.asUintN(64, b);
  return Number(BigInt.asIntN(32, x ^ (x >> 32n)));
}

// `rt` gives access to user-defined equals/hashCode (and to library objects' own methods)
export function javaHash(v, rt) {
  if (v === null || v === undefined) return 0;
  switch (typeof v) {
    case 'string': return stringHash(v);
    case 'number': return v | 0;
    case 'bigint': return longHash(v);
    case 'boolean': return v ? 1231 : 1237;
    default: break;
  }
  if (v instanceof String) return stringHash(v.valueOf());
  if (v instanceof JChar) return v.c;
  if (v instanceof JDouble) return doubleHash(v.v);
  if (v instanceof JObject) return rt ? rt.userHash(v) : v.hash;
  if (v instanceof JArray || v instanceof JLambda) return v.hash;
  if (typeof v.hashCode === 'function') return v.hashCode() | 0;
  return 0;
}

export function javaEquals(a, b, rt) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (isStr(a)) return isStr(b) && sv(a) === sv(b);
  const ka = nkind(a);
  if (ka) {
    // boxed equals: same box type and same value
    const kb = nkind(b);
    if (ka !== kb) return false;
    if (ka === 'd') return a.v === b.v || (Number.isNaN(a.v) && Number.isNaN(b.v));
    if (ka === 'c') return a.c === b.c;
    return a === b;
  }
  if (typeof a === 'boolean') return a === b;
  if (a instanceof JObject) return rt ? rt.userEquals(a, b) : false;
  if (a instanceof JArray || a instanceof JLambda) return false;
  if (typeof a.equals === 'function') return a.equals(b);
  return false;
}

// natural ordering (Comparable.compareTo)
export function javaCompare(a, b, rt) {
  if (a === null || a === undefined || b === null || b === undefined) {
    if (rt) rt.throwJava('NullPointerException', 'Cannot invoke "Comparable.compareTo(Object)" because a value is null');
    throw new Error('null compare');
  }
  if (isStr(a) && isStr(b)) {
    const x = sv(a), y = sv(b);
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) { const d = x.charCodeAt(i) - y.charCodeAt(i); if (d) return d; }
    return x.length - y.length;
  }
  const ka = nkind(a), kb = nkind(b);
  if (ka && kb) {
    if (ka === 'l' || kb === 'l') { const x = BigInt(ka === 'l' ? a : Math.trunc(toNumber(a))), y = BigInt(kb === 'l' ? b : Math.trunc(toNumber(b))); return x < y ? -1 : x > y ? 1 : 0; }
    if (ka === 'c' && kb === 'c') return a.c - b.c;
    const x = toNumber(a), y = toNumber(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  if (a instanceof JObject) {
    if (!rt) throw new Error('compareTo needs the runtime');
    return rt.userCompare(a, b);
  }
  if (typeof a.compareTo === 'function') return a.compareTo(b);
  if (rt) rt.throwJava('ClassCastException', 'class ' + rt.className(a) + ' cannot be cast to class java.lang.Comparable');
  throw new Error('not comparable');
}
