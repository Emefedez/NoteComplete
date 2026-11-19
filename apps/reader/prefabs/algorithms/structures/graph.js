// A graph: nodes where the input (or the layout, once) put them, edges as lines (arrows when
// directed, curved when both directions exist), weights on the edges, a node's value (a
// distance…) beside it. Marks: nodes by id, edges by "from-to" (either order when undirected).
import { esc, markStyle, badge, changeText, keyed, r1, show, FONT, MONO, textWidth } from './theme.js';

export const R = 17;
const PAD = R + 22;

// Positions for nodes that have none: on a circle, in their order (stable for the same input).
export function layoutGraph(nodes) {
  const n = nodes.length, radius = Math.max(70, n * 22);
  nodes.forEach((node, i) => {
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) return;
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
    node.x = Math.round(radius + radius * Math.cos(a));
    node.y = Math.round(radius + radius * Math.sin(a));
  });
  return nodes;
}

// Nodes without a place (the Java layer's graphs): one place each for the whole run, on a
// circle in the order they first appear, so they stay put while the graph grows.
export function hint(snaps) {
  const ids = [];
  for (const s of snaps) for (const n of s.nodes || []) if (!(Number.isFinite(n.x) && Number.isFinite(n.y)) && !ids.includes(String(n.id))) ids.push(String(n.id));
  if (!ids.length) return null;
  const at = layoutGraph(ids.map((id) => ({ id })));
  return { places: Object.fromEntries(at.map((n) => [n.id, [n.x, n.y]])) };
}
const placedNodes = (snap, h) => (snap.nodes || []).map((n) => (Number.isFinite(n.x) && Number.isFinite(n.y) ? n : { ...n, x: h?.places?.[n.id]?.[0] ?? 0, y: h?.places?.[n.id]?.[1] ?? 0 }));
function frame(snap, h = null) {
  const nodes = placedNodes(snap, h);
  if (h?.places && nodes.length) {
    // The run's whole circle, so the frame does not change as nodes come.
    const all = [...nodes, ...Object.values(h.places).map(([x, y]) => ({ x, y }))];
    const minX = Math.min(...all.map((n) => n.x)), minY = Math.min(...all.map((n) => n.y));
    return { dx: PAD - minX, dy: PAD - minY, w: Math.max(...all.map((n) => n.x)) - minX + 2 * PAD + 14, h: Math.max(...all.map((n) => n.y)) - minY + 2 * PAD };
  }
  if (!nodes.length) return { dx: PAD, dy: PAD, w: 2 * PAD, h: 2 * PAD };
  const xs = nodes.map((n) => +n.x || 0), ys = nodes.map((n) => +n.y || 0);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { dx: PAD - minX, dy: PAD - minY, w: Math.max(...xs) - minX + 2 * PAD + 14, h: Math.max(...ys) - minY + 2 * PAD };
}

export function size(snap, h = null) { const f = frame(snap, h); return { w: f.w, h: f.h }; }

const edgeKey = (e) => `${e.from}-${e.to}`;
function edgeMark(marks, e, directed) {
  return marks[edgeKey(e)] || (!directed ? marks[`${e.to}-${e.from}`] : '') || '';
}

export function draw(snap, { id, marks = {}, changes = [], c, hint: h = null }) {
  const f = frame(snap, h);
  const byId = new Map(placedNodes(snap, h).map((n) => [String(n.id), { ...n, id: String(n.id), x: (+n.x || 0) + f.dx, y: (+n.y || 0) + f.dy }]));
  const edges = (snap.edges || []).map((e) => ({ ...e, from: String(e.from), to: String(e.to) })).filter((e) => byId.has(e.from) && byId.has(e.to));
  const parts = [];
  const labels = [];
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    const directed = e.directed ?? snap.directed;
    const both = directed && edges.some((o) => o.from === e.to && o.to === e.from);
    const m = edgeMark(marks, e, directed);
    const colour = { path: c.ok, current: c.accent, visited: c.accent, compare: c.hint, done: c.faint, removed: c.faint, error: c.bad, new: c.ok, queued: c.accent }[m] || c.line;
    const width = { path: 4, current: 3.4, compare: 3, visited: 2.4, new: 3, error: 3 }[m] || 1.6;
    const dash = m === 'removed' || m === 'queued' ? ' stroke-dasharray="5 4"' : '';
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const sx = a.x + ux * R, sy = a.y + uy * R, ex = b.x - ux * (R + (directed ? 2 : 0)), ey = b.y - uy * (R + (directed ? 2 : 0));
    let d, mx, my, tx = ux, ty = uy;
    if (both) {
      const cx = (sx + ex) / 2 - uy * 26, cy = (sy + ey) / 2 + ux * 26;
      d = `M${r1(sx)} ${r1(sy)} Q${r1(cx)} ${r1(cy)} ${r1(ex)} ${r1(ey)}`;
      mx = 0.25 * sx + 0.5 * cx + 0.25 * ex; my = 0.25 * sy + 0.5 * cy + 0.25 * ey;
      const tl = Math.hypot(ex - cx, ey - cy) || 1; tx = (ex - cx) / tl; ty = (ey - cy) / tl;
    } else {
      d = `M${r1(sx)} ${r1(sy)} L${r1(ex)} ${r1(ey)}`;
      mx = (sx + ex) / 2; my = (sy + ey) / 2;
    }
    parts.push(`<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"${dash}/>`);
    if (directed) {
      const s = 9 + width, px = -ty, py = tx;
      parts.push(`<path d="M${r1(ex)} ${r1(ey)} L${r1(ex - tx * s + px * s * 0.45)} ${r1(ey - ty * s + py * s * 0.45)} L${r1(ex - tx * s - px * s * 0.45)} ${r1(ey - ty * s - py * s * 0.45)} Z" fill="${colour}"/>`);
    }
    if (e.w != null && e.w !== '') {
      const t = show(e.w), w = textWidth(t, 11.5, true) + 8;
      labels.push(`<rect x="${r1(mx - w / 2)}" y="${r1(my - 9)}" width="${r1(w)}" height="17" rx="4" fill="${c.bg}" stroke="${m ? colour : 'none'}" stroke-width="1"/><text x="${r1(mx)}" y="${r1(my + 4)}" text-anchor="middle" font-family="${MONO}" font-size="11.5" fill="${m ? colour : c.muted}" font-weight="${m ? 700 : 400}">${esc(t)}</text>`);
    }
  }
  parts.push(...labels);
  const changed = new Map(changes.filter((ch) => ch.op === 'set').map((ch) => [String(ch.path), ch]));
  for (const n of byId.values()) {
    const st = markStyle(marks[n.id], c);
    const label = String(n.label ?? n.id);
    const r = label.length > 2 ? R + 4 : R;
    let body = `<circle r="${r}" fill="${st.fill}" stroke="${marks[n.id] ? st.stroke : c.ink}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text y="4.5" text-anchor="middle" font-family="${FONT}" font-size="13.5" font-weight="600" fill="${st.text}">${esc(label)}</text>`;
    if (n.value !== undefined && n.value !== null && n.value !== '') {
      const t = show(n.value), w = Math.max(18, textWidth(t, 11, true) + 8);
      body += `<rect x="${r - 6}" y="${r - 8}" width="${r1(w)}" height="16" rx="4" fill="${c.surface2}" stroke="${c.line}" stroke-width="1"/><text x="${r1(r - 6 + w / 2)}" y="${r + 4}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${c.ink}" data-v="${esc(t)}">${esc(t)}</text>`;
    }
    const ch = changed.get(n.id);
    if (ch) body += badge(0, -r - 4, changeText(ch), c, { anchor: 'middle' });
    parts.push(keyed(`${id}/n/${n.id}`, n.x, n.y, body));
  }
  return { w: f.w, h: f.h, body: parts.join('') };
}
