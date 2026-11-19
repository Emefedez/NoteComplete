// An array: a row of cells with their index under them and named pointers (i, j, pivot…)
// under the indexes. Marks by index; a set shows "old → new" over its cell; a swap slides the
// two cells (their hidden ids move with them). Also the heap's array (from position 1).
import { esc, markStyle, badge, changeText, keyed, r1, show, MONO, textWidth } from './theme.js';

const H = 34, TOP = 18;
export const cellWidth = (items) => Math.max(38, ...items.map((v) => textWidth(show(v), 13, true) + 14));

export function size(snap) {
  const items = snap.items || [];
  const w = cellWidth(items) * Math.max(1, items.length + (snap.nullFirst ? 1 : 0));
  const rows = Math.max(0, ...Object.values(groupPointers(snap.pointers)).map((names) => names.length));
  return { w: w + 2, h: TOP + H + 16 + (rows ? 14 + rows * 13 : 0) };
}
function groupPointers(pointers = {}) {
  const at = {};
  for (const [name, i] of Object.entries(pointers || {})) if (Number.isInteger(i)) (at[i] ||= []).push(name);
  return at;
}

// `prefix`: the key prefix (a heap draws its array under "a"). `base`: the first index shown.
export function draw(snap, { id, marks = {}, changes = [], c, prefix = '', hint = null }) {
  const items = snap.items || [], ids = snap.ids || [];
  const base = Number.isInteger(snap.base) ? snap.base : 0;
  const cw = hint?.cell || cellWidth(items);
  const first = snap.nullFirst ? 1 : 0;
  const parts = [];
  if (snap.nullFirst) {
    parts.push(`<rect x="1" y="${TOP}" width="${cw}" height="${H}" fill="${c.surface2}" stroke="${c.line}" stroke-width="1.2"/><text x="${r1(1 + cw / 2)}" y="${TOP + 21}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${c.faint}">null</text><text x="${r1(1 + cw / 2)}" y="${TOP + H + 13}" text-anchor="middle" font-family="${MONO}" font-size="10.5" fill="${c.faint}">0</text>`);
  }
  const sets = new Map(changes.filter((ch) => ch.op === 'set').map((ch) => [String(ch.path), ch]));
  const adds = new Set(changes.filter((ch) => ch.op === 'add').map((ch) => String(ch.path)));
  items.forEach((v, i) => {
    const index = i + base, x = 1 + (i + first) * cw;
    const mark = marks[String(index)] || (adds.has(String(index)) ? 'new' : '');
    const st = markStyle(mark, c);
    const t = show(v);
    let body = `<rect width="${r1(cw)}" height="${H}" fill="${st.fill}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 1.2}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text x="${r1(cw / 2)}" y="22" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="600" fill="${st.text}" data-v="${esc(t)}">${esc(t)}</text>`;
    const ch = sets.get(String(index));
    if (ch) body += badge(cw / 2, -3, changeText(ch), c, { anchor: 'middle' });
    parts.push(keyed(`${id}/${prefix}${ids[i] ?? i}`, x, TOP, body));
    parts.push(`<text x="${r1(x + cw / 2)}" y="${TOP + H + 13}" text-anchor="middle" font-family="${MONO}" font-size="10.5" fill="${c.muted}">${index}</text>`);
  });
  const at = groupPointers(snap.pointers);
  for (const [i, names] of Object.entries(at)) {
    const x = 1 + (Number(i) - base + first) * cw + cw / 2;
    parts.push(keyed(`${id}/p/${names.join(',')}`, x, TOP + H + 18, `<path d="M0 0 l-4 6 h8 z" fill="${c.accent}"/>${names.map((n, k) => `<text y="${17 + k * 13}" text-anchor="middle" font-family="${MONO}" font-size="11.5" font-weight="700" fill="${c.accent}">${esc(n)}</text>`).join('')}`));
  }
  const s = size(snap);
  return { w: Math.max(s.w, 1 + (items.length + first) * cw + 1), h: s.h, body: parts.join('') };
}
