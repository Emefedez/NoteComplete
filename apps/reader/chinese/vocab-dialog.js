// "Make vocabulary cards" (docs/CHINESE-INPUT.md §10): every word of a Chinese text as a card,
// front 汉字, back "pinyin — meaning · HSK n" (vocab.js), with the words to keep ticked and the
// HSK levels to keep as chips, into a new deck or one of the note's decks (study.js).
//   vocabDialog(text, { host: { status, decks(), addCards(cards, opts), openDeck(deck) }, near })
import { zhWindow } from './zh-window.js';
import { vocabWords, vocabCard, levelLabel, LEVELS } from './vocab.js';
import { toneOf } from './lookup-panel.js';

const MAX_WORDS = 400;
const levelOf = (w) => Math.min(w.level || 0, 7);

export async function vocabDialog(text, { host = {}, near = null } = {}) {
  const status = (m, bad = false) => host.status?.(m, bad);
  const win = zhWindow({ key: 'zh-vocab', title: 'Vocabulary cards', width: 440, near });
  win.el.classList.add('zh-vocab');
  const el = (tag, cls = '', t = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (t) e.textContent = t; return e; };
  win.body.append(el('p', 'muted', 'Reading the words…'));
  let words;
  try {
    const { chinese } = await import('./client.js');
    const { zhSettings } = await import('./settings.js');
    const script = (await import('./ruby.js')).noteChinese().script || zhSettings().script;
    const runs = await chinese().annotate(text, { script });
    const unique = [...new Set(runs.map((r) => r.text))].slice(0, MAX_WORDS);
    const lookups = new Map();
    for (let i = 0; i < unique.length; i += 24) {
      const part = unique.slice(i, i + 24);
      (await Promise.all(part.map((w) => chinese().lookup(w, { script }).catch(() => null)))).forEach((r, k) => lookups.set(part[k], r));
    }
    words = vocabWords(runs, lookups);
  } catch (e) {
    win.body.replaceChildren(el('p', 'muted', `The dictionary could not be loaded: ${e.message}`));
    return;
  }
  if (!words.length) { win.body.replaceChildren(el('p', 'muted', 'No Chinese words in this text.')); return; }

  const keep = new Set(words.map((w) => w.hanzi)), levels = new Set(words.map(levelOf));
  const present = [...LEVELS, 0].filter((l) => words.some((w) => levelOf(w) === l));
  const chips = el('div', 'zh-vocab-levels');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'HSK levels to keep');
  chips.append(el('span', 'muted', 'Levels'));
  for (const l of present) {
    const b = el('button', 'chip', l ? levelLabel(l) : 'No level');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'true');
    b.title = `${words.filter((w) => levelOf(w) === l).length} words`;
    b.onclick = () => { levels.has(l) ? levels.delete(l) : levels.add(l); b.setAttribute('aria-pressed', String(levels.has(l))); draw(); };
    chips.append(b);
  }
  const list = el('ul', 'zh-vocab-list');
  const deckRow = el('div', 'zh-vocab-deck');
  const deckSel = el('select');
  deckSel.setAttribute('aria-label', 'Deck');
  deckSel.append(new Option('New deck', ''));
  for (const d of await host.decks?.().catch(() => []) || []) deckSel.append(new Option(`${d.title} (${d.count})`, d.id));
  const title = el('input');
  Object.assign(title, { type: 'text', value: 'Chinese vocabulary', placeholder: 'Deck name' });
  title.setAttribute('aria-label', 'New deck name');
  deckSel.onchange = () => { title.hidden = !!deckSel.value; };
  deckRow.append(el('span', 'muted', 'Into'), deckSel, title);
  win.body.replaceChildren(chips, list, deckRow);

  const count = el('span', 'muted zh-vocab-count');
  const cancel = Object.assign(el('button', '', 'Cancel'), { type: 'button', onclick: () => win.close() });
  const make = Object.assign(el('button', 'primary', 'Make cards'), { type: 'button' });
  win.foot.append(count, el('span', 'spacer'), cancel, make);
  const chosen = () => words.filter((w) => levels.has(levelOf(w)) && keep.has(w.hanzi));
  function draw() {
    list.replaceChildren(...words.filter((w) => levels.has(levelOf(w))).map((w) => {
      const li = el('li');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = keep.has(w.hanzi);
      box.setAttribute('aria-label', `Keep ${w.hanzi}`);
      box.onchange = () => { box.checked ? keep.add(w.hanzi) : keep.delete(w.hanzi); sum(); };
      const label = el('label');
      const py = el('span', 'zh-lk-py');
      for (const s of w.pinyin.split(/\s+/).filter(Boolean)) py.append(el('span', `zh-t${toneOf(s)}`, s), ' ');
      label.append(box, el('span', 'zh-cjk zh-vocab-han', w.hanzi), py, el('span', 'zh-lk-gloss', w.gloss));
      if (w.level) label.append(el('span', 'zh-lk-level', levelLabel(w.level)));
      li.append(label);
      return li;
    }));
    sum();
  }
  function sum() { const n = chosen().length; count.textContent = `${n} of ${words.length} words`; make.textContent = `Make ${n} card${n === 1 ? '' : 's'}`; make.disabled = !n; }
  make.onclick = async () => {
    const cards = chosen().map(vocabCard);
    try {
      const d = await host.addCards(cards, deckSel.value ? { deckId: deckSel.value } : { title: title.value.trim() || 'Chinese vocabulary' });
      win.close();
      status(`${cards.length} vocabulary card${cards.length === 1 ? '' : 's'} in “${d.title}”.`);
      host.openDeck?.(d);
    } catch (e) { status(e.message, true); }
  };
  draw();
  make.focus();
}
