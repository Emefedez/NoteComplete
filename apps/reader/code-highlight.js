// Syntax highlighting for code, with no library and nothing fetched: a small hand-written
// scanner per language family (C-like, Python, shell, SQL, markup, CSS, YAML, Markdown,
// PlantUML, assembly…). It colours, it does not parse: no errors are reported while typing,
// and unknown or broken input (an unterminated string or comment) still comes out as text.
//
//   highlight(code, lang)       HTML (escaped), tokens as <span class="tk-kw|tk-type|tk-str|
//                               tk-num|tk-com|tk-fn|tk-op|tk-anno">; unknown lang: escaped text.
//   highlightLines(code, lang)  the same, one HTML string per source line, each balanced
//                               (multi-line comments and strings are split at line ends).
//   codeEditor(host, options)   a textarea over a highlighted backdrop (see below).
//   langFromName(fileName)      the lang id for a file name (.java → 'java'), or ''.
//   decorateCodeBlocks(root)    colours rendered Markdown's <pre><code class="language-x">,
//                               with a language label and a copy button.
//
// The colours are CSS variables in code-highlight.css, loaded once by this module.

// ---------------------------------------------------------------- styles

let styled = false;
function ensureStyles(doc = globalThis.document) {
  if (styled || !doc?.head) return;
  styled = true;
  if (doc.querySelector('link[data-code-highlight-css]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./code-highlight.css', import.meta.url).href;
  link.dataset.codeHighlightCss = '';
  doc.head.append(link);
}
// Once, as the module loads in a page (not in a worker or under Node).
if (globalThis.document?.head) ensureStyles();

// ---------------------------------------------------------------- helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
const isDigit = (c) => c >= '0' && c <= '9';
const isIdStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c > '\x7f';
const isId = (c) => isIdStart(c) || isDigit(c);

// Tokens are [cls, text] pairs ('' = plain). push() merges neighbours of the same class.
function pusher(out) {
  return (cls, text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last[0] === cls) last[1] += text;
    else out.push([cls, text]);
  };
}

const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.(?!\.)[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)[a-zA-Z_\d]*/y;
const OPS = '+-*/%=<>!&|^~?:';

// ---------------------------------------------------------------- the generic scanner
//
// cfg: {
//   line: ['//'], block: [['/*', '*/']],          comments
//   lineAtStart: true                             line comments only at a line's start (PlantUML ')
//   lineAfterSpace: true                          only at a word's start (shell #)
//   strings: [{ open, close, esc, ml }]           longest openers first
//   kw, type, lit, builtin: Set                   lit shows as a keyword, builtin as a function
//   ci: true                                      case-insensitive words
//   caps: true                                    Capitalized words are types
//   anno: '@'                                     @Name annotations / decorators
//   pre: true                                     C preprocessor lines (#include …)
//   vars: '$'                                     $name variables (shown as tk-anno)
//   idChars: '$'                                  more characters inside identifiers
//   keys: true                                    a string or word before ':' is a key (tk-type)
//   prefix: /^(?:r|b|f|u|rb|br|fr|rf)$/i         a word glued to a string opener (Python r"…")
//   extra: [[firstChars, /sticky/y, cls]]         special tokens, tried first at those characters
//   fnCall: true (default)                        a word before '(' is a function
// }

function scanGeneric(code, cfg, out = []) {
  const push = pusher(out);
  const n = code.length;
  const lineComments = cfg.line || [];
  const blocks = cfg.block || [];
  const strings = cfg.strings || [];
  const extra = cfg.extra || [];
  const idChars = cfg.idChars || '';
  const fnCall = cfg.fnCall !== false;
  let i = 0, lineStart = true, includeLine = false;
  const startsWith = (s) => code.startsWith(s, i);
  // First characters that may start a comment, string or special token: others skip those checks.
  const firsts = new Set([...blocks.map(([o]) => o[0]), ...lineComments.map((o) => o[0]), ...strings.map((x) => x.open[0])]);
  const extraAt = new Map();
  for (const rule of extra) for (const ch of rule[0]) { if (!extraAt.has(ch)) extraAt.set(ch, []); extraAt.get(ch).push(rule); }
  const word = (w) => (cfg.ci ? w.toLowerCase() : w);
  scan: while (i < n) {
    const c = code[i];
    if (isSpace(c)) {
      let j = i + 1;
      while (j < n && isSpace(code[j])) j++;
      const chunk = code.slice(i, j);
      if (chunk.includes('\n')) { lineStart = true; includeLine = false; }
      push('', chunk);
      i = j;
      continue;
    }
    // Special tokens of the language.
    for (const [, re, cls] of extraAt.get(c) || []) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length) {
        if (typeof cls === 'function') cls(m, push);
        else push(cls, m[0]);
        i += m[0].length;
        lineStart = false;
        continue scan;
      }
    }
    // Comments.
    if (firsts.has(c)) for (const [open, close] of blocks) {
      if (!startsWith(open)) continue;
      const end = code.indexOf(close, i + open.length);
      const j = end < 0 ? n : end + close.length;
      push('tk-com', code.slice(i, j));
      i = j;
      continue scan;
    }
    if (firsts.has(c)) for (const open of lineComments) {
      if (!startsWith(open)) continue;
      if (cfg.lineAtStart && !lineStart) continue;
      if (cfg.lineAfterSpace && i > 0 && !isSpace(code[i - 1]) && !';|&('.includes(code[i - 1])) continue;
      let j = code.indexOf('\n', i);
      if (j < 0) j = n;
      push('tk-com', code.slice(i, j));
      i = j;
      continue scan;
    }
    // C preprocessor: the directive is an annotation; <file> after #include a string.
    if (cfg.pre && c === '#' && lineStart) {
      const m = /#\s*[A-Za-z_]\w*/y;
      m.lastIndex = i;
      const found = m.exec(code);
      if (found) {
        push('tk-anno', found[0]);
        includeLine = /include|import/.test(found[0]);
        i += found[0].length;
        lineStart = false;
        continue;
      }
    }
    if (includeLine && c === '<') {
      const end = code.indexOf('>', i);
      const nl = code.indexOf('\n', i);
      if (end > 0 && (nl < 0 || end < nl)) { push('tk-str', code.slice(i, end + 1)); i = end + 1; continue; }
    }
    lineStart = false;
    // Strings.
    const str = firsts.has(c) && strings.find((s) => startsWith(s.open));
    if (str) { i = scanString(code, i, str, push, cfg.keys); continue; }
    // Numbers.
    if (isDigit(c) || (c === '.' && isDigit(code[i + 1] || ''))) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(code);
      push('tk-num', m[0]);
      i += m[0].length;
      continue;
    }
    // Annotations and variables.
    if (cfg.anno && c === cfg.anno && isIdStart(code[i + 1] || '')) {
      let j = i + 1;
      while (j < n && (isId(code[j]) || (code[j] === '.' && isIdStart(code[j + 1] || '')))) j++;
      push('tk-anno', code.slice(i, j));
      i = j;
      continue;
    }
    if (cfg.vars && cfg.vars.includes(c) && (isIdStart(code[i + 1] || '') || (cfg.shellVars && code[i + 1]))) {
      const j = scanVar(code, i, cfg);
      if (j > i + 1) { push('tk-anno', code.slice(i, j)); i = j; continue; }
    }
    // Words.
    if (isIdStart(c) || idChars.includes(c)) {
      let j = i + 1;
      while (j < n && (isId(code[j]) || idChars.includes(code[j]))) j++;
      const w = code.slice(i, j);
      // A prefix glued to a string: r"…", b'…', f"…".
      if (cfg.prefix && cfg.prefix.test(w)) {
        const s = strings.find((x) => code.startsWith(x.open, j));
        if (s) {
          const tmp = [];
          const end = scanString(code, j, cfg.rawPrefix?.test(w) ? { ...s, esc: false } : s, pusher(tmp), false);
          push('tk-str', w + tmp.map((t) => t[1]).join(''));
          i = end;
          continue;
        }
      }
      const key = word(w);
      let cls = '';
      if (cfg.lit?.has(key) || cfg.kw?.has(key)) cls = 'tk-kw';
      else if (cfg.type?.has(key)) cls = 'tk-type';
      else if (cfg.builtin?.has(key)) cls = 'tk-fn';
      else if (cfg.keys && nextNonSpace(code, j) === ':' && code[nextNonSpaceAt(code, j) + 1] !== ':') cls = 'tk-type';
      else if (fnCall && nextNonSpace(code, j) === '(') cls = 'tk-fn';
      else if (cfg.caps && c >= 'A' && c <= 'Z' && /[a-z]/.test(w)) cls = 'tk-type';
      push(cls, w);
      i = j;
      continue;
    }
    // Operators: a run of operator characters.
    if (OPS.includes(c)) {
      let j = i + 1;
      while (j < n && OPS.includes(code[j]) && !(firsts.has(code[j]) && (blocks.some(([o]) => code.startsWith(o, j)) || lineComments.some((o) => code.startsWith(o, j))))) j++;
      push('tk-op', code.slice(i, j));
      i = j;
      continue;
    }
    push('', c);
    i++;
  }
  return out;
}

function nextNonSpaceAt(code, j) {
  while (j < code.length && (code[j] === ' ' || code[j] === '\t')) j++;
  return j;
}
const nextNonSpace = (code, j) => code[nextNonSpaceAt(code, j)] || '';

// A string from `i` (at its opener); returns the index after it. Unterminated: to the line's
// end (or the text's end for multi-line strings).
function scanString(code, i, s, push, keys) {
  const n = code.length;
  let j = i + s.open.length;
  while (j < n) {
    const ch = code[j];
    if (s.esc && ch === '\\') { j += 2; continue; }
    if (code.startsWith(s.close, j)) { j += s.close.length; break; }
    if (ch === '\n' && !s.ml) break;
    j++;
  }
  if (j > n) j = n;
  const text = code.slice(i, j);
  push(keys && nextNonSpace(code, j) === ':' ? 'tk-type' : 'tk-str', text);
  return j;
}

// $name, ${…}, $1, $@ (shell); $name (PHP, Perl).
function scanVar(code, i, cfg) {
  const n = code.length;
  let j = i + 1;
  if (cfg.shellVars) {
    if (code[j] === '{') { const end = code.indexOf('}', j); const nl = code.indexOf('\n', j); return end > 0 && (nl < 0 || end < nl) ? end + 1 : i; }
    if ('@#?*$!-0123456789'.includes(code[j])) return j + 1;
  }
  while (j < n && isId(code[j])) j++;
  return j;
}

// ---------------------------------------------------------------- languages

const C_KW = 'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local';
const C_TYPES = 'void char short int long float double signed unsigned bool _Bool _Complex size_t ssize_t ptrdiff_t intptr_t uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE wchar_t';
const C_LIT = 'NULL true false nullptr';
const CPP_KW = `${C_KW} alignas alignof and asm catch class co_await co_return co_yield concept consteval constexpr constinit const_cast decltype delete dynamic_cast explicit export final friend mutable namespace new noexcept not operator or override private protected public reinterpret_cast requires static_assert static_cast template this thread_local throw try typeid typename using virtual xor`;
const CPP_TYPES = `${C_TYPES} char8_t char16_t char32_t string vector map set unordered_map unordered_set pair tuple optional shared_ptr unique_ptr weak_ptr array deque list queue stack std`;
const JAVA_KW = 'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while var record sealed permits non-sealed yield module requires exports opens uses provides with to transitive';
const JAVA_TYPES = 'boolean byte char double float int long short void String Object Integer Long Double Float Boolean Character Byte Short';
const JS_KW = 'async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield';
const JS_LIT = 'true false null undefined NaN Infinity';
const TS_KW = `${JS_KW} abstract as asserts declare enum implements infer interface is keyof module namespace override private protected public readonly satisfies type unique`;
const TS_TYPES = 'any bigint boolean never number object string symbol unknown void';
const RUST_KW = 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type union unsafe use where while macro_rules';
const RUST_TYPES = 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Rc Arc RefCell Cell HashMap HashSet BTreeMap';
const GO_KW = 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var';
const GO_TYPES = 'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any';
const KOTLIN_KW = 'abstract actual annotation as break by catch class companion const constructor continue crossinline data delegate do dynamic else enum expect external field file final finally for fun get if import in infix init inline inner interface internal is lateinit noinline object open operator out override package param private property protected public receiver reified return sealed set setparam super suspend tailrec this throw try typealias typeof val value var vararg when where while';
const KOTLIN_TYPES = 'Any Unit Nothing Int Long Short Byte Double Float Boolean Char String Array List MutableList Map MutableMap Set MutableSet';
const CS_KW = 'abstract as base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly record ref return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using virtual volatile while async await var get set init yield where when';
const CS_TYPES = 'bool byte char decimal double float int long object sbyte short string uint ulong ushort void dynamic nint nuint';
const SWIFT_KW = 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch is super self Self throw throws try async await some any mutating override final lazy weak';
const SWIFT_TYPES = 'Int Double Float Bool String Character Array Dictionary Set Optional Void UInt Int8 Int16 Int32 Int64';
const PHP_KW = 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield';
const PY_KW = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case';
const PY_LIT = 'True False None self cls';
const PY_BUILTIN = 'print len range int str float list dict set tuple bool type isinstance enumerate zip map filter sorted reversed sum min max abs open input super object round any all iter next repr format hash id ord chr hex bin';
const RUBY_KW = 'BEGIN END alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer include extend puts';
const LUA_KW = 'and break do else elseif end for function goto if in local not or repeat return then until while';
const R_KW = 'if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_character_ library require return';
const SH_KW = 'if then else elif fi case esac for select while until do done in function time coproc return break continue';
const SH_BUILTIN = 'echo printf cd pwd export local read source exit set unset shift test eval exec trap alias unalias declare typeset readonly let wait kill sudo cat ls grep sed awk find xargs mkdir rm cp mv chmod chown touch head tail sort uniq wc tr cut tee curl wget git make npm npx node python python3 pip apt pacman brew java javac gcc g++ cc clang cargo rustc go docker ssh scp tar zip unzip gzip less man which env sh bash zsh systemctl journalctl';
const SQL_KW = 'select from where and or not insert into values update set delete create table drop alter add column primary key foreign references index view as join inner left right full outer cross on group by order having limit offset union all distinct case when then else end is null like in between exists asc desc default constraint unique check database schema if begin commit rollback transaction grant revoke trigger procedure function returns return declare cascade with recursive natural using top fetch first next rows only over partition window replace truncate';
const SQL_TYPES = 'int integer smallint bigint tinyint decimal numeric float real double precision char varchar nvarchar text boolean bool date time timestamp datetime interval blob serial uuid json jsonb bytea money';
const SQL_LIT = 'true false null';
const SQL_FN = 'count sum avg min max coalesce nullif cast concat substring trim upper lower length round now abs';
const VHDL_KW = 'abs access after alias all and architecture array assert attribute begin block body buffer bus case component configuration constant disconnect downto else elsif end entity exit file for function generate generic group guarded if impure in inertial inout is label library linkage literal loop map mod nand new next nor not null of on open or others out package port postponed procedure process pure range record register reject rem report return rol ror select severity signal shared sla sll sra srl subtype then to transport type unaffected units until use variable wait when while with xnor xor rising_edge falling_edge';
const VHDL_TYPES = 'std_logic std_logic_vector std_ulogic std_ulogic_vector bit bit_vector integer natural positive boolean signed unsigned real time character string ieee std_logic_1164 numeric_std';
const VERILOG_KW = 'always always_comb always_ff always_latch and assign automatic begin case casex casez cell config deassign default defparam design disable edge else end endcase endconfig endfunction endgenerate endmodule endprimitive endspecify endtable endtask event for force forever fork function generate genvar if ifnone initial inout input instance join large liblist library localparam macromodule medium module nand negedge nmos nor not or output parameter pmos posedge primitive pull0 pull1 pulldown pullup rcmos real realtime reg release repeat rnmos rpmos rtran rtranif0 rtranif1 scalared signed small specify specparam strong0 strong1 supply0 supply1 table task time tran tranif0 tranif1 tri tri0 tri1 triand trior trireg unsigned use vectored wait wand weak0 weak1 while wire wor xnor xor logic bit byte int typedef enum struct packed interface endinterface modport class endclass package endpackage import';
const PLANTUML_KW = 'abstract actor agent annotation artifact as boundary card class cloud collections component control database diamond else end endif endwhile entity enum file folder frame if interface left right up down of on over top bottom node note object package participant queue rectangle stack state storage title skinparam usecase while repeat fork again start stop detach partition legend endlegend header footer caption activate deactivate destroy alt opt loop par break critical group ref return autonumber hide show together namespace newpage box is';
const TEX_EXTRA = [['\\', /\\(?:[A-Za-z@]+\*?|.)/y, 'tk-kw'], ['$', /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/y, 'tk-str']];

const DQ = { open: '"', close: '"', esc: true };
const SQ = { open: "'", close: "'", esc: true };
const BT = { open: '`', close: '`', esc: true, ml: true };

const C_LIKE = { line: ['//'], block: [['/*', '*/']] };
const CONFIGS = {
  c: { ...C_LIKE, strings: [DQ, SQ], kw: words(C_KW), type: words(C_TYPES), lit: words(C_LIT), pre: true },
  cpp: { ...C_LIKE, strings: [DQ, SQ], kw: words(CPP_KW), type: words(CPP_TYPES), lit: words(C_LIT), pre: true, caps: true,
    extra: [['R', /R"([^(\s]*)\([\s\S]*?\)\1"/y, 'tk-str']] },
  java: { ...C_LIKE, strings: [{ open: '"""', close: '"""', esc: true, ml: true }, DQ, SQ], kw: words(JAVA_KW), type: words(JAVA_TYPES), lit: words('true false null'), anno: '@', caps: true, idChars: '$' },
  js: { ...C_LIKE, strings: [DQ, SQ, BT], kw: words(JS_KW), lit: words(JS_LIT), anno: '@', caps: true, idChars: '$',
    extra: [['/', /\/(?![/*])(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n[])+\/[dgimsuyv]*(?=\s*(?:[),;.\]}]|$|\n))/y, regexOrOp]] },
  ts: { ...C_LIKE, strings: [DQ, SQ, BT], kw: words(TS_KW), type: words(TS_TYPES), lit: words(JS_LIT), anno: '@', caps: true, idChars: '$', extra: null },
  rust: { ...C_LIKE, strings: [DQ], kw: words(RUST_KW), type: words(RUST_TYPES), lit: words('true false Some None Ok Err'), caps: true,
    prefix: /^(?:b|r|br|rb)$/, rawPrefix: /r/,
    extra: [
      ['#', /#!?\[[^\]\n]*\]/y, 'tk-anno'],
      ['rb', /b?r(#+)"[\s\S]*?"\1/y, 'tk-str'],
      ["'", /'(?:\\(?:x[\da-fA-F]{2}|u\{[\da-fA-F]+\}|.)|[^\\'\n])'/y, 'tk-str'],
      ["'", /'[A-Za-z_]\w*/y, 'tk-anno'],
      ['abcdefghijklmnopqrstuvwxyz_', /[a-z_]\w*!(?=\s*[([{])/y, 'tk-fn'],
    ] },
  go: { ...C_LIKE, strings: [DQ, SQ, { open: '`', close: '`', ml: true }], kw: words(GO_KW), type: words(GO_TYPES), lit: words('true false nil iota') },
  kotlin: { ...C_LIKE, strings: [{ open: '"""', close: '"""', ml: true }, DQ, SQ], kw: words(KOTLIN_KW), type: words(KOTLIN_TYPES), lit: words('true false null'), anno: '@', caps: true },
  csharp: { ...C_LIKE, strings: [{ open: '@"', close: '"', ml: true }, { open: '$"', close: '"', esc: true }, DQ, SQ], kw: words(CS_KW), type: words(CS_TYPES), lit: words('true false null'), caps: true, pre: true,
    extra: [['[', /\[(?=[A-Z])[\w.]+(?:\([^)\n]*\))?\]/y, 'tk-anno']] },
  swift: { ...C_LIKE, strings: [{ open: '"""', close: '"""', esc: true, ml: true }, DQ], kw: words(SWIFT_KW), type: words(SWIFT_TYPES), lit: words('true false nil'), anno: '@', caps: true },
  php: { line: ['//', '#'], block: [['/*', '*/']], strings: [DQ, SQ], kw: words(PHP_KW), lit: words('true false null TRUE FALSE NULL'), vars: '$', ci: false, caps: true,
    extra: [['<?', /<\?(?:php|=)?|\?>/y, 'tk-anno']] },
  python: { line: ['#'], strings: [{ open: '"""', close: '"""', esc: true, ml: true }, { open: "'''", close: "'''", esc: true, ml: true }, DQ, SQ],
    kw: words(PY_KW), lit: words(PY_LIT), builtin: words(PY_BUILTIN), anno: '@', caps: true, prefix: /^(?:r|b|f|u|rb|br|fr|rf)$/i, rawPrefix: /r/i },
  ruby: { line: ['#'], block: [['=begin', '=end']], strings: [DQ, SQ, BT], kw: words(RUBY_KW), lit: words('true false nil'), caps: true, vars: '@$',
    extra: [[':', /:[A-Za-z_]\w*[?!]?(?!:)/y, 'tk-anno']] },
  lua: { line: ['--'], block: [['--[[', ']]']], strings: [{ open: '[[', close: ']]', ml: true }, DQ, SQ], kw: words(LUA_KW), lit: words('true false nil') },
  r: { line: ['#'], strings: [DQ, SQ], kw: words(R_KW), lit: words('T F'), extra: [['<-', /<<?-|->>?/y, 'tk-op']] },
  bash: { line: ['#'], lineAfterSpace: true, strings: [{ open: '"', close: '"', esc: true, ml: true }, { open: "'", close: "'", ml: true }],
    kw: words(SH_KW), builtin: words(SH_BUILTIN), vars: '$', shellVars: true, idChars: '-', fnCall: true,
    extra: [['#', /#!.*/y, 'tk-anno'], ['<', /<<-?\s*(['"]?)(\w+)\1/y, 'tk-op'], ['$', /\$\(\(?|\$\[/y, 'tk-op']] },
  sql: { line: ['--', '#'], lineAfterSpace: false, block: [['/*', '*/']], strings: [{ open: "'", close: "'", esc: true, ml: true }, { open: '"', close: '"', ml: false }],
    kw: words(SQL_KW), type: words(SQL_TYPES), lit: words(SQL_LIT), builtin: words(SQL_FN), ci: true, extra: [['`', /`[^`\n]*`/y, 'tk-type'], ['@', /@@?[A-Za-z_]\w*/y, 'tk-anno']] },
  json: { line: ['//'], block: [['/*', '*/']], strings: [DQ], lit: words('true false null'), keys: true, fnCall: false },
  vhdl: { line: ['--'], block: [['/*', '*/']], strings: [DQ], kw: words(VHDL_KW), type: words(VHDL_TYPES), lit: words("true false"), ci: true, fnCall: false,
    prefix: /^[xbo]$/i,
    extra: [["'", /'[^'\n]'/y, 'tk-str'], ["'", /'[A-Za-z_]\w*/y, 'tk-anno']] },
  verilog: { ...C_LIKE, strings: [DQ], kw: words(VERILOG_KW), fnCall: false,
    extra: [
      ['0123456789\'', /\d*'[sS]?[bodhBODH]\s*[\da-fA-FxXzZ_?]+/y, 'tk-num'],
      ['`', /`\w+/y, 'tk-anno'],
      ['$', /\$\w+/y, 'tk-fn'],
    ] },
  plantuml: { line: ["'"], lineAtStart: true, block: [["/'", "'/"]], strings: [{ open: '"', close: '"' }], kw: words(PLANTUML_KW), ci: true, fnCall: false,
    extra: [
      ['@', /@\w+/y, 'tk-anno'],
      ['<', /<<[^>\n]*>>/y, 'tk-anno'],
      ['!', /![a-z_]+/y, 'tk-anno'],
      ['#', /#[A-Za-z0-9]+/y, 'tk-num'],
      ['-.=<*|o', /(?:<\||[<*o])?(?:-+|\.+|=+)(?:\[[^\]\n]*\])?(?:-+|\.+|=+)?(?:\|>|[>*o])?/y, arrowOrText],
      [':', /:/y, 'tk-op'],
    ] },
  tex: { line: ['%'], strings: [], extra: TEX_EXTRA, fnCall: false },
  makefile: null, // set below (shell with targets)
  dockerfile: null,
  matlab: { line: ['%'], block: [['%{', '%}']], strings: [DQ, { open: "'", close: "'" }], kw: words('break case catch classdef continue else elseif end for function global if otherwise parfor persistent return spmd switch try while'), lit: words('true false pi inf nan eps') },
  awk: { line: ['#'], strings: [DQ], kw: words('BEGIN END if else while for do break continue next exit return function getline print printf in delete'), vars: '$', shellVars: true },
};
CONFIGS.ts.extra = CONFIGS.js.extra;
CONFIGS.makefile = { ...CONFIGS.bash, extra: [...CONFIGS.bash.extra, ['.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_', /^[\w.%/-]+(?=\s*::?(?!=))/my, 'tk-fn'], ['$', /\$\([^)\n]*\)|\$\{[^}\n]*\}/y, 'tk-anno']] };
CONFIGS.dockerfile = { ...CONFIGS.bash, extra: [['ABCDEFGHIJKLMNOPQRSTUVWXYZ', /^(?:FROM|RUN|CMD|LABEL|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL|AS)\b/my, 'tk-kw'], ...CONFIGS.bash.extra] };

// "/re/" in JavaScript is a regular expression only where an operand may start.
function regexOrOp(m, push) { push('tk-str', m[0]); }
// PlantUML: an arrow of two or more characters; a lone "-" or "o" is text.
function arrowOrText(m, push) { push(m[0].length > 1 || m[0] === '<' || m[0] === '>' ? 'tk-op' : '', m[0]); }

// ---------------------------------------------------------------- markup (HTML, XML, SVG)

function scanMarkup(code, html, out = []) {
  const push = pusher(out);
  const n = code.length;
  let i = 0;
  while (i < n) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      const j = end < 0 ? n : end + 3;
      push('tk-com', code.slice(i, j)); i = j; continue;
    }
    if (code.startsWith('<![CDATA[', i)) {
      const end = code.indexOf(']]>', i);
      const j = end < 0 ? n : end + 3;
      push('tk-str', code.slice(i, j)); i = j; continue;
    }
    if (code.startsWith('<!', i) || code.startsWith('<?', i)) {
      const close = code[i + 1] === '?' ? '?>' : '>';
      const end = code.indexOf(close, i + 2);
      const j = end < 0 ? n : end + close.length;
      push('tk-anno', code.slice(i, j)); i = j; continue;
    }
    if (code[i] === '<' && /[A-Za-z/]/.test(code[i + 1] || '')) {
      const closing = code[i + 1] === '/';
      push('tk-op', closing ? '</' : '<');
      let j = i + (closing ? 2 : 1);
      let k = j;
      while (k < n && /[\w:.-]/.test(code[k])) k++;
      const tag = code.slice(j, k);
      push('tk-kw', tag);
      j = k;
      let selfClosing = false;
      while (j < n && code[j] !== '>') {
        const c = code[j];
        if (isSpace(c)) { let e = j + 1; while (e < n && isSpace(code[e])) e++; push('', code.slice(j, e)); j = e; continue; }
        if (c === '/' && code[j + 1] === '>') { selfClosing = true; break; }
        if (c === '=') { push('tk-op', '='); j++; continue; }
        if (c === '"' || c === "'") {
          const end = code.indexOf(c, j + 1);
          const e = end < 0 ? n : end + 1;
          push('tk-str', code.slice(j, e)); j = e; continue;
        }
        if (c === '<') break; // a broken tag: the next one starts here
        let e = j;
        while (e < n && !isSpace(code[e]) && !'=>"\'<'.includes(code[e]) && !(code[e] === '/' && code[e + 1] === '>')) e++;
        if (e === j) e = j + 1;
        // An unquoted value after "=" is a string; else an attribute name.
        const prev = out[out.length - 1];
        push(prev && prev[0] === 'tk-op' && prev[1].endsWith('=') ? 'tk-str' : 'tk-type', code.slice(j, e));
        j = e;
      }
      if (selfClosing) { push('tk-op', '/>'); j += 2; }
      else if (code[j] === '>') { push('tk-op', '>'); j++; }
      i = j;
      // Script and style elements hold another language.
      const lower = tag.toLowerCase();
      if (html && !closing && !selfClosing && (lower === 'script' || lower === 'style')) {
        const re = new RegExp(`</${lower}\\s*>`, 'ig');
        re.lastIndex = i;
        const m = re.exec(code);
        const end = m ? m.index : n;
        const inner = code.slice(i, end);
        if (lower === 'script') scanGeneric(inner, CONFIGS.js, out); else scanCss(inner, out);
        i = end;
      }
      continue;
    }
    if (code[i] === '&') {
      const m = /&(?:#\d+|#x[\da-fA-F]+|[A-Za-z]\w*);/y;
      m.lastIndex = i;
      const found = m.exec(code);
      if (found) { push('tk-num', found[0]); i += found[0].length; continue; }
    }
    let j = i + 1;
    while (j < n && code[j] !== '<' && code[j] !== '&') j++;
    push('', code.slice(i, j));
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------- CSS (and SCSS, Less)

function scanCss(code, out = []) {
  const push = pusher(out);
  const n = code.length;
  let i = 0, depth = 0, paren = 0;
  // In a block, before ':' a word is a property; after it, a value until ';' or '}'.
  let inValue = false;
  while (i < n) {
    const c = code[i];
    if (isSpace(c)) { let j = i + 1; while (j < n && isSpace(code[j])) j++; push('', code.slice(i, j)); i = j; continue; }
    if (code.startsWith('/*', i)) { const end = code.indexOf('*/', i + 2); const j = end < 0 ? n : end + 2; push('tk-com', code.slice(i, j)); i = j; continue; }
    if (code.startsWith('//', i) && (i === 0 || isSpace(code[i - 1]))) { let j = code.indexOf('\n', i); if (j < 0) j = n; push('tk-com', code.slice(i, j)); i = j; continue; }
    if (c === '"' || c === "'") { i = scanString(code, i, { open: c, close: c, esc: true }, push, false); continue; }
    if (c === '{') { depth++; inValue = false; push('', c); i++; continue; }
    if (c === '}') { depth = Math.max(0, depth - 1); inValue = false; push('', c); i++; continue; }
    if (c === ';') { inValue = false; push('', c); i++; continue; }
    if (c === '(') paren++;
    if (c === ')') paren = Math.max(0, paren - 1);
    if (c === '@') { const m = /@[\w-]+/y; m.lastIndex = i; const f = m.exec(code); if (f) { push('tk-anno', f[0]); i += f[0].length; continue; } }
    if (c === '$' && /[\w-]/.test(code[i + 1] || '')) { const m = /\$[\w-]+/y; m.lastIndex = i; const f = m.exec(code); push('tk-anno', f[0]); i += f[0].length; continue; }
    if (c === '!' && code.startsWith('!important', i)) { push('tk-kw', '!important'); i += 10; continue; }
    const value = depth > 0 && inValue;
    if (c === '#' && value) { const m = /#[\da-fA-F]{3,8}\b/y; m.lastIndex = i; const f = m.exec(code); if (f) { push('tk-num', f[0]); i += f[0].length; continue; } }
    if (isDigit(c) || ((c === '.' || c === '-' || c === '+') && isDigit(code[i + 1] || '') && (value || paren))) {
      const m = /[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?(?:%|[a-zA-Z]+)?/y; m.lastIndex = i; const f = m.exec(code);
      if (f) { push('tk-num', f[0]); i += f[0].length; continue; }
    }
    if (isIdStart(c) || (c === '-' && (isIdStart(code[i + 1] || '') || code[i + 1] === '-'))) {
      const m = /-*[A-Za-z_\u0080-￿][\w\u0080-￿-]*/y; m.lastIndex = i; const f = m.exec(code);
      const w = f[0], j = i + w.length;
      if (code[j] === '(') push('tk-fn', w);
      else if (depth > 0 && !inValue && nextNonSpace(code, j) === ':' && code[nextNonSpaceAt(code, j) + 1] !== ':') {
        // A property (in nested CSS a selector "a:hover" has no space after the colon and a "{" follows: rare enough).
        push('tk-type', w);
      } else if (value || paren) push('', w);
      else push('tk-kw', w); // a tag in a selector
      i = j;
      continue;
    }
    if (c === ':' && depth > 0 && !inValue && !paren) {
      const prev = out[out.length - 1];
      const prevWord = prev && (prev[0] === 'tk-type' || (prev[0] === '' && /^\s+$/.test(prev[1]) && out[out.length - 2]?.[0] === 'tk-type'));
      if (prevWord) { inValue = true; push('tk-op', ':'); i++; continue; }
    }
    if ((c === '.' || c === '#') && !value && /[\w-]/.test(code[i + 1] || '')) {
      const m = /[.#][\w-]+/y; m.lastIndex = i; const f = m.exec(code); push('tk-fn', f[0]); i += f[0].length; continue;
    }
    if (c === ':' && !value) {
      const m = /::?[\w-]+/y; m.lastIndex = i; const f = m.exec(code);
      if (f) { push('tk-anno', f[0]); i += f[0].length; continue; }
    }
    if ('>+~*=|^$,'.includes(c) && !value) { push('tk-op', c); i++; continue; }
    push('', c);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- line-based formats

// Calls each(line, push) for every line, with the newline pushed in between.
function byLine(code, out, each) {
  const push = pusher(out);
  const lines = code.split('\n');
  for (let k = 0; k < lines.length; k++) {
    if (k) push('', '\n');
    each(lines[k], push, k);
  }
  return out;
}

// A scalar value in YAML/TOML/INI: quoted string, number, literal or plain text.
function scalar(text, push, lits) {
  const t = text.trim();
  const lead = text.slice(0, text.indexOf(t[0] ?? '') < 0 ? text.length : text.indexOf(t[0]));
  if (!t) { push('', text); return; }
  push('', lead);
  const rest = text.slice(lead.length);
  let cls = '';
  if (/^(['"]).*\1$/.test(t)) cls = 'tk-str';
  else if (/^[-+]?(?:0x[\da-fA-F]+|0o[0-7]+|0b[01]+|\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+|\.inf|\.nan)$/i.test(t)) cls = 'tk-num';
  else if (lits.has(t.toLowerCase())) cls = 'tk-kw';
  push(cls, rest);
}

// The value part of a YAML line (after "key:" or "- "): comments, anchors, tags, flow items.
function yamlValue(text, push) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (isSpace(c)) { let j = i + 1; while (j < n && isSpace(text[j])) j++; push('', text.slice(i, j)); i = j; continue; }
    if (c === '#' && (i === 0 || isSpace(text[i - 1]))) { push('tk-com', text.slice(i)); return; }
    if (c === '"' || c === "'") { i = scanString(text, i, { open: c, close: c, esc: c === '"' }, push, false); continue; }
    if ((c === '&' || c === '*') && /\w/.test(text[i + 1] || '')) { const m = /[&*][\w-]+/y; m.lastIndex = i; const f = m.exec(text); push('tk-anno', f[0]); i += f[0].length; continue; }
    if (c === '!') { const m = /!!?[\w-]*/y; m.lastIndex = i; const f = m.exec(text); push('tk-anno', f[0]); i += f[0].length; continue; }
    if ('[]{},'.includes(c)) { push('tk-op', c); i++; continue; }
    if ((c === '|' || c === '>') && /^[|>][-+]?\d*\s*(?:#.*)?$/.test(text.slice(i))) { const m = /[|>][-+]?\d*/y; m.lastIndex = i; const f = m.exec(text); push('tk-op', f[0]); i += f[0].length; continue; }
    // A plain scalar: up to a comment, or a flow separator inside [ ] / { }.
    let j = i;
    while (j < n && !(text[j] === '#' && isSpace(text[j - 1] || ' ')) && !',[]{}'.includes(text[j])) j++;
    // Trailing spaces belong to the next token.
    let e = j;
    while (e > i && isSpace(text[e - 1])) e--;
    const part = text.slice(i, e);
    const key = /^([^:]+?)(\s*:)(?=\s|$)/.exec(part);
    if (key) { push('tk-type', key[1]); push('tk-op', key[2].trim() === ':' ? key[2] : key[2]); i += key[0].length; continue; }
    scalar(part, push, YAML_LIT);
    i = e;
  }
}
const YAML_LIT = words('true false null yes no on off ~');

function scanYaml(code, out = []) {
  let block = -1; // the indent of a block scalar's key ("key: |"), while its lines go on
  return byLine(code, out, (line, push) => {
    const indent = line.length - line.trimStart().length;
    if (block >= 0) {
      if (!line.trim() || indent > block) { push('tk-str', line); return; }
      block = -1;
    }
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(line)) { push('tk-op', line.slice(0, 3)); yamlValue(line.slice(3), push); return; }
    if (/^\s*#/.test(line)) { push('', line.slice(0, indent)); push('tk-com', line.slice(indent)); return; }
    if (/^\s*%/.test(line)) { push('tk-anno', line); return; }
    push('', line.slice(0, indent));
    let rest = line.slice(indent);
    // List markers.
    for (let m; (m = /^-(?:\s+|$)/.exec(rest));) { push('tk-op', '-'); push('', m[0].slice(1)); rest = rest.slice(m[0].length); }
    const key = /^((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s#'"[\]{},][^:#]*?|\?))(\s*:)(?=\s|$)/.exec(rest);
    if (key) {
      push('tk-type', key[1]);
      push('tk-op', key[2]);
      rest = rest.slice(key[0].length);
    }
    if (/^\s*[|>][-+]?\d*\s*(?:#.*)?$/.test(rest)) block = indent;
    yamlValue(rest, push);
  });
}

const INI_LIT = words('true false yes no on off null none');
function scanIni(code, out = [], toml = false) {
  let multi = '';
  return byLine(code, out, (line, push) => {
    if (multi) {
      const end = line.indexOf(multi);
      if (end < 0) { push('tk-str', line); return; }
      push('tk-str', line.slice(0, end + 3)); multi = '';
      line = line.slice(end + 3);
      if (!line) return;
    }
    const indent = line.length - line.trimStart().length;
    const t = line.slice(indent);
    push('', line.slice(0, indent));
    if (/^[#;]/.test(t)) { push('tk-com', t); return; }
    if (/^\[\[?[^\]]*\]\]?/.test(t)) { const m = /^\[\[?[^\]]*\]\]?/.exec(t); push('tk-kw', m[0]); push('tk-com', t.slice(m[0].length)); return; }
    const kv = /^([^=:\s][^=:]*?|"[^"]*")(\s*[=:]\s*)(.*)$/.exec(t);
    if (!kv) { push('', t); return; }
    push('tk-type', kv[1]);
    push('tk-op', kv[2]);
    let value = kv[3];
    if (toml && /^("""|''')/.test(value) && value.indexOf(value.slice(0, 3), 3) < 0) { multi = value.slice(0, 3); push('tk-str', value); return; }
    // A trailing comment.
    const hash = toml ? value.search(/\s#|^#/) : value.search(/\s[#;]/);
    const comment = hash >= 0 && !/^["']/.test(value.trim()) ? value.slice(hash) : '';
    if (comment) value = value.slice(0, hash);
    if (toml && /[[{]/.test(value.trim()[0] || '')) scanGeneric(value, TOML_VALUE).forEach(([c, x]) => push(c, x));
    else scalar(value, push, INI_LIT);
    push('tk-com', comment);
  });
}
const TOML_VALUE = { line: ['#'], strings: [DQ, { open: "'", close: "'" }], lit: words('true false inf nan'), fnCall: false, keys: false };

function scanDiff(code, out = []) {
  return byLine(code, out, (line, push) => {
    if (/^(?:diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line)) push('tk-kw', line);
    else if (line.startsWith('@@')) { const m = /^@@[^@]*@@/.exec(line); push('tk-fn', m ? m[0] : line); if (m) push('tk-com', line.slice(m[0].length)); }
    else if (line.startsWith('+')) push('tk-str', line);
    else if (line.startsWith('-')) push('tk-anno', line);
    else push('', line);
  });
}

// Assembly (x86 GAS/NASM, ARM, RISC-V, MIPS): labels, the mnemonic, registers, numbers.
const REGISTERS = /^(?:[re]?[abcd]x|[abcd][lh]|[re]?(?:si|di|sp|bp|ip)|[sd]il|[bs]pl|r\d{1,2}[dwb]?|[xwqdsbhv]\d{1,2}|xmm\d+|ymm\d+|zmm\d+|[cdefgs]s|[re]?flags|sp|lr|pc|fp|zero|ra|gp|tp|[atsv]\d{1,2}|k[01]|f[a-z]?\d{1,2}|cpsr|spsr|apsr|xzr|wzr)$/i;
function scanAsm(code, out = []) {
  return byLine(code, out, (line, push) => {
    let i = 0, mnemonic = true;
    const n = line.length;
    while (i < n) {
      const c = line[i];
      if (isSpace(c)) { let j = i + 1; while (j < n && isSpace(line[j])) j++; push('', line.slice(i, j)); i = j; continue; }
      if (c === ';' || line.startsWith('//', i) || (c === '#' && !/[\d-]/.test(line[i + 1] || '') && !line.startsWith('#0x', i)) || (c === '@' && i === line.search(/\S/))) { push('tk-com', line.slice(i)); return; }
      if (line.startsWith('/*', i)) { const end = line.indexOf('*/', i + 2); const j = end < 0 ? n : end + 2; push('tk-com', line.slice(i, j)); i = j; continue; }
      if (c === '"' || c === "'") { i = scanString(line, i, { open: c, close: c, esc: true }, push, false); continue; }
      const num = /#?[-+]?(?:0x[\da-fA-F]+|0b[01]+|\d[\da-fA-F]*[hHbB]?|\d+)\b/y; num.lastIndex = i;
      if (/[#\d$-]/.test(c) || (c === '+' && isDigit(line[i + 1] || ''))) {
        const f = num.exec(line);
        if (f && !(c === '$' || c === '-' ? false : false)) { push('tk-num', f[0]); i += f[0].length; mnemonic = false; continue; }
      }
      if (c === '$' && /[\d-]/.test(line[i + 1] || '')) { const m = /\$-?(?:0x[\da-fA-F]+|\d+)/y; m.lastIndex = i; const f = m.exec(line); if (f) { push('tk-num', f[0]); i += f[0].length; continue; } }
      if ((c === '%' || c === '$') && isIdStart(line[i + 1] || '')) { const m = /[%$][A-Za-z_]\w*/y; m.lastIndex = i; const f = m.exec(line); push('tk-type', f[0]); i += f[0].length; mnemonic = false; continue; }
      if (isIdStart(c) || c === '.') {
        const m = /\.?[A-Za-z_$][\w.$]*/y; m.lastIndex = i; const f = m.exec(line);
        if (!f) { push('', c); i++; continue; }
        const w = f[0], j = i + w.length;
        if (line[j] === ':') { push('tk-fn', w + ':'); i = j + 1; continue; }
        if (w[0] === '.') push('tk-anno', w);
        else if (REGISTERS.test(w)) push('tk-type', w);
        else if (mnemonic) push('tk-kw', w);
        else push('', w);
        if (w[0] !== '.' || mnemonic) mnemonic = false;
        i = j;
        continue;
      }
      if ('+-*/,[]!{}()'.includes(c)) { push(c === ',' ? '' : 'tk-op', c); i++; continue; }
      push('', c);
      i++;
    }
  });
}

// Markdown source: headings, emphasis marks, code (fenced blocks in their own language),
// links, lists and quotes.
function scanMarkdown(code, out = []) {
  const push = pusher(out);
  const lines = code.split('\n');
  for (let k = 0; k < lines.length; k++) {
    if (k) push('', '\n');
    const line = lines[k];
    const fence = /^(\s{0,3})(`{3,}|~{3,})\s*(\{\s*[\w+#.-]+|[\w+#.-]*)(.*)$/.exec(line);
    if (fence) {
      const langTok = fence[3].replace(/^\{\s*/, '');
      push('', fence[1]); push('tk-op', fence[2]); push('tk-anno', fence[3]); push('', fence[4]);
      // The block up to its closing fence, highlighted in its language.
      const body = [];
      let e = k + 1;
      const closer = new RegExp(`^\\s{0,3}${fence[2][0] === '`' ? '`' : '~'}{${fence[2].length},}\\s*$`);
      while (e < lines.length && !closer.test(lines[e])) body.push(lines[e++]);
      if (body.length) {
        push('', '\n');
        const lang = resolveLang(langTok);
        const inner = lang ? tokenize(body.join('\n'), lang) : [['', body.join('\n')]];
        for (const [c, t] of inner) push(c, t);
      }
      if (e < lines.length) { push('', '\n'); push('tk-op', lines[e]); }
      k = e;
      continue;
    }
    const heading = /^(\s{0,3}#{1,6})(\s.*|$)/.exec(line);
    if (heading) { push('tk-kw', line); continue; }
    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) { push('tk-op', line); continue; }
    let rest = line;
    const quote = /^\s{0,3}(?:>\s?)+/.exec(rest);
    if (quote) { push('tk-com', quote[0]); rest = rest.slice(quote[0].length); }
    const list = /^\s*(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?\s+/.exec(rest);
    if (list) { push('tk-op', list[0]); rest = rest.slice(list[0].length); }
    markdownInline(rest, push);
  }
  return out;
}
function markdownInline(text, push) {
  const re = /(`+)([\s\S]*?)\1|(!?\[)([^\]\n]*)(\]\()([^)\s]*)((?:\s+"[^"]*")?\))|(\*\*|__)(?=\S)|(?<=\S)(\*\*|__)|<!--.*?-->|(\$)[^$\n]+\$|\|/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    push('', text.slice(at, m.index));
    if (m[1]) push('tk-str', m[0]);
    else if (m[3]) { push('tk-op', m[3]); push('tk-fn', m[4]); push('tk-op', m[5]); push('tk-str', m[6]); push('tk-op', m[7]); }
    else if (m[8] || m[9]) push('tk-op', m[0]);
    else if (m[0].startsWith('<!--')) push('tk-com', m[0]);
    else if (m[10]) push('tk-num', m[0]);
    else push('tk-op', m[0]);
    at = m.index + m[0].length;
  }
  push('', text.slice(at));
}

// ---------------------------------------------------------------- language ids

const ALIASES = {
  java: 'java', jav: 'java', jsh: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', 'h++': 'cpp', ino: 'cpp', arduino: 'cpp', cu: 'cpp', cuda: 'cpp',
  csharp: 'csharp', cs: 'csharp', 'c#': 'csharp',
  js: 'js', javascript: 'js', mjs: 'js', cjs: 'js', jsx: 'js', node: 'js', es6: 'js',
  ts: 'ts', typescript: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  python: 'python', py: 'python', python3: 'python', py3: 'python', pyw: 'python', pyi: 'python', gyp: 'python', sage: 'python', ipython: 'python',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', ksh: 'bash', fish: 'bash', console: 'bash', shellscript: 'bash', shellsession: 'bash', terminal: 'bash', env: 'bash', bashrc: 'bash', zshrc: 'bash', profile: 'bash',
  json: 'json', jsonc: 'json', json5: 'json', geojson: 'json', webmanifest: 'json', ipynb: 'json',
  sql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql', psql: 'sql', pgsql: 'sql', sqlite: 'sql', plsql: 'sql', tsql: 'sql', mariadb: 'sql',
  rust: 'rust', rs: 'rust',
  go: 'go', golang: 'go',
  kotlin: 'kotlin', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  php: 'php',
  ruby: 'ruby', rb: 'ruby', gemfile: 'ruby', rake: 'ruby',
  lua: 'lua',
  r: 'r', rscript: 'r',
  html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', plist: 'xml', rss: 'xml', atom: 'xml', pom: 'xml', drawio: 'xml', xaml: 'xml', csproj: 'xml', fxml: 'xml',
  css: 'css', scss: 'css', less: 'css', sass: 'css', pcss: 'css',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  ini: 'ini', conf: 'ini', cfg: 'ini', properties: 'ini', editorconfig: 'ini', gitconfig: 'ini', desktop: 'ini', service: 'ini',
  markdown: 'markdown', md: 'markdown', mdown: 'markdown', mkd: 'markdown', rmd: 'markdown', qmd: 'markdown',
  plantuml: 'plantuml', puml: 'plantuml', pu: 'plantuml', iuml: 'plantuml', wsd: 'plantuml', uml: 'plantuml',
  diff: 'diff', patch: 'diff',
  asm: 'asm', s: 'asm', nasm: 'asm', x86asm: 'asm', armasm: 'asm', arm: 'asm', riscv: 'asm', mips: 'asm', gas: 'asm', assembly: 'asm',
  vhdl: 'vhdl', vhd: 'vhdl',
  verilog: 'verilog', v: 'verilog', sv: 'verilog', systemverilog: 'verilog', svh: 'verilog',
  tex: 'tex', latex: 'tex', sty: 'tex', cls: 'tex', bib: 'tex', bibtex: 'tex',
  makefile: 'makefile', make: 'makefile', mk: 'makefile', mak: 'makefile', gnumakefile: 'makefile',
  dockerfile: 'dockerfile', docker: 'dockerfile', containerfile: 'dockerfile',
  matlab: 'matlab', octave: 'matlab', m: 'matlab',
  awk: 'awk', gawk: 'awk',
};
// Language names shown on code blocks.
const NAMES = {
  java: 'Java', c: 'C', cpp: 'C++', csharp: 'C#', js: 'JavaScript', ts: 'TypeScript', python: 'Python', bash: 'Shell', json: 'JSON', sql: 'SQL',
  rust: 'Rust', go: 'Go', kotlin: 'Kotlin', swift: 'Swift', php: 'PHP', ruby: 'Ruby', lua: 'Lua', r: 'R', html: 'HTML', xml: 'XML', css: 'CSS',
  yaml: 'YAML', toml: 'TOML', ini: 'INI', markdown: 'Markdown', plantuml: 'PlantUML', diff: 'Diff', asm: 'Assembly', vhdl: 'VHDL',
  verilog: 'Verilog', tex: 'LaTeX', makefile: 'Makefile', dockerfile: 'Dockerfile', matlab: 'MATLAB', awk: 'AWK',
};

const PLAIN = new Set(['text', 'txt', 'plain', 'plaintext', 'none', 'nohighlight', 'output', 'log', 'csv', 'tsv']);

// The lang id for a name or alias ('Py', 'c++', 'language-java'), or '' when unknown.
export function resolveLang(lang) {
  const key = String(lang || '').trim().toLowerCase().replace(/^(?:language|lang)-/, '').replace(/\{.*$/, '');
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : '';
}
export const langName = (lang) => NAMES[resolveLang(lang)] || String(lang || '');

// The language of a file by its name: extension, or a known whole name (Makefile, Dockerfile).
export function langFromName(name) {
  const base = String(name || '').split(/[/\\]/).pop().toLowerCase();
  if (!base) return '';
  if (/^(?:gnu)?makefile$/.test(base)) return 'makefile';
  if (/^(?:docker|container)file$/.test(base) || base.endsWith('.dockerfile')) return 'dockerfile';
  if (/^\.(?:bashrc|zshrc|profile|bash_profile|zprofile|env)$/.test(base)) return 'bash';
  if (base === '.gitconfig' || base === '.editorconfig') return 'ini';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 && !base.startsWith('.')) return '';
  const ext = base.slice(dot + 1);
  // Plain-text kinds stay plain (markdown is shown by its own renderer).
  return resolveLang(ext);
}

function tokenize(code, lang) {
  switch (lang) {
    case 'html': return scanMarkup(code, true);
    case 'xml': return scanMarkup(code, false);
    case 'css': return scanCss(code);
    case 'yaml': return scanYaml(code);
    case 'toml': return scanIni(code, [], true);
    case 'ini': return scanIni(code, [], false);
    case 'diff': return scanDiff(code);
    case 'asm': return scanAsm(code);
    case 'markdown': return scanMarkdown(code);
    default: {
      const cfg = CONFIGS[lang];
      return cfg ? scanGeneric(code, cfg) : [['', code]];
    }
  }
}

// ---------------------------------------------------------------- public API

// Escaped HTML with coloured spans; unknown languages come back as escaped text.
export function highlight(code, lang) {
  const text = String(code ?? '');
  const id = resolveLang(lang);
  if (!id || PLAIN.has(id)) return escapeHtml(text);
  let html = '';
  for (const [cls, t] of tokenize(text, id)) html += cls ? `<span class="${cls}">${escapeHtml(t)}</span>` : escapeHtml(t);
  return html;
}

// One HTML string per source line; a token that spans lines is closed and reopened.
export function highlightLines(code, lang) {
  const text = String(code ?? '');
  const id = resolveLang(lang);
  const tokens = id && !PLAIN.has(id) ? tokenize(text, id) : [['', text]];
  const lines = [''];
  for (const [cls, t] of tokens) {
    const parts = t.split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (p) lines.push('');
      if (!parts[p]) continue;
      lines[lines.length - 1] += cls ? `<span class="${cls}">${escapeHtml(parts[p])}</span>` : escapeHtml(parts[p]);
    }
  }
  return lines;
}

// ---------------------------------------------------------------- the editor
//
// codeEditor(host, { value, lang, onChange, readOnly, autoClose = true, className, inputClass,
//   label }) puts a <textarea> over a <pre> holding the highlighted text, in `host`. The
// textarea keeps everything native (selection, undo, IME, touch and pen, spellcheck off);
// its text is transparent, so the colours behind show through, and the backdrop follows its
// scrolling. Tab inserts 4 spaces (or indents the selected lines), Shift+Tab outdents, Enter
// keeps the line's indentation (one level more after { ( [ or a Python ':'), brackets and
// quotes close themselves (autoClose). Esc then Tab leaves the editor (keyboard users).
// Returns { get value(), set value(v), setLang(l), focus(), destroy(), textarea }.

const INDENT = '    ';
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}']);

export function codeEditor(host, { value = '', lang = '', onChange = null, readOnly = false, autoClose = true, className = '', inputClass = '', label = 'Code' } = {}) {
  const doc = host.ownerDocument;
  ensureStyles(doc);
  const wrap = doc.createElement('div');
  wrap.className = `code-editor${className ? ` ${className}` : ''}`;
  const back = doc.createElement('pre');
  back.className = 'code-editor-back';
  back.setAttribute('aria-hidden', 'true');
  const inner = doc.createElement('code');
  inner.className = 'code-editor-text';
  back.append(inner);
  const area = doc.createElement('textarea');
  area.className = `code-editor-input${inputClass ? ` ${inputClass}` : ''}`;
  area.spellcheck = false;
  area.autocomplete = 'off';
  area.setAttribute('autocapitalize', 'off');
  area.setAttribute('autocorrect', 'off');
  area.setAttribute('wrap', 'off');
  area.setAttribute('aria-label', label);
  area.readOnly = !!readOnly;
  area.value = String(value ?? '');
  wrap.append(back, area);
  host.append(wrap);
  let current = resolveLang(lang);
  let painted = null, frame = 0, escaped = false, alive = true;
  const ctl = new AbortController();
  const on = (target, type, fn, opts = {}) => target.addEventListener(type, fn, { ...opts, signal: ctl.signal });

  const paint = () => {
    frame = 0;
    if (!alive) return;
    const text = area.value;
    if (text === painted?.text && current === painted?.lang) return;
    // A trailing newline needs a line of its own behind the textarea.
    inner.innerHTML = highlight(text, current) + (text.endsWith('\n') || !text ? ' ' : '');
    painted = { text, lang: current };
    sync();
  };
  const sync = () => { inner.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`; };
  const changed = () => { paint(); onChange?.(area.value); };

  // Edits go through insertText so the browser's undo keeps them; setRangeText where it is missing.
  const replace = (from, to, text, selStart = from + text.length, selEnd = selStart) => {
    area.focus();
    area.setSelectionRange(from, to);
    let done = false;
    try { done = doc.execCommand?.('insertText', false, text); } catch { done = false; }
    if (!done || area.value.slice(from, from + text.length) !== text) {
      area.setRangeText(text, from, to, 'end');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
    area.setSelectionRange(selStart, selEnd);
  };
  const lineStartOf = (pos) => area.value.lastIndexOf('\n', pos - 1) + 1;

  function indentLines(outdent) {
    const v = area.value, s = area.selectionStart, e = area.selectionEnd;
    const from = lineStartOf(s);
    // A selection ending at a line's start does not take that line.
    const lastEnd = e > s && v[e - 1] === '\n' ? e - 1 : e;
    let to = v.indexOf('\n', lastEnd);
    if (to < 0) to = v.length;
    const lines = v.slice(from, to).split('\n');
    let firstDelta = 0, total = 0;
    const next = lines.map((l, idx) => {
      if (!outdent) { if (idx === 0) firstDelta = INDENT.length; total += INDENT.length; return INDENT + l; }
      const m = /^(?: {1,4}|\t)/.exec(l);
      const cut = m ? m[0].length : 0;
      if (idx === 0) firstDelta = -cut;
      total -= cut;
      return l.slice(cut);
    }).join('\n');
    if (next === v.slice(from, to)) return;
    const selStart = Math.max(from, s + firstDelta);
    replace(from, to, next, s === e ? selStart : selStart, s === e ? selStart : Math.max(selStart, e + total));
  }

  on(area, 'keydown', (event) => {
    if (event.isComposing || event.keyCode === 229 || area.readOnly) return;
    const { key } = event;
    if (key === 'Escape') { escaped = true; return; }
    if (key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (escaped) { escaped = false; return; }
      event.preventDefault();
      const s = area.selectionStart, e = area.selectionEnd;
      if (event.shiftKey || area.value.slice(s, e).includes('\n')) indentLines(event.shiftKey);
      else {
        // Up to the next multiple of four columns.
        const col = s - lineStartOf(s);
        replace(s, e, ' '.repeat(INDENT.length - (col % INDENT.length)));
      }
      return;
    }
    escaped = false;
    if (key === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      const v = area.value, s = area.selectionStart, e = area.selectionEnd;
      const line = v.slice(lineStartOf(s), s);
      const indent = /^[ \t]*/.exec(line)[0];
      const before = line.trimEnd().slice(-1);
      const after = v[e] || '';
      const opens = '{[('.includes(before) && before !== '' || (current === 'python' && before === ':');
      event.preventDefault();
      if (opens && CLOSERS.has(after) && PAIRS[before] === after) {
        // Between a pair: the closer goes on a line of its own.
        const text = `\n${indent}${INDENT}\n${indent}`;
        replace(s, e, text, s + 1 + indent.length + INDENT.length);
      } else {
        replace(s, e, `\n${indent}${opens ? INDENT : ''}`);
      }
      return;
    }
    if (key === 'Backspace' && autoClose) {
      const s = area.selectionStart;
      if (s === area.selectionEnd && s > 0 && PAIRS[area.value[s - 1]] && PAIRS[area.value[s - 1]] === area.value[s]) {
        event.preventDefault();
        replace(s - 1, s + 1, '');
        return;
      }
    }
    if (autoClose && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const s = area.selectionStart, e = area.selectionEnd, v = area.value;
      // Typing a closer that is already there steps over it.
      if (s === e && (CLOSERS.has(key) || key === '"' || key === "'" || key === '`') && v[s] === key) {
        const pairs = key === '"' || key === "'" || key === '`';
        if (!pairs || v[s - 1] !== '\\') { event.preventDefault(); area.setSelectionRange(s + 1, s + 1); return; }
      }
      if (PAIRS[key]) {
        const quote = key === '"' || key === "'" || key === '`';
        const prev = v[s - 1] || '', next = v[e] || '';
        // Quotes pair only between non-word characters (not in "don't"); brackets before space/closers.
        const okNext = !next || isSpace(next) || CLOSERS.has(next) || ',;:'.includes(next);
        const okPrev = !quote || (!isId(prev) && prev !== '\\' && prev !== key);
        if (s !== e) {
          event.preventDefault();
          const sel = v.slice(s, e);
          replace(s, e, key + sel + PAIRS[key], s + 1, e + 1);
          return;
        }
        if (okNext && okPrev && !(key === '`' && current !== 'js' && current !== 'ts' && current !== 'markdown' && current !== 'go')
          && !(key === "'" && (current === 'rust' || current === 'markdown' || current === 'plantuml'))) {
          event.preventDefault();
          replace(s, e, key + PAIRS[key], s + 1);
        }
      }
    }
  });
  on(area, 'input', changed);
  on(area, 'scroll', sync, { passive: true });
  // IME: the composing text shows through the textarea as the browser draws it; the colours
  // follow once composition ends (an input event comes then too).
  on(area, 'compositionend', () => { if (!frame) frame = requestAnimationFrame(paint); });
  paint();

  return {
    get value() { return area.value; },
    set value(v) {
      const text = String(v ?? '');
      if (text === area.value) return;
      area.value = text;
      paint();
    },
    setLang(l) { current = resolveLang(l); painted = null; paint(); },
    focus() { area.focus(); },
    destroy() {
      if (!alive) return;
      alive = false;
      ctl.abort();
      if (frame) cancelAnimationFrame(frame);
      wrap.remove();
    },
    textarea: area,
    element: wrap,
  };
}

// ---------------------------------------------------------------- an existing textarea, coloured
//
// colorTextarea(textarea, lang): the same backdrop for a textarea that other code already
// owns (the UML editor's PlantUML pane): it is wrapped in place, its letters made transparent,
// and its font and padding copied to the copy behind. Typing repaints; after setting .value in
// code, call paint(). Returns { paint(), setLang(l), destroy() } (destroy puts it back as it was).
const METRICS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'textIndent'];
export function colorTextarea(textarea, lang) {
  const doc = textarea.ownerDocument;
  ensureStyles(doc);
  const wrap = doc.createElement('div');
  wrap.className = 'code-color';
  const back = doc.createElement('pre');
  back.className = 'code-color-back';
  back.setAttribute('aria-hidden', 'true');
  const inner = doc.createElement('code');
  back.append(inner);
  textarea.replaceWith(wrap);
  wrap.append(back, textarea);
  textarea.classList.add('code-color-input');
  let current = resolveLang(lang), copied = false, last = null;
  const copyMetrics = () => {
    if (copied || !textarea.isConnected) return;
    const cs = doc.defaultView.getComputedStyle(textarea);
    if (!cs.fontSize) return;
    for (const k of METRICS) back.style[k] = cs[k];
    back.style.borderStyle = 'solid';
    back.style.borderColor = 'transparent';
    back.style.borderRightWidth = back.style.borderBottomWidth = '0';
    copied = true;
  };
  const follow = () => { inner.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`; };
  const paint = () => {
    copyMetrics();
    const text = textarea.value;
    if (last !== text) { inner.innerHTML = highlight(text, current) + (text.endsWith('\n') ? ' ' : ''); last = text; }
    follow();
  };
  textarea.addEventListener('input', paint);
  textarea.addEventListener('scroll', follow, { passive: true });
  textarea.addEventListener('focus', paint);
  paint();
  return {
    paint,
    setLang(l) { current = resolveLang(l); last = null; paint(); },
    destroy() {
      textarea.removeEventListener('input', paint);
      textarea.removeEventListener('scroll', follow);
      textarea.removeEventListener('focus', paint);
      textarea.classList.remove('code-color-input');
      wrap.replaceWith(textarea);
    },
  };
}

// ---------------------------------------------------------------- Markdown code blocks

const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// Text to the clipboard: the async API, else a hidden textarea and execCommand('copy').
export async function copyText(text, doc = globalThis.document) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback below. */ }
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  doc.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = doc.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// Rendered Markdown's fenced code (<pre><code class="language-java">): coloured by its
// language, with its name on top (a CSS label: no text joins the document, so Find and
// study passages see only the code) and a copy button. Blocks done before are skipped.
export function decorateCodeBlocks(root, { maxChars = 400000 } = {}) {
  const blocks = root.querySelectorAll('pre > code');
  if (!blocks.length) return 0;
  const doc = root.ownerDocument;
  ensureStyles(doc);
  let done = 0;
  for (const code of blocks) {
    const pre = code.parentElement;
    if (pre.classList.contains('code-block')) continue;
    const named = [...code.classList].find((c) => /^language-/.test(c)) || '';
    const raw = named.slice(9);
    const lang = resolveLang(raw);
    const source = code.textContent;
    if (lang && source.length <= maxChars) {
      code.innerHTML = highlight(source, lang);
      code.classList.add('code-highlighted');
    }
    pre.classList.add('code-block');
    const shown = lang ? NAMES[lang] : raw && !PLAIN.has(raw.toLowerCase()) ? raw : '';
    if (shown) pre.dataset.lang = shown;
    const copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.title = 'Copy code';
    copy.setAttribute('aria-label', shown ? `Copy ${shown} code` : 'Copy code');
    copy.innerHTML = COPY_ICON;
    copy.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = await copyText(source.replace(/\n$/, ''), doc);
      copy.innerHTML = ok ? DONE_ICON : COPY_ICON;
      copy.classList.toggle('copied', ok);
      copy.title = ok ? 'Copied' : 'Could not copy: select the code and copy it';
      setTimeout(() => { copy.innerHTML = COPY_ICON; copy.classList.remove('copied'); copy.title = 'Copy code'; }, 1400);
    });
    pre.prepend(copy);
    done++;
  }
  return done;
}

export { escapeHtml };
