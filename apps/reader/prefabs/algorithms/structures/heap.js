// A binary heap as the course draws it: the tree (the parent of position i is i/2) over its
// array (position 0 unused, null). Marks and changes by position (1-based). A swap slides the
// two values in the tree and in the array at once.
import { esc, markStyle, badge, changeText, keyed, r1, show, FONT, textWidth } from './theme.js';
import * as array from './array.js';

const R = 16, DY = 50, SLOT = 40;
const depthOf = (n) => (n > 0 ? Math.floor(Math.log2(n)) + 1 : 1);

// The largest heap of the run sets the tree's width, so nodes stay put from step to step.
export function hint(snaps) {
  const n = Math.max(1, ...snaps.map((s) => (s.items || []).length));
  const cell = Math.max(38, ...snaps.flatMap((s) => (s.items || []).map((v) => textWidth(show(v), 13, true) + 14)));
  return { n, cell };
}
function geometry(n, cell, items) {
  const depth = depthOf(n), leaves = 2 ** (depth - 1);
  const treeW = Math.max(leaves * SLOT, (n + 1) * cell + 2);
  return { depth, treeW, treeH: depth * DY, arrW: (items + 1) * cell + 2 };
}
export function size(snap, h = null) {
  const n = h?.n || (snap.items || []).length, cell = h?.cell || array.cellWidth(snap.items || []);
  const g = geometry(n, cell, n);
  return { w: Math.max(g.treeW, g.arrW), h: g.treeH + 10 + array.size({ items: Array(n).fill(0), nullFirst: true }).h };
}

export function draw(snap, { id, marks = {}, changes = [], c, hint: h = null }) {
  const items = snap.items || [], ids = snap.ids || [];
  const n = Math.max(items.length, h?.n || 0), cell = h?.cell || array.cellWidth(items);
  const g = geometry(n, cell, n);
  const at = (p) => {
    const level = Math.floor(Math.log2(p)), k = p - 2 ** level, span = g.treeW / 2 ** level;
    return { x: span * (k + 0.5), y: R + 8 + level * DY };
  };
  const parts = [];
  const sets = new Map(changes.filter((ch) => ch.op === 'set').map((ch) => [String(ch.path), ch]));
  const adds = new Set(changes.filter((ch) => ch.op === 'add').map((ch) => String(ch.path)));
  for (let p = 2; p <= items.length; p++) {
    const a = at(Math.floor(p / 2)), b = at(p);
    parts.push(`<line x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" stroke="${c.line}" stroke-width="1.5"/>`);
  }
  if (!items.length) parts.push(`<text x="${r1(g.treeW / 2)}" y="${R + 14}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${c.muted}">empty</text>`);
  items.forEach((v, i) => {
    const p = i + 1, { x, y } = at(p);
    const mark = marks[String(p)] || (adds.has(String(p)) ? 'new' : '');
    const st = markStyle(mark, c);
    const t = show(v);
    const r = t.length > 2 ? R + 4 : R;
    let body = `<circle r="${r}" fill="${st.fill}" stroke="${mark ? st.stroke : c.ink}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text y="4.5" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${st.text}" data-v="${esc(t)}">${esc(t)}</text>`;
    const ch = sets.get(String(p));
    if (ch) body += badge(0, -r - 3, changeText(ch), c, { anchor: 'middle' });
    parts.push(keyed(`${id}/t/${ids[i] ?? p}`, x, y, body));
  });
  const arr = array.draw({ items, ids, base: 1, nullFirst: true }, { id, marks, changes, c, prefix: 'a/', hint: { cell } });
  parts.push(`<g transform="translate(0 ${g.treeH + 6})">${arr.body}</g>`);
  const s = size(snap, { n, cell });
  return { w: s.w, h: s.h, body: parts.join('') };
}
