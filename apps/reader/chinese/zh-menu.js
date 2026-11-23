// Where the character panel opens from (docs/CHINESE-INPUT.md §8): "Look up 你好" on top of the
// page and item menus (text boxes through the browser's own layout of their SVG <text>, the
// PDF/OCR text layer likewise), and a menu of its own for Chinese in the Markdown preview, HTML
// and text views, study cards and chat (the caret at the pointer), and for a selection of Chinese
// in a text field or the notes (convert, vocabulary cards). A long press of a finger on a
// character opens the panel straight away. A right-click on a picture (an image-only PDF, an
// inserted image) reads the Chinese around the pointer in the background and adds those entries
// to the menu once found (zh-picture.js). app.js: configureZh(host), pageZhEntries(…) and
// pageZhPicture(…) in its page menu, pageZhLongPress(…) in its long press, installZhContext() once.
import { openContextMenu } from '../context-menu.js';
import { favoriteTranslateLangs, translateLangInfo } from './translate.js';

export const HAN = /\p{Script=Han}/u;
export const hasHan = (s) => HAN.test(String(s ?? ''));
let host = {};
// { status, decks(), addCards(cards, opts), insertFigure(spec), boxText(p, id), editBox(p, id, value) }
export function configureZh(h) { host = { ...host, ...h }; }

// ---- Pure parts ----
// The character at UTF-16 `index` of `text` (a surrogate pair whole): { char, start, end } or null.
export function charAround(text, index) {
  const s = String(text ?? '');
  if (index < 0 || index >= s.length) return null;
  let start = index;
  if (/[\udc00-\udfff]/.test(s[start]) && start > 0 && /[\ud800-\udbff]/.test(s[start - 1])) start--;
  const char = String.fromCodePoint(s.codePointAt(start));
  return { char, start, end: start + char.length };
}
// The annotate() run (a word) that holds UTF-16 `index`.
export const wordAround = (runs, index) => (runs || []).find((r) => r.start <= index && index < r.end) || null;
// A box's lines as drawn (wrapped, one <text> each) back to its text: the index in the box of
// character `index` of line `line`, or -1.
export function boxIndex(box, lines, line, index) {
  let cursor = 0;
  for (let k = 0; k < line; k++) { const at = box.indexOf(lines[k], cursor); if (at >= 0) cursor = at + lines[k].length; }
  const at = box.indexOf(lines[line] ?? '\u0000', cursor);
  return at < 0 ? -1 : at + index;
}
// The place of a reading chosen for a text box, as chinese/ruby.js counts it: lines joined by one character.
export const rubyIndex = (lines, line, index) => lines.slice(0, line).reduce((n, t) => n + t.length + 1, 0) + index;
export const lookupLabel = (t) => { const c = [...String(t)]; return `Look up ${c.length > 8 ? `${c.slice(0, 8).join('')}…` : c.join('')}`; };
// A selection worth a look-up of its own (a word, not a paragraph).
export const lookupable = (t) => { const s = String(t ?? '').trim(); return hasHan(s) && [...s].length <= 8 && !/\s/.test(s); };

// ---- Finding the character at a point ----
const svgTexts = (root) => [...root.querySelectorAll('[data-item] text, .text-layer text')].filter((t) => !t.closest('.zh-ruby'));
const inside = (r, x, y, pad = 2) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
// The SVG <text> line and character index at client (x, y) in `root`: page text boxes and the text
// layer. { text, index, el, item?, lines?, line? } or null.
export function svgHit(root, x, y) {
  for (const el of svgTexts(root)) {
    if (!HAN.test(el.textContent) || !inside(el.getBoundingClientRect(), x, y)) continue;
    let index = -1;
    try {
      const m = el.getScreenCTM?.();
      if (m) { const pt = new DOMPoint(x, y).matrixTransform(m.inverse()); index = el.getCharNumAtPosition(pt); }
    } catch { /* Not laid out. */ }
    if (index < 0) {
      // Between characters: the nearest one on the row.
      let best = Infinity;
      for (let i = 0, n = el.getNumberOfChars?.() || 0; i < n; i++) {
        let r;
        try { r = el.getExtentOfChar(i); } catch { continue; }
        const m = el.getScreenCTM(), a = new DOMPoint(r.x, r.y).matrixTransform(m), b = new DOMPoint(r.x + r.width, r.y + r.height).matrixTransform(m);
        if (y < Math.min(a.y, b.y) - 2 || y > Math.max(a.y, b.y) + 2) continue;
        const d = Math.abs((a.x + b.x) / 2 - x);
        if (d < best) { best = d; index = i; }
      }
    }
    if (index < 0) continue;
    const item = el.closest('[data-item]');
    const out = { text: el.textContent, index, el };
    if (item) {
      const lines = [...item.querySelectorAll('text')].filter((t) => !t.closest('.zh-ruby'));
      Object.assign(out, { item: item.getAttribute('data-item'), lines: lines.map((t) => t.textContent), line: lines.indexOf(el) });
    }
    return out;
  }
  return null;
}
const BLOCK = 'p, li, td, th, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, pre, figcaption, .deck-card-front, .deck-card-back, .practice-front, .practice-back, div';
// The text node and offset of the character under client (x, y) in HTML, with the text of its
// block (pinyin over characters left out) for finding the word: { text, index, node, offset }.
export function htmlHit(x, y, doc = document) {
  let node = null, offset = 0;
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) { node = pos.offsetNode; offset = pos.offset; } else { const r = doc.caretRangeFromPoint?.(x, y); if (r) { node = r.startContainer; offset = r.startOffset; } }
  if (!node || node.nodeType !== 3) return null;
  // Pinyin over a character: its character.
  const rt = node.parentElement?.closest('rt');
  if (rt) { const base = rt.parentElement?.firstChild; if (!base || base.nodeType !== 3) return null; node = base; offset = 0; }
  const range = doc.createRange();
  const hitAt = (i) => {
    const c = charAround(node.data, i);
    if (!c || !HAN.test(c.char)) return null;
    range.setStart(node, c.start); range.setEnd(node, c.end);
    return [...range.getClientRects()].some((r) => inside(r, x, y, 1)) ? c : null;
  };
  const c = hitAt(offset) || hitAt(offset - 1) || hitAt(offset - 2);
  if (!c) return null;
  const block = node.parentElement?.closest(BLOCK) || node.parentElement;
  let text = '', index = -1;
  const walker = doc.createTreeWalker(block, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest('rt, rp')) continue;
    if (n === node) index = text.length + c.start;
    text += n.data;
    if (text.length > 4000 && index >= 0) break;
  }
  return index < 0 ? { text: node.data, index: c.start, node, offset: c.start } : { text, index, node, offset: c.start };
}

// ---- Menus ----
const loadPanel = () => import('./lookup-panel.js');
async function scriptNow() {
  try {
    const [{ noteChinese }, { zhSettings }] = await Promise.all([import('./ruby.js'), import('./settings.js')]);
    return noteChinese().script || zhSettings().script || 'simplified';
  } catch { return 'simplified'; }
}
const panelHost = () => ({ ...host, script: () => host.scriptValue || 'simplified' });
export async function lookUp(text, context = {}, near = null) {
  host.scriptValue = await scriptNow();
  const { openLookup } = await loadPanel();
  return openLookup(text, { host: panelHost(), context, near });
}
// Says `text` (a character read `reading`, a word or a sentence), streamed (speech.js).
export async function listen(text, reading = '') {
  const [{ speak }, script] = await Promise.all([import('./speech.js'), scriptNow()]);
  const ok = await speak(text, { reading: [...text].length === 1 ? reading : '', script });
  if (!ok) host.status?.(navigator.onLine === false ? 'Offline, and the system has no Chinese voice.' : 'The pronunciation could not be played.', true);
}
const listenEntry = (text, reading = '') => ({ label: `Listen to ${[...text].length > 12 ? `${[...text].slice(0, 12).join('')}…` : text}`, icon: 'speaker', run: () => listen(text, reading) });
const translateEntry = (text, near = null, replace = null) => {
  const short = [...String(text ?? '').trim()].length > 14 ? `${[...String(text ?? '').trim()].slice(0, 14).join('')}…` : String(text ?? '').trim();
  const open = async (opts = {}) => {
    const { openTranslation } = await import('./zh-select.js');
    return openTranslation(text, { near, replace, ...opts });
  };
  return {
    label: short ? `Translate “${short}”` : 'Translate',
    icon: 'translate',
    subtitle: 'Favorites',
    run: () => open(),
    submenu: () => [
      ...favoriteTranslateLangs().map((code) => {
        const info = translateLangInfo(code);
        return { label: info.native, icon: 'translate', run: () => open({ to: code }) };
      }),
      '-',
      { label: 'More languages…', icon: 'search', run: () => open({ openSearch: true }) },
    ],
  };
};
async function annotateQuick(text, ms = 700) {
  try {
    const { chinese } = await import('./client.js');
    const script = await scriptNow();
    return await Promise.race([chinese().annotate(text, { script }), new Promise((r) => setTimeout(() => r(null), ms))]) || [];
  } catch { return []; }
}
async function lookupQuick(text, ms = 350) {
  try {
    const { chinese } = await import('./client.js');
    const script = await scriptNow();
    const res = await Promise.race([chinese().lookup(text, { script }), new Promise((r) => setTimeout(() => r(null), ms))]);
    if (!res?.entries?.length) return null;
    const pinyin = res.entries[0].pinyin || '';
    const gloss = [...new Set(res.entries.flatMap((e) => e.gloss || []).filter(Boolean))].slice(0, 3).join('; ');
    const vars = new Set();
    for (const e of res.entries) {
      if (e.simp && e.simp !== text) vars.add(e.simp);
      if (e.trad && e.trad !== text) vars.add(e.trad);
    }
    const v = res.char?.variants || {};
    for (const c of [...(v.simp || ''), ...(v.trad || ''), ...(v.other || '')]) if (c && c !== text) vars.add(c);
    return { pinyin, gloss, variants: [...vars].slice(0, 4) };
  } catch { return null; }
}
function richLookupLabel(t, info) {
  const base = lookupLabel(t);
  if (!info || (!info.gloss && !info.variants?.length)) return base;
  const parts = [];
  if (info.pinyin) parts.push(info.pinyin);
  if (info.gloss) parts.push(info.gloss.length > 36 ? `${info.gloss.slice(0, 36)}…` : info.gloss);
  if (info.variants?.length) parts.push(`Variants: ${info.variants.join(' ')}`);
  return `${base} (${parts.join(' · ')})`;
}
export const PREFAB_SPEC_ATTR = 'data-nc-prefab-spec';

export function embedPrefabSpecInSvg(svgText, spec) {
  if (!svgText || !spec) return svgText;
  try {
    const encoded = encodeURIComponent(JSON.stringify(spec));
    return String(svgText).replace(/^<svg\b/, `<svg ${PREFAB_SPEC_ATTR}="${encoded}"`);
  } catch {
    return svgText;
  }
}

export function extractPrefabSpecFromDataUri(src = '', alt = '') {
  const raw = String(src || '');
  if (!/^data:image\/svg\+xml/i.test(raw)) return null;
  let svg = '';
  const comma = raw.indexOf(',');
  if (comma >= 0) {
    const head = raw.slice(0, comma), body = raw.slice(comma + 1);
    try {
      svg = /;base64/i.test(head) ? atob(body) : decodeURIComponent(body);
    } catch { svg = body; }
  }
  const attrMatch = svg.match(/data-nc-prefab-spec="([^"]+)"/);
  if (attrMatch) {
    try { return JSON.parse(decodeURIComponent(attrMatch[1])); } catch {}
  }
  const altText = String(alt || '').trim();
  const hanFromAlt = [...altText].filter((c) => HAN.test(c)).slice(0, 12).join('');
  if (/^Stroke order\b/i.test(altText) || hanFromAlt) {
    return { type: 'hanzi', text: hanFromAlt || '你好', show: 'steps', grid: 'mi', outline: true };
  }
  return null;
}

// A data URI safe inside Markdown's ![alt](…): ( and ) escaped too (an SVG's transform="translate(…)"
// would end the link early), and an alt text without brackets, short enough to read in a pill.
const markdownUri = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29')}`;
const markdownAlt = (text, max = 90) => {
  const t = String(text || '').replace(/[[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export async function markdownPrefabBlockForSpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== 'object') return '';
  if (rawSpec.type === 'hanzi' || rawSpec.module === 'hanzi') {
    const han = ([...String(rawSpec.text ?? '')].filter((c) => HAN.test(c))).slice(0, 12).join('');
    if (!han) return '';
    const { prepareWithDict, render } = await import('../prefabs/hanzi/render.js');
    const spec = await prepareWithDict({ ...rawSpec, type: 'hanzi', text: han, show: rawSpec.show || 'steps' });
    const out = render(spec);
    if (!out?.svg) return '';
    const svgWithSpec = embedPrefabSpecInSvg(out.svg, spec);
    const caption = [han, spec.pinyin, spec.gloss].filter(Boolean).join(' · ');
    return `![${markdownAlt(`Stroke order ${caption}`)}](${markdownUri(svgWithSpec)})`;
  }
  const { renderPrefab, prefabName } = await import('../prefabs.js');
  const out = renderPrefab(rawSpec);
  if (!out?.svg) return '';
  const svgWithSpec = embedPrefabSpecInSvg(out.svg, rawSpec);
  const title = prefabName(rawSpec) || rawSpec.type || 'Prefab';
  return `![${markdownAlt(title)}](${markdownUri(svgWithSpec)})`;
}

export async function markdownTraceBlockFor(rawText) {
  const han = ([...String(rawText || '')].filter((c) => HAN.test(c))).slice(0, 12).join('');
  if (!han) return '';
  const line = await markdownPrefabBlockForSpec({ type: 'hanzi', text: han, show: 'steps', grid: 'mi', outline: true });
  return line ? `\n\n${line}\n` : '';
}
export async function vocabFrom(text, near = null) {
  const { vocabDialog } = await import('./vocab-dialog.js');
  return vocabDialog(text, { host: panelHost(), near });
}
export async function convertFrom(text, near = null) {
  const { convertDialog } = await import('./convert-dialog.js');
  return convertDialog(text, { near });
}
// The entries for the character (and its word) of `hit` ({ text, index }); `ctx(start, end,
// reading)` gives the panel's context for that place (replace, setReading).
async function hitEntries(hit, ctx = () => ({}), near = null) {
  const c = charAround(hit.text, hit.index);
  if (!c || !HAN.test(c.char)) return [];
  // The character's look-up runs while the word is found, so the menu waits for one, not two.
  const charLookup = lookupQuick(c.char);
  const runs = await annotateQuick(hit.text);
  const w = wordAround(runs, c.start);
  const k = w ? [...hit.text.slice(w.start, c.start)].length : 0;
  const [wordInfo, charInfo] = await Promise.all([
    w && [...w.text].length > 1 ? lookupQuick(w.text) : Promise.resolve(null),
    charLookup,
  ]);
  const out = [];
  if (w && [...w.text].length > 1) {
    out.push({ label: richLookupLabel(w.text, wordInfo), icon: 'search', run: () => lookUp(w.text, ctx(w.start, w.end, w.pinyin.join(' ')), near) });
  }
  out.push({ label: richLookupLabel(c.char, charInfo), icon: 'search', run: () => lookUp(c.char, ctx(c.start, c.end, w?.pinyin?.[k] || ''), near) });
  const target = (w && [...w.text].length > 1 ? w.text : c.char);
  const targetCtx = target === c.char ? ctx(c.start, c.end, w?.pinyin?.[k] || '') : ctx(w.start, w.end, w.pinyin.join(' '));
  out.push(translateEntry(target, near, targetCtx?.replace || null));
  out.push(listenEntry(target, target === c.char ? (w?.pinyin?.[k] || '') : ''));
  if (host.openTracePrefab) {
    out.push({ label: `Stroke order of ${target}…`, icon: 'draw', run: () => host.openTracePrefab(target) });
  } else if (host.insertFigure) {
    out.push({ label: `Insert the stroke order of ${target}`, icon: 'draw', run: () => host.insertFigure({ type: 'hanzi', text: target, show: 'steps', grid: 'mi', outline: true }) });
  }
  return out;
}
const selectionEntries = (text, near, replace = null, info = null) => {
  const clean = String(text ?? '').trim();
  const hanOnly = ([...clean].filter((c) => HAN.test(c))).slice(0, 12).join('');
  return [
    lookupable(text) && { label: richLookupLabel(clean, info), icon: 'search', run: () => lookUp(clean, replace ? { replace } : {}, near) },
    clean && translateEntry(clean, near, replace),
    hanOnly && listenEntry(clean),
    hanOnly && host.openTracePrefab && { label: `Stroke order of ${hanOnly}…`, icon: 'draw', run: () => host.openTracePrefab(hanOnly) },
    replace && { label: 'Convert simplified ↔ traditional…', icon: 'swap', run: async () => { const out = await convertFrom(text, near); if (out != null && out !== text) await replace(out); } },
    host.addCards && { label: 'Make vocabulary cards…', icon: 'cards', run: () => vocabFrom(text, near) },
  ].filter(Boolean);
};

// The page menu's entries for Chinese under (x, y) on page `p` (its element `p.el`): a text box
// or the text layer. Empty when there is none.
export async function pageZhEntries(p, x, y) {
  const root = p?.el;
  if (!root || !hasHan(root.textContent)) return [];
  const hit = svgHit(root, x, y);
  if (!hit) return [];
  const entries = await hitEntries(hit, (start, end, reading) => pageContext(p, hit, start, end, reading), root);
  if (hit.item && host.boxText) {
    const box = host.boxText(p, hit.item);
    if (hasHan(box)) {
      if (host.editBox) entries.push({ label: 'Convert this text box (simplified ↔ traditional)…', icon: 'swap', run: async () => {
        const out = await convertFrom(box, root);
        if (out != null && out !== box) await host.editBox(p, hit.item, out);
      } });
      if (host.addCards) entries.push({ label: 'Make vocabulary cards…', icon: 'cards', run: () => vocabFrom(box, root) });
    }
  }
  return entries.length ? [...entries, '-'] : [];
}
// The panel's context for a place in a page text box: convert that occurrence; the reading
// used there (chinese/ruby.js note readings, by item and index).
function pageContext(p, hit, start, end, reading) {
  const ctx = { reading };
  if (!hit.item) return ctx;
  const from = hit.text.slice(start, end);
  if (host.boxText && host.editBox) {
    ctx.replace = async (to) => {
      const box = host.boxText(p, hit.item), i = boxIndex(box, hit.lines, hit.line, start);
      if (i < 0 || box.slice(i, i + from.length) !== from) throw new Error('The text box changed; look it up again.');
      await host.editBox(p, hit.item, box.slice(0, i) + to + box.slice(i + from.length));
    };
  }
  // A reading for one character (a word's characters each keep theirs).
  if ([...from].length === 1) {
    ctx.setReading = async (pinyin) => {
      const { noteChinese, setNoteChinese } = await import('./ruby.js');
      const index = rubyIndex(hit.lines, hit.line, start);
      const readings = (noteChinese().readings || []).filter((r) => !(r.item === hit.item && r.index === index));
      await setNoteChinese({ readings: [...readings, { item: hit.item, index, pinyin }] });
    };
  }
  return ctx;
}
// Chinese read from the picture under (x, y) on page `p` (no text there to hit): the same entries
// as for text, or [] when there is none or no picture. Only where Chinese is in use (its mode was
// turned on once, or the note has Chinese), so its recognition data is not downloaded for nothing.
export async function pageZhPicture(p, x, y) {
  const root = p?.el;
  if (!root) return [];
  const { zhEverUsed, zhSettings } = await import('./settings.js');
  if (!zhEverUsed() && zhSettings().mode === 'off' && !hasHan(root.textContent)) return [];
  const { readPictureAt } = await import('./zh-picture.js');
  const hit = await readPictureAt(root, x, y, { script: await scriptNow() }).catch(() => null);
  return hit ? hitEntries(hit, (start, end, reading) => ({ reading }), root) : [];
}
// A selection of text on a page (the PDF/OCR text layer): Chinese tools or universal Translate + Copy.
export async function pageZhSelection(text, x, y) {
  const clean = String(text ?? '').trim();
  if (!clean) return;
  if (hasHan(clean)) {
    const info = lookupable(clean) ? await lookupQuick(clean) : null;
    openContextMenu(x, y, [...selectionEntries(clean, null, null, info), '-', { label: 'Copy', icon: 'copy', key: 'Ctrl C', run: () => navigator.clipboard?.writeText(text) }], { title: 'Chinese' });
    return;
  }
  openContextMenu(x, y, [translateEntry(clean, null), '-', { label: 'Copy', icon: 'copy', key: 'Ctrl C', run: () => navigator.clipboard?.writeText(text) }], { title: 'Selection' });
}
// A finger held on a character of a page: the panel at once. True when it opened.
export async function pageZhLongPress(p, x, y) {
  const root = p?.el;
  if (!root || !hasHan(root.textContent)) return false;
  const hit = svgHit(root, x, y);
  const c = hit && charAround(hit.text, hit.index);
  if (!c || !HAN.test(c.char)) return false;
  const runs = await annotateQuick(hit.text);
  const w = wordAround(runs, c.start), k = w ? [...hit.text.slice(w.start, c.start)].length : 0;
  lookUp(c.char, pageContext(p, hit, c.start, c.end, w?.pinyin?.[k] || ''), root);
  return true;
}

// A character of text being typed (a page text box): its panel at once. `replace(start, end, from,
// to)` puts another form in that place. False when there is no Chinese at `index`.
export async function lookUpTyped(text, index, replace = null, near = null) {
  const c = charAround(text, index);
  if (!c || !HAN.test(c.char)) return false;
  const runs = await annotateQuick(text);
  const w = wordAround(runs, c.start), k = w ? [...text.slice(w.start, c.start)].length : 0;
  lookUp(c.char, { reading: w?.pinyin?.[k] || '', ...(replace ? { replace: (to) => replace(c.start, c.end, c.char, to) } : {}) }, near);
  return true;
}

// ---- Everywhere else: Markdown, HTML and text views, cards, chat, text fields ----
const typing = (t) => t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && /^(text|search|)$/.test(t.type));
// Resilient replacer for contenteditable (including TinyMDE, which may re-render line nodes on blur/focus).
export function editableReplacer(editable, range, originalText = '') {
  if (!editable || !range || !editable.contains(range.commonAncestorContainer)) return null;
  const doc = editable.ownerDocument || document;
  const saved = range.cloneRange();
  // Snapshot absolute character offsets within `editable` in case nodes detach before Replace is clicked.
  let absStart = -1, absEnd = -1, pos = 0;
  const walk = doc.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.data.length;
    if (n === saved.startContainer) absStart = pos + saved.startOffset;
    if (n === saved.endContainer) absEnd = pos + saved.endOffset;
    pos += len;
  }
  const rangeAt = (a, b) => {
    const r = doc.createRange();
    const w = doc.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let cur = 0, gotA = false;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const next = cur + n.data.length;
      if (!gotA && a <= next) { r.setStart(n, Math.max(0, a - cur)); gotA = true; }
      if (gotA && b <= next) { r.setEnd(n, Math.max(0, b - cur)); return r; }
      cur = next;
    }
    return null;
  };
  return async (to) => {
    editable.focus({ preventScroll: true });
    let r = null;
    if (saved.startContainer.isConnected && saved.endContainer.isConnected && editable.contains(saved.startContainer) && editable.contains(saved.endContainer)) {
      r = saved.cloneRange();
    } else if (absStart >= 0 && absEnd >= absStart) {
      const full = editable.textContent || '';
      if (!originalText || full.slice(absStart, absEnd) === originalText) {
        r = rangeAt(absStart, absEnd);
      } else {
        const idx = full.indexOf(originalText);
        if (idx >= 0) r = rangeAt(idx, idx + originalText.length);
      }
    }
    if (!r) throw new Error('The selected text changed; select it again to replace.');
    const s = doc.getSelection?.() || getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const before = editable.textContent;
    const ok = doc.execCommand?.('insertText', false, to);
    if (!ok || (to !== originalText && editable.textContent === before)) {
      r.deleteContents();
      const tn = doc.createTextNode(to);
      r.insertNode(tn);
      r.setStartAfter(tn);
      r.collapse(true);
      s.removeAllRanges();
      s.addRange(r);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: to }));
    }
  };
}
// A text field's or editable element's selection, with how to replace it.
function fieldSelection(target) {
  if (typing(target)) {
    const { selectionStart: a, selectionEnd: b } = target;
    if (a == null || a === b) return null;
    const text = target.value.slice(a, b);
    return { text, replace: async (to) => { target.focus(); target.setSelectionRange(a, b); if (!document.execCommand('insertText', false, to)) target.setRangeText(to, a, b, 'end'); target.dispatchEvent(new Event('input', { bubbles: true })); } };
  }
  const editable = target.closest?.('[contenteditable="true"], [contenteditable=""]');
  const sel = getSelection();
  if (!sel?.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const text = sel.toString();
  if (!editable || !editable.contains(range.commonAncestorContainer)) return { text, replace: null };
  return { text, replace: editableReplacer(editable, range, text) };
}
const SKIP = '.sheet, .context-menu, .zh-ime, .pk-window-head, .hz-player, .hz-practice, svg';
export function installZhContext(doc = document) {
  doc.addEventListener('contextmenu', async (e) => {
    const t = e.target;
    if (e.defaultPrevented || e.shiftKey || !(t instanceof Element) || t.closest(SKIP)) return;
    const near = t;
    const sel = fieldSelection(t);
    if (sel && sel.text.trim()) {
      const { clientX: cx, clientY: cy } = e;
      const field = typing(t) || t.closest('[contenteditable="true"], [contenteditable=""]');
      if (hasHan(sel.text)) {
        e.preventDefault();
        const info = lookupable(sel.text) ? await lookupQuick(sel.text.trim()) : null;
        openContextMenu(cx, cy, [
          ...selectionEntries(sel.text, near, sel.replace, info), '-',
          field && sel.replace && { label: 'Cut', icon: 'scissors', key: 'Ctrl X', run: () => { navigator.clipboard?.writeText(sel.text); sel.replace(''); } },
          { label: 'Copy', icon: 'copy', key: 'Ctrl C', run: () => navigator.clipboard?.writeText(sel.text) },
        ].filter(Boolean), { title: 'Chinese', host: near.closest('dialog[open]') });
        return;
      }
      // Universal translation right-click menu for ANY selected text (favorites + language search + replace).
      e.preventDefault();
      openContextMenu(cx, cy, [
        translateEntry(sel.text.trim(), near, sel.replace),
        '-',
        field && sel.replace && { label: 'Cut', icon: 'scissors', key: 'Ctrl X', run: () => { navigator.clipboard?.writeText(sel.text); sel.replace(''); } },
        { label: 'Copy', icon: 'copy', key: 'Ctrl C', run: () => navigator.clipboard?.writeText(sel.text) },
      ].filter(Boolean), { title: 'Selection', host: near.closest('dialog[open]') });
      return;
    }
    if (typing(t)) {
      const pos = t.selectionStart;
      if (pos == null || !hasHan(t.value)) return;
      const c = charAround(t.value, pos) || charAround(t.value, pos - 1);
      if (!c || !HAN.test(c.char)) return;
      e.preventDefault();
      const { clientX: x, clientY: y } = e;
      const hit = { text: t.value, index: c.start };
      const ctx = (start, end, reading) => ({
        reading,
        replace: async (to) => {
          t.focus();
          t.setSelectionRange(start, end);
          if (!document.execCommand('insertText', false, to)) t.setRangeText(to, start, end, 'end');
          t.dispatchEvent(new Event('input', { bubbles: true }));
        },
      });
      const entries = await hitEntries(hit, ctx, near);
      if (!entries.length) return;
      openContextMenu(x, y, entries, { title: 'Chinese', host: near.closest('dialog[open]') });
      return;
    }
    const hit = htmlHit(e.clientX, e.clientY, doc);
    if (!hit) return;
    e.preventDefault();
    const { clientX: x, clientY: y } = e;
    const editable = t.closest('[contenteditable="true"], [contenteditable=""]');
    // In editable text (the notes): that occurrence can be converted.
    const ctx = (start, end, reading) => {
      if (!editable) return { reading };
      const base = hit.offset - (hit.index - start), node = hit.node;
      return { reading, replace: async (to) => {
        if (!node.isConnected || base < 0 || base + (end - start) > node.data.length) throw new Error('The text changed; look it up again.');
        const r = doc.createRange(); r.setStart(node, base); r.setEnd(node, base + (end - start));
        editable.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); doc.execCommand('insertText', false, to);
      } };
    };
    // A long press of a finger: the panel straight away.
    if (e.pointerType === 'touch') {
      const c = charAround(hit.text, hit.index), runs = await annotateQuick(hit.text), w = wordAround(runs, c.start);
      return lookUp(c.char, ctx(c.start, c.end, (w && w.pinyin?.[[...hit.text.slice(w.start, c.start)].length]) || ''), near);
    }
    const entries = await hitEntries(hit, ctx, near);
    if (!entries.length) return;
    openContextMenu(x, y, [
      ...entries,
      hasHan(hit.text) && host.addCards && [...hit.text].length > 1 && { label: 'Make vocabulary cards from this paragraph…', icon: 'cards', run: () => vocabFrom(hit.text, near) },
      sel?.text && '-', sel?.text && { label: 'Copy', icon: 'copy', key: 'Ctrl C', run: () => navigator.clipboard?.writeText(sel.text) },
    ].filter(Boolean), { title: 'Chinese', host: near.closest('dialog[open]') });
  });
}
