// Divide and conquer (activity 10: quickselect, the position i with array[i] = i, the
// valley of a curve), dynamic programming (activity 11: change making with a table) and the
// extras: bubble, insertion and selection sort, Floyd–Warshall and Bellman–Ford.
import { lineFinder, ints, clampInt, rng, normalizeGraph, placed, edgeKey, randomGraph, startOf } from './common.js';

const randomValues = (seed) => { const r = rng(seed); return { values: Array.from({ length: r.int(6, 10) }, () => r.int(1, 99)) }; };

const qsSource = `public static int quickSelection(int[] array, int k_minor, int i, int j) {
  int p = partition(array, i, j);                  // the pivot ends at its sorted place
  if (p == k_minor - 1) return array[p];           // it is the k-th smallest
  if (k_minor - 1 < p) return quickSelection(array, k_minor, i, p - 1);
  return quickSelection(array, k_minor, p + 1, j); // only one side, never both
}

private static int partition(int[] array, int i, int j) {
  int pivot = array[j];
  int left = i;
  for (int k = i; k < j; k++) {
    if (array[k] < pivot) exchange(array, left++, k);
  }
  exchange(array, left, j);
  return left;
}`;
const qAt = lineFinder(qsSource);
export const quickselect = {
  id: 'quickselect', topic: 'divide', name: 'Quickselect (k-th smallest)',
  hint: 'Partition as quicksort does, then go on only into the side that holds position k',
  fields: [{ key: 'values', type: 'array', label: 'Array' }, { key: 'k', type: 'int', label: 'k (1 = the smallest)', min: 1, max: 30 }],
  presets: [{ label: 'Activity: 5th smallest (9)', input: { values: [4, 2, 8, 12, 6, 9, 23, 43, 78, 14], k: 5 } }],
  random(seed) { const r = rng(seed); const v = randomValues(seed).values; return { values: v, k: r.int(1, v.length) }; },
  normalize(raw = {}) { const values = ints(raw.values ?? [4, 2, 8, 12, 6, 9, 23, 43, 78, 14], { most: 16 }); if (!values.length) throw Error('The array is empty'); return { values, k: clampInt(raw.k, 1, values.length, Math.min(5, values.length)) }; },
  source: qsSource,
  run({ values, k }, t) {
    const a = t.array('array', values, { label: 'array' });
    const go = (i, j) => {
      t.call('quickSelection', `${k}, ${i}, ${j}`);
      for (let x = 0; x < values.length; x++) t.mark('array', x, x < i || x > j ? 'done' : null);
      a.pointer('i', i); a.pointer('j', j);
      const pivot = a.get(j);
      let left = i;
      t.step(`Partition ${i}..${j} around ${pivot}`, { line: qAt('int p = partition(array, i, j)'), vars: { i, j, pivot }, marks: { array: { [j]: 'current' } } });
      for (let x = i; x < j; x++) if (a.get(x) < pivot) { if (left !== x) a.swap(left, x); left++; }
      if (left !== j) a.swap(left, j);
      a.pointer('p', left);
      t.step(`${pivot} lands at position ${left}: ${left - i} smaller ones before it`, { line: qAt('exchange(array, left, j)'), vars: { i, j, pivot, p: left }, marks: { array: { [left]: 'current' } } });
      let v;
      if (left === k - 1) { t.mark('array', left, 'path'); t.step(`Position ${left} is k − 1: the ${k}th smallest is ${pivot}`, { line: qAt('if (p == k_minor - 1) return array[p]'), vars: { p: left, k_minor: k } }); v = pivot; }
      else if (k - 1 < left) { t.step(`k − 1 = ${k - 1} < ${left}: only the left side`, { line: qAt('if (k_minor - 1 < p) return quickSelection'), vars: { p: left, k_minor: k } }); a.pointer('p', null); v = go(i, left - 1); }
      else { t.step(`k − 1 = ${k - 1} > ${left}: only the right side`, { line: qAt('return quickSelection(array, k_minor, p + 1, j)'), vars: { p: left, k_minor: k } }); a.pointer('p', null); v = go(left + 1, j); }
      t.ret();
      return v;
    };
    const v = go(0, values.length - 1);
    for (const p of ['i', 'j', 'p']) a.pointer(p, null);
    t.step(`The ${k}th smallest is ${v}`, { line: null, vars: {} });
    return v;
  },
};

const fixSource = `public static int numberExists(int[] array, int start, int end) {
  if (start > end) return -1;                          // no position left
  int middle = (start + end) / 2;
  if (array[middle] == middle) return middle;
  if (array[middle] > middle) return numberExists(array, start, middle - 1);   // too big: left
  return numberExists(array, middle + 1, end);
}`;
const xAt = lineFinder(fixSource);
export const fixedPoint = {
  id: 'fixed-point', topic: 'divide', name: 'A position i with array[i] = i',
  hint: 'In a sorted array of different values: a binary search on array[i] − i',
  fields: [{ key: 'values', type: 'array', label: 'Sorted array, all different' }],
  presets: [{ label: 'Activity (2)', input: { values: [-3, 0, 2, 9, 10, 12, 15] } }, { label: 'None (−1)', input: { values: [1, 3, 5, 7, 9, 11] } }],
  random(seed) { const r = rng(seed); let v = r.int(-6, 0); return { values: Array.from({ length: 8 }, () => (v += r.int(1, 3))) }; },
  normalize(raw = {}) { const values = ints(raw.values ?? [-3, 0, 2, 9, 10, 12, 15], { most: 20 }); for (let i = 1; i < values.length; i++) if (values[i] <= values[i - 1]) throw Error('Sorted, all different'); return { values }; },
  source: fixSource,
  run({ values }, t) {
    const a = t.array('array', values, { label: 'array' });
    const go = (s, e) => {
      t.call('numberExists', `${s}, ${e}`);
      a.pointer('start', s <= e ? s : null); a.pointer('end', s <= e ? e : null); a.pointer('middle', null);
      if (s > e) { t.step('Nothing left: −1', { line: xAt('if (start > end) return -1'), vars: { start: s, end: e } }); t.ret(); return -1; }
      const m = Math.floor((s + e) / 2);
      a.pointer('middle', m);
      let v;
      if (values[m] === m) { t.step(`array[${m}] = ${m}: found`, { line: xAt('if (array[middle] == middle) return middle'), vars: { start: s, end: e, middle: m }, marks: { array: { [m]: 'path' } } }); v = m; }
      else if (values[m] > m) { t.step(`array[${m}] = ${values[m]} > ${m}: every one to the right is too big too; left`, { line: xAt('if (array[middle] > middle) return numberExists'), vars: { start: s, end: e, middle: m }, marks: { array: { [m]: 'compare' } } }); v = go(s, m - 1); }
      else { t.step(`array[${m}] = ${values[m]} < ${m}: right`, { line: xAt('return numberExists(array, middle + 1, end)'), vars: { start: s, end: e, middle: m }, marks: { array: { [m]: 'compare' } } }); v = go(m + 1, e); }
      t.ret();
      return v;
    };
    const v = go(0, values.length - 1);
    for (const p of ['start', 'end', 'middle']) a.pointer(p, null);
    t.step(v >= 0 ? `array[${v}] = ${v}` : 'No position holds its own index: −1', { line: null, vars: {}, marks: v >= 0 ? { array: { [v]: 'path' } } : {} });
    return v;
  },
};

const valleySource = `public static int searchPositionK(int[] v, int start, int end) {
  if (end - start < 2) return -1;                      // no inner position left
  int k = (start + end) / 2;
  if (v[k - 1] > v[k] && v[k] < v[k + 1]) return k;    // lower than both neighbours
  if (v[k - 1] < v[k]) return searchPositionK(v, start, k);     // going up: the valley is left
  return searchPositionK(v, k, end);                   // going down: right
}`;
const vAt = lineFinder(valleySource);
export const valley = {
  id: 'valley', topic: 'divide', name: 'The valley of a curve',
  hint: 'Values that go down then up: find the lowest by halving, looking at the slope',
  fields: [{ key: 'values', type: 'array', label: 'Array (down, then up)' }],
  presets: [{ label: 'Activity curve (6)', input: { values: [9, 7, 5, 4, 3, 2, 1, 3, 4, 7] } }, { label: 'Activity line (−1)', input: { values: [15, 13, 12, 9, 7, 5, 4, 3, 2, 1] } }],
  random(seed) { const r = rng(seed); const n = r.int(7, 11), low = r.int(2, n - 3); return { values: Array.from({ length: n }, (_, i) => 2 + Math.abs(i - low) * r.int(1, 3) + (i === low ? 0 : 1)) }; },
  normalize(raw = {}) { return { values: ints(raw.values ?? [9, 7, 5, 4, 3, 2, 1, 3, 4, 7], { most: 20 }) }; },
  source: valleySource,
  run({ values }, t) {
    const a = t.array('v', values, { label: 'v' });
    const go = (s, e) => {
      t.call('searchPositionK', `${s}, ${e}`);
      a.pointer('start', s); a.pointer('end', e); a.pointer('k', null);
      if (e - s < 2) { t.step(`${s}..${e} has no inner position: −1`, { line: vAt('if (end - start < 2) return -1'), vars: { start: s, end: e } }); t.ret(); return -1; }
      const k = Math.floor((s + e) / 2);
      a.pointer('k', k);
      let r;
      if (values[k - 1] > values[k] && values[k] < values[k + 1]) { t.step(`${values[k - 1]} > ${values[k]} < ${values[k + 1]}: the valley is at ${k}`, { line: vAt('if (v[k - 1] > v[k] && v[k] < v[k + 1]) return k'), vars: { start: s, end: e, k }, marks: { v: { [k]: 'path', [k - 1]: 'compare', [k + 1]: 'compare' } } }); r = k; }
      else if (values[k - 1] < values[k]) { t.step(`${values[k - 1]} < ${values[k]}: going up at ${k}, the valley is to the left`, { line: vAt('if (v[k - 1] < v[k]) return searchPositionK(v, start, k)'), vars: { start: s, end: e, k }, marks: { v: { [k]: 'current', [k - 1]: 'compare' } } }); r = go(s, k); }
      else { t.step(`${values[k - 1]} ≥ ${values[k]}: going down at ${k}, the valley is to the right`, { line: vAt('return searchPositionK(v, k, end)'), vars: { start: s, end: e, k }, marks: { v: { [k]: 'current', [k - 1]: 'compare' } } }); r = go(k, e); }
      t.ret();
      return r;
    };
    const r = go(0, values.length - 1);
    for (const p of ['start', 'end', 'k']) a.pointer(p, null);
    t.step(r >= 0 ? `The valley is at position ${r} (${values[r]})` : 'No valley inside the array: −1', { line: null, vars: {} });
    return r;
  },
};

const changeSource = `public static Map<Integer, Integer> giveChangeDynamic(int amountReturned, Map<Integer, Integer> changeAvailable) {
  int[] coins = coinsOf(changeAvailable);                  // in units of their gcd
  int n = coins.length, m = amountReturned / unit;
  int[][] table = new int[n + 1][m + 1];                   // fewest coins for amount j with coins 1..i
  for (int j = 1; j <= m; j++) table[0][j] = INFINITY;
  for (int i = 1; i <= n; i++) {
    for (int j = 0; j <= m; j++) {
      table[i][j] = table[i - 1][j];                        // none of coin i
      for (int k = 1; k <= changeAvailable.get(coins[i - 1]) && k * coins[i - 1] <= j; k++) {
        table[i][j] = Math.min(table[i][j], table[i - 1][j - k * coins[i - 1]] + k);   // k of them
      }
    }
  }
  return solutionFrom(table, coins);                         // back from table[n][m]
}`;
const dAt = lineFinder(changeSource);
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export const changeMaking = {
  id: 'dp-change', topic: 'dp', name: 'Change making',
  hint: 'The fewest coins for every amount with the first i coins, in a table; then back from the corner',
  fields: [{ key: 'amount', type: 'int', label: 'Amount', min: 0, max: 100000 }, { key: 'coins', type: 'text', label: 'Coins', hint: 'coin how-many, one per line' }],
  presets: [{ label: 'Activity: 1200 with 500 and 200', input: { amount: 1200, coins: '500 20\n200 10' } }, { label: '6 with 4, 3 and 1', input: { amount: 6, coins: '4 5\n3 5\n1 5' } }],
  random(seed) { const r = rng(seed); return { amount: r.int(5, 15), coins: '1 9\n3 4\n4 3' }; },
  normalize(raw = {}) {
    const coins = typeof raw.coins === 'string' ? raw.coins : '500 20\n200 10';
    const list = coins.split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+/).map(Number));
    if (!list.length || list.some((c) => c.length !== 2 || !(c[0] > 0) || !Number.isInteger(c[0]) || !(c[1] >= 0))) throw Error('Write "coin how-many" per line');
    const amount = clampInt(raw.amount, 0, 100000, 1200);
    const unit = list.reduce((g, [c]) => gcd(g, c), amount || list[0][0]);
    if (amount / unit > 30) throw Error(`The table would have ${amount / unit + 1} columns: at most 31`);
    return { amount, coins };
  },
  source: changeSource,
  run({ amount, coins }, t) {
    const list = coins.split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+/).map(Number)).sort((a, b) => a[0] - b[0]);
    const unit = list.reduce((g, [c]) => gcd(g, c), amount || list[0][0]);
    const m = amount / unit, n = list.length;
    const INF = Infinity;
    const tab = t.matrix('table', n + 1, m + 1, '', { label: 'table[i][j]: fewest coins', rowLabels: ['none', ...list.map(([c, h]) => `${c} (×${h})`)], colLabels: Array.from({ length: m + 1 }, (_, j) => j * unit) });
    const T = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let j = 0; j <= m; j++) { T[0][j] = j ? INF : 0; tab.set(0, j, T[0][j]); }
    t.step(`Columns in steps of ${unit}; with no coins only 0 can be given`, { line: dAt('for (int j = 1; j <= m; j++) table[0][j] = INFINITY'), vars: { n, m } });
    for (let i = 1; i <= n; i++) {
      const [c, have] = list[i - 1], cu = c / unit;
      for (let j = 0; j <= m; j++) {
        let best = T[i - 1][j], via = 0;
        for (let k = 1; k <= have && k * cu <= j; k++) if (T[i - 1][j - k * cu] + k < best) { best = T[i - 1][j - k * cu] + k; via = k; }
        T[i][j] = best; tab.set(i, j, best);
        t.step(`${j * unit} with coins up to ${c}: ${best === INF ? 'impossible' : `${best} coin${best === 1 ? '' : 's'}`}${via ? ` (${via} × ${c} + ${T[i - 1][j - via * cu]} for ${(j - via * cu) * unit})` : ' (as without it)'}`, { line: via ? dAt('table[i][j] = Math.min(table[i][j]') : dAt('table[i][j] = table[i - 1][j];'), vars: { i, j: j * unit, k: via }, marks: { table: { [`${i},${j}`]: 'current', [`${i - 1},${j}`]: 'compare', ...(via ? { [`${i - 1},${j - via * cu}`]: 'compare' } : {}) } } });
      }
    }
    const result = {};
    if (T[n][m] !== INF) {
      let j = m;
      for (let i = n; i > 0; i--) {
        const [c, have] = list[i - 1], cu = c / unit;
        t.mark('table', `${i},${j}`, 'path');
        // How many of coin i the best for j uses: the first k that gives table[i][j].
        let k = 0;
        if (T[i - 1][j] !== T[i][j]) for (k = 1; k <= have && k * cu <= j; k++) if (T[i - 1][j - k * cu] + k === T[i][j]) break;
        if (k) { result[c] = k; j -= k * cu; }
      }
    }
    t.step(T[n][m] === INF ? `${amount} cannot be given` : `${T[n][m]} coins: ${Object.entries(result).map(([c, k]) => `${k} × ${c}`).join(', ')}`, { line: dAt('return solutionFrom(table, coins)'), vars: {} });
    return T[n][m] === INF ? null : result;
  },
};

// ── Sorting ──
const sortField = [{ key: 'values', type: 'array', label: 'Array' }];
const sortNormalize = (raw = {}) => ({ values: ints(raw.values ?? [29, 10, 14, 37, 13, 5, 22], { most: 14 }) });
const sortPresets = [{ label: 'Seven values', input: { values: [29, 10, 14, 37, 13, 5, 22] } }, { label: 'Almost sorted', input: { values: [1, 2, 4, 3, 5, 6] } }];

const bubbleSource = `public static void bubbleSort(int[] array) {
  for (int end = array.length - 1; end > 0; end--) {
    boolean swapped = false;
    for (int i = 0; i < end; i++) {
      if (array[i] > array[i + 1]) {                // out of order: swap
        exchange(array, i, i + 1);
        swapped = true;
      }
    }
    if (!swapped) return;                            // a pass without swaps: sorted
  }
}`;
const bAt = lineFinder(bubbleSource);
export const bubble = {
  id: 'bubble-sort', topic: 'sorting', name: 'Bubble sort',
  hint: 'Swap neighbours out of order; each pass takes the largest left to the end',
  fields: sortField, presets: sortPresets, random: randomValues, normalize: sortNormalize, source: bubbleSource,
  run({ values }, t) {
    const a = t.array('array', values, { label: 'array' });
    for (let end = values.length - 1; end > 0; end--) {
      let swapped = false;
      a.pointer('end', end);
      for (let i = 0; i < end; i++) {
        a.pointer('i', i);
        const out = a.get(i) > a.get(i + 1);
        t.step(`${a.get(i)} ${out ? '>' : '≤'} ${a.get(i + 1)}${out ? ': swap' : ''}`, { line: bAt('if (array[i] > array[i + 1])'), vars: { end, i, swapped }, marks: { array: { [i]: 'compare', [i + 1]: 'compare' } } });
        if (out) { a.swap(i, i + 1); swapped = true; t.step(`Swapped`, { line: bAt('exchange(array, i, i + 1)'), vars: { end, i, swapped }, marks: { array: { [i + 1]: 'current' } } }); }
      }
      t.mark('array', end, 'done');
      if (!swapped) { t.step('A pass without swaps: sorted', { line: bAt('if (!swapped) return'), vars: { end } }); break; }
    }
    for (let i = 0; i < values.length; i++) t.mark('array', i, 'done');
    a.pointer('i', null); a.pointer('end', null);
    t.step(`Sorted: ${a.toArray().join(', ')}`, { line: null, vars: {} });
    return a.toArray();
  },
};

const insertionSource = `public static void insertionSort(int[] array) {
  for (int i = 1; i < array.length; i++) {
    int value = array[i];
    int j = i - 1;
    while (j >= 0 && array[j] > value) {             // larger ones move one place right
      array[j + 1] = array[j];
      j--;
    }
    array[j + 1] = value;                            // into the gap
  }
}`;
const iAt = lineFinder(insertionSource);
export const insertion = {
  id: 'insertion-sort', topic: 'sorting', name: 'Insertion sort',
  hint: 'Each value slides left past the larger ones before it',
  fields: sortField, presets: sortPresets, random: randomValues, normalize: sortNormalize, source: insertionSource,
  run({ values }, t) {
    const a = t.array('array', values, { label: 'array' });
    t.mark('array', 0, 'done');
    for (let i = 1; i < values.length; i++) {
      a.pointer('i', i);
      const value = a.get(i);
      t.step(`Insert ${value} into the sorted part before it`, { line: iAt('int value = array[i]'), vars: { i, value }, marks: { array: { [i]: 'current' } } });
      let j = i - 1;
      while (j >= 0 && a.get(j) > value) {
        a.pointer('j', j);
        a.swap(j, j + 1);
        t.step(`${a.get(j + 1)} > ${value}: it moves right`, { line: iAt('array[j + 1] = array[j];'), vars: { i, value, j }, marks: { array: { [j]: 'current', [j + 1]: 'compare' } } });
        j--;
      }
      a.pointer('j', null);
      for (let k = 0; k <= i; k++) t.mark('array', k, 'done');
      t.step(`${value} goes at position ${j + 1}`, { line: iAt('array[j + 1] = value'), vars: { i, value, j }, marks: { array: { [j + 1]: 'current' } } });
    }
    a.pointer('i', null);
    t.step(`Sorted: ${a.toArray().join(', ')}`, { line: null, vars: {} });
    return a.toArray();
  },
};

const selectionSource = `public static void selectionSort(int[] array) {
  for (int i = 0; i < array.length - 1; i++) {
    int min = i;
    for (int j = i + 1; j < array.length; j++) {
      if (array[j] < array[min]) min = j;            // the smallest of the rest
    }
    exchange(array, i, min);                         // to its place
  }
}`;
const sAt = lineFinder(selectionSource);
export const selection = {
  id: 'selection-sort', topic: 'sorting', name: 'Selection sort',
  hint: 'Find the smallest of the rest and put it next',
  fields: sortField, presets: sortPresets, random: randomValues, normalize: sortNormalize, source: selectionSource,
  run({ values }, t) {
    const a = t.array('array', values, { label: 'array' });
    for (let i = 0; i < values.length - 1; i++) {
      let min = i;
      a.pointer('i', i); a.pointer('min', min);
      for (let j = i + 1; j < values.length; j++) {
        a.pointer('j', j);
        const less = a.get(j) < a.get(min);
        if (less) { min = j; a.pointer('min', min); }
        t.step(less ? `${a.get(j)} is the smallest so far` : `${a.get(j)} ≥ ${a.get(min)}`, { line: sAt('if (array[j] < array[min]) min = j'), vars: { i, j, min }, marks: { array: { [j]: 'compare', [min]: 'current' } } });
      }
      a.pointer('j', null);
      if (min !== i) a.swap(i, min);
      t.mark('array', i, 'done');
      t.step(`${a.get(i)} goes to position ${i}`, { line: sAt('exchange(array, i, min)'), vars: { i, min } });
    }
    for (let i = 0; i < values.length; i++) t.mark('array', i, 'done');
    for (const p of ['i', 'min']) a.pointer(p, null);
    t.step(`Sorted: ${a.toArray().join(', ')}`, { line: null, vars: {} });
    return a.toArray();
  },
};

// ── Shortest paths: Floyd–Warshall (all pairs, a table) and Bellman–Ford (negative weights) ──
const FW = {
  nodes: [{ id: 'A', x: 40, y: 120 }, { id: 'B', x: 170, y: 40 }, { id: 'C', x: 170, y: 200 }, { id: 'D', x: 300, y: 120 }],
  edges: [{ from: 'A', to: 'B', w: 4 }, { from: 'A', to: 'C', w: 1 }, { from: 'C', to: 'B', w: 2 }, { from: 'B', to: 'D', w: 1 }, { from: 'C', to: 'D', w: 5 }, { from: 'D', to: 'A', w: 3 }],
  directed: true,
};
const floydSource = `public static int[][] floyd(int[][] weights) {
  int n = weights.length;
  int[][] dist = copy(weights);                       // an edge, or INFINITY
  for (int k = 0; k < n; k++) {                       // paths that may go through k
    for (int i = 0; i < n; i++) {
      for (int j = 0; j < n; j++) {
        if (dist[i][k] + dist[k][j] < dist[i][j]) {
          dist[i][j] = dist[i][k] + dist[k][j];       // shorter through k
        }
      }
    }
  }
  return dist;
}`;
const fAt = lineFinder(floydSource);
export const floyd = {
  id: 'floyd', topic: 'dp', name: 'Floyd–Warshall',
  hint: 'Shortest distances between every pair: allow one more vertex in between each round',
  fields: [{ key: 'graph', type: 'graph', label: 'Graph', weighted: true }],
  presets: [{ label: 'Four vertices', input: { graph: FW } }],
  random(seed) { const r = rng(seed); return { graph: randomGraph(r, { n: 5, weighted: true, directed: true, extra: 4 }) }; },
  normalize(raw = {}) { const graph = normalizeGraph(raw.graph ?? FW, { weighted: true, most: 7 }); return { graph }; },
  source: floydSource,
  run({ graph }, t) {
    const ids = graph.nodes.map((n) => n.id), n = ids.length;
    t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: graph.directed }, { label: 'graph' });
    const D = ids.map((a, i) => ids.map((b, j) => (i === j ? 0 : Infinity)));
    for (const e of graph.edges) { const i = ids.indexOf(e.from), j = ids.indexOf(e.to); D[i][j] = Math.min(D[i][j], e.w); if (!graph.directed) D[j][i] = Math.min(D[j][i], e.w); }
    const tab = t.matrix('dist', n, n, '', { label: 'dist[i][j]', rowLabels: ids, colLabels: ids });
    D.forEach((row, i) => row.forEach((v, j) => tab.set(i, j, v)));
    t.step('dist starts as the edges (∞ when there is none)', { line: fAt('int[][] dist = copy(weights)'), vars: { n } });
    for (let k = 0; k < n; k++) {
      t.step(`Round ${k + 1}: paths may now go through ${ids[k]}`, { line: fAt('for (int k = 0; k < n; k++)'), vars: { k: ids[k] }, marks: { graph: { [ids[k]]: 'current' } } });
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === k || j === k || i === j) continue;
        const via = D[i][k] + D[k][j];
        if (via < D[i][j]) {
          const before = D[i][j];
          D[i][j] = via; tab.set(i, j, via);
          t.step(`${ids[i]} → ${ids[k]} → ${ids[j]}: ${D[i][k]} + ${D[k][j]} = ${via} < ${before === Infinity ? '∞' : before}`, { line: fAt('dist[i][j] = dist[i][k] + dist[k][j]'), vars: { k: ids[k], i: ids[i], j: ids[j] }, marks: { graph: { [ids[k]]: 'current', [ids[i]]: 'compare', [ids[j]]: 'compare' }, dist: { [`${i},${j}`]: 'current', [`${i},${k}`]: 'compare', [`${k},${j}`]: 'compare' } } });
        }
      }
    }
    t.step('Every pair has its shortest distance', { line: fAt('return dist'), vars: {} });
    return Object.fromEntries(ids.map((a, i) => [a, Object.fromEntries(ids.map((b, j) => [b, D[i][j]]))]));
  },
};

const BF = {
  nodes: [{ id: 'S', x: 40, y: 120 }, { id: 'A', x: 170, y: 40 }, { id: 'B', x: 170, y: 200 }, { id: 'C', x: 300, y: 40 }, { id: 'D', x: 300, y: 200 }],
  edges: [{ from: 'S', to: 'A', w: 6 }, { from: 'S', to: 'B', w: 7 }, { from: 'A', to: 'C', w: 5 }, { from: 'A', to: 'B', w: 8 }, { from: 'A', to: 'D', w: -4 }, { from: 'B', to: 'C', w: -3 }, { from: 'B', to: 'D', w: 9 }, { from: 'C', to: 'A', w: -2 }, { from: 'D', to: 'C', w: 7 }],
  directed: true,
};
const bfSource = `public static <T> Map<Vertex<T>, Integer> bellmanFord(Graph<T, Integer> graph, Vertex<T> source) {
  Map<Vertex<T>, Integer> dist = new HashMap<>();
  for (Vertex<T> v : graph.getVertices()) dist.add(v, Integer.MAX_VALUE);
  dist.add(source, 0);
  for (int round = 1; round < graph.getVertices().size(); round++) {   // n - 1 rounds
    for (Edge<T, Integer> edge : graph.getEdges()) {
      int d = dist.get(edge.getSource());
      if (d != Integer.MAX_VALUE && d + edge.getLabel() < dist.get(edge.getTarget())) {
        dist.add(edge.getTarget(), d + edge.getLabel());              // relax the edge
      }
    }
  }
  for (Edge<T, Integer> edge : graph.getEdges()) {                    // one more: still shorter?
    int d = dist.get(edge.getSource());
    if (d != Integer.MAX_VALUE && d + edge.getLabel() < dist.get(edge.getTarget())) {
      throw new IllegalStateException("a negative cycle");
    }
  }
  return dist;
}`;
const gAt = lineFinder(bfSource);
export const bellmanFord = {
  id: 'bellman-ford', topic: 'graphs', name: 'Bellman–Ford',
  hint: 'Shortest distances with negative weights: relax every edge n − 1 times, then look for a negative cycle',
  fields: [{ key: 'graph', type: 'graph', label: 'Graph (directed)', weighted: true, directed: true }, { key: 'start', type: 'vertex', label: 'Source', of: 'graph' }],
  presets: [{ label: 'Negative weights', input: { graph: BF, start: 'S' } }, { label: 'A negative cycle', input: { graph: { ...BF, edges: [...BF.edges.filter((e) => !(e.from === 'D' && e.to === 'C')), { from: 'D', to: 'C', w: 1 }] }, start: 'S' } }],
  random(seed) { const r = rng(seed); const g = randomGraph(r, { n: 5, weighted: true, directed: true, acyclic: true, extra: 3 }); g.edges.forEach((e) => { if (r.next() < 0.25) e.w = -r.int(1, 3); }); return { graph: g, start: 'A' }; },
  normalize(raw = {}) { const graph = normalizeGraph(raw.graph ?? BF, { weighted: true, directed: true, most: 8 }); return { graph, start: startOf(graph, raw.start ?? 'S') }; },
  source: bfSource,
  run({ graph, start }, t) {
    const g = t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: true }, { label: 'graph' });
    const dist = new Map(graph.nodes.map((n) => [n.id, Infinity]));
    dist.set(start, 0);
    for (const [k, v] of dist) g.setValue(k, v);
    t.step(`dist(${start}) = 0, the rest ∞`, { line: gAt('dist.add(source, 0)'), vars: { source: start } });
    const n = graph.nodes.length;
    for (let round = 1; round < n; round++) {
      let changed = false;
      for (const e of graph.edges) {
        const d = dist.get(e.from);
        if (d !== Infinity && d + e.w < dist.get(e.to)) {
          dist.set(e.to, d + e.w); g.setValue(e.to, d + e.w); changed = true;
          t.step(`Round ${round}: ${e.from} → ${e.to} (${e.w}): ${d} + ${e.w} = ${d + e.w}, shorter`, { line: gAt('dist.add(edge.getTarget(), d + edge.getLabel())'), vars: { round, d, w: e.w }, marks: { graph: { [edgeKey(e.from, e.to)]: 'current', [e.to]: 'current' } } });
        }
      }
      if (!changed) { t.step(`Round ${round}: nothing changed, the distances are final`, { line: gAt('for (int round = 1;'), vars: { round } }); break; }
    }
    for (const e of graph.edges) {
      const d = dist.get(e.from);
      if (d !== Infinity && d + e.w < dist.get(e.to)) {
        t.mark('graph', edgeKey(e.from, e.to), 'error');
        t.step(`${e.from} → ${e.to} still makes it shorter after n − 1 rounds: a negative cycle`, { line: gAt('throw new IllegalStateException'), vars: {} });
        return null;
      }
    }
    t.step(`Shortest distances from ${start}: ${[...dist].map(([k, v]) => `${k} ${v === Infinity ? '∞' : v}`).join(', ')}`, { line: gAt('return dist'), vars: {} });
    return Object.fromEntries(dist);
  },
};
