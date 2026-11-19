// Java subset: the parser. A recursive-descent parser over the lexer's tokens that builds a
// small AST (plain objects with `k` for the kind, and `line`/`col` of their first token).
// Generics are parsed and kept on type nodes (the interpreter erases them); annotations are
// skipped. Errors are CompileError with the line and column of the offending token.

import { tokenize, CompileError } from './lexer.js';

const PRIMS = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'char', 'boolean']);
const MODS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'native',
  'synchronized', 'transient', 'volatile', 'strictfp', 'default', 'sealed', 'non-sealed']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']);
const BIN_PREC = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7, instanceof: 7,
  '<<': 8, '>>': 8, '>>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};

export function parse(src, file) {
  const p = new Parser(tokenize(src, file), file);
  return p.unit();
}

// Parses a single expression (used for `{ $java: "..." }` arguments).
export function parseExpression(src, file) {
  const p = new Parser(tokenize(src, file), file);
  const e = p.expr();
  p.expect('eof');
  return e;
}

class Parser {
  constructor(toks, file) {
    this.toks = toks;
    this.i = 0;
    this.file = file;
  }

  // ── token helpers ────────────────────────────────────────────────
  get tok() { return this.toks[this.i]; }
  peek(k = 1) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
  is(v, t) { const x = this.tok; return x.v === v && (t ? x.t === t : x.t === 'op' || x.t === 'kw'); }
  isOp(v) { return this.tok.t === 'op' && this.tok.v === v; }
  isKw(v) { return this.tok.t === 'kw' && this.tok.v === v; }
  isId(v) { return this.tok.t === 'id' && (v === undefined || this.tok.v === v); }
  next() { const t = this.tok; if (this.i < this.toks.length - 1) this.i++; return t; }
  eat(v) { if (this.tok.v === v && (this.tok.t === 'op' || this.tok.t === 'kw')) { return this.next(); } return null; }
  err(msg, t = this.tok) { throw new CompileError(msg, t.line, t.col, this.file); }
  expect(v) {
    if (v === 'eof') { if (this.tok.t !== 'eof') this.err("unexpected '" + this.tok.v + "'"); return this.tok; }
    if (this.tok.v === v && (this.tok.t === 'op' || this.tok.t === 'kw')) return this.next();
    // a ">>" closing two generic lists: split it
    if (v === '>' && this.tok.t === 'op' && (this.tok.v === '>>' || this.tok.v === '>>>' || this.tok.v === '>=' || this.tok.v === '>>=')) {
      const t = this.tok;
      this.toks[this.i] = { ...t, v: t.v.slice(1), col: t.col + 1 };
      return { ...t, v: '>' };
    }
    // like javac, a missing ; ) ] is reported just after the previous token
    if (this.i > 0 && [';', ')', ']'].includes(v)) {
      const prev = this.toks[this.i - 1];
      throw new CompileError("'" + v + "' expected", prev.line, prev.col + (prev.end - prev.pos), this.file);
    }
    const shown = this.tok.t === 'eof' ? 'end of file' : "'" + this.tok.v + "'";
    this.err("'" + v + "' expected, found " + shown);
  }
  ident() {
    if (this.tok.t !== 'id') {
      // contextual keywords used as names
      this.err('<identifier> expected, found ' + (this.tok.t === 'eof' ? 'end of file' : "'" + this.tok.v + "'"));
    }
    return this.next().v;
  }
  node(k, t, props) { return { k, line: t.line, col: t.col, ...props }; }

  // ── compilation unit ────────────────────────────────────────────
  unit() {
    const imports = [];
    let pkg = null;
    this.annotations();
    if (this.isKw('package')) { this.next(); pkg = this.qualifiedName(); this.expect(';'); }
    while (this.isKw('import')) {
      const t = this.next();
      const isStatic = !!this.eat('static');
      let name = this.ident();
      let star = false;
      while (this.eat('.')) {
        if (this.eat('*')) { star = true; break; }
        name += '.' + this.ident();
      }
      this.expect(';');
      imports.push({ name, star, static: isStatic, line: t.line });
    }
    const types = [];
    while (this.tok.t !== 'eof') {
      if (this.eat(';')) continue;
      types.push(this.typeDecl(this.modifiers()));
    }
    return { k: 'unit', pkg, imports, types, file: this.file };
  }

  qualifiedName() {
    let s = this.ident();
    while (this.isOp('.') && this.peek().t === 'id') { this.next(); s += '.' + this.ident(); }
    return s;
  }

  annotations() {
    while (this.isOp('@') && !(this.peek().v === 'interface')) {
      this.next();
      this.qualifiedName();
      if (this.isOp('(')) this.skipParens();
    }
  }
  skipParens() {
    let depth = 0;
    do {
      if (this.isOp('(')) depth++;
      else if (this.isOp(')')) depth--;
      if (this.tok.t === 'eof') this.err("')' expected");
      this.next();
    } while (depth > 0);
  }

  modifiers() {
    const mods = new Set();
    for (;;) {
      this.annotations();
      const t = this.tok;
      if ((t.t === 'kw' || t.t === 'id') && MODS.has(t.v) && !(t.v === 'default' && (this.peek().v === ':' || this.peek().v === '->'))) {
        // "sealed"/"non-sealed" are identifiers; only take them before a type declaration word
        if (t.t === 'id' && !['class', 'interface'].includes(this.peek().v) && !MODS.has(this.peek().v)) break;
        mods.add(this.next().v);
        continue;
      }
      break;
    }
    return mods;
  }

  typeDecl(mods) {
    const t = this.tok;
    let kind;
    if (this.isKw('class')) kind = 'class';
    else if (this.isKw('interface')) kind = 'interface';
    else if (this.isKw('enum')) kind = 'enum';
    else if (this.isId('record')) kind = 'record';
    else if (this.isOp('@') && this.peek().v === 'interface') { this.next(); kind = 'annotation'; }
    else this.err('class, interface, enum, or record expected');
    this.next();
    const name = this.ident();
    const decl = this.node('class', t, { kind, name, mods, typeParams: [], ext: null, impls: [], members: [], enumConsts: [], recordComps: null });
    if (this.isOp('<')) decl.typeParams = this.typeParams();
    if (kind === 'record') {
      this.expect('(');
      decl.recordComps = [];
      if (!this.isOp(')')) {
        do { this.annotations(); const type = this.type(); decl.recordComps.push({ type, name: this.ident() }); } while (this.eat(','));
      }
      this.expect(')');
    }
    if (this.eat('extends')) {
      if (kind === 'interface') { decl.impls.push(this.type()); while (this.eat(',')) decl.impls.push(this.type()); }
      else decl.ext = this.type();
    }
    if (this.eat('implements')) { decl.impls.push(this.type()); while (this.eat(',')) decl.impls.push(this.type()); }
    if (this.isId('permits')) { this.next(); this.type(); while (this.eat(',')) this.type(); }
    this.classBody(decl);
    return decl;
  }

  typeParams() {
    const out = [];
    this.expect('<');
    do {
      this.annotations();
      const name = this.ident();
      let bound = null;
      if (this.eat('extends')) { bound = this.type(); while (this.eat('&')) this.type(); }
      out.push({ name, bound });
    } while (this.eat(','));
    this.expect('>');
    return out;
  }

  classBody(decl) {
    this.expect('{');
    if (decl.kind === 'enum') {
      while (!this.isOp(';') && !this.isOp('}')) {
        this.annotations();
        const t = this.tok;
        const name = this.ident();
        let args = [];
        if (this.isOp('(')) args = this.args();
        let body = null;
        if (this.isOp('{')) {
          body = this.node('class', t, { kind: 'class', name: decl.name + '$' + name, mods: new Set(), typeParams: [], ext: null, impls: [], members: [], enumConsts: [], anonymous: true });
          this.classBody(body);
        }
        decl.enumConsts.push({ name, args, body, line: t.line, col: t.col });
        if (!this.eat(',')) break;
      }
      this.eat(';');
    }
    while (!this.isOp('}')) {
      if (this.tok.t === 'eof') this.err("reached end of file while parsing: '}' expected");
      if (this.eat(';')) continue;
      decl.members.push(this.member(decl));
    }
    const close = this.expect('}');
    decl.endLine = close.line;
  }

  member(owner) {
    const t = this.tok;
    if (this.isOp('{')) return this.node('init', t, { static: false, body: this.block() });
    if (this.isKw('static') && this.peek().v === '{') { this.next(); return this.node('init', t, { static: true, body: this.block() }); }
    const mods = this.modifiers();
    if (this.isKw('class') || this.isKw('interface') || this.isKw('enum') || (this.isId('record') && this.peek().t === 'id') || (this.isOp('@') && this.peek().v === 'interface')) {
      return this.typeDecl(mods);
    }
    let typeParams = [];
    if (this.isOp('<')) typeParams = this.typeParams();
    const st = this.tok;
    // constructor: Name '('  (also compact record constructors: Name '{')
    if (this.tok.t === 'id' && this.tok.v === owner.name && (this.peek().v === '(' || (owner.kind === 'record' && this.peek().v === '{'))) {
      this.next();
      let params = [];
      let compact = false;
      if (this.isOp('(')) params = this.params(); else compact = true;
      if (this.eat('throws')) { this.type(); while (this.eat(',')) this.type(); }
      const body = this.block();
      return this.node('ctor', st, { mods, typeParams, params, body, compact, name: owner.name, endLine: body.endLine });
    }
    let ret;
    if (this.isKw('void')) { const v = this.next(); ret = { k: 'type', name: 'void', args: [], dims: 0, line: v.line, col: v.col }; }
    else ret = this.type();
    const nameTok = this.tok;
    const name = this.ident();
    if (this.isOp('(')) {
      const params = this.params();
      let dims = 0;
      while (this.isOp('[')) { this.next(); this.expect(']'); dims++; }
      if (dims) ret = { ...ret, dims: ret.dims + dims };
      if (this.eat('throws')) { this.type(); while (this.eat(',')) this.type(); }
      let body = null;
      if (this.isKw('default')) { this.next(); this.expr(); } // annotation default value
      if (this.isOp('{')) body = this.block(); else this.expect(';');
      return this.node('method', nameTok, { mods, typeParams, ret, name, params, body, endLine: body ? body.endLine : nameTok.line, startLine: st.line });
    }
    // field
    const decls = [this.declaratorRest(name, nameTok, ret)];
    while (this.eat(',')) { const nt = this.tok; decls.push(this.declaratorRest(this.ident(), nt, ret)); }
    this.expect(';');
    return this.node('field', st, { mods, type: ret, decls });
  }

  declaratorRest(name, nameTok, baseType) {
    let dims = 0;
    while (this.isOp('[')) { this.next(); this.expect(']'); dims++; }
    const type = dims ? { ...baseType, dims: baseType.dims + dims } : baseType;
    let init = null;
    if (this.eat('=')) init = this.isOp('{') ? this.arrayInit(type) : this.expr();
    return { name, type, init, line: nameTok.line, col: nameTok.col };
  }

  params() {
    this.expect('(');
    const out = [];
    if (!this.isOp(')')) {
      do {
        this.modifiers();
        let type = this.type();
        let varargs = false;
        if (this.eat('...')) { varargs = true; type = { ...type, dims: type.dims + 1 }; }
        if (this.isKw('this')) { this.next(); continue; } // receiver parameter
        const nt = this.tok;
        const name = this.ident();
        let dims = 0;
        while (this.isOp('[')) { this.next(); this.expect(']'); dims++; }
        if (dims) type = { ...type, dims: type.dims + dims };
        out.push({ name, type, varargs, line: nt.line, col: nt.col });
      } while (this.eat(','));
    }
    this.expect(')');
    return out;
  }

  // ── types ───────────────────────────────────────────────────────
  type() {
    this.annotations();
    const t = this.tok;
    let name;
    let args = [];
    if (t.t === 'kw' && PRIMS.has(t.v)) { this.next(); name = t.v; }
    else if (this.isOp('?')) {
      this.next();
      let bound = null;
      if (this.eat('extends') || this.eat('super')) bound = this.type();
      return { k: 'type', name: bound ? bound.name : 'Object', qual: null, args: [], dims: 0, wildcard: true, line: t.line, col: t.col };
    } else if (t.t === 'id') {
      name = this.next().v;
      if (this.isOp('<')) args = this.typeArgs();
      let qual = name;
      while (this.isOp('.') && this.peek().t === 'id') {
        this.next();
        const seg = this.next().v;
        qual += '.' + seg;
        name = seg;
        if (this.isOp('<')) args = this.typeArgs();
      }
      let dims = 0;
      while (this.isOp('[') && this.peek().v === ']') { this.next(); this.next(); dims++; }
      return { k: 'type', name, qual, args, dims, line: t.line, col: t.col };
    } else if (t.t === 'kw' && t.v === 'var') { this.next(); name = 'var'; }
    else this.err('<identifier> expected, found ' + (t.t === 'eof' ? 'end of file' : "'" + t.v + "'"));
    let dims = 0;
    while (this.isOp('[') && this.peek().v === ']') { this.next(); this.next(); dims++; }
    return { k: 'type', name, qual: name, args, dims, line: t.line, col: t.col };
  }

  typeArgs() {
    this.expect('<');
    const out = [];
    if (this.isOp('>')) { this.next(); return out; } // diamond
    do { out.push(this.type()); } while (this.eat(','));
    this.expect('>');
    return out;
  }

  // speculative: is a type followed by an identifier here? (a local variable declaration)
  looksLikeDecl() {
    const save = this.i;
    const saveToks = this.toks;
    try {
      const t = this.tok;
      if (!(t.t === 'id' || (t.t === 'kw' && PRIMS.has(t.v)))) return false;
      this.toks = this.toks.slice(); // ">>" splitting must not leak
      this.type();
      if (this.tok.t !== 'id') return false;
      const after = this.peek();
      return after.t === 'op' && ['=', ';', ',', '[', ':'].includes(after.v);
    } catch (e) {
      if (e instanceof CompileError) return false;
      throw e;
    } finally {
      this.i = save;
      this.toks = saveToks;
    }
  }

  // ── statements ──────────────────────────────────────────────────
  block() {
    const t = this.expect('{');
    const stmts = [];
    while (!this.isOp('}')) {
      if (this.tok.t === 'eof') this.err("reached end of file while parsing: '}' expected");
      stmts.push(this.stmt());
    }
    const close = this.next();
    return { k: 'block', stmts, line: t.line, col: t.col, endLine: close.line };
  }

  stmt() {
    const t = this.tok;
    if (this.isOp('{')) return this.block();
    if (this.isOp(';')) { this.next(); return this.node('empty', t, {}); }
    if (t.t === 'id' && this.peek().v === ':' && this.peek().t === 'op') {
      const label = this.next().v; this.next();
      return this.node('labeled', t, { label, body: this.stmt() });
    }
    if (t.t === 'id' && t.v === 'yield' && !['=', '(', '.', '[', '++', '--'].includes(this.peek().v)) {
      this.next();
      const e = this.expr();
      this.expect(';');
      return this.node('yield', t, { e });
    }
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': {
          this.next(); this.expect('(');
          const cond = this.expr(); this.expect(')');
          const then = this.stmt();
          const els = this.eat('else') ? this.stmt() : null;
          return this.node('if', t, { cond, then, else: els });
        }
        case 'while': {
          this.next(); this.expect('(');
          const cond = this.expr(); this.expect(')');
          return this.node('while', t, { cond, body: this.stmt() });
        }
        case 'do': {
          this.next();
          const body = this.stmt();
          const wt = this.expect('while');
          this.expect('(');
          const cond = this.expr(); this.expect(')'); this.expect(';');
          return this.node('do', t, { body, cond, condLine: wt.line });
        }
        case 'for': return this.forStmt();
        case 'switch': {
          const sw = this.switchBody(false);
          return sw;
        }
        case 'return': {
          this.next();
          const e = this.isOp(';') ? null : this.expr();
          this.expect(';');
          return this.node('return', t, { e });
        }
        case 'break': case 'continue': {
          this.next();
          const label = this.tok.t === 'id' ? this.next().v : null;
          this.expect(';');
          return this.node(t.v, t, { label });
        }
        case 'throw': {
          this.next();
          const e = this.expr(); this.expect(';');
          return this.node('throw', t, { e });
        }
        case 'try': return this.tryStmt();
        case 'synchronized': {
          this.next(); this.expect('('); this.expr(); this.expect(')');
          return this.block();
        }
        case 'assert': {
          this.next();
          const cond = this.expr();
          const msg = this.eat(':') ? this.expr() : null;
          this.expect(';');
          return this.node('assert', t, { cond, msg });
        }
        case 'class': case 'interface': case 'enum': case 'abstract': case 'static':
          this.err('local classes are not supported: declare the class at the top level or as a nested class');
          break;
        case 'final': {
          this.modifiers();
          return this.localDecl(t);
        }
        case 'this': case 'super':
          if (this.peek().v === '(') {
            this.next();
            const args = this.args();
            this.expect(';');
            return this.node('ctorCall', t, { kind: t.v, args });
          }
          break;
        default: break;
      }
    }
    if (this.isOp('@')) { this.modifiers(); return this.localDecl(t); }
    if ((t.t === 'id' && t.v === 'var' && this.peek().t === 'id') || this.looksLikeDecl()) return this.localDecl(t);
    const e = this.expr();
    this.expect(';');
    return this.node('expr', t, { e });
  }

  localDecl(t) {
    let type;
    if (this.isId('var') && this.peek().t === 'id') { const v = this.next(); type = { k: 'type', name: 'var', args: [], dims: 0, line: v.line, col: v.col }; }
    else type = this.type();
    const decls = [];
    do { const nt = this.tok; decls.push(this.declaratorRest(this.ident(), nt, type)); } while (this.eat(','));
    this.expect(';');
    return this.node('local', t, { type, decls });
  }

  forStmt() {
    const t = this.next();
    this.expect('(');
    // for-each?
    const save = this.i;
    this.modifiers();
    if ((this.isId('var') && this.peek().t === 'id') || this.looksLikeDecl()) {
      const st = this.tok;
      let type;
      if (this.isId('var') && this.peek().t === 'id') { this.next(); type = { k: 'type', name: 'var', args: [], dims: 0 }; }
      else type = this.type();
      const nt = this.tok;
      const name = this.ident();
      if (this.eat(':')) {
        const iter = this.expr();
        this.expect(')');
        return this.node('foreach', t, { type, name, iter, body: this.stmt(), varLine: nt.line });
      }
      // a classic for with declarations
      this.i = save;
      this.modifiers();
      const decl = this.localDeclNoSemi(st);
      return this.forRest(t, [decl]);
    }
    const init = [];
    if (!this.isOp(';')) {
      do { const et = this.tok; init.push(this.node('expr', et, { e: this.expr() })); } while (this.eat(','));
    }
    return this.forRest(t, init);
  }
  localDeclNoSemi(t) {
    const type = this.isId('var') ? (this.next(), { k: 'type', name: 'var', args: [], dims: 0 }) : this.type();
    const decls = [];
    do { const nt = this.tok; decls.push(this.declaratorRest(this.ident(), nt, type)); } while (this.eat(','));
    return this.node('local', t, { type, decls });
  }
  forRest(t, init) {
    this.expect(';');
    const cond = this.isOp(';') ? null : this.expr();
    this.expect(';');
    const update = [];
    if (!this.isOp(')')) { do { update.push(this.expr()); } while (this.eat(',')); }
    this.expect(')');
    return this.node('for', t, { init, cond, update, body: this.stmt() });
  }

  // switch statement or expression; returns a node of kind 'switch' (statement) or 'switchExpr'
  switchBody(isExpr) {
    const t = this.next();
    this.expect('(');
    const sel = this.expr();
    this.expect(')');
    this.expect('{');
    const cases = [];
    let arrow = null;
    while (!this.isOp('}')) {
      const ct = this.tok;
      let labels;
      if (this.eat('default')) labels = null;
      else if (this.eat('case')) {
        labels = [];
        do {
          if (this.isKw('default')) { this.next(); labels.push({ k: 'default' }); continue; }
          labels.push(this.ternary());
        } while (this.eat(','));
      } else this.err("'case', 'default', or '}' expected");
      if (this.isOp('->')) {
        if (arrow === false) this.err('different case kinds used in the switch');
        arrow = true;
        this.next();
        let body;
        if (this.isOp('{')) body = this.block();
        else if (this.isKw('throw')) body = this.stmt();
        else { const et = this.tok; const e = this.expr(); this.expect(';'); body = this.node(isExpr ? 'yield' : 'expr', et, { e, arrowValue: true }); }
        cases.push({ labels, body: [body], line: ct.line, col: ct.col });
      } else {
        this.expect(':');
        if (arrow === true) this.err('different case kinds used in the switch');
        arrow = false;
        const body = [];
        while (!this.isKw('case') && !this.isKw('default') && !this.isOp('}')) {
          if (this.tok.t === 'eof') this.err("'}' expected");
          body.push(this.stmt());
        }
        cases.push({ labels, body, line: ct.line, col: ct.col });
      }
    }
    this.next();
    return this.node(isExpr ? 'switchExpr' : 'switch', t, { sel, cases, arrow: !!arrow });
  }

  tryStmt() {
    const t = this.next();
    const resources = [];
    if (this.eat('(')) {
      while (!this.isOp(')')) {
        const rt = this.tok;
        this.modifiers();
        if (this.looksLikeDecl() || (this.isId('var') && this.peek().t === 'id')) {
          const type = this.isId('var') ? (this.next(), { k: 'type', name: 'var', args: [], dims: 0 }) : this.type();
          const nt = this.tok;
          const name = this.ident();
          this.expect('=');
          resources.push({ k: 'local', type, decls: [{ name, type, init: this.expr(), line: nt.line, col: nt.col }], line: rt.line, col: rt.col });
        } else resources.push(this.node('expr', rt, { e: this.expr() }));
        if (!this.eat(';')) break;
      }
      this.expect(')');
    }
    const block = this.block();
    const catches = [];
    while (this.isKw('catch')) {
      const ct = this.next();
      this.expect('(');
      this.modifiers();
      const types = [this.type()];
      while (this.eat('|')) types.push(this.type());
      const name = this.ident();
      this.expect(')');
      catches.push({ types, name, body: this.block(), line: ct.line, col: ct.col });
    }
    const fin = this.eat('finally') ? this.block() : null;
    if (!catches.length && !fin && !resources.length) this.err("'catch' or 'finally' expected");
    return this.node('try', t, { block, catches, fin, resources });
  }

  // ── expressions ─────────────────────────────────────────────────
  args() {
    this.expect('(');
    const out = [];
    if (!this.isOp(')')) { do { out.push(this.expr()); } while (this.eat(',')); }
    this.expect(')');
    return out;
  }

  expr() {
    const t = this.tok;
    // lambda: x -> ...   |   (a, b) -> ...   |   (int a, String b) -> ...
    if (t.t === 'id' && this.peek().v === '->') {
      this.next(); this.next();
      return this.lambdaBody(t, [{ name: t.v, type: null }]);
    }
    if (this.isOp('(') && this.isLambdaParams()) {
      this.next();
      const params = [];
      if (!this.isOp(')')) {
        do {
          this.modifiers();
          if (this.tok.t === 'id' && (this.peek().v === ',' || this.peek().v === ')')) params.push({ name: this.next().v, type: null });
          else { const type = this.type(); params.push({ name: this.ident(), type }); }
        } while (this.eat(','));
      }
      this.expect(')');
      this.expect('->');
      return this.lambdaBody(t, params);
    }
    const lhs = this.ternary();
    if (this.tok.t === 'op' && ASSIGN_OPS.has(this.tok.v)) {
      const opTok = this.next();
      if (!['name', 'field', 'index'].includes(lhs.k)) this.err('unexpected type: required variable, found value', opTok);
      const value = this.expr();
      return { k: 'assign', op: opTok.v, target: lhs, value, line: lhs.line, col: lhs.col, opLine: opTok.line, opCol: opTok.col };
    }
    return lhs;
  }

  isLambdaParams() {
    // at '(' : find the matching ')' and check for '->'
    let depth = 0;
    let j = this.i;
    for (; j < this.toks.length; j++) {
      const x = this.toks[j];
      if (x.t === 'eof') return false;
      if (x.t === 'op' && x.v === '(') depth++;
      else if (x.t === 'op' && x.v === ')') { depth--; if (depth === 0) break; }
    }
    const after = this.toks[j + 1];
    return !!after && after.t === 'op' && after.v === '->';
  }

  lambdaBody(t, params) {
    if (this.isOp('{')) return this.node('lambda', t, { params, body: this.block(), expr: null });
    return this.node('lambda', t, { params, body: null, expr: this.expr() });
  }

  ternary() {
    const c = this.binary(1);
    if (this.isOp('?')) {
      const q = this.next();
      const a = this.isOp('(') && this.isLambdaParams() ? this.expr() : this.ternaryBranch();
      this.expect(':');
      const b = this.ternaryBranch();
      return { k: 'cond', c, a, b, line: c.line, col: c.col, qLine: q.line };
    }
    return c;
  }
  ternaryBranch() {
    const t = this.tok;
    if ((t.t === 'id' && this.peek().v === '->') || (this.isOp('(') && this.isLambdaParams())) return this.expr();
    return this.ternary();
  }

  binary(minPrec) {
    let left = this.unary();
    for (;;) {
      const t = this.tok;
      const op = t.v;
      if (!(t.t === 'op' || (t.t === 'kw' && op === 'instanceof'))) break;
      const prec = BIN_PREC[op];
      if (!prec || prec < minPrec) break;
      this.next();
      if (op === 'instanceof') {
        const final = !!this.eat('final');
        void final;
        const type = this.type();
        let bind = null;
        if (this.tok.t === 'id') bind = this.next().v;
        left = { k: 'instanceof', e: left, type, bind, line: left.line, col: left.col, opLine: t.line, opCol: t.col };
        continue;
      }
      const right = this.binary(prec + 1);
      left = { k: 'binary', op, l: left, r: right, line: left.line, col: left.col, opLine: t.line, opCol: t.col };
    }
    return left;
  }

  unary() {
    const t = this.tok;
    if (t.t === 'op') {
      if (t.v === '++' || t.v === '--') {
        this.next();
        const e = this.unary();
        return this.node('preinc', t, { op: t.v, e });
      }
      if (t.v === '+' || t.v === '-' || t.v === '!' || t.v === '~') {
        this.next();
        // -2147483648 and -9223372036854775808L
        if (t.v === '-' && (this.tok.t === 'int' || this.tok.t === 'long') && this.tok.big) {
          const lt = this.next();
          const lit = lt.t === 'int'
            ? { k: 'lit', lt: 'int', v: -2147483648, line: t.line, col: t.col }
            : { k: 'lit', lt: 'long', v: -9223372036854775808n, line: t.line, col: t.col };
          return this.postfix(lit);
        }
        const e = this.unary();
        return this.node('unary', t, { op: t.v, e });
      }
      if (t.v === '(' && this.isCast()) {
        this.next();
        const type = this.type();
        while (this.eat('&')) this.type();
        this.expect(')');
        const e = this.unary();
        return this.node('cast', t, { type, e });
      }
    }
    return this.postfix(this.primary());
  }

  isCast() {
    // at '(' : "(prim[]...)" is always a cast; "(Name<..>[]...)" is a cast when what follows
    // can start an operand that is not + or -
    const save = this.i;
    const saveToks = this.toks;
    try {
      this.toks = this.toks.slice();
      this.next();
      const t = this.tok;
      if (t.t === 'kw' && PRIMS.has(t.v)) {
        this.type();
        return this.isOp(')');
      }
      if (t.t !== 'id') return false;
      this.type();
      while (this.eat('&')) this.type();
      if (!this.isOp(')')) return false;
      this.next();
      const a = this.tok;
      if (a.t === 'id' || a.t === 'str' || a.t === 'char' || a.t === 'int' || a.t === 'long' || a.t === 'double' || a.t === 'float') return true;
      if (a.t === 'kw' && ['this', 'super', 'new', 'true', 'false', 'null', 'switch'].includes(a.v)) return true;
      if (a.t === 'kw' && PRIMS.has(a.v)) return false;
      if (a.t === 'op' && (a.v === '(' || a.v === '!' || a.v === '~')) return true;
      return false;
    } catch (e) {
      if (e instanceof CompileError) return false;
      throw e;
    } finally {
      this.i = save;
      this.toks = saveToks;
    }
  }

  primary() {
    const t = this.tok;
    switch (t.t) {
      case 'int': case 'long': case 'double': case 'float': case 'char': case 'str':
        this.next();
        if (t.big) this.err(t.t === 'int' ? 'integer number too large' : 'long number too large', t);
        return { k: 'lit', lt: t.t === 'float' ? 'double' : t.t, v: t.v, isFloat: t.t === 'float', line: t.line, col: t.col };
      case 'id': {
        this.next();
        if (this.isOp('(')) return this.node('call', t, { obj: null, name: t.v, args: this.args() });
        return this.node('name', t, { name: t.v });
      }
      case 'kw':
        switch (t.v) {
          case 'true': case 'false': this.next(); return { k: 'lit', lt: 'bool', v: t.v === 'true', line: t.line, col: t.col };
          case 'null': this.next(); return { k: 'lit', lt: 'null', v: null, line: t.line, col: t.col };
          case 'this':
            this.next();
            if (this.isOp('(')) this.err('call to this must be first statement in constructor');
            return this.node('this', t, {});
          case 'super': {
            this.next();
            if (this.isOp('::')) { this.next(); return this.node('mref', t, { target: this.node('super', t, {}), name: this.ident() }); }
            this.expect('.');
            const nt = this.tok;
            const name = this.ident();
            if (this.isOp('(')) return this.node('call', nt, { obj: this.node('super', t, {}), name, args: this.args(), sup: true });
            return this.node('field', nt, { obj: this.node('super', t, {}), name, sup: true });
          }
          case 'new': return this.creator();
          case 'switch': return this.switchBody(true);
          default:
            if (PRIMS.has(t.v) || t.v === 'void') {
              // int.class, int[]::new
              const type = t.v === 'void' ? (this.next(), { k: 'type', name: 'void', args: [], dims: 0 }) : this.type();
              if (this.isOp('::')) { this.next(); this.expect('new'); return this.node('mref', t, { target: { k: 'typeRef', type }, name: 'new' }); }
              this.expect('.');
              this.expect('class');
              return this.node('classLit', t, { type });
            }
        }
        break;
      case 'op':
        if (t.v === '(') {
          this.next();
          const e = this.expr();
          this.expect(')');
          return this.node('paren', t, { e });
        }
        if (t.v === '{') this.err('array initializer is only allowed in a declaration or after new T[]');
        break;
      default: break;
    }
    this.err('illegal start of expression' + (t.t === 'eof' ? '' : ": '" + t.v + "'"));
  }

  creator() {
    const t = this.next(); // new
    this.annotations();
    const tt = this.tok;
    let base;
    if (tt.t === 'kw' && PRIMS.has(tt.v)) { this.next(); base = { k: 'type', name: tt.v, qual: tt.v, args: [], dims: 0, line: tt.line, col: tt.col }; }
    else if (tt.t === 'id') {
      let name = this.next().v;
      let qual = name;
      let args = [];
      if (this.isOp('<')) args = this.typeArgs();
      while (this.isOp('.') && this.peek().t === 'id') { this.next(); name = this.next().v; qual += '.' + name; if (this.isOp('<')) args = this.typeArgs(); }
      base = { k: 'type', name, qual, args, dims: 0, line: tt.line, col: tt.col };
    } else this.err('<identifier> expected');
    if (this.isOp('[')) {
      const dims = [];
      let extra = 0;
      while (this.isOp('[')) {
        this.next();
        if (this.isOp(']')) { this.next(); extra++; continue; }
        if (extra) this.err("']' expected");
        dims.push(this.expr());
        this.expect(']');
      }
      const type = { ...base, dims: dims.length + extra };
      if (this.isOp('{')) {
        if (dims.length) this.err("';' expected");
        return this.arrayInit(type, t);
      }
      if (!dims.length) this.err('array dimension missing');
      return this.node('newArray', t, { type, dims });
    }
    if (this.isOp('(')) {
      const args = this.args();
      let body = null;
      if (this.isOp('{')) {
        body = { k: 'class', kind: 'class', name: null, mods: new Set(), typeParams: [], ext: base, impls: [], members: [], enumConsts: [], anonymous: true, line: t.line, col: t.col };
        this.classBody(body);
      }
      return this.node('new', t, { type: base, args, body });
    }
    this.err("'(' or '[' expected");
  }

  arrayInit(type, t = this.tok) {
    this.expect('{');
    const elems = [];
    const elemType = { ...type, dims: type.dims - 1 };
    while (!this.isOp('}')) {
      elems.push(this.isOp('{') ? this.arrayInit(elemType) : this.expr());
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return this.node('arrayInit', t, { type, elems });
  }

  postfix(e) {
    for (;;) {
      const t = this.tok;
      if (t.t !== 'op') break;
      if (t.v === '.') {
        this.next();
        if (this.isOp('<')) this.typeArgs(); // explicit generic method call: obj.<T>m()
        if (this.isKw('new')) { const c = this.creator(); c.outerExpr = e; e = c; continue; }
        if (this.isKw('class')) { this.next(); e = { k: 'classLit', type: { k: 'type', name: e.name || '?', args: [], dims: 0 }, line: e.line, col: e.col }; continue; }
        if (this.isKw('this')) { this.next(); e = { k: 'this', qual: e.name, line: e.line, col: e.col }; continue; }
        const nt = this.tok;
        const name = this.ident();
        if (this.isOp('(')) e = { k: 'call', obj: e, name, args: this.args(), line: nt.line, col: nt.col, objLine: e.line };
        else e = { k: 'field', obj: e, name, line: nt.line, col: nt.col };
        continue;
      }
      if (t.v === '[') {
        // Type[]::new  or  Type[].class
        if (this.peek().v === ']' && e.k === 'name') {
          const type = { k: 'type', name: e.name, args: [], dims: 0 };
          while (this.isOp('[')) { this.next(); this.expect(']'); type.dims++; }
          if (this.eat('::')) { this.expect('new'); e = { k: 'mref', target: { k: 'typeRef', type }, name: 'new', line: e.line, col: e.col }; continue; }
          this.expect('.'); this.expect('class');
          e = { k: 'classLit', type, line: e.line, col: e.col };
          continue;
        }
        this.next();
        const idx = this.expr();
        this.expect(']');
        e = { k: 'index', arr: e, idx, line: e.line, col: e.col, brLine: t.line, brCol: t.col };
        continue;
      }
      if (t.v === '::') {
        this.next();
        const name = this.isKw('new') ? (this.next(), 'new') : this.ident();
        e = { k: 'mref', target: e, name, line: e.line, col: e.col };
        continue;
      }
      if (t.v === '++' || t.v === '--') {
        this.next();
        e = { k: 'postinc', op: t.v, e, line: e.line, col: e.col };
        continue;
      }
      if (t.v === '<' && e.k === 'name' && /^[A-Z]/.test(e.name) && this.genericTypeBeforeColons()) {
        // List<String>::new style method reference
        this.typeArgs();
        continue;
      }
      break;
    }
    return e;
  }

  genericTypeBeforeColons() {
    const save = this.i;
    const saveToks = this.toks;
    try { this.toks = this.toks.slice(); this.typeArgs(); return this.isOp('::'); } catch { return false; } finally { this.i = save; this.toks = saveToks; }
  }
}
