// Binary max heaps (activity 4), stored as the course does: an ArrayList from position 1
// (position 0 holds null), the parent of i at i/2. Insert sifts up; removing the maximum puts
// the last value at the root and sinks it; heapsort orders a heap built with insert + orderHeap.
import { lineFinder, ints, clampInt, rng } from './common.js';

const heapCode = `public void add(T value) throws NullPointerException {
  if (value == null) throw new NullPointerException();
  arrayHeap.add(value);                              // at the end: a new leaf
  int child = arrayHeap.size() - 1;
  while (child > 1 && arrayHeap.get(child / 2).compareTo(value) < 0) {
    arrayHeap.set(child, arrayHeap.get(child / 2));  // the parent goes down
    arrayHeap.set(child / 2, value);
    child = child / 2;
  }
}

public T removeMaxValue() throws HeapEmptyException {
  if (isEmpty()) throw new HeapEmptyException();
  T max = arrayHeap.get(1);
  T last = arrayHeap.remove(arrayHeap.size() - 1);
  if (arrayHeap.size() > 1) {
    arrayHeap.set(1, last);                          // the last leaf to the root
    sink(1);
  }
  return max;
}

private void sink(int hollow) {
  int child = hollow * 2;
  T value = arrayHeap.get(hollow);
  boolean end = false;
  while (child <= arrayHeap.size() - 1 && !end) {
    if (child < arrayHeap.size() - 1
        && arrayHeap.get(child + 1).compareTo(arrayHeap.get(child)) > 0) {
      child++;                                       // the right child is larger
    }
    if (arrayHeap.get(child).compareTo(value) > 0) {
      arrayHeap.set(hollow, arrayHeap.get(child));   // the larger child goes up
      arrayHeap.set(child, value);
      hollow = child;
      child = hollow * 2;
    } else {
      end = true;
    }
  }
}`;

// Sift up and sink on a tracked heap, stepping at the lines of `at`.
function heapOps(t, h, at, extra = () => ({})) {
  const add = (value) => {
    t.call('add', value);
    const p0 = h.add(value);
    t.step(`Add ${value} at the end (position ${p0})`, { line: at('arrayHeap.add(value)'), vars: { value, child: p0, ...extra() }, marks: { heap: { [p0]: 'current' } } });
    let child = p0;
    while (child > 1) {
      const parent = Math.floor(child / 2);
      const up = h.get(parent) < value;
      t.step(`Parent of ${child} is ${parent} (${h.get(parent)}): ${h.get(parent)} ${up ? '<' : '≥'} ${value}${up ? ', so they swap' : ', so it stays'}`, { line: at('while (child > 1'), vars: { value, child, ...extra() }, marks: { heap: { [child]: 'current', [parent]: 'compare' } } });
      if (!up) break;
      h.swap(child, parent);
      t.step(`${value} goes up to position ${parent}, ${h.get(child)} down to ${child}`, { line: at('arrayHeap.set(child / 2, value)'), vars: { value, child: parent, ...extra() }, marks: { heap: { [parent]: 'current' } } });
      child = parent;
    }
    if (child === 1) t.step(`${value} is at the root`, { line: at('while (child > 1'), vars: { value, child, ...extra() }, marks: { heap: { 1: 'current' } } });
    t.ret();
  };
  const sink = (start) => {
    t.call('sink', start);
    let hollow = start, child = hollow * 2;
    const value = h.get(hollow);
    for (;;) {
      if (child > h.size()) {
        t.step(`${value} at position ${hollow} has no children: it stays`, { line: at('while (child <= arrayHeap.size() - 1'), vars: { hollow, child, value, ...extra() }, marks: { heap: { [hollow]: 'current' } } });
        break;
      }
      if (child < h.size() && h.get(child + 1) > h.get(child)) {
        t.step(`Children of ${hollow}: ${h.get(child)} and ${h.get(child + 1)}; the right one is larger`, { line: at('child++'), vars: { hollow, child: child + 1, value, ...extra() }, marks: { heap: { [hollow]: 'current', [child]: 'compare', [child + 1]: 'compare' } } });
        child++;
      }
      const down = h.get(child) > value;
      t.step(`Larger child ${h.get(child)} (position ${child}) ${down ? '>' : '≤'} ${value}${down ? ': swap them' : ': it stays'}`, { line: at('if (arrayHeap.get(child).compareTo(value) > 0)'), vars: { hollow, child, value, ...extra() }, marks: { heap: { [hollow]: 'current', [child]: 'compare' } } });
      if (!down) break;
      h.swap(hollow, child);
      t.step(`${h.get(hollow)} goes up to ${hollow}, ${value} down to ${child}`, { line: at('arrayHeap.set(child, value)'), vars: { hollow: child, child: child * 2, value, ...extra() }, marks: { heap: { [child]: 'current' } } });
      hollow = child; child = hollow * 2;
    }
    t.ret();
  };
  const removeMax = () => {
    t.call('removeMaxValue');
    const max = h.get(1);
    t.step(`The maximum is at the root: ${max}`, { line: at('T max = arrayHeap.get(1)'), vars: { max, ...extra() }, marks: { heap: { 1: 'removed', [h.size()]: 'compare' } } });
    const last = h.removeLast();
    if (h.size() >= 1) {
      h.set(1, last);
      t.step(`The last leaf (${last}) goes to the root`, { line: at('arrayHeap.set(1, last)'), vars: { max, last, ...extra() }, marks: { heap: { 1: 'current' } } });
      sink(1);
    } else t.step(`${max} was the only value: the heap is empty`, { line: at('if (arrayHeap.size() > 1)'), vars: { max, ...extra() } });
    t.ret();
    return max;
  };
  return { add, sink, removeMax };
}

const insertAt = lineFinder(heapCode);
export const heapInsertRemove = {
  id: 'heap',
  topic: 'heaps',
  name: 'Insert and remove the maximum',
  hint: 'Insert values (sift up), then remove the maximum (sink), on the tree and its array',
  fields: [
    { key: 'values', type: 'array', label: 'Values to insert, in order' },
    { key: 'removes', type: 'int', label: 'Then remove the maximum, times', min: 0, max: 20 },
  ],
  presets: [
    { label: 'Seven values, two removes', input: { values: [50, 30, 40, 10, 20, 60, 35], removes: 2 } },
    { label: 'Already sorted', input: { values: [1, 2, 3, 4, 5, 6, 7], removes: 3 } },
  ],
  random(seed) { const r = rng(seed); return { values: Array.from({ length: r.int(6, 10) }, () => r.int(1, 99)), removes: r.int(1, 3) }; },
  normalize(raw = {}) { const values = ints(raw.values ?? [50, 30, 40, 10, 20, 60, 35], { most: 31 }); return { values, removes: clampInt(raw.removes, 0, values.length, 2) }; },
  source: heapCode,
  run({ values, removes }, t) {
    const h = t.heap('heap', { label: 'heap (tree and arrayHeap)' });
    const out = t.array('removed', [], { label: 'removed, in order' });
    const ops = heapOps(t, h, insertAt);
    t.step('An empty heap: arrayHeap holds only null at position 0', { line: null });
    for (const v of values) ops.add(v);
    for (let k = 0; k < removes && h.size(); k++) {
      const max = ops.removeMax();
      out.push(max);
      t.step(`removeMaxValue() returns ${max}`, { line: insertAt('return max'), vars: { max } });
    }
    t.step(`Done: the heap holds ${h.size()} value${h.size() === 1 ? '' : 's'}, the maximum (${h.size() ? h.get(1) : 'none'}) at the root`, { line: null, vars: {} });
    return { heap: h.toArray(), removed: out.toArray() };
  },
};

const sortCode = `public static void heapSort(int[] values) {
  BinaryMaxHeap<Integer> heap = new BinaryMaxHeap<>();
  for (int v : values) {
    heap.insert(v);                   // at the end, no order yet
  }
  heap.orderHeap();
  for (int i = values.length - 1; i >= 0; i--) {
    values[i] = heap.removeMaxValue(); // the largest left, from the end
  }
}

public void orderHeap() {
  // the parents, from the last one (size / 2) back to the root
  for (int i = (arrayHeap.size() - 1) / 2; i > 0; i--) {
    sink(i);
  }
}

${heapCode.slice(heapCode.indexOf('public T removeMaxValue'))}`;
const sortAt = lineFinder(sortCode);
export const heapsort = {
  id: 'heapsort',
  topic: 'heaps',
  name: 'Heapsort',
  hint: 'Insert everything, order the heap (sink every parent), then remove the maximum into the array from the end',
  fields: [{ key: 'values', type: 'array', label: 'Array to sort' }],
  presets: [{ label: 'Eight values', input: { values: [5, 13, 2, 25, 7, 17, 20, 8] } }, { label: 'Reversed', input: { values: [9, 8, 7, 6, 5, 4, 3] } }],
  random(seed) { const r = rng(seed); return { values: Array.from({ length: r.int(6, 10) }, () => r.int(1, 99)) }; },
  normalize(raw = {}) { return { values: ints(raw.values ?? [5, 13, 2, 25, 7, 17, 20, 8], { most: 20 }) }; },
  source: sortCode,
  run({ values }, t) {
    const arr = t.array('values', values, { label: 'values' });
    const h = t.heap('heap', { label: 'heap (tree and arrayHeap)' });
    let i = null;
    const ops = heapOps(t, h, sortAt, () => (i === null ? {} : { i }));
    t.step(`Sort ${values.length} values`, { line: sortAt('BinaryMaxHeap<Integer> heap'), vars: {} });
    for (const v of values) {
      const p = h.add(v);
      t.step(`insert(${v}): at position ${p}, no sifting`, { line: sortAt('heap.insert(v)'), vars: { v }, marks: { heap: { [p]: 'new' } } });
    }
    t.step('orderHeap(): sink every parent, from the last one back to the root', { line: sortAt('heap.orderHeap()'), vars: {} });
    t.call('orderHeap');
    for (let p = Math.floor(h.size() / 2); p > 0; p--) {
      t.step(`sink(${p})`, { line: sortAt('sink(i);'), vars: { i: p }, marks: { heap: { [p]: 'current' } } });
      ops.sink(p);
    }
    t.ret();
    t.step('The heap is ordered: every parent ≥ its children', { line: sortAt('heap.orderHeap()'), vars: {} });
    for (i = values.length - 1; i >= 0; i--) {
      arr.pointer('i', i);
      const max = ops.removeMax();
      arr.set(i, max); t.mark('values', i, 'done');
      t.step(`values[${i}] = ${max}`, { line: sortAt('values[i] = heap.removeMaxValue()'), vars: { i, max } });
    }
    arr.pointer('i', null); i = null;
    t.step(`Sorted: ${arr.toArray().join(', ')}`, { line: null, vars: {} });
    return arr.toArray();
  },
};
