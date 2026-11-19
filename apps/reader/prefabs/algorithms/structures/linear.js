// Queues, stacks, deques and priority queues: boxes in a row (a queue: front on the left; a
// priority queue: in its order, each "key:prio") or a column (a stack: top first; "sized"
// stacks are discs, as the towers of Hanoi). Items keep their ids, so they slide in and out.
import { esc, markStyle, keyed, r1, show, FONT, MONO, textWidth } from './theme.js';

const H = 30, GAP = 6, TOP = 4;
const text = (kind, v) => (kind === 'pq' ? `${show(v.key)}:${show(v.prio)}` : show(v));
const boxW = (kind, items) => Math.max(34, ...items.map((v) => textWidth(text(kind, v), 12.5, true) + 14));

export function hint(snaps, kind) {
  return { n: Math.max(1, ...snaps.map((s) => (s.items || []).length)), w: Math.max(34, ...snaps.map((s) => boxW(kind, s.items || []))), max: Math.max(1, ...snaps.flatMap((s) => (s.items || []).map((v) => Math.abs(+v) || 1))) };
}
export function size(snap, kind, h = null) {
  const n = h?.n ?? (snap.items || []).length, w = h?.w ?? boxW(kind, snap.items || []);
  if (kind === 'stack' && snap.sized) { const dw = Math.max(120, (h?.max || 1) * 18 + 30); return { w: dw + 4, h: Math.max(1, n) * (22 + 3) + 18 }; }
  if (kind === 'stack') return { w: w + 44, h: Math.max(1, n) * (H + 3) + TOP + 4 };
  return { w: Math.max(1, n) * (w + GAP) + 64, h: H + TOP + 22 };
}

export function draw(snap, kind, { id, marks = {}, changes = [], c, hint: h = null }) {
  const items = snap.items || [], ids = snap.ids || [];
  const adds = new Set(changes.filter((ch) => ch.op === 'add').map((ch) => String(ch.path)));
  const w = h?.w ?? boxW(kind, items);
  const s = size(snap, kind, h);
  const parts = [];
  const styleOf = (i) => {
    const mark = marks[String(i)] || (adds.has(String(i)) ? 'new' : '');
    return [mark, markStyle(mark, c)];
  };
  if (kind === 'stack' && snap.sized) {
    // Discs on a peg: the bottom of the stack at the foot.
    const peg = s.w / 2, foot = s.h - 6, unit = (s.w - 30) / Math.max(1, h?.max || Math.max(1, ...items.map((v) => +v || 1)));
    parts.push(`<rect x="${r1(peg - 3)}" y="6" width="6" height="${r1(foot - 6)}" rx="3" fill="${c.line}"/><rect x="4" y="${r1(foot)}" width="${r1(s.w - 8)}" height="5" rx="2" fill="${c.line}"/>`);
    items.forEach((v, i) => {
      const [mark, st] = styleOf(i);
      const dw = 22 + unit * (Math.abs(+v) || 1), y = foot - (i + 1) * 25;
      parts.push(keyed(`${id}/${ids[i] ?? i}`, peg, y, `<rect x="${r1(-dw / 2)}" y="1" width="${r1(dw)}" height="22" rx="7" fill="${mark ? st.fill : c.accentSoft}" stroke="${mark ? st.stroke : c.accent}" stroke-width="${mark ? st.width : 1.4}"/><text y="16.5" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="700" fill="${mark ? st.text : c.ink}">${esc(show(v))}</text>`));
    });
    return { w: s.w, h: s.h, body: parts.join('') };
  }
  if (kind === 'stack') {
    // Top first: the last item is drawn at the top of the column.
    const n = items.length;
    if (!n) parts.push(`<text x="4" y="22" font-family="${FONT}" font-size="12.5" fill="${c.muted}">empty</text>`);
    items.forEach((v, i) => {
      const [mark, st] = styleOf(i);
      const y = TOP + (n - 1 - i) * (H + 3);
      parts.push(keyed(`${id}/${ids[i] ?? i}`, 1, y, `<rect width="${r1(w)}" height="${H}" rx="4" fill="${st.fill}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 1.2}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text x="${r1(w / 2)}" y="20" text-anchor="middle" font-family="${MONO}" font-size="12.5" font-weight="600" fill="${st.text}">${esc(show(v))}</text>`));
    });
    if (n) parts.push(`<text x="${r1(w + 8)}" y="${TOP + 20}" font-family="${FONT}" font-size="11" fill="${c.muted}">← top</text>`);
    return { w: s.w, h: s.h, body: parts.join('') };
  }
  // A row: the front (or the smallest priority) on the left.
  const left = kind === 'pq' ? 0 : 40;
  if (kind !== 'pq') parts.push(`<text x="0" y="${TOP + 19}" font-family="${FONT}" font-size="10.5" fill="${c.muted}">front</text>`);
  if (!items.length) parts.push(`<text x="${left + 4}" y="${TOP + 19}" font-family="${FONT}" font-size="12.5" fill="${c.muted}">empty</text>`);
  items.forEach((v, i) => {
    const [mark, st] = styleOf(i);
    parts.push(keyed(`${id}/${ids[i] ?? i}`, left + i * (w + GAP), TOP, `<rect width="${r1(w)}" height="${H}" rx="4" fill="${st.fill}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 1.2}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text x="${r1(w / 2)}" y="20" text-anchor="middle" font-family="${MONO}" font-size="12.5" font-weight="600" fill="${st.text}">${esc(text(kind, v))}</text>`));
  });
  if (kind !== 'pq' && items.length) parts.push(`<text x="${r1(left + items.length * (w + GAP))}" y="${TOP + 19}" font-family="${FONT}" font-size="10.5" fill="${c.muted}">back</text>`);
  return { w: s.w, h: s.h, body: parts.join('') };
}
