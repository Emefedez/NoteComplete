// Quicksort (partition around the last value) and mergesort counting inversions (divide and
// conquer, activity 10: the merge counts, for each value of the right half that goes first,
// the values still left in the left half).
import { lineFinder, ints, rng } from './common.js';

const quickSource = `public static void quickSort(int[] array, int i, int j) {
  if (i < j) {
    int p = partition(array, i, j);
    quickSort(array, i, p - 1);       // the smaller ones
    quickSort(array, p + 1, j);       // the larger ones
  }
}

private static int partition(int[] array, int i, int j) {
  int pivot = array[j];
  int left = i;                       // where the next smaller one goes
  for (int k = i; k < j; k++) {
    if (array[k] < pivot) {
      exchange(array, left, k);
      left++;
    }
  }
  exchange(array, left, j);           // the pivot to its place
  return left;
}

private static void exchange(int[] array, int i, int j) {
  int aux = array[i];
  array[i] = array[j];
  array[j] = aux;
}`;
const qAt = lineFinder(quickSource);
const arrayFields = [{ key: 'values', type: 'array', label: 'Array' }];
const randomArray = (seed) => { const r = rng(seed); return { values: Array.from({ length: r.int(7, 10) }, () => r.int(1, 99)) }; };

export const quicksort = {
  id: 'quicksort',
  topic: 'sorting',
  name: 'Quicksort',
  hint: 'Partition around a pivot (the last value), then sort each side',
  fields: arrayFields,
  presets: [{ label: 'Nine values', input: { values: [38, 81, 22, 48, 13, 69, 93, 14, 45] } }, { label: 'With repeats', input: { values: [5, 3, 5, 1, 3, 5, 2] } }],
  random: randomArray,
  normalize(raw = {}) { return { values: ints(raw.values ?? [38, 81, 22, 48, 13, 69, 93, 14, 45], { most: 16 }) }; },
  source: quickSource,
  run({ values }, t) {
    const a = t.array('array', values, { label: 'array' });
    const range = (i, j, mark) => { for (let x = i; x <= j; x++) t.mark('array', x, mark); };
    const sort = (i, j) => {
      t.call('quickSort', `${i}, ${j}`);
      a.pointer('i', i); a.pointer('j', j);
      if (i < j) {
        t.step(`Sort positions ${i} to ${j}`, { line: qAt('if (i < j)'), vars: { i, j } });
        t.call('partition', `${i}, ${j}`);
        const pivot = a.get(j);
        let left = i;
        a.pointer('i', null); a.pointer('j', null); a.pointer('left', left);
        t.step(`The pivot is the last value, ${pivot}`, { line: qAt('int pivot = array[j]'), vars: { i, j, pivot, left }, marks: { array: { [j]: 'current' } } });
        for (let k = i; k < j; k++) {
          a.pointer('k', k);
          const less = a.get(k) < pivot;
          t.step(`${a.get(k)} ${less ? '<' : '≥'} ${pivot}${less ? `: it goes to the left part (position ${left})` : ': it stays right'}`, { line: qAt('if (array[k] < pivot)'), vars: { i, j, pivot, left, k }, marks: { array: { [j]: 'current', [k]: 'compare' } } });
          if (less) {
            if (left !== k) { a.swap(left, k); t.step(`Exchange positions ${left} and ${k}`, { line: qAt('exchange(array, left, k)'), vars: { i, j, pivot, left, k }, marks: { array: { [j]: 'current', [left]: 'compare' } } }); }
            left++;
            a.pointer('left', left);
          }
        }
        a.pointer('k', null);
        if (left !== j) a.swap(left, j);
        t.mark('array', left, 'done');
        t.step(`The pivot ${pivot} goes to position ${left}: smaller ones left of it, the rest right`, { line: qAt('exchange(array, left, j)'), vars: { i, j, pivot, left } });
        t.ret();
        a.pointer('left', null);
        sort(i, left - 1);
        sort(left + 1, j);
      } else {
        if (i === j) t.mark('array', i, 'done');
        t.step(i === j ? `Position ${i} alone is sorted` : 'Nothing to sort here', { line: qAt('if (i < j)'), vars: { i, j } });
      }
      a.pointer('i', null); a.pointer('j', null);
      t.ret();
    };
    t.step(`Sort ${values.length} values`, { line: qAt('public static void quickSort'), vars: {} });
    sort(0, values.length - 1);
    range(0, values.length - 1, 'done');
    t.step(`Sorted: ${a.toArray().join(', ')}`, { line: null, vars: {} });
    return a.toArray();
  },
};

const mergeSource = `public static int inversions(int[] array, int start, int end) {
  if (start >= end) return 0;                      // one value: no inversions
  int middle = (start + end) / 2;
  int count = inversions(array, start, middle);
  count += inversions(array, middle + 1, end);
  count += mergeCount(array, start, middle, middle + 1, end);
  return count;
}

private static int mergeCount(int[] array, int start1, int end1, int start2, int end2) {
  int i = start1, j = start2, count = 0;
  List<Integer> temp = new ArrayList<>();
  while (i <= end1 && j <= end2) {
    if (array[i] <= array[j]) {
      temp.add(array[i++]);
    } else {
      temp.add(array[j++]);
      count += end1 - i + 1;     // array[j] goes before every value left in the first half
    }
  }
  while (i <= end1) temp.add(array[i++]);
  while (j <= end2) temp.add(array[j++]);
  for (int k = start1; k <= end2; k++) {
    array[k] = temp.remove(0);
  }
  return count;
}`;
const mAt = lineFinder(mergeSource);

export const mergeInversions = {
  id: 'inversions',
  topic: 'divide',
  name: 'Mergesort counting inversions',
  hint: 'Sort by halves and merge; each value of the right half that goes first counts the ones it jumps',
  fields: arrayFields,
  presets: [{ label: 'Eight values', input: { values: [7, 3, 8, 1, 6, 2, 5, 4] } }, { label: 'Activity 10 (22)', input: { values: [1, 5, 4, 8, 10, 2, 6, 9, 12, 11, 3, 7] } }, { label: 'Sorted', input: { values: [1, 2, 3, 4, 5] } }],
  random: randomArray,
  normalize(raw = {}) { return { values: ints(raw.values ?? [7, 3, 8, 1, 6, 2, 5, 4], { most: 16 }) }; },
  source: mergeSource,
  run({ values }, t) {
    const a = t.array('array', values, { label: 'array' });
    const temp = t.array('temp', [], { label: 'temp' });
    const total = t.value('count', 0, { label: 'inversions so far' });
    const span = (s, e, mark) => { for (let x = s; x <= e; x++) t.mark('array', x, mark); };
    const rec = (s, e) => {
      t.call('inversions', `${s}, ${e}`);
      if (s >= e) {
        t.step(`Positions ${s}..${e}: one value, no inversions`, { line: mAt('if (start >= end) return 0'), vars: { start: s, end: e }, marks: { array: { [s]: 'current' } } });
        t.ret();
        return 0;
      }
      const mid = Math.floor((s + e) / 2);
      t.step(`Split ${s}..${e} at ${mid}`, { line: mAt('int middle = (start + end) / 2'), vars: { start: s, end: e, middle: mid } });
      let count = rec(s, mid);
      count += rec(mid + 1, e);
      t.call('mergeCount', `${s}, ${mid}, ${mid + 1}, ${e}`);
      let i = s, j = mid + 1, here = 0;
      span(s, mid, 'visited');
      a.pointer('i', i); a.pointer('j', j);
      t.step(`Merge ${s}..${mid} with ${mid + 1}..${e}`, { line: mAt('int i = start1, j = start2, count = 0'), vars: { start1: s, end1: mid, start2: mid + 1, end2: e, count: here } });
      while (i <= mid && j <= e) {
        if (a.get(i) <= a.get(j)) {
          t.step(`${a.get(i)} ≤ ${a.get(j)}: take ${a.get(i)} from the left half`, { line: mAt('temp.add(array[i++])'), vars: { i, j, count: here }, marks: { array: { [i]: 'compare', [j]: 'compare' } } });
          temp.push(a.get(i)); i++;
        } else {
          const jumped = mid - i + 1;
          here += jumped;
          total.set(total.get() + jumped);
          t.step(`${a.get(j)} < ${a.get(i)}: take ${a.get(j)}; it goes before the ${jumped} value${jumped === 1 ? '' : 's'} left in the left half: +${jumped}`, { line: mAt('count += end1 - i + 1'), vars: { i, j, count: here }, marks: { array: { [i]: 'compare', [j]: 'error' } } });
          temp.push(a.get(j)); j++;
        }
        a.pointer('i', i <= mid ? i : null); a.pointer('j', j <= e ? j : null);
      }
      if (i <= mid || j <= e) {
        while (i <= mid) temp.push(a.get(i++));
        while (j <= e) temp.push(a.get(j++));
        t.step('Copy what is left of either half', { line: mAt('while (i <= end1) temp.add(array[i++])'), vars: { count: here } });
      }
      a.pointer('i', null); a.pointer('j', null);
      for (let k = s; k <= e; k++) a.set(k, temp.toArray()[k - s]);
      temp.clear();
      span(s, e, 'done');
      t.step(`Positions ${s}..${e} are merged in order (${here} inversion${here === 1 ? '' : 's'} between the halves)`, { line: mAt('array[k] = temp.remove(0)'), vars: { count: here } });
      span(s, e, null);
      t.ret();
      count += here;
      t.step(`inversions(${s}, ${e}) = ${count}`, { line: mAt('return count;', 1), vars: { start: s, end: e, count } });
      t.ret();
      return count;
    };
    t.step(`Count the inversions of ${values.length} values (pairs out of order)`, { line: mAt('public static int inversions'), vars: {} });
    const n = rec(0, values.length - 1);
    span(0, values.length - 1, 'done');
    t.step(`Done: ${n} inversion${n === 1 ? '' : 's'}, and the array is sorted`, { line: null, vars: {} });
    return { inversions: n, sorted: a.toArray() };
  },
};
