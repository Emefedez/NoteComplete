// The character panel (docs/CHINESE-INPUT.md §8): a character or a word looked up from a
// right-click, a long press or a selection. A movable window on a computer, a bottom sheet on a
// phone. Header: the character, every reading in tone colours (the one used here first, "Use
// here" sets it for pinyin over characters), 🔊 to hear it (S; Shift: slower; each syllable
// plays its own tone when clicked, chinese/speech.js streams the audio on demand), and the
// stroke player with Practise. Then meanings, HSK level, forms, structure and words with it,
// each a link to its own look-up (← goes back), and the actions.
//   openLookup("好", { host, context: { reading, replace(text), setReading(pinyin) }, near })
// host: { status, script(), decks(), addCards(cards, { deckId, title }), insertFigure(spec) }.
import { openContextMenu } from '../context-menu.js';
import { icon } from '../icons.js';
import { zhWindow, modalHost, langToggle } from './zh-window.js';
import { levelLabel, vocabCard, HAN } from './vocab.js';
import { stopSpeech, canSpeak } from './speech.js';
import { localizeLookup, zhLang } from './translate.js';
import { numbersToMarks } from './pinyin.js';

import { IDC, sayer, syllables as toneSyllables, formRows, structureRows } from './char-info.js';

export { toneOf } from './char-info.js';
// Crisp bilingual (en / es) meanings for common Kangxi radicals & component variants.
const COMPONENT_MEANINGS = {
  一: ['one', 'uno'], 二: ['two', 'dos'], 十: ['ten', 'diez'], 八: ['eight', 'ocho'],
  人: ['person', 'persona'], 亻: ['person', 'persona'], 儿: ['legs · child', 'piernas · niño'],
  入: ['enter', 'entrar'], 几: ['small table', 'mesa baja'], 冫: ['ice', 'hielo'],
  刀: ['knife', 'cuchillo'], 刂: ['knife', 'cuchillo'], 力: ['strength', 'fuerza'],
  勹: ['wrap', 'envolver'], '𠂊': ['wrap', 'envolver'], 匕: ['spoon', 'cuchara'],
  匚: ['box', 'caja'], 冂: ['border', 'límite'], 冖: ['cover', 'cubierta'],
  凵: ['container', 'recipiente'], 卜: ['divine', 'adivinar'], 卩: ['seal', 'sello'],
  厂: ['cliff', 'acantilado'], 厶: ['private', 'privado'], 又: ['right hand · again', 'mano · otra vez'],
  口: ['mouth', 'boca'], 囗: ['enclosure', 'recinto'], 土: ['earth', 'tierra'],
  士: ['scholar', 'erudito'], 夂: ['go', 'ir'], 夕: ['evening', 'tarde'],
  大: ['big', 'grande'], 女: ['woman', 'mujer'], 子: ['child', 'niño · hijo'],
  宀: ['roof', 'techo'], 寸: ['inch · hand', 'pulgada · mano'], 小: ['small', 'pequeño'],
  '⺍': ['little', 'pequeño'], 尸: ['body', 'cuerpo'], 山: ['mountain', 'montaña'],
  巛: ['river', 'río'], 工: ['work', 'trabajo'], 己: ['self', 'uno mismo'],
  巾: ['cloth', 'tela'], 干: ['dry · shield', 'seco · escudo'], 幺: ['tiny', 'diminuto'],
  广: ['shelter', 'refugio'], 廴: ['stride', 'zancada'], 廾: ['two hands', 'dos manos'],
  弓: ['bow', 'arco'], 彐: ['snout', 'hocico'], 彡: ['bristle', 'pelo'],
  彳: ['step', 'paso'], 心: ['heart', 'corazón'], 忄: ['heart', 'corazón'],
  戈: ['halberd', 'alabarda'], 户: ['door', 'puerta'], 手: ['hand', 'mano'],
  扌: ['hand', 'mano'], 支: ['branch', 'rama'], 攵: ['strike · tap', 'golpear'],
  文: ['writing', 'escritura'], 斗: ['dipper', 'cucharón'], 斤: ['axe', 'hacha'],
  方: ['square', 'cuadrado'], 日: ['sun · day', 'sol · día'], 曰: ['say', 'decir'],
  月: ['moon · flesh', 'luna · carne'], 木: ['tree · wood', 'árbol · madera'],
  欠: ['yawn · owe', 'bostezar · deber'], 止: ['stop · foot', 'parar · pie'],
  歹: ['death · bad', 'muerte · malo'], 殳: ['weapon', 'arma'], 毋: ['do not', 'no'],
  母: ['mother', 'madre'], 比: ['compare', 'comparar'], 毛: ['hair · fur', 'pelo'],
  氏: ['clan', 'clan'], 气: ['air · breath', 'aire · aliento'],
  水: ['water', 'agua'], 氵: ['water', 'agua'], 火: ['fire', 'fuego'], 灬: ['fire', 'fuego'],
  爪: ['claw', 'garra'], 爫: ['claw', 'garra'], 父: ['father', 'padre'],
  牛: ['ox · cow', 'buey · vaca'], 牜: ['ox · cow', 'buey · vaca'],
  犬: ['dog', 'perro'], 犭: ['animal · dog', 'animal · perro'],
  玉: ['jade', 'jade'], 王: ['king · jade', 'rey · jade'], 田: ['field', 'campo'],
  疒: ['sickness', 'enfermedad'], 白: ['white', 'blanco'], 皮: ['skin', 'piel'],
  皿: ['dish', 'plato'], 目: ['eye', 'ojo'], 矢: ['arrow', 'flecha'],
  石: ['stone', 'piedra'], 示: ['spirit · show', 'espíritu · mostrar'], 礻: ['spirit · altar', 'espíritu · altar'],
  禾: ['grain', 'grano'], 穴: ['cave', 'cueva'], 立: ['stand', 'estar de pie'],
  竹: ['bamboo', 'bambú'], '⺮': ['bamboo', 'bambú'], 米: ['rice', 'arroz'],
  糸: ['silk', 'seda'], 纟: ['silk', 'seda'], 网: ['net', 'red'], 罒: ['net', 'red'],
  羊: ['sheep', 'oveja'], 羽: ['feather', 'pluma'], 老: ['old', 'viejo'], 耂: ['old', 'viejo'],
  耳: ['ear', 'oído'], 肉: ['flesh · meat', 'carne'], 臣: ['minister', 'ministro'],
  自: ['self', 'uno mismo'], 至: ['arrive', 'llegar'], 舌: ['tongue', 'lengua'],
  舟: ['boat', 'barco'], 色: ['colour', 'color'], 艹: ['grass · plant', 'hierba · planta'],
  虫: ['insect', 'insecto'], 血: ['blood', 'sangre'], 行: ['walk · go', 'caminar · ir'],
  衣: ['clothes', 'ropa'], 衤: ['clothes', 'ropa'], 西: ['west', 'oeste'], 覀: ['cover · west', 'cubrir · oeste'],
  见: ['see', 'ver'], 見: ['see', 'ver'], 角: ['horn · corner', 'cuerno · esquina'],
  言: ['speech', 'habla'], 讠: ['speech', 'habla'], 谷: ['valley', 'valle'],
  豆: ['bean', 'frijol'], 豕: ['pig', 'cerdo'], 贝: ['shell · money', 'concha · dinero'], 貝: ['shell · money', 'concha · dinero'],
  赤: ['red', 'rojo'], 走: ['walk · run', 'caminar · correr'], 足: ['foot', 'pie'],
  身: ['body', 'cuerpo'], 车: ['vehicle', 'vehículo'], 車: ['vehicle', 'vehículo'],
  辛: ['bitter', 'amargo'], 辰: ['morning', 'mañana'], 辶: ['walk · road', 'caminar · camino'],
  邑: ['city', 'ciudad'], 阝: ['mound · city', 'colina · ciudad'], 酉: ['wine', 'vino'],
  里: ['village · mile', 'aldea'], 金: ['metal · gold', 'metal · oro'], 钅: ['metal · gold', 'metal · oro'],
  长: ['long', 'largo'], 長: ['long', 'largo'], 门: ['gate · door', 'puerta'], 門: ['gate · door', 'puerta'],
  阜: ['mound', 'colina'], 隹: ['bird', 'ave'], 雨: ['rain', 'lluvia'],
  青: ['green · blue', 'verde · azul'], 非: ['not', 'no'], 面: ['face', 'cara'],
  革: ['leather', 'cuero'], 音: ['sound', 'sonido'], 页: ['page · head', 'página · cabeza'], 頁: ['page · head', 'página · cabeza'],
  风: ['wind', 'viento'], 風: ['wind', 'viento'], 飞: ['fly', 'volar'], 飛: ['fly', 'volar'],
  食: ['food', 'comida'], 饣: ['food', 'comida'], 首: ['head', 'cabeza'],
  香: ['fragrant', 'fragante'], 马: ['horse', 'caballo'], 馬: ['horse', 'caballo'],
  骨: ['bone', 'hueso'], 高: ['tall', 'alto'], 鬼: ['ghost', 'fantasma'],
  鱼: ['fish', 'pez'], 魚: ['fish', 'pez'], 鸟: ['bird', 'pájaro'], 鳥: ['bird', 'pájaro'],
  鹿: ['deer', 'ciervo'], 麦: ['wheat', 'trigo'], 麥: ['wheat', 'trigo'],
  黄: ['yellow', 'amarillo'], 黃: ['yellow', 'amarillo'], 黑: ['black', 'negro'],
  龙: ['dragon', 'dragón'], 龍: ['dragon', 'dragón'],
};
function shortGloss(res) {
  const raw = res?.entries?.[0]?.gloss?.[0] || res?.char?.definition || '';
  const clean = String(raw).split(/\s*[;,]\s*/)[0].replace(/\s*\([^)]*\)/g, '').trim();
  return clean.length > 26 ? `${clean.slice(0, 25).trimEnd()}…` : clean;
}
async function resolveComponentMeanings(c, lang, scriptValue, client) {
  const out = {};
  if (!c) return out;
  const parts = new Set();
  if (c.radical?.char) parts.add(c.radical.char);
  if (c.decomposition) for (const p of [...c.decomposition]) if (!IDC.test(p) && HAN.test(p)) parts.add(p);
  if (c.etymology?.semantic && HAN.test(c.etymology.semantic)) parts.add(c.etymology.semantic);
  if (c.etymology?.phonetic && HAN.test(c.etymology.phonetic)) parts.add(c.etymology.phonetic);
  const missing = [];
  for (const p of parts) {
    const known = COMPONENT_MEANINGS[p];
    if (known) out[p] = lang === 'es' ? known[1] : known[0];
    else missing.push(p);
  }
  if (missing.length && client) {
    await Promise.all(missing.map(async (p) => {
      try {
        let res = await client.lookup(p, { script: scriptValue });
        if (lang === 'es' && res) res = await localizeLookup(res, lang).catch(() => res);
        const g = shortGloss(res);
        if (g) out[p] = g;
      } catch { /* Optional */ }
    }));
  }
  return out;
}
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
    const seen = new Set(row.gloss.map((x) => x.toLowerCase()));
    for (const raw of e.gloss || []) {
      for (const part of String(raw || '').split(/\s*;\s*/)) {
        const g = part.trim();
        if (g && !seen.has(g.toLowerCase())) { seen.add(g.toLowerCase()); row.gloss.push(g); }
      }
    }
    if (other && other !== text && !row.forms.includes(other)) row.forms.push(other);
    if (e.level && (!row.level || e.level < row.level)) row.level = e.level;
  }
  if (!out.length && result?.char?.definition) {
    const gloss = String(result.char.definition).split(/\s*[;,]\s*/).map((s) => s.trim()).filter(Boolean);
    if (gloss.length) out.push({ pinyin: result.char.readings?.[0]?.pinyin || '', gloss, level: 0, forms: [] });
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

let current = null;
export function closeLookup() { current?.close(); current = null; }

export function openLookup(text, { host = {}, context = {}, near = null } = {}) {
  text = String(text || '').trim();
  if (!text) return null;
  // One panel: reused, unless it is in another modal dialog than the one asked from.
  if (current && (current.el.closest('dialog') || null) !== modalHost(near)) closeLookup();
  if (current) { current.show(text, context, true); return current; }
  const win = zhWindow({ key: 'zh-lookup', title: `Look up ${text}`, width: 400, tall: 680, near, onClose: () => { players.forEach((p) => p.destroy?.()); stopSpeech(); current = null; } });
  win.el.classList.add('zh-lookup');
  const history = [];
  let players = [], shown = null, token = 0, favList = [], favSet = new Set(), favFootBtn = null;
  const status = (msg, bad = false) => host.status?.(msg, bad);
  const script = () => host.script?.() || 'simplified';
  const syncFavFoot = () => {
    if (!favFootBtn) return;
    const span = favFootBtn.querySelector('span');
    if (span) span.textContent = favList.length ? `Favorites (${favList.length})` : 'Favorites';
  };
  const refreshFavorites = async () => {
    try {
      const { chinese } = await import('./client.js');
      favList = await chinese().favorites();
      favSet = new Set(favList.map((w) => w.hanzi));
    } catch { favList = []; favSet = new Set(); }
    syncFavFoot();
  };
  const starButton = (hanzi, pinyin, gloss = '', { small = false, onToggle = null } = {}) => {
    const b = el('button', `star-toggle zh-lk-star${small ? ' small' : ''}`);
    b.type = 'button';
    b.append(icon('star'));
    const sync = () => {
      const on = favSet.has(hanzi);
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? `Remove ${hanzi} from favorites` : `Add ${hanzi} to favorites`;
      b.setAttribute('aria-label', b.title);
    };
    sync();
    b.onclick = async (e) => {
      e.stopPropagation();
      try {
        const { chinese } = await import('./client.js');
        const res = await chinese().toggleFavorite(hanzi, pinyin, gloss);
        await refreshFavorites();
        sync();
        status(res.starred ? `${hanzi} added to favorites.` : `${hanzi} removed from favorites.`);
        onToggle?.(res.starred);
      } catch (err) { status(err.message, true); }
    };
    return b;
  };
  const say = sayer({ script, status });
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
  const syllables = (pinyin, chars = '') => toneSyllables(pinyin, chars, say);
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
    let result, partMeanings = {};
    try {
      const { chinese } = await import('./client.js');
      const client = chinese();
      const lang = zhLang();
      [result] = await Promise.all([client.lookup(t, { script: script() }), refreshFavorites()]);
      // Meanings in Spanish with the es | en toggle (cached after the first time).
      [result, partMeanings] = await Promise.all([
        localizeLookup(result, lang).catch(() => result),
        resolveComponentMeanings(result?.char, lang, script(), client).catch(() => ({})),
      ]);
    } catch (e) {
      if (mine === token) win.body.replaceChildren(el('p', 'muted', `The dictionary could not be loaded: ${e.message}`));
      return;
    }
    if (mine !== token) return;
    render(t, ctx, result, partMeanings);
  }

  function render(t, ctx, result, partMeanings = {}) {
    const single = [...t].length === 1 && HAN.test(t);
    const readings = readingsFor(result, ctx.reading);
    const reading = readings[0]?.pinyin || '';
    const meanings = meaningsOf(result, t);
    const level = lowestLevel(result) || result.words?.find((w) => w.text === t)?.level || 0;
    const gloss = (meanings.find((m) => m.pinyin === reading)?.gloss || meanings[0]?.gloss || []).slice(0, 3).join('; ');
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
      row.append(syllables(r.pinyin, t));
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
    const headStar = starButton(t, reading, gloss);
    facts.prepend(headStar);
    const trBtn = el('button', 'zh-lk-say zh-lk-tr');
    trBtn.type = 'button';
    trBtn.title = `Translate ${t}`;
    trBtn.setAttribute('aria-label', `Translate ${t}`);
    trBtn.append(icon('translate'));
    trBtn.onclick = () => import('./zh-select.js').then(({ openTranslation }) => openTranslation(t, { near: win.el, replace: ctx.replace || null }));
    facts.prepend(trBtn);
    if (canSpeak(script())) {
      const speakBtn = el('button', 'zh-lk-say');
      speakBtn.type = 'button';
      speakBtn.title = 'Listen (S) · Shift: slower';
      speakBtn.setAttribute('aria-label', `Listen to ${t}`);
      speakBtn.append(icon('speaker'));
      speakBtn.onclick = (e) => say(t, { reading: single ? reading : '', button: speakBtn, slow: e.shiftKey });
      facts.prepend(speakBtn);
    }
    side.append(facts);
    // es | en: the meanings in Spanish or English (every Chinese window follows it).
    facts.append(langToggle({ onChange: () => { if (shown?.text === t) show(t, shown.context, false); } }));
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
      // No stroke data here: one link to look it up elsewhere (once, however often the player returns).
      const yellowBridge = () => {
        if (bar.querySelector('.zh-yb')) return;
        const ybBtn = btn(`Look up ${han[0]} on YellowBridge ↗`, 'search', () => window.open(`https://www.yellowbridge.com/chinese/character-stroke-order.php?word=${encodeURIComponent(han[0])}`, '_blank', 'noopener,noreferrer'));
        ybBtn.classList.add('zh-yb');
        bar.append(ybBtn);
      };
      const showPlayer = () => {
        players.forEach((p) => p.destroy?.()); players = [];
        stage.replaceChildren();
        return import('./stroke-player.js').then(({ strokePlayer }) => {
          if (!stage.isConnected && stage.parentNode == null) return;
          const p = strokePlayer(stage, { text: han.join(''), size: han.length === 1 ? 132 : Math.max(72, Math.floor(300 / han.length)), autoplay: true });
          players.push(p);
          p.ready?.then?.(() => { if (!p.steps) yellowBridge(); });
        }).catch(() => {
          stage.replaceChildren(el('p', 'muted', 'Stroke order could not be loaded.'));
          yellowBridge();
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
        li.append(syllables(m.pinyin, t), ' ', el('span', '', m.gloss.join('; ') || '—'));
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
      s.append(...formRows(forms, link));
      body.push(s);
    }
    // ── Structure ──
    const c = result.char;
    const partChip = (ch) => {
      const m = partMeanings[ch];
      if (!m) return link(ch);
      const wrap = el('span', 'zh-lk-part');
      wrap.append(link(ch), el('span', 'zh-lk-part-gloss muted', m));
      return wrap;
    };
    const structure = structureRows(c, partChip);
    if (structure.length) {
      const s = section('Structure');
      s.append(...structure);
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
          const hear = el('button', 'zh-lk-say small');
          hear.type = 'button'; hear.title = `Listen to ${w.text} · Shift: slower`; hear.setAttribute('aria-label', hear.title);
          hear.append(icon('speaker'));
          hear.onclick = (e) => say(w.text, { button: hear, slow: e.shiftKey });
          li.append(link(w.text), hear, syllables(w.pinyin, w.text), el('span', 'zh-lk-gloss', w.gloss || ''));
          if (w.level) li.append(el('span', 'zh-lk-level', levelLabel(w.level)));
          li.append(starButton(w.text, w.pinyin, w.gloss || '', { small: true }));
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
    if ((host.openTracePrefab || host.insertFigure) && han.length && han.length <= 12) actions.push(btn('Stroke order', 'draw', async () => {
      try {
        if (host.openTracePrefab) await host.openTracePrefab(han.join(''));
        else await host.insertFigure({ type: 'hanzi', module: 'hanzi', text: han.join(''), pinyin: reading, show: 'strokes', grid: 'mi' });
      } catch (e) { status(e.message, true); }
    }));
    favFootBtn = btn(favList.length ? `Favorites (${favList.length})` : 'Favorites', 'star', () => showFavorites(), 'zh-lk-favs-btn');
    actions.push(favFootBtn);
    const dictBtn = btn('Dictionaries', 'import', async () => {
      try {
        const [{ openZhSettings }, { chinese }] = await Promise.all([import('./settings.js'), import('./client.js')]);
        openZhSettings({ client: () => Promise.resolve(chinese()), tab: 'packs', onClose: () => { if (shown) show(shown.text, shown.context, false); } });
      } catch (e) { status(e.message, true); }
    }, 'zh-lk-dicts-btn');
    dictBtn.title = 'Download more HSK dictionaries or import a local dictionary (CC-CEDICT, JSON, TSV/CSV)';
    actions.push(dictBtn);
    win.foot.replaceChildren(...actions.filter(Boolean));
    win.foot.classList.add('zh-lk-actions');
  }
  async function showFavorites() {
    players.forEach((p) => p.destroy?.());
    players = [];
    await refreshFavorites();
    win.setTitle('Chinese favorites');
    const head = el('div', 'zh-lk-favs-head');
    if (shown) {
      const back = el('button', 'zh-lk-back');
      back.type = 'button';
      back.title = `Back to ${shown.text}`;
      back.setAttribute('aria-label', back.title);
      back.append(icon('back'));
      back.onclick = () => show(shown.text, shown.context, false);
      head.append(back);
    }
    head.append(el('strong', '', favList.length ? `Favorites (${favList.length})` : 'Favorites'));
    const body = [head];
    if (!favList.length) {
      body.push(el('p', 'muted zh-lk-favs-empty', 'No favorites yet. Click the star on any character or word to save it here.'));
    } else {
      const ul = el('ul', 'zh-lk-words zh-lk-favs');
      for (const w of favList) {
        const li = el('li');
        const py = numbersToMarks(w.pinyin || '');
        const hear = el('button', 'zh-lk-say small');
        hear.type = 'button'; hear.title = `Listen to ${w.hanzi} · Shift: slower`; hear.setAttribute('aria-label', hear.title);
        hear.append(icon('speaker'));
        hear.onclick = (e) => say(w.hanzi, { reading: [...w.hanzi].length === 1 ? py : '', button: hear, slow: e.shiftKey });
        const unstar = starButton(w.hanzi, py, w.gloss || '', { small: true, onToggle: () => showFavorites() });
        li.append(link(w.hanzi), hear, py ? syllables(py, w.hanzi) : el('span', 'muted', ''), el('span', 'zh-lk-gloss', w.gloss || ''), unstar);
        ul.append(li);
      }
      body.push(ul);
    }
    win.body.replaceChildren(...body);
    const footActions = [];
    if (shown) footActions.push(btn(`Back to ${shown.text}`, 'back', () => show(shown.text, shown.context, false)));
    if (host.addCards && favList.length) {
      footActions.push(btn('Add all to flashcards', 'cards', async (e) => {
        const cards = favList.map((w) => vocabCard({ hanzi: w.hanzi, pinyin: numbersToMarks(w.pinyin || ''), gloss: w.gloss || '', level: 0 }));
        const decks = await host.decks?.().catch(() => []) || [];
        const add = async (opts) => {
          try { const d = await host.addCards(cards, opts); status(`${cards.length} favorite${cards.length === 1 ? '' : 's'} added to “${d.title}”.`); } catch (err) { status(err.message, true); }
        };
        const r = e.currentTarget.getBoundingClientRect();
        openContextMenu(r.left, r.top - 4, [
          { label: 'New deck “Chinese favorites”', icon: 'plus', run: () => add({ title: 'Chinese favorites' }) },
          decks.length && '-',
          ...decks.slice(0, 12).map((d) => ({ label: `${d.title} (${d.count})`, icon: 'cards', run: () => add({ deckId: d.id }) })),
        ].filter(Boolean), { title: 'Add favorites to flashcards', host: win.el.closest('dialog') });
      }));
    }
    win.foot.replaceChildren(...footActions);
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

  // S: listen (Shift+S slower), unless typing in a field of the panel.
  win.el.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 's' || e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    const b = win.body.querySelector('.zh-lk-head .zh-lk-say');
    if (!b) return;
    e.preventDefault();
    b.dispatchEvent(new MouseEvent('click', { shiftKey: e.shiftKey, bubbles: true }));
  });
  current = { close: () => win.close(), show, el: win.el };
  show(text, context, true);
  if (globalThis.speechSynthesis && !speechSynthesis.getVoices().length && !canSpeak()) speechSynthesis.addEventListener?.('voiceschanged', () => { if (current && shown) show(shown.text, shown.context, false); }, { once: true });
  return current;
}
