// A hash table with separate chaining: one row per bucket (its index, then its chain of
// "key=value" boxes joined by arrows), and a line with size, capacity and load factor. Marks:
// a bucket by its index ("3"), an entry by its key ("k:Ana"). Entries keep their key as their
// id, so a rehash slides each one to its new bucket.
import { esc, markStyle, badge, changeText, keyed, r1, show, FONT, MONO, textWidth } from './theme.js';

const ROW = 30, BOX_H = 24, IDX = 34, HEAD = 22, ARROW = 18;
const entryW = (e) => Math.max(40, textWidth(`${show(e.k)}=${show(e.v)}`, 12, true) + 14);

export function hint(snaps) {
  return { rows: Math.max(1, ...snaps.map((s) => (s.buckets || []).length)), w: Math.max(120, ...snaps.flatMap((s) => (s.buckets || []).map((b) => b.reduce((n, e) => n + entryW(e) + ARROW, 0)))) };
}
export function size(snap, h = null) {
  const rows = h?.rows ?? (snap.buckets || []).length;
  const w = h?.w ?? Math.max(120, ...(snap.buckets || []).map((b) => b.reduce((n, e) => n + entryW(e) + ARROW, 0)));
  return { w: Math.max(250, IDX + 10 + w + 10), h: HEAD + Math.max(1, rows) * ROW + 4 };
}

export function draw(snap, { id, marks = {}, changes = [], c, hint: h = null }) {
  const buckets = snap.buckets || [];
  const s = size(snap, h);
  const parts = [];
  const lf = Number(snap.loadFactor) || 0, max = Number(snap.maxLoad) || 0;
  const over = max && lf > max;
  parts.push(`<text x="0" y="13" font-family="${FONT}" font-size="11.5" fill="${c.muted}">size <tspan font-family="${MONO}" fill="${c.ink}" font-weight="600">${esc(show(snap.size))}</tspan> · capacity <tspan font-family="${MONO}" fill="${c.ink}" font-weight="600">${buckets.length}</tspan> · load factor <tspan font-family="${MONO}" fill="${over ? c.bad : c.ink}" font-weight="600">${lf.toFixed(2)}</tspan>${max ? ` (max ${max})` : ''}</text>`);
  const byPath = new Map(changes.filter((ch) => Array.isArray(ch.path)).map((ch) => [ch.path.join(','), ch]));
  buckets.forEach((chain, i) => {
    const y = HEAD + i * ROW;
    const bm = marks[String(i)] || '';
    const bs = markStyle(bm, c);
    parts.push(`<rect x="0" y="${y}" width="${IDX}" height="${BOX_H}" rx="3" fill="${bm ? bs.fill : c.surface2}" stroke="${bm ? bs.stroke : c.line}" stroke-width="${bm ? bs.width : 1.2}"/><text x="${IDX / 2}" y="${y + 16.5}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${bm ? bs.text : c.muted}" font-weight="600">${i}</text>`);
    let x = IDX;
    if (!chain.length) parts.push(`<text x="${IDX + 8}" y="${y + 16.5}" font-family="${MONO}" font-size="12" fill="${c.faint}">∅</text>`);
    chain.forEach((e, j) => {
      parts.push(`<path d="M${x + 2} ${y + BOX_H / 2} h${ARROW - 7}" stroke="${c.muted}" stroke-width="1.3"/><path d="M${x + ARROW - 1} ${y + BOX_H / 2} l-6 -3.5 v7 z" fill="${c.muted}"/>`);
      x += ARROW;
      const w = entryW(e);
      const ch = byPath.get(`${i},${j}`);
      const mark = marks[`k:${e.k}`] || (ch?.op === 'add' ? 'new' : '');
      const st = markStyle(mark, c);
      let body = `<rect width="${r1(w)}" height="${BOX_H}" rx="4" fill="${st.fill}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 1.2}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text x="${r1(w / 2)}" y="16.5" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="600" fill="${st.text}">${esc(show(e.k))}=${esc(show(e.v))}</text>`;
      if (ch?.op === 'set') body += badge(w / 2, -2, changeText(ch), c, { anchor: 'middle' });
      parts.push(keyed(`${id}/k:${show(e.k)}`, x, y, body));
      x += w;
    });
  });
  return { w: s.w, h: s.h, body: parts.join('') };
}
