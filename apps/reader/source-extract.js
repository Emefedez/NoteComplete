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

export async function extractPdfText(bytes, openPdf, { maxPages = 60 } = {}) {
  if (typeof openPdf !== 'function') return { pageCount: 0, text: '', pages: [] };
  const pdf = await openPdf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const total = pdf?.numPages || 0;
  const limit = maxPages > 0 ? Math.min(total, maxPages) : total;
  const pages = [];
  for (let p = 1; p <= limit; p++) {
    try {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const text = (tc?.items || []).map((it) => it?.str || '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) pages.push({ page: p, text });
    } catch { /* Keep reading the rest of the PDF. */ }
  }
  await pdf?.destroy?.().catch?.(() => {});
  return {
    pageCount: total,
    pages,
    text: pages.map((p) => `[Page ${p.page}]\n${p.text}`).join('\n\n'),
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
  const summary = await call('extractNoteSummary', { bytes: buf, maxPages }, [buf.buffer.slice(0)]);
  const parts = [];
  if (summary?.markdown?.trim()) {
    parts.push(`## Notes\n${summary.markdown.trim()}`);
  }
  const pdfCache = new Map();
  for (const id of summary?.pdf_ids || []) {
    if (String(id).startsWith('paper-')) continue;
    try {
      const pdfBytes = await call('extractNotePdf', { bytes: buf, pdfId: id }, [buf.buffer.slice(0)]);
      pdfCache.set(id, await extractPdfText(pdfBytes, openPdf, { maxPages }));
    } catch { /* Keep note text even if embedded PDF fails. */ }
  }
  for (const page of summary?.pages || []) {
    const chunks = [];
    if (page.typed?.trim()) chunks.push(page.typed.trim());
    if (page.ink?.trim()) chunks.push(page.ink.trim());
    if (page.recognized?.trim() && page.recognized.trim() !== page.ink?.trim()) chunks.push(page.recognized.trim());
    const bg = page.pdf_background;
    if (bg?.resource_id && pdfCache.has(bg.resource_id)) {
      const pdfPageNum = Number(bg.page_index ?? 0) + 1;
      const pdfPage = pdfCache.get(bg.resource_id).pages.find((x) => x.page === pdfPageNum);
      if (pdfPage?.text && !chunks.some((c) => c.includes(pdfPage.text.slice(0, 60)))) chunks.push(pdfPage.text);
    }
    const merged = chunks.join('\n').trim();
    if (merged) parts.push(`[Page ${page.page}]\n${merged}`);
  }
  return {
    title: summary?.title || '',
    pageCount: summary?.page_count || 0,
    text: parts.join('\n\n'),
  };
}

export async function extractFileBytes(name, bytes, { call, openPdf, maxPages = 60 } = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const lower = String(name || '').toLowerCase();
  if (ARCHIVE_EXT.test(lower)) {
    const note = await extractNoteArchive(buf, { call, openPdf, maxPages });
    return { title: note.title || cleanTitle(name), text: note.text, images: [], pageCount: note.pageCount };
  }
  if (/\.pdf$/i.test(lower)) {
    const pdf = await extractPdfText(buf, openPdf, { maxPages });
    return { title: cleanTitle(name), text: pdf.text, images: [], pageCount: pdf.pageCount };
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
  for (const idx of indices.slice(0, 60)) {
    const rawText = await pageText?.(idx, { recognize: true }).catch(() => '');
    const text = coercePageText(rawText);
    if (text) parts.push(`[Page ${idx + 1}]\n${text}`);
    else if (pageCanvas && images.length < 6) {
      try {
        const img = await pageCanvas(idx, 1200, { revealTape: true });
        if (img?.bytes) images.push({ bytes: new Uint8Array(img.bytes), type: img.type || 'image/jpeg', label: `page-${idx + 1}` });
        else if (typeof img?.toBlob === 'function') images.push(await canvasImage(img, `page-${idx + 1}`, 1200));
      } catch { /* Textless page image optional. */ }
    }
  }
  const notes = String((await notesText?.().catch(() => '')) || '').trim();
  if (notes) parts.unshift(`## Attached Notes\n${notes}`);
  return {
    id: source.id,
    title: source.label || info.title || 'Open document',
    text: parts.join('\n\n'),
    images,
  };
}

// Resolves a heterogeneous list of selected sources (open note, Recents, folders, local File objects, topics)
// into normalized { id, title, text, images, folderName? } documents.
export async function resolveSources(sources, deps) {
  const { call, openPdf, library, groups, onProgress } = deps;
  const resolved = [];
  const seenFiles = new Set();

  const addFileLike = async (title, name, bytes, folderName = '') => {
    const res = await extractFileBytes(name, bytes, { call, openPdf });
    resolved.push({
      id: `${folderName ? folderName + ':' : ''}${name}`,
      title: res.title || title || cleanTitle(name),
      name,
      folderName,
      text: coerceSourceText(res.text),
      images: res.images || [],
    });
  };

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    onProgress?.(i, sources.length, src.label || src.name || 'Reading source…');
    if (src.kind === 'topic') {
      const topicText = coerceSourceText(src.text);
      if (topicText) {
        resolved.push({ id: src.id, title: src.label || topicText.slice(0, 48), text: topicText, images: [] });
      }
      continue;
    }
    if (src.kind === 'open') {
      resolved.push(await readOpenSource(src, deps));
      continue;
    }
    if (src.kind === 'file' && src.file) {
      const k = `${src.file.name}:${src.file.size}:${src.file.lastModified}`;
      if (seenFiles.has(k)) continue;
      seenFiles.add(k);
      const buf = new Uint8Array(await src.file.arrayBuffer());
      await addFileLike(cleanTitle(src.file.name), src.file.name, buf, src.folderName || '');
      continue;
    }
    if (src.kind === 'recent' && src.entry && library) {
      const key = src.entry.key || src.entry.path || src.entry.name;
      if (key && seenFiles.has(key)) continue;
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
        const key = m.key || m.path || m.name;
        if (key && seenFiles.has(key)) continue;
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
    .filter((r) => r.text || r.images?.length);
}

// Distributes character budget fairly across all extracted sources so later chapters aren't starved.
export function formatSourceBundle(docs, { maxChars = 72000 } = {}) {
  if (!docs?.length) return { promptText: '', images: [] };
  const budgetPerDoc = Math.max(1800, Math.floor(maxChars / docs.length));
  const sections = [];
  const images = [];
  for (const d of docs) {
    let body = String(d.text || '').trim();
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
