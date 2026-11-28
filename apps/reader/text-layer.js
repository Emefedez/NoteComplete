// Selectable text over a page: PDF words and recognized (OCR) words as
// transparent SVG text stretched over each word's box, so the cursor selects
// them like text in a PDF viewer and Ctrl+C copies them in reading order.
const ns = 'http://www.w3.org/2000/svg';

const overlaps = (a, b) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 && (w * h) / Math.min(a[2] * a[3], b[2] * b[3]) > 0.5;
};

const valid = w => w?.text && Array.isArray(w.box) && w.box.length === 4 && w.box.every(Number.isFinite) && w.box[2] > 0 && w.box[3] > 0;
const shape = w => ({ text: w.text, x: w.box[0], y: w.box[1], w: w.box[2], h: w.box[3], cy: w.box[1] + w.box[3] / 2, link: w.link, space: w.space });
const sameLine = (a, b) => Math.abs(a.cy - b.cy) < Math.min(a.h, b.h) * 0.6;
const box = w => [w.x, w.y, w.w, w.h];

// Text a PDF draws twice at (nearly) one spot, for a fake bold or a shadow, once: copied
// twice it was "double" text, and the second copy made a line of its own.
function once(words) {
  const kept = [], cells = new Map();
  const cell = (w) => Math.round(w.cy / Math.max(4, w.h));
  for (const w of words) {
    const near = [-1, 0, 1].flatMap((d) => cells.get(cell(w) + d) || []);
    if (near.some((o) => o.text === w.text && overlaps(box(o), box(w)))) continue;
    kept.push(w);
    const c = cell(w);
    if (!cells.has(c)) cells.set(c, []);
    cells.get(c).push(w);
  }
  return kept;
}

// Words grouped by where they are: lines top to bottom, each left to right (recognized text,
// and PDF text written in no useful order).
function byPlace(words) {
  const lines = [];
  for (const word of [...words].sort((a, b) => a.cy - b.cy)) {
    const line = lines.find(l => sameLine(l, word) && !l.words.some(o => o.x < word.x + word.w && word.x < o.x + o.w));
    if (line) {
      line.words.push(word);
      line.cy = (line.cy * (line.words.length - 1) + word.cy) / line.words.length;
      line.h = Math.max(line.h, word.h);
    } else lines.push({ cy: word.cy, h: word.h, words: [word] });
  }
  for (const line of lines) { line.words.sort((a, b) => a.x - b.x); line.x = line.words[0].x; line.right = line.words.at(-1).x + line.words.at(-1).w; }
  return lines.sort((a, b) => a.cy - b.cy);
}

// PDF words in the order the file writes them, which is how it is read (a column to its end,
// then the next; a table cell by cell): runs of words that follow each other along one line.
// Null when that order is no order (words going back along their line too often): then by place.
function byStream(words) {
  const runs = [];
  let back = 0;
  for (const word of words) {
    const run = runs.at(-1), last = run?.words.at(-1);
    if (last && sameLine(last, word) && word.x >= last.x + last.w * 0.5 - word.h * 0.3) {
      run.words.push(word);
      run.cy = (run.cy * (run.words.length - 1) + word.cy) / run.words.length;
      run.h = Math.max(run.h, word.h);
      run.right = word.x + word.w;
      continue;
    }
    if (last && sameLine(last, word) && word.x < last.x) back++;
    runs.push({ cy: word.cy, h: word.h, x: word.x, right: word.x + word.w, words: [word] });
  }
  return back > Math.max(2, words.length * 0.1) ? null : runs;
}

// Words grouped into lines in reading order, each line left to right: the selectable text,
// what Ctrl+C copies, and what a text highlight follows. PDF text keeps the file's order (so
// two columns copy one after the other, not mixed line by line); recognized (OCR) words go
// where they are, and PDF text wins where an OCR reading covers the same spot.
export function textLines({ pdf = [], ocr = [] }) {
  const printed = once(pdf.filter(valid).map(shape));
  const read = ocr.filter(w => valid(w) && !printed.some(p => overlaps(box(p), [w.box[0], w.box[1], w.box[2], w.box[3]]))).map(shape);
  const lines = byStream(printed) || byPlace(printed);
  for (const line of byPlace(read)) {
    // On a PDF line's height, just after its end: the same line ("Sector" printed, "ink" written).
    const host = lines.filter(l => sameLine(l, line) && l.right <= line.x + line.h).sort((a, b) => b.right - a.right)[0];
    if (host) { host.words.push(...line.words); host.right = line.right; continue; }
    // Else after the last line above it in its column, or by height.
    const above = lines.map((l, i) => [l, i]).filter(([l]) => l.cy < line.cy && l.x < line.right && line.x < l.right).sort((a, b) => b[0].cy - a[0].cy)[0];
    const at = above ? above[1] + 1 : lines.findIndex(l => l.cy > line.cy);
    lines.splice(at < 0 ? lines.length : at, 0, line);
  }
  return lines;
}

// Whether a space goes between two words of a line: not when the PDF wrote one word in pieces
// that touch ("certi" "fi" "cados" around a ligature, "cursos" ","), nor between the letters
// of a spaced-out title ("A R Q U I"), which copied as separate letters.
export function spaced(word, next) {
  // The PDF said (pdf-background.js textWords): its own spaces.
  if (next.space === true) return true;
  const gap = next.x - (word.x + word.w), h = Math.min(word.h, next.h);
  if (gap < h * 0.08) return false;
  if (next.space === false && [...word.text].length === 1 && [...next.text].length === 1 && gap < h * 0.5) return false;
  return !([...word.text].length === 1 && [...next.text].length === 1 && /\p{L}/u.test(word.text + next.text) && gap < h * 0.22);
}

export function textLayer(size, sources) {
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('text-layer');
  svg.setAttribute('viewBox', `0 0 ${size.join(' ')}`);
  for (const line of textLines(sources)) {
    const text = document.createElementNS(ns, 'text');
    // Where the line is, for joining the lines a selection copies (selectedText).
    text.dataset.cy = line.cy;
    text.dataset.h = line.h;
    text.dataset.x = line.words[0].x;
    text.dataset.right = line.words.at(-1).x + line.words.at(-1).w;
    line.words.forEach((word, i) => {
      const next = line.words[i + 1];
      const span = document.createElementNS(ns, 'tspan');
      // The gap to the next word belongs to this word, so a drag across it
      // selects the space and copies "a b", not "ab".
      for (const [k, v] of Object.entries({ x: word.x, y: word.y + word.h * 0.82, 'font-size': word.h, textLength: (next ? next.x : word.x + word.w) - word.x, lengthAdjust: 'spacingAndGlyphs' }))
        span.setAttribute(k, v);
      span.textContent = next && spaced(word, next) ? `${word.text} ` : word.text;
      text.append(span);
    });
    svg.append(text);
    // Links written in the handwriting ([label](url) in Markdown): one target per word.
    for (const word of line.words) {
      if (!linkAllowed(word.link)) continue;
      const a = document.createElementNS(ns, 'a');
      a.classList.add('ink-link');
      a.setAttribute('href', word.link);
      if (/^https?:/.test(word.link)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
      const title = document.createElementNS(ns, 'title');
      title.textContent = word.link.startsWith('notecomplete:') ? word.text : word.link;
      const rect = document.createElementNS(ns, 'rect');
      for (const [k, v] of Object.entries({ x: word.x, y: word.y, width: word.w, height: word.h })) rect.setAttribute(k, v);
      a.append(title, rect);
      svg.append(a);
    }
  }
  return svg;
}
// Web links, local file links (file://), and the app's own actions (notecomplete:install); nothing that runs script.
export const linkAllowed = (link) => typeof link === 'string' && link.length <= 500 && /^(https?:\/\/|file:\/\/|notecomplete:)[^\s]*$/.test(link);

// The selected part of a text layer as plain text, one line per row.
export function selectedText(selection) {
  if (!selection?.rangeCount) return '';
  const range = selection.getRangeAt(0);
  const layer = range.commonAncestorContainer.parentElement?.closest?.('.text-layer') || range.commonAncestorContainer.closest?.('.text-layer');
  if (!layer) return '';
  let out = '', previous = null;
  for (const text of layer.querySelectorAll('text')) {
    let line = '';
    for (const span of text.children) {
      const node = span.firstChild;
      if (!node || !range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0, end = node === range.endContainer ? range.endOffset : node.length;
      line += node.data.slice(start, end);
    }
    if (!line.trim()) continue;
    // Two runs on one line, the second after the first (a PDF that wrote a line in two
    // pieces): one line, a space between.
    const at = { cy: Number(text.dataset.cy), h: Number(text.dataset.h), x: Number(text.dataset.x), right: Number(text.dataset.right) };
    const joined = previous && Number.isFinite(at.cy) && sameLine(previous, at) && at.x >= previous.right - at.h * 0.3;
    out += (out ? (joined ? ' ' : '\n') : '') + line.trim();
    previous = at;
  }
  return out;
}
