// Clean, color-coded SVG card icons/covers for media, office documents, e-books, notebooks,
// HTML pages and archives, so Recent, Folders and Cloud cards never show a blank striped box.
import { isAudioName, isVideoName } from './text-types.js';

export const ICON_COVER = 'data-cover="icon1"';
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const extOf = (name) => {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  if (/\.(tgz|tar\.gz)$/i.test(base)) return 'TAR.GZ';
  return (base.match(/\.([a-z0-9]+)$/i)?.[1] || '').toUpperCase();
};

const WORD_EXT = /\.(docx|docm|dotx|doc|odt|fodt|rtf)$/i;
const SHEET_EXT = /\.(xlsx|xlsm|xlsb|xls|ods|fods)$/i;
const SLIDE_EXT = /\.(pptx|pptm|ppt|odp)$/i;
const BOOK_EXT = /\.epub$/i;
const NB_EXT = /\.ipynb$/i;
const HTML_EXT = /\.html?$/i;
const ARCHIVE_EXT = /\.(zip|tar|tgz|tar\.gz|gz|7z|rar)$/i;

const GLYPHS = {
  // Headphones + sound waves
  audio: (accent) => `<g fill="none" stroke="${accent}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M122 108v-12a38 38 0 0 1 76 0v12"/>
    <rect x="112" y="102" width="18" height="32" rx="7" fill="${accent}" fill-opacity="0.16"/>
    <rect x="190" y="102" width="18" height="32" rx="7" fill="${accent}" fill-opacity="0.16"/>
    <path d="M148 112v14M160 104v30M172 112v14" stroke-width="4.5"/>
  </g>`,
  // Film / video screen with play triangle
  video: (accent) => `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="108" y="66" width="104" height="72" rx="12" fill="${accent}" fill-opacity="0.12"/>
    <polygon points="150,86 150,118 178,102" fill="${accent}" stroke="${accent}" stroke-width="3"/>
    <path d="M124 66v10M196 66v10M124 128v10M196 128v10" stroke-width="4"/>
  </g>`,
  // Folded document page with lines
  doc: (accent) => `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M124 56h50l22 22v68a6 6 0 0 1-6 6h-66a6 6 0 0 1-6-6V62a6 6 0 0 1 6-6Z" fill="${accent}" fill-opacity="0.10"/>
    <path d="M174 56v22h22"/>
    <path d="M136 96h48M136 112h48M136 128h32" stroke-width="4.5"/>
  </g>`,
  // Spreadsheet grid
  sheet: (accent) => `<g fill="none" stroke="${accent}" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="114" y="62" width="92" height="82" rx="8" fill="${accent}" fill-opacity="0.10"/>
    <rect x="114" y="62" width="92" height="22" rx="6" fill="${accent}" fill-opacity="0.22" stroke="none"/>
    <path d="M114 84h92M114 106h92M114 126h92M146 62v82M176 62v82"/>
  </g>`,
  // Presentation slide with chart bar
  slides: (accent) => `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="108" y="62" width="104" height="70" rx="8" fill="${accent}" fill-opacity="0.10"/>
    <path d="M160 132v18M138 150h44"/>
    <path d="M134 114v-16M152 114V88M170 114V96M188 114V82" stroke-width="6"/>
  </g>`,
  // Open book
  book: (accent) => `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M160 72c-12-10-28-12-46-8v68c18-4 34-2 46 8 12-10 28-12 46-8V64c-18-4-34-2-46 8Z" fill="${accent}" fill-opacity="0.12"/>
    <path d="M160 72v68"/>
  </g>`,
  // Code notebook
  notebook: (accent) => `<g fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="116" y="58" width="88" height="88" rx="10" fill="${accent}" fill-opacity="0.10"/>
    <path d="M148 88l-14 14 14 14M172 88l14 14-14 14M164 82l-8 40" stroke-width="4.5"/>
  </g>`,
  // HTML code brackets
  html: (accent) => `<text x="160" y="114" font-family="system-ui, -apple-system, sans-serif" font-size="38" font-weight="800" fill="${accent}" text-anchor="middle">&lt;HTML/&gt;</text>`,
  // Archive box
  archive: (accent) => `<g fill="none" stroke="${accent}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="106" y="60" width="108" height="24" rx="5" fill="${accent}" fill-opacity="0.18"/>
    <rect x="114" y="84" width="92" height="62" rx="5" fill="${accent}" fill-opacity="0.08"/>
    <rect x="144" y="100" width="32" height="9" rx="4" fill="${accent}"/>
  </g>`,
};

function describeCover(name) {
  const n = String(name || '');
  if (!n) return null;
  if (isAudioName(n)) return { glyph: 'audio', bg: '#eef2ff', card: '#ffffff', stroke: '#c7d2fe', accent: '#4f46e5', pill: extOf(n) || 'AUDIO', sub: 'Audio' };
  if (isVideoName(n)) return { glyph: 'video', bg: '#fff1f2', card: '#ffffff', stroke: '#fecdd3', accent: '#e11d48', pill: extOf(n) || 'VIDEO', sub: 'Video' };
  if (WORD_EXT.test(n)) return { glyph: 'doc', bg: '#eff6ff', card: '#ffffff', stroke: '#bfdbfe', accent: '#2563eb', pill: extOf(n), sub: 'Document' };
  if (SHEET_EXT.test(n)) return { glyph: 'sheet', bg: '#ecfdf5', card: '#ffffff', stroke: '#a7f3d0', accent: '#059669', pill: extOf(n), sub: 'Spreadsheet' };
  if (SLIDE_EXT.test(n)) return { glyph: 'slides', bg: '#fff7ed', card: '#ffffff', stroke: '#fed7aa', accent: '#ea580c', pill: extOf(n), sub: 'Presentation' };
  if (BOOK_EXT.test(n)) return { glyph: 'book', bg: '#f5f3ff', card: '#ffffff', stroke: '#ddd6fe', accent: '#7c3aed', pill: 'EPUB', sub: 'E-book' };
  if (NB_EXT.test(n)) return { glyph: 'notebook', bg: '#fefce8', card: '#ffffff', stroke: '#fde68a', accent: '#d97706', pill: 'IPYNB', sub: 'Notebook' };
  if (HTML_EXT.test(n)) return { glyph: 'html', bg: '#f0f9ff', card: '#ffffff', stroke: '#bae6fd', accent: '#0284c7', pill: 'HTML', sub: 'Web Page' };
  if (ARCHIVE_EXT.test(n) && !/\.(goodnotes|ntb)\.zip$/i.test(n)) {
    return { glyph: 'archive', bg: '#f8fafc', card: '#ffffff', stroke: '#cbd5e1', accent: '#475569', pill: extOf(n) || 'ZIP', sub: 'Archive' };
  }
  return null;
}

export function fileCoverSvg(name) {
  const spec = describeCover(name);
  if (!spec) return null;
  const pillWidth = Math.max(66, spec.pill.length * 11 + 26);
  const pillX = (320 - pillWidth) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${ICON_COVER} viewBox="0 0 320 240" width="320" height="240">`
    + `<rect width="320" height="240" fill="${spec.bg}"/>`
    + `<rect x="36" y="22" width="248" height="196" rx="14" fill="${spec.card}" stroke="${spec.stroke}" stroke-width="2"/>`
    + GLYPHS[spec.glyph](spec.accent)
    + `<rect x="${pillX}" y="164" width="${pillWidth}" height="26" rx="13" fill="${spec.accent}"/>`
    + `<text x="160" y="182" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" letter-spacing="0.6" fill="#ffffff" text-anchor="middle">${esc(spec.pill)}</text>`
    + `<text x="160" y="207" font-family="system-ui, -apple-system, sans-serif" font-size="11.5" font-weight="500" fill="#64748b" text-anchor="middle">${esc(spec.sub)}</text>`
    + `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// True for files whose cover comes purely from their extension/icon (no need to read bytes from disk).
export function hasStaticFileCover(name) {
  const n = String(name || '');
  // .zip and .tar may hold a Goodnotes notebook or NoteComplete package whose own cover wins.
  if (/\.(zip|tar)$/i.test(n)) return false;
  return Boolean(describeCover(n));
}
