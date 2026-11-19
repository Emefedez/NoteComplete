// Shared multi-source text & image extraction for AI Batch Notes and Exam Generator.
import { decodeText, isOfficeName, isTextName, looksLikeText } from './text-types.js';
import { SOURCE_NAMES, canvasImage } from './ai-context.js';

const ARCHIVE_EXT = /\.(noteful|nfedit|notepart|notecomp|notecomplete)$/i;
const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};
const DATA_IMG_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;

/** Clamps a normalized [x, y, w, h] (or {x, y, w, h}) bounding box into [0, 1] bounds. */
export function clampNormalizedBbox(bbox) {
  if (!bbox) return null;
  const raw = Array.isArray(bbox)
    ? bbox
    : typeof bbox === 'object'
      ? [bbox.x ?? bbox.left, bbox.y ?? bbox.top, bbox.w ?? bbox.width, bbox.h ?? bbox.height]
      : null;
  if (!raw || raw.length < 4) return null;
  const nums = raw.slice(0, 4).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let [x, y, w, h] = nums;
  x = Math.max(0, Math.min(0.99, x));
  y = Math.max(0, Math.min(0.99, y));
  w = Math.max(0, Math.min(1 - x, w));
  h = Math.max(0, Math.min(1 - y, h));
  if (w < 0.01 || h < 0.01) return null;
  return [
    Number(x.toFixed(4)),
    Number(y.toFixed(4)),
    Number(w.toFixed(4)),
    Number(h.toFixed(4)),
  ];
}

/** Encodes raw image bytes into a data:image/...;base64,... URI in both Browser and Node. */
export function bytesToDataUrl(bytes, mime = 'image/png') {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!buf.byteLength) return '';
  const safeMime = /^image\/(png|jpe?g|webp|gif)$/i.test(mime) ? mime.toLowerCase() : 'image/png';
  if (typeof Buffer === 'function') {
    return `data:${safeMime};base64,${Buffer.from(buf).toString('base64')}`;
  }
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) {
    bin += String.fromCharCode(...buf.subarray(i, i + step));
  }
  return `data:${safeMime};base64,${btoa(bin)}`;
}

/** Decodes a validated data:image/...;base64,... URI back into bytes + mime type. */
export function dataUrlToBytes(dataUrl) {
  const m = String(dataUrl || '').trim().match(DATA_IMG_RE);
  if (!m) return null;
  const type = `image/${m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase()}`;
  const b64 = m[2].replace(/\s+/g, '');
  if (typeof Buffer === 'function') {
    return { bytes: new Uint8Array(Buffer.from(b64, 'base64')), type };
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type };
}

/**
 * Crops a normalized [x, y, w, h] region from a canvas (with defensive bounds clamping).
 * Gracefully returns null in headless environments without 2D canvas support.
 */
export async function cropCanvasRegion(
  sourceCanvas,
  bbox = null,
  { maxWidth = 1000, mime = 'image/png', quality = 0.9, padding = 0.006 } = {},
) {
  const cw = Number(sourceCanvas?.width || 0);
  const ch = Number(sourceCanvas?.height || 0);
  if (!(cw > 0) || !(ch > 0)) return null;
  const clamped = bbox == null ? [0, 0, 1, 1] : clampNormalizedBbox(bbox);
  if (!clamped) return null;

  const isFull = clamped[0] <= 0.001 && clamped[1] <= 0.001 && clamped[2] >= 0.998 && clamped[3] >= 0.998;
  const pad = isFull ? 0 : Math.max(0, Math.min(0.05, Number(padding) || 0));
  const x0 = Math.max(0, clamped[0] - pad);
  const y0 = Math.max(0, clamped[1] - pad);
  const x1 = Math.min(1, clamped[0] + clamped[2] + pad);
  const y1 = Math.min(1, clamped[1] + clamped[3] + pad);

  const sx = Math.max(0, Math.min(cw - 1, Math.floor(x0 * cw)));
  const sy = Math.max(0, Math.min(ch - 1, Math.floor(y0 * ch)));
  const sw = Math.max(1, Math.min(cw - sx, Math.ceil((x1 - x0) * cw)));
  const sh = Math.max(1, Math.min(ch - sy, Math.ceil((y1 - y0) * ch)));

  const doc = sourceCanvas.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return null;
  const out = doc.createElement('canvas');
  const scale = maxWidth > 0 && sw > maxWidth ? maxWidth / sw : 1;
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext?.('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, out.width, out.height);

  const safeMime = /^image\/(png|jpeg|webp)$/i.test(mime) ? mime.toLowerCase() : 'image/png';
  let dataUrl = '';
  try {
    dataUrl = typeof out.toDataURL === 'function' ? out.toDataURL(safeMime, quality) : '';
  } catch { dataUrl = ''; }

  let bytes = null;
  if (typeof out.toBlob === 'function') {
    const blob = await new Promise((resolve) => out.toBlob(resolve, safeMime, quality));
    if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
  }
  if (!bytes && dataUrl) bytes = dataUrlToBytes(dataUrl)?.bytes || null;
  if (!dataUrl && bytes) dataUrl = bytesToDataUrl(bytes, safeMime);
  out.width = out.height = 0;
  if (!dataUrl && !bytes) return null;
  return { bytes, type: safeMime, dataUrl, width: Math.round(sw * scale), height: Math.round(sh * scale), bbox: clamped };
}

/** Crops a normalized [x, y, w, h] region from raw image bytes (or encodes full image when bbox covers full image). */
export async function cropImageBytes(
  imageBytes,
  mime = 'image/png',
  bbox = null,
  { maxWidth = 1000, outMime = '', quality = 0.9, padding = 0.006 } = {},
) {
  const buf = imageBytes instanceof Uint8Array ? imageBytes : new Uint8Array(imageBytes || []);
  if (!buf.byteLength) return null;
  const clamped = bbox == null ? [0, 0, 1, 1] : clampNormalizedBbox(bbox);
  if (!clamped) return null;

  const isFull = clamped[0] <= 0.001 && clamped[1] <= 0.001 && clamped[2] >= 0.998 && clamped[3] >= 0.998;
  const safeMime = /^image\/(png|jpe?g|webp|gif)$/i.test(mime) ? mime.toLowerCase().replace('image/jpg', 'image/jpeg') : 'image/png';
  if (isFull) {
    const dataUrl = bytesToDataUrl(buf, safeMime);
    return dataUrl ? { bytes: buf, type: safeMime, dataUrl, bbox: [0, 0, 1, 1] } : null;
  }

  const doc = globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return null;
  try {
    let source = null;
    let cleanup = () => {};
    if (typeof createImageBitmap === 'function' && typeof Blob === 'function') {
      const bmp = await createImageBitmap(new Blob([buf], { type: safeMime }));
      source = bmp;
      cleanup = () => bmp.close?.();
    } else if (typeof Image === 'function') {
      const url = bytesToDataUrl(buf, safeMime);
      const im = new Image();
      await new Promise((resolve, reject) => {
        im.onload = resolve;
        im.onerror = reject;
        im.src = url;
      });
      source = im;
    }
    if (!source) return null;
    try {
      const w = source.width || source.naturalWidth || 0;
      const h = source.height || source.naturalHeight || 0;
      if (!(w > 0) || !(h > 0)) return null;
      const tmp = doc.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext?.('2d');
      if (!ctx) return null;
      ctx.drawImage(source, 0, 0, w, h);
      const res = await cropCanvasRegion(tmp, clamped, {
        maxWidth,
        mime: outMime || (safeMime === 'image/jpeg' ? 'image/jpeg' : 'image/png'),
        quality,
        padding,
      });
      tmp.width = tmp.height = 0;
      return res;
    } finally {
      cleanup();
    }
  } catch {
    return null;
  }
}

/** Renders a 1-based page from an opened pdf.js document onto an offscreen canvas (returns null in headless Node). */
export async function renderPdfPageCanvas(pdf, pageNumber, { maxWidth = 1200 } = {}) {
  if (!pdf || typeof pdf.getPage !== 'function') return null;
  const total = Number(pdf.numPages || 0);
  const p = Number(pageNumber);
  if (!Number.isInteger(p) || p < 1 || p > total) return null;
  const doc = globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') return null;
  try {
    const page = await pdf.getPage(p);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = Math.max(0.5, Math.min(3, (maxWidth || 1200) / Math.max(1, baseVp.width)));
    const viewport = page.getViewport({ scale });
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } catch {
    return null;
  }
}

function coerceSourceText(val) {
  if (typeof val === 'string') return val.trim();
  if (val == null || typeof val === 'boolean') return '';
  if (Array.isArray(val)) return val.map(coerceSourceText).filter(Boolean).join('\n');
  if (typeof val === 'object') {
    if (typeof val.markdown === 'string' || typeof val.typed === 'string' || typeof val.recognized === 'string' || Array.isArray(val.pages)) {
      const parts = [coerceSourceText(val.markdown), coerceSourceText(val.typed), coerceSourceText(val.recognized)];
      if (Array.isArray(val.pages)) parts.push(...val.pages.map(coerceSourceText));
      return parts.filter(Boolean).join('\n');
    }
    if ('text' in val) return coerceSourceText(val.text);
    if ('content' in val) return coerceSourceText(val.content);
  }
  return String(val).trim();
}

export function cleanTitle(name = '') {
  return String(name || '')
    .replace(/\.[^./\\]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim() || 'Untitled';
}

export function isSupportedSourceName(name = '') {
  const s = String(name || '');
  if (!s || s.startsWith('.')) return false;
  return ARCHIVE_EXT.test(s) || /\.pdf$/i.test(s) || /\.html?$/i.test(s)
    || isOfficeName(s) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(s) || isTextName(s);
}

// 1-based inclusive range parser ("1-8, 12") -> zero-based page indices.
export function parsePageRange(spec, total) {
  const n = Math.max(0, Number(total) || 0);
  if (!n) return [];
  const raw = String(spec || '').trim();
  if (!raw) return Array.from({ length: n }, (_, i) => i);
  const picked = new Set();
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = Math.max(1, Math.min(n, Number(m[1])));
    const b = Math.max(1, Math.min(n, Number(m[2] ?? a)));
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) picked.add(p - 1);
  }
  return picked.size ? [...picked].sort((x, y) => x - y) : Array.from({ length: n }, (_, i) => i);
}

// PDF.js operator codes for embedded images & vector strokes/fills (used to flag pages with figures).
const PDF_IMG_OPS = new Set([85, 86, 87, 88]); // paintImageXObject, paintInlineImageXObject, paintImageMaskXObject, paintFormXObjectBegin
const PDF_DRAW_OPS = new Set([20, 21, 22, 23, 24, 25, 26, 27, 28]); // stroke, fill, eoFill, fillStroke, etc.

export async function extractPdfText(bytes, openPdf, { maxPages = 60, detectFigures = true } = {}) {
  if (typeof openPdf !== 'function') return { pageCount: 0, text: '', pages: [], figurePages: [] };
  const pdf = await openPdf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const total = pdf?.numPages || 0;
  const limit = maxPages > 0 ? Math.min(total, maxPages) : total;
  const pages = [];
  const figurePages = [];
  for (let p = 1; p <= limit; p++) {
    try {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const text = (tc?.items || []).map((it) => it?.str || '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) pages.push({ page: p, text });
      let hasFigure = text.length < 30;
      if (!hasFigure && detectFigures && typeof page.getOperatorList === 'function') {
        try {
          const opList = await page.getOperatorList();
          const fns = opList?.fnArray || [];
          let drawCount = 0;
          for (const fn of fns) {
            if (PDF_IMG_OPS.has(fn)) { hasFigure = true; break; }
            if (PDF_DRAW_OPS.has(fn) && ++drawCount >= 12) { hasFigure = true; break; }
          }
        } catch { /* Operator inspection is optional. */ }
      }
      if (hasFigure) figurePages.push(p);
    } catch { /* Keep reading the rest of the PDF. */ }
  }
  await pdf?.destroy?.().catch?.(() => {});
  return {
    pageCount: total,
    pages,
    figurePages,
    text: pages.map((p) => `[Page ${p.page}]\n${p.text}`).join('\n\n'),
  };
}

function makePdfPageRenderer(pdfBytes, openPdf) {
  if (typeof openPdf !== 'function' || !pdfBytes?.byteLength) return undefined;
  return async (pageNum, maxWidth = 1200) => {
    const pdf = await openPdf(pdfBytes instanceof Uint8Array ? pdfBytes.slice() : new Uint8Array(pdfBytes));
    try {
      return await renderPdfPageCanvas(pdf, pageNum, { maxWidth });
    } finally {
      await pdf?.destroy?.().catch?.(() => {});
    }
  };
}

export async function extractHtmlText(html) {
  const cleaned = String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
  try {
    const { htmlToMarkdown } = await import('./office.js');
    if (typeof DOMParser === 'function') {
      const doc = new DOMParser().parseFromString(cleaned, 'text/html');
      const md = htmlToMarkdown(cleaned);
      const text = (md || doc.body?.textContent || '').trim();
      if (text) return text;
    }
  } catch { /* Fallback to stripped text below. */ }
  return cleaned
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractNoteArchive(bytes, { call, openPdf, maxPages = 60 } = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const summaryBuf = buf.slice().buffer;
  const summary = await call('extractNoteSummary', { bytes: summaryBuf, maxPages }, [summaryBuf]);
  const parts = [];
  if (summary?.markdown?.trim()) {
    parts.push(`## Notes\n${summary.markdown.trim()}`);
  }
  const pdfCache = new Map();
  const pdfBytesCache = new Map();
  for (const id of summary?.pdf_ids || []) {
    if (String(id).startsWith('paper-')) continue;
    try {
      const pdfArgBuf = buf.slice().buffer;
      const pdfBytes = await call('extractNotePdf', { bytes: pdfArgBuf, pdfId: id }, [pdfArgBuf]);
      const pdfBuf = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
      pdfBytesCache.set(id, pdfBuf);
      pdfCache.set(id, await extractPdfText(pdfBuf, openPdf, { maxPages }));
    } catch { /* Keep note text even if embedded PDF fails. */ }
  }
  const pageBackgrounds = new Map();
  const figurePages = [];
  for (const page of summary?.pages || []) {
    const chunks = [];
    if (page.typed?.trim()) chunks.push(page.typed.trim());
    if (page.ink?.trim()) chunks.push(page.ink.trim());
    if (page.recognized?.trim() && page.recognized.trim() !== page.ink?.trim()) chunks.push(page.recognized.trim());
    const bg = page.pdf_background;
    let hasFig = Boolean(page.ink?.trim());
    if (bg?.resource_id && pdfCache.has(bg.resource_id)) {
      const pdfPageNum = Number(bg.page_index ?? 0) + 1;
      const pdfInfo = pdfCache.get(bg.resource_id);
      const pdfPage = pdfInfo.pages.find((x) => x.page === pdfPageNum);
      if (pdfPage?.text && !chunks.some((c) => c.includes(pdfPage.text.slice(0, 60)))) chunks.push(pdfPage.text);
      if (pdfBytesCache.has(bg.resource_id)) {
        pageBackgrounds.set(Number(page.page), { pdfId: bg.resource_id, pdfPage: pdfPageNum });
      }
      if (pdfInfo.figurePages?.includes(pdfPageNum)) hasFig = true;
    }
    if (hasFig && Number.isInteger(Number(page.page))) figurePages.push(Number(page.page));
    const merged = chunks.join('\n').trim();
    if (merged) parts.push(`[Page ${page.page}]\n${merged}`);
  }
  const renderPage = typeof openPdf === 'function' && pageBackgrounds.size
    ? async (pageNum, maxWidth = 1200) => {
        const bg = pageBackgrounds.get(Number(pageNum));
        if (!bg) return null;
        const pdfBuf = pdfBytesCache.get(bg.pdfId);
        if (!pdfBuf?.byteLength) return null;
        const pdf = await openPdf(pdfBuf.slice());
        try {
          return await renderPdfPageCanvas(pdf, bg.pdfPage, { maxWidth });
        } finally {
          await pdf?.destroy?.().catch?.(() => {});
        }
      }
    : undefined;
  return {
    title: summary?.title || '',
    pageCount: summary?.page_count || 0,
    text: parts.join('\n\n'),
    figurePages,
    renderPage,
  };
}

export async function extractFileBytes(name, bytes, { call, openPdf, maxPages = 60 } = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const lower = String(name || '').toLowerCase();
  if (ARCHIVE_EXT.test(lower)) {
    const note = await extractNoteArchive(buf, { call, openPdf, maxPages });
    const images = [];
    if (!String(note.text || '').trim() && note.renderPage && typeof globalThis.document !== 'undefined') {
      for (const pNum of (note.figurePages || [])) {
        if (images.length >= 4) break;
        const canvas = await note.renderPage(pNum, 1100).catch(() => null);
        if (canvas && typeof canvas.toBlob === 'function') {
          try {
            images.push({ ...(await canvasImage(canvas, `page-${pNum}`, 1100)), page: pNum });
          } catch { /* Optional page image. */ }
        }
      }
    }
    return {
      title: note.title || cleanTitle(name),
      text: note.text,
      images,
      pageCount: note.pageCount,
      figurePages: note.figurePages || [],
      renderPage: note.renderPage,
    };
  }
  if (/\.pdf$/i.test(lower)) {
    const pdf = await extractPdfText(buf, openPdf, { maxPages });
    const renderPage = makePdfPageRenderer(buf, openPdf);
    const images = [];
    // If scan-only pages exist and we're in a browser with canvas, render up to 4 candidate page images.
    if (renderPage && typeof globalThis.document !== 'undefined') {
      const textPages = new Set(pdf.pages.map((p) => p.page));
      for (const pNum of (pdf.figurePages || [])) {
        if (textPages.has(pNum) || images.length >= 4) continue;
        const canvas = await renderPage(pNum, 1100).catch(() => null);
        if (canvas && typeof canvas.toBlob === 'function') {
          try {
            images.push({ ...(await canvasImage(canvas, `page-${pNum}`, 1100)), page: pNum });
          } catch { /* Optional page image. */ }
        }
      }
    }
    return {
      title: cleanTitle(name),
      text: pdf.text,
      images,
      pageCount: pdf.pageCount,
      figurePages: pdf.figurePages || [],
      renderPage,
    };
  }
  if (/\.html?$/i.test(lower)) {
    return { title: cleanTitle(name), text: await extractHtmlText(decodeText(buf)), images: [] };
  }
  if (isOfficeName(lower)) {
    const { officeMarkdown } = await import('./office.js');
    return { title: cleanTitle(name), text: await officeMarkdown(name, buf), images: [] };
  }
  const imgExt = lower.match(/\.(png|jpe?g|webp|gif|bmp)$/)?.[1];
  if (imgExt) {
    return {
      title: cleanTitle(name),
      text: `[Image: ${name}]`,
      images: [{ bytes: buf, type: IMAGE_MIME[imgExt] || 'image/png', label: name }],
    };
  }
  if (isTextName(name) || looksLikeText(buf)) {
    return { title: cleanTitle(name), text: decodeText(buf), images: [] };
  }
  throw Error(`${name}: unsupported file format.`);
}

export function coercePageText(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (!raw || typeof raw !== 'object') return '';
  return Object.entries(raw)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `${SOURCE_NAMES[k] || k}: ${v.trim()}`)
    .join('\n');
}

async function readOpenSource(source, { pageText, pageCanvas, notesText, documentInfo }) {
  const info = documentInfo?.() || { pages: 0, title: 'Current document' };
  const indices = parsePageRange(source.range, info.pages || 0);
  const parts = [];
  const images = [];
  const figurePages = [];
  for (const idx of indices.slice(0, 60)) {
    const rawText = await pageText?.(idx, { recognize: true }).catch(() => '');
    const text = coercePageText(rawText);
    if (text) {
      parts.push(`[Page ${idx + 1}]\n${text}`);
      if (pageCanvas) figurePages.push(idx + 1);
    } else if (pageCanvas) {
      figurePages.push(idx + 1);
      if (images.length < 6) {
        try {
          const img = await pageCanvas(idx, 1200, { revealTape: true });
          const canvas = img?.canvas || (typeof img?.toBlob === 'function' ? img : null);
          if (img?.bytes) {
            images.push({ bytes: new Uint8Array(img.bytes), type: img.type || 'image/jpeg', label: `page-${idx + 1}`, page: idx + 1 });
          } else if (canvas && typeof canvas.toBlob === 'function') {
            images.push({ ...(await canvasImage(canvas, `page-${idx + 1}`, 1200)), page: idx + 1 });
          }
        } catch { /* Textless page image optional. */ }
      }
    }
  }
  const notes = String((await notesText?.().catch(() => '')) || '').trim();
  if (notes) parts.unshift(`## Attached Notes\n${notes}`);
  const renderPage = pageCanvas
    ? async (pageNum, maxWidth = 1200) => {
        const idx = Number(pageNum) - 1;
        if (!Number.isInteger(idx) || idx < 0 || (info.pages && idx >= info.pages)) return null;
        const img = await pageCanvas(idx, maxWidth, { revealTape: true }).catch(() => null);
        if (!img) return null;
        if (img.canvas) return img.canvas;
        if (typeof img.toBlob === 'function' || img.dataUrl || img.bytes) return img;
        return null;
      }
    : undefined;
  return {
    id: source.id,
    title: source.label || info.title || 'Open document',
    text: parts.join('\n\n'),
    images,
    pageCount: info.pages || 0,
    figurePages,
    renderPage,
  };
}

/** Fast deterministic signature of file bytes so identical documents added from different sources deduplicate reliably. */
export function contentSignature(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const len = buf.byteLength;
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(len / 512));
  for (let i = 0; i < len; i += step) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const tailStart = Math.max(0, len - 64);
  for (let i = tailStart; i < len; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${len}:${h.toString(16)}`;
}

/** Normalizes a library entry or file descriptor into a canonical dedup key. */
export function normalizeSourceKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.key) return String(entry.key);
  if (entry.dropboxId) return `dropbox:${entry.dropboxId}`;
  if (entry.path) return `local:${entry.path}`;
  if (entry.driveId) return `drive:${entry.driveId}`;
  return String(entry.name || '').trim().toLowerCase();
}

// Resolves a heterogeneous list of selected sources (open note, Recents, folders, local File objects, topics)
// into normalized { id, title, text, images, folderName? } documents, deduplicating repeated files/notes.
export async function resolveSources(sources, deps) {
  const { call, openPdf, library, groups, onProgress, openDocResource } = deps;
  const resolved = [];
  const seenFiles = new Set();
  const seenContent = new Set();

  const openRes = typeof openDocResource === 'function' ? (openDocResource() || null) : (openDocResource || null);
  const hasOpen = (sources || []).some((s) => s.kind === 'open');
  if (hasOpen && openRes) {
    if (openRes.entryKey) seenFiles.add(String(openRes.entryKey));
    if (openRes.name) seenFiles.add(`name:${String(openRes.name).trim().toLowerCase()}`);
  }

  const addFileLike = async (title, name, bytes, folderName = '') => {
    const sig = contentSignature(bytes);
    if (seenContent.has(sig)) return;
    seenContent.add(sig);
    const res = await extractFileBytes(name, bytes, { call, openPdf });
    resolved.push({
      id: `${folderName ? folderName + ':' : ''}${name}`,
      title: res.title || title || cleanTitle(name),
      name,
      folderName,
      text: coerceSourceText(res.text),
      images: res.images || [],
      pageCount: res.pageCount || 0,
      figurePages: res.figurePages || [],
      renderPage: res.renderPage,
    });
  };

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    onProgress?.(i, sources.length, src.label || src.name || 'Reading source…');
    if (src.kind === 'topic') {
      const topicText = coerceSourceText(src.text);
      if (topicText) {
        const topicSig = `topic:${topicText.toLowerCase()}`;
        if (!seenContent.has(topicSig)) {
          seenContent.add(topicSig);
          resolved.push({ id: src.id, title: src.label || topicText.slice(0, 48), text: topicText, images: [] });
        }
      }
      continue;
    }
    if (src.kind === 'open') {
      if (!seenFiles.has('open:current')) {
        seenFiles.add('open:current');
        resolved.push(await readOpenSource(src, deps));
      }
      continue;
    }
    if (src.kind === 'file' && src.file) {
      const k = `${src.file.name}:${src.file.size}:${src.file.lastModified}`;
      const nameKey = `name:${String(src.file.name || '').trim().toLowerCase()}`;
      if (seenFiles.has(k) || (hasOpen && openRes?.name && seenFiles.has(nameKey) && src.file.name === openRes.name)) continue;
      seenFiles.add(k);
      const buf = new Uint8Array(await src.file.arrayBuffer());
      await addFileLike(cleanTitle(src.file.name), src.file.name, buf, src.folderName || '');
      continue;
    }
    if (src.kind === 'recent' && src.entry && library) {
      const key = normalizeSourceKey(src.entry);
      const nameKey = src.entry.name ? `name:${String(src.entry.name).trim().toLowerCase()}` : '';
      if ((key && seenFiles.has(key)) || (hasOpen && nameKey && seenFiles.has(nameKey))) continue;
      if (key) seenFiles.add(key);
      const file = await library.open(src.entry);
      if (!file) continue;
      const buf = new Uint8Array(await file.arrayBuffer());
      await addFileLike(src.entry.title || cleanTitle(src.entry.name), src.entry.name || 'note.noteful', buf, src.folderName || '');
      continue;
    }
    if (src.kind === 'group' && src.group && groups && library) {
      const members = await groups.members(src.group);
      for (const m of members) {
        if (m.source === 'web' || !isSupportedSourceName(m.name || '')) continue;
        const key = normalizeSourceKey(m);
        const nameKey = m.name ? `name:${String(m.name).trim().toLowerCase()}` : '';
        if ((key && seenFiles.has(key)) || (hasOpen && nameKey && seenFiles.has(nameKey))) continue;
        if (key) seenFiles.add(key);
        const file = await library.open(m).catch(() => null);
        if (!file) continue;
        const buf = new Uint8Array(await file.arrayBuffer());
        await addFileLike(m.title || cleanTitle(m.name), m.name, buf, src.group.name || '');
      }
    }
  }
  return resolved
    .map((r) => ({ ...r, text: coerceSourceText(r.text) }))
    .filter((r) => r.text || r.images?.length || (r.renderPage && r.figurePages?.length));
}

// Distributes character budget fairly across all extracted sources so later chapters aren't starved.
export function formatSourceBundle(docs, { maxChars = 72000 } = {}) {
  if (!docs?.length) return { promptText: '', images: [] };
  const budgetPerDoc = Math.max(1800, Math.floor(maxChars / docs.length));
  const sections = [];
  const images = [];
  for (const d of docs) {
    let body = String(d.text || '').trim();
    if (!body && (d.images?.length || d.figurePages?.length || d.pageCount)) {
      const pagesInfo = d.pageCount ? `${d.pageCount} page(s)` : 'scanned pages';
      const imgInfo = d.images?.length ? `, ${d.images.length} page image(s) attached for vision` : '';
      body = `[Image-only / scanned source (${pagesInfo}${imgInfo})]`;
    }
    if (body.length > budgetPerDoc) {
      const head = Math.floor(budgetPerDoc * 0.72);
      const tail = Math.max(0, budgetPerDoc - head - 40);
      body = `${body.slice(0, head)}\n… [middle trimmed] …\n${tail ? body.slice(-tail) : ''}`;
    }
    const header = d.folderName ? `${d.title} (${d.folderName})` : d.title;
    sections.push(`=== SOURCE: ${header} ===\n${body}`);
    for (const img of d.images || []) {
      if (images.length < 8) images.push(img);
    }
  }
  return { promptText: sections.join('\n\n'), images };
}

/**
 * Collects candidate source images + rendered PDF/note figure pages for vision models and builds
 * a concise manifest describing available sourceIndex/page/imageIndex cutout targets.
 */
export async function collectVisualCandidates(docs = [], { maxImages = 6, maxWidth = 1000, renderMissing = true } = {}) {
  const images = [];
  const manifest = [];
  const seenKeys = new Set();

  for (let si = 0; si < (docs || []).length; si++) {
    const doc = docs[si];
    if (!doc) continue;
    const docImages = Array.isArray(doc.images) ? doc.images : [];
    const addedPages = [];
    for (let ii = 0; ii < docImages.length; ii++) {
      const img = docImages[ii];
      if (!img?.bytes?.length) continue;
      const pageNum = Number.isInteger(img.page) ? img.page : null;
      const key = pageNum ? `s:${si}:p:${pageNum}` : `s:${si}:i:${ii}`;
      if (seenKeys.has(key)) continue;
      if (images.length < maxImages) {
        seenKeys.add(key);
        const globalIdx = images.length;
        images.push({
          bytes: img.bytes,
          type: img.type || 'image/jpeg',
          label: pageNum ? `source-${si}-page-${pageNum}` : (img.label || `image-${globalIdx}`),
          sourceIndex: si,
          page: pageNum,
        });
        if (pageNum) addedPages.push(pageNum);
        else manifest.push(`- Image #${globalIdx} ("${img.label || `image-${globalIdx}`}", source ${si} "${doc.title || ''}"): use {"type":"cutout","imageIndex":${globalIdx},"bbox":[x,y,w,h],"caption":"..."}`);
      }
    }

    const candPages = [...new Set([
      ...(Array.isArray(doc.figurePages) ? doc.figurePages : []),
      ...Array.from({ length: Math.min(4, Number(doc.pageCount || 0)) }, (_, k) => k + 1),
    ])].filter((p) => Number.isInteger(p) && p >= 1);

    if (renderMissing && typeof doc.renderPage === 'function' && images.length < maxImages) {
      let renderedForDoc = 0;
      for (const pNum of candPages) {
        if (images.length >= maxImages || renderedForDoc >= 3) break;
        const key = `s:${si}:p:${pNum}`;
        if (seenKeys.has(key)) continue;
        const rendered = await doc.renderPage(pNum, maxWidth).catch(() => null);
        if (!rendered) continue;
        let imgObj = null;
        if (rendered.bytes) {
          imgObj = { bytes: new Uint8Array(rendered.bytes), type: rendered.type || 'image/jpeg' };
        } else if (rendered.dataUrl) {
          imgObj = dataUrlToBytes(rendered.dataUrl);
        } else if (typeof rendered.toBlob === 'function') {
          imgObj = await canvasImage(rendered, `source-${si}-page-${pNum}`, maxWidth).catch(() => null);
        }
        if (imgObj?.bytes?.length) {
          seenKeys.add(key);
          images.push({
            bytes: imgObj.bytes,
            type: imgObj.type || 'image/jpeg',
            label: `source-${si}-page-${pNum}`,
            sourceIndex: si,
            page: pNum,
          });
          addedPages.push(pNum);
          renderedForDoc++;
        }
      }
    }

    if (addedPages.length) {
      manifest.push(`- Source [${si}] "${doc.title || `Source ${si + 1}`}" (attached pages: ${addedPages.join(', ')}): use {"type":"cutout","sourceIndex":${si},"page":P,"bbox":[x,y,w,h],"caption":"..."}`);
    } else if (typeof doc.renderPage === 'function' && (doc.figurePages?.length || doc.pageCount)) {
      const hintPages = (doc.figurePages?.length ? doc.figurePages : [1]).slice(0, 8).join(', ');
      manifest.push(`- Source [${si}] "${doc.title || `Source ${si + 1}`}" (pages with figures: ${hintPages}): use {"type":"cutout","sourceIndex":${si},"page":P,"bbox":[x,y,w,h],"caption":"..."}`);
    }
  }

  return {
    images,
    manifest: manifest.join('\n'),
  };
}

/**
 * Resolves a `cutout` visual spec into an embedded `dataUrl` image by cropping the referenced
 * source page or attached image using normalized [x, y, w, h] coordinates.
 */
export async function resolveVisualCutout(visual, docs = [], { defaultSourceIndex = 0, maxWidth = 960, preloadedImages = [] } = {}) {
  if (!visual || typeof visual !== 'object') return visual;
  if (String(visual.type || '').toLowerCase() !== 'cutout') return visual;

  const existingUrl = String(visual.dataUrl || visual.src || '').trim();
  if (DATA_IMG_RE.test(existingUrl)) {
    return { ...visual, type: 'cutout', dataUrl: existingUrl };
  }

  const bbox = visual.bbox != null ? clampNormalizedBbox(visual.bbox) : [0, 0, 1, 1];
  if (visual.bbox != null && !bbox) return null;

  const flatImages = preloadedImages?.length
    ? preloadedImages
    : (docs || []).flatMap((d, si) => (d?.images || []).map((im) => ({ ...im, sourceIndex: si })));

  // 1. Direct imageIndex reference
  if (Number.isInteger(Number(visual.imageIndex)) && Number(visual.imageIndex) >= 0) {
    const img = flatImages[Number(visual.imageIndex)];
    if (img?.bytes?.length) {
      const cropped = await cropImageBytes(img.bytes, img.type || 'image/png', bbox, { maxWidth }).catch(() => null);
      if (cropped?.dataUrl) {
        return { ...visual, type: 'cutout', bbox: cropped.bbox || bbox, dataUrl: cropped.dataUrl };
      }
    }
  }

  // 2. Source page + normalized bbox crop
  const srcIdx = Number.isInteger(Number(visual.sourceIndex)) ? Number(visual.sourceIndex) : defaultSourceIndex;
  const pageNum = Number(visual.page);
  const doc = (docs || [])[srcIdx];
  if (doc && Number.isInteger(pageNum) && pageNum >= 1) {
    if (typeof doc.renderPage === 'function') {
      const rendered = await doc.renderPage(pageNum, Math.max(maxWidth, 1200)).catch(() => null);
      if (rendered) {
        if (rendered.width > 0 && rendered.height > 0 && (typeof rendered.getContext === 'function' || rendered.ownerDocument)) {
          const cropped = await cropCanvasRegion(rendered, bbox, { maxWidth, mime: 'image/jpeg', quality: 0.88 }).catch(() => null);
          if (cropped?.dataUrl) {
            return { ...visual, type: 'cutout', sourceIndex: srcIdx, page: pageNum, bbox: cropped.bbox || bbox, dataUrl: cropped.dataUrl };
          }
        } else if (rendered.bytes?.length) {
          const cropped = await cropImageBytes(rendered.bytes, rendered.type || 'image/jpeg', bbox, { maxWidth }).catch(() => null);
          if (cropped?.dataUrl) {
            return { ...visual, type: 'cutout', sourceIndex: srcIdx, page: pageNum, bbox: cropped.bbox || bbox, dataUrl: cropped.dataUrl };
          }
        } else if (rendered.dataUrl && DATA_IMG_RE.test(rendered.dataUrl)) {
          const isFull = bbox[0] <= 0.001 && bbox[1] <= 0.001 && bbox[2] >= 0.998 && bbox[3] >= 0.998;
          if (isFull) {
            return { ...visual, type: 'cutout', sourceIndex: srcIdx, page: pageNum, bbox, dataUrl: rendered.dataUrl };
          }
          const dec = dataUrlToBytes(rendered.dataUrl);
          if (dec) {
            const cropped = await cropImageBytes(dec.bytes, dec.type, bbox, { maxWidth }).catch(() => null);
            if (cropped?.dataUrl) {
              return { ...visual, type: 'cutout', sourceIndex: srcIdx, page: pageNum, bbox: cropped.bbox || bbox, dataUrl: cropped.dataUrl };
            }
          }
        }
      }
    }
    const matchingImg = (doc.images || []).find((im) => Number(im.page) === pageNum);
    if (matchingImg?.bytes?.length) {
      const cropped = await cropImageBytes(matchingImg.bytes, matchingImg.type || 'image/jpeg', bbox, { maxWidth }).catch(() => null);
      if (cropped?.dataUrl) {
        return { ...visual, type: 'cutout', sourceIndex: srcIdx, page: pageNum, bbox: cropped.bbox || bbox, dataUrl: cropped.dataUrl };
      }
    }
  }

  return null;
}

/** Resolves all `cutout` visuals inside a cleaned exam or solved exam structure. */
export async function resolveExamVisualCutouts(target, docs = [], opts = {}) {
  if (!target || typeof target !== 'object') return target;
  const resolveVis = (v) => (v && v.type === 'cutout' ? resolveVisualCutout(v, docs, opts) : Promise.resolve(v));

  if (Array.isArray(target.sections)) {
    const sections = [];
    for (const sec of target.sections) {
      const problems = [];
      for (const p of sec.problems || []) {
        const visual = await resolveVis(p.visual);
        const ansVisual = await resolveVis(p.answerBox?.visual);
        problems.push({
          ...p,
          visual: visual || null,
          answerBox: p.answerBox ? { ...p.answerBox, visual: ansVisual || null } : p.answerBox,
        });
      }
      sections.push({ ...sec, problems });
    }
    return { ...target, sections };
  }

  if (Array.isArray(target.exercises)) {
    const exercises = [];
    for (const ex of target.exercises) {
      const visual = await resolveVis(ex.visual);
      const solutionVisual = await resolveVis(ex.solutionVisual);
      const partSolutions = Array.isArray(ex.partSolutions)
        ? await Promise.all(ex.partSolutions.map(async (ps) => ({
            ...ps,
            visual: (await resolveVis(ps.visual)) || null,
          })))
        : ex.partSolutions;
      exercises.push({
        ...ex,
        visual: visual || null,
        solutionVisual: solutionVisual || null,
        partSolutions,
      });
    }
    return { ...target, exercises };
  }

  return target;
}
