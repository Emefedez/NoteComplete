// Selectable text over a page: PDF words and recognized (OCR) words as
// transparent SVG text stretched over each word's box, so the cursor selects
// them like text in a PDF viewer and Ctrl+C copies them in reading order.
const ns = 'http://www.w3.org/2000/svg';

const overlaps = (a, b) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 && (w * h) / Math.min(a[2] * a[3], b[2] * b[3]) > 0.5;
};

// Words grouped into lines (top to bottom), each line left to right. PDF text
// wins where an OCR reading covers the same spot.
export function textLines({ pdf = [], ocr = [] }) {
  const valid = w => w?.text && Array.isArray(w.box) && w.box.length === 4 && w.box.every(Number.isFinite) && w.box[2] > 0 && w.box[3] > 0;
  const printed = pdf.filter(valid);
  const words = [...printed, ...ocr.filter(w => valid(w) && !printed.some(p => overlaps(p.box, w.box)))]
    .map(w => ({ text: w.text, x: w.box[0], y: w.box[1], w: w.box[2], h: w.box[3], cy: w.box[1] + w.box[3] / 2 }))
    .sort((a, b) => a.cy - b.cy);
  const lines = [];
  for (const word of words) {
    const line = lines.find(l => Math.abs(l.cy - word.cy) < Math.min(l.h, word.h) * 0.6 && !l.words.some(o => o.x < word.x + word.w && word.x < o.x + o.w));
    if (line) {
      line.words.push(word);
      line.cy = (line.cy * (line.words.length - 1) + word.cy) / line.words.length;
      line.h = Math.max(line.h, word.h);
    } else lines.push({ cy: word.cy, h: word.h, words: [word] });
  }
  for (const line of lines) line.words.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.cy - b.cy);
}

export function textLayer(size, sources) {
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('text-layer');
  svg.setAttribute('viewBox', `0 0 ${size.join(' ')}`);
  for (const line of textLines(sources)) {
    const text = document.createElementNS(ns, 'text');
    line.words.forEach((word, i) => {
      const next = line.words[i + 1];
      const span = document.createElementNS(ns, 'tspan');
      // The gap to the next word belongs to this word, so a drag across it
      // selects the space and copies "a b", not "ab".
      for (const [k, v] of Object.entries({ x: word.x, y: word.y + word.h * 0.82, 'font-size': word.h, textLength: (next ? next.x : word.x + word.w) - word.x, lengthAdjust: 'spacingAndGlyphs' }))
        span.setAttribute(k, v);
      span.textContent = next ? `${word.text} ` : word.text;
      text.append(span);
    });
    svg.append(text);
  }
  return svg;
}

// The selected part of a text layer as plain text, one line per row.
export function selectedText(selection) {
  if (!selection?.rangeCount) return '';
  const range = selection.getRangeAt(0);
  const layer = range.commonAncestorContainer.parentElement?.closest?.('.text-layer') || range.commonAncestorContainer.closest?.('.text-layer');
  if (!layer) return '';
  const lines = [];
  for (const text of layer.querySelectorAll('text')) {
    let line = '';
    for (const span of text.children) {
      const node = span.firstChild;
      if (!node || !range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0, end = node === range.endContainer ? range.endOffset : node.length;
      line += node.data.slice(start, end);
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines.join('\n');
}
