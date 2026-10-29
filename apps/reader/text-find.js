// Find in a text document (Ctrl F): every match in the rendered text (or the
// Markdown editor) marked with the CSS highlight API, the current one stronger;
// Enter / Shift Enter move between them. Case and accents are ignored, as in
// the notes' Find. The plain-text editor (a textarea) selects the match instead.

// One character folded for matching; always one character, so offsets map back.
const fold = (ch) => {
  const f = ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  return f.length === 1 ? f : ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
};
const folded = (text) => [...String(text)].map(fold).join('');

// Matches of `query` in a list of text chunks (text nodes): [{ from: [chunk, offset], to: [chunk, offset] }].
export function findAll(chunks, query) {
  const needle = folded(String(query || '').trim());
  if (!needle) return [];
  const map = [];
  let hay = '';
  chunks.forEach((chunk, c) => {
    // UTF-16 offsets, as Range wants them.
    for (let i = 0; i < chunk.length; i++) { hay += fold(chunk[i]); map.push([c, i]); }
  });
  const out = [];
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
    const last = map[at + needle.length - 1];
    out.push({ from: map[at], to: [last[0], last[1] + 1] });
  }
  return out;
}

export function textFind({ bar, input, count, prev, next, close: closeButton, root, plainEditor }) {
  let hits = [], current = 0, debounce = 0, watching = null;
  const highlights = typeof Highlight !== 'undefined' && globalThis.CSS?.highlights;
  function textNodes(host) {
    const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  function clearMarks() { if (highlights) { CSS.highlights.delete('text-find'); CSS.highlights.delete('text-find-current'); } }
  function show() {
    count.textContent = !input.value.trim() ? '' : hits.length ? `${current + 1} of ${hits.length}` : 'No matches';
    prev.disabled = next.disabled = !hits.length;
  }
  // Search again (typing, or the text changed); `keep` stays near the current match.
  function run(keep = false) {
    const area = plainEditor();
    clearMarks();
    if (area) {
      const text = area.value, needle = folded(input.value.trim());
      hits = [];
      if (needle) for (let at = folded(text).indexOf(needle); at >= 0; at = folded(text).indexOf(needle, at + needle.length)) hits.push({ start: at, end: at + needle.length });
    } else {
      const host = root(), nodes = host ? textNodes(host) : [];
      hits = findAll(nodes.map((n) => n.data), input.value).map((hit) => {
        const range = host.ownerDocument.createRange();
        range.setStart(nodes[hit.from[0]], hit.from[1]);
        range.setEnd(nodes[hit.to[0]], hit.to[1]);
        return range;
      });
      if (highlights && hits.length) CSS.highlights.set('text-find', new Highlight(...hits));
    }
    current = keep ? Math.min(current, Math.max(0, hits.length - 1)) : 0;
    show();
    if (hits.length) mark(!keep);
  }
  // The current match: stronger mark, scrolled into view.
  function mark(scroll = true) {
    const hit = hits[current], area = plainEditor();
    if (!hit) return;
    if (area && hit.start !== undefined) {
      // Selecting moves the caret: only when going to a match, never while typing in the text.
      if (scroll) {
        area.setSelectionRange(hit.start, hit.end);
        const line = area.value.slice(0, hit.start).split('\n').length - 1, lines = area.value.split('\n').length;
        area.scrollTop = Math.max(0, (line / Math.max(1, lines)) * area.scrollHeight - area.clientHeight / 3);
      }
    } else if (hit.getBoundingClientRect) {
      if (highlights) CSS.highlights.set('text-find-current', new Highlight(hit));
      if (scroll) {
        const scroller = hit.startContainer.parentElement?.closest('.text-doc, .notes-editor, .doc-editor') || root();
        const top = hit.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        if (top < 0 || top > scroller.clientHeight - 40) scroller.scrollTop += top - scroller.clientHeight / 3;
      }
    }
    show();
  }
  function go(i) {
    if (!hits.length) return;
    current = (i + hits.length) % hits.length;
    mark();
  }
  // Re-search when the document re-renders or is edited while the bar is open.
  function watch(on) {
    watching?.disconnect(); watching = null;
    const host = on && root();
    if (!host) return;
    watching = new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(() => run(true), 200); });
    watching.observe(host, { childList: true, subtree: true, characterData: true });
  }
  function open() {
    bar.hidden = false;
    input.focus(); input.select();
    run();
    watch(true);
  }
  function close() {
    bar.hidden = true;
    clearTimeout(debounce);
    watch(false);
    clearMarks();
    hits = [];
  }
  input.oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => run(), 120); };
  input.onkeydown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); go(current + (event.shiftKey ? -1 : 1)); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  };
  next.onclick = () => go(current + 1);
  prev.onclick = () => go(current - 1);
  closeButton.onclick = close;
  return {
    open, close,
    toggle: () => (bar.hidden ? open() : close()),
    // The view switched (Edit, MD): search what is shown now.
    refresh() { if (bar.hidden) return; clearTimeout(debounce); debounce = setTimeout(() => { watch(true); run(true); }, 200); },
    get visible() { return !bar.hidden; },
  };
}
