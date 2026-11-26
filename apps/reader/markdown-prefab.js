// Markdown lines the editors show as chips: `<!-- page N -->` markers and prefab pictures
// (![alt](data:image/svg+xml…)), with the prefab's menu (Edit…, Copy Markdown, Delete) in the
// editor and the preview. Shared by the Notes panel (notes.js, loaded on first use) and the
// document view's Markdown editor (text-view.js), so neither pulls in the other. Any prefab
// (UML, charts, algorithms, stroke order…) goes in from the editor's toolbar (prefabCommand) or
// its right-click menu, and markdownForOffice turns them into PNG pictures for Euro-Office.
import { paintEditorHighlights } from './md-highlight.js';

export const MARKER = /^\s*<!--\s*page\s+(\d+)\s*-->\s*$/;
// A prefab picture on a line of its own: ![alt](data:image/svg+xml…). The URI runs to the line's
// last ")" (older notes have unescaped parentheses inside it), and the alt may hold "]" (older
// glosses such as "[Taiwan pr.]").
const PREFAB_ALT = '((?:[^\\]]|\\](?!\\(data:))*)';
export const PREFAB_LINE = new RegExp(`^\\s*!\\[${PREFAB_ALT}\\]\\((data:image\\/svg\\+xml\\S*)\\)\\s*$`);
// The same pictures anywhere in a text: the URI ends at a ")" followed by a space or the end.
const prefabPattern = () => new RegExp(`!\\[${PREFAB_ALT}\\]\\((data:image\\/svg\\+xml\\S*?)\\)(?=\\s|$)`, 'g');

// A TinyMDE toolbar button with a 24×24 icon path, running `run(editor)`.
export const toolbarCommand = (name, title, path, run) => ({
  name,
  title,
  innerHTML: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" style="fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round"/></svg>`,
  action: (editor) => { Promise.resolve(run(editor)).catch((e) => console.warn(`${name}:`, e)); },
});
// "Insert prefab" in the Markdown toolbar: `insert(editor)` opens the picker and pastes.
export const prefabCommand = (insert) => toolbarCommand('prefab', 'Insert prefab: UML diagram, chart, algorithm, stroke order… (also on right-click)', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7', insert);

// A Markdown table to start from (the picker's Table card: Markdown has its own tables).
export const MARKDOWN_TABLE = '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |';

// The Markdown for what the picker chose ({ spec } or { kind: "table" }, figures.js
// chooseFigureSpec): a block on lines of its own, or '' when nothing could be drawn.
export async function prefabMarkdown(chosen) {
  if (!chosen) return '';
  if (chosen.kind === 'table') return `\n\n${MARKDOWN_TABLE}\n`;
  if (!chosen.spec) return '';
  const { markdownPrefabBlockForSpec } = await import('./chinese/zh-menu.js');
  const line = await markdownPrefabBlockForSpec(chosen.spec);
  return line ? `\n\n${line}\n` : '';
}

// Picks a prefab (`choose`, figures.js chooseFigureSpec) and pastes it into a TinyMDE `editor`
// where its caret was (the picker takes the focus). Resolves true when one went in.
// `place`: { row, col } to paste at instead (a right-click's place).
export async function insertPrefabInto(editor, choose, after = () => {}, place = null) {
  if (!editor || !choose) return false;
  const at = place || editor.getSelection(false), anchor = place || editor.getSelection(true) || at;
  let block = await prefabMarkdown(await choose());
  if (!block) return false;
  // After the line the caret (or the end of the selection) is on: a paragraph is not split.
  const end = at && anchor && (anchor.row > at.row || (anchor.row === at.row && anchor.col > at.col)) ? anchor : at;
  if (!end) { editor.paste(block); after(); return true; }
  const lines = String(editor.getContent?.() ?? '').split('\n'), line = lines[end.row] ?? '';
  // On an empty line: a blank line before it only when the line above has text.
  if (!line.trim()) block = block.replace(/^\n+/, end.row > 0 && lines[end.row - 1].trim() ? '\n' : '');
  // A blank line already follows: no second one.
  if (end.row + 1 < lines.length && !lines[end.row + 1].trim()) block = block.replace(/\n+$/, '');
  const spot = { row: end.row, col: line.length };
  editor.paste(block, spot, spot);
  after();
  return true;
}

// Markdown for Euro-Office: each prefab picture (an SVG data URI, which its converter does not
// draw) becomes a PNG data URI of the same figure, so the converted document shows it (as a
// picture: it is edited again in NoteComplete). `rasterize(svgDataUri)` resolves to a PNG data
// URI or null (that picture then stays as it was). The same figure is drawn once.
export async function markdownForOffice(md, rasterize) {
  const text = String(md || '');
  const found = [...text.matchAll(prefabPattern())];
  if (!found.length) return text;
  const pngs = new Map();
  for (const m of found) if (!pngs.has(m[2])) pngs.set(m[2], await rasterize(m[2]).catch(() => null));
  let out = '', last = 0;
  for (const m of found) {
    const png = pngs.get(m[2]);
    if (!png) continue;
    out += `${text.slice(last, m.index)}![${m[1]}](${png})`;
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

// The size an SVG data URI says it is (width/height, else its viewBox), or null.
export function svgUriSize(uri) {
  const raw = String(uri || ''), comma = raw.indexOf(',');
  let svg = raw.slice(comma + 1);
  try { svg = /;base64/i.test(raw.slice(0, comma)) ? atob(svg) : decodeURIComponent(svg); } catch { /* As written. */ }
  const head = svg.match(/<svg\b[^>]*>/)?.[0] || '';
  const num = (name) => Number(head.match(new RegExp(`\\s${name}="([\\d.]+)(?:px)?"`))?.[1]) || 0;
  const [w, h] = [num('width'), num('height')];
  if (w && h) return [w, h];
  const box = head.match(/viewBox="[\d.\s-]*?([\d.]+)[\s,]+([\d.]+)"/);
  return box ? [Number(box[1]), Number(box[2])] : null;
}

// An SVG data URI drawn as a PNG data URI, `scale` times its size (sharp when printed), white
// behind it (Word documents are white; a transparent figure would vanish in a dark theme).
export async function svgUriToPng(uri, { scale = 2, maxSide = 4096 } = {}) {
  const { imageReady } = await import('./image-ready.js');
  const img = new Image();
  await imageReady(img, uri);
  let { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) [w, h] = svgUriSize(uri) || [400, 300];
  const k = Math.min(scale, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function decorateTinyMdeLines(root) {
  if (!root) return;
  // ==highlights== in their colours (md-highlight.js).
  paintEditorHighlights(root);
  for (const line of root.children || []) {
    const raw = line.textContent || '';
    const page = raw.match(MARKER)?.[1];
    if (page) line.dataset.page = page;
    else delete line.dataset.page;
    const prefab = raw.match(PREFAB_LINE);
    if (prefab) {
      line.dataset.prefab = (prefab[1] || 'Prefab').trim() || 'Prefab';
    } else {
      delete line.dataset.prefab;
    }
  }
}

export function attachMarkdownPrefabContextMenu({
  editorContainer,
  previewContainer,
  getText,
  setText,
  editPrefab = null,
  // The TinyMDE editor while it is open, and the picker (figures.js chooseFigureSpec): with
  // both, a right-click in the text offers Insert prefab… there.
  getEditor = null,
  choosePrefab = null,
  afterInsert = () => {},
  extraEntries = () => [],
}) {
  const findPrefabMatches = (md) => {
    const out = [];
    const re = prefabPattern();
    let m;
    while ((m = re.exec(md))) {
      out.push({ full: m[0], alt: m[1], uri: m[2], index: m.index });
    }
    return out;
  };
  const openEditorFor = async ({ alt, uri, replaceLine }) => {
    if (!editPrefab) return false;
    const { extractPrefabSpecFromDataUri, markdownPrefabBlockForSpec } = await import('./chinese/zh-menu.js');
    const spec = extractPrefabSpecFromDataUri(uri, alt);
    if (!spec) return false;
    const updated = await editPrefab(spec);
    if (!updated) return true;
    const nextBlock = await markdownPrefabBlockForSpec(updated);
    if (nextBlock) replaceLine(nextBlock);
    return true;
  };
  const openMenuFor = async (event, { alt, uri, replaceLine, removeLine }) => {
    event.preventDefault();
    event.stopPropagation();
    const { openContextMenu } = await import('./context-menu.js');
    const { extractPrefabSpecFromDataUri } = await import('./chinese/zh-menu.js');
    const spec = extractPrefabSpecFromDataUri(uri, alt);
    const label = (alt || 'Prefab').trim() || 'Prefab';
    const fullLine = `![${alt}](${uri})`;
    openContextMenu(event.clientX, event.clientY, [
      spec && editPrefab && {
        label: `Edit ${label.length > 32 ? `${label.slice(0, 32)}…` : label}…`,
        icon: 'draw',
        run: () => openEditorFor({ alt, uri, replaceLine }),
      },
      {
        label: 'Copy Markdown',
        icon: 'copy',
        key: 'Ctrl C',
        run: () => navigator.clipboard?.writeText(fullLine),
      },
      '-',
      {
        label: 'Delete prefab',
        icon: 'trash',
        danger: true,
        run: () => removeLine(),
      },
    ].filter(Boolean), { title: label.length > 42 ? `${label.slice(0, 42)}…` : label });
  };
  if (editorContainer && getEditor && choosePrefab) {
    // Right-click in the text (not on a prefab, a selection or Chinese, which have their own
    // menus): Insert prefab… at that place, and Paste (the browser's menu is not shown).
    editorContainer.addEventListener('contextmenu', (event) => {
      if (event.defaultPrevented || event.shiftKey || event.target.closest?.('[data-prefab]')) return;
      const root = editorContainer.querySelector('.TinyMDE');
      if (!root?.contains(event.target)) return;
      const sel = getSelection();
      if (sel && !sel.isCollapsed && root.contains(sel.anchorNode)) return;
      const hit = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      const node = hit?.startContainer;
      if (node?.nodeType === 3) {
        const around = node.data.slice(Math.max(0, hit.startOffset - 1), hit.startOffset + 1);
        if (/\p{Script=Han}/u.test(around)) return;
      }
      const editor = getEditor();
      if (!editor) return;
      event.preventDefault();
      if (hit && root.contains(node)) { sel?.removeAllRanges(); sel?.addRange(hit); }
      const place = editor.getSelection(false);
      const { clientX: x, clientY: y } = event;
      import('./context-menu.js').then(({ openContextMenu }) => openContextMenu(x, y, [
        { label: 'Insert prefab…', icon: 'shape', run: () => insertPrefabInto(editor, choosePrefab, afterInsert, place) },
        ...extraEntries(),
        '-',
        navigator.clipboard?.readText && { label: 'Paste', key: 'Ctrl V', run: async () => { const t = await navigator.clipboard.readText().catch(() => ''); if (t) { if (place) editor.paste(t, place, place); else editor.paste(t); } } },
      ].filter(Boolean), { title: 'Markdown' }));
    });
  }
  if (editorContainer) {
    // A prefab line is one pill: the caret never edits its data. Typing or Enter on it goes to a
    // new line after it, Backspace or Delete removes the whole picture (Ctrl Z brings it back),
    // and a double-click opens its menu (Edit…, Copy Markdown, Delete).
    const pillAt = () => {
      const sel = getSelection();
      const node = sel?.anchorNode;
      const line = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('[data-prefab]');
      return line && editorContainer.contains(line) ? line : null;
    };
    const lineIndex = (line) => [...(editorContainer.querySelector('.TinyMDE')?.children || [])].indexOf(line);
    const removeAt = (idx) => {
      const cur = String(getText() || '').split('\n');
      if (idx < 0 || idx >= cur.length || !PREFAB_LINE.test(cur[idx])) return;
      cur.splice(idx, 1);
      setText(cur.join('\n'));
    };
    const caretToEnd = (line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    let marked = null;
    const markPill = () => {
      const line = pillAt();
      if (line === marked) return;
      marked?.classList.remove('prefab-caret');
      marked = line;
      line?.classList.add('prefab-caret');
    };
    document.addEventListener('selectionchange', markPill);
    editorContainer.addEventListener('beforeinput', (event) => {
      const line = pillAt();
      if (!line) return;
      const type = event.inputType || '';
      const sel = getSelection();
      const atEnd = sel.isCollapsed && (() => { const r = document.createRange(); r.selectNodeContents(line); r.setStart(sel.anchorNode, sel.anchorOffset); return r.toString() === ''; })();
      if (type === 'insertParagraph' && atEnd) return;
      event.preventDefault();
      if (type.startsWith('delete')) { removeAt(lineIndex(line)); return; }
      if (type.startsWith('history')) return;
      // Text, a paste or Enter in the middle: on a new line after the picture, the caret after it.
      const data = type === 'insertParagraph' ? '' : (event.data ?? event.dataTransfer?.getData('text/plain') ?? '');
      const idx = lineIndex(line), cur = String(getText() || '').split('\n');
      if (idx < 0 || idx >= cur.length) return;
      cur.splice(idx + 1, 0, data);
      setText(cur.join('\n'));
      const next = editorContainer.querySelector('.TinyMDE')?.children[idx + 1];
      if (next) caretToEnd(next);
    }, true);
    editorContainer.addEventListener('dblclick', (event) => {
      const chip = event.target.closest?.('[data-prefab]');
      if (!chip || !editPrefab) return;
      const root = editorContainer.querySelector('.TinyMDE');
      if (!root) return;
      const idx = [...root.children].indexOf(chip);
      if (idx < 0) return;
      const lines = String(getText() || '').split('\n');
      const m = (lines[idx] || '').match(PREFAB_LINE);
      if (!m) return;
      event.preventDefault();
      event.stopPropagation();
      openEditorFor({
        alt: m[1],
        uri: m[2],
        replaceLine: (nextLine) => {
          const cur = String(getText() || '').split('\n');
          if (idx < cur.length) {
            cur[idx] = nextLine;
            setText(cur.join('\n'));
          }
        },
      });
    });
    editorContainer.addEventListener('contextmenu', (event) => {
      const chip = event.target.closest?.('[data-prefab]');
      if (!chip) return;
      const root = editorContainer.querySelector('.TinyMDE');
      if (!root) return;
      const idx = [...root.children].indexOf(chip);
      if (idx < 0) return;
      const lines = String(getText() || '').split('\n');
      const m = (lines[idx] || '').match(PREFAB_LINE);
      if (!m) return;
      openMenuFor(event, {
        alt: m[1],
        uri: m[2],
        replaceLine: (nextLine) => {
          const cur = String(getText() || '').split('\n');
          if (idx < cur.length) {
            cur[idx] = nextLine;
            setText(cur.join('\n'));
          }
        },
        removeLine: () => {
          const cur = String(getText() || '').split('\n');
          if (idx < cur.length) {
            cur.splice(idx, 1);
            setText(cur.join('\n'));
          }
        },
      });
    });
  }
  if (previewContainer) {
    const previewTarget = (event) => {
      const img = event.target.closest?.('img[src^="data:image/svg+xml"]');
      if (!img) return null;
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || 'Prefab';
      const allImgs = [...previewContainer.querySelectorAll('img[src^="data:image/svg+xml"]')];
      const occurrence = allImgs.indexOf(img);
      const replaceOccurrence = (replacement) => {
        const md = String(getText() || '');
        const matches = findPrefabMatches(md);
        const hit = matches.find((x, i) => (occurrence >= 0 && i === occurrence) || x.uri === src) || matches[0];
        if (!hit) return;
        const before = md.slice(0, hit.index);
        const after = md.slice(hit.index + hit.full.length);
        const nextMd = replacement === null
          ? `${before.replace(/\n?$/, '')}${after.replace(/^\n?/, '\n')}`
          : `${before}${replacement}${after}`;
        setText(nextMd);
      };
      return { alt, uri: src, replaceLine: (nextLine) => replaceOccurrence(nextLine), removeLine: () => replaceOccurrence(null) };
    };
    previewContainer.addEventListener('dblclick', (event) => {
      if (!editPrefab) return;
      const target = previewTarget(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      openEditorFor(target);
    });
    previewContainer.addEventListener('contextmenu', (event) => {
      const target = previewTarget(event);
      if (!target) return;
      openMenuFor(event, target);
    });
  }
}

