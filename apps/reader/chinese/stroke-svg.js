// Pure SVG of a character's strokes (no DOM): used by the player (stroke-player.js), practice
// (practice.js) and the hanzi prefab's render.js, in the browser and in Node. Hanzi Writer's
// technique: each stroke is its outline used as a clip path, revealed by a thick polyline along
// its median whose dash offset runs from its length to 0. Data is Make Me a Hanzi's 1024 box,
// y up: a point (X, Y) is drawn at (X, 900 − Y).
export const BOX = 1024, BASELINE = 900, MASK_WIDTH = 200, EXTEND = 85;
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r1 = (n) => Math.round(n * 10) / 10;

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const pathLength = (pts) => pts.reduce((n, p, i) => (i ? n + dist(pts[i - 1], p) : 0), 0);
// The median with its start pushed back by `by` along its first segment, so the round end of
// the mask covers the stroke's start (Hanzi Writer's extendStart).
export function extendStart(pts, by = EXTEND) {
  if (pts.length < 2) return pts.map((p) => [...p]);
  const [a, b] = pts, d = dist(a, b) || 1;
  return [[a[0] - ((b[0] - a[0]) / d) * by, a[1] - ((b[1] - a[1]) / d) * by], ...pts.slice(1).map((p) => [...p])];
}
// A median point in the drawing's own pixels, for a character drawn at (x, y) with side `size`.
export const toScreen = (p, x, y, size) => [x + (p[0] * size) / BOX, y + ((BASELINE - p[1]) * size) / BOX];
// And back: a pixel of that drawing → the 1024 box, y up (for practice).
export const fromScreen = (q, x, y, size) => [((q[0] - x) * BOX) / size, BASELINE - ((q[1] - y) * BOX) / size];
export const glyphTransform = (x, y, size) => `translate(${r1(x)} ${r1(y)}) scale(${size / BOX} ${-size / BOX}) translate(0 ${-BASELINE})`;

// 米字格 ("mi": square, middle cross and diagonals), 田字格 ("tian": square and middle cross), or none.
export function gridSvg(x, y, size, kind = 'mi', colour = '#d9a3a3') {
  if (kind === 'none' || !kind) return '';
  const m = size / 2, line = (x1, y1, x2, y2) => `<line x1="${r1(x + x1)}" y1="${r1(y + y1)}" x2="${r1(x + x2)}" y2="${r1(y + y2)}"/>`;
  const inner = [line(m, 0, m, size), line(0, m, size, m), ...(kind === 'mi' ? [line(0, 0, size, size), line(size, 0, 0, size)] : [])].join('');
  return `<g fill="none" stroke="${esc(colour)}" stroke-width="${r1(Math.max(0.6, size / 160))}"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(size)}" height="${r1(size)}" stroke-width="${r1(Math.max(1, size / 90))}"/><g stroke-dasharray="${r1(size / 30)} ${r1(size / 40)}">${inner}</g></g>`;
}

// One character. Options:
//   x, y, size     where (pixels of the surrounding SVG)
//   done           strokes drawn whole (default: all)
//   current        { index, t }: that stroke revealed to t ∈ [0, 1] (masked), drawn in `active`
//   outline        the strokes not drawn yet in `outlineColour`
//   numbers        each drawn stroke's number at its start
//   animated       every stroke as a masked polyline (data-i, data-len) for the player to drive
//   id             prefix for clip path ids (unique in the document)
export function glyphSvg(data, { x = 0, y = 0, size = 100, done = null, current = null, outline = false, numbers = false, animated = false, colour = '#1f2328', active = '#d1242f', outlineColour = '#d0d4da', id = 'hz' } = {}) {
  if (!data?.strokes?.length) return '';
  const n = data.strokes.length;
  const shown = done === null || done === undefined ? n : Math.max(0, Math.min(n, done));
  const parts = [];
  if (outline || animated) parts.push(`<g fill="${esc(outlineColour)}" class="hz-outline"${outline ? '' : ' visibility="hidden"'}>${data.strokes.map((d) => `<path d="${esc(d)}"/>`).join('')}</g>`);
  const masked = (i, t, fill) => {
    const pts = extendStart(data.medians[i] || []);
    const len = Math.ceil(pathLength(pts)) + MASK_WIDTH;
    const cid = `${id}-c${i}`;
    return `<clipPath id="${esc(cid)}"><path d="${esc(data.strokes[i])}"/></clipPath><path data-i="${i}" data-len="${len}" clip-path="url(#${esc(cid)})" d="M${pts.map((p) => `${Math.round(p[0])} ${Math.round(p[1])}`).join('L')}" fill="none" stroke="${esc(fill)}" stroke-width="${MASK_WIDTH}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${len} ${len}" stroke-dashoffset="${r1(len * (1 - t))}"/>`;
  };
  if (animated) parts.push(`<g class="hz-strokes">${data.strokes.map((_, i) => masked(i, i < shown ? 1 : 0, colour)).join('')}</g>`);
  else {
    parts.push(`<g fill="${esc(colour)}">${data.strokes.slice(0, shown).map((d) => `<path d="${esc(d)}"/>`).join('')}</g>`);
    if (current && current.index >= shown && current.index < n) parts.push(masked(current.index, Math.max(0, Math.min(1, current.t ?? 1)), active));
  }
  let out = `<g transform="${glyphTransform(x, y, size)}">${parts.join('')}</g>`;
  if (numbers) {
    const upto = current ? Math.max(shown, current.index + 1) : shown;
    const fs = Math.max(7, size / 11);
    out += `<g font-family="Arial, sans-serif" font-size="${r1(fs)}" font-weight="700" text-anchor="middle" dominant-baseline="central">${data.medians.slice(0, upto).map((m, i) => {
      const [px, py] = toScreen(m[0], x, y, size);
      return `<circle cx="${r1(px)}" cy="${r1(py)}" r="${r1(fs * 0.62)}" fill="#fff" stroke="${esc(active)}" stroke-width="${r1(fs / 9)}"/><text x="${r1(px)}" y="${r1(py)}" fill="${esc(active)}">${i + 1}</text>`;
    }).join('')}</g>`;
  }
  return out;
}
