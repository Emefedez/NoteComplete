import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight, highlightLines, resolveLang, langFromName, langName } from './code-highlight.js';

// The tokens of a highlight as [class, text] pairs (plain text left out).
const tokens = (code, lang) => [...highlight(code, lang).matchAll(/<span class="tk-(\w+)">([^<]*)<\/span>/g)]
  .map(([, cls, text]) => [cls, text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')]);
const has = (code, lang, cls, text) => assert.ok(tokens(code, lang).some(([c, t]) => c === cls && t === text), `${lang}: ${text} as tk-${cls} in ${JSON.stringify(tokens(code, lang))}`);
const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('Java: keywords, types, strings, numbers, comments, calls, annotations, operators', () => {
  const code = '@Override\npublic static int sum(int[] a) { // total\n  String s = "x"; char c = \'y\';\n  return Math.max(0x1F, 3.5e2) + a.length; /* end */\n}';
  has(code, 'java', 'anno', '@Override');
  has(code, 'java', 'kw', 'public');
  has(code, 'java', 'kw', 'return');
  has(code, 'java', 'type', 'int');
  has(code, 'java', 'type', 'String');
  has(code, 'java', 'type', 'Math');
  has(code, 'java', 'fn', 'sum');
  has(code, 'java', 'fn', 'max');
  has(code, 'java', 'str', '"x"');
  has(code, 'java', 'str', "'y'");
  has(code, 'java', 'num', '0x1F');
  has(code, 'java', 'num', '3.5e2');
  has(code, 'java', 'com', '// total');
  has(code, 'java', 'com', '/* end */');
  has(code, 'java', 'op', '+');
  has('String t = """\n  hi\n  """;', 'java', 'str', '"""\n  hi\n  """');
});

test('C and C++: preprocessor, includes, types', () => {
  has('#include <stdio.h>\nint main(void) { printf("%d\\n", 1); }', 'c', 'anno', '#include');
  has('#include <stdio.h>\n', 'c', 'str', '<stdio.h>');
  has('size_t n = sizeof(int);', 'c', 'type', 'size_t');
  has('size_t n = sizeof(int);', 'c', 'kw', 'sizeof');
  has('std::vector<int> v; template <typename T> class A {};', 'cpp', 'kw', 'template');
  has('auto s = R"(raw "text")";', 'cpp', 'str', 'R"(raw "text")"');
  has('nullptr', 'c++', 'kw', 'nullptr');
});

test('JavaScript and TypeScript', () => {
  has('const re = /a+b/g; let x = a / b;', 'js', 'str', '/a+b/g');
  has('const re = /a+b/g; let x = a / b;', 'js', 'op', '/');
  has('const t = `a ${b}`;', 'javascript', 'str', '`a ${b}`');
  has('async function f() { await g(); }', 'js', 'kw', 'await');
  has('interface A { x: number }', 'ts', 'kw', 'interface');
  has('interface A { x: number }', 'ts', 'type', 'number');
  has('let u = undefined;', 'ts', 'kw', 'undefined');
});

test('Python, shell, JSON, SQL', () => {
  has('def f(x):\n    return r"\\d" # c', 'python', 'kw', 'def');
  has('def f(x):\n    return r"\\d" # c', 'py', 'str', 'r"\\d"');
  has('def f(x):\n    return r"\\d" # c', 'python', 'com', '# c');
  has('s = """a\nb"""', 'python', 'str', '"""a\nb"""');
  has('print(None)', 'python', 'fn', 'print');
  has('print(None)', 'python', 'kw', 'None');
  has('@dataclass\nclass A: pass', 'python', 'anno', '@dataclass');
  has('#!/bin/sh\nfor f in *.md; do echo "$f"; done', 'sh', 'anno', '#!/bin/sh');
  has('for f in *.md; do echo "$f" ${HOME}; done # c', 'bash', 'kw', 'done');
  has('for f in *.md; do echo "$f" ${HOME}; done # c', 'shell', 'anno', '${HOME}');
  has('for f in *.md; do echo "$f" ${HOME}; done # c', 'zsh', 'com', '# c');
  // A # inside a word is not a comment.
  assert.ok(!tokens('echo a#b', 'bash').some(([c]) => c === 'com'));
  has('{"key": [1, true, null, "v"]}', 'json', 'type', '"key"');
  has('{"key": [1, true, null, "v"]}', 'json', 'str', '"v"');
  has('{"key": [1, true, null, "v"]}', 'json', 'kw', 'null');
  has('{"key": -1.5e3}', 'json', 'num', '1.5e3');
  has("select name from users where id = 'x' -- c", 'sql', 'kw', 'select');
  has("SELECT COUNT(*) FROM t", 'sql', 'fn', 'COUNT');
  has("create table t (id integer)", 'sql', 'type', 'integer');
  has("SELECT 1 -- c", 'sql', 'com', '-- c');
});

test('Rust, Go, Kotlin, C#', () => {
  has('fn main() { let s: &\'static str = r#"x"#; println!("{}", \'c\'); }', 'rust', 'anno', "'static");
  has('fn main() { let s: &\'static str = r#"x"#; println!("{}", \'c\'); }', 'rs', 'str', 'r#"x"#');
  has('fn main() { let s: &\'static str = r#"x"#; println!("{}", \'c\'); }', 'rust', 'fn', 'println!');
  has('#[derive(Debug)]\nstruct A;', 'rust', 'anno', '#[derive(Debug)]');
  has('func main() { fmt.Println(`raw`) }', 'go', 'str', '`raw`');
  has('func main() { fmt.Println(`raw`) }', 'golang', 'kw', 'func');
  has('fun f(x: Int): String = "a"', 'kotlin', 'kw', 'fun');
  has('fun f(x: Int): String = "a"', 'kt', 'type', 'Int');
  has('public class A { string s = $"x{1}"; }', 'cs', 'str', '$"x{1}"');
});

test('markup, CSS, YAML, TOML, Markdown, PlantUML, diff, assembly, VHDL, Verilog', () => {
  const html = '<div class="a" id=x>&amp;<!-- c --></div><script>let a = 1;</script>';
  has(html, 'html', 'kw', 'div');
  has(html, 'html', 'type', 'class');
  has(html, 'html', 'str', '"a"');
  has(html, 'html', 'com', '<!-- c -->');
  has(html, 'html', 'num', '&amp;');
  has(html, 'html', 'kw', 'let');
  has('<?xml version="1.0"?><a b="c"/>', 'xml', 'anno', '<?xml version="1.0"?>');
  has('.a > b:hover { color: #fff; margin: 0 4px !important; } @media print {}', 'css', 'fn', '.a');
  has('.a > b:hover { color: #fff; margin: 0 4px !important; }', 'css', 'type', 'color');
  has('.a > b:hover { color: #fff; margin: 0 4px !important; }', 'scss', 'num', '4px');
  has('.a { color: #fff }', 'css', 'num', '#fff');
  has('@media print {}', 'css', 'anno', '@media');
  const yaml = 'name: app # c\nlist:\n  - 1\n  - "s"\nok: true\ntext: |\n  line one\nref: *base';
  has(yaml, 'yaml', 'type', 'name');
  has(yaml, 'yml', 'com', '# c');
  has(yaml, 'yaml', 'num', '1');
  has(yaml, 'yaml', 'str', '"s"');
  has(yaml, 'yaml', 'kw', 'true');
  has(yaml, 'yaml', 'str', '  line one');
  has(yaml, 'yaml', 'anno', '*base');
  has('[server]\nport = 8080 # c\nname = "x"', 'toml', 'kw', '[server]');
  has('[server]\nport = 8080 # c\nname = "x"', 'toml', 'type', 'port');
  has('[server]\nport = 8080 # c\nname = "x"', 'toml', 'num', '8080');
  has('# Title\n```java\nint x = 1;\n```\n[link](http://a)', 'markdown', 'kw', '# Title');
  has('# Title\n```java\nint x = 1;\n```\n[link](http://a)', 'md', 'type', 'int');
  has('# Title\n```java\nint x = 1;\n```\n[link](http://a)', 'markdown', 'str', 'http://a');
  const uml = "@startuml\n' a comment\nclass Car <<entity>>\nCar --|> Vehicle\nAlice->Bob : hi\n@enduml";
  has(uml, 'plantuml', 'anno', '@startuml');
  has(uml, 'puml', 'com', "' a comment");
  has(uml, 'plantuml', 'kw', 'class');
  has(uml, 'plantuml', 'anno', '<<entity>>');
  has(uml, 'plantuml', 'op', '--|>');
  has(uml, 'plantuml', 'op', '->');
  has('@@ -1,2 +1,2 @@\n-old\n+new', 'diff', 'str', '+new');
  has('@@ -1,2 +1,2 @@\n-old\n+new', 'patch', 'anno', '-old');
  has('loop:\n  mov eax, 1 ; c\n  addi $t0, $t1, 4\n  .text', 'asm', 'fn', 'loop:');
  has('loop:\n  mov eax, 1 ; c\n  addi $t0, $t1, 4\n  .text', 'asm', 'kw', 'mov');
  has('loop:\n  mov eax, 1 ; c\n  addi $t0, $t1, 4\n  .text', 'asm', 'type', 'eax');
  has('loop:\n  mov eax, 1 ; c\n  addi $t0, $t1, 4\n  .text', 's', 'type', '$t0');
  has('loop:\n  mov eax, 1 ; c\n  addi $t0, $t1, 4\n  .text', 'asm', 'com', '; c');
  has('ENTITY a IS port (clk : in std_logic); -- c', 'vhdl', 'kw', 'ENTITY');
  has('ENTITY a IS port (clk : in std_logic); -- c', 'vhd', 'type', 'std_logic');
  has("assign y = 4'b1010; `define W 8", 'verilog', 'num', "4'b1010");
  has("assign y = 4'b1010; `define W 8", 'v', 'anno', '`define');
});

test('language ids, aliases and file names', () => {
  for (const [alias, id] of [['sh', 'bash'], ['shell', 'bash'], ['zsh', 'bash'], ['py', 'python'], ['javascript', 'js'], ['c++', 'cpp'], ['h', 'c'], ['yml', 'yaml'], ['language-java', 'java'], ['JSON', 'json'], ['puml', 'plantuml']]) {
    assert.equal(resolveLang(alias), id, alias);
  }
  assert.equal(resolveLang('klingon'), '');
  assert.equal(langFromName('Main.java'), 'java');
  assert.equal(langFromName('dir/script.SH'), 'bash');
  assert.equal(langFromName('Makefile'), 'makefile');
  assert.equal(langFromName('Dockerfile'), 'dockerfile');
  assert.equal(langFromName('notes.txt'), '');
  assert.equal(langFromName('README'), '');
  assert.equal(langName('cpp'), 'C++');
});

test('escaping: code is text, never markup', () => {
  const evil = '<script>alert("x")</script> <img src=x onerror=alert(1)> & "q" \'s\'';
  for (const lang of ['java', 'js', 'html', 'markdown', 'python', 'bash', 'unknown', '']) {
    const html = highlight(evil, lang);
    assert.ok(!/<script|<img/i.test(html), `${lang}: ${html}`);
    // Only our own spans are tags.
    assert.ok([...html.matchAll(/<[^>]*>/g)].every(([t]) => /^<span class="tk-\w+">$|^<\/span>$/.test(t)), lang);
    assert.equal(strip(html), evil, lang);
  }
  assert.equal(highlight('a < b && c > "d"', 'klingon'), 'a &lt; b &amp;&amp; c &gt; &quot;d&quot;');
  assert.equal(highlight(null, 'java'), '');
});

test('unterminated strings and comments still come out whole', () => {
  const cases = [
    ['String s = "never closed\nint x = 1;', 'java'],
    ['/* open comment\nint x;', 'c'],
    ['s = """open\nmore', 'python'],
    ["echo 'open\nmore", 'bash'],
    ['<!-- open\n<div>', 'html'],
    ['<div class="open', 'html'],
    ['a { color: "open', 'css'],
    ['k: "open\nnext: 1', 'yaml'],
    ['x = `open ${', 'js'],
    ["/' open\nclass A", 'plantuml'],
    ['```java\nint x', 'markdown'],
  ];
  for (const [code, lang] of cases) {
    assert.equal(strip(highlight(code, lang)), code, lang);
    assert.equal(strip(highlightLines(code, lang).join('\n')), code, lang);
  }
  // A string not closed on its line ends there; the next line is code again.
  has('String s = "never closed\nint x = 1;', 'java', 'type', 'int');
  // An open block comment runs to the end.
  assert.ok(tokens('/* open comment\nint x;', 'c').every(([c]) => c === 'com'));
});

test('highlightLines: one balanced string per line, multi-line tokens split', () => {
  const code = 'int a; /* one\ntwo\nthree */ int b;\nString s = """\nx\n""";\n';
  for (const lang of ['java', 'c', 'python', 'html', 'markdown', 'yaml', 'unknown']) {
    const lines = highlightLines(code, lang);
    assert.equal(lines.length, code.split('\n').length, lang);
    for (const line of lines) {
      const open = (line.match(/<span /g) || []).length, close = (line.match(/<\/span>/g) || []).length;
      assert.equal(open, close, `${lang}: ${line}`);
      assert.ok(!line.includes('\n'));
    }
    assert.equal(lines.map(strip).join('\n'), code);
  }
  const lines = highlightLines(code, 'java');
  assert.equal(lines[1], '<span class="tk-com">two</span>');
  assert.equal(lines[4], '<span class="tk-str">x</span>');
  assert.deepEqual(highlightLines('', 'java'), ['']);
});

test('performance: 5 000 lines in under 100 ms', () => {
  const block = [
    'public final class Sorter<T extends Comparable<T>> { // sorts things',
    '    private static final int LIMIT = 0x7fff_ffff; /* a block',
    '       comment */ @SuppressWarnings("unchecked")',
    '    public void sort(T[] items, int lo, int hi) {',
    '        if (lo >= hi) return; int p = partition(items, lo, hi); String s = "pivot: " + p;',
    '        sort(items, lo, p - 1); sort(items, p + 1, hi); double d = 3.14e-2 * items.length;',
    '    }',
    '}',
    '',
    '',
  ];
  const code = Array.from({ length: 500 }, () => block.join('\n')).join('\n');
  assert.equal(code.split('\n').length, 5000);
  highlight(code, 'java'); // warm up
  for (const [lang, fn] of [['java', highlight], ['java', highlightLines], ['python', highlight], ['markdown', highlight], ['cpp', highlight]]) {
    const t0 = performance.now();
    fn(code, lang);
    const ms = performance.now() - t0;
    assert.ok(ms < 100, `${lang} ${fn.name}: ${ms.toFixed(1)} ms`);
  }
});
