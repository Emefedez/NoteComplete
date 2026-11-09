// Math text boxes (docs/SHAPES-TABLES-MATH.md, M1): a typed text box flagged `math` holds
// LaTeX, typeset here by KaTeX (loaded only when a page has math). The core draws the box's
// source as plain text inside a group marked with the text's own size (data-box); the
// formula is laid over it in a foreignObject in that same group, so moving, scaling and
// turning the box carry it, and the plain text is hidden.
import { loadKatex } from './rich-text.js';

const XHTML = 'http://www.w3.org/1999/xhtml', SVG = 'http://www.w3.org/2000/svg';

// The text's parts: plain words and formulas. `$$…$$` is display math, `$…$` inline; text
// with no `$` at all is one formula. `\$` is a dollar sign.
export function mathSegments(text) {
  const source = String(text ?? '');
  if (!/(^|[^\\])\$/.test(source)) return source.trim() ? [{ tex: source.trim(), display: true }] : [];
  const parts = [], pattern = /\$\$([\s\S]+?)\$\$|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;
  let at = 0;
  for (const m of source.matchAll(pattern)) {
    if (m.index > at) parts.push({ text: source.slice(at, m.index).replaceAll('\\$', '$') });
    parts.push(m[1] != null ? { tex: m[1].trim(), display: true } : { tex: m[2].trim(), display: false });
    at = m.index + m[0].length;
  }
  if (at < source.length) parts.push({ text: source.slice(at).replaceAll('\\$', '$') });
  return parts.filter((p) => p.tex || p.text);
}

// The parts as HTML: formulas from KaTeX (errors shown in red, not thrown), words as text.
export function mathHtml(katex, text) {
  const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return mathSegments(text).map((p) => p.tex != null
    ? katex.renderToString(p.tex, { displayMode: p.display, throwOnError: false, output: 'html' })
    : escape(p.text)).join('');
}

// CSS for the box's style (a typed text box's first run, or the editor's style).
function boxStyle(el, { size = 16, rgba = [0, 0, 0, 1], align = 0 } = {}) {
  Object.assign(el.style, {
    fontSize: `${size}px`,
    color: `rgba(${rgba.slice(0, 3).map((c) => Math.round(c * 255)).join(',')},${rgba[3] ?? 1})`,
    textAlign: ['left', 'center', 'right'][align] || 'left',
  });
}

// The size a box needs for this math at this style, in page units: measured off screen.
export async function mathSize(text, style) {
  const katex = await loadKatex();
  const probe = document.createElement('div');
  probe.className = 'math-box math-probe';
  boxStyle(probe, style);
  probe.innerHTML = mathHtml(katex, text);
  document.body.append(probe);
  const size = [Math.ceil(probe.scrollWidth + 12), Math.ceil(probe.scrollHeight + 10)];
  probe.remove();
  return size;
}

// Typesets every math box of a page's render (`texts`: the view's typed text boxes).
// Does nothing for pages without math; safe to call again after an item is redrawn.
export async function typesetMath(render, texts) {
  const boxes = (texts || []).filter((t) => t.math && t.id != null);
  if (!boxes.length || !render) return;
  let katex;
  try { katex = await loadKatex(); } catch { return; } // Offline without KaTeX: the source shows.
  for (const t of boxes) {
    const item = render.querySelector(`[data-item="${CSS.escape(t.id)}"]`), group = item?.querySelector('g[data-box]');
    if (!group || group.querySelector(':scope > foreignObject')) continue;
    const [w, h] = group.dataset.box.split(' ').map(Number), run = t.runs?.[0];
    const fo = document.createElementNS(SVG, 'foreignObject');
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h })) fo.setAttribute(k, v);
    const box = document.createElementNS(XHTML, 'div');
    box.className = 'math-box';
    boxStyle(box, { size: run?.font_size, rgba: run?.rgba, align: run?.alignment });
    box.innerHTML = mathHtml(katex, (t.runs || []).map((r) => r.text).join('').replaceAll('​', ''));
    fo.append(box);
    group.append(fo);
    for (const el of group.querySelectorAll(':scope > text')) el.setAttribute('visibility', 'hidden');
    // A box smaller than its formula (sized by an estimate, or resized) shrinks the formula
    // to fit rather than letting it spill over the page.
    const fit = Math.min(1, (w - 4) / Math.max(1, box.scrollWidth), (h - 2) / Math.max(1, box.scrollHeight));
    if (fit < 0.999) box.style.transform = `scale(${fit})`;
  }
}

// The live preview under a math box being typed.
export async function previewMath(el, text, style) {
  const katex = await loadKatex();
  boxStyle(el, style);
  el.innerHTML = text.trim() ? mathHtml(katex, text) : '';
}
