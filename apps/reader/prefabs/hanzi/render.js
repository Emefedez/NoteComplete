// The hanzi module (docs/CHINESE-INPUT.md §7.3): stroke order of Chinese characters as a picture.
// Pure (no DOM): the page, the picker, MCP add_prefab and exams draw it. The spec carries the
// stroke data of its characters (`data`, hanzi-writer-data's shape, Arphic Public License), so
// it draws anywhere without the stroke packs; `prepare(spec)` fills it in (editor, MCP).
//   { type: "hanzi", text: "你好", pinyin: "ni3 hao3", show: "strokes" | "numbers" | "steps",
//     step: null | n, grid: "mi" | "tian" | "none", outline: true, colour: "#1f2328", data }
import { glyphSvg, gridSvg } from '../../chinese/stroke-svg.js';
import { numbersToMarks } from '../../chinese/pinyin.js';
import { escapeHtml } from '../kit/svg.js';

export const MAX_CHARS = 12, SHOWS = ['strokes', 'numbers', 'steps'], GRIDS = ['mi', 'tian', 'none'];
const ACTIVE = '#d1242f', PER_ROW = 10;
const isHan = (c) => /\p{Script=Han}/u.test(c);
const PATH = /^[MLQCZmlqcz0-9 .,-]*$/;
const goodData = (d) => d && Array.isArray(d.strokes) && Array.isArray(d.medians) && d.strokes.length && d.strokes.length === d.medians.length
  && d.strokes.every((s) => typeof s === 'string' && PATH.test(s))
  && d.medians.every((m) => Array.isArray(m) && m.length && m.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));

export function normalize(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const text = [...String(s.text ?? '你好')].filter((c) => c.trim()).slice(0, MAX_CHARS).join('');
  const data = {};
  for (const c of new Set(text)) if (goodData(s.data?.[c])) data[c] = { strokes: s.data[c].strokes, medians: s.data[c].medians, ...(Array.isArray(s.data[c].radStrokes) ? { radStrokes: s.data[c].radStrokes.filter(Number.isInteger) } : {}) };
  const step = s.step === null || s.step === undefined || s.step === '' || !Number.isFinite(Number(s.step)) ? null : Math.max(0, Math.round(Number(s.step)));
  return {
    ...s,
    type: 'hanzi',
    text,
    pinyin: numbersToMarks(String(s.pinyin ?? '').slice(0, 200)).trim(),
    gloss: String(s.gloss ?? '').slice(0, 1200).trim(),
    variants: String(s.variants ?? '').slice(0, 160).trim(),
    script: s.script === 'traditional' ? 'traditional' : 'simplified',
    show: SHOWS.includes(s.show) ? s.show : 'strokes',
    step,
    grid: GRIDS.includes(s.grid) ? s.grid : 'mi',
    outline: s.outline !== false,
    colour: /^#[0-9a-f]{3,8}$/i.test(s.colour || '') ? s.colour : '#1f2328',
    data,
  };
}
export const name = (spec) => { const t = normalize(spec).text; return t ? `Stroke order ${t}` : 'Stroke order'; };
// Total strokes of the characters that have data.
export const strokeCount = (spec) => { const m = normalize(spec); return [...m.text].reduce((n, c) => n + (m.data[c]?.strokes.length || 0), 0); };
// One pinyin syllable per Han character when the counts match, else the whole reading.
export function pinyinFor(m) {
  const han = [...m.text].filter(isHan).length, parts = m.pinyin.split(/[\s'’]+/).filter(Boolean);
  if (parts.length === han && han) { let k = 0; return [...m.text].map((c) => (isHan(c) ? parts[k++] : '')); }
  return null;
}

// Fills `data` for characters that have none (strokes.js: the shards, or jsDelivr). Async; not
// part of drawing.
export async function prepare(spec) {
  const m = normalize(spec);
  const missing = [...new Set(m.text)].filter((c) => isHan(c) && !m.data[c]);
  if (!missing.length) return m;
  const { strokesFor } = await import('../../chinese/strokes.js');
  return { ...m, data: { ...m.data, ...(await strokesFor(missing.join('')).catch(() => ({}))) } };
}

// How many meanings go on the page by default (all of them are in the editor's "All meanings").
export const PAGE_GLOSSES = 3;
// The meanings a page shows: the first few, without repeats ("hello; hi; how are you").
export const pageGloss = (glosses, n = PAGE_GLOSSES) => [...new Set(glosses.filter(Boolean))].slice(0, n).join('; ');

// Enriches a hanzi spec with stroke data, pinyin, English equivalents (gloss) and variants from
// the dictionary. `dictionaryFor` also gives back the look-up itself ({ entries, char }), for the
// editor's list of every meaning; `prepareWithDict` only the spec.
export async function dictionaryFor(spec) {
  let m = await prepare(spec);
  if (!m.text) return { spec: m, lookup: null };
  let lk = null;
  try {
    const { chinese } = await import('../../chinese/client.js');
    const client = chinese();
    const [runs, found] = await Promise.all([
      !m.pinyin ? client.annotate(m.text, { script: m.script }).catch(() => []) : Promise.resolve([]),
      client.lookup(m.text, { script: m.script }).catch(() => null),
    ]);
    // Meanings in the language of the es | en toggle (chinese/translate.js).
    const { localizeLookup, zhLang } = await import('../../chinese/translate.js');
    lk = await localizeLookup(found, zhLang()).catch(() => found);
    let pinyin = m.pinyin;
    if (!pinyin && runs?.length) {
      pinyin = runs.flatMap((r) => r.pinyin || []).join(' ');
    }
    if (!pinyin && lk?.entries?.length) {
      pinyin = lk.entries[0].pinyin || '';
    }
    let gloss = m.gloss;
    let variants = m.variants;
    if (lk?.entries?.length) {
      if (!gloss) {
        const entryGlosses = lk.entries.flatMap((e) => (e.gloss || []).flatMap((g) => String(g).split(/\s*;\s*/))).filter(Boolean);
        gloss = pageGloss(entryGlosses.length ? entryGlosses : String(lk.char?.definition || '').split(/\s*[;,]\s*/).filter(Boolean));
      }
      if (!variants) {
        const simp = new Set(), trad = new Set(), other = new Set();
        for (const e of lk.entries) {
          if (e.simp && e.simp !== m.text) simp.add(e.simp);
          if (e.trad && e.trad !== m.text) trad.add(e.trad);
        }
        const v = lk.char?.variants || {};
        for (const c of [...(v.simp || '')]) if (c !== m.text) simp.add(c);
        for (const c of [...(v.trad || '')]) if (c !== m.text) trad.add(c);
        for (const c of [...(v.other || '')]) if (c !== m.text && !simp.has(c) && !trad.has(c)) other.add(c);
        const parts = [];
        if (simp.size) parts.push(`简体: ${[...simp].join(' ')}`);
        if (trad.size) parts.push(`繁體: ${[...trad].join(' ')}`);
        if (other.size) parts.push(`異體: ${[...other].join(' ')}`);
        variants = parts.join(' · ');
      }
    } else if (!gloss && lk?.char?.definition) {
      gloss = pageGloss(String(lk.char.definition).split(/\s*[;,]\s*/).filter(Boolean));
    } else if (!gloss && runs?.length) {
      const glosses = runs.map((r) => r.gloss?.[0]).filter(Boolean);
      if (glosses.length) gloss = glosses.join(' · ');
    }
    m = normalize({ ...m, pinyin, gloss, variants });
  } catch { /* Dictionary worker unavailable in headless/offline fallback */ }
  return { spec: m, lookup: lk };
}
export async function prepareWithDict(spec) {
  return (await dictionaryFor(spec)).spec;
}

// The caption under the characters as lines of at most `chars` characters, broken between
// words, at most `max` lines (the last one ends in … when there was more).
export function wrapCaption(text, chars, max = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > chars) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1], cut = last.length < chars ? last.length : last.lastIndexOf(' ') > 0 ? last.lastIndexOf(' ') : chars - 1;
  kept[max - 1] = `${last.slice(0, cut).replace(/[\s;,·]+$/, '')}…`;
  return kept;
}

export function render(spec, { size: cellSize } = {}) {
  const m = normalize(spec);
  const chars = [...m.text];
  if (!chars.length) return null;
  const S = cellSize || 120, gap = Math.round(S / 10), pad = Math.round(S / 12);
  const each = pinyinFor(m), band = m.pinyin ? Math.round(S * 0.3) : 0;
  const fallback = (c, x, y, size) => `<text x="${x + size / 2}" y="${y + size * 0.8}" font-size="${Math.round(size * 0.78)}" text-anchor="middle" fill="#9aa1ab" font-family="'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeHtml(c)}</text>`;
  const pin = (text, x, y, w) => `<text x="${x + w / 2}" y="${y}" font-size="${Math.round(S * 0.2)}" text-anchor="middle" fill="#3d444d" font-family="Arial, 'Noto Sans', sans-serif">${escapeHtml(text)}</text>`;
  // Strokes shown in each character for the spec's step (null: all).
  let left = m.step === null ? Infinity : m.step;
  const shown = chars.map((c) => { const n = m.data[c]?.strokes.length || 0, k = Math.min(n, left); left -= k; return k; });
  const lastDrawn = m.step === null ? -1 : shown.reduce((last, k, i) => (k > 0 ? i : last), -1);
  const glyph = (c, i, x, y, size, done, highlight) => {
    const d = m.data[c];
    if (!d) return fallback(c, x, y, size);
    return glyphSvg(d, { x, y, size, done: highlight ? done - 1 : done, current: highlight ? { index: done - 1, t: 1 } : null, outline: m.outline, numbers: m.show === 'numbers', colour: m.colour, active: ACTIVE, id: `hz${i}` });
  };
  const parts = [];
  let width, height;
  if (m.show !== 'steps') {
    width = pad * 2 + chars.length * S + (chars.length - 1) * gap;
    height = pad * 2 + band + S;
    if (m.pinyin && !each) parts.push(pin(m.pinyin, pad, pad + band * 0.72, width - 2 * pad));
    chars.forEach((c, i) => {
      const x = pad + i * (S + gap), y = pad + band;
      if (each?.[i]) parts.push(pin(each[i], x, pad + band * 0.72, S));
      parts.push(gridSvg(x, y, S, m.grid), glyph(c, i, x, y, S, shown[i], i === lastDrawn && shown[i] > 0));
    });
  } else {
    // A row per character: the character, then the classic sequence 1, 1–2, 1–3 … beside it.
    const s = Math.round(S * 0.42), sg = Math.max(2, Math.round(s / 12));
    const most = Math.max(1, ...chars.map((c) => m.data[c]?.strokes.length || 0));
    const cols = Math.min(PER_ROW, most);
    width = pad * 2 + S + gap * 2 + cols * (s + sg) - sg;
    let y = pad;
    if (m.pinyin && !each) { parts.push(pin(m.pinyin, pad, y + band * 0.72, S)); }
    chars.forEach((c, i) => {
      const n = m.data[c]?.strokes.length || 0, rows = Math.max(1, Math.ceil(n / PER_ROW));
      const top = y + band;
      if (each?.[i]) parts.push(pin(each[i], pad, y + band * 0.72, S));
      parts.push(gridSvg(pad, top, S, m.grid), glyph(c, i, pad, top, S, shown[i], i === lastDrawn && shown[i] > 0));
      for (let k = 1; k <= n; k++) {
        const col = (k - 1) % PER_ROW, row = Math.floor((k - 1) / PER_ROW);
        const x = pad + S + gap * 2 + col * (s + sg), yy = top + row * (s + sg);
        parts.push(gridSvg(x, yy, s, m.grid === 'none' ? 'none' : 'tian', '#ecc4c4'), glyphSvg(m.data[c], { x, y: yy, size: s, done: k - 1, current: { index: k - 1, t: 1 }, outline: false, colour: m.colour, active: ACTIVE, id: `hz${i}s${k}` }));
      }
      y = top + Math.max(S, rows * (s + sg) - sg) + gap;
    });
    height = y - gap + pad;
  }
  if (m.gloss || m.variants) {
    // The meanings, then the other forms, wrapped to the picture's width (widened up to 680 for
    // a short picture) in at most three lines each, so a long definition is never cut off.
    const fontSize = Math.max(12, Math.round(S * 0.14)), charW = fontSize * 0.56, lineH = Math.round(fontSize * 1.3);
    const longest = Math.max(m.gloss.length, m.variants.length);
    width = Math.max(width, Math.min(680, Math.round(longest * charW + pad * 2)));
    const perLine = Math.max(8, Math.floor((width - pad * 2) / charW));
    const lines = [...(m.gloss ? wrapCaption(m.gloss, perLine) : []), ...(m.variants ? wrapCaption(m.variants, perLine, 1) : [])];
    const font = `font-size="${fontSize}" fill="#3d444d" font-family="Arial, 'Noto Sans', 'Noto Sans SC', sans-serif"`;
    lines.forEach((line, i) => parts.push(`<text x="${pad}" y="${height + Math.round(fontSize * 0.85) + i * lineH}" ${font}>${escapeHtml(line)}</text>`));
    height += fontSize + (lines.length - 1) * lineH + Math.round(pad * 1.1);
  }
  width = Math.round(width); height = Math.round(height);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`, width, height };
}
