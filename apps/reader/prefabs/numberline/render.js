// The number line module's drawing (module.json): a line from min to max with a tick and its
// number every `step`, marked points with labels, and intervals drawn over the line with a
// filled (closed) or hollow (open) dot at each end. Pure: no DOM.
import { escapeHtml } from '../kit/svg.js';

const W = 600, PAD = 40, Y = 70;
const finite = (n, d) => (Number.isFinite(Number(n)) ? Number(n) : d);

// The spec, made whole: numbers where numbers belong, max above min, at most 200 ticks.
export function normalize(raw = {}) {
  let min = finite(raw.min, -5), max = finite(raw.max, 5);
  if (max <= min) max = min + 1;
  let step = Math.abs(finite(raw.step, 1)) || 1;
  while ((max - min) / step > 200) step *= 2;
  const points = (Array.isArray(raw.points) ? raw.points : []).map((p) => ({ x: finite(p?.x, 0), label: String(p?.label ?? '') })).slice(0, 100);
  const intervals = (Array.isArray(raw.intervals) ? raw.intervals : []).map((v) => ({ from: finite(v?.from, min), to: finite(v?.to, max), closedFrom: !!v?.closedFrom, closedTo: !!v?.closedTo })).slice(0, 50);
  return { type: 'numberline', title: String(raw.title ?? ''), min, max, step, points, intervals };
}

export function render(raw) {
  const s = normalize(raw);
  const at = (x) => PAD + ((Math.min(Math.max(x, s.min), s.max) - s.min) / (s.max - s.min)) * (W - 2 * PAD);
  const top = s.title ? 26 : 0, h = 124 + top, y = Y + top;
  const parts = [];
  if (s.title) parts.push(`<text x="${W / 2}" y="20" text-anchor="middle" font-size="15" font-weight="600">${escapeHtml(s.title)}</text>`);
  parts.push(`<line x1="${PAD - 18}" y1="${y}" x2="${W - PAD + 18}" y2="${y}" stroke="#1f2328" stroke-width="1.6"/>`);
  parts.push(`<path d="M${W - PAD + 18} ${y} l-9 -5 v10 z M${PAD - 18} ${y} l9 -5 v10 z" fill="#1f2328"/>`);
  const first = Math.ceil(s.min / s.step - 1e-9) * s.step;
  for (let v = first; v <= s.max + 1e-9; v += s.step) {
    const x = at(v), label = Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1000) / 1000);
    parts.push(`<line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y + 6}" stroke="#1f2328" stroke-width="1.2"/><text x="${x}" y="${y + 22}" text-anchor="middle" font-size="12" fill="#3b4250">${label}</text>`);
  }
  s.intervals.forEach((v, i) => {
    const a = at(Math.min(v.from, v.to)), b = at(Math.max(v.from, v.to)), lift = y - 14 - (i % 3) * 8, colour = ['#2563eb', '#dc2626', '#059669'][i % 3];
    const end = (x, closed) => `<circle cx="${x}" cy="${lift}" r="4.5" fill="${closed ? colour : '#fff'}" stroke="${colour}" stroke-width="2"/>`;
    parts.push(`<line x1="${a}" y1="${lift}" x2="${b}" y2="${lift}" stroke="${colour}" stroke-width="3" stroke-linecap="round"/>${end(a, v.from <= v.to ? v.closedFrom : v.closedTo)}${end(b, v.from <= v.to ? v.closedTo : v.closedFrom)}`);
  });
  for (const p of s.points) {
    const x = at(p.x);
    parts.push(`<circle cx="${x}" cy="${y}" r="5" fill="#1f2328"/>`);
    if (p.label) parts.push(`<text x="${x}" y="${y + 40}" text-anchor="middle" font-size="13" font-style="italic" fill="#1f2328">${escapeHtml(p.label)}</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">${parts.join('')}</svg>`;
  return { svg, width: W, height: h };
}

export const name = () => 'Number line';
