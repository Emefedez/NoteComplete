// The character panel (docs/CHINESE-INPUT.md §8): a character or a word looked up from a
// right-click, a long press or a selection. A movable window on a computer, a bottom sheet on a
// phone. Header: the character, every reading in tone colours (the one used here first, "Use
// here" sets it for pinyin over characters), 🔊 when the system has a Chinese voice, and the
// stroke player with Practise. Then meanings, HSK level, forms, structure and words with it,
// each a link to its own look-up (← goes back), and the actions.
//   openLookup("好", { host, context: { reading, replace(text), setReading(pinyin) }, near })
// host: { status, script(), decks(), addCards(cards, { deckId, title }), insertFigure(spec) }.
import { openContextMenu } from '../context-menu.js';
import { icon } from '../icons.js';
import { zhWindow, modalHost } from './zh-window.js';
import { levelLabel, vocabCard, HAN } from './vocab.js';

const IDC = /[⿰-⿿]/u;
// How the parts sit (the first Ideographic Description Character of the decomposition).
const IDC_NAMES = { '⿰': 'left and right', '⿱': 'top and bottom', '⿲': 'left, middle and right', '⿳': 'top, middle and bottom', '⿴': 'enclosed', '⿵': 'open at the bottom', '⿶': 'open at the top', '⿷': 'open at the right', '⿸': 'from the top left', '⿹': 'from the top right', '⿺': 'from the bottom left', '⿻': 'overlaid' };
const ETYMOLOGY = { ideographic: 'Ideographic', pictographic: 'Pictographic', pictophonetic: 'Sound and meaning' };
export const toneOf = (syllable) => {
  const s = String(syllable).normalize('NFD');
  return /̄/.test(s) ? 1 : /́/.test(s) ? 2 : /̌/.test(s) ? 3 : /̀/.test(s) ? 4 : 5;
};
// The readings of the panel's header, the one used here first: [{ pinyin, here }].
export function readingsFor(result, here = '') {
  const list = result?.char?.readings?.length ? result.char.readings.map((r) => r.pinyin) : (result?.entries || []).map((e) => e.pinyin);
  const unique = [...new Set(list.filter(Boolean))];
  const h = String(here || '').trim();
  if (h && !unique.includes(h)) unique.unshift(h);
  return unique.sort((a, b) => (b === h) - (a === h)).map((pinyin) => ({ pinyin, here: !!h && pinyin === h }));
}
// Meanings grouped by reading: [{ pinyin, gloss: [..], level, forms: "妳" (another written form) }].
export function meaningsOf(result, text) {
  const out = [];
  for (const e of result?.entries || []) {
    const other = e.simp === text ? e.trad : e.simp;
    let row = out.find((r) => r.pinyin === e.pinyin);
    if (!row) out.push(row = { pinyin: e.pinyin, gloss: [], level: e.level || 0, forms: [] });
    for (const g of e.gloss || []) if (!row.gloss.includes(g)) row.gloss.push(g);
    if (other && other !== text && !row.forms.includes(other)) row.forms.push(other);
    if (e.level && (!row.level || e.level < row.level)) row.level = e.level;
  }
  return out;
}
// Simplified, traditional and other forms: [{ label, chars: [..] }].
export function formsOf(result, text) {
  const v = result?.char?.variants || {}, simp = new Set(), trad = new Set(), other = new Set();
  for (const e of result?.entries || []) { if (e.simp !== text) simp.add(e.simp); if (e.trad !== text) trad.add(e.trad); }
  for (const c of [...(v.simp || '')]) if (c !== text) simp.add(c);
  for (const c of [...(v.trad || '')]) if (c !== text) trad.add(c);
  for (const c of [...(v.other || '')]) if (c !== text && !simp.has(c) && !trad.has(c)) other.add(c);
  return [['Simplified', simp], ['Traditional', trad], ['Variants', other]].filter(([, s]) => s.size).map(([label, s]) => ({ label, chars: [...s] }));
}
export const lowestLevel = (result) => (result?.entries || []).reduce((l, e) => (e.level && (!l || e.level < l) ? e.level : l), 0);

let voices = null;
function zhVoice(script) {
  const synth = globalThis.speechSynthesis;
  if (!synth) return null;
  voices = synth.getVoices();
  const zh = voices.filter((v) => /^(zh|cmn)/i.test(v.lang));
  return zh.find((v) => (script === 'traditional' ? /TW|HK|Hant/i : /CN|Hans/i).test(v.lang)) || zh[0] || null;
}

let current = null;
export function closeLookup() { current?.close(); current = null; }

export function openLookup(text, { host = {}, context = {}, near = null } = {}) {
  text = String(text || '').trim();
  if (!text) return null;
  // One panel: reused, unless it is in another modal dialog than the one asked from.
  if (current && (current.el.closest('dialog') || null) !== modalHost(near)) closeLookup();
  if (current) { current.show(text, context, true); return current; }
  const win = zhWindow({ key: 'zh-lookup', title: `Look up ${text}`, width: 400, tall: 680, near, onClose: () => { players.forEach((p) => p.destroy?.()); current = null; } });
  win.el.classList.add('zh-lookup');
  const history = [];
  let players = [], shown = null, token = 0;
  const status = (msg, bad = false) => host.status?.(msg, bad);
  const script = () => host.script?.() || 'simplified';
  const say = (t) => {
    const v = zhVoice(script());
    if (!v) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.voice = v; u.lang = v.lang; u.rate = 0.8;
    speechSynthesis.speak(u);
  };
  const el = (tag, cls = '', textContent = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (textContent) e.textContent = textContent; return e; };
  const btn = (label, iconName, run, cls = '') => {
    const b = el('button', cls);
    b.type = 'button';
    if (iconName) b.append(icon(iconName));
    b.append(el('span', '', label));
    b.onclick = run;
    return b;
  };
  // A character or word that opens its own look-up.
  const link = (t, cls = 'zh-lk-link zh-cjk') => { const b = el('button', cls, t); b.type = 'button'; b.title = `Look up ${t}`; b.onclick = () => go(t); return b; };
  const syllables = (pinyin) => {
    const s = el('span', 'zh-lk-py');
    String(pinyin).split(/(\s+)/).forEach((p) => { if (!p.trim()) s.append(p); else s.append(el('span', `zh-t${toneOf(p)}`, p)); });
    return s;
  };
  const section = (title, open = true) => {
    const d = el('details', 'zh-lk-section');
    d.open = open;
    d.append(el('summary', '', title));
    return d;
  };
  function go(t) { if (shown) history.push(shown); show(t, {}, false); }

  async function show(t, ctx = {}, fresh = false) {
    if (fresh) history.length = 0;
    shown = { text: t, context: ctx };
    const mine = ++token;
    win.setTitle(`Look up ${t}`);
    players.forEach((p) => p.destroy?.());
    players = [];
    win.body.replaceChildren(el('p', 'muted', 'Looking up…'));
    win.foot.replaceChildren();
    let result;
    try {
      const { chinese } = await import('./client.js');
      result = await chinese().lookup(t, { script: script() });
    } catch (e) {
      if (mine === token) win.body.replaceChildren(el('p', 'muted', `The dictionary could not be loaded: ${e.message}`));
      return;
    }
    if (mine !== token) return;
    render(t, ctx, result);
  }

  function render(t, ctx, result) {
    const single = [...t].length === 1 && HAN.test(t);
    const readings = readingsFor(result, ctx.reading);
    const reading = readings[0]?.pinyin || '';
    const meanings = meaningsOf(result, t);
    const level = lowestLevel(result) || result.words?.find((w) => w.text === t)?.level || 0;
    const gloss = meanings.find((m) => m.pinyin === reading)?.gloss[0] || meanings[0]?.gloss[0] || '';
    const body = [];

    // ── Header ──
    const head = el('div', 'zh-lk-head');
    if (history.length) {
      const back = el('button', 'zh-lk-back');
      back.type = 'button'; back.title = `Back to ${history.at(-1).text}`; back.setAttribute('aria-label', back.title);
      back.append(icon('back'));
      back.onclick = () => { const h = history.pop(); show(h.text, h.context, false); };
      head.append(back);
    }
    const big = el('div', `zh-lk-char zh-cjk${[...t].length > 2 ? ' long' : ''}`, t);
    big.lang = script() === 'traditional' ? 'zh-Hant' : 'zh-Hans';
    const side = el('div', 'zh-lk-side');
    const list = el('div', 'zh-lk-readings');
    for (const r of readings) {
      const row = el('span', `zh-lk-reading${r.here ? ' here' : ''}`);
      row.append(syllables(r.pinyin));
      if (r.here && readings.length > 1 && ctx.reading) row.title = 'The reading used here';
      if (ctx.setReading && readings.length > 1 && !r.here) {
        const use = el('button', 'zh-lk-use', 'Use here');
        use.type = 'button';
        use.title = `Read ${t} as ${r.pinyin} here (pinyin over characters)`;
        use.onclick = async () => {
          try { await ctx.setReading(r.pinyin); status(`${t} reads ${r.pinyin} here.`); show(t, { ...ctx, reading: r.pinyin }); } catch (e) { status(e.message, true); }
        };
        row.append(use);
      }
      list.append(row);
    }
    if (!readings.length) list.append(el('span', 'muted', single ? 'Not in the dictionary' : 'No dictionary entry'));
    side.append(list);
    const facts = el('div', 'zh-lk-facts');
    if (level) facts.append(el('span', 'zh-lk-level', levelLabel(level)));
    if (result.char?.strokes) facts.append(el('span', 'muted', `${result.char.strokes} strokes`));
    if (zhVoice(script())) {
      const speak = el('button', 'zh-lk-say', '🔊');
      speak.type = 'button'; speak.title = 'Say it'; speak.setAttribute('aria-label', `Say ${t}`);
      speak.onclick = () => say(t);
      facts.append(speak);
    }
    side.append(facts);
    head.append(big, side);
    body.push(head);

    // ── Strokes: the player, or practice ──
    const han = [...t].filter((c) => HAN.test(c));
    if (han.length && han.length <= 6) {
      const box = el('div', 'zh-lk-strokes');
      const stage = el('div', 'zh-lk-stage');
      const bar = el('div', 'zh-lk-row');
      let practising = false;
      const practiseBtn = btn('Practise', 'draw', () => (practising ? player() : practice(0)));
      const showPlayer = () => {
        players.forEach((p) => p.destroy?.()); players = [];
        stage.replaceChildren();
        return import('./stroke-player.js').then(({ strokePlayer }) => {
          if (!stage.isConnected && stage.parentNode == null) return;
          const p = strokePlayer(stage, { text: han.join(''), size: han.length === 1 ? 132 : Math.max(72, Math.floor(300 / han.length)), autoplay: true });
          players.push(p);
          p.ready?.then?.(() => {
            if (!p.steps) {
              const ybBtn = btn(`Look up ${han[0]} on YellowBridge ↗`, 'search', () => window.open(`https://www.yellowbridge.com/chinese/character-stroke-order.php?word=${encodeURIComponent(han[0])}`, '_blank', 'noopener,noreferrer'));
              bar.append(ybBtn);
            }
          });
        }).catch(() => {
          stage.replaceChildren(el('p', 'muted', 'Stroke order could not be loaded.'));
          const ybBtn = btn(`Look up ${han[0]} on YellowBridge ↗`, 'search', () => window.open(`https://www.yellowbridge.com/chinese/character-stroke-order.php?word=${encodeURIComponent(han[0])}`, '_blank', 'noopener,noreferrer'));
          bar.append(ybBtn);
        });
      };
      function player() { practising = false; practiseBtn.querySelector('span').textContent = 'Practise'; showPlayer(); }
      function practice(i) {
        practising = true;
        practiseBtn.querySelector('span').textContent = 'Show strokes';
        players.forEach((p) => p.destroy?.()); players = [];
        stage.replaceChildren();
        import('./practice.js').then(({ practise }) => {
          const p = practise(stage, { char: han[i], size: 200, onDone: () => setTimeout(() => { if (practising && players.includes(p)) (i + 1 < han.length ? practice(i + 1) : player()); }, 900) });
          players.push(p);
        });
      }
      bar.append(practiseBtn);
      box.append(stage, bar);
      body.push(box);
      showPlayer();
    }

    // ── Meanings ──
    if (meanings.length) {
      const s = section('Meanings');
      const ol = el('ol', 'zh-lk-meanings');
      for (const m of meanings) {
        const li = el('li');
        li.append(syllables(m.pinyin), ' ', el('span', '', m.gloss.join('; ') || '—'));
        if (m.level) li.append(' ', el('span', 'zh-lk-level', levelLabel(m.level)));
        if (m.forms.length) { li.append(' '); for (const f of m.forms) li.append(link(f, 'zh-lk-link zh-cjk small')); }
        ol.append(li);
      }
      s.append(ol);
      if (result.char?.definition) s.append(el('p', 'muted zh-lk-def', result.char.definition));
      body.push(s);
    } else if (result.char?.definition) {
      const s = section('Meanings');
      s.append(el('p', 'zh-lk-def', result.char.definition));
      body.push(s);
    }
    // ── The characters of a word ──
    if (!single && han.length > 1) {
      const s = section('Characters');
      const row = el('div', 'zh-lk-chips');
      for (const c of [...new Set(han)]) row.append(link(c));
      s.append(row);
      body.push(s);
    }
    // ── Forms ──
    const forms = formsOf(result, t);
    if (forms.length) {
      const s = section('Forms');
      for (const f of forms) {
        const row = el('div', 'zh-lk-row');
        row.append(el('span', 'zh-lk-label', f.label));
        for (const c of f.chars) row.append(link(c));
        s.append(row);
      }
      body.push(s);
    }
    // ── Structure ──
    const c = result.char;
    if (c && (c.radical || c.decomposition || c.etymology)) {
      const s = section('Structure');
      if (c.radical?.char) {
        const row = el('div', 'zh-lk-row');
        row.append(el('span', 'zh-lk-label', 'Radical'), link(c.radical.char), el('span', 'muted', `No. ${c.radical.number}${c.radical.residual ? ` + ${c.radical.residual} strokes` : ''}`));
        s.append(row);
      }
      if (c.decomposition && c.decomposition !== t) {
        const row = el('div', 'zh-lk-row');
        row.append(el('span', 'zh-lk-label', 'Parts'));
        const layout = IDC_NAMES[[...c.decomposition][0]];
        for (const p of [...c.decomposition]) if (!IDC.test(p)) row.append(HAN.test(p) ? link(p) : el('span', 'muted', p));
        if (layout) row.append(el('span', 'muted', layout));
        s.append(row);
      }
      const e = c.etymology;
      if (e?.type) {
        const row = el('div', 'zh-lk-row');
        row.append(el('span', 'zh-lk-label', ETYMOLOGY[e.type] || e.type));
        if (e.type === 'pictophonetic' && (e.semantic || e.phonetic)) {
          if (e.semantic) row.append(link(e.semantic), el('span', 'muted', `meaning${e.hint ? ` (${e.hint})` : ''}`));
          if (e.phonetic) row.append(link(e.phonetic), el('span', 'muted', 'sound'));
        } else if (e.hint) row.append(el('span', '', e.hint));
        s.append(row);
      }
      body.push(s);
    }
    // ── Words with it (built when opened) ──
    if (result.words?.length) {
      const s = section(`Words with ${t} (${result.words.length})`, false);
      const fill = () => {
        if (s.dataset.filled) return;
        s.dataset.filled = '1';
        const ul = el('ul', 'zh-lk-words');
        for (const w of result.words) {
          const li = el('li');
          li.append(link(w.text), syllables(w.pinyin), el('span', 'zh-lk-gloss', w.gloss || ''));
          if (w.level) li.append(el('span', 'zh-lk-level', levelLabel(w.level)));
          ul.append(li);
        }
        s.append(ul);
      };
      s.addEventListener('toggle', fill);
      body.push(s);
    }
    win.body.replaceChildren(...body);

    // ── Actions ──
    const copy = (value, what) => navigator.clipboard?.writeText(value).then(() => status(`Copied ${what}.`), () => status('Could not copy.', true));
    const actions = [
      btn('Copy', 'copy', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openContextMenu(r.left, r.top - 4, [
          { label: t, icon: 'copy', run: () => copy(t, t) },
          reading && { label: `${t} (${reading})`, icon: 'copy', run: () => copy(`${t} (${reading})`, `${t} with pinyin`) },
          reading && { label: reading, icon: 'copy', run: () => copy(reading, 'the pinyin') },
        ].filter(Boolean), { title: 'Copy', host: win.el.closest('dialog') });
      }),
      host.addCards && btn('Flashcard', 'cards', (e) => addCard(e.currentTarget, { hanzi: t, pinyin: reading, gloss, level })),
    ];
    if (ctx.replace) actions.push(convertHere(t, ctx));
    if (host.insertFigure && han.length && han.length <= 12) actions.push(btn('Stroke figure', 'graph', async () => {
      try { await host.insertFigure({ type: 'hanzi', module: 'hanzi', text: han.join(''), pinyin: reading, show: 'strokes', grid: 'mi' }); } catch (e) { status(e.message, true); }
    }));
    if (reading) actions.push(btn('My words', 'plus', async () => {
      try { const { chinese } = await import('./client.js'); await chinese().addWord(t, reading); status(`${t} (${reading}) added to your words: Chinese input offers it first.`); } catch (e) { status(e.message, true); }
    }));
    win.foot.replaceChildren(...actions.filter(Boolean));
    win.foot.classList.add('zh-lk-actions');
  }
  // Convert here: the occurrence to its other form, when it has one.
  function convertHere(t, ctx) {
    const b = btn('Convert here', 'swap', async () => {
      if (!b.dataset.to) return;
      try { await ctx.replace(b.dataset.to); status(`${t} → ${b.dataset.to}.`); ctx.replace = null; show(b.dataset.to, { ...ctx, replace: null }); } catch (e) { status(e.message, true); }
    });
    b.hidden = true;
    import('./client.js').then(async ({ chinese }) => {
      const [tr, si] = await Promise.all([chinese().convert(t, 's2t'), chinese().convert(t, 't2s')]);
      const to = tr !== t ? tr : si !== t ? si : '';
      if (!to) return;
      b.dataset.to = to;
      b.querySelector('span').textContent = `Convert here to ${to}`;
      b.title = `${tr !== t ? 'Traditional' : 'Simplified'}: replace ${t} with ${to} in this place`;
      b.hidden = false;
    }).catch(() => {});
    return b;
  }
  async function addCard(anchor, word) {
    const card = vocabCard(word);
    const decks = await host.decks?.().catch(() => []) || [];
    const add = async (opts) => {
      try { const d = await host.addCards([card], opts); status(`${word.hanzi} added to “${d.title}” (${d.cards.length} cards).`); } catch (e) { status(e.message, true); }
    };
    const r = anchor.getBoundingClientRect();
    openContextMenu(r.left, r.top - 4, [
      { label: 'New deck “Chinese vocabulary”', icon: 'plus', run: () => add({ title: 'Chinese vocabulary' }) },
      decks.length && '-',
      ...decks.slice(0, 12).map((d) => ({ label: `${d.title} (${d.count})`, icon: 'cards', run: () => add({ deckId: d.id }) })),
    ].filter(Boolean), { title: 'Add to flashcards', host: win.el.closest('dialog') });
  }

  current = { close: () => win.close(), show, el: win.el };
  show(text, context, true);
  if (globalThis.speechSynthesis && !voices?.length) speechSynthesis.addEventListener?.('voiceschanged', () => { if (current && shown) show(shown.text, shown.context, false); }, { once: true });
  return current;
}
