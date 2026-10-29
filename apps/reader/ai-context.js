// What the AI sees of a page: an image (tape lifted, since covered answers are
// study material) and the page's text from Find: typed, PDF, OCR and audio.
import { rememberAiFile } from './rich-text.js';
export const SOURCE_NAMES = { text: 'Typed text', pdf: 'PDF text', ocr: 'Recognized handwriting/scan text', audio: 'Lecture transcript', document: 'Text' };

export function jsonFrom(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw Error('The AI did not return the expected JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

export async function canvasImage(canvas, label, width = 1400) {
  const scale = Math.min(1, width / canvas.width);
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  try {
    const page = /^page-(\d+)$/i.test(String(label || '')) ? Number(String(label).slice(5)) : undefined;
    rememberAiFile(label, { url: out.toDataURL('image/jpeg', 0.86), label, page });
  } catch { /* Canvas may be mocked in unit tests. */ }
  const blob = await new Promise(resolve => out.toBlob(resolve, 'image/jpeg', 0.86));
  out.width = out.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg', label };
}

export function hasClipboardImage(clipboardData) {
  return [...(clipboardData?.items || [])].some(item => item.kind === 'file' && /^image\/(png|jpe?g|webp|gif)$/i.test(item.type));
}

export async function clipboardImages(clipboardData, readBlob = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || Error('Could not read pasted image.'));
  reader.readAsDataURL(blob);
})) {
  const files = [...(clipboardData?.items || [])]
    .filter(item => item.kind === 'file' && /^image\/(png|jpe?g|webp|gif)$/i.test(item.type))
    .map(item => item.getAsFile?.())
    .filter(Boolean);
  const out = [];
  for (const file of files) {
    const url = await readBlob(file);
    if (url) out.push({ url, label: 'a pasted image from the clipboard' });
  }
  return out;
}

// Text documents have sections instead of pages (text-study.js): `unit` names them.
export function textBlock(page, parts, limit = 6000, unit = 'page') {
  const lines = Object.entries(parts).filter(([, v]) => v?.trim()).map(([k, v]) => `${SOURCE_NAMES[k] || k}:\n${v.trim().slice(0, limit)}`);
  return `--- ${unit === 'section' ? 'Section' : 'Page'} ${page + 1} ---\n${lines.join('\n') || (unit === 'section' ? '(empty)' : '(no extracted text; read the image)')}`;
}

// The user's own Markdown notes for the document, capped, as a prompt block.
export function notesBlock(text, limit = 20000) {
  const notes = String(text || '').trim();
  if (!notes) return '';
  const cut = notes.length > limit ? `${notes.slice(0, limit)}\n[… ${notes.length - limit} more characters not included]` : notes;
  return `The student's own Markdown notes for this document (lines like "[p. 3]" tie a section to a page):\n${cut}`;
}
// Page images plus text for a list of display pages; text documents have no
// image (pageCanvas gives null), only their sections' text.
export async function pagesContext(pages, { pageCanvas, pageText, onProgress = () => {}, width = 2200, unit = 'page' }) {
  const images = [], texts = [];
  for (const [n, page] of pages.entries()) {
    onProgress(n, pages.length, page);
    const drawn = await pageCanvas(page, width, { liftTape: true });
    if (drawn?.canvas) {
      images.push(await canvasImage(drawn.canvas, `page-${page + 1}`));
      drawn.canvas.width = drawn.canvas.height = 0;
    }
    texts.push(textBlock(page, await pageText(page), unit === 'section' ? 12000 : 6000, unit));
  }
  return { images, text: texts.join('\n\n') };
}
