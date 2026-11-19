// Markdown lines the editors show as chips: `<!-- page N -->` markers and prefab pictures
// (![alt](data:image/svg+xml…)), with the prefab's menu (Edit…, Copy Markdown, Delete) in the
// editor and the preview. Shared by the Notes panel (notes.js, loaded on first use) and the
// document view's Markdown editor (text-view.js), so neither pulls in the other.
export const MARKER = /^\s*<!--\s*page\s+(\d+)\s*-->\s*$/;
// A prefab picture on a line of its own: ![alt](data:image/svg+xml…). The URI runs to the line's
// last ")" (older notes have unescaped parentheses inside it), and the alt may hold "]" (older
// glosses such as "[Taiwan pr.]").
const PREFAB_ALT = '((?:[^\\]]|\\](?!\\(data:))*)';
export const PREFAB_LINE = new RegExp(`^\\s*!\\[${PREFAB_ALT}\\]\\((data:image\\/svg\\+xml\\S*)\\)\\s*$`);
// The same pictures anywhere in a text: the URI ends at a ")" followed by a space or the end.
const prefabPattern = () => new RegExp(`!\\[${PREFAB_ALT}\\]\\((data:image\\/svg\\+xml\\S*?)\\)(?=\\s|$)`, 'g');

export function decorateTinyMdeLines(root) {
  if (!root) return;
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
  const openMenuFor = async (event, { alt, uri, replaceLine, removeLine }) => {
    event.preventDefault();
    event.stopPropagation();
    const { openContextMenu } = await import('./context-menu.js');
    const { extractPrefabSpecFromDataUri, markdownPrefabBlockForSpec } = await import('./chinese/zh-menu.js');
    const spec = extractPrefabSpecFromDataUri(uri, alt);
    const label = (alt || 'Prefab').trim() || 'Prefab';
    const fullLine = `![${alt}](${uri})`;
    openContextMenu(event.clientX, event.clientY, [
      spec && editPrefab && {
        label: `Edit ${label.length > 32 ? `${label.slice(0, 32)}…` : label}…`,
        icon: 'draw',
        run: async () => {
          const updated = await editPrefab(spec);
          if (!updated) return;
          const nextBlock = await markdownPrefabBlockForSpec(updated);
          if (nextBlock) replaceLine(nextBlock);
        },
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
      event.preventDefault();
      chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: event.clientX, clientY: event.clientY }));
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
    previewContainer.addEventListener('contextmenu', (event) => {
      const img = event.target.closest?.('img[src^="data:image/svg+xml"]');
      if (!img) return;
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
      openMenuFor(event, {
        alt,
        uri: src,
        replaceLine: (nextLine) => replaceOccurrence(nextLine),
        removeLine: () => replaceOccurrence(null),
      });
    });
  }
}

