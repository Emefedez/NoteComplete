// Highlights and coloured text in Markdown, kept in the Markdown text itself:
//   ==text==            the usual yellow highlighter
//   =={pink}text==      a colour: yellow, pink, mint, lavender, peach, blue, red (and their
//                       other names: green, teal, purple, orange, sky, amber, coral) or #rrggbb
//   =={_blue}text==     an underline in that colour instead of a fill ("_" = underline)
//   =={.red}text==      the text itself in that colour, no fill ("." = text colour): remarks
// The colour form is the one the handwriting pages already read (core ink/compose.rs:
// `=={pink}phrase==`), so a note's Markdown and its ink pages speak one dialect. Anywhere
// that does not know it, the text stays readable: the words with "==" around them.
//
// Rules (as Obsidian and Pandoc's ==mark==): the opening "==" is followed by a character that
// is not a space, the closing one follows one that is not a space, "===" is never a
// delimiter, and a highlight does not cross a blank line or code. Pure functions first (for
// Node and the prefab renderers), then the DOM pass for rendered Markdown and the TinyMDE
// pieces (editor grammar, colours in the editor, the format bar's highlight button).

// Fills (pastel, as the highlighter pen) and the stronger shade an underline or text uses.
export const HIGHLIGHT_COLOURS = {
  yellow: { label: 'Yellow', fill: '#fff169', strong: '#c99700' },
  pink: { label: 'Pink', fill: '#fab0c8', strong: '#e0407a' },
  mint: { label: 'Mint', fill: '#99edc7', strong: '#1e9a66' },
  lavender: { label: 'Lavender', fill: '#cdb8fb', strong: '#7a55e0' },
  peach: { label: 'Peach', fill: '#ffc799', strong: '#e07418' },
  blue: { label: 'Blue', fill: '#9ed6ff', strong: '#2c7fd6' },
  red: { label: 'Red', fill: '#ffb0a8', strong: '#d92d20' },
};
// Other names for the same colours (those core ink/hand.rs highlight_color reads).
const ALIASES = { amber: 'yellow', coral: 'pink', green: 'mint', teal: 'mint', purple: 'lavender', orange: 'peach', sky: 'blue' };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// A tag: an optional "_" (underline) or "." (text colour), then a colour name or #hex.
export const TAG = /^[._]?[A-Za-z0-9#-]{0,24}$/;
const TAG_OPEN = /^\{([._]?[A-Za-z0-9#-]{0,24})\}/;
const fullHex = (h) => (h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h).toLowerCase();

// What a tag means: { colour (the fill), strong (an underline's or text's colour), underline,
// text (coloured text, no fill), known (a colour or a hex; else the default yellow) }.
export function highlightStyle(tag = '') {
  let t = String(tag ?? '').trim();
  const underline = t.startsWith('_'), text = t.startsWith('.');
  if (underline || text) t = t.slice(1);
  const key = t.toLowerCase();
  if (HEX.test(t)) return { colour: fullHex(t), strong: fullHex(t), underline, text, known: true };
  const named = HIGHLIGHT_COLOURS[ALIASES[key] || key];
  if (named) return { colour: named.fill, strong: named.strong, underline, text, known: true };
  const fallback = text ? HIGHLIGHT_COLOURS.red : HIGHLIGHT_COLOURS.yellow;
  return { colour: fallback.fill, strong: fallback.strong, underline, text, known: !t };
}

// The highlights in a line or paragraph of text (no Markdown is read but the delimiters):
// [{ start, end, from, to, tag, text }], `start`/`end` around the delimiters, `from`/`to`
// around the highlighted text.
export function findHighlights(s) {
  s = String(s ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const o = s.indexOf('==', i);
    if (o < 0) break;
    // "===" or more, or an escaped "\==": not a delimiter.
    if (s[o - 1] === '=' || s[o - 1] === '\\' || s[o + 2] === '=') {
      i = o + 2;
      while (s[i] === '=') i++;
      continue;
    }
    let j = o + 2, tag = '';
    const m = TAG_OPEN.exec(s.slice(j, j + 28));
    if (m) { tag = m[1]; j += m[0].length; }
    if (j >= s.length || /\s/.test(s[j]) || s[j] === '=') { i = o + 2; continue; }
    let close = -1;
    for (let k = j + 1; k < s.length;) {
      const c = s.indexOf('==', k);
      if (c < 0) break;
      if (!/\s/.test(s[c - 1]) && s[c - 1] !== '=' && s[c + 2] !== '=') { close = c; break; }
      k = c + 1;
      while (s[k] === '=') k++;
    }
    if (close < 0 || /\n[ \t]*\n/.test(s.slice(j, close))) { i = o + 2; continue; }
    out.push({ start: o, end: close + 2, from: j, to: close, tag, text: s.slice(j, close) });
    i = close + 2;
  }
  return out;
}

// The same in a whole Markdown text: code (fenced, indented by a fence, inline) is left out,
// and the positions are the text's own.
export function findMarkdownHighlights(markdown) {
  const text = String(markdown ?? '');
  // Code keeps its length (so positions stay) but cannot hold a delimiter.
  const masked = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`/g, (code) => code.replace(/[^\n]/g, '\u0001'));
  return findHighlights(masked).map((h) => ({ ...h, text: text.slice(h.from, h.to) }));
}

// The text wrapped in a highlight: ==text== for the plain yellow, else =={tag}text==.
// Spaces at the ends stay outside (a highlight cannot start or end with one).
export function wrapHighlight(text, tag = '') {
  const s = String(text ?? '');
  const lead = s.match(/^\s*/)[0], trail = s.slice(lead.length).match(/\s*$/)[0];
  const body = s.slice(lead.length, s.length - trail.length);
  if (!body) return s;
  return `${lead}==${tag && TAG.test(tag) ? `{${tag}}` : ''}${body}==${trail}`;
}

// Markdown with its highlights taken off (the text inside kept), as plain readers show it.
export function stripHighlights(markdown) {
  const text = String(markdown ?? '');
  let out = '', at = 0;
  for (const h of findMarkdownHighlights(text)) { out += text.slice(at, h.start) + h.text; at = h.end; }
  return out + text.slice(at);
}

// ---------------------------------------------------------------------------------------
// Rendered Markdown (rich-text.js renderMarkdown): the delimiters left in the HTML's text
// become <mark class="md-hl"> elements. A highlight may hold other inline elements
// (==a **bold** word==) as long as both delimiters are in the same element.

// Elements whose text is not prose: code, maths, pictures. (Plain DOM calls only, so the same
// pass runs on a parsed document in Node, as the tests do.)
const SKIP_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'textarea', 'svg', 'math']);
const SKIP_CLASSES = ['math', 'katex'];
const OBJECT = '\uFFFC';
const skipped = (el) => SKIP_TAGS.has(String(el.localName || el.tagName || '').toLowerCase())
  || String(el.getAttribute?.('class') || '').split(/\s+/).some((c) => SKIP_CLASSES.includes(c));

function markFor(doc, tag) {
  const look = highlightStyle(tag);
  const mark = doc.createElement('mark');
  mark.setAttribute('class', look.text ? 'md-hl md-tc' : look.underline ? 'md-hl md-ul' : 'md-hl');
  if (tag) mark.setAttribute('data-hl', tag);
  // Colours are checked hex values (highlightStyle), never the tag as written.
  mark.setAttribute('style', `--hl: ${look.colour}; --hl-strong: ${look.strong}`);
  return mark;
}

function wrapLevel(el) {
  const segments = [];
  let flat = '';
  for (let node = el.firstChild; node; node = node.nextSibling) {
    const text = node.nodeType === 3 ? node.data : OBJECT;
    segments.push({ node, start: flat.length, end: flat.length + text.length });
    flat += text;
  }
  if (!flat.includes('==')) return;
  const found = findHighlights(flat);
  // Nodes keep their beginning when split, so the later highlights go first.
  const locate = (pos) => {
    const seg = segments.find((s) => s.node.nodeType === 3 && pos >= s.start && pos < s.end);
    return seg && { node: seg.node, offset: pos - seg.start };
  };
  for (const h of found.reverse()) {
    const c = locate(h.to), o = locate(h.start);
    if (!c || !o) continue;
    const tail = c.node.splitText(c.offset);
    tail.data = tail.data.slice(2);
    const head = o.node.splitText(o.offset);
    head.data = head.data.slice(h.from - h.start);
    const mark = markFor(el.ownerDocument, h.tag);
    el.insertBefore(mark, head);
    for (let n = head; n && n !== tail;) { const next = n.nextSibling; mark.appendChild(n); n = next; }
    for (const n of [head, tail]) if (!n.data && n.parentNode) n.parentNode.removeChild(n);
  }
}

// Every highlight in a rendered element (deepest first, so a highlight inside **bold** is
// found inside it).
export function highlightElement(root) {
  if (!root || !root.ownerDocument) return root;
  const visit = (el) => {
    if (skipped(el)) return;
    const children = [];
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) children.push(n);
    children.forEach(visit);
    wrapLevel(el);
  };
  visit(root);
  return root;
}

// ---------------------------------------------------------------------------------------
// The Markdown editor (TinyMDE): highlights shown as they are typed.

// TinyMDE's customInlineGrammar (tried at every character, before links and emphasis).
export function tinyMdeHighlightGrammar() {
  const mark = (n) => `<span class="TMMark TMMark_TMHighlight">${n}</span>`;
  return {
    highlightTagged: {
      regexp: /^(==\{)([._]?[A-Za-z0-9#-]{0,24})(\})(?=[^\s=])(.*?[^\s=])(==)(?!=)/,
      replacement: `${mark('$1$2$3')}<span class="TMHighlight" data-hl="$2">$4</span>${mark('$5')}`,
    },
    highlightPlain: {
      regexp: /^(==)(?=[^\s=])(.*?[^\s=])(==)(?!=)/,
      replacement: `${mark('$1')}<span class="TMHighlight">$2</span>${mark('$3')}`,
    },
  };
}

// The editor's highlights in their colours (a tag is a name or a hex: set here, not in CSS).
// Call after the editor redraws (it redraws only the lines that changed).
export function paintEditorHighlights(root) {
  if (typeof root?.querySelectorAll !== 'function') return;
  for (const span of root.querySelectorAll('.TMHighlight')) {
    const tag = span.dataset.hl || '';
    if (span.dataset.painted === tag) continue;
    const look = highlightStyle(tag);
    span.style.setProperty('--hl', look.colour);
    span.style.setProperty('--hl-strong', look.strong);
    span.classList.toggle('TMUnderline', look.underline);
    span.classList.toggle('TMTextColour', look.text);
    span.dataset.painted = tag;
  }
}

// The highlight around a column of a line (the caret's), or null.
export function highlightAt(line, col) {
  return findHighlights(line).find((h) => col >= h.start && col <= h.end) || null;
}

// Takes the highlight off around the caret (or the selection's start) in a TinyMDE editor.
export function removeHighlight(editor) {
  const at = editor.getSelection?.(false), anchor = editor.getSelection?.(true);
  if (!at || !Array.isArray(editor.lines)) return false;
  const row = at.row, col = anchor && anchor.row === row ? Math.min(at.col, anchor.col) : at.col;
  const line = editor.lines[row] ?? '';
  const h = highlightAt(line, col);
  if (!h) return false;
  if (!editor.isRestoringHistory) editor.pushHistory?.();
  editor.lines[row] = line.slice(0, h.start) + h.text + line.slice(h.end);
  editor.lineDirty[row] = true;
  editor.updateFormatting();
  editor.setSelection({ row, col: h.start + h.text.length }, { row, col: h.start });
  editor.fireChange();
  return true;
}

// Highlights the selection (one line) with a tag ('' = yellow), or replaces the tag of the
// highlight the selection is in.
export function applyHighlight(editor, tag = '') {
  const at = editor.getSelection?.(false), anchor = editor.getSelection?.(true);
  if (!at) return false;
  const line = editor.lines?.[at.row] ?? '';
  const inside = anchor && anchor.row === at.row ? highlightAt(line, Math.min(at.col, anchor.col)) : null;
  if (inside && (!anchor || Math.max(at.col, anchor.col) <= inside.end)) {
    if (!editor.isRestoringHistory) editor.pushHistory?.();
    editor.lines[at.row] = line.slice(0, inside.start) + wrapHighlight(inside.text, tag) + line.slice(inside.end);
    editor.lineDirty[at.row] = true;
    editor.updateFormatting();
    editor.fireChange();
    return true;
  }
  if (!anchor || anchor.row !== at.row || anchor.col === at.col) return false;
  const [a, b] = at.col < anchor.col ? [at.col, anchor.col] : [anchor.col, at.col];
  const picked = line.slice(a, b), lead = picked.match(/^\s*/)[0].length, trail = picked.match(/\s*$/)[0].length;
  if (lead === picked.length) return false;
  editor.wrapSelection(`==${tag ? `{${tag}}` : ''}`, '==', { row: at.row, col: b - trail }, { row: at.row, col: a + lead });
  return true;
}

// The format bar's highlight button (TinyMDE CommandBar entry): a menu of colours, underlines
// and "Remove highlight", at the button.
let pointer = null;
function trackPointer() {
  if (pointer || typeof document === 'undefined') return;
  pointer = { x: 0, y: 0 };
  document.addEventListener('pointerdown', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.target = e.target; }, true);
}
export function highlightCommand(svgPath = 'm9 4 8 8-5 5-8-8 5-5ZM5 10l-3 6 6-2M2 22h20') {
  trackPointer();
  return {
    name: 'highlight',
    title: 'Highlight: ==text==, =={pink}text==, =={_blue}underline==, =={.red}coloured text==',
    innerHTML: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${svgPath}" style="fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round"/></svg>`,
    action: async (editor) => {
      const button = pointer?.target?.closest?.('.TMCommandButton');
      const box = button?.getBoundingClientRect?.();
      const x = box ? box.left : pointer?.x || 80, y = box ? box.bottom + 4 : pointer?.y || 80;
      // The selection is lost when the menu takes the focus: kept, and given back.
      const focus = editor.getSelection(false), anchor = editor.getSelection(true);
      const run = (fn) => () => { if (focus) editor.setSelection(focus, anchor); fn(); };
      // prefix '' (fill), '_' (underline) or '.' (text colour).
      const colours = (prefix) => Object.entries(HIGHLIGHT_COLOURS).filter(([name]) => !(prefix === '.' && name === 'yellow')).map(([name, c]) => ({
        label: c.label,
        swatch: prefix ? c.strong : c.fill,
        run: run(() => applyHighlight(editor, prefix ? `${prefix}${name}` : name === 'yellow' ? '' : name)),
      }));
      const { openContextMenu } = await import('./context-menu.js');
      openContextMenu(x, y, [
        ...colours(''),
        '-',
        { label: 'Underline', icon: 'minus', submenu: colours('_') },
        { label: 'Text colour', icon: 'text', submenu: colours('.') },
        { label: 'Remove highlight', icon: 'erase', run: run(() => removeHighlight(editor)) },
      ], { title: 'Highlight' });
    },
  };
}
