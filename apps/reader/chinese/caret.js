// Where the caret is, in viewport pixels, and where the candidate menu goes (docs/CHINESE-INPUT.md §5.3).
// placeMenu and dockOffset are pure (tested in Node); the rest measure the DOM.

const GAP = 4, EDGE = 8;

// caret: {left, top, bottom}; size: {width, height}; viewport: {width, height, top = 0, left = 0}
// (the visual viewport: what the on-screen keyboard leaves); keypadTop: the math keypad's top, or null.
// Below the caret line; above when it would cross the bottom (or the keypad); kept inside the sides.
export function placeMenu(caret, size, viewport, keypadTop = null) {
  const vTop = viewport.top || 0, vLeft = viewport.left || 0;
  const floor = Math.min(vTop + viewport.height, keypadTop ?? Infinity) - EDGE;
  const ceiling = vTop + EDGE;
  let top = caret.bottom + GAP, above = false;
  if (top + size.height > floor) {
    const up = caret.top - GAP - size.height;
    // Above if it fits there, else whichever side has more room.
    if (up >= ceiling || caret.top - ceiling > floor - caret.bottom) { top = Math.max(ceiling, up); above = true; }
    else top = Math.max(ceiling, floor - size.height);
  }
  const maxLeft = vLeft + viewport.width - EDGE - size.width;
  const left = Math.max(vLeft + EDGE, Math.min(caret.left, maxLeft));
  return { left: Math.round(left), top: Math.round(top), above };
}

// The docked strip (phones): how far above the layout viewport's bottom the keyboard starts.
export function dockOffset(innerHeight, viewport) {
  return Math.max(0, Math.round(innerHeight - ((viewport.top || 0) + viewport.height)));
}

export function viewportBox(win = globalThis) {
  const v = win.visualViewport;
  return v ? { width: v.width, height: v.height, top: v.offsetTop, left: v.offsetLeft } : { width: win.innerWidth, height: win.innerHeight, top: 0, left: 0 };
}

// The properties a mirror copies so its text wraps and measures like the field's.
const COPY = ['direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordBreak', 'overflowWrap'];
let mirror = null;

// The rectangle of the caret (selectionEnd) in a textarea or input, through a hidden copy of it.
// getBoundingClientRect of the field is after CSS transforms (pinch zoom): the copy's offsets are
// scaled by the ratio of the field's drawn width to its layout width.
export function fieldCaretRect(el, index = el.selectionEnd ?? el.value.length) {
  const doc = el.ownerDocument, cs = doc.defaultView.getComputedStyle(el);
  if (!mirror || mirror.ownerDocument !== doc) {
    mirror = doc.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.className = 'zh-caret-mirror';
  }
  if (!mirror.isConnected) doc.body.append(mirror);
  const s = mirror.style;
  for (const p of COPY) s[p] = cs[p];
  const isInput = el.nodeName === 'INPUT';
  Object.assign(s, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', overflow: 'hidden' });
  // A textarea with wrap="off" does not wrap; an input never does.
  if (isInput || el.getAttribute('wrap') === 'off') s.whiteSpace = 'pre';
  else if (cs.whiteSpace === 'normal' || !cs.whiteSpace) s.whiteSpace = 'pre-wrap';
  if (isInput) s.height = cs.height;
  mirror.textContent = el.value.slice(0, index);
  const mark = doc.createElement('span');
  mark.textContent = el.value.slice(index) || '.';
  mirror.append(mark);
  const box = el.getBoundingClientRect();
  const scale = el.offsetWidth ? box.width / el.offsetWidth : 1;
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25 || 16;
  const x = (mark.offsetLeft - el.scrollLeft) * scale, y = (mark.offsetTop - el.scrollTop) * scale;
  let top = box.top + y;
  if (isInput) top = box.top + (box.height - lineHeight * scale) / 2;
  const left = Math.min(box.right, Math.max(box.left, box.left + x));
  return { left, top, bottom: top + lineHeight * scale, height: lineHeight * scale };
}

// A contenteditable (TinyMDE): the selection's own rectangle, else its line's start.
export function editableCaretRect(root) {
  const doc = root.ownerDocument, sel = doc.getSelection();
  if (!sel?.rangeCount || !root.contains(sel.focusNode)) { const r = root.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.top + 18, height: 18 }; }
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);
  let r = range.getClientRects()[0];
  if (!r || (!r.width && !r.height && !r.left)) {
    // Collapsed at a line's start (or in an empty line): the line's own box.
    const node = range.startContainer.nodeType === 1 ? range.startContainer.childNodes[range.startOffset] || range.startContainer : range.startContainer.parentElement;
    r = (node.nodeType === 1 ? node : node.parentElement).getBoundingClientRect();
    const lh = parseFloat(doc.defaultView.getComputedStyle(node.nodeType === 1 ? node : node.parentElement).lineHeight) || r.height || 18;
    return { left: r.left, top: r.top, bottom: r.top + Math.min(r.height || lh, lh), height: lh };
  }
  return { left: r.left, top: r.top, bottom: r.bottom, height: r.height };
}

export function caretRect(el) {
  return el.isContentEditable ? editableCaretRect(el) : fieldCaretRect(el);
}

// The text before the caret on its line (for Enter = "Auto").
export function lineBefore(el) {
  if (!el.isContentEditable) { const v = el.value.slice(0, el.selectionStart ?? el.value.length); return v.slice(v.lastIndexOf('\n') + 1); }
  const sel = el.ownerDocument.getSelection();
  if (!sel?.rangeCount) return '';
  const r = sel.getRangeAt(0);
  const text = r.startContainer.nodeType === 3 ? r.startContainer.data.slice(0, r.startOffset) : '';
  let line = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  while (line && line.parentElement !== el) line = line.parentElement;
  if (!line) return text;
  const pre = el.ownerDocument.createRange();
  pre.setStart(line, 0);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString();
}
