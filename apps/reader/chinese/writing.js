// Writing practice over a deck (docs/CHINESE-INPUT.md §12 phase 6): every character of the
// deck's Chinese cards written stroke by stroke with practise() (the pen, a finger or the
// mouse), one after another, with the HSK levels to practise as chips. Missed characters come
// back once at the end; the result is kept in the practice log (practice.js).
//   writingPractice(host, { cards, onExit }) → { destroy }
import { deckHanzi, levelsIn, levelLabel } from './vocab.js';
import { practise } from './practice.js';
import { toneOf } from './lookup-panel.js';

export function writingPractice(host, { cards = [], onExit = null } = {}) {
  const el = (tag, cls = '', t = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (t) e.textContent = t; return e; };
  const root = el('div', 'zh-writing');
  host.replaceChildren(root);
  const present = levelsIn(cards);
  const levels = new Set(present);
  let queue = [], done = 0, clean = 0, again = new Set(), drill = null, timer = 0;
  const chips = el('div', 'zh-vocab-levels');
  if (present.length > 1) {
    chips.append(el('span', 'muted', 'Levels'));
    for (const l of present) {
      const b = el('button', 'chip', l ? levelLabel(l) : 'No level');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'true');
      b.onclick = () => { levels.has(l) ? levels.delete(l) : levels.add(l); b.setAttribute('aria-pressed', String(levels.has(l))); start(); };
      chips.append(b);
    }
  }
  const progress = el('p', 'muted zh-writing-progress');
  const prompt = el('div', 'zh-writing-prompt');
  const stage = el('div', 'zh-writing-stage');
  const hint = el('button', '', 'Hint'), skip = el('button', '', 'Skip'), restart = el('button', '', 'Start again'), exit = el('button', '', 'Back to the cards');
  for (const b of [hint, skip, restart, exit]) b.type = 'button';
  const bar = el('div', 'ocr-actions');
  bar.append(hint, skip, el('span', 'spacer'), restart, exit);
  root.append(chips, progress, prompt, stage, bar);

  function start() {
    queue = deckHanzi(cards, { levels: [...levels] });
    done = 0; clean = 0; again = new Set();
    next();
  }
  function next() {
    clearTimeout(timer);
    drill?.destroy(); drill = null;
    const c = queue[0];
    hint.disabled = skip.disabled = !c;
    if (!c) {
      prompt.replaceChildren(el('strong', '', done ? `Done: ${clean} of ${done} written without a mistake.` : 'No Chinese characters at these levels.'));
      progress.textContent = '';
      stage.replaceChildren();
      return;
    }
    progress.textContent = `${done + 1} of ${done + queue.length}${again.size ? ` · ${again.size} again` : ''}`;
    const py = el('span', 'zh-lk-py');
    if (c.pinyin) py.append(el('span', `zh-t${toneOf(c.pinyin)}`, c.pinyin));
    // The pinyin and the word it comes from; the character itself only as the grey outline.
    prompt.replaceChildren(py, c.level ? el('span', 'zh-lk-level', levelLabel(c.level)) : '');
    drill = practise(stage, { char: c.char, size: Math.min(280, Math.max(180, (host.clientWidth || 320) - 40)), onDone: (r) => {
      const first = !again.has(c.char);
      if (r.mistakes > 2 && first) { again.add(c.char); queue.push(c); }
      else if (first && !r.mistakes) clean++;
      timer = setTimeout(() => { queue.shift(); done++; next(); }, 700);
    } });
    drill.ready.then((d) => { if (!d && queue[0] === c) { queue.shift(); next(); } });
  }
  hint.onclick = () => drill?.hint();
  skip.onclick = () => { queue.push(queue.shift()); next(); };
  restart.onclick = start;
  exit.onclick = () => { destroy(); onExit?.(); };
  function destroy() { clearTimeout(timer); drill?.destroy(); root.remove(); }
  start();
  return { destroy };
}
