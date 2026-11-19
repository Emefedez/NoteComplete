// A map (a two-column table: key, value; marks and changes by key) and a set (chips in a
// row that wraps; marks by item). Rows and chips are keyed by their key, so they slide when
// one before them leaves.
import { esc, markStyle, badge, changeText, keyed, r1, show, FONT, MONO, textWidth } from './theme.js';

const ROW = 24, HEAD = 20, BADGE = 70; // room on the right for an "old → new" badge
const colW = (list) => Math.max(44, ...list.map((v) => textWidth(show(v), 12.5, true) + 16));

// Entries as [key, value] pairs ({ k, v } objects too: the Java layer's).
const pairs = (snap) => (snap.entries || []).map((e) => (Array.isArray(e) ? e : [e?.k ?? e?.key, e?.v ?? e?.value]));
export function mapHint(snaps) {
  const all = snaps.flatMap(pairs);
  return { n: Math.max(1, ...snaps.map((s) => pairs(s).length)), kw: colW(all.map(([k]) => k)), vw: colW(all.map(([, v]) => v)) };
}
export function mapSize(snap, h = null) {
  const e = pairs(snap);
  const kw = h?.kw ?? colW(e.map(([k]) => k)), vw = h?.vw ?? colW(e.map(([, v]) => v));
  return { w: kw + vw + 2 + BADGE, h: HEAD + Math.max(1, h?.n ?? e.length) * ROW + 2 };
}
export function drawMap(snap, { id, marks = {}, changes = [], c, hint: h = null }) {
  const e = pairs(snap);
  const kw = h?.kw ?? colW(e.map(([k]) => k)), vw = h?.vw ?? colW(e.map(([, v]) => v));
  const s = mapSize(snap, h);
  const parts = [`<rect x="1" y="1" width="${r1(kw + vw)}" height="${HEAD - 2}" fill="${c.surface2}"/><text x="${r1(1 + kw / 2)}" y="14" text-anchor="middle" font-family="${FONT}" font-size="10.5" fill="${c.muted}">key</text><text x="${r1(1 + kw + vw / 2)}" y="14" text-anchor="middle" font-family="${FONT}" font-size="10.5" fill="${c.muted}">value</text>`];
  const byKey = new Map(changes.map((ch) => [show(ch.path), ch]));
  if (!e.length) parts.push(`<text x="6" y="${HEAD + 16}" font-family="${FONT}" font-size="12.5" fill="${c.muted}">empty</text>`);
  e.forEach(([k, v], i) => {
    const ch = byKey.get(show(k));
    const mark = marks[show(k)] || (ch?.op === 'add' ? 'new' : '');
    const st = markStyle(mark, c);
    let body = `<rect width="${r1(kw + vw)}" height="${ROW}" fill="${mark ? st.fill : c.surface}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 1}"/><line x1="${r1(kw)}" y1="0" x2="${r1(kw)}" y2="${ROW}" stroke="${c.line}"/><text x="${r1(kw / 2)}" y="16.5" text-anchor="middle" font-family="${MONO}" font-size="12.5" font-weight="600" fill="${st.text}">${esc(show(k))}</text><text x="${r1(kw + vw / 2)}" y="16.5" text-anchor="middle" font-family="${MONO}" font-size="12.5" fill="${st.text}" data-v="${esc(show(v))}">${esc(show(v))}</text>`;
    if (ch?.op === 'set') body += badge(kw + vw + 5, 17, changeText(ch), c);
    parts.push(keyed(`${id}/${show(k)}`, 1, HEAD + i * ROW, body));
  });
  return { w: s.w, h: s.h, body: parts.join('') };
}

const CHIP_H = 24, PER_ROW_W = 360;
function chips(items) {
  let x = 0, y = 0;
  return items.map((v) => {
    const w = Math.max(28, textWidth(show(v), 12.5, true) + 16);
    if (x && x + w > PER_ROW_W) { x = 0; y += CHIP_H + 6; }
    const at = { v, x, y, w };
    x += w + 6;
    return at;
  });
}
export function setHint(snaps) {
  const most = snaps.reduce((a, s) => ((s.items || []).length > a.length ? s.items : a), []);
  const all = chips(most);
  return { h: all.length ? all.at(-1).y + CHIP_H : CHIP_H, w: Math.max(60, ...snaps.map((s) => { const cs = chips(s.items || []); return cs.length ? Math.max(...cs.map((q) => q.x + q.w)) : 60; })) };
}
export function setSize(snap, h = null) {
  const cs = chips(snap.items || []);
  return { w: Math.max(h?.w ?? 0, 60, ...cs.map((q) => q.x + q.w)) + 4, h: Math.max(h?.h ?? 0, cs.length ? cs.at(-1).y + CHIP_H : CHIP_H) + 4 };
}
export function drawSet(snap, { id, marks = {}, changes = [], c, hint: h = null }) {
  const cs = chips(snap.items || []);
  const added = new Set(changes.filter((ch) => ch.op === 'add').map((ch) => show(ch.path)));
  const parts = [];
  if (!cs.length) parts.push(`<text x="2" y="17" font-family="${FONT}" font-size="12.5" fill="${c.muted}">{ } empty</text>`);
  for (const q of cs) {
    const mark = marks[show(q.v)] || (added.has(show(q.v)) ? 'new' : '');
    const st = markStyle(mark, c);
    parts.push(keyed(`${id}/${show(q.v)}`, q.x + 1, q.y + 1, `<rect width="${r1(q.w)}" height="${CHIP_H}" rx="12" fill="${mark ? st.fill : c.surface2}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 1.1}"/><text x="${r1(q.w / 2)}" y="16.5" text-anchor="middle" font-family="${MONO}" font-size="12.5" font-weight="600" fill="${st.text}">${esc(show(q.v))}</text>`));
  }
  const s = setSize(snap, h);
  return { w: s.w, h: s.h, body: parts.join('') };
}
