// Java semantics, errors, limits and the trace contract of the Java simulator.
// fixtures/language/expected.txt is the JVM's output of Semantics.java (java Semantics.java).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runJava } from '../index.js';

const fixture = (f) => readFileSync(new URL('./fixtures/language/' + f, import.meta.url), 'utf8');
const value = (body, ret = 'Object') => runJava(`public class T { static ${ret} f() { ${body} } }`, { entry: 'T.f', record: false });

test('Semantics.java prints what the JVM prints (with and without recording)', () => {
  for (const record of [false, true]) {
    const t = runJava(fixture('Semantics.java'), { entry: 'Semantics.main', record });
    assert.equal(t.error, undefined, JSON.stringify(t.error));
    assert.equal(t.output, fixture('expected.txt'));
  }
});

test('int overflow, integer division, long and double arithmetic', () => {
  assert.equal(value('int x = Integer.MAX_VALUE; return x + 1;').result, -2147483648);
  assert.equal(value('return 46341 * 46341;').result, -2147479015);
  assert.equal(value('return 7 / 2;').result, 3);
  assert.equal(value('return -7 / 2;').result, -3);
  assert.equal(value('return -7 % 3;').result, -1);
  assert.equal(value('return 7 / 2.0;').result, 3.5);
  assert.equal(value('double d = 7 / 2; return d;').resultText, '3.0');
  assert.equal(value('long l = Long.MAX_VALUE; return l + 1;').resultText, '-9223372036854775808');
  assert.equal(value('long l = 1L << 40; return l;').resultText, '1099511627776');
  assert.equal(value('int i = 1 << 40; return i;').result, 256);
  assert.equal(value('return (int) 3.99 + (int) -3.99;').result, 0);
  const div0 = value('int zero = 0;\nreturn 1 / zero;');
  assert.equal(div0.error.exception, 'ArithmeticException');
  assert.equal(div0.error.message, '/ by zero');
  assert.equal(div0.error.line, 2);
});

test('char arithmetic', () => {
  assert.equal(value("char c = 'a'; return c + 1;").result, 98);
  assert.equal(value("char c = 'a'; return (char) (c + 1);").result, 'b');
  assert.equal(value("char c = 'a'; c++; c += 2; return c;").result, 'd');
  assert.equal(value("return \"\" + 'a' + 'b';").result, 'ab');
  assert.equal(value("return 'a' + 'b';").result, 195);
  assert.equal(value("return '7' - '0';").result, 7);
  assert.equal(value("String s = \"\"; for (char c = 'a'; c <= 'e'; c++) s += c; return s;").result, 'abcde');
});

test('string equality: == compares references, equals() the text', () => {
  assert.equal(value('String a = "hi", b = "hi"; return a == b;').result, true);
  assert.equal(value('String a = "hi", b = new String("hi"); return a == b;').result, false);
  assert.equal(value('String a = "hi", b = new String("hi"); return a.equals(b);').result, true);
  assert.equal(value('String p = "h"; String a = "hi", b = p + "i"; return a == b;').result, false);
  assert.equal(value('return "h" + "i" == "hi";').result, true);
  assert.equal(value('String p = "h"; String b = p + "i"; return "hi" == b.intern();').result, true);
});

test('null handling: NullPointerException at the right line, with the variable named', () => {
  const src = [
    'import java.util.*;',
    'public class N {',
    '  static int length(String s) {',
    '    return s.length();',
    '  }',
    '  public static void main(String[] args) {',
    '    String ok = "abc";',
    '    System.out.println(length(ok));',
    '    String missing = null;',
    '    System.out.println(length(missing));',
    '  }',
    '}',
  ].join('\n');
  const t = runJava(src);
  assert.equal(t.output, '3\n');
  assert.equal(t.error.kind, 'runtime');
  assert.equal(t.error.exception, 'NullPointerException');
  assert.equal(t.error.line, 4);
  assert.match(t.error.message, /"s" is null/);
  assert.deepEqual(t.error.stack, ['N.length', 'N.main']);
  assert.match(t.steps[t.steps.length - 1].caption, /^Exception in thread "main" java\.lang\.NullPointerException/);

  const unbox = runJava('import java.util.*;\npublic class U { static int f() {\n  Map<String, Integer> m = new java.util.HashMap<>();\n  int v = m.get("x");\n  return v; } }', { entry: 'U.f' });
  assert.equal(unbox.error.exception, 'NullPointerException');
  assert.equal(unbox.error.line, 4);

  const field = runJava('public class F { int[] data; static int f() {\n  F f = new F();\n  return f.data[0]; } }', { entry: 'F.f' });
  assert.equal(field.error.exception, 'NullPointerException');
  assert.equal(field.error.line, 3);
});

test('an infinite loop is stopped by the step limit', () => {
  const t = runJava('public class L { public static void main(String[] a) {\n  System.out.println("start");\n  int i = 0;\n  while (true) {\n    i++;\n  }\n} }', { maxSteps: 2000 });
  assert.equal(t.error.kind, 'limit');
  assert.match(t.error.message, /Step limit/);
  assert.ok([4, 5].includes(t.error.line));
  assert.equal(t.output, 'start\n');
  assert.ok(t.steps.length > 100);
  const rec = runJava('public class R { static int f(int n) { return f(n + 1); } }', { entry: 'R.f', args: [0], record: false });
  assert.equal(rec.error.exception, 'StackOverflowError');
});

test('cancellation and the time limit', () => {
  const loop = 'public class C { public static void main(String[] a) { long n = 0; while (true) n++; } }';
  let calls = 0;
  const t = runJava(loop, { shouldCancel: () => ++calls > 3, maxSteps: 1e9, record: false });
  assert.equal(t.error.kind, 'cancelled');
  const flag = new Int32Array(new SharedArrayBuffer(4));
  Atomics.store(flag, 0, 1);
  assert.equal(runJava(loop, { cancelFlag: flag, maxSteps: 1e9, record: false }).error.kind, 'cancelled');
  const slow = runJava(loop, { maxMs: 30, maxSteps: 1e9, record: false });
  assert.equal(slow.error.kind, 'limit');
  assert.match(slow.error.message, /Time limit/);
});

test('compile errors carry line and column', () => {
  const missing = runJava('public class E {\n  static int f() {\n    int x = 1\n    return x;\n  }\n}', { entry: 'E.f' });
  assert.equal(missing.error.kind, 'compile');
  assert.deepEqual([missing.error.line, missing.error.column], [3, 14]); // after "1", as javac
  assert.match(missing.error.message, /';' expected/);
  const str = runJava('public class E {\n  String s = "abc;\n}');
  assert.deepEqual([str.error.line, str.error.column], [2, 14]);
  assert.match(str.error.message, /unclosed string literal/);
  const sym = runJava('public class E {\n  static int f() {\n    int x = 1;\n    return y + x;\n  }\n}', { entry: 'E.f' });
  assert.equal(sym.error.kind, 'compile');
  assert.equal(sym.error.line, 4);
  assert.equal(sym.error.column, 12);
  assert.match(sym.error.message, /cannot find symbol: variable y/);
  const course = runJava('import es.uvigo.esei.aed2.map.HashMap;\npublic class E { static boolean f() {\n  HashMap<String, Integer> m = new HashMap<>();\n  return m.isEmpty(); } }', { entry: 'E.f' });
  assert.match(course.error.message, /cannot find symbol: method isEmpty\(\)/, 'the course Map has no isEmpty()');
  assert.equal(course.error.line, 4);
});

test('uncaught user exceptions and try/catch/finally', () => {
  const src = `public class X {
  static class Empty extends RuntimeException { Empty(String m) { super(m); } }
  static String log = "";
  static int f(int n) {
    try {
      if (n < 0) throw new Empty("negative: " + n);
      return n;
    } catch (Empty e) {
      log += "caught;";
      throw new IllegalStateException("wrapped", e);
    } finally {
      log += "finally;";
    }
  }
}`;
  assert.equal(runJava(src, { entry: 'X.f', args: [3] }).result, 3);
  const t = runJava(src, { entry: 'X.f', args: [-1] });
  assert.equal(t.error.exception, 'IllegalStateException');
  assert.equal(t.error.message, 'wrapped');
  assert.equal(t.error.line, 10);
});

test('the trace follows the contract: steps, lines, locals, call stack, structures and changes', () => {
  const src = `import java.util.*;
public class S {
  static int sum(int[] values, int i) {
    if (i == values.length) return 0;
    return values[i] + sum(values, i + 1);
  }
  static List<Integer> squares(int n) {
    List<Integer> out = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      out.add(i * i);
    }
    return out;
  }
}`;
  const t = runJava(src, { entry: 'S.sum', args: [[3, 4, 5], 0] });
  assert.equal(t.result, 12);
  for (const s of t.steps) {
    for (const k of ['caption', 'line', 'vars', 'state', 'changes', 'marks', 'calls']) assert.ok(k in s, k);
    assert.ok(Array.isArray(s.calls) && Array.isArray(s.changes));
  }
  assert.equal(t.steps[0].caption, 'sum([3, 4, 5], 0)');
  assert.deepEqual(t.steps[0].calls, [{ fn: 'sum', args: '[3, 4, 5], 0' }]);
  assert.equal(Math.max(...t.steps.map((s) => s.calls.length)), 4);
  const cond = t.steps.find((s) => s.line === 4);
  assert.match(cond.caption, /if \(i == values\.length\) .*→ false/);
  assert.deepEqual(cond.vars, { values: '[3, 4, 5]', i: 0 });
  assert.deepEqual(t.structures.values, { kind: 'array', label: 'values' });
  const read = t.steps.find((s) => s.marks.values);
  assert.ok(read, 'array reads are marked');
  assert.equal(t.steps.at(-1).caption, 'return 12');

  const sq = runJava(src, { entry: 'S.squares', args: [3] });
  assert.deepEqual(sq.result, [0, 1, 4]);
  assert.deepEqual(sq.structures.out, { kind: 'array', label: 'out' });
  const adds = sq.steps.flatMap((s) => s.changes).filter((c) => c.id === 'out');
  assert.deepEqual(adds.map((c) => [c.op, c.to]), [['add', 0], ['add', 1], ['add', 4]]);
  assert.deepEqual(sq.steps.at(-1).state.out.items, [0, 1, 4]);
  // a step's state is a full snapshot: an earlier step still has the earlier list
  const first = sq.steps.find((s) => s.changes.length);
  assert.deepEqual(first.state.out.items, [0]);
  // the step cap
  const capped = runJava(src, { entry: 'S.squares', args: [50], maxFrames: 20 });
  assert.equal(capped.steps.length, 20);
  assert.equal(capped.truncated, true);
  assert.equal(capped.result.length, 50, 'the run goes on after the cap');
});

test('2-D arrays are matrices; pointers follow index variables', () => {
  const t = runJava('public class M { static int f() {\n  int[][] grid = new int[2][3];\n  int[] row = {5, 6, 7};\n  for (int j = 0; j < 3; j++) grid[1][j] = row[j];\n  return grid[1][2]; } }', { entry: 'M.f' });
  assert.equal(t.result, 7);
  assert.equal(t.structures.grid.kind, 'matrix');
  const last = t.steps.at(-1).state;
  assert.deepEqual(last.grid, { rows: 2, cols: 3, cells: [[0, 0, 0], [5, 6, 7]] });
  assert.deepEqual(last.row.pointers, { j: 2 });
  assert.ok(t.steps.some((s) => s.changes.some((c) => c.id === 'grid' && c.op === 'set' && c.to === 6)));
});

test('inputs: Scanner on System.in, main(String[]) output, { $java } arguments', () => {
  const t = runJava('import java.util.Scanner;\npublic class In { public static void main(String[] a) {\n  Scanner sc = new Scanner(System.in);\n  int n = sc.nextInt(); int s = 0;\n  for (int i = 0; i < n; i++) s += sc.nextInt();\n  System.out.println("sum " + s); } }', { input: '3\n10 20 30\n' });
  assert.equal(t.output, 'sum 60\n');
  const j = runJava('import java.util.*;\npublic class J { static int f(List<Integer> l, int[][] m) { return l.size() + m[1][0]; } }', {
    entry: 'J.f', args: [{ $java: 'new ArrayList<>(List.of(1, 2, 3))' }, [[1], [40]]],
  });
  assert.equal(j.result, 43);
});

test('lambdas, comparators and functional interfaces', () => {
  const t = runJava(`import java.util.*;
import java.util.function.*;
public class Fn {
  static List<String> f() {
    List<String> l = new ArrayList<>(List.of("ccc", "a", "bb"));
    Collections.sort(l, new Comparator<String>() {
      public int compare(String x, String y) { return x.length() - y.length(); }
    });
    BiConsumer<String, Integer> show = (k, v) -> System.out.print(k + v);
    Map<String, Integer> m = new TreeMap<>();
    l.forEach(s -> m.put(s, s.length()));
    m.forEach(show);
    return l;
  }
}`, { entry: 'Fn.f' });
  assert.equal(t.error, undefined, JSON.stringify(t.error));
  assert.deepEqual(t.result, ['a', 'bb', 'ccc']);
  assert.equal(t.output, 'a1bb2ccc3');
});

test('the trace is plain data (JSON and structured clone)', () => {
  const t = runJava(fixture('Semantics.java'), { entry: 'Semantics.main', maxFrames: 300 });
  const json = JSON.parse(JSON.stringify(t));
  assert.equal(json.steps.length, 300);
  assert.doesNotThrow(() => structuredClone(t));
});
