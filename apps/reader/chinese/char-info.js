// The parts of a character's look-up shared by the character panel (lookup-panel.js) and the
// stroke order window (prefabs/hanzi/editor.js): pinyin whose syllables play their tone, the
// listen button, the favourite star, and the rows of Forms and Structure. `link(t)` makes the
// element that opens `t` (the panel looks it up, the stroke window traces it).
import { icon } from '../icons.js';
import { speak, speakSyllable, canSpeak } from './speech.js';
import { HAN } from './vocab.js';

const IDC = /[⿰-⿿]/u;
// How the parts sit (the first Ideographic Description Character of the decomposition).
const IDC_NAMES = { '⿰': 'left and right', '⿱': 'top and bottom', '⿲': 'left, middle and right', '⿳': 'top, middle and bottom', '⿴': 'enclosed', '⿵': 'open at the bottom', '⿶': 'open at the top', '⿷': 'open at the right', '⿸': 'from the top left', '⿹': 'from the top right', '⿺': 'from the bottom left', '⿻': 'overlaid' };
const ETYMOLOGY = { ideographic: 'Ideographic', pictographic: 'Pictographic', pictophonetic: 'Sound and meaning' };

export const toneOf = (syllable) => {
  const s = String(syllable).normalize('NFD');
  return /̄/.test(s) ? 1 : /́/.test(s) ? 2 : /̌/.test(s) ? 3 : /̀/.test(s) ? 4 : 5;
};
export const el = (tag, cls = '', textContent = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (textContent) e.textContent = textContent; return e; };

// say(text, { reading, button, slow, syllable }): plays it (one character: in its reading),
// lighting `button` while it plays; `status(message, bad)` when it cannot.
export function sayer({ script = () => 'simplified', status = () => {} } = {}) {
  return (t, { reading = '', button = null, slow = false, syllable = false } = {}) => {
    const opts = { script: script(), slow, onState: (on) => button?.classList.toggle('playing', on) };
    const run = syllable ? speakSyllable(reading, { ...opts, fallback: t }) : speak(t, { ...opts, reading });
    run.then((ok) => { if (!ok) status(navigator.onLine === false ? 'Offline, and the system has no Chinese voice.' : 'The pronunciation could not be played.', true); });
  };
}
// The 🔊 button for `t` (Shift: slower), or null where nothing can speak Chinese.
export function listenButton(t, say, { reading = '', script = 'simplified', small = false } = {}) {
  if (!canSpeak(script)) return null;
  const b = el('button', `zh-lk-say${small ? ' small' : ''}`);
  b.type = 'button';
  b.title = `Listen to ${t} · Shift: slower`;
  b.setAttribute('aria-label', b.title);
  b.append(icon('speaker'));
  b.onclick = (e) => say(t, { reading, button: b, slow: e.shiftKey });
  return b;
}
// Pinyin in tone colours; each syllable plays its tone when clicked (`chars`: the characters it
// reads, spoken instead when there is no recording of that syllable).
export function syllables(pinyin, chars, say) {
  const s = el('span', 'zh-lk-py');
  const han = [...chars].filter((c) => HAN.test(c));
  const count = String(pinyin).trim().split(/\s+/).length;
  let k = 0;
  String(pinyin).split(/(\s+)/).forEach((p) => {
    if (!p.trim()) { s.append(p); return; }
    const b = el('button', `zh-lk-syl zh-t${toneOf(p)}`, p);
    const ch = han.length === count ? han[k] : (han.length === 1 ? han[0] : '');
    k++;
    b.type = 'button';
    b.title = `Listen to ${p}${toneOf(p) < 5 ? ` (tone ${toneOf(p)})` : ''} · Shift-click: slower`;
    b.onclick = (e) => { e.stopPropagation(); say(ch || '', { reading: p, button: b, slow: e.shiftKey, syllable: true }); };
    s.append(b);
  });
  return s;
}
// The ☆ / ★ of `t`: a favourite comes first among Chinese input's candidates when it fits what
// is typed (client.js). `onChange(on)` after a click.
export function favouriteButton(t, { reading = '', status = () => {}, onChange = null } = {}) {
  const b = el('button', 'zh-fav');
  b.type = 'button';
  b.append(icon('star'));
  const paint = (on) => {
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? `${t} is a favourite: Chinese input offers it first (click to remove)` : `Add ${t} to favourites: Chinese input offers it first`;
    b.setAttribute('aria-label', b.title);
  };
  paint(false);
  const client = () => import('./client.js').then(({ chinese }) => chinese());
  client().then((zh) => zh.isFavourite(t)).then(paint, () => { b.hidden = true; });
  b.onclick = async () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    try {
      await (await client()).setFavourite(t, on, reading);
      paint(on);
      status(on ? `${t} is a favourite: Chinese input offers it first.` : `${t} is no longer a favourite.`);
      onChange?.(on);
    } catch (e) { status(e.message, true); }
  };
  return b;
}

// Simplified, traditional and other forms ([{ label, chars }], lookup-panel.js formsOf): a row each.
export function formRows(forms, link) {
  return forms.map((f) => {
    const row = el('div', 'zh-lk-row');
    row.append(el('span', 'zh-lk-label', f.label), ...f.chars.map((c) => link(c)));
    return row;
  });
}
// The radical, the parts and how the character was made (`c`: a look-up's `char`): rows, or [].
export function structureRows(c, link) {
  if (!c) return [];
  const rows = [];
  if (c.radical?.char) {
    const row = el('div', 'zh-lk-row');
    row.append(el('span', 'zh-lk-label', 'Radical'), link(c.radical.char), el('span', 'muted', `No. ${c.radical.number}${c.radical.residual ? ` + ${c.radical.residual} strokes` : ''}`));
    rows.push(row);
  }
  if (c.decomposition && c.decomposition !== c.char) {
    const row = el('div', 'zh-lk-row');
    row.append(el('span', 'zh-lk-label', 'Parts'));
    for (const p of [...c.decomposition]) if (!IDC.test(p)) row.append(HAN.test(p) ? link(p) : el('span', 'muted', p));
    const layout = IDC_NAMES[[...c.decomposition][0]];
    if (layout) row.append(el('span', 'muted', layout));
    rows.push(row);
  }
  const e = c.etymology;
  if (e?.type) {
    const row = el('div', 'zh-lk-row');
    row.append(el('span', 'zh-lk-label', ETYMOLOGY[e.type] || e.type));
    if (e.type === 'pictophonetic' && (e.semantic || e.phonetic)) {
      if (e.semantic) row.append(link(e.semantic), el('span', 'muted', `meaning${e.hint ? ` (${e.hint})` : ''}`));
      if (e.phonetic) row.append(link(e.phonetic), el('span', 'muted', 'sound'));
    } else if (e.hint) row.append(el('span', '', e.hint));
    rows.push(row);
  }
  return rows;
}
