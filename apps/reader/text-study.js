// Text documents as study material. A text file has no pages, so flashcards,
// quizzes and Ask AI work on numbered sections instead: the text split at
// headings and blank lines into parts of a few thousand characters. Quizzes
// cite a short quote, found again in the rendered text to scroll to it.

const SIZE = 3500;

// [{ start, end }] offsets into the text; always at least one section.
export function textSections(text, size = SIZE) {
  const blocks = [];
  // Blocks: runs of non-blank lines; a Markdown heading always starts one.
  let at = 0, start = -1;
  for (const line of text.split('\n')) {
    const end = at + line.length;
    if (!line.trim()) { if (start >= 0) blocks.push({ start, end: at - 1 }); start = -1; }
    else if (/^#{1,6}\s/.test(line)) { if (start >= 0) blocks.push({ start, end: at - 1 }); start = at; }
    else if (start < 0) start = at;
    at = end + 1;
  }
  if (start >= 0) blocks.push({ start, end: text.length });
  // Pack blocks up to `size`; a heading starts a new section once the current one is half full.
  const sections = [];
  let current = null;
  for (const block of blocks) {
    for (const piece of split(text, block, size)) {
      const heading = /^#{1,6}\s/.test(text.slice(piece.start, piece.start + 8));
      if (current && (piece.end - current.start > size || (heading && current.end - current.start > size / 2))) { sections.push(current); current = null; }
      current = current ? { start: current.start, end: piece.end } : { start: piece.start, end: piece.end };
    }
  }
  if (current) sections.push(current);
  return sections.length ? sections : [{ start: 0, end: text.length }];
}
// A block longer than `size` cut at the last whitespace before each limit.
function split(text, { start, end }, size) {
  const out = [];
  while (end - start > size) {
    const window = text.slice(start, start + size), cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
    const at = start + (cut > size / 2 ? cut : size);
    out.push({ start, end: at });
    start = at;
    while (start < end && /\s/.test(text[start])) start++;
  }
  if (end > start) out.push({ start, end });
  return out;
}

// Text compared without Markdown marks, case or spacing, so a quote from the
// source is found in the rendered page (and the other way round).
const SKIP = /[\s*_`#>|~\\[\]]/;
export function normalize(text) {
  let out = '', space = false;
  for (const ch of String(text)) {
    if (SKIP.test(ch)) { space = out.length > 0; continue; }
    if (space) out += ' ';
    out += ch.toLowerCase();
    space = false;
  }
  return out;
}
// Where a passage is in a list of text chunks (the rendered text nodes):
// { from: [chunk, offset], to: [chunk, offset] }, or null.
export function findPassage(chunks, passage) {
  const flat = [], map = [];
  let space = false;
  chunks.forEach((chunk, c) => {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (SKIP.test(ch)) { space = flat.length > 0; continue; }
      if (space) { flat.push(' '); map.push([c, i]); }
      flat.push(ch.toLowerCase()); map.push([c, i]);
      space = false;
    }
  });
  const hay = flat.join(''), needle = normalize(passage);
  if (!needle) return null;
  // The whole passage, else its first words (rendered links, formulas and the
  // like change the rest).
  for (const n of [needle, needle.split(' ').slice(0, 8).join(' '), needle.split(' ').slice(0, 4).join(' ')]) {
    const at = n.length >= 3 ? hay.indexOf(n) : -1;
    if (at < 0) continue;
    const last = map[at + n.length - 1];
    return { from: map[at], to: [last[0], last[1] + 1], fraction: at / Math.max(1, hay.length) };
  }
  return null;
}

// The open text document as study material for study.js, quiz.js and chat.js.
export function textStudy({ body, text, selectionLimit = 4000 }) {
  let cache = { text: null, sections: [] };
  const sections = () => {
    const now = text();
    if (cache.text !== now) cache = { text: now, sections: textSections(now) };
    return cache.sections;
  };
  const chunk = i => { const s = sections()[i]; return s ? cache.text.slice(s.start, s.end).trim() : ''; };
  function textNodes() {
    const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  const rangeOf = (nodes, hit) => {
    const range = body.ownerDocument.createRange();
    range.setStart(nodes[hit.from[0]], hit.from[1]);
    range.setEnd(nodes[hit.to[0]], hit.to[1]);
    return range;
  };
  function scrollToRange(range) {
    const top = range.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop += top - body.clientHeight / 4;
  }
  function scrollToFraction(fraction) {
    body.scrollTop = fraction * Math.max(0, body.scrollHeight - body.clientHeight);
  }
  // Typing in Ask AI moves the selection out of the document: the last one made in it counts.
  let picked = '';
  body.ownerDocument.addEventListener('selectionchange', () => {
    const selection = body.ownerDocument.getSelection();
    if (!selection || !body.contains(selection.anchorNode)) return;
    picked = selection.isCollapsed ? '' : selection.toString().trim().slice(0, selectionLimit);
  });
  // A passage marked for a moment with the CSS highlight API (no DOM changes).
  let clearMark = 0;
  function mark(range) {
    if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
    CSS.highlights.set('study-source', new Highlight(range));
    clearTimeout(clearMark);
    clearMark = setTimeout(() => CSS.highlights.delete('study-source'), 2600);
  }
  return {
    get count() { return sections().length; },
    // What the AI reads of a section, in the shape Find gives for note pages.
    sectionText: i => ({ document: chunk(i) }),
    // The section at the reading point (a third down the view).
    current() {
      const list = sections(), total = cache.text.length || 1, nodes = textNodes();
      let fraction = (body.scrollTop + body.clientHeight / 3) / Math.max(1, body.scrollHeight);
      const r = body.getBoundingClientRect(), point = body.ownerDocument.caretRangeFromPoint?.(r.left + Math.min(r.width / 2, 120), r.top + r.height / 3);
      if (point && nodes.includes(point.startContainer)) {
        const before = nodes.slice(0, nodes.indexOf(point.startContainer)).reduce((n, node) => n + node.data.length, 0);
        fraction = (before + point.startOffset) / Math.max(1, nodes.reduce((n, node) => n + node.data.length, 0));
      }
      const at = Math.min(total - 1, Math.max(0, fraction * total)), index = list.findIndex(s => at < s.end);
      return index >= 0 ? index : list.length - 1;
    },
    // Scroll to a section, or to a quote inside it and mark it.
    jump(i, quote = '') {
      if (body.hidden) return false;
      const nodes = textNodes(), chunks = nodes.map(n => n.data);
      const hit = (quote && findPassage(chunks, quote)) || findPassage(chunks, chunk(i).slice(0, 160));
      if (hit) {
        const range = rangeOf(nodes, hit);
        scrollToRange(range);
        if (quote) mark(range);
        return true;
      }
      const s = sections()[i];
      if (s) scrollToFraction(s.start / Math.max(1, cache.text.length));
      return Boolean(s);
    },
    // Text selected in the document, for Ask AI (kept while the question is typed).
    selected: () => picked,
    forget() { picked = ''; },
  };
}
