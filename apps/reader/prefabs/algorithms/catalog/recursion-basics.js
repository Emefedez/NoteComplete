// Recursion (activity 1): factorial, sum of digits, gcd by subtractions, invert a string,
// invert an array, the minimum, binary search. The calls pile up in a "calls" stack (the
// innermost on top) and come back with their results.
import { lineFinder, ints, clampInt, rng } from './common.js';

// The calls as a stack structure beside the call stack pane: each frame "f(args)", and its
// result written in when it returns.
export function frames(t) {
  const stack = t.stack('calls', [], { label: 'calls (innermost on top)' });
  return {
    push(fn, args) { t.call(fn, args); stack.push(`${fn}(${args})`); },
    pop(value) { const f = stack.pop(); t.ret(); return `${f} = ${value}`; },
  };
}

const factSource = `public static long factorial(int number) {
  if (number <= 1) return 1;                    // base case
  return number * factorial(number - 1);
}`;
const fAt = lineFinder(factSource);
export const factorial = {
  id: 'factorial', topic: 'recursion', name: 'Factorial',
  hint: 'n! = n · (n − 1)!, down to the base case 1',
  fields: [{ key: 'n', type: 'int', label: 'n', min: 0, max: 20 }],
  presets: [{ label: 'n = 5', input: { n: 5 } }, { label: 'n = 10', input: { n: 10 } }],
  random(seed) { return { n: rng(seed).int(3, 8) }; },
  normalize(raw = {}) { return { n: clampInt(raw.n, 0, 20, 5) }; },
  source: factSource,
  run({ n }, t) {
    const f = frames(t);
    const result = t.value('result', null, { label: 'returned' });
    const go = (k) => {
      f.push('factorial', k);
      if (k <= 1) {
        t.step(`factorial(${k}): ${k} ≤ 1, the base case returns 1`, { line: fAt('if (number <= 1) return 1'), vars: { number: k } });
        result.set(1);
        f.pop(1);
        return 1;
      }
      t.step(`factorial(${k}) needs factorial(${k - 1})`, { line: fAt('return number * factorial(number - 1)'), vars: { number: k } });
      const below = go(k - 1);
      const v = k * below;
      result.set(v);
      t.step(`factorial(${k}) = ${k} · ${below} = ${v}`, { line: fAt('return number * factorial(number - 1)'), vars: { number: k, 'factorial(number - 1)': below } });
      f.pop(v);
      return v;
    };
    const v = go(n);
    t.step(`${n}! = ${v}`, { line: null, vars: {} });
    return v;
  },
};

const digitsSource = `public static int sumDigits(int number) {
  if (number < 10) return number;               // one digit: itself
  int smallestPart = number % 10;               // the last digit
  return smallestPart + sumDigits(number / 10); // and the rest
}`;
const dAt = lineFinder(digitsSource);
export const sumDigits = {
  id: 'sum-digits', topic: 'recursion', name: 'Sum of digits',
  hint: 'The last digit (n % 10) plus the sum of the digits of n / 10',
  fields: [{ key: 'n', type: 'int', label: 'Number', min: 0, max: 999999999 }],
  presets: [{ label: '1369', input: { n: 1369 } }, { label: '90817', input: { n: 90817 } }],
  random(seed) { return { n: rng(seed).int(100, 999999) }; },
  normalize(raw = {}) { return { n: clampInt(raw.n, 0, 999999999, 1369) }; },
  source: digitsSource,
  run({ n }, t) {
    const f = frames(t);
    const result = t.value('result', null, { label: 'returned' });
    const go = (k) => {
      f.push('sumDigits', k);
      if (k < 10) { result.set(k); t.step(`sumDigits(${k}): one digit, returns ${k}`, { line: dAt('if (number < 10) return number'), vars: { number: k } }); f.pop(k); return k; }
      t.step(`sumDigits(${k}): last digit ${k} % 10 = ${k % 10}; the rest is ${Math.trunc(k / 10)}`, { line: dAt('int smallestPart = number % 10'), vars: { number: k, smallestPart: k % 10 } });
      const rest = go(Math.trunc(k / 10));
      const v = (k % 10) + rest;
      result.set(v);
      t.step(`sumDigits(${k}) = ${k % 10} + ${rest} = ${v}`, { line: dAt('return smallestPart + sumDigits(number / 10)'), vars: { number: k, smallestPart: k % 10 } });
      f.pop(v);
      return v;
    };
    const v = go(n);
    t.step(`The digits of ${n} add up to ${v}`, { line: null, vars: {} });
    return v;
  },
};

const gcdSource = `public static int mcd(int number1, int number2) {
  if (number1 <= 0) return number2;
  if (number2 <= 0) return number1;
  if (number1 == number2) return number1;      // both the same: that is it
  if (number1 > number2) return mcd(number1 - number2, number2);
  return mcd(number1, number2 - number1);      // the larger minus the smaller
}`;
const gAt = lineFinder(gcdSource);
export const gcd = {
  id: 'gcd', topic: 'recursion', name: 'Greatest common divisor',
  hint: 'Euclid by subtractions: take the smaller from the larger until both are equal',
  fields: [{ key: 'a', type: 'int', label: 'number1', min: 0, max: 9999 }, { key: 'b', type: 'int', label: 'number2', min: 0, max: 9999 }],
  presets: [{ label: '80 and 20', input: { a: 80, b: 20 } }, { label: '84 and 36', input: { a: 84, b: 36 } }],
  random(seed) { const r = rng(seed), k = r.int(2, 9); return { a: k * r.int(2, 12), b: k * r.int(2, 12) }; },
  normalize(raw = {}) { return { a: clampInt(raw.a, 0, 9999, 84), b: clampInt(raw.b, 0, 9999, 36) }; },
  source: gcdSource,
  run({ a, b }, t) {
    const f = frames(t);
    const pair = t.array('pair', [a, b], { label: 'number1, number2' });
    let depth = 0;
    const go = (x, y) => {
      f.push('mcd', `${x}, ${y}`);
      pair.set(0, x); pair.set(1, y);
      if (++depth > 400) throw Error('Too many subtractions to show (try smaller numbers)');
      let v;
      if (x <= 0) { v = y; t.step(`number1 is ${x}: the result is number2, ${y}`, { line: gAt('if (number1 <= 0) return number2'), vars: { number1: x, number2: y } }); }
      else if (y <= 0) { v = x; t.step(`number2 is ${y}: the result is number1, ${x}`, { line: gAt('if (number2 <= 0) return number1'), vars: { number1: x, number2: y } }); }
      else if (x === y) { v = x; t.step(`Both are ${x}: the gcd is ${x}`, { line: gAt('if (number1 == number2) return number1'), vars: { number1: x, number2: y }, marks: { pair: { 0: 'path', 1: 'path' } } }); }
      else if (x > y) { t.step(`${x} > ${y}: mcd(${x} − ${y}, ${y})`, { line: gAt('if (number1 > number2) return mcd'), vars: { number1: x, number2: y }, marks: { pair: { 0: 'current', 1: 'compare' } } }); v = go(x - y, y); }
      else { t.step(`${x} < ${y}: mcd(${x}, ${y} − ${x})`, { line: gAt('return mcd(number1, number2 - number1)'), vars: { number1: x, number2: y }, marks: { pair: { 1: 'current', 0: 'compare' } } }); v = go(x, y - x); }
      f.pop(v);
      return v;
    };
    const v = go(a, b);
    t.step(`gcd(${a}, ${b}) = ${v}`, { line: null, vars: {} });
    return v;
  },
};

const invSource = `public static String invert(String str) {
  if (str.length() <= 1) return str;              // nothing to turn round
  return invert(str.substring(1)) + str.charAt(0);  // the rest inverted, then the first
}`;
const iAt = lineFinder(invSource);
export const invertString = {
  id: 'invert-string', topic: 'recursion', name: 'Invert a string',
  hint: 'invert(rest) followed by the first character',
  fields: [{ key: 's', type: 'line', label: 'Text' }],
  presets: [{ label: '"recursion"', input: { s: 'recursion' } }, { label: '"AEDII"', input: { s: 'AEDII' } }],
  random(seed) { const r = rng(seed); return { s: r.pick(['algorithm', 'stack', 'vertex', 'heap', 'graph']) }; },
  normalize(raw = {}) { const s = typeof raw.s === 'string' ? raw.s : 'recursion'; if (s.length > 24) throw Error('At most 24 characters'); return { s }; },
  source: invSource,
  run({ s }, t) {
    const f = frames(t);
    const chars = t.array('str', [...s], { label: 'str' });
    const result = t.value('result', '', { label: 'returned' });
    const go = (from) => {
      const str = s.slice(from);
      f.push('invert', JSON.stringify(str));
      for (let i = 0; i < s.length; i++) chars.pointer('first', null);
      if (str.length <= 1) {
        result.set(str);
        t.step(`invert("${str}"): one character or none, returned as it is`, { line: iAt('if (str.length() <= 1) return str'), vars: { str }, marks: { str: Object.fromEntries([...str].map((_, k) => [from + k, 'current'])) } });
        f.pop(JSON.stringify(str));
        return str;
      }
      chars.pointer('first', from);
      t.step(`invert("${str}") = invert("${str.slice(1)}") + '${str[0]}'`, { line: iAt('return invert(str.substring(1)) + str.charAt(0)'), vars: { str }, marks: { str: { [from]: 'compare' } } });
      const rest = go(from + 1);
      const v = rest + str[0];
      result.set(v);
      chars.pointer('first', from);
      t.step(`"${rest}" + '${str[0]}' = "${v}"`, { line: iAt('return invert(str.substring(1)) + str.charAt(0)'), vars: { str }, marks: { str: { [from]: 'current' } } });
      f.pop(JSON.stringify(v));
      return v;
    };
    const v = go(0);
    chars.pointer('first', null);
    t.step(`"${s}" inverted is "${v}"`, { line: null, vars: {} });
    return v;
  },
};

const arrSource = `public static void invertArray(int[] values) {
  invertArrayInternal(values, 0);
}

public static void invertArrayInternal(int[] values, int index) {
  if (index >= values.length / 2) return;        // past the middle: all swapped
  int invertedIndex = values.length - index - 1;
  int temp = values[index];
  values[index] = values[invertedIndex];
  values[invertedIndex] = temp;
  invertArrayInternal(values, index + 1);
}`;
const aAt = lineFinder(arrSource);
const arrayFields = [{ key: 'values', type: 'array', label: 'Array' }];
const randomValues = (seed) => { const r = rng(seed); return { values: Array.from({ length: r.int(5, 9) }, () => r.int(1, 99)) }; };
export const invertArray = {
  id: 'invert-array', topic: 'recursion', name: 'Invert an array',
  hint: 'Swap the ends, then invert what is between them',
  fields: arrayFields,
  presets: [{ label: 'Seven values', input: { values: [1, 2, 3, 4, 5, 6, 7] } }, { label: 'Six values', input: { values: [9, 4, 7, 1, 8, 3] } }],
  random: randomValues,
  normalize(raw = {}) { return { values: ints(raw.values ?? [1, 2, 3, 4, 5, 6, 7], { most: 16 }) }; },
  source: arrSource,
  run({ values }, t) {
    const f = frames(t);
    const a = t.array('values', values, { label: 'values' });
    t.step(`Invert ${values.length} values in place`, { line: aAt('invertArrayInternal(values, 0)') });
    const go = (i) => {
      f.push('invertArrayInternal', i);
      a.pointer('index', i < values.length ? i : null);
      if (i >= Math.floor(values.length / 2)) {
        t.step(`index ${i} ≥ ${values.length} / 2: past the middle, return`, { line: aAt('if (index >= values.length / 2) return'), vars: { index: i } });
        a.pointer('index', null);
        f.pop('done');
        return;
      }
      const j = values.length - i - 1;
      a.pointer('invertedIndex', j);
      t.step(`Swap positions ${i} and ${j}`, { line: aAt('int invertedIndex'), vars: { index: i, invertedIndex: j }, marks: { values: { [i]: 'compare', [j]: 'compare' } } });
      a.swap(i, j);
      t.mark('values', i, 'done'); t.mark('values', j, 'done');
      t.step(`values[${i}] = ${a.get(i)}, values[${j}] = ${a.get(j)}`, { line: aAt('values[invertedIndex] = temp'), vars: { index: i, invertedIndex: j, temp: a.get(j) } });
      a.pointer('invertedIndex', null);
      go(i + 1);
      f.pop('done');
    };
    go(0);
    t.step(`Inverted: ${a.toArray().join(', ')}`, { line: null, vars: {} });
    return a.toArray();
  },
};

const minSource = `public static int minimum(int[] values) {
  return minimumInternal(values, 0, values[0]);   // the first one, to start with
}

public static int minimumInternal(int[] values, int index, int min) {
  if (index >= values.length) return min;          // all seen
  if (values[index] < min) min = values[index];
  return minimumInternal(values, index + 1, min);
}`;
const mAt = lineFinder(minSource);
export const minimum = {
  id: 'minimum', topic: 'recursion', name: 'Minimum of an array',
  hint: 'Carry the smallest seen so far into the next call',
  fields: arrayFields,
  presets: [{ label: 'Eight values', input: { values: [7, 3, 9, 4, 1, 8, 2, 6] } }],
  random: randomValues,
  normalize(raw = {}) { const values = ints(raw.values ?? [7, 3, 9, 4, 1, 8, 2, 6], { most: 16 }); if (!values.length) throw Error('The array is empty'); return { values }; },
  source: minSource,
  run({ values }, t) {
    const f = frames(t);
    const a = t.array('values', values, { label: 'values' });
    const min = t.value('min', values[0], { label: 'min' });
    t.step(`Start with min = values[0] = ${values[0]}`, { line: mAt('return minimumInternal(values, 0, values[0])'), vars: { min: values[0] }, marks: { values: { 0: 'path' } } });
    let best = 0;
    const go = (i, m) => {
      f.push('minimumInternal', `${i}, ${m}`);
      a.pointer('index', i < values.length ? i : null);
      if (i >= values.length) { t.step(`All seen: the minimum is ${m}`, { line: mAt('if (index >= values.length) return min'), vars: { index: i, min: m }, marks: { values: { [best]: 'path' } } }); f.pop(m); return m; }
      const smaller = values[i] < m;
      if (smaller) { m = values[i]; min.set(m); best = i; }
      t.step(smaller ? `${values[i]} < the min so far: min = ${m}` : `${values[i]} ≥ ${m}: min stays`, { line: mAt('if (values[index] < min) min = values[index]'), vars: { index: i, min: m }, marks: { values: { [i]: 'compare', [best]: 'path' } } });
      const v = go(i + 1, m);
      f.pop(v);
      return v;
    };
    const v = go(0, values[0]);
    a.pointer('index', null);
    t.step(`minimum = ${v}`, { line: null, vars: {}, marks: { values: { [best]: 'path' } } });
    return v;
  },
};

const bsSource = `public static int binarySearch(int[] values, int number) {
  return binarySearch(values, number, 0, values.length - 1);
}

private static int binarySearch(int[] values, int number, int start, int end) {
  if (start > end) return -1;                       // nothing left: not there
  int middle = (start + end) / 2;
  if (values[middle] == number) return middle;
  if (number < values[middle]) {
    return binarySearch(values, number, start, middle - 1);   // the left half
  }
  return binarySearch(values, number, middle + 1, end);       // the right half
}`;
const bAt = lineFinder(bsSource);
export const binarySearch = {
  id: 'binary-search', topic: 'recursion', name: 'Binary search',
  hint: 'In a sorted array: look at the middle, then only in the half where it can be',
  fields: [{ key: 'values', type: 'array', label: 'Sorted array' }, { key: 'number', type: 'int', label: 'Look for', min: -999, max: 999 }],
  presets: [{ label: 'Found', input: { values: [2, 5, 8, 12, 16, 23, 38, 56, 72, 91], number: 23 } }, { label: 'Not there', input: { values: [2, 5, 8, 12, 16, 23, 38, 56, 72, 91], number: 40 } }],
  random(seed) { const r = rng(seed); const set = new Set(); while (set.size < r.int(7, 12)) set.add(r.int(1, 99)); const values = [...set].sort((x, y) => x - y); return { values, number: r.next() < 0.7 ? r.pick(values) : r.int(1, 99) }; },
  normalize(raw = {}) { const values = ints(raw.values ?? [2, 5, 8, 12, 16, 23, 38, 56, 72, 91], { most: 20 }).sort((x, y) => x - y); return { values, number: clampInt(raw.number, -999, 999, 23) }; },
  source: bsSource,
  run({ values, number }, t) {
    const f = frames(t);
    const a = t.array('values', values, { label: 'values (sorted)' });
    const out = (s, e) => { for (let k = 0; k < values.length; k++) t.mark('values', k, k < s || k > e ? 'done' : null); };
    t.step(`Look for ${number}`, { line: bAt('return binarySearch(values, number, 0, values.length - 1)'), vars: { number } });
    const go = (s, e) => {
      f.push('binarySearch', `${s}, ${e}`);
      out(s, e);
      a.pointer('start', s <= e ? s : null); a.pointer('end', s <= e ? e : null); a.pointer('middle', null);
      if (s > e) { t.step(`start ${s} > end ${e}: ${number} is not there, -1`, { line: bAt('if (start > end) return -1'), vars: { start: s, end: e } }); f.pop(-1); return -1; }
      const m = Math.floor((s + e) / 2);
      a.pointer('middle', m);
      if (values[m] === number) { t.step(`values[${m}] = ${number}: found at ${m}`, { line: bAt('if (values[middle] == number) return middle'), vars: { start: s, end: e, middle: m }, marks: { values: { [m]: 'path' } } }); f.pop(m); return m; }
      const left = number < values[m];
      t.step(`values[${m}] = ${values[m]}: ${number} ${left ? '<' : '>'} ${values[m]}, look in the ${left ? 'left' : 'right'} half`, { line: left ? bAt('return binarySearch(values, number, start, middle - 1)') : bAt('return binarySearch(values, number, middle + 1, end)'), vars: { start: s, end: e, middle: m }, marks: { values: { [m]: 'compare' } } });
      const v = left ? go(s, m - 1) : go(m + 1, e);
      f.pop(v);
      return v;
    };
    const v = go(0, values.length - 1);
    for (const p of ['start', 'end']) a.pointer(p, null);
    t.step(v >= 0 ? `${number} is at position ${v}` : `${number} is not in the array: -1`, { line: null, vars: {} });
    return v;
  },
};
