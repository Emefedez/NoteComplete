// The template module's drawing (docs/PREFAB-MODULES-GUIDE.md): a title and a list of lines
// in a rounded box. Pure: no DOM, so it also runs in Node (MCP add_prefab, the tests).
// Copy this folder to start a module: rename it, change the id and the type, then draw yours.
import { escapeHtml } from '../kit/svg.js';

const W = 420, LINE = 24;

// The spec, made whole: whatever was saved or typed, a spec render() can draw.
export function normalize(raw = {}) {
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map((l) => ({ text: String(l?.text ?? '') })).slice(0, 40);
  return { type: 'example', title: String(raw.title ?? ''), lines };
}

// spec → { svg, width, height }: the picture on the page, the picker's preview and MCP's.
export function render(raw) {
  const s = normalize(raw);
  const top = s.title ? 40 : 14, height = top + Math.max(1, s.lines.length) * LINE + 14;
  const parts = [`<rect x="1" y="1" width="${W - 2}" height="${height - 2}" rx="10" fill="#fff" stroke="#1f2328" stroke-width="1.4"/>`];
  if (s.title) parts.push(`<text x="16" y="27" font-size="16" font-weight="600" fill="#1f2328">${escapeHtml(s.title)}</text>`);
  s.lines.forEach((l, i) => parts.push(`<text x="20" y="${top + i * LINE + 16}" font-size="14" fill="#1f2328">• ${escapeHtml(l.text)}</text>`));
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}">${parts.join('')}</svg>`, width: W, height };
}

// Its name in menus ("Edit example list…").
export const name = () => 'Example list';
