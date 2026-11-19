// Trees: a binary tree { root: { id, label, left, right } } (a missing child of a node with
// one child is a small ghost dot, as in the course's drawings) or a general tree { root: { id,
// label, children } }. Leaves take one slot each; a parent sits over the middle of its
// children. Marks by node id; nodes are keyed by id, so they slide when the tree changes.
import { esc, markStyle, keyed, r1, show, FONT } from './theme.js';

const R = 16, DX = 42, DY = 54;

function place(root, binary) {
  const nodes = [], edges = [];
  let next = 0;
  const visit = (n, depth) => {
    let kids = [];
    if (binary) {
      const pair = [n.left || null, n.right || null];
      if (pair.some(Boolean)) kids = pair.map((k) => (k ? visit(k, depth + 1) : { x: next++, y: depth + 1, ghost: true }));
    } else kids = (n.children || []).filter(Boolean).map((k) => visit(k, depth + 1));
    const me = { n, x: kids.length ? (kids[0].x + kids.at(-1).x) / 2 : next++, y: depth };
    nodes.push(me);
    for (const k of kids) edges.push([me, k]);
    return me;
  };
  if (root) visit(root, 0);
  return { nodes, edges };
}
export function size(snap, binary) {
  const { nodes, edges } = place(snap.root, binary);
  const pts = [...nodes, ...edges.map(([, b]) => b)];
  if (!pts.length) return { w: 60, h: 40 };
  return { w: (Math.max(...pts.map((p) => p.x)) + 1) * DX + 8, h: (Math.max(...pts.map((p) => p.y)) + 1) * DY };
}
export function draw(snap, binary, { id, marks = {}, c }) {
  const { nodes, edges } = place(snap.root, binary);
  const px = (p) => DX / 2 + 4 + p.x * DX, py = (p) => R + 8 + p.y * DY;
  const parts = [];
  if (!nodes.length) parts.push(`<text x="20" y="26" font-family="${FONT}" font-size="15" fill="${c.muted}">∅</text>`);
  for (const [a, b] of edges) {
    parts.push(`<line x1="${r1(px(a))}" y1="${r1(py(a))}" x2="${r1(px(b))}" y2="${r1(py(b))}" stroke="${b.ghost ? c.faint : c.line}" stroke-width="1.5"${b.ghost ? ' stroke-dasharray="3 3"' : ''}/>`);
    if (b.ghost) parts.push(`<circle cx="${r1(px(b))}" cy="${r1(py(b))}" r="3.5" fill="none" stroke="${c.faint}"/>`);
  }
  for (const p of nodes) {
    const key = String(p.n.id ?? p.n.label), mark = marks[key] || '';
    const st = markStyle(mark, c), t = show(p.n.label ?? p.n.id);
    const r = t.length > 2 ? R + 4 : R;
    parts.push(keyed(`${id}/${key}`, px(p), py(p), `<circle r="${r}" fill="${st.fill}" stroke="${mark ? st.stroke : c.ink}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text y="4.5" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${st.text}">${esc(t)}</text>`));
  }
  const s = size(snap, binary);
  return { w: s.w, h: s.h, body: parts.join('') };
}
