// Towers of Hanoi (recursion, activity 10), N queens (backtracking, activity 9), Fibonacci and
// the 0/1 knapsack with tables (dynamic programming, activity 11).
import { lineFinder, clampInt, rng } from './common.js';

const hanoiSource = `public static void hanoi(int n, String from, String aux, String to) {
  if (n == 1) {
    move(1, from, to);                // the smallest disc: straight there
  } else {
    hanoi(n - 1, from, to, aux);      // the n-1 above it out of the way
    move(n, from, to);
    hanoi(n - 1, aux, from, to);      // and back on top of it
  }
}

private static void move(int disc, String from, String to) {
  System.out.println("Disc " + disc + " from " + from + " to " + to);
}`;
const hAt = lineFinder(hanoiSource);
export const hanoi = {
  id: 'hanoi',
  topic: 'recursion',
  name: 'Towers of Hanoi',
  hint: 'Move n discs from A to C, never a larger one on a smaller: 2ⁿ − 1 moves',
  fields: [{ key: 'n', type: 'int', label: 'Discs', min: 1, max: 8 }],
  presets: [{ label: 'Three discs', input: { n: 3 } }, { label: 'Four discs', input: { n: 4 } }],
  random(seed) { return { n: rng(seed).int(2, 5) }; },
  normalize(raw = {}) { return { n: clampInt(raw.n, 1, 8, 3) }; },
  source: hanoiSource,
  run({ n }, t) {
    const pegs = { A: t.stack('A', Array.from({ length: n }, (_, i) => n - i), { label: 'A', sized: true }), B: t.stack('B', [], { label: 'B', sized: true }), C: t.stack('C', [], { label: 'C', sized: true }) };
    const moves = t.value('moves', 0, { label: 'moves' });
    const list = [];
    t.step(`${n} disc${n === 1 ? '' : 's'} on A; move them to C`, { line: hAt('public static void hanoi'), vars: { n } });
    const move = (disc, from, to) => {
      pegs[from].pop(); pegs[to].push(disc);
      moves.set(moves.get() + 1); list.push(`${disc}:${from}${to}`);
      t.step(`Move disc ${disc} from ${from} to ${to}`, { line: disc === 1 ? hAt('move(1, from, to)') : hAt('move(n, from, to)'), vars: { n: disc, from, to }, marks: { [to]: { [pegs[to].size() - 1]: 'current' } } });
    };
    const rec = (k, from, aux, to) => {
      t.call('hanoi', `${k}, ${from}, ${aux}, ${to}`);
      if (k === 1) move(1, from, to);
      else {
        t.step(`hanoi(${k}): first the ${k - 1} disc${k - 1 === 1 ? '' : 's'} above out of the way, to ${aux}`, { line: hAt('hanoi(n - 1, from, to, aux)'), vars: { n: k, from, aux, to } });
        rec(k - 1, from, to, aux);
        move(k, from, to);
        t.step(`Now the ${k - 1} disc${k - 1 === 1 ? '' : 's'} on ${aux} go on top, to ${to}`, { line: hAt('hanoi(n - 1, aux, from, to)'), vars: { n: k, from, aux, to } });
        rec(k - 1, aux, from, to);
      }
      t.ret();
    };
    rec(n, 'A', 'B', 'C');
    t.step(`Done in ${moves.get()} moves (2^${n} − 1)`, { line: null, vars: {} });
    return { moves: moves.get(), list, pegs: { A: pegs.A.toArray(), B: pegs.B.toArray(), C: pegs.C.toArray() } };
  },
};

const queensSource = `public static boolean placeQueens(int queen, int[] board) {
  if (queen == board.length) return true;          // every queen is placed
  for (int column = 0; column < board.length; column++) {
    if (goodPlace(queen, column, board)) {
      board[queen] = column;
      if (placeQueens(queen + 1, board)) return true;
      board[queen] = -1;                           // undo: try the next column
    }
  }
  return false;                                    // no column: back to the queen before
}

private static boolean goodPlace(int queen, int column, int[] board) {
  for (int previous = 0; previous < queen; previous++) {
    if (board[previous] == column
        || Math.abs(previous - queen) == Math.abs(board[previous] - column)) {
      return false;                                // same column or diagonal
    }
  }
  return true;
}`;
const qAt = lineFinder(queensSource);
export const queens = {
  id: 'queens',
  topic: 'backtracking',
  name: 'N queens',
  hint: 'One queen per row, none attacking another: try each column, undo when stuck',
  fields: [{ key: 'n', type: 'int', label: 'Board size (n)', min: 1, max: 8 }],
  presets: [{ label: 'Four queens', input: { n: 4 } }, { label: 'Five queens', input: { n: 5 } }, { label: 'Six queens', input: { n: 6 } }, { label: 'Activity: eight queens', input: { n: 8 } }],
  random(seed) { return { n: rng(seed).int(4, 6) }; },
  normalize(raw = {}) { return { n: clampInt(raw.n, 1, 8, 4) }; },
  source: queensSource,
  run({ n }, t) {
    const b = t.board('board', n, { label: 'board' });
    const arr = t.array('cols', Array(n).fill(-1), { label: 'int[] board (column of each queen)' });
    const cols = Array(n).fill(-1);
    const attacker = (q, c) => { for (let p = 0; p < q; p++) if (cols[p] === c || Math.abs(p - q) === Math.abs(cols[p] - c)) return p; return -1; };
    const place = (q) => {
      t.call('placeQueens', q);
      if (q === n) { t.step(`All ${n} queens are placed`, { line: qAt('if (queen == board.length) return true'), vars: { queen: q } }); t.ret(); return true; }
      for (let c = 0; c < n; c++) {
        const p = attacker(q, c);
        if (p >= 0) {
          t.step(`Queen ${q} at column ${c}? The queen of row ${p} attacks it (${cols[p] === c ? 'same column' : 'diagonal'})`, { line: qAt('|| Math.abs(previous - queen)'), vars: { queen: q, column: c, previous: p }, marks: { board: { [`${q},${c}`]: 'error', [`${p},${cols[p]}`]: 'error' } } });
          continue;
        }
        cols[q] = c; b.set(q, c, 'Q'); arr.set(q, c);
        t.step(`Queen ${q} at column ${c}: no queen attacks it`, { line: qAt('board[queen] = column'), vars: { queen: q, column: c }, marks: { board: { [`${q},${c}`]: 'path' }, cols: { [q]: 'current' } } });
        if (place(q + 1)) { t.ret(); return true; }
        cols[q] = -1; b.set(q, c, ''); arr.set(q, -1);
        t.step(`No way to go on from there: take queen ${q} back from column ${c}`, { line: qAt('board[queen] = -1'), vars: { queen: q, column: c }, marks: { board: { [`${q},${c}`]: 'removed' } } });
      }
      t.step(`No column works for queen ${q}: back to queen ${q - 1}`, { line: qAt('return false;                                    // no column'), vars: { queen: q } });
      t.ret();
      return false;
    };
    t.step(`Place ${n} queens on a ${n}×${n} board`, { line: qAt('public static boolean placeQueens'), vars: { queen: 0 } });
    const ok = place(0);
    for (let q = 0; q < n && ok; q++) t.mark('board', `${q},${cols[q]}`, 'path');
    t.step(ok ? `A solution: columns ${cols.join(', ')}` : `No solution for n = ${n}`, { line: null, vars: {} });
    return ok ? cols : null;
  },
};

const fibSource = `public static int fibonacciDynamic(int n) {
  if (n <= 1) return n;
  int[] table = new int[n + 1];
  table[0] = 0;
  table[1] = 1;
  for (int i = 2; i <= n; i++) {
    table[i] = table[i - 1] + table[i - 2];       // each from the two before it
  }
  return table[n];
}`;
const fAt = lineFinder(fibSource);
export const fibonacci = {
  id: 'fibonacci',
  topic: 'dp',
  name: 'Fibonacci',
  hint: 'Fill a table from the bottom: each value from the two before it, once',
  fields: [{ key: 'n', type: 'int', label: 'n', min: 0, max: 40 }],
  presets: [{ label: 'n = 10', input: { n: 10 } }, { label: 'n = 20', input: { n: 20 } }],
  random(seed) { return { n: rng(seed).int(6, 15) }; },
  normalize(raw = {}) { return { n: clampInt(raw.n, 0, 40, 10) }; },
  source: fibSource,
  run({ n }, t) {
    if (n <= 1) { t.value('result', n, { label: 'result' }); t.step(`n ≤ 1: fib(${n}) = ${n}`, { line: fAt('if (n <= 1) return n'), vars: { n } }); return n; }
    const table = t.array('table', Array(n + 1).fill(0), { label: 'table' });
    t.step(`A table of ${n + 1} values, 0 to ${n}`, { line: fAt('int[] table = new int[n + 1]'), vars: { n } });
    table.set(1, 1);
    t.step('The two first values: table[0] = 0, table[1] = 1', { line: fAt('table[1] = 1'), vars: { n }, marks: { table: { 0: 'done', 1: 'done' } } });
    for (let i = 2; i <= n; i++) {
      table.pointer('i', i);
      table.set(i, table.get(i - 1) + table.get(i - 2));
      t.mark('table', i - 2, 'done');
      t.step(`table[${i}] = table[${i - 1}] + table[${i - 2}] = ${table.get(i - 1)} + ${table.get(i - 2)} = ${table.get(i)}`, { line: fAt('table[i] = table[i - 1] + table[i - 2]'), vars: { n, i }, marks: { table: { [i]: 'current', [i - 1]: 'compare', [i - 2]: 'compare' } } });
    }
    table.pointer('i', null);
    for (let i = 0; i <= n; i++) t.mark('table', i, 'done');
    t.mark('table', n, 'path');
    t.step(`fib(${n}) = ${table.get(n)}, with ${n - 1} sums (the recursion without a table makes about ${Math.round(1.618 ** n)} calls)`, { line: fAt('return table[n]'), vars: { n } });
    return table.get(n);
  },
};

const knapSource = `public static List<String> knapsack(int capacity, String[] names, int[] weights, int[] values) {
  int n = weights.length;
  int[][] table = new int[n + 1][capacity + 1];   // row 0: no items, all 0
  for (int i = 1; i <= n; i++) {
    for (int w = 0; w <= capacity; w++) {
      table[i][w] = table[i - 1][w];                // without item i
      if (weights[i - 1] <= w) {
        int with = table[i - 1][w - weights[i - 1]] + values[i - 1];
        if (with > table[i][w]) table[i][w] = with; // with item i is better
      }
    }
  }
  List<String> chosen = new LinkedList<>();
  for (int i = n, w = capacity; i > 0; i--) {
    if (table[i][w] != table[i - 1][w]) {           // item i is in
      chosen.add(names[i - 1]);
      w -= weights[i - 1];
    }
  }
  return chosen;                                    // best value: table[n][capacity]
}`;
const kAt = lineFinder(knapSource);
// Items as text: "name weight value", one per line.
export function parseItems(text) {
  const items = [], problems = [];
  for (const raw of String(text || '').split(/[\n;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.+?)\s+(\d+)\s+(\d+)$/);
    if (m) items.push({ name: m[1], weight: Number(m[2]), value: Number(m[3]) });
    else problems.push(line);
  }
  return { items: items.slice(0, 8), problems };
}
const ITEMS = 'Map 1 1\nTent 3 4\nStove 4 5\nCamera 5 7';
export const knapsack = {
  id: 'knapsack',
  topic: 'dp',
  name: '0/1 knapsack',
  hint: 'The best value for each item and capacity in a table; then back from the corner to the items chosen',
  fields: [
    { key: 'items', type: 'text', label: 'Items', hint: 'name weight value, one per line' },
    { key: 'capacity', type: 'int', label: 'Capacity', min: 1, max: 20 },
  ],
  presets: [{ label: 'Camping, capacity 7', input: { items: ITEMS, capacity: 7 } }, { label: 'Five items, capacity 10', input: { items: 'A 5 10\nB 4 40\nC 6 30\nD 3 50\nE 2 15', capacity: 10 } }, { label: 'Activity 11: capacity 9', input: { items: 'car 3 4\ndoll 4 5\nball 5 10\nbike 2 3', capacity: 9 } }],
  random(seed) {
    const r = rng(seed);
    return { items: Array.from({ length: r.int(3, 5) }, (_, i) => `${String.fromCharCode(65 + i)} ${r.int(1, 6)} ${r.int(1, 20)}`).join('\n'), capacity: r.int(5, 12) };
  },
  normalize(raw = {}) {
    const items = typeof raw.items === 'string' ? raw.items : ITEMS;
    const { problems } = parseItems(items);
    if (problems.length) throw Error(`Not an item: "${problems[0]}" (write name weight value)`);
    return { items, capacity: clampInt(raw.capacity, 1, 20, 7) };
  },
  source: knapSource,
  run(input, t) {
    const { items } = parseItems(input.items);
    const W = input.capacity, n = items.length;
    const m = t.matrix('table', n + 1, W + 1, '', { label: 'table[i][w]: best value', rowLabels: ['0: none', ...items.map((it, i) => `${i + 1}: ${it.name} (${it.weight}, ${it.value})`)], colLabels: Array.from({ length: W + 1 }, (_, w) => w) });
    const chosen = t.array('chosen', [], { label: 'chosen' });
    for (let w = 0; w <= W; w++) m.set(0, w, 0);
    t.step(`Row 0 (no items) is all 0; ${n} items, capacity ${W}`, { line: kAt('int[][] table = new int[n + 1][capacity + 1]'), vars: { n, capacity: W } });
    for (let i = 1; i <= n; i++) {
      const it = items[i - 1];
      for (let w = 0; w <= W; w++) {
        const without = m.get(i - 1, w);
        const fits = it.weight <= w;
        const withIt = fits ? m.get(i - 1, w - it.weight) + it.value : null;
        const best = fits && withIt > without ? withIt : without;
        m.set(i, w, best);
        const marks = { table: { [`${i},${w}`]: 'current', [`${i - 1},${w}`]: 'compare', ...(fits ? { [`${i - 1},${w - it.weight}`]: 'compare' } : {}) } };
        t.step(fits ? `${it.name} fits in ${w}: without it ${without}, with it ${m.get(i - 1, w - it.weight)} + ${it.value} = ${withIt}; best ${best}` : `${it.name} (${it.weight}) does not fit in ${w}: ${without}, as without it`, { line: fits ? kAt('if (with > table[i][w])') : kAt('table[i][w] = table[i - 1][w]'), vars: { i, w, without, ...(fits ? { with: withIt } : {}) }, marks });
      }
    }
    let w = W;
    const picked = [];
    for (let i = n; i > 0; i--) {
      const inIt = m.get(i, w) !== m.get(i - 1, w);
      t.mark('table', `${i},${w}`, 'path');
      if (inIt) { picked.unshift(items[i - 1].name); chosen.addFirst(items[i - 1].name); }
      t.step(inIt ? `table[${i}][${w}] ≠ table[${i - 1}][${w}]: ${items[i - 1].name} is in; ${w} − ${items[i - 1].weight} = ${w - items[i - 1].weight} left` : `table[${i}][${w}] = table[${i - 1}][${w}]: ${items[i - 1].name} is not`, { line: inIt ? kAt('chosen.add(names[i - 1])') : kAt('if (table[i][w] != table[i - 1][w])'), vars: { i, w } });
      if (inIt) w -= items[i - 1].weight;
    }
    const best = m.get(n, W);
    t.step(`Best value ${best} with ${picked.length ? picked.join(', ') : 'nothing'}`, { line: kAt('return chosen'), vars: {} });
    return { best, chosen: picked };
  },
};
