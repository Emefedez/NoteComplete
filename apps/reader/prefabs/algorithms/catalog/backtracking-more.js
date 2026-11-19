// Backtracking (activity 9) on the activity's test data: give change, fill a flash drive,
// subset sum (subgroups), sudoku, a word path through a grid (rehearseWords) and the puzzle
// of cards. Each tries a choice, goes on, and undoes it when that way ends badly.
import { lineFinder, ints, clampInt, rng } from './common.js';

function rows(text, count, what) {
  const out = [];
  for (const raw of String(text || '').split(/[\n;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const p = line.split(/\s+/), nums = p.slice(1).map(Number);
    if (p.length !== count + 1 || nums.some((n) => !Number.isInteger(n) || n < 0)) throw Error(`Not ${what}: "${line}"`);
    out.push({ name: p[0], nums });
  }
  return out.slice(0, 12);
}

const changeSource = `public static boolean giveChange(int amountReturned, Map<Integer, Integer> changeAvailable,
    Map<Integer, Integer> solution) {
  return giveChange(amountReturned, sortedCoins(changeAvailable), 0, changeAvailable, solution);
}

private static boolean giveChange(int amount, int[] coins, int index,
    Map<Integer, Integer> available, Map<Integer, Integer> solution) {
  if (amount == 0) return true;                          // exact: a solution
  if (index == coins.length) return false;               // no coins left to try
  int coin = coins[index];
  for (int count = Math.min(amount / coin, available.get(coin)); count >= 0; count--) {
    if (count > 0) solution.add(coin, count);
    if (giveChange(amount - count * coin, coins, index + 1, available, solution)) return true;
    solution.remove(coin);                               // undo: one coin fewer
  }
  return false;
}`;
const cAt = lineFinder(changeSource);
export const giveChange = {
  id: 'bt-give-change', topic: 'backtracking', name: 'Give change',
  hint: 'As many of the largest coin as possible, one fewer when the rest cannot be given',
  fields: [{ key: 'amount', type: 'int', label: 'Amount', min: 0, max: 100000 }, { key: 'coins', type: 'text', label: 'Coins', hint: 'coin how-many, one per line' }],
  presets: [{ label: 'Activity: 2100 with 500 and 200', input: { amount: 2100, coins: '500 20\n200 10' } }, { label: '6 with 4 and 3', input: { amount: 6, coins: '4 5\n3 5' } }],
  random(seed) { const r = rng(seed); return { amount: r.int(5, 40) * 10, coins: '50 3\n30 4\n20 3' }; },
  normalize(raw = {}) { const coins = typeof raw.coins === 'string' ? raw.coins : '500 20\n200 10'; if (rows(coins, 1, 'a coin and how many').some((c) => !(Number(c.name) > 0))) throw Error('Coins above 0'); return { amount: clampInt(raw.amount, 0, 100000, 2100), coins }; },
  source: changeSource,
  run({ amount, coins }, t) {
    const list = rows(coins, 1, '').map((c) => ({ coin: Number(c.name), have: c.nums[0] })).sort((a, b) => b.coin - a.coin);
    t.map('available', list.map((c) => [c.coin, c.have]), { label: 'changeAvailable' });
    const sol = t.map('solution', [], { label: 'solution' });
    const left = t.value('left', amount, { label: 'amount left' });
    const go = (rest, i) => {
      t.call('giveChange', `${rest}, ${i}`);
      left.set(rest);
      if (rest === 0) { t.step('Nothing left to give: a solution', { line: cAt('if (amount == 0) return true'), vars: { amount: rest, index: i } }); t.ret(); return true; }
      if (i === list.length) { t.step(`${rest} left and no coins to try: back`, { line: cAt('if (index == coins.length) return false'), vars: { amount: rest, index: i } }); t.ret(); return false; }
      const { coin, have } = list[i];
      for (let count = Math.min(Math.floor(rest / coin), have); count >= 0; count--) {
        if (count > 0) sol.set(coin, count);
        t.step(`Try ${count} × ${coin}; ${rest - count * coin} left`, { line: cAt('if (count > 0) solution.add(coin, count)'), vars: { amount: rest, coin, count }, marks: { available: { [coin]: 'current' }, solution: count ? { [coin]: 'compare' } : {} } });
        if (go(rest - count * coin, i + 1)) { t.ret(); return true; }
        if (count > 0) { sol.remove(coin); t.step(`${count} × ${coin} does not work: undo`, { line: cAt('solution.remove(coin)'), vars: { amount: rest, coin, count } }); }
      }
      t.ret();
      return false;
    };
    const ok = go(amount, 0);
    t.step(ok ? `Change: ${sol.entries().map(([c, n]) => `${n} × ${c}`).join(', ') || 'none needed'}` : `No exact change for ${amount}`, { line: null, vars: {} });
    return ok ? Object.fromEntries(sol.entries()) : null;
  },
};

const flashSource = `public static boolean fillUpFlashDrive(int capacity, Map<String, Integer> programs, Set<String> drive) {
  return fill(capacity, new ArrayList<>(programs.getKeys()), 0, programs, drive);
}

private static boolean fill(int free, List<String> names, int index, Map<String, Integer> programs,
    Set<String> drive) {
  if (free == 0) return true;                             // full to the last byte
  if (index == names.size()) return false;
  String program = names.get(index);
  if (programs.get(program) <= free) {
    drive.add(program);                                   // with it
    if (fill(free - programs.get(program), names, index + 1, programs, drive)) return true;
    drive.remove(program);                                // undo
  }
  return fill(free, names, index + 1, programs, drive);   // without it
}`;
const fAt = lineFinder(flashSource);
export const flashDrive = {
  id: 'flash-drive', topic: 'backtracking', name: 'Fill a flash drive',
  hint: 'Programs that fill it exactly: each one with it first, then without it',
  fields: [{ key: 'capacity', type: 'int', label: 'Capacity', min: 1, max: 1000 }, { key: 'programs', type: 'text', label: 'Programs', hint: 'name size, one per line' }],
  presets: [{ label: 'Activity: 21 with p1…p5', input: { capacity: 21, programs: 'p1 10\np2 3\np3 5\np4 3\np5 3' } }],
  random(seed) { const r = rng(seed); return { capacity: r.int(12, 25), programs: Array.from({ length: 6 }, (_, i) => `p${i + 1} ${r.int(2, 9)}`).join('\n') }; },
  normalize(raw = {}) { const programs = typeof raw.programs === 'string' ? raw.programs : 'p1 10\np2 3\np3 5\np4 3\np5 3'; rows(programs, 1, 'a program and its size'); return { capacity: clampInt(raw.capacity, 1, 1000, 21), programs }; },
  source: flashSource,
  run({ capacity, programs }, t) {
    const list = rows(programs, 1, '').map((p) => ({ name: p.name, size: p.nums[0] }));
    const arr = t.array('programs', list.map((p) => `${p.name}:${p.size}`), { label: 'programs' });
    const drive = t.hashSet('drive', [], { label: 'drive' });
    const free = t.value('free', capacity, { label: 'free' });
    const go = (left, i) => {
      t.call('fill', `${left}, ${i}`);
      free.set(left);
      arr.pointer('index', i < list.length ? i : null);
      if (left === 0) { t.step('Full: a solution', { line: fAt('if (free == 0) return true'), vars: { free: left } }); t.ret(); return true; }
      if (i === list.length) { t.step(`${left} free and no programs left: back`, { line: fAt('if (index == names.size()) return false'), vars: { free: left } }); t.ret(); return false; }
      const p = list[i];
      if (p.size <= left) {
        drive.add(p.name); t.mark('programs', i, 'path');
        t.step(`With ${p.name} (${p.size}): ${left - p.size} free`, { line: fAt('drive.add(program)'), vars: { free: left, program: p.name } });
        if (go(left - p.size, i + 1)) { t.ret(); return true; }
        drive.remove(p.name); t.mark('programs', i, null);
        t.step(`Not with ${p.name}: undo`, { line: fAt('drive.remove(program)'), vars: { free: left, program: p.name }, marks: { programs: { [i]: 'removed' } } });
      } else t.step(`${p.name} (${p.size}) does not fit in ${left}`, { line: fAt('if (programs.get(program) <= free)'), vars: { free: left, program: p.name }, marks: { programs: { [i]: 'error' } } });
      t.step(`Without ${p.name}`, { line: fAt('return fill(free, names, index + 1'), vars: { free: left, program: p.name }, marks: { programs: { [i]: 'done' } } });
      const ok = go(left, i + 1);
      t.ret();
      return ok;
    };
    const ok = go(capacity, 0);
    arr.pointer('index', null);
    t.step(ok ? `The drive holds {${drive.toArray().join(', ')}}` : 'No set of programs fills it exactly', { line: null, vars: {} });
    return ok ? drive.toArray() : null;
  },
};

const subSource = `public static boolean subgroups(int[] values, int[] solution, int result, int index) {
  if (result == 0) return true;                           // the sum is reached
  if (index == values.length || result < 0) return false;
  solution[index] = 1;                                    // take values[index]
  if (subgroups(values, solution, result - values[index], index + 1)) return true;
  solution[index] = 0;                                    // leave it
  return subgroups(values, solution, result, index + 1);
}`;
const sAt = lineFinder(subSource);
export const subsetSum = {
  id: 'subset-sum', topic: 'backtracking', name: 'Subset sum (subgroups)',
  hint: 'Values that add up to a target: take each one, and leave it if that fails',
  fields: [{ key: 'values', type: 'array', label: 'Values (0 or more)' }, { key: 'target', type: 'int', label: 'Target', min: 0, max: 999 }],
  presets: [{ label: 'Activity: 21', input: { values: [4, 7, 3, 5, 1, 9, 8, 2, 6], target: 21 } }],
  random(seed) { const r = rng(seed); return { values: Array.from({ length: 7 }, () => r.int(1, 12)), target: r.int(10, 30) }; },
  normalize(raw = {}) { return { values: ints(raw.values ?? [4, 7, 3, 5, 1, 9, 8, 2, 6], { min: 0, most: 14 }), target: clampInt(raw.target, 0, 999, 21) }; },
  source: subSource,
  run({ values, target }, t) {
    t.array('values', values, { label: 'values' });
    const sol = t.array('solution', values.map(() => 0), { label: 'solution' });
    const left = t.value('result', target, { label: 'result (left to add)' });
    const go = (rest, i) => {
      t.call('subgroups', `${rest}, ${i}`);
      left.set(rest);
      if (rest === 0) { t.step('The sum is reached', { line: sAt('if (result == 0) return true'), vars: { result: rest, index: i } }); t.ret(); return true; }
      if (i === values.length || rest < 0) { t.step(rest < 0 ? 'Past the target: back' : 'No values left: back', { line: sAt('if (index == values.length || result < 0) return false'), vars: { result: rest, index: i } }); t.ret(); return false; }
      sol.set(i, 1);
      t.step(`Take ${values[i]}: ${rest - values[i]} left`, { line: sAt('solution[index] = 1'), vars: { result: rest, index: i }, marks: { values: { [i]: 'current' }, solution: { [i]: 'path' } } });
      if (go(rest - values[i], i + 1)) { t.ret(); return true; }
      sol.set(i, 0);
      t.step(`Leave ${values[i]}`, { line: sAt('solution[index] = 0'), vars: { result: rest, index: i }, marks: { values: { [i]: 'removed' } } });
      const ok = go(rest, i + 1);
      t.ret();
      return ok;
    };
    const ok = go(target, 0);
    t.step(ok ? `${values.filter((_, i) => sol.get(i)).join(' + ')} = ${target}` : `No subset adds up to ${target}`, { line: null, vars: {}, marks: { values: Object.fromEntries(values.map((_, i) => [i, sol.get(i) ? 'path' : 'done'])) } });
    return ok ? sol.toArray() : null;
  },
};

const sudokuSource = `public static boolean solveSudoku(int[][] board) {
  for (int i = 0; i < SUDOKU_DIMENSION; i++) {
    for (int j = 0; j < SUDOKU_DIMENSION; j++) {
      if (board[i][j] == 0) {                               // the next empty cell
        for (int value = 1; value <= 9; value++) {
          if (canInsert(board, i, j, value)) {
            board[i][j] = value;
            if (solveSudoku(board)) return true;
            board[i][j] = 0;                                // undo
          }
        }
        return false;                                       // nothing fits here: back
      }
    }
  }
  return true;                                              // no empty cell left
}

private static boolean canInsert(int[][] board, int i, int j, int value) {
  for (int a = 0; a < 9; a++) {
    if (board[i][a] == value || board[a][j] == value) return false;   // row, column
  }
  int y = (i / 3) * 3, x = (j / 3) * 3;
  for (int a = 0; a < 3; a++)
    for (int b = 0; b < 3; b++)
      if (board[y + a][x + b] == value) return false;                // its box
  return true;
}`;
const kAt = lineFinder(sudokuSource);
const ACTIVITY_SUDOKU = '070000080\n050600001\n003140000\n906050300\n000000000\n005020107\n000065700\n300001920\n040000010';
const EASY_SUDOKU = '534678912\n672195348\n198342567\n859761423\n426853791\n713924856\n961537284\n287419635\n345286179'.split('\n').map((r, i) => r.split('').map((c, j) => ((i * 9 + j) % 4 === 0 || (i + j) % 5 === 0 ? '0' : c)).join('')).join('\n');
export const sudoku = {
  id: 'sudoku', topic: 'backtracking', name: 'Sudoku',
  hint: 'The next empty cell takes the first value that fits its row, column and box; undo when stuck',
  fields: [
    { key: 'board', type: 'text', label: 'Board', hint: '9 lines of 9 digits, 0 for empty' },
    { key: 'show', type: 'choice', label: 'Steps', options: [['all', 'Every value placed and undone'], ['progress', 'Only each new furthest cell (long searches)']] },
  ],
  presets: [{ label: 'A few empty cells', input: { board: EASY_SUDOKU, show: 'all' } }, { label: 'Activity sudoku (21 000 tries)', input: { board: ACTIVITY_SUDOKU, show: 'progress' } }],
  random(seed) { const r = rng(seed); return { board: EASY_SUDOKU.split('\n').map((row) => row.split('').map((c) => (r.next() < 0.15 ? '0' : c)).join('')).join('\n'), show: 'all' }; },
  normalize(raw = {}) {
    const board = typeof raw.board === 'string' ? raw.board.trim() : EASY_SUDOKU;
    const lines = board.split(/\s*\n\s*/);
    if (lines.length !== 9 || lines.some((l) => !/^[0-9]{9}$/.test(l.replace(/[.\s]/g, (c) => (c === '.' ? '0' : ''))))) throw Error('Write 9 lines of 9 digits (0 or . for an empty cell)');
    return { board, show: raw.show === 'progress' ? 'progress' : 'all' };
  },
  source: sudokuSource,
  run({ board, show }, t) {
    const b = board.split(/\s*\n\s*/).map((l) => l.replace(/\s/g, '').replace(/\./g, '0').split('').map(Number));
    const view = t.board('board', 9, { label: 'board', box: 3 });
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) if (b[i][j]) { view.set(i, j, String(b[i][j])); t.mark('board', `${i},${j}`, 'done'); }
    const ok = (i, j, v) => { for (let a = 0; a < 9; a++) if (b[i][a] === v || b[a][j] === v) return false; const y = Math.floor(i / 3) * 3, x = Math.floor(j / 3) * 3; for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) if (b[y + a][x + c] === v) return false; return true; };
    const all = show === 'all';
    let furthest = -1, placed = 0, undone = 0;
    t.step(`${b.flat().filter((v) => !v).length} empty cells`, { line: kAt('public static boolean solveSudoku') });
    const solve = () => {
      for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
        if (b[i][j]) continue;
        for (let v = 1; v <= 9; v++) {
          if (!ok(i, j, v)) continue;
          b[i][j] = v; view.set(i, j, String(v)); placed++;
          const k = i * 9 + j;
          if (all || k > furthest) { furthest = Math.max(furthest, k); t.step(`(${i}, ${j}) = ${v}: it fits its row, column and box`, { line: kAt('board[i][j] = value;'), vars: { i, j, value: v, placed, undone }, marks: { board: { [`${i},${j}`]: 'current' } } }); }
          if (solve()) return true;
          b[i][j] = 0; view.set(i, j, ''); undone++;
          if (all) t.step(`Nothing works after (${i}, ${j}) = ${v}: undo`, { line: kAt('board[i][j] = 0;'), vars: { i, j, value: v, placed, undone }, marks: { board: { [`${i},${j}`]: 'error' } } });
        }
        return false;
      }
      return true;
    };
    const solved = solve();
    t.step(solved ? `Solved: ${placed} values placed, ${undone} undone` : 'No solution', { line: kAt('return true;                                              // no empty'), vars: { placed, undone } });
    return solved ? b.map((r) => r.join('')) : null;
  },
};

const wordSource = `public static boolean rehearseWords(char[][] maze, int x, int y, String word, int position) {
  if (x < 0 || y < 0 || x >= maze.length || y >= maze[0].length) return false;   // off the grid
  if (maze[x][y] != word.charAt(position % word.length())) return false;          // not the next letter
  char letter = maze[x][y];
  maze[x][y] = ' ';                                                 // on the way
  if (x == maze.length - 1 && y == maze[0].length - 1) return true; // the far corner: out
  if (rehearseWords(maze, x + 1, y, word, position + 1)            // down
      || rehearseWords(maze, x, y + 1, word, position + 1)         // right
      || rehearseWords(maze, x - 1, y, word, position + 1)         // up
      || rehearseWords(maze, x, y - 1, word, position + 1)) {      // left
    return true;
  }
  maze[x][y] = letter;                                              // undo: not this way
  return false;
}`;
const wAt = lineFinder(wordSource);
const GRID = 'AOOXX\nDDXOX\nEADEX\nODOAD\nOOOAE';
export const wordPath = {
  id: 'word-path', topic: 'backtracking', name: 'Word path through a grid',
  hint: 'From the top left to the bottom right corner, spelling the word again and again',
  fields: [{ key: 'grid', type: 'text', label: 'Grid', hint: 'Lines of letters, as many as letters per line' }, { key: 'word', type: 'line', label: 'Word' }],
  presets: [{ label: 'Activity: ADE', input: { grid: GRID, word: 'ADE' } }, { label: 'Activity: ADEI (no way)', input: { grid: GRID, word: 'ADEI' } }],
  random(seed) { return { grid: GRID, word: rng(seed).pick(['ADE', 'AD', 'ADEI']) }; },
  normalize(raw = {}) { const grid = typeof raw.grid === 'string' ? raw.grid.trim().toUpperCase() : GRID; const rowsList = grid.split(/\s*\n\s*/); if (rowsList.length < 2 || rowsList.length > 9 || rowsList.some((r) => r.length !== rowsList.length)) throw Error('A square grid: as many lines as letters in each (2 to 9)'); const word = typeof raw.word === 'string' ? raw.word.trim().toUpperCase() : 'ADE'; if (!word) throw Error('Write a word'); return { grid, word }; },
  source: wordSource,
  run({ grid, word }, t) {
    const m = grid.split(/\s*\n\s*/).map((r) => r.split(''));
    const n = m.length;
    const view = t.board('maze', n, { label: 'maze' });
    m.forEach((r, i) => r.forEach((c, j) => view.set(i, j, c)));
    const path = t.text('word', word, { label: 'word' });
    void path;
    const go = (x, y, k) => {
      t.call('rehearseWords', `${x}, ${y}, ${k}`);
      if (x < 0 || y < 0 || x >= n || y >= n) { t.ret(); return false; }
      const want = word[k % word.length];
      if (m[x][y] !== want) { t.step(`(${x}, ${y}) is "${m[x][y] === ' ' ? '·' : m[x][y]}", not "${want}"`, { line: wAt('if (maze[x][y] != word.charAt'), vars: { x, y, position: k, letter: want }, marks: { maze: { [`${x},${y}`]: 'error' } } }); t.ret(); return false; }
      const letter = m[x][y];
      m[x][y] = ' '; view.set(x, y, '·'); t.mark('maze', `${x},${y}`, 'path');
      t.step(`(${x}, ${y}) is "${letter}": on the way`, { line: wAt("maze[x][y] = ' ';"), vars: { x, y, position: k }, marks: { maze: { [`${x},${y}`]: 'current' } } });
      if (x === n - 1 && y === n - 1) { t.step('The far corner: out', { line: wAt('if (x == maze.length - 1 && y == maze[0].length - 1) return true'), vars: { x, y } }); t.ret(); return true; }
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (go(x + dx, y + dy, k + 1)) { t.ret(); return true; }
      m[x][y] = letter; view.set(x, y, letter); t.mark('maze', `${x},${y}`, null);
      t.step(`No way on from (${x}, ${y}): undo`, { line: wAt('maze[x][y] = letter;'), vars: { x, y, position: k }, marks: { maze: { [`${x},${y}`]: 'removed' } } });
      t.ret();
      return false;
    };
    const ok = go(0, 0, 0);
    t.step(ok ? `A path spelling ${word} again and again (blanked, "·")` : `No path spells ${word}: the maze is as it was`, { line: null, vars: {} });
    return m.map((r) => r.join(''));
  },
};

const puzzleSource = `public static boolean solvePuzzle(PuzzleCard[][] board, List<PuzzleCard> cards) {
  return place(board, cards, 0);
}

// Sides, clockwise: top, right, bottom, left; 0 is the frame. A card can be turned.
private static boolean place(PuzzleCard[][] board, List<PuzzleCard> cards, int cell) {
  if (cell == PUZZLE_DIMENSION * PUZZLE_DIMENSION) return true;     // every cell filled
  int i = cell / PUZZLE_DIMENSION, j = cell % PUZZLE_DIMENSION;
  for (PuzzleCard card : cards) {
    if (isUsed(board, card)) continue;
    for (int turn = 0; turn < 4; turn++) {
      card.setAvailableSides(rotate(card.getNumPuzzleCard(), turn));
      if (fits(board, i, j, card.getAvailableSides())) {            // matches its neighbours
        board[i][j] = card;
        if (place(board, cards, cell + 1)) return true;
        board[i][j] = null;                                         // undo
      }
    }
  }
  return false;
}`;
const qAt = lineFinder(puzzleSource);
const CARDS = '0321 0135 0054 1523 2354 3421 2410 3205 1500 4320 2400 0043 3542 4210 5201 0234';
export const puzzle = {
  id: 'puzzle-cards', topic: 'backtracking', name: 'Puzzle of cards',
  hint: 'Each cell takes a card, turned so its sides match its neighbours and the frame',
  fields: [{ key: 'cards', type: 'text', label: 'Cards', hint: '16 cards of four digits (top, right, bottom, left; 0 = frame)' }],
  presets: [{ label: 'Activity puzzle', input: { cards: CARDS } }],
  random() { return { cards: CARDS.split(' ').reverse().join(' ') }; },
  normalize(raw = {}) { const cards = typeof raw.cards === 'string' ? raw.cards : CARDS; const list = cards.split(/[\s,]+/).filter(Boolean); if (list.length !== 16 || list.some((c) => !/^\d{4}$/.test(c))) throw Error('16 cards of four digits'); return { cards }; },
  source: puzzleSource,
  run({ cards }, t) {
    const list = cards.split(/[\s,]+/).filter(Boolean);
    const N = 4;
    const view = t.board('board', N, { label: 'board (sides top right bottom left)' });
    const left = t.array('cards', list, { label: 'cards' });
    const board = Array.from({ length: N }, () => Array(N).fill(null));
    const used = new Set();
    const rot = (s, r) => s.slice(r) + s.slice(0, r);
    const fits = (i, j, s) => {
      const [tp, r, b, l] = s.split('').map(Number);
      if (i === 0 ? tp !== 0 : (tp === 0 || tp !== Number(board[i - 1][j].s[2]))) return false;
      if (j === 0 ? l !== 0 : (l === 0 || l !== Number(board[i][j - 1].s[1]))) return false;
      if (j === N - 1 ? r !== 0 : r === 0) return false;
      return i === N - 1 ? b === 0 : b !== 0;
    };
    let tries = 0;
    const place = (cell) => {
      if (cell === N * N) return true;
      const i = Math.floor(cell / N), j = cell % N;
      for (const [k, c] of list.entries()) {
        if (used.has(k)) continue;
        for (let turn = 0; turn < 4; turn++) {
          const s = rot(c, turn);
          tries++;
          if (!fits(i, j, s)) continue;
          board[i][j] = { c, s }; used.add(k); view.set(i, j, s); t.mark('cards', k, 'done');
          t.step(`Cell (${i}, ${j}): card ${c}${turn ? `, turned ${turn}×` : ''} fits (${s.split('').join(' ')})`, { line: qAt('board[i][j] = card;'), vars: { cell, card: c, turn, tries }, marks: { board: { [`${i},${j}`]: 'current' }, cards: { [k]: 'current' } } });
          if (place(cell + 1)) return true;
          board[i][j] = null; used.delete(k); view.set(i, j, ''); t.mark('cards', k, null);
          t.step(`Card ${c} at (${i}, ${j}) leads nowhere: undo`, { line: qAt('board[i][j] = null;'), vars: { cell, card: c, tries }, marks: { board: { [`${i},${j}`]: 'error' } } });
        }
      }
      return false;
    };
    void left;
    t.step('Fill the cells row by row', { line: qAt('return place(board, cards, 0)') });
    const ok = place(0);
    t.step(ok ? `Solved after ${tries} tries` : 'No arrangement works', { line: qAt('if (cell == PUZZLE_DIMENSION * PUZZLE_DIMENSION) return true'), vars: { tries } });
    return ok ? board.map((r) => r.map((x) => x.c).join(' ')) : null;
  },
};
