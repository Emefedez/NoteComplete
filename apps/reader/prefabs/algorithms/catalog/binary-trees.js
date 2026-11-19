// Binary trees (activities 2 and 3), through the course's BinaryTree interface (isEmpty,
// getRootValue, hasLeftChild/getLeftChild, hasRightChild/getRightChild): traversals, height,
// nodes in a level, complete (every node with 0 or 2 children), rebuild from preorder and
// inorder, remove the leaves, selection tree, a path from the root; binary search trees and AVL
// trees (extras). Trees are written "A(B, C(D, E))", a missing child "-".
import { lineFinder, ints, clampInt, rng } from './common.js';
import { parseBinary, binaryText, cloneTree } from './trees-common.js';

const TREE_HINT = 'A(B, C(D, E)); a missing child is "-": A(-, C)';
const treeField = { key: 'tree', type: 'line', label: 'Tree', hint: TREE_HINT };
const readTree = (raw, fallback) => { const text = typeof raw === 'string' ? raw : fallback; return { text, root: parseBinary(text) }; };
const kids = (n) => [n.left, n.right].filter(Boolean);
const randomTree = (r, n = r.int(5, 9), letters = true) => {
  let root = null;
  const vals = letters ? 'ABCDEFGHIJKLMNOP'.split('') : Array.from({ length: 30 }, (_, i) => i + 1);
  for (let k = 0; k < n; k++) {
    const node = { label: vals[k], left: null, right: null };
    if (!root) { root = node; continue; }
    let at = root;
    for (;;) { const side = r.next() < 0.5 ? 'left' : 'right'; if (!at[side]) { at[side] = node; break; } at = at[side]; }
  }
  return binaryText(root);
};

const travSource = `public static <T> void preorder(BinaryTree<T> tree, List<T> out) {
  if (tree.isEmpty()) return;
  out.add(tree.getRootValue());                           // the root first
  if (tree.hasLeftChild()) preorder(tree.getLeftChild(), out);
  if (tree.hasRightChild()) preorder(tree.getRightChild(), out);
}

public static <T> void inorder(BinaryTree<T> tree, List<T> out) {
  if (tree.isEmpty()) return;
  if (tree.hasLeftChild()) inorder(tree.getLeftChild(), out);
  out.add(tree.getRootValue());                           // the root between
  if (tree.hasRightChild()) inorder(tree.getRightChild(), out);
}

public static <T> void postorder(BinaryTree<T> tree, List<T> out) {
  if (tree.isEmpty()) return;
  if (tree.hasLeftChild()) postorder(tree.getLeftChild(), out);
  if (tree.hasRightChild()) postorder(tree.getRightChild(), out);
  out.add(tree.getRootValue());                           // the root last
}

public static <T> void byLevels(BinaryTree<T> tree, List<T> out) {
  if (tree.isEmpty()) return;
  Queue<BinaryTree<T>> queue = new LinkedQueue<>();
  queue.add(tree);
  while (!queue.isEmpty()) {
    BinaryTree<T> current = queue.remove();
    out.add(current.getRootValue());
    if (current.hasLeftChild()) queue.add(current.getLeftChild());
    if (current.hasRightChild()) queue.add(current.getRightChild());
  }
}`;
const tAt = lineFinder(travSource);
const ORDERS = [['pre', 'Preorder (root, left, right)'], ['in', 'Inorder (left, root, right)'], ['post', 'Postorder (left, right, root)'], ['level', 'By levels (a queue)']];
export const traversals = {
  id: 'traversals', topic: 'trees', name: 'Traversals',
  hint: 'Preorder, inorder, postorder (recursion) and by levels (a queue)',
  fields: [treeField, { key: 'order', type: 'choice', label: 'Order', options: ORDERS }],
  presets: [
    { label: 'Preorder', input: { tree: 'F(B(A, D(C, E)), G(-, I(H, -)))', order: 'pre' } },
    { label: 'Inorder', input: { tree: 'F(B(A, D(C, E)), G(-, I(H, -)))', order: 'in' } },
    { label: 'Postorder', input: { tree: 'F(B(A, D(C, E)), G(-, I(H, -)))', order: 'post' } },
    { label: 'By levels', input: { tree: 'F(B(A, D(C, E)), G(-, I(H, -)))', order: 'level' } },
  ],
  random(seed) { const r = rng(seed); return { tree: randomTree(r), order: r.pick(ORDERS)[0] }; },
  normalize(raw = {}) { const { text } = readTree(raw.tree, 'F(B(A, D(C, E)), G(-, I(H, -)))'); return { tree: text, order: ORDERS.some(([o]) => o === raw.order) ? raw.order : 'pre' }; },
  source: travSource,
  run({ tree, order }, t) {
    const root = parseBinary(tree);
    t.tree('tree', root, { label: 'tree' });
    const out = t.array('out', [], { label: 'out' });
    const fn = { pre: 'preorder', in: 'inorder', post: 'postorder', level: 'byLevels' }[order];
    const visit = (n) => { out.push(n.label); t.mark('tree', n.id, 'done'); t.step(`Visit ${n.label}: out gets ${n.label}`, { line: tAt('out.add(tree.getRootValue());', { pre: 1, in: 2, post: 3 }[order]), vars: { root: n.label }, marks: { tree: { [n.id]: 'current' } } }); };
    if (!root) { t.step('An empty tree: nothing to visit', { line: tAt('if (tree.isEmpty()) return;') }); return []; }
    if (order === 'level') {
      const q = t.queue('queue', [], { label: 'queue' });
      const byId = new Map();
      const index = (n) => { if (!n) return; byId.set(n.id, n); index(n.left); index(n.right); };
      index(root);
      q.add(root.label); const ids = [root.id];
      t.mark('tree', root.id, 'queued');
      t.step(`Put the whole tree (root ${root.label}) in the queue`, { line: tAt('queue.add(tree);') });
      while (ids.length) {
        q.remove(); const n = byId.get(ids.shift());
        out.push(n.label); t.mark('tree', n.id, 'done');
        t.step(`Take ${n.label} from the queue and visit it`, { line: tAt('out.add(current.getRootValue())'), vars: { current: n.label }, marks: { tree: { [n.id]: 'current' } } });
        for (const [k, side] of [[n.left, 'left'], [n.right, 'right']]) {
          if (!k) continue;
          q.add(k.label); ids.push(k.id); t.mark('tree', k.id, 'queued');
          t.step(`Its ${side} child ${k.label} waits in the queue`, { line: tAt(side === 'left' ? 'if (current.hasLeftChild()) queue.add' : 'if (current.hasRightChild()) queue.add'), vars: { current: n.label }, marks: { tree: { [n.id]: 'current' } } });
        }
      }
    } else {
      const go = (n) => {
        t.call(fn, n.label);
        const path = (m) => t.step(m, { line: null, vars: { root: n.label }, marks: { tree: { [n.id]: 'visited' } } });
        if (order === 'pre') visit(n);
        if (n.left) { t.step(`Go to the left child of ${n.label}`, { line: tAt(`if (tree.hasLeftChild()) ${fn}(`), vars: { root: n.label }, marks: { tree: { [n.id]: 'visited', [n.left.id]: 'compare' } } }); go(n.left); }
        if (order === 'in') visit(n);
        if (n.right) { t.step(`Go to the right child of ${n.label}`, { line: tAt(`if (tree.hasRightChild()) ${fn}(`), vars: { root: n.label }, marks: { tree: { [n.id]: 'visited', [n.right.id]: 'compare' } } }); go(n.right); }
        if (order === 'post') visit(n);
        void path;
        t.ret();
      };
      go(root);
    }
    t.step(`${ORDERS.find(([o]) => o === order)[1].split(' (')[0]}: ${out.toArray().join(', ')}`, { line: null, vars: {} });
    return out.toArray();
  },
};

const heightSource = `public static <T> int calculateHeight(BinaryTree<T> tree) {
  if (tree.isEmpty()) return -1;                     // the root alone has height 0
  int left = tree.hasLeftChild() ? calculateHeight(tree.getLeftChild()) : -1;
  int right = tree.hasRightChild() ? calculateHeight(tree.getRightChild()) : -1;
  return 1 + Math.max(left, right);
}`;
const hAt = lineFinder(heightSource);
// Shared by height, complete, selection: a recursion over the nodes, stepping at each return.
export const height = {
  id: 'tree-height', topic: 'trees', name: 'Height of a binary tree',
  hint: 'One more than the taller subtree; an empty tree has height −1',
  fields: [treeField],
  presets: [{ label: 'Tree A of the activity', input: { tree: 'A(B, C(D, E))' } }, { label: 'Deeper', input: { tree: 'F(B(A, D(C, E)), G(-, I(H, -)))' } }],
  random(seed) { return { tree: randomTree(rng(seed)) }; },
  normalize(raw = {}) { return { tree: readTree(raw.tree, 'A(B, C(D, E))').text }; },
  source: heightSource,
  run({ tree }, t) {
    const root = parseBinary(tree);
    t.tree('tree', root, { label: 'tree' });
    const result = t.value('height', null, { label: 'returned' });
    if (!root) { result.set(-1); t.step('An empty tree: height −1', { line: hAt('if (tree.isEmpty()) return -1') }); return -1; }
    const go = (n) => {
      t.call('calculateHeight', n.label);
      t.step(`calculateHeight(${n.label})`, { line: hAt('int left ='), vars: { root: n.label }, marks: { tree: { [n.id]: 'current' } } });
      const l = n.left ? go(n.left) : -1;
      const r = n.right ? go(n.right) : -1;
      const h = 1 + Math.max(l, r);
      result.set(h); t.mark('tree', n.id, 'done');
      t.step(`Height of ${n.label}: 1 + max(${l}, ${r}) = ${h}`, { line: hAt('return 1 + Math.max(left, right)'), vars: { root: n.label, left: l, right: r }, marks: { tree: { [n.id]: 'current' } } });
      t.ret();
      return h;
    };
    const h = go(root);
    t.step(`The tree has height ${h}`, { line: null, vars: {} });
    return h;
  },
};

const levelSource = `public static <T> int countNodesInLevel(BinaryTree<T> tree, int level) {
  if (tree.isEmpty()) return 0;
  if (level == 0) return 1;                          // this root is in the level
  int count = 0;
  if (tree.hasLeftChild()) count += countNodesInLevel(tree.getLeftChild(), level - 1);
  if (tree.hasRightChild()) count += countNodesInLevel(tree.getRightChild(), level - 1);
  return count;
}`;
const lAt = lineFinder(levelSource);
export const nodesInLevel = {
  id: 'nodes-in-level', topic: 'trees', name: 'Nodes in a level',
  hint: 'Go down one level at each call; at level 0 a root counts 1',
  fields: [treeField, { key: 'level', type: 'int', label: 'Level', min: 0, max: 10 }],
  presets: [{ label: 'Tree A, level 2', input: { tree: 'A(B, C(D, E))', level: 2 } }, { label: 'Level 2 of a deeper one', input: { tree: 'F(B(A, D(C, E)), G(-, I(H, -)))', level: 2 } }],
  random(seed) { const r = rng(seed); return { tree: randomTree(r), level: r.int(1, 3) }; },
  normalize(raw = {}) { return { tree: readTree(raw.tree, 'A(B, C(D, E))').text, level: clampInt(raw.level, 0, 10, 2) }; },
  source: levelSource,
  run({ tree, level }, t) {
    const root = parseBinary(tree);
    t.tree('tree', root, { label: 'tree' });
    const total = t.value('count', 0, { label: 'counted' });
    const go = (n, k) => {
      t.call('countNodesInLevel', `${n.label}, ${k}`);
      if (k === 0) { total.set(total.get() + 1); t.mark('tree', n.id, 'path'); t.step(`${n.label} is in level ${level}: 1`, { line: lAt('if (level == 0) return 1'), vars: { root: n.label, level: k } }); t.ret(); return 1; }
      t.mark('tree', n.id, 'visited');
      t.step(`${n.label}: level ${k} below it`, { line: lAt('int count = 0'), vars: { root: n.label, level: k }, marks: { tree: { [n.id]: 'current' } } });
      let c = 0;
      if (n.left) c += go(n.left, k - 1);
      if (n.right) c += go(n.right, k - 1);
      t.step(`${n.label} returns ${c}`, { line: lAt('return count'), vars: { root: n.label, level: k, count: c }, marks: { tree: { [n.id]: 'current' } } });
      t.ret();
      return c;
    };
    const c = root ? go(root, level) : 0;
    t.step(`Level ${level} has ${c} node${c === 1 ? '' : 's'}`, { line: null, vars: {} });
    return c;
  },
};

const completeSource = `public static <T> boolean isComplete(BinaryTree<T> tree) {
  if (tree.isEmpty()) return true;
  if (!tree.hasLeftChild() && !tree.hasRightChild()) return true;   // a leaf
  if (tree.hasLeftChild() != tree.hasRightChild()) return false;    // only one child
  return isComplete(tree.getLeftChild()) && isComplete(tree.getRightChild());
}`;
const cAt = lineFinder(completeSource);
export const isComplete = {
  id: 'is-complete', topic: 'trees', name: 'Complete tree?',
  hint: 'Every node has no children or both (the course’s complete tree)',
  fields: [treeField],
  presets: [{ label: 'Complete', input: { tree: 'A(B, C(D, E))' } }, { label: 'Not complete', input: { tree: 'A(B, C(D, -))' } }],
  random(seed) { return { tree: randomTree(rng(seed)) }; },
  normalize(raw = {}) { return { tree: readTree(raw.tree, 'A(B, C(D, E))').text }; },
  source: completeSource,
  run({ tree }, t) {
    const root = parseBinary(tree);
    t.tree('tree', root, { label: 'tree' });
    const go = (n) => {
      t.call('isComplete', n.label);
      let ok;
      if (!n.left && !n.right) { ok = true; t.mark('tree', n.id, 'done'); t.step(`${n.label} is a leaf: complete`, { line: cAt('return true;   // a leaf'), vars: { root: n.label } }); }
      else if (!n.left !== !n.right) { ok = false; t.mark('tree', n.id, 'error'); t.step(`${n.label} has only one child: not complete`, { line: cAt('return false;    // only one child'), vars: { root: n.label } }); }
      else {
        t.step(`${n.label} has both children: both must be complete`, { line: cAt('return isComplete(tree.getLeftChild())'), vars: { root: n.label }, marks: { tree: { [n.id]: 'current' } } });
        ok = go(n.left) && go(n.right);
        t.mark('tree', n.id, ok ? 'done' : 'error');
        t.step(`${n.label}: ${ok}`, { line: cAt('return isComplete(tree.getLeftChild())'), vars: { root: n.label } });
      }
      t.ret();
      return ok;
    };
    const ok = root ? go(root) : true;
    t.step(ok ? 'The tree is complete: true' : 'The tree is not complete: false', { line: null, vars: {} });
    return ok;
  },
};

const selSource = `public static <T extends Comparable<T>> boolean isSelectionTree(BinaryTree<T> tree) {
  if (tree.isEmpty()) return true;
  if (!tree.hasLeftChild() && !tree.hasRightChild()) return true;   // a leaf
  if (!tree.hasLeftChild() || !tree.hasRightChild()) return false;
  T left = tree.getLeftChild().getRootValue();
  T right = tree.getRightChild().getRootValue();
  T smaller = left.compareTo(right) <= 0 ? left : right;
  return tree.getRootValue().equals(smaller)            // the root: the smaller child
      && isSelectionTree(tree.getLeftChild())
      && isSelectionTree(tree.getRightChild());
}`;
const sAt = lineFinder(selSource);
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
export const isSelectionBinary = {
  id: 'is-selection-binary', topic: 'trees', name: 'Selection tree?',
  hint: 'Every parent holds the smaller of its two children (a tournament)',
  fields: [treeField],
  presets: [{ label: 'A selection tree', input: { tree: 'A(B, A(A, D))' } }, { label: 'Not one', input: { tree: 'A(B, C)' } }, { label: 'Numbers', input: { tree: '2(2(5, 2), 3(3, 8))' } }],
  random(seed) { return { tree: randomTree(rng(seed)) }; },
  normalize(raw = {}) { return { tree: readTree(raw.tree, 'A(B, A(A, D))').text }; },
  source: selSource,
  run({ tree }, t) {
    const root = parseBinary(tree);
    t.tree('tree', root, { label: 'tree' });
    const go = (n) => {
      t.call('isSelectionTree', n.label);
      let ok;
      if (!n.left && !n.right) { ok = true; t.mark('tree', n.id, 'done'); t.step(`${n.label} is a leaf`, { line: sAt('return true;   // a leaf'), vars: { root: n.label } }); }
      else if (!n.left || !n.right) { ok = false; t.mark('tree', n.id, 'error'); t.step(`${n.label} has one child only: false`, { line: sAt('if (!tree.hasLeftChild() || !tree.hasRightChild()) return false'), vars: { root: n.label } }); }
      else {
        const smaller = cmp(n.left.label, n.right.label) <= 0 ? n.left : n.right;
        const here = String(n.label) === String(smaller.label);
        t.step(`Children ${n.left.label} and ${n.right.label}: the smaller is ${smaller.label}; ${n.label} ${here ? '=' : '≠'} ${smaller.label}`, { line: sAt('return tree.getRootValue().equals(smaller)'), vars: { root: n.label, left: n.left.label, right: n.right.label, smaller: smaller.label }, marks: { tree: { [n.id]: here ? 'current' : 'error', [smaller.id]: 'compare' } } });
        ok = here && go(n.left) && go(n.right);
        t.mark('tree', n.id, ok ? 'done' : 'error');
      }
      t.ret();
      return ok;
    };
    const ok = root ? go(root) : true;
    t.step(ok ? 'A selection tree: true' : 'Not a selection tree: false', { line: null, vars: {} });
    return ok;
  },
};

const pathSource = `public static <T> boolean isPath(BinaryTree<T> tree, String path) {
  if (path.isEmpty()) return true;                       // all of it walked
  if (tree.isEmpty()) return false;
  if (!tree.getRootValue().toString().equals(path.substring(0, 1))) return false;
  String rest = path.substring(1);
  if (rest.isEmpty()) return true;
  return (tree.hasLeftChild() && isPath(tree.getLeftChild(), rest))
      || (tree.hasRightChild() && isPath(tree.getRightChild(), rest));
}`;
const pAt = lineFinder(pathSource);
export const isPath = {
  id: 'is-path', topic: 'trees', name: 'Path from the root?',
  hint: 'Whether the letters of a text spell a way down from the root',
  fields: [treeField, { key: 'path', type: 'line', label: 'Path', placeholder: 'ACD' }],
  presets: [{ label: 'ACD: yes', input: { tree: 'A(B, C(D, E))', path: 'ACD' } }, { label: 'ACEF: no', input: { tree: 'A(B, C(D, E))', path: 'ACEF' } }, { label: 'CE: no', input: { tree: 'A(B, C(D, E))', path: 'CE' } }],
  random(seed) { const r = rng(seed); return { tree: randomTree(r), path: 'A' + r.pick(['B', 'C', 'D']) }; },
  normalize(raw = {}) { return { tree: readTree(raw.tree, 'A(B, C(D, E))').text, path: typeof raw.path === 'string' ? raw.path.replace(/\s+/g, '').slice(0, 16) : 'ACD' }; },
  source: pathSource,
  run({ tree, path }, t) {
    const root = parseBinary(tree);
    t.tree('tree', root, { label: 'tree' });
    const rest = t.text('rest', path, { label: 'path left' });
    const go = (n, p) => {
      t.call('isPath', `${n ? n.label : '∅'}, "${p}"`);
      rest.set(p);
      let ok;
      if (!p) { ok = true; t.step('Nothing left of the path: true', { line: pAt('if (path.isEmpty()) return true') }); }
      else if (!n) { ok = false; t.step('No tree here: false', { line: pAt('if (tree.isEmpty()) return false') }); }
      else if (String(n.label) !== p[0]) { ok = false; t.step(`${n.label} is not ${p[0]}: false`, { line: pAt('if (!tree.getRootValue().toString().equals'), vars: { root: n.label, path: p }, marks: { tree: { [n.id]: 'error' } } }); }
      else {
        t.mark('tree', n.id, 'path');
        if (p.length === 1) { ok = true; t.step(`${n.label} matches the last letter: true`, { line: pAt('if (rest.isEmpty()) return true'), vars: { root: n.label, path: p } }); }
        else {
          t.step(`${n.label} matches; look for "${p.slice(1)}" below it`, { line: pAt('return (tree.hasLeftChild() && isPath'), vars: { root: n.label, path: p, rest: p.slice(1) }, marks: { tree: { [n.id]: 'current' } } });
          ok = (!!n.left && go(n.left, p.slice(1))) || (!!n.right && go(n.right, p.slice(1)));
          if (!ok) { t.mark('tree', n.id, null); t.step(`No way down from ${n.label}: false`, { line: pAt('|| (tree.hasRightChild() && isPath'), vars: { root: n.label, path: p } }); }
        }
      }
      t.ret();
      return ok;
    };
    const ok = !path ? true : root ? go(root, path) : false;
    t.step(ok ? `"${path}" is a path from the root: true` : `"${path}" is not a path: false`, { line: null, vars: {} });
    return ok;
  },
};

const rebuildSource = `public static BinaryTree<String> rebuild(String preorder, String inorder) {
  if (preorder.isEmpty()) return new LinkedBinaryTree<>();
  String root = preorder.substring(0, 1);                  // preorder: the root first
  int at = inorder.indexOf(root);                          // inorder: left | root | right
  BinaryTree<String> left = rebuild(preorder.substring(1, at + 1), inorder.substring(0, at));
  BinaryTree<String> right = rebuild(preorder.substring(at + 1), inorder.substring(at + 1));
  return new LinkedBinaryTree<>(root, left, right);
}`;
const rAt = lineFinder(rebuildSource);
export const rebuild = {
  id: 'rebuild', topic: 'trees', name: 'Rebuild from preorder and inorder',
  hint: 'The first of the preorder is the root; it splits the inorder into the left and right subtrees',
  fields: [{ key: 'preorder', type: 'line', label: 'Preorder' }, { key: 'inorder', type: 'line', label: 'Inorder' }],
  presets: [{ label: 'Tree A (ABCDE, BADCE)', input: { preorder: 'ABCDE', inorder: 'BADCE' } }, { label: 'Tree B (ABCD, BADC)', input: { preorder: 'ABCD', inorder: 'BADC' } }, { label: 'Nine letters', input: { preorder: 'FBADCEGIH', inorder: 'ABCDEFGHI' } }],
  random(seed) {
    const r = rng(seed), root = parseBinary(randomTree(r));
    const pre = [], ino = [];
    const p = (n) => { if (!n) return; pre.push(n.label); p(n.left); p(n.right); };
    const i = (n) => { if (!n) return; i(n.left); ino.push(n.label); i(n.right); };
    p(root); i(root);
    return { preorder: pre.join(''), inorder: ino.join('') };
  },
  normalize(raw = {}) {
    const preorder = typeof raw.preorder === 'string' ? raw.preorder.replace(/\s+/g, '') : 'ABCDE', inorder = typeof raw.inorder === 'string' ? raw.inorder.replace(/\s+/g, '') : 'BADCE';
    if ([...preorder].sort().join('') !== [...inorder].sort().join('')) throw Error('The preorder and the inorder must have the same letters');
    if (new Set(preorder).size !== preorder.length) throw Error('Each letter once');
    if (preorder.length > 20) throw Error('At most 20 letters');
    return { preorder, inorder };
  },
  source: rebuildSource,
  run({ preorder, inorder }, t) {
    let root = null, serial = 0;
    const tr = t.tree('tree', null, { label: 'the tree rebuilt so far' });
    const pre = t.text('pre', preorder, { label: 'preorder (this call)' });
    const ino = t.text('in', inorder, { label: 'inorder (this call)' });
    // The tree built so far: each call fills its node in place.
    const go = (p, i, place) => {
      t.call('rebuild', `"${p}", "${i}"`);
      pre.set(p || '""'); ino.set(i || '""');
      if (!p) { t.step('Empty: an empty tree', { line: rAt('if (preorder.isEmpty())'), vars: { preorder: p, inorder: i } }); t.ret(); return null; }
      const r = p[0], at = i.indexOf(r);
      const node = { id: `r${serial++}`, label: r, left: null, right: null };
      place(node);
      tr.set(cloneTree(root));
      t.step(`The root is ${r} (first of "${p}"); in "${i}" it leaves "${i.slice(0, at)}" on the left and "${i.slice(at + 1)}" on the right`, { line: rAt('int at = inorder.indexOf(root)'), vars: { preorder: p, inorder: i, root: r, at }, marks: { tree: { [node.id]: 'current' } } });
      go(p.slice(1, at + 1), i.slice(0, at), (k) => { node.left = k; });
      go(p.slice(at + 1), i.slice(at + 1), (k) => { node.right = k; });
      t.mark('tree', node.id, 'done');
      t.step(`Subtree of ${r} done`, { line: rAt('return new LinkedBinaryTree<>(root, left, right)'), vars: { root: r } });
      t.ret();
      return node;
    };
    go(preorder, inorder, (k) => { root = k; });
    tr.set(cloneTree(root));
    t.step(`Rebuilt: ${binaryText(root)}`, { line: null, vars: {} });
    return binaryText(root);
  },
};

const leavesSource = `public static <T> BinaryTree<T> removeLeaves(BinaryTree<T> tree) {
  if (tree.isEmpty()) return new LinkedBinaryTree<>();
  if (!tree.hasLeftChild() && !tree.hasRightChild()) return new LinkedBinaryTree<>();  // a leaf goes
  BinaryTree<T> left = tree.hasLeftChild() ? removeLeaves(tree.getLeftChild()) : new LinkedBinaryTree<>();
  BinaryTree<T> right = tree.hasRightChild() ? removeLeaves(tree.getRightChild()) : new LinkedBinaryTree<>();
  return new LinkedBinaryTree<>(tree.getRootValue(), left, right);
}`;
const vAt = lineFinder(leavesSource);
export const removeLeaves = {
  id: 'remove-leaves', topic: 'trees', name: 'Remove the leaves',
  hint: 'A new tree with the same nodes but the leaves (built bottom up)',
  fields: [treeField],
  presets: [{ label: 'Tree A', input: { tree: 'A(B, C(D, E))' } }, { label: 'Deeper', input: { tree: 'F(B(A, D(C, E)), G(-, I(H, -)))' } }],
  random(seed) { return { tree: randomTree(rng(seed)) }; },
  normalize(raw = {}) { return { tree: readTree(raw.tree, 'A(B, C(D, E))').text }; },
  source: leavesSource,
  run({ tree }, t) {
    const root = parseBinary(tree);
    t.tree('tree', root, { label: 'tree' });
    const res = t.tree('result', null, { label: 'the new tree' });
    const go = (n) => {
      t.call('removeLeaves', n.label);
      if (!n.left && !n.right) { t.mark('tree', n.id, 'removed'); t.step(`${n.label} is a leaf: it is not copied`, { line: vAt('return new LinkedBinaryTree<>();  // a leaf goes'), vars: { root: n.label } }); t.ret(); return null; }
      t.step(`${n.label} stays; first its subtrees without leaves`, { line: vAt('BinaryTree<T> left ='), vars: { root: n.label }, marks: { tree: { [n.id]: 'current' } } });
      const out = { id: n.id, label: n.label, left: n.left ? go(n.left) : null, right: n.right ? go(n.right) : null };
      t.mark('tree', n.id, 'done');
      res.set(cloneTree(out));
      t.step(`New node ${n.label} with them`, { line: vAt('return new LinkedBinaryTree<>(tree.getRootValue(), left, right)'), vars: { root: n.label }, marks: { result: { [n.id]: 'new' } } });
      t.ret();
      return out;
    };
    const out = root ? go(root) : null;
    res.set(cloneTree(out));
    t.step(`Without leaves: ${out ? binaryText(out) : 'empty'}`, { line: null, vars: {} });
    return out ? binaryText(out) : '';
  },
};

// ── Binary search trees and AVL trees ──
export function parseTreeOps(text) {
  const ops = [], problems = [];
  for (const raw of String(text || '').split(/[\n;,]+/)) {
    const p = raw.trim().split(/\s+/).filter(Boolean);
    if (!p.length) continue;
    const op = p[0].toLowerCase(), v = Number(p[1]);
    if (['insert', 'add', 'search', 'remove', 'delete'].includes(op) && p.length === 2 && Number.isInteger(v)) ops.push({ op: op === 'add' ? 'insert' : op === 'delete' ? 'remove' : op, value: v });
    else if (p.length === 1 && Number.isInteger(Number(p[0]))) ops.push({ op: 'insert', value: Number(p[0]) });
    else problems.push(raw.trim());
  }
  return { ops: ops.slice(0, 40), problems };
}
const bstSource = `public void insert(T value) {
  root = insert(root, value);
}

private Node<T> insert(Node<T> node, T value) {
  if (node == null) return new Node<>(value);            // a new leaf here
  int c = value.compareTo(node.value);
  if (c < 0) node.left = insert(node.left, value);
  else if (c > 0) node.right = insert(node.right, value);
  return node;                                           // equal: already there
}

public boolean search(T value) {
  Node<T> node = root;
  while (node != null) {
    int c = value.compareTo(node.value);
    if (c == 0) return true;
    node = c < 0 ? node.left : node.right;
  }
  return false;
}

private Node<T> remove(Node<T> node, T value) {
  if (node == null) return null;
  int c = value.compareTo(node.value);
  if (c < 0) node.left = remove(node.left, value);
  else if (c > 0) node.right = remove(node.right, value);
  else if (node.left == null) return node.right;         // no left child: the right replaces it
  else if (node.right == null) return node.left;
  else {
    Node<T> min = node.right;                            // two children: the next value
    while (min.left != null) min = min.left;
    node.value = min.value;
    node.right = remove(node.right, min.value);
  }
  return node;
}`;
const bAt = lineFinder(bstSource);
export const bst = {
  id: 'bst', topic: 'trees', name: 'Binary search tree',
  hint: 'Insert, search and remove: smaller to the left, larger to the right',
  fields: [{ key: 'ops', type: 'text', label: 'Operations', hint: 'insert 5 · search 5 · remove 5 (a number alone inserts it)' }],
  presets: [
    { label: 'Insert, search, remove', input: { ops: '50 30 70 20 40 60 80\nsearch 60\nsearch 65\nremove 20\nremove 30\nremove 50' } },
    { label: 'Sorted input (a list)', input: { ops: '1 2 3 4 5' } },
  ],
  random(seed) { const r = rng(seed); const vals = [...new Set(Array.from({ length: 8 }, () => r.int(1, 99)))]; return { ops: `${vals.join(' ')}\nsearch ${r.pick(vals)}\nremove ${r.pick(vals)}` }; },
  normalize(raw = {}) {
    const ops = typeof raw.ops === 'string' ? raw.ops.replace(/(\d)\s+(?=\d)/g, '$1\n') : '50\n30\n70';
    const { problems } = parseTreeOps(ops);
    if (problems.length) throw Error(`Not an operation: "${problems[0]}"`);
    return { ops: typeof raw.ops === 'string' ? raw.ops : '50 30 70' };
  },
  source: bstSource,
  run(input, t) {
    const { ops } = parseTreeOps(String(input.ops).replace(/(\d)\s+(?=\d)/g, '$1\n'));
    let root = null, serial = 0;
    const tr = t.tree('tree', null, { label: 'tree' });
    const sync = () => tr.set(cloneTree(root));
    const results = [];
    t.step('An empty binary search tree', { line: null });
    for (const { op, value } of ops) {
      if (op === 'insert') {
        t.call('insert', value);
        const ins = (n) => {
          if (!n) { const k = { id: `b${serial++}`, label: value, left: null, right: null }; return [k, k]; }
          const c = value - n.label;
          t.step(c === 0 ? `${value} is already there` : `${value} ${c < 0 ? '<' : '>'} ${n.label}: go ${c < 0 ? 'left' : 'right'}`, { line: c === 0 ? bAt('return node;                                           // equal') : bAt(c < 0 ? 'if (c < 0) node.left = insert' : 'else if (c > 0) node.right = insert'), vars: { value, node: n.label }, marks: { tree: { [n.id]: 'compare' } } });
          if (c < 0) { const [k, made] = ins(n.left); n.left = k; return [n, made]; }
          if (c > 0) { const [k, made] = ins(n.right); n.right = k; return [n, made]; }
          return [n, null];
        };
        const [r, made] = ins(root);
        root = r; sync();
        if (made) t.step(`${value} goes in as a new leaf`, { line: bAt('if (node == null) return new Node<>(value)'), vars: { value }, marks: { tree: { [made.id]: 'new' } } });
        t.ret();
      } else if (op === 'search') {
        t.call('search', value);
        let n = root, found = false;
        while (n) {
          const c = value - n.label;
          t.step(c === 0 ? `Found ${value}` : `${value} ${c < 0 ? '<' : '>'} ${n.label}: go ${c < 0 ? 'left' : 'right'}`, { line: c === 0 ? bAt('if (c == 0) return true') : bAt('node = c < 0 ? node.left : node.right'), vars: { value, node: n.label }, marks: { tree: { [n.id]: c === 0 ? 'path' : 'compare' } } });
          if (c === 0) { found = true; break; }
          n = c < 0 ? n.left : n.right;
        }
        if (!found) t.step(`Fell off the tree: ${value} is not there`, { line: bAt('return false;'), vars: { value } });
        results.push(found);
        t.ret();
      } else {
        t.call('remove', value);
        const rem = (n, v) => {
          if (!n) { t.step(`${v} is not in the tree`, { line: bAt('if (node == null) return null'), vars: { value: v } }); return null; }
          const c = v - n.label;
          if (c < 0) { t.step(`${v} < ${n.label}: left`, { line: bAt('if (c < 0) node.left = remove'), vars: { value: v, node: n.label }, marks: { tree: { [n.id]: 'compare' } } }); n.left = rem(n.left, v); return n; }
          if (c > 0) { t.step(`${v} > ${n.label}: right`, { line: bAt('else if (c > 0) node.right = remove'), vars: { value: v, node: n.label }, marks: { tree: { [n.id]: 'compare' } } }); n.right = rem(n.right, v); return n; }
          if (!n.left) { t.step(`${v} has no left child: its right subtree takes its place`, { line: bAt('else if (node.left == null) return node.right'), vars: { value: v }, marks: { tree: { [n.id]: 'removed' } } }); return n.right; }
          if (!n.right) { t.step(`${v} has no right child: its left subtree takes its place`, { line: bAt('else if (node.right == null) return node.left'), vars: { value: v }, marks: { tree: { [n.id]: 'removed' } } }); return n.left; }
          let m = n.right;
          while (m.left) m = m.left;
          t.step(`${v} has two children: the smallest on its right, ${m.label}, takes its value`, { line: bAt('while (min.left != null) min = min.left'), vars: { value: v, min: m.label }, marks: { tree: { [n.id]: 'removed', [m.id]: 'compare' } } });
          n.label = m.label; sync();
          t.step(`Now remove ${m.label} from the right subtree`, { line: bAt('node.right = remove(node.right, min.value)'), vars: { value: v, min: m.label }, marks: { tree: { [n.id]: 'current' } } });
          n.right = rem(n.right, m.label);
          return n;
        };
        root = rem(root, value); sync();
        t.step(`${value} removed`, { line: bAt('return node;', 2), vars: {} });
        t.ret();
      }
    }
    t.step(`Done: ${root ? binaryText(root) : 'empty'}`, { line: null, vars: {} });
    return { tree: root ? binaryText(root) : '', found: results };
  },
};

const avlSource = `private Node<T> insert(Node<T> node, T value) {
  if (node == null) return new Node<>(value);
  if (value.compareTo(node.value) < 0) node.left = insert(node.left, value);
  else if (value.compareTo(node.value) > 0) node.right = insert(node.right, value);
  else return node;
  node.height = 1 + Math.max(height(node.left), height(node.right));
  int balance = height(node.left) - height(node.right);
  if (balance > 1 && value.compareTo(node.left.value) < 0) return rotateRight(node);        // LL
  if (balance < -1 && value.compareTo(node.right.value) > 0) return rotateLeft(node);       // RR
  if (balance > 1) { node.left = rotateLeft(node.left); return rotateRight(node); }         // LR
  if (balance < -1) { node.right = rotateRight(node.right); return rotateLeft(node); }      // RL
  return node;
}

private Node<T> rotateRight(Node<T> y) {
  Node<T> x = y.left;
  y.left = x.right;
  x.right = y;                      // x goes up, y down to its right
  y.height = 1 + Math.max(height(y.left), height(y.right));
  x.height = 1 + Math.max(height(x.left), height(x.right));
  return x;
}

private Node<T> rotateLeft(Node<T> x) {
  Node<T> y = x.right;
  x.right = y.left;
  y.left = x;                       // y goes up, x down to its left
  x.height = 1 + Math.max(height(x.left), height(x.right));
  y.height = 1 + Math.max(height(y.left), height(y.right));
  return y;
}`;
const aAt = lineFinder(avlSource);
export const avl = {
  id: 'avl', topic: 'trees', name: 'AVL insert (rotations)',
  hint: 'A search tree that stays balanced: after each insert, rotations fix a balance of ±2',
  fields: [{ key: 'values', type: 'array', label: 'Values to insert, in order' }],
  presets: [{ label: 'All four rotations', input: { values: [30, 20, 10, 40, 50, 25, 22, 45, 47] } }, { label: 'Sorted 1 to 7', input: { values: [1, 2, 3, 4, 5, 6, 7] } }],
  random(seed) { const r = rng(seed); return { values: [...new Set(Array.from({ length: 9 }, () => r.int(1, 99)))] }; },
  normalize(raw = {}) { return { values: ints(raw.values ?? [30, 20, 10, 40, 50, 25, 22, 45, 47], { most: 20 }) }; },
  source: avlSource,
  run({ values }, t) {
    let root = null, serial = 0;
    const tr = t.tree('tree', null, { label: 'AVL tree' });
    const h = (n) => (n ? n.h : 0);
    const fix = (n) => { n.h = 1 + Math.max(h(n.left), h(n.right)); };
    const view = (n) => (n ? { id: n.id, label: `${n.v}`, left: view(n.left), right: view(n.right) } : null);
    const sync = () => tr.set(view(root));
    const rotations = [];
    const rotR = (y) => { const x = y.left; y.left = x.right; x.right = y; fix(y); fix(x); return x; };
    const rotL = (x) => { const y = x.right; x.right = y.left; y.left = x; fix(x); fix(y); return y; };
    // Each node is attached to its parent at once (attach), so every step shows the whole tree.
    for (const value of values) {
      t.call('insert', value);
      let made = null;
      const ins = (n, attach) => {
        if (!n) { made = { id: `a${serial++}`, v: value, h: 1, left: null, right: null }; attach(made); sync(); t.step(`${value} goes in as a new leaf`, { line: aAt('if (node == null) return new Node<>(value)'), vars: { value }, marks: { tree: { [made.id]: 'new' } } }); return; }
        if (value < n.v) { t.step(`${value} < ${n.v}: left`, { line: aAt('if (value.compareTo(node.value) < 0) node.left = insert'), vars: { value, node: n.v }, marks: { tree: { [n.id]: 'compare' } } }); ins(n.left, (k) => { n.left = k; }); }
        else if (value > n.v) { t.step(`${value} > ${n.v}: right`, { line: aAt('else if (value.compareTo(node.value) > 0) node.right = insert'), vars: { value, node: n.v }, marks: { tree: { [n.id]: 'compare' } } }); ins(n.right, (k) => { n.right = k; }); }
        else { t.step(`${value} is already there`, { line: aAt('else return node'), vars: { value } }); return; }
        fix(n);
        const bal = h(n.left) - h(n.right);
        if (Math.abs(bal) <= 1) { t.step(`Back at ${n.v}: balance ${bal}, fine`, { line: aAt('int balance = height(node.left) - height(node.right)'), vars: { node: n.v, balance: bal }, marks: { tree: { [n.id]: 'done' } } }); return; }
        let kind;
        if (bal > 1 && value < n.left.v) kind = 'LL';
        else if (bal < -1 && value > n.right.v) kind = 'RR';
        else kind = bal > 1 ? 'LR' : 'RL';
        rotations.push(`${kind} at ${n.v}`);
        t.step(`${n.v} is out of balance (${bal > 0 ? '+' : ''}${bal}): case ${kind}`, { line: aAt({ LL: '// LL', RR: '// RR', LR: '// LR', RL: '// RL' }[kind]), vars: { node: n.v, balance: bal }, marks: { tree: { [n.id]: 'error' } } });
        if (kind === 'LR') { n.left = rotL(n.left); sync(); t.step(`LR: first a left rotation on the left child; ${n.left.v} goes up`, { line: aAt('y.left = x;'), vars: { node: n.v }, marks: { tree: { [n.id]: 'error', [n.left.id]: 'current' } } }); }
        if (kind === 'RL') { n.right = rotR(n.right); sync(); t.step(`RL: first a right rotation on the right child; ${n.right.v} goes up`, { line: aAt('x.right = y;'), vars: { node: n.v }, marks: { tree: { [n.id]: 'error', [n.right.id]: 'current' } } }); }
        const right = kind === 'LL' || kind === 'LR';
        const up = right ? rotR(n) : rotL(n);
        attach(up); sync();
        t.step(`Rotate ${right ? 'right' : 'left'} at ${n.v}: ${up.v} goes up, ${n.v} down to its ${right ? 'right' : 'left'}`, { line: aAt(right ? 'x.right = y;' : 'y.left = x;'), vars: { x: right ? up.v : n.v, y: right ? n.v : up.v }, marks: { tree: { [up.id]: 'current', [n.id]: 'path' } } });
      };
      ins(root, (k) => { root = k; });
      t.ret();
    }
    void rotations;
    t.step(`Done: ${root ? binaryText(view(root)) : 'empty'}`, { line: null, vars: {} });
    return { tree: root ? binaryText(view(root)) : '', rotations };
  },
};
