// Helpers for Pages -> Change PDF background: page range parsing, proportional placement,
// mapping selected note pages to PDF pages, and size/compaction heuristics.
import { UNITS_PER_POINT } from './insert-pages.js';

export const LARGE_PDF_BYTES = 1.5 * 1024 * 1024;

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 10 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Parse "1, 3-5, 8" into sorted unique 0-based page indices.
export function parsePageSelection(spec, totalPages) {
  const raw = String(spec || '').trim();
  if (!raw) return { error: 'Enter page numbers or ranges (for example: 1, 3-5).' };
  const picked = new Set();
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]), to = Number(range[2]);
      if (from < 1 || to < from || to > totalPages)
        return { error: `Page range "${token}" must be within 1-${totalPages}.` };
      for (let p = from; p <= to; p++) picked.add(p - 1);
      continue;
    }
    if (/^\d+$/.test(token)) {
      const p = Number(token);
      if (p < 1 || p > totalPages) return { error: `Page ${p} is outside 1-${totalPages}.` };
      picked.add(p - 1);
      continue;
    }
    return { error: `Could not understand "${token}". Use pages like 1, 3-5.` };
  }
  const indices = [...picked].sort((a, b) => a - b);
  return indices.length ? { indices } : { error: 'Select at least one page.' };
}

export function fitPdfRect([pdfW, pdfH], [pageW, pageH]) {
  if (!(pdfW > 0 && pdfH > 0 && pageW > 0 && pageH > 0)) return [0, 0, pageW, pageH];
  const scale = Math.min(pageW / pdfW, pageH / pdfH);
  const w = pdfW * scale, h = pdfH * scale;
  return [(pageW - w) / 2, (pageH - h) / 2, w, h];
}

export function usedPdfPageIndices({ noteCount, pdfPageCount, startPdfPage = 0, mode = 'sequence' }) {
  if (!(pdfPageCount > 0 && noteCount > 0)) return [];
  const start = Math.max(0, Math.min(pdfPageCount - 1, startPdfPage));
  if (mode === 'repeat') return [start];
  const used = new Set();
  for (let i = 0; i < noteCount; i++) used.add(Math.min(pdfPageCount - 1, start + i));
  return [...used].sort((a, b) => a - b);
}

export function shouldSuggestCompact(bytes, totalPdfPages, usedPdfPageCount) {
  return bytes >= LARGE_PDF_BYTES && totalPdfPages > 1 && usedPdfPageCount < totalPdfPages;
}

export function buildPageBackgroundChanges({
  noteIndices,
  currentSizes,
  source,
  pdfSizesPt = [],
  startPdfPage = 0,
  mode = 'sequence',
  sizeMode = 'fit',
  unitsPerPoint = UNITS_PER_POINT,
  remapIndices = null,
}) {
  if (!source || source.kind === 'none') {
    return noteIndices.map((page) => ({
      page,
      size: [...currentSizes[page]],
      pdf: null,
    }));
  }
  const start = Math.max(0, Math.min(Math.max(0, pdfSizesPt.length - 1), startPdfPage));
  return noteIndices.map((page, offset) => {
    const rawIndex = mode === 'repeat' ? start : Math.min(pdfSizesPt.length - 1, start + offset);
    const pt = pdfSizesPt[rawIndex] || [595, 842];
    const current = currentSizes[page];
    let size;
    let rect;
    if (sizeMode === 'pdf') {
      size = [pt[0] * unitsPerPoint, pt[1] * unitsPerPoint];
      rect = [0, 0, size[0], size[1]];
    } else if (sizeMode === 'width') {
      const w = current[0];
      const h = pt[0] > 0 ? (pt[1] / pt[0]) * w : current[1];
      size = [w, h];
      rect = [0, 0, w, h];
    } else {
      size = [...current];
      rect = fitPdfRect(pt, current);
    }
    const pageIndex = remapIndices ? remapIndices.get(rawIndex) : rawIndex;
    return {
      page,
      size,
      pdf: { resource: source.resourceId, page_index: pageIndex, rect },
    };
  });
}
