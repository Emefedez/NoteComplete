// Chinese inside a picture (a scanned or image-only PDF, an inserted image): what a right-click
// on it can look up although there is no text to select. A small snapshot around the pointer is
// read with Tesseract (ocr.js, Chinese data fetched once and kept by the browser) in the
// background while the menu is already open; when it finds a Chinese character there, zh-menu.js
// adds its look-up, Listen and Stroke order entries to that menu. Nothing loads before
// Chinese is used (zh-menu.js decides), and the engine is let go after a while unused.
import { HAN } from './vocab.js';

// A symbol read below this confidence (0–100) is not offered.
export const MIN_CONFIDENCE = 55;
// How far around the pointer the snapshot reaches: a few lines' worth, sized to the page, so the
// character under it is whole even in a heading.
export const snapshotSize = (pageHeight) => {
  const height = Math.max(96, Math.min(260, Math.round(pageHeight * 0.1)));
  return { width: height * 3, height };
};
// White around the snapshot, in its own pixels (Tesseract misreads print touching the edge).
const MARGIN = 24;

// The Chinese line read in a snapshot and the character at `point` ([x, y] in its pixels):
// { text, index } (index: UTF-16 offset of that character in text), or null. `data`: Tesseract's
// blocks. A character counts when the point is inside it or within half its height.
export function hanAt(data, [x, y], minConfidence = MIN_CONFIDENCE) {
  let best = null;
  for (const block of data?.blocks || [])
    for (const paragraph of block.paragraphs || [])
      for (const line of paragraph.lines || []) {
        const symbols = (line.words || []).flatMap((w) => w.symbols || []).filter((s) => HAN.test(s.text || '') && s.confidence >= minConfidence);
        symbols.forEach((s, k) => {
          const { x0, y0, x1, y1 } = s.bbox;
          const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1), d = Math.hypot(dx, dy);
          if (d > (y1 - y0) / 2) return;
          if (!best || d < best.d) best = { d, symbols, k };
        });
      }
  if (!best) return null;
  const chars = best.symbols.map((s) => [...s.text.trim()][0]);
  return { text: chars.join(''), index: chars.slice(0, best.k).join('').length };
}

// The picture under client (x, y) in `root` (a page): the PDF raster (its sharper zoom tile when
// there is one) or an image, as { source, rect, scale } (scale: source pixels per CSS pixel).
async function pictureAt(root, x, y) {
  const inside = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  let best = null;
  for (const el of root.querySelectorAll('canvas.pdf-raster, canvas.pdf-detail, image')) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !inside(rect)) continue;
    let source = el;
    if (el.localName === 'image') {
      const href = el.getAttribute('href') || el.getAttribute('xlink:href');
      if (!href) continue;
      source = new Image();
      source.src = href;
      try { await source.decode(); } catch { continue; }
    }
    const scale = (source.naturalWidth || source.width) / rect.width;
    if (!best || scale > best.scale) best = { source, rect, scale };
  }
  return best;
}

// A canvas of the picture around client (x, y), white behind it, at least twice the size it is
// shown (Tesseract reads small print better larger), and the pointer in its pixels.
export async function snapshotAt(root, x, y) {
  const pic = await pictureAt(root, x, y);
  if (!pic) return null;
  const { width, height } = snapshotSize(root.getBoundingClientRect().height || 800);
  const left = Math.max(pic.rect.left, x - width / 2), top = Math.max(pic.rect.top, y - height / 2);
  const right = Math.min(pic.rect.right, x + width / 2), bottom = Math.min(pic.rect.bottom, y + height / 2);
  if (right - left < 8 || bottom - top < 8) return null;
  const out = Math.min(4, Math.max(2, pic.scale));
  const w = Math.round((right - left) * out), h = Math.round((bottom - top) * out);
  const canvas = document.createElement('canvas');
  canvas.width = w + 2 * MARGIN;
  canvas.height = h + 2 * MARGIN;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(pic.source, (left - pic.rect.left) * pic.scale, (top - pic.rect.top) * pic.scale, (right - left) * pic.scale, (bottom - top) * pic.scale, MARGIN, MARGIN, w, h);
  return { canvas, point: [MARGIN + (x - left) * out, MARGIN + (y - top) * out] };
}

// One engine per script, let go after a minute and a half unused.
const IDLE_MS = 90_000;
let engine = null, idle = 0;
async function reader(script) {
  const lang = script === 'traditional' ? 'chi_tra' : 'chi_sim';
  clearTimeout(idle);
  if (engine?.lang !== lang) {
    const old = engine;
    engine = null;
    (await old?.worker.catch(() => null))?.terminate();
    const { ocrWorker } = await import('../ocr.js');
    engine = { lang, worker: ocrWorker(lang).then(async (w) => { await w.setParameters({ tessedit_pageseg_mode: '6' }); return w; }) };
    engine.worker.catch(() => { engine = null; });
  }
  const mine = engine;
  idle = setTimeout(async () => { if (engine === mine) { engine = null; (await mine.worker.catch(() => null))?.terminate(); } }, IDLE_MS);
  return mine.worker;
}

// The Chinese at client (x, y) of a picture in `root`: { text, index } as hanAt, or null.
export async function readPictureAt(root, x, y, { script = 'simplified' } = {}) {
  const shot = await snapshotAt(root, x, y);
  if (!shot) return null;
  const worker = await reader(script);
  const { data } = await worker.recognize(shot.canvas, {}, { text: false, blocks: true });
  return hanAt(data, shot.point);
}
