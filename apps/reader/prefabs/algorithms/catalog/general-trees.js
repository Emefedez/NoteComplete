// General trees (activity 5), through the course's Tree interface: the first child
// (getLeftMostChild) and its brothers (getRightSibling). Sum, height, grade, level of a value,
// 2-3 tree, selection tree. Trees are written "A(B(E), C(F, G), D)".
import { lineFinder, rng } from './common.js';
import { parseGeneral, generalText } from './trees-common.js';

const field = { key: 'tree', type: 'line', label: 'Tree', hint: 'A(B(E), C(F, G), D): children in brackets' };
const read = (raw, fallback) => { const text = typeof raw === 'string' ? raw : fallback; parseGeneral(text); return text; };
const randomGeneral = (r, numbers = false) => {
  let k = 0;
  const label = () => (numbers ? r.int(1, 30) : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[k++]);
  const make = (depth) => ({ label: label(), children: depth < 2 ? Array.from({ length: r.int(depth ? 0 : 2, 3) }, () => make(depth + 1)) : [] });
  return generalText(make(0));
};
// A recursion over the children of `n`: `visit(child)` for each, in order.
const each = (n, visit) => n.children.forEach(visit);

const sumSource = `public static int getSum(Tree<Integer> tree) {
  if (tree.isEmpty()) return 0;
  int sum = tree.getRootValue();
  if (tree.hasLeftMostChild()) {
    Tree<Integer> child = tree.getLeftMostChild();
    while (child != null) {                         // the first child and its brothers
      sum += getSum(child);
      child = child.hasRightSibling() ? child.getRightSibling() : null;
    }
  }
  return sum;
}`;
const sAt = lineFinder(sumSource);
export const sum = {
  id: 'tree-sum', topic: 'trees', name: 'Sum of a general tree',
  hint: 'Its root plus the sum of each child, brother by brother',
  fields: [field],
  presets: [{ label: 'Activity tree (67)', input: { tree: '10(8(7), 15(4, 20), 3)' } }],
  random(seed) { return { tree: randomGeneral(rng(seed), true) }; },
  normalize(raw = {}) { const tree = read(raw.tree, '10(8(7), 15(4, 20), 3)'); const bad = []; const chk = (n) => { if (typeof n.label !== 'number') bad.push(n.label); n.children.forEach(chk); }; const r = parseGeneral(tree); if (r) chk(r); if (bad.length) throw Error(`Not a number: ${bad[0]}`); return { tree }; },
  source: sumSource,
  run({ tree }, t) {
    const root = parseGeneral(tree);
    t.tree('tree', root, { label: 'tree', binary: false });
    const total = t.value('sum', 0, { label: 'returned' });
    const go = (n) => {
      t.call('getSum', n.label);
      let s = n.label;
      t.step(`Start with ${n.label}`, { line: sAt('int sum = tree.getRootValue()'), vars: { root: n.label, sum: s }, marks: { tree: { [n.id]: 'current' } } });
      each(n, (c) => { const v = go(c); s += v; t.step(`${n.label}: + ${v} from ${c.label}, sum ${s}`, { line: sAt('sum += getSum(child)'), vars: { root: n.label, child: c.label, sum: s }, marks: { tree: { [n.id]: 'current', [c.id]: 'done' } } }); });
      total.set(s); t.mark('tree', n.id, 'done');
      t.step(`getSum(${n.label}) = ${s}`, { line: sAt('return sum'), vars: { root: n.label, sum: s } });
      t.ret();
      return s;
    };
    const v = root ? go(root) : 0;
    t.step(`The values add up to ${v}`, { line: null, vars: {} });
    return v;
  },
};

const heightSource = `public static <T> int getHeight(Tree<T> tree) {
  if (tree.isEmpty() || !tree.hasLeftMostChild()) return 0;   // empty or a leaf
  int max = 0;
  Tree<T> child = tree.getLeftMostChild();
  while (child != null) {
    max = Math.max(max, getHeight(child));
    child = child.hasRightSibling() ? child.getRightSibling() : null;
  }
  return 1 + max;
}`;
const hAt = lineFinder(heightSource);
export const genHeight = {
  id: 'tree-height-general', topic: 'trees', name: 'Height of a general tree',
  hint: 'One more than its tallest child; a leaf has height 0',
  fields: [field],
  presets: [{ label: 'Tree A (selection)', input: { tree: 'A(A(A, B, C), D(D, E))' } }, { label: 'Tree B', input: { tree: 'A(B(E), C(F, G), D, H)' } }],
  random(seed) { return { tree: randomGeneral(rng(seed)) }; },
  normalize(raw = {}) { return { tree: read(raw.tree, 'A(B(E), C(F, G), D, H)') }; },
  source: heightSource,
  run({ tree }, t) {
    const root = parseGeneral(tree);
    t.tree('tree', root, { label: 'tree', binary: false });
    const go = (n) => {
      t.call('getHeight', n.label);
      if (!n.children.length) { t.mark('tree', n.id, 'done'); t.step(`${n.label} is a leaf: 0`, { line: hAt('return 0;   // empty or a leaf'), vars: { root: n.label } }); t.ret(); return 0; }
      let max = 0;
      t.step(`${n.label}: the tallest of its ${n.children.length} children`, { line: hAt('int max = 0'), vars: { root: n.label, max }, marks: { tree: { [n.id]: 'current' } } });
      each(n, (c) => { max = Math.max(max, go(c)); t.step(`${n.label}: max so far ${max}`, { line: hAt('max = Math.max(max, getHeight(child))'), vars: { root: n.label, child: c.label, max }, marks: { tree: { [n.id]: 'current' } } }); });
      t.mark('tree', n.id, 'done');
      t.step(`getHeight(${n.label}) = 1 + ${max} = ${max + 1}`, { line: hAt('return 1 + max'), vars: { root: n.label, max } });
      t.ret();
      return max + 1;
    };
    const v = root ? go(root) : 0;
    t.step(`Height ${v}`, { line: null, vars: {} });
    return v;
  },
};

const gradeSource = `public static <T> int getGrade(Tree<T> tree) {
  if (tree.isEmpty()) return 0;
  int children = 0, grade = 0;
  Tree<T> child = tree.hasLeftMostChild() ? tree.getLeftMostChild() : null;
  while (child != null) {
    children++;
    grade = Math.max(grade, getGrade(child));          // the grade below
    child = child.hasRightSibling() ? child.getRightSibling() : null;
  }
  return Math.max(grade, children);                    // or this node's own
}`;
const gAt = lineFinder(gradeSource);
export const grade = {
  id: 'tree-grade', topic: 'trees', name: 'Grade of a general tree',
  hint: 'The most children any node has',
  fields: [field],
  presets: [{ label: 'Tree A (3)', input: { tree: 'A(A(A, B, C), D(D, E))' } }, { label: 'Tree B (4)', input: { tree: 'A(B(E), C(F, G), D, H)' } }],
  random(seed) { return { tree: randomGeneral(rng(seed)) }; },
  normalize(raw = {}) { return { tree: read(raw.tree, 'A(B(E), C(F, G), D, H)') }; },
  source: gradeSource,
  run({ tree }, t) {
    const root = parseGeneral(tree);
    t.tree('tree', root, { label: 'tree', binary: false });
    const go = (n) => {
      t.call('getGrade', n.label);
      let count = 0, g = 0;
      each(n, (c) => { count++; t.step(`${n.label}: child ${count}, ${c.label}`, { line: gAt('children++'), vars: { root: n.label, children: count, grade: g }, marks: { tree: { [n.id]: 'current', [c.id]: 'compare' } } }); g = Math.max(g, go(c)); });
      const v = Math.max(g, count);
      t.mark('tree', n.id, 'done');
      t.step(`getGrade(${n.label}) = max(${g} below, ${count} children) = ${v}`, { line: gAt('return Math.max(grade, children)'), vars: { root: n.label, children: count, grade: g } });
      t.ret();
      return v;
    };
    const v = root ? go(root) : 0;
    t.step(`Grade ${v}`, { line: null, vars: {} });
    return v;
  },
};

const levelSource = `public static <T> int getLevel(Tree<T> tree, T value) {
  return getLevel(tree, value, 0);
}

private static <T> int getLevel(Tree<T> tree, T value, int level) {
  if (tree.isEmpty()) return -1;
  if (tree.getRootValue().equals(value)) return level;     // found here
  Tree<T> child = tree.hasLeftMostChild() ? tree.getLeftMostChild() : null;
  while (child != null) {
    int found = getLevel(child, value, level + 1);
    if (found != -1) return found;
    child = child.hasRightSibling() ? child.getRightSibling() : null;
  }
  return -1;                                                // not below this node
}`;
const lAt = lineFinder(levelSource);
export const level = {
  id: 'tree-level', topic: 'trees', name: 'Level of a value in a general tree',
  hint: 'Depth first, one level more at each call; −1 when it is not there',
  fields: [field, { key: 'value', type: 'line', label: 'Value' }],
  presets: [{ label: 'G in tree B (2)', input: { tree: 'A(B(E), C(F, G), D, H)', value: 'G' } }, { label: 'D in tree B (1)', input: { tree: 'A(B(E), C(F, G), D, H)', value: 'D' } }, { label: 'X (−1)', input: { tree: 'A(B(E), C(F, G), D, H)', value: 'X' } }],
  random(seed) { const r = rng(seed); return { tree: randomGeneral(r), value: r.pick(['B', 'D', 'F', 'H']) }; },
  normalize(raw = {}) { return { tree: read(raw.tree, 'A(B(E), C(F, G), D, H)'), value: typeof raw.value === 'string' ? raw.value.trim() : 'G' }; },
  source: levelSource,
  run({ tree, value }, t) {
    const root = parseGeneral(tree);
    t.tree('tree', root, { label: 'tree', binary: false });
    const go = (n, lv) => {
      t.call('getLevel', `${n.label}, ${lv}`);
      if (String(n.label) === value) { t.mark('tree', n.id, 'path'); t.step(`${n.label} is it: level ${lv}`, { line: lAt('if (tree.getRootValue().equals(value)) return level'), vars: { root: n.label, level: lv } }); t.ret(); return lv; }
      t.mark('tree', n.id, 'visited');
      t.step(`${n.label} is not ${value}: look in its children (level ${lv + 1})`, { line: lAt('Tree<T> child = tree.hasLeftMostChild()'), vars: { root: n.label, level: lv }, marks: { tree: { [n.id]: 'current' } } });
      for (const c of n.children) { const f = go(c, lv + 1); if (f !== -1) { t.ret(); return f; } }
      t.mark('tree', n.id, 'done');
      t.step(`Not below ${n.label}: −1`, { line: lAt('return -1;                                                // not below'), vars: { root: n.label, level: lv } });
      t.ret();
      return -1;
    };
    const v = root ? go(root, 0) : -1;
    t.step(v >= 0 ? `${value} is at level ${v}` : `${value} is not in the tree: −1`, { line: null, vars: {} });
    return v;
  },
};

const t23Source = `public static <T> boolean is23Tree(Tree<T> tree) {
  return tree.isEmpty() || leavesLevel(tree, 0) >= 0;
}

// The level of its leaves when every node has 2 or 3 children and every leaf is at the same
// level; -1 when not.
private static <T> int leavesLevel(Tree<T> tree, int level) {
  if (!tree.hasLeftMostChild()) return level;                  // a leaf
  int children = 0, leaves = -2;
  Tree<T> child = tree.getLeftMostChild();
  while (child != null) {
    children++;
    int below = leavesLevel(child, level + 1);
    if (below == -1 || (leaves != -2 && below != leaves)) return -1;
    leaves = below;
    child = child.hasRightSibling() ? child.getRightSibling() : null;
  }
  return children == 2 || children == 3 ? leaves : -1;
}`;
const zAt = lineFinder(t23Source);
export const is23 = {
  id: 'is-23-tree', topic: 'trees', name: '2-3 tree? (general tree)',
  hint: 'Every inner node has 2 or 3 children and every leaf is at the same level',
  fields: [field],
  presets: [{ label: 'Tree A (yes)', input: { tree: 'A(A(A, B, C), D(D, E))' } }, { label: 'Tree B (no)', input: { tree: 'A(B(E), C(F, G), D, H)' } }],
  random(seed) { return { tree: randomGeneral(rng(seed)) }; },
  normalize(raw = {}) { return { tree: read(raw.tree, 'A(A(A, B, C), D(D, E))') }; },
  source: t23Source,
  run({ tree }, t) {
    const root = parseGeneral(tree);
    t.tree('tree', root, { label: 'tree', binary: false });
    const go = (n, lv) => {
      t.call('leavesLevel', `${n.label}, ${lv}`);
      if (!n.children.length) { t.mark('tree', n.id, 'done'); t.step(`${n.label} is a leaf at level ${lv}`, { line: zAt('if (!tree.hasLeftMostChild()) return level'), vars: { root: n.label, level: lv } }); t.ret(); return lv; }
      let leaves = -2, count = 0;
      for (const c of n.children) {
        count++;
        const below = go(c, lv + 1);
        if (below === -1 || (leaves !== -2 && below !== leaves)) { t.mark('tree', n.id, 'error'); t.step(below === -1 ? `Below ${c.label} it fails` : `Leaves at level ${below} and ${leaves}: not the same`, { line: zAt('if (below == -1 || (leaves != -2'), vars: { root: n.label, below, leaves } }); t.ret(); return -1; }
        leaves = below;
      }
      const ok = count === 2 || count === 3;
      t.mark('tree', n.id, ok ? 'done' : 'error');
      t.step(ok ? `${n.label} has ${count} children: fine` : `${n.label} has ${count} child${count === 1 ? '' : 'ren'}: not 2 or 3`, { line: zAt('return children == 2 || children == 3'), vars: { root: n.label, children: count, leaves } });
      t.ret();
      return ok ? leaves : -1;
    };
    const ok = !root || go(root, 0) >= 0;
    t.step(ok ? 'A 2-3 tree: true' : 'Not a 2-3 tree: false', { line: null, vars: {} });
    return ok;
  },
};

const selSource = `public static <T extends Comparable<T>> boolean isSelection(Tree<T> tree) {
  if (tree.isEmpty() || !tree.hasLeftMostChild()) return true;   // a leaf
  T min = null;
  Tree<T> child = tree.getLeftMostChild();
  while (child != null) {
    if (!isSelection(child)) return false;
    T value = child.getRootValue();
    if (min == null || value.compareTo(min) < 0) min = value;
    child = child.hasRightSibling() ? child.getRightSibling() : null;
  }
  return tree.getRootValue().equals(min);          // the root: its smallest child
}`;
const xAt = lineFinder(selSource);
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
export const isSelectionGeneral = {
  id: 'is-selection-general', topic: 'trees', name: 'Selection general tree?',
  hint: 'Every parent holds the smallest of its children',
  fields: [field],
  presets: [{ label: 'Tree A (yes)', input: { tree: 'A(A(A, B, C), D(D, E))' } }, { label: 'Tree B (no)', input: { tree: 'A(B(E), C(F, G), D, H)' } }],
  random(seed) { return { tree: randomGeneral(rng(seed)) }; },
  normalize(raw = {}) { return { tree: read(raw.tree, 'A(A(A, B, C), D(D, E))') }; },
  source: selSource,
  run({ tree }, t) {
    const root = parseGeneral(tree);
    t.tree('tree', root, { label: 'tree', binary: false });
    const go = (n) => {
      t.call('isSelection', n.label);
      if (!n.children.length) { t.mark('tree', n.id, 'done'); t.step(`${n.label} is a leaf`, { line: xAt('return true;   // a leaf'), vars: { root: n.label } }); t.ret(); return true; }
      let min = null, at = null;
      for (const c of n.children) {
        if (!go(c)) { t.mark('tree', n.id, 'error'); t.ret(); return false; }
        if (min === null || cmp(c.label, min) < 0) { min = c.label; at = c; }
        t.step(`${n.label}: smallest child so far ${min}`, { line: xAt('if (min == null || value.compareTo(min) < 0)'), vars: { root: n.label, min }, marks: { tree: { [n.id]: 'current', [at.id]: 'compare' } } });
      }
      const ok = String(n.label) === String(min);
      t.mark('tree', n.id, ok ? 'done' : 'error');
      t.step(`${n.label} ${ok ? '=' : '≠'} ${min}, its smallest child`, { line: xAt('return tree.getRootValue().equals(min)'), vars: { root: n.label, min } });
      t.ret();
      return ok;
    };
    const ok = !root || go(root);
    t.step(ok ? 'A selection tree: true' : 'Not a selection tree: false', { line: null, vars: {} });
    return ok;
  },
};
