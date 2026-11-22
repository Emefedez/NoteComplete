// Sticky note prefab (module.json): a coloured note card with an optional title, wrapped
// body text, author footer, subtle ruled lines and a folded bottom-right corner. Pure: no DOM.
import { escapeHtml } from '../kit/svg.js';

export const PALETTE = [
  { name: 'Yellow', hex: '#fae778' },
  { name: 'Pink', hex: '#f9c6d3' },
  { name: 'Blue', hex: '#b8e0f9' },
  { name: 'Green', hex: '#c7f0bd' },
  { name: 'Orange', hex: '#ffd399' },
  { name: 'Lavender', hex: '#dcc8fa' },
  { name: 'Mint', hex: '#b9f0e2' },
  { name: 'Cream', hex: '#fff6d6' },
];

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

function normalizeHex(raw) {
  const s = String(raw || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return '#fae778';
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(rgb, target, amount) {
  return rgb.map((c, i) => Math.round(c + (target[i] - c) * amount));
}

const cssRgb = ([r, g, b], a = 1) => (a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`);

function wrapText(text, maxChars) {
  const out = [];
  for (const para of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      if (!word) continue;
      if (line.length + word.length <= maxChars || !line) {
        line += word;
      } else {
        out.push(line.trimEnd());
        line = word.trimStart();
      }
      while (line.length > maxChars) {
        out.push(line.slice(0, maxChars));
        line = line.slice(maxChars);
      }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}

// Rough width of `text` in em for a sans-serif face: narrow, wide and capital letters differ
// enough that one average either wraps a title early or lets W and M run off the card.
function emWidth(text, bold = false) {
  let w = 0;
  for (const ch of text) {
    if (/[ilj.,:;'!|]/.test(ch)) w += 0.28;
    else if (/[ frtI()\-\[\]]/.test(ch)) w += 0.36;
    else if (/[mwMW@]/.test(ch)) w += 0.86;
    else if (/[A-Z0-9]/.test(ch)) w += 0.66;
    else if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)) w += 1;
    else w += 0.55;
  }
  return w * (bold ? 1.07 : 1);
}

// Words of `text` in lines at most `maxEm` wide; a word wider than a line is split.
function wrapToWidth(text, maxEm, bold) {
  const out = [];
  let line = '';
  for (const word of String(text || '').replace(/\s+/g, ' ').trim().split(' ')) {
    if (!word) continue;
    const next = line ? `${line} ${word}` : word;
    if (emWidth(next, bold) <= maxEm) { line = next; continue; }
    if (line) out.push(line);
    line = word;
    while (emWidth(line, bold) > maxEm && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && emWidth(line.slice(0, cut), bold) > maxEm) cut--;
      out.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) out.push(line);
  return out;
}

// The first `count` lines of a wrapped title; when there is more, the last one ends in "…".
function titleLines(title, maxEm, count) {
  const lines = wrapToWidth(title, maxEm, true);
  if (lines.length <= count) return lines;
  const kept = lines.slice(0, count);
  let last = kept[count - 1];
  while (last && emWidth(`${last}…`, true) > maxEm) last = last.slice(0, -1);
  kept[count - 1] = `${last.trimEnd()}…`;
  return kept;
}

export function normalize(raw = {}) {
  return {
    type: 'stickynote',
    color: normalizeHex(raw.color),
    title: String(raw.title ?? '').slice(0, 120),
    text: String(raw.text ?? '').slice(0, 4000),
    author: String(raw.author ?? '').slice(0, 80),
    fontSize: clamp(raw.fontSize, 8, 48, 15),
    fold: raw.fold !== false,
    lines: Boolean(raw.lines),
    width: Math.round(clamp(raw.width, 120, 800, 256)),
    height: Math.round(clamp(raw.height, 120, 800, 256)),
  };
}

export function render(raw) {
  const s = normalize(raw);
  const w = s.width, h = s.height;
  const bx = 0.5, by = 0.5, bw = w - 4.5, bh = h - 4.5;
  const fold = s.fold ? Math.round(Math.min(bw, bh) * 0.12) : 0;
  const rgb = hexToRgb(s.color);
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const headerRgb = mixRgb(rgb, [0, 0, 0], 0.065);
  const borderRgb = mixRgb(rgb, [0, 0, 0], 0.18);
  const foldRgb = mixRgb(rgb, [0, 0, 0], 0.13);
  const ruleRgb = mixRgb(rgb, [0, 0, 0], 0.12);
  const ink = lum > 0.42 ? (rgb[0] > 220 && rgb[1] > 180 && rgb[2] < 160 ? '#3b2b0a' : '#1f2328') : '#ffffff';
  const mutedInk = lum > 0.42 ? 'rgba(45,35,15,0.68)' : 'rgba(255,255,255,0.78)';

  const bodyPath = fold
    ? `M${bx} ${by} H${bx + bw} V${by + bh - fold} L${bx + bw - fold} ${by + bh} H${bx} Z`
    : `M${bx} ${by} H${bx + bw} V${by + bh} H${bx} Z`;
  const shadowPath = fold
    ? `M${bx + 2} ${by + 3} H${bx + bw + 2} V${by + bh - fold + 3} L${bx + bw - fold + 2} ${by + bh + 3} H${bx + 2} Z`
    : `M${bx + 2} ${by + 3} H${bx + bw + 2} V${by + bh + 3} H${bx + 2} Z`;

  const parts = [];
  // Soft shadow layers (filter-free so canvas & resvg match identically)
  parts.push(`<path d="${shadowPath}" fill="rgba(15,23,42,0.12)"/>`);
  // Main sticky card body
  parts.push(`<path d="${bodyPath}" fill="${cssRgb(rgb)}" stroke="${cssRgb(borderRgb)}" stroke-width="1"/>`);
  // Subtle darker top adhesive strip
  const stripH = Math.max(14, Math.min(26, Math.round(bh * 0.095)));
  parts.push(`<rect x="${bx + 0.5}" y="${by + 0.5}" width="${bw - 1}" height="${stripH}" fill="${cssRgb(headerRgb)}"/>`);

  // Optional subtle ruled lines
  const textPadX = Math.max(14, Math.round(bw * 0.07));
  const lineStep = Math.round(s.fontSize * 1.42);
  const titleSize = Math.round(s.fontSize * 1.12);
  // The first line clears the adhesive strip by its own size: a title is larger than the text.
  const topStart = s.title
    ? by + stripH + 4 + Math.round(titleSize * 0.92)
    : by + stripH + Math.max(12, Math.round(s.fontSize * 0.8));
  const bottomLimit = by + bh - (s.author ? 26 : 14);
  if (s.lines) {
    for (let ly = topStart + lineStep * 0.3; ly < bottomLimit; ly += lineStep) {
      parts.push(`<line x1="${bx + textPadX}" y1="${ly}" x2="${bx + bw - textPadX}" y2="${ly}" stroke="${cssRgb(ruleRgb, 0.55)}" stroke-width="1"/>`);
    }
  }

  // Title & wrapped body text
  let cy = topStart;
  const availW = Math.max(40, bw - textPadX * 2);
  if (s.title) {
    for (const line of titleLines(s.title, availW / titleSize, 2)) {
      if (cy > bottomLimit) break;
      parts.push(`<text x="${bx + textPadX}" y="${cy}" font-size="${titleSize}" font-weight="700" fill="${ink}">${escapeHtml(line)}</text>`);
      cy += Math.round(titleSize * 1.35);
    }
    cy += 4;
  }
  if (s.text) {
    const maxChars = Math.max(8, Math.floor(availW / (s.fontSize * 0.56)));
    for (const line of wrapText(s.text, maxChars)) {
      if (cy > bottomLimit) break;
      if (line) {
        parts.push(`<text x="${bx + textPadX}" y="${cy}" font-size="${s.fontSize}" fill="${ink}">${escapeHtml(line)}</text>`);
      }
      cy += lineStep;
    }
  }

  // Optional author / footer label (bottom-left, matching Goodnotes sticky notes)
  if (s.author) {
    const authorSize = Math.max(10, Math.min(13, Math.round(s.fontSize * 0.8)));
    parts.push(`<text x="${bx + Math.max(10, textPadX - 4)}" y="${by + bh - 10}" font-size="${authorSize}" fill="${mutedInk}">${escapeHtml(s.author)}</text>`);
  }

  // Folded bottom-right corner
  if (fold) {
    const fx = bx + bw - fold, fy = by + bh - fold;
    parts.push(`<polygon points="${fx - 3},${by + bh} ${fx},${fy} ${bx + bw},${fy}" fill="rgba(15,23,42,0.08)"/>`);
    parts.push(`<polygon points="${fx},${by + bh} ${fx},${fy} ${bx + bw},${fy}" fill="${cssRgb(foldRgb)}" stroke="${cssRgb(borderRgb)}" stroke-width="0.9" stroke-linejoin="round"/>`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${parts.join('')}</svg>`;
  return { svg, width: w, height: h, transparent: true };
}

export const name = (spec) => (spec?.title ? `Sticky note: ${spec.title}` : 'Sticky note');
