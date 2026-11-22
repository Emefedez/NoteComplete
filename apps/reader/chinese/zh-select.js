// Chinese selected anywhere (docs/CHINESE-INPUT.md §16): a small bar of icons beside the
// selection, as the grab tool's, with Translate, Look up, Stroke order and Listen. It shows for
// characters, and for pinyin written out ("nǐ hǎo", "ni3 hao3"), which is turned into characters
// first; pinyin shown over characters (<rt>) is left out of what is selected. Translate opens a
// window with the translation to Spanish or English (es | en) and, on a button, the colours: each
// word of the sentence and the part of the translation that says it in the same colour.
//   installZhSelection(host)   once; host: { pageText(selection) → text or "" for page text,
//                              openTracePrefab(text), status(msg, bad) }
//   openTranslation(text, { near })
import { icon } from '../icons.js';
import { HAN, hasHan, lookUp, listen, lookupable, editableReplacer } from './zh-menu.js';
import {
  translate, translateMany, isPinyin, pinyinToHanzi, alignWords, zhLang, ALIGN_COLOURS,
  TRANSLATE_LANGUAGES, favoriteTranslateLangs, toggleFavoriteTranslateLang, translateLangInfo,
} from './translate.js';

let host = {};
const MAX = 2000;
const SKIP = '.context-menu, .zh-select-bar, .zh-ime, .pk-window-head, input, select, [data-no-zh-bar]';
const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

// The text of a DOM selection without the pinyin over characters (<rt>, <rp>, the page's .zh-ruby).
export function selectionText(sel) {
  if (!sel?.rangeCount || sel.isCollapsed) return '';
  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (!root?.querySelector?.('rt, rp, .zh-ruby') && !root?.closest?.('rt, .zh-ruby')) return sel.toString();
  let out = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n) || n.parentElement?.closest('rt, rp, .zh-ruby')) continue;
    const a = n === range.startContainer ? range.startOffset : 0, b = n === range.endContainer ? range.endOffset : n.data.length;
    out += n.data.slice(a, b);
  }
  return out;
}

// ---- The bar ----
// fromSelection: the bar is for the selection (it goes when the selection does).
let bar = null, barFor = '', fromSelection = false;
function hideBar() { if (bar) bar.hidden = true; barFor = ''; }
function iconButton(name, title, run) {
  const b = el('button', 'icon-button');
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(icon(name));
  // The selection stays while a button is pressed.
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.onclick = (e) => { e.stopPropagation(); const t = barFor; hideBar(); run(t); };
  return b;
}
// Also for text found another way (the grab tool's region): `rect` in client pixels.
export function showBar(text, rect, near = null, selection = false, replace = null) {
  fromSelection = selection;
  if (!bar) {
    bar = el('div', 'grab-menu grab-icons zh-select-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Chinese selection');
    document.body.append(bar);
  }
  const han = [...text].filter((c) => HAN.test(c)).join('');
  const shortText = [...text].length > 12 ? `${[...text].slice(0, 12).join('')}…` : text;
  bar.replaceChildren(...[
    iconButton('translate', `Translate “${shortText}”`, (t) => openTranslation(t, { near, replace })),
    lookupable(text) && iconButton('search', `Look up ${text.trim()}`, (t) => lookUp(t.trim(), {}, near)),
    han && [...han].length <= 12 && host.openTracePrefab && iconButton('draw', `Stroke order of ${[...han].slice(0, 12).join('')}`, () => host.openTracePrefab([...han].slice(0, 12).join(''))),
    han && iconButton('speaker', `Listen to ${shortText}`, (t) => listen(t.trim())),
  ].filter(Boolean));
  barFor = text;
  // In the open modal dialog the selection is in, so it shows over it.
  const dialog = near?.closest?.('dialog[open]');
  if (dialog && bar.parentElement !== dialog) dialog.append(bar);
  else if (!dialog && bar.parentElement !== document.body) document.body.append(bar);
  bar.hidden = false;
  const zRaw = parseFloat(document.documentElement.style.zoom);
  const z = Number.isFinite(zRaw) && zRaw > 0 ? zRaw : 1;
  const vw = innerWidth / z, vh = innerHeight / z;
  const w = bar.offsetWidth || 140, h = bar.offsetHeight || 36;
  const rTop = rect.top / z, rBot = rect.bottom / z, rRight = rect.right / z;
  const below = rBot + 8 + h < vh;
  Object.assign(bar.style, {
    position: 'fixed',
    left: `${Math.max(8, Math.min(vw - w - 8, rRight - w / 2))}px`,
    top: `${below ? rBot + 8 : Math.max(8, rTop - h - 8)}px`,
  });
}

// The selection worth a bar at the end of a gesture: { text, rect, near } or null.
function currentSelection(lastPointer) {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && !active.closest(SKIP)) {
    const { selectionStart: a, selectionEnd: b } = active;
    if (a == null || a === b) return null;
    const r = active.getBoundingClientRect();
    const [x, y] = lastPointer || [r.right, r.top];
    return {
      text: active.value.slice(a, b),
      rect: { left: x, right: x, top: Math.max(r.top, y - 10), bottom: Math.min(r.bottom, y + 10) },
      near: active,
      replace: async (to) => {
        active.focus();
        active.setSelectionRange(a, b);
        if (!document.execCommand('insertText', false, to)) active.setRangeText(to, a, b, 'end');
        active.dispatchEvent(new Event('input', { bubbles: true }));
      },
    };
  }
  const sel = getSelection();
  if (!sel?.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer, near = node.nodeType === 1 ? node : node.parentElement;
  if (!near || near.closest(SKIP)) return null;
  const text = (near.closest('.sheet') && host.pageText?.(sel)) || selectionText(sel);
  const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
  const rect = rects.at(-1) || range.getBoundingClientRect();
  const editable = near.closest?.('[contenteditable="true"], [contenteditable=""]');
  const replace = editable ? editableReplacer(editable, range, text) : null;
  return { text, rect, near, replace };
}

export function installZhSelection(h = {}) {
  host = { ...host, ...h };
  let pointer = null, timer = 0;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = currentSelection(pointer);
      const text = String(s?.text || '').trim();
      if (!s || !text || text.length > MAX || !(hasHan(text) || isPinyin(text))) return fromSelection && hideBar();
      if (text === barFor && !bar?.hidden) return;
      showBar(text, s.rect, s.near, true, s.replace);
    }, 30);
  };
  document.addEventListener('pointerup', (e) => { pointer = [e.clientX, e.clientY]; if (!e.target.closest?.('.zh-select-bar')) check(); }, true);
  document.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) { pointer = null; check(); } }, true);
  document.addEventListener('pointerdown', (e) => { if (bar && !bar.hidden && !e.target.closest?.('.zh-select-bar')) hideBar(); }, true);
  document.addEventListener('selectionchange', () => { if (bar && !bar.hidden && fromSelection && !String(currentSelection(pointer)?.text || '').trim()) hideBar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bar && !bar.hidden) hideBar(); }, true);
  addEventListener('scroll', () => hideBar(), { capture: true, passive: true });
}

// ---- The translation window ----
let win = null;
const COLOUR_KEY = 'notecomplete-zh-colours';
const coloursWanted = () => { try { return localStorage.getItem(COLOUR_KEY) === '1'; } catch { return false; } };
const wantColours = (on) => { try { localStorage.setItem(COLOUR_KEY, on ? '1' : '0'); } catch { /* Not kept. */ } };

export async function openTranslation(text, { near = null, to = null, openSearch = false, replace = null } = {}) {
  text = String(text || '').trim().slice(0, MAX);
  if (!text) return null;
  const { zhWindow } = await import('./zh-window.js');
  win?.close();
  const w = zhWindow({ key: 'zh-translate', title: 'Translate', width: 480, tall: 580, near, onClose: () => { if (win === w) win = null; } });
  win = w;
  w.el.classList.add('zh-translate');
  let token = 0, source = text, words = null, result = null, colours = false;
  let targetLang = to || zhLang() || favoriteTranslateLangs()[0] || 'es';
  const status = (msg, bad = false) => host.status?.(msg, bad);
  const head = el('div', 'zh-tr-head');
  const langBar = el('div', 'zh-tr-langs');
  langBar.setAttribute('role', 'group');
  langBar.setAttribute('aria-label', 'Favorite translation languages');
  const searchBtn = el('button', 'icon-button zh-tr-search-btn');
  searchBtn.type = 'button';
  searchBtn.title = 'Search other languages and add to favorites';
  searchBtn.setAttribute('aria-label', searchBtn.title);
  searchBtn.setAttribute('aria-expanded', String(openSearch));
  searchBtn.append(icon('search'));
  const by = el('small', 'muted zh-tr-by');
  head.append(langBar, searchBtn, by);

  const searchPanel = el('div', 'zh-tr-search-panel');
  searchPanel.hidden = !openSearch;
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'zh-tr-search-input';
  searchInput.placeholder = 'Search languages (French, Japanese, German…)';
  searchInput.setAttribute('aria-label', 'Search translation languages');
  const searchList = el('div', 'zh-tr-lang-list');
  searchPanel.append(searchInput, searchList);

  function renderLangBar() {
    const favs = favoriteTranslateLangs();
    const shown = favs.includes(targetLang) ? favs : [...favs, targetLang];
    langBar.replaceChildren(...shown.map((code) => {
      const info = translateLangInfo(code);
      const b = el('button', 'zh-tr-lang-btn', info.native);
      b.type = 'button';
      b.title = `Translate to ${info.name} (${info.native})`;
      b.setAttribute('aria-pressed', String(code === targetLang));
      b.onclick = () => { targetLang = code; renderLangBar(); renderSearchList(); run(); };
      return b;
    }));
  }
  function renderSearchList() {
    const q = searchInput.value.trim().toLowerCase();
    const favs = new Set(favoriteTranslateLangs());
    const matches = TRANSLATE_LANGUAGES.filter((l) => !q || l.name.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code.toLowerCase().includes(q));
    searchList.replaceChildren(...matches.map((l) => {
      const row = el('div', 'zh-tr-lang-row');
      const pick = el('button', 'zh-tr-lang-pick');
      pick.type = 'button';
      pick.setAttribute('aria-pressed', String(l.code === targetLang));
      pick.append(el('strong', '', l.native), el('small', 'muted', l.name !== l.native ? l.name : ''));
      pick.onclick = () => { targetLang = l.code; searchPanel.hidden = true; searchBtn.setAttribute('aria-expanded', 'false'); renderLangBar(); run(); };
      const star = el('button', 'star-toggle zh-tr-lang-star');
      star.type = 'button';
      const isFav = favs.has(l.code);
      star.setAttribute('aria-pressed', String(isFav));
      star.title = isFav ? `Remove ${l.name} from favorites` : `Add ${l.name} to favorites`;
      star.setAttribute('aria-label', star.title);
      star.append(icon('star'));
      star.onclick = (e) => {
        e.stopPropagation();
        toggleFavoriteTranslateLang(l.code);
        renderLangBar();
        renderSearchList();
      };
      row.append(pick, star);
      return row;
    }));
  }
  searchBtn.onclick = () => {
    searchPanel.hidden = !searchPanel.hidden;
    searchBtn.setAttribute('aria-expanded', String(!searchPanel.hidden));
    if (!searchPanel.hidden) { renderSearchList(); searchInput.focus(); }
  };
  searchInput.oninput = renderSearchList;
  renderLangBar();
  if (openSearch) { renderSearchList(); requestAnimationFrame(() => searchInput.focus()); }

  const from = el('p', 'muted zh-tr-from');
  const src = el('p', 'zh-tr-source zh-cjk');
  const out = el('p', 'zh-tr-target');
  w.body.replaceChildren(head, searchPanel, from, src, out);
  const colourBtn = el('button', 'zh-tr-colours');
  colourBtn.type = 'button';
  colourBtn.title = 'Colour each word and the part of the translation that says it (the dictionary on this device and one more request)';
  colourBtn.append(icon('highlight'), el('span', '', 'Colours'));
  colourBtn.onclick = () => { colours = !colours; wantColours(colours); paint(); };
  const copyBtn = el('button');
  copyBtn.type = 'button';
  copyBtn.append(icon('copy'), el('span', '', 'Copy'));
  copyBtn.onclick = () => navigator.clipboard?.writeText(result?.text || '').then(() => status('Translation copied.'), () => status('Could not copy.', true));
  const replaceBtn = replace ? el('button', 'primary zh-tr-replace') : null;
  if (replaceBtn) {
    replaceBtn.type = 'button';
    replaceBtn.disabled = true;
    replaceBtn.title = 'Replace the selected text with this translation';
    replaceBtn.append(icon('swap'), el('span', '', 'Replace'));
    replaceBtn.onclick = async () => {
      if (!result?.text) return;
      try {
        await replace(result.text);
        status(`Replaced with ${translateLangInfo(targetLang).native} translation.`);
        w.close();
      } catch (e) { status(e.message, true); }
    };
  }
  w.foot.replaceChildren(...[colourBtn, copyBtn, replaceBtn].filter(Boolean));
  w.foot.classList.add('zh-lk-actions');

  // The sentence as words (the dictionary's own split), each a link to its look-up.
  async function split() {
    try {
      const { chinese } = await import('./client.js');
      const runs = await chinese().annotate(source, {});
      const list = [];
      let at = 0;
      for (const r of runs || []) {
        if (r.start > at) list.push({ text: source.slice(at, r.start) });
        list.push({ text: r.text, pinyin: (r.pinyin || []).join(' ') });
        at = r.end;
      }
      if (at < source.length) list.push({ text: source.slice(at) });
      return list.length ? list : [{ text: source }];
    } catch { return [{ text: source }]; }
  }
  function drawSource(spans = []) {
    src.replaceChildren(...words.map((wd, i) => {
      if (!HAN.test(wd.text)) return wd.text;
      const b = el('button', 'zh-tr-word', wd.text);
      b.type = 'button';
      b.title = `${wd.pinyin ? `${wd.pinyin} · ` : ''}Look up ${wd.text}`;
      b.onclick = () => lookUp(wd.text, { reading: wd.pinyin }, w.el);
      const hit = spans.find((s) => s.word === i);
      if (hit) b.style.setProperty('--zh-c', hit.colour);
      return b;
    }));
  }
  function drawTarget(spans = []) {
    const t = result?.text || '';
    const parts = [];
    let at = 0;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
      if (s.start > at) parts.push(t.slice(at, s.start));
      const m = el('mark', 'zh-tr-part', t.slice(s.start, s.end));
      m.style.setProperty('--zh-c', s.colour);
      parts.push(m);
      at = s.end;
    }
    parts.push(t.slice(at));
    out.replaceChildren(...parts);
  }
  // Colours: each word's own translation (one request for all) and, in English, its meanings.
  async function paint() {
    const canColour = hasHan(source) && (targetLang === 'es' || targetLang === 'en');
    colourBtn.hidden = !canColour;
    colourBtn.setAttribute('aria-pressed', String(colours));
    if (!canColour || !colours || !result) { drawSource(); drawTarget(); return; }
    const mine = token, lang = targetLang;
    colourBtn.disabled = true;
    try {
      const han = words.filter((wd) => HAN.test(wd.text));
      const own = await translateMany(han.map((wd) => wd.text), { to: lang }).catch(() => han.map(() => ''));
      const { chinese } = await import('./client.js');
      const meanings = lang === 'en'
        ? await Promise.all(han.map((wd) => chinese().lookup(wd.text, {}).then((r) => (r?.entries || []).flatMap((e) => e.gloss || []).slice(0, 8), () => [])))
        : han.map(() => []);
      if (mine !== token) return;
      const byWord = new Map(han.map((wd, i) => [wd, [own[i], ...meanings[i]].filter(Boolean)]));
      const found = alignWords(words.map((wd) => ({ text: wd.text, meanings: byWord.get(wd) || [] })), result.text);
      const spans = found.map((s, k) => ({ ...s, colour: ALIGN_COLOURS[k % ALIGN_COLOURS.length] }));
      drawSource(spans);
      drawTarget(spans);
      if (!spans.length) status('No part of the translation could be matched to a word.', true);
    } catch (e) { status(e.message, true); } finally { if (mine === token) colourBtn.disabled = false; }
  }
  async function run() {
    const mine = ++token;
    if (replaceBtn) replaceBtn.disabled = true;
    out.replaceChildren(el('span', 'muted', 'Translating…'));
    by.textContent = '';
    try {
      const srcLang = hasHan(source) ? 'zh-CN' : 'auto';
      result = await translate(source, { from: srcLang, to: targetLang });
      if (mine !== token) return;
      by.textContent = result.by === 'MyMemory' ? 'MyMemory' : 'Google Translate';
      if (replaceBtn) replaceBtn.disabled = !result?.text;
      drawTarget();
      paint();
    } catch (e) {
      if (mine !== token) return;
      result = null;
      if (replaceBtn) replaceBtn.disabled = true;
      out.replaceChildren(el('span', 'muted', e.message));
    }
  }

  // Pinyin: the characters first, with the dictionary of the input method.
  if (!hasHan(text) && isPinyin(text)) {
    from.textContent = `From pinyin: ${text}`;
    src.textContent = 'Reading the pinyin…';
    const { chinese } = await import('./client.js');
    const client = chinese();
    const han = await pinyinToHanzi(text, (input, opts) => client.candidates(input, opts)).catch(() => '');
    if (win !== w) return w;
    source = han || text;
    if (!han) from.textContent = `Pinyin (no characters found for all of it): ${text}`;
  } else from.hidden = true;
  w.setTitle(`Translate ${[...source].length > 10 ? `${[...source].slice(0, 10).join('')}…` : source}`);
  words = await split();
  if (win !== w) return w;
  colours = coloursWanted();
  colourBtn.setAttribute('aria-pressed', String(colours));
  drawSource();
  await run();
  return w;
}
