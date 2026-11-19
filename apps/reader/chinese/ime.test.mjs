import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { imeReduce, imeInitial, nextMode } from './ime.js';

// Feeds keys; candidates for an input come from `dict` as soon as they are asked for.
function run(mode, keys, { dict = {}, opts = {}, lineBefore = '' } = {}) {
  let s = imeInitial(mode, opts);
  const out = { text: '', handled: [], passed: [], learned: [] };
  const step = (k) => {
    const r = imeReduce(s, k);
    s = r.state;
    if (r.commit) out.text += r.commit;
    if (r.learn) out.learned.push(r.learn.item.text);
    if (k.key != null) (r.handled ? out.handled : out.passed).push(k.key);
    if (r.pass && k.key?.length === 1) out.text += k.key;
    else if (!r.handled && !r.commit && k.key?.length === 1 && !r.wait) out.text += k.key;
    if (r.query != null) {
      const items = dict[r.query];
      if (items) step({ type: 'cands', input: r.query, items });
    }
    if (r.wait) { const items = dict[s.buffer] || []; step({ type: 'cands', input: s.buffer, items }); step(k); }
    return r;
  };
  for (const k of keys) step(typeof k === 'string' ? { key: k, lineBefore } : { lineBefore, ...k });
  return { ...out, state: s };
}
const keys = (str) => [...str];
const it = (text, pinyin, consumed) => ({ text, pinyin, consumed, level: 1, gloss: '' });
const DICT = {
  n: [it('你', 'nǐ', 1)],
  ni: [it('你', 'nǐ', 2), it('呢', 'ne', 2)],
  nih: [it('你好', 'nǐ hǎo', 3), it('你', 'nǐ', 2)],
  niha: [it('你好', 'nǐ hǎo', 4), it('你', 'nǐ', 2)],
  nihao: [it('你好', 'nǐ hǎo', 5), it('你', 'nǐ', 2), it('尼', 'ní', 2)],
  hao: [it('好', 'hǎo', 3), it('号', 'hào', 3)],
  ma3: [it('马', 'mǎ', 3), it('码', 'mǎ', 3)],
};

test('pinyin mode: tone digits give marks as you type', () => {
  assert.equal(run('pinyin', keys('ni3hao3')).text, 'nǐhǎo');
  assert.equal(run('pinyin', keys('Zhong1guo2')).text, 'Zhōngguó');
  assert.equal(run('pinyin', keys('lv4')).text, 'lǜ');
  assert.equal(run('pinyin', keys('ni3 hao3')).text, 'nǐ hǎo');
  // No tone: the letters as typed, and the space stays.
  assert.equal(run('pinyin', keys('nihao ')).text, 'nihao ');
  // Enter writes what is in the buffer without a new line.
  const r = run('pinyin', [...keys('hao'), 'Enter']);
  assert.equal(r.text, 'hao');
  assert.ok(r.handled.includes('Enter'));
});

test('pinyin mode works with no dictionary at all', () => {
  const r = run('pinyin', keys('ma1ma'));
  assert.equal(r.state.buffer, 'ma');
  assert.equal(r.text, 'mā');
});

test('hanzi mode: Space chooses the first candidate; numbers choose', () => {
  assert.equal(run('hanzi', keys('nihao ' ), { dict: DICT }).text, '你好');
  assert.equal(run('hanzi', [...keys('nihao'), '9'], { dict: { nihao: Array.from({ length: 9 }, (_, i) => it('字' + i, 'zì', 5)) } }).text, '字8');
  // A digit right after pinyin is a tone filter.
  const t = run('hanzi', [...keys('ma3'), ' '], { dict: DICT });
  assert.equal(t.text, '马');
  // …or chooses, when set so.
  assert.equal(run('hanzi', [...keys('nihao'), '2', ' '], { dict: DICT, opts: { digits: 'choose' } }).text, '你好');
});

test('candidates that come later: the key waits for them', () => {
  let s = imeInitial('hanzi');
  for (const k of 'hao') s = imeReduce(s, { key: k }).state;
  const r = imeReduce(s, { key: ' ' });
  assert.equal(r.wait, true);
  assert.equal(r.handled, true);
  s = imeReduce(r.state, { type: 'cands', input: 'hao', items: DICT.hao }).state;
  assert.equal(imeReduce(s, { key: ' ' }).commit, '好');
  // Stale answers are dropped.
  assert.equal(imeReduce(s, { type: 'cands', input: 'ha', items: [] }).state.cands.input, 'hao');
});

test('a partial choice consumes its syllables; Backspace undoes it', () => {
  const r = run('hanzi', [...keys('nihao'), '2'], { dict: DICT, opts: { digits: 'choose' } });
  assert.equal(r.text, ''); // 你 consumed "ni"; it waits for the rest
  assert.equal(r.state.buffer, 'hao');
  const p = run('hanzi', [...keys('nihao'), 'ArrowRight', ' '], { dict: DICT });
  assert.equal(p.text, '');
  assert.equal(p.state.buffer, 'hao');
  assert.deepEqual(p.state.chosen.map((c) => c.text), ['你']);
  const done = run('hanzi', [...keys('nihao'), 'ArrowRight', ' ', ' '], { dict: DICT });
  assert.equal(done.text, '你好');
  const undo = run('hanzi', [...keys('nihao'), 'ArrowRight', ' ', 'Backspace'], { dict: DICT });
  assert.equal(undo.state.buffer, 'nihao');
  assert.deepEqual(undo.state.chosen, []);
  const letter = run('hanzi', [...keys('nihao'), 'Backspace'], { dict: DICT });
  assert.equal(letter.state.buffer, 'niha');
});

test('Esc clears the buffer and never reaches the text box', () => {
  const r = run('hanzi', [...keys('nihao'), 'Escape'], { dict: DICT });
  assert.equal(r.state.buffer, '');
  assert.equal(r.text, '');
  assert.ok(r.handled.includes('Escape'));
  // With nothing typed, Esc is the text box's.
  assert.ok(run('hanzi', ['Escape']).passed.includes('Escape'));
});

test('Enter: Auto follows the text before the caret; Shift+Enter writes the letters', () => {
  assert.equal(run('hanzi', [...keys('nihao'), 'Enter'], { dict: DICT }).text, 'nihao');
  assert.equal(run('hanzi', [...keys('nihao'), 'Enter'], { dict: DICT, lineBefore: 'Wǒ shì ' }).text, 'nǐhǎo');
  assert.equal(run('hanzi', [...keys('nihao'), { key: 'Enter', shift: true }], { dict: DICT, lineBefore: 'Wǒ shì ' }).text, 'nihao');
  assert.equal(run('hanzi', [...keys('nihao'), 'Enter'], { dict: DICT, opts: { enter: 'marks' } }).text, 'nǐhǎo');
  assert.equal(run('hanzi', [...keys('nihao'), 'Enter'], { dict: DICT, opts: { enter: 'letters' }, lineBefore: 'nǐ' }).text, 'nihao');
});

test('full-width punctuation in Hanzi mode', () => {
  assert.equal(run('hanzi', keys('nihao?'), { dict: DICT }).text, '你好？');
  assert.equal(run('hanzi', [...keys('nihao '), ',', '\\'], { dict: DICT }).text, '你好，、');
  assert.equal(run('hanzi', ['!'], { opts: { fullWidth: false } }).text, '!');
});

test('paging and the highlight', () => {
  const many = { a: Array.from({ length: 20 }, (_, i) => it('字' + i, 'a', 1)) };
  let r = run('hanzi', ['a', '=', '='], { dict: many, opts: { perPage: 9 } });
  assert.equal(r.state.page, 2);
  r = run('hanzi', ['a', 'PageDown', '1'], { dict: many, opts: { perPage: 9 } });
  assert.equal(r.text, '字9');
  r = run('hanzi', ['a', 'Tab', 'Tab', ' '], { dict: many });
  assert.equal(r.text, '字2');
});

test('shortcuts pass; composition and Latin stand down', () => {
  const r = run('hanzi', ['a', { key: 'c', ctrl: true }], { dict: { a: [it('啊', 'a', 1)] } });
  assert.equal(r.text, 'a');      // the buffer is written, then the shortcut runs
  assert.ok(r.passed.includes('c'));
  let s = imeReduce(imeInitial('hanzi'), { type: 'composition', active: true }).state;
  assert.equal(imeReduce(s, { key: 'n' }).handled, undefined);
  assert.equal(imeReduce(imeInitial('hanzi'), { key: 'n', composing: true }).handled, undefined);
  s = imeReduce(imeInitial('hanzi'), { type: 'latin' }).state;
  assert.equal(s.latin, true);
  assert.equal(imeReduce(s, { key: 'n' }).handled, undefined);
  assert.equal(imeReduce(imeInitial('off'), { key: 'n' }).handled, undefined);
  // A capital first letter in Hanzi mode is Latin.
  assert.equal(imeReduce(imeInitial('hanzi'), { key: 'N' }).handled, undefined);
});

test('the mode cycles Off → Hanzi → Pinyin → Off and writes what was typed', () => {
  assert.equal(nextMode('off'), 'hanzi');
  assert.equal(nextMode('hanzi'), 'pinyin');
  assert.equal(nextMode('pinyin'), 'off');
  let s = imeReduce(imeInitial('hanzi'), { key: 'n' }).state;
  const r = imeReduce(s, { type: 'mode', mode: 'pinyin' });
  assert.equal(r.commit, 'n');
  assert.equal(r.state.buffer, '');
});

// Space held in Hanzi mode: it chooses on release; Space+digit picks candidate n.
function chord(events, { dict = DICT, opts = {} } = {}) {
  let s = imeInitial('hanzi', opts), text = '';
  const step = (k) => {
    const r = imeReduce(s, k);
    s = r.state;
    if (r.commit) text += r.commit;
    if (r.query != null && dict[r.query]) step({ type: 'cands', input: r.query, items: dict[r.query] });
    if (r.wait) { step({ type: 'cands', input: s.buffer, items: dict[s.buffer] || [] }); step(k); }
    return r;
  };
  const results = events.map((e) => step(typeof e === 'string' ? (e === 'v' ? { type: 'spaceDown' } : e === '^' ? { type: 'spaceUp' } : { key: e }) : e));
  return { text, state: s, results };
}
const seq = (str) => [...str].map((c) => c);
const MANY = { ...DICT, nihao: [it('你好', 'nǐ hǎo', 5), it('你', 'nǐ', 2), it('尼', 'ní', 2), it('泥', 'ní', 2)], hao: [it('好', 'hǎo', 3), it('号', 'hào', 3), it('毫', 'háo', 3)] };

test('Space tap commits the first candidate on release', () => {
  const r = chord([...seq('nihao'), 'v']);
  assert.equal(r.text, '');            // nothing until Space comes up
  assert.equal(r.state.spaceHeld, true);
  assert.equal(chord([...seq('nihao'), 'v', '^']).text, '你好');
});

test('Space+3 picks the third; the release commits nothing more', () => {
  const r = chord([...seq('nihao'), 'v', '3'], { dict: MANY });
  assert.equal(r.text, '');             // 尼 consumed "ni": kept, "hao" left
  assert.deepEqual(r.state.chosen.map((c) => c.text), ['尼']);
  const up = chord([...seq('nihao'), 'v', '3', '^'], { dict: MANY });
  assert.equal(up.text, '');
  assert.equal(up.state.buffer, 'hao');
  assert.equal(up.state.spaceHeld, false);
  // A whole-input pick: written at once, the release adds nothing.
  assert.equal(chord([...seq('nihao'), 'v', '1', '^'], { dict: MANY }).text, '你好');
});

test('Space+2 then Space+1 within one hold: successive partial choices', () => {
  const r = chord([...seq('nihao'), 'v', '2', '1', '^'], { dict: MANY });
  assert.equal(r.text, '你好');
  assert.equal(chord([...seq('nihao'), 'v', '2', '3', '^'], { dict: MANY }).text, '你毫');
});

test('a digit without Space is still a tone filter', () => {
  const r = chord([...seq('ma3')]);
  assert.equal(r.state.buffer, 'ma3');
  assert.equal(chord([...seq('ma3'), 'v', '^']).text, '马');
});

test('a repeated Space keydown does not commit twice', () => {
  const r = chord([...seq('nihao'), 'v', { type: 'spaceDown', repeat: true }, 'v', '^', '^'], { dict: MANY });
  assert.equal(r.text, '你好');
  assert.equal(r.results.filter((x) => x.commit).length, 1);
  // With nothing typed, Space is an ordinary space.
  assert.equal(imeReduce(imeInitial('hanzi'), { type: 'spaceDown' }).handled, undefined);
  // Pinyin mode keeps Space as it was.
  assert.equal(imeReduce(imeInitial('pinyin'), { type: 'spaceDown' }).handled, undefined);
});

test('a letter rolled over a held Space takes Space\'s choice first', () => {
  const r = chord([...seq('hao'), 'v', 'n', '^', 'i', ' '], { dict: MANY });
  assert.equal(r.text, '好你');
  assert.equal(chord([...seq('nihao'), 'v', { type: 'spaceCancel' }, '^']).text, '');
});

test('partial pick + Backspace emptying buffer never stalls Space or punctuation; comma/period commit directly', () => {
  // Partial pick '你' from 'nihao' leaves buffer='hao', typing 'h' clears justChose so 4 Backspaces empty buffer cleanly.
  const emptyBuf = run('hanzi', [...seq('nihao'), 'ArrowRight', ' ', 'h', 'Backspace', 'Backspace', 'Backspace', 'Backspace'], { dict: DICT });
  assert.equal(emptyBuf.state.buffer, '');
  assert.deepEqual(emptyBuf.state.chosen.map((c) => c.text), ['你']);
  // Space must immediately commit '你' without requiring a Latin character.
  const spaceOut = imeReduce(emptyBuf.state, { key: ' ' });
  assert.equal(spaceOut.wait, undefined);
  assert.equal(spaceOut.commit, '你');
  // Comma and period must commit immediately instead of paging candidates.
  assert.equal(run('hanzi', [...seq('ni'), ','], { dict: DICT }).text, '你，');
  assert.equal(run('hanzi', [...seq('ni'), '.'], { dict: DICT }).text, '你。');
  // spaceUp while waiting clears spaceHeld so a follow-up letter is not treated as a chord.
  let s = imeInitial('hanzi');
  for (const k of 'nihao') s = imeReduce(s, { key: k }).state;
  s = imeReduce(s, { type: 'spaceDown' }).state;
  const up = imeReduce(s, { type: 'spaceUp' });
  assert.equal(up.wait, true);
  assert.equal(up.state.spaceHeld, false);
  assert.equal(up.state.chord, false);
});

test('holding Space after a chord choice never leaks Space repeat or digits until Space is lifted', () => {
  // Type nihao, hold Space, press 1 (commits 你好), then Space key-repeats and another digit is pressed before Space is lifted
  const r = chord([...seq('nihao'), 'v', '1', { type: 'spaceDown', repeat: true }, '2', '3', '^'], { dict: MANY });
  assert.equal(r.text, '你好');
  assert.equal(r.state.spaceHeld, false);
  assert.equal(r.state.chord, false);
  // Every event after Space was held down must be handled (no leaked space or digit)
  assert.equal(r.results[6].handled, true); // spaceDown repeat
  assert.equal(r.results[7].handled, true); // '2' while spaceHeld
  assert.equal(r.results[8].handled, true); // '3' while spaceHeld
  // Once Space is lifted, digits are read normally again
  const afterLift = imeReduce(r.state, { key: '4' });
  assert.equal(afterLift.handled, undefined);
});
