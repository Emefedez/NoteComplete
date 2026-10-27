// What the AI sees of a page: an image (tape lifted, since covered answers are
// study material) and the page's text from Find: typed, PDF, OCR and audio.
export const SOURCE_NAMES = { text: 'Typed text', pdf: 'PDF text', ocr: 'Recognized handwriting/scan text', audio: 'Lecture transcript' };

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
  const blob = await new Promise(resolve => out.toBlob(resolve, 'image/jpeg', 0.86));
  out.width = out.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg', label };
}

export function textBlock(page, parts, limit = 6000) {
  const lines = Object.entries(parts).filter(([, v]) => v?.trim()).map(([k, v]) => `${SOURCE_NAMES[k] || k}:\n${v.trim().slice(0, limit)}`);
  return `--- Page ${page + 1} ---\n${lines.join('\n') || '(no extracted text; read the image)'}`;
}

// Page images plus text for a list of display pages.
// The user's own Markdown notes for the document, capped, as a prompt block.
export function notesBlock(text, limit = 20000) {
  const notes = String(text || '').trim();
  if (!notes) return '';
  const cut = notes.length > limit ? `${notes.slice(0, limit)}\n[… ${notes.length - limit} more characters not included]` : notes;
  return `The student's own Markdown notes for this document (lines like "[p. 3]" tie a section to a page):\n${cut}`;
}
export async function pagesContext(pages, { pageCanvas, pageText, onProgress = () => {}, width = 2200 }) {
  const images = [], texts = [];
  for (const [n, page] of pages.entries()) {
    onProgress(n, pages.length, page);
    const { canvas } = await pageCanvas(page, width, { liftTape: true });
    images.push(await canvasImage(canvas, `page-${page + 1}`));
    canvas.width = canvas.height = 0;
    texts.push(textBlock(page, await pageText(page)));
  }
  return { images, text: texts.join('\n\n') };
}
