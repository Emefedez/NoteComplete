// Colours and marks of the algorithm figures. Two palettes from the app's tokens: "light" (the
// figure on a white page, always) and "dark" (the player over a dark app). Every renderer
// draws with explicit colours from here (no CSS), so the SVG looks the same anywhere.
import { escapeHtml } from '../../kit/svg.js';

export const THEMES = {
  light: {
    bg: '#ffffff', ink: '#1f2328', muted: '#626b76', faint: '#9aa3ad', line: '#b9c2cd', surface: '#ffffff', surface2: '#f1f3f6',
    accent: '#245dc4', accentInk: '#ffffff', accentSoft: '#e2eafa', hint: '#8f5408', hintSoft: '#fbefd9',
    ok: '#13734a', okSoft: '#dcf1e5', bad: '#b3261e', badSoft: '#fae2df', badgeBg: '#1f2328', badgeInk: '#ffffff',
  },
  dark: {
    bg: '#24272c', ink: '#e5e8ed', muted: '#a6aeb9', faint: '#6f7884', line: '#55606c', surface: '#2a2e34', surface2: '#30353c',
    accent: '#91b4ff', accentInk: '#10151c', accentSoft: '#2f3d58', hint: '#f0c060', hintSoft: '#43361a',
    ok: '#7fd6a3', okSoft: '#1d3a2b', bad: '#ff8a7e', badSoft: '#46221f', badgeBg: '#e5e8ed', badgeInk: '#1b1e22',
  },
};
export const theme = (name) => THEMES[name] || THEMES.light;

// What each mark looks like: fill, stroke, text colour, stroke width, dashes.
export function markStyle(mark, c) {
  switch (mark) {
    case 'current': return { fill: c.accent, stroke: c.accent, text: c.accentInk, width: 2, dash: '' };
    case 'visited': return { fill: c.accentSoft, stroke: c.accent, text: c.ink, width: 1.6, dash: '' };
    case 'queued': return { fill: c.surface, stroke: c.accent, text: c.ink, width: 2, dash: '4 3' };
    case 'done': return { fill: c.surface2, stroke: c.muted, text: c.muted, width: 1.4, dash: '' };
    case 'compare': return { fill: c.hintSoft, stroke: c.hint, text: c.ink, width: 2.2, dash: '' };
    case 'path': return { fill: c.okSoft, stroke: c.ok, text: c.ink, width: 2.6, dash: '' };
    case 'new': return { fill: c.okSoft, stroke: c.ok, text: c.ink, width: 2.2, dash: '' };
    case 'removed': return { fill: c.badSoft, stroke: c.bad, text: c.ink, width: 1.8, dash: '4 3' };
    case 'error': return { fill: c.badSoft, stroke: c.bad, text: c.ink, width: 2.4, dash: '' };
    default: return { fill: c.surface, stroke: c.line, text: c.ink, width: 1.3, dash: '' };
  }
}
export const LEGEND = {
  current: 'current', visited: 'visited', queued: 'waiting', done: 'done', compare: 'compared',
  path: 'chosen / path', new: 'added', removed: 'removed', error: 'conflict',
};

export const esc = escapeHtml;
export const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
export const MONO = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`;
// A value as text: ∞ for infinities, null for null, [a, b] for lists, {k: v} for pairs.
export function show(v) {
  if (v === null || v === undefined) return 'null';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '−∞';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`;
  if (typeof v === 'object') {
    if ('key' in v && 'prio' in v) return `${show(v.key)}:${show(v.prio)}`;
    if ('k' in v && 'v' in v) return `${show(v.k)}=${show(v.v)}`;
    return `{${Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(', ')}}`;
  }
  return String(v);
}
// About how wide a text is (px) at a font size: enough to size boxes without a DOM.
export const textWidth = (s, size = 12, mono = false) => String(s).length * size * (mono ? 0.62 : 0.58);
// A badge for a change, "9 → 7" (or "+3", "−A"), its left end at (x, y−12 … y).
export function badge(x, y, text, c, { anchor = 'start' } = {}) {
  const w = Math.max(20, textWidth(text, 10.5, true) + 10);
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return `<g class="badge"><rect x="${r1(left)}" y="${r1(y - 13)}" width="${r1(w)}" height="16" rx="8" fill="${c.badgeBg}"/><text x="${r1(left + w / 2)}" y="${r1(y - 1.5)}" text-anchor="middle" font-family="${MONO}" font-size="10.5" font-weight="600" fill="${c.badgeInk}">${esc(text)}</text></g>`;
}
export const r1 = (n) => Math.round(n * 10) / 10;
// The text a change gives its element: old → new for a set, + for an add, − for a remove.
export function changeText(ch) {
  if (ch.op === 'set') return `${show(ch.from)} → ${show(ch.to)}`;
  if (ch.op === 'add') return '+';
  if (ch.op === 'remove') return '−';
  if (ch.op === 'swap') return '⇄';
  return '';
}
// A keyed group: the player tweens it from where the same key was in the step before.
export const keyed = (key, x, y, body) => `<g data-k="${esc(key)}" transform="translate(${r1(x)} ${r1(y)})">${body}</g>`;
// The structure's name over it.
export const title = (label, c, x = 0, y = 11) => (label ? `<text x="${x}" y="${y}" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${c.muted}">${esc(label)}</text>` : '');
export const TITLE_H = 18;
