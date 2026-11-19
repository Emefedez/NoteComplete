// Notes: Markdown beside the pages, kept with the note. The editor (TinyMDE,
// vendor/tinymde) formats and colours Markdown as it is typed; the preview is
// rendered by the Rust core. `<!-- page N -->` lines tie what follows to a
// page: clicking one jumps there, and with Follow pages the notes scroll to
// the current page's section. Loaded on first use; the editor is destroyed
// when the panel closes, so nothing of it runs while it is hidden.
import { renderMarkdown } from './rich-text.js';
import { attachIme, zhButton } from './chinese/ime.js';
import { fieldMode, setFieldMode } from './chinese/settings.js';
import { noteMode, setNoteMode } from './chinese/ruby.js';

const $ = id => document.getElementById(id);
let library = null;
export function loadEditor() {
  return library ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = './vendor/tinymde/tiny-mde.min.css';
    document.head.append(css);
    const script = document.createElement('script');
    script.src = './vendor/tinymde/tiny-mde.min.js';
    script.onload = () => resolve(window.TinyMDE);
    script.onerror = () => { library = null; reject(Error('The notes editor could not be loaded.')); };
    document.head.append(script);
  });
}
const MARKER = /^\s*<!--\s*page\s+(\d+)\s*-->\s*$/;
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

// Positions in the editor are { row, col }; Yjs counts characters from the start.
export function toIndex(text, { row, col }) {
  const lines = text.split('\n');
  let index = 0;
  for (let r = 0; r < Math.min(row, lines.length); r++) index += lines[r].length + 1;
  return Math.min(text.length, index + Math.min(col, lines[Math.min(row, lines.length - 1)]?.length ?? 0));
}
export function toRowCol(text, index) {
  const before = text.slice(0, Math.max(0, Math.min(index, text.length))).split('\n');
  return { row: before.length - 1, col: before.at(-1).length };
}
// Moves a character index through a Yjs text delta (retain / insert / delete, counted
// in the text before the change).
export function moveIndex(index, delta) {
  let at = 0, shift = 0;
  for (const step of delta) {
    if (at > index) break;
    if (step.retain) at += step.retain;
    else if (step.insert) { if (at <= index) shift += step.insert.length; }
    else if (step.delete) {
      if (at < index) shift -= Math.min(step.delete, index - at);
      at += step.delete;
    }
  }
  return Math.max(0, index + shift);
}

// The section of the notes for a page: its marker line, else none.
export function markerLine(text, page) {
  const lines = text.split('\n');
  const i = lines.findIndex(l => Number(l.match(MARKER)?.[1]) === page);
  return i < 0 ? null : i;
}

export function notesController({ call, jump, currentPage, store, status, editPrefab = null }) {
  // `core`: notes of a note live in its session (saved with projects and .notecomplete);
  // an HTML page has no session or pages, so its notes are only kept on this device.
  let text = '', key = '', editor = null, bar = null, saveTimer = 0, previewing = false, core = true;
  // A sharing session's notes (collab.js): a Y.Text everyone edits, with cursors.
  let shared = null;
  const panel = $('notesPanel');
  // 中: Chinese input in the notes (chinese/ime.js), its mode kept per note.
  const mdEl = () => $('notesEditor').querySelector('.TinyMDE');
  const zhNotes = zhButton(mdEl);
  const traceBtn = $('notesTraceBtn');
  const helpBtn = $('notesHelpBtn');
  let helpSheet = null;
  if (traceBtn) traceBtn.before(zhNotes);
  else $('notesMarker').before(zhNotes);
  const zhMode = () => `notes-${key || 'none'}`;
  const syncNotesZh = () => {
    const mode = mdEl()?.__zhIme?.mode || noteMode(fieldMode(zhMode())) || 'off';
    if (traceBtn) traceBtn.hidden = mode === 'off';
  };
  if (traceBtn) {
    traceBtn.onclick = async () => {
      const selText = globalThis.getSelection?.()?.toString?.() || '';
      const hasExplicitSelection = Boolean(selText);
      const selectedHan = ([...selText].filter((c) => /\p{Script=Han}/u.test(c))).slice(0, 12).join('');
      if (hasExplicitSelection && !selectedHan) {
        status?.('Select at least one Chinese character to insert a trace order prefab.', true);
        return;
      }
      const han = selectedHan || (text.match(/\p{Script=Han}+/gu)?.at(-1)?.slice(0, 6)) || '';
      if (!han) {
        status?.('Type or select a Chinese character first to insert a trace order prefab.', true);
        return;
      }
      const { markdownTraceBlockFor } = await import('./chinese/zh-menu.js');
      const block = await markdownTraceBlockFor(han);
      if (block && editor) {
        const sel = globalThis.getSelection?.();
        if (sel?.rangeCount && !sel.isCollapsed && $('notesEditor')?.contains(sel.anchorNode)) sel.collapseToEnd();
        editor.paste(block);
        requestAnimationFrame(markLines);
      }
    };
  }
  if (helpBtn && panel) {
    helpBtn.onclick = async () => {
      if (!helpSheet) {
        const { cheatSheet } = await import('./cheat-sheet.js');
        helpSheet = cheatSheet(panel, {
          key: 'notes-markdown',
          title: 'Notes & Chinese Cheat Sheet',
          sections: [
            { title: 'Markdown notes', icon: 'note', rows: [
              { keys: '+ Page', does: 'Insert a <!-- page N --> marker tying the section below to the current page' },
              { keys: '#  **bold**  *italic*', does: 'Headings, bold and italic text' },
              { keys: '$x^2$  $$...$$', does: 'Inline and block LaTeX math' },
            ] },
            { title: 'Chinese input & Trace Prefabs', icon: 'draw', rows: [
              { keys: '中 / Ctrl Shift Space', does: 'Toggle Chinese mode (Hanzi / Pinyin tones / Latin) and show the 笔 trace button' },
              { keys: '笔', does: 'Highlight Chinese characters and click 笔 to insert their stroke order trace sheet (with English meaning & variants)' },
              { keys: 'Right-click character', does: 'See English equivalent, Simplified/Traditional variants, and open the animated Trace Prefab Editor' },
            ] },
          ],
        });
      }
      helpSheet.toggle();
    };
  }
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  };
  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (core) await call('setMarkdown', { text }).catch(error => status(error.message, true));
    if (key) await store.set('settings', key, text).catch((e) => console.warn('Save notes:', e));
  }
  // Marker lines are HTML blocks to the editor: tag them so they show as
  // chips, and a click on one shows its page. Prefab SVG data-URI lines are
  // also tagged so they render as compact truncated medallions like page chips.
  function markLines() {
    decorateTinyMdeLines($('notesEditor').querySelector('.TinyMDE'));
  }
  async function mount() {
    const TinyMDE = await loadEditor();
    if (editor || panel.hidden) return;
    editor = new TinyMDE.Editor({ element: $('notesEditor'), content: text, placeholder: core ? 'Notes for this document. Markdown: # heading, **bold**, - list… “+ Page” ties a section to the page you are on.' : 'Notes for this page. Markdown: # heading, **bold**, - list…', });
    bar = new TinyMDE.CommandBar({ element: $('notesCommands'), editor });
    editor.addEventListener('change', event => {
      if (shared?.applying) return;
      if (shared && !shared.canEdit) { if (event.content !== text) queueMicrotask(() => editor?.setContent(text)); return; }
      text = event.content;
      if (shared) shared.local(text);
      if (!shared || shared.persist) save();
      requestAnimationFrame(markLines);
    });
    $('notesEditor').querySelector('.TinyMDE')?.setAttribute('contenteditable', String(!shared || shared.canEdit));
    // Chinese typed here goes in through the editor (one change, so sharing sees it).
    if (mdEl()) attachIme(mdEl(), { kind: 'contenteditable', insert: (t) => editor?.paste(t), getMode: () => noteMode(fieldMode(zhMode())), setMode: (m) => { setFieldMode(zhMode(), m); setNoteMode(m); syncNotesZh(); } }).addButton(zhNotes);
    syncNotesZh();
    markLines();
    follow(currentPage());
    shared?.mounted?.();
  }
  function unmount() {
    mdEl()?.__zhIme?.detach();
    bar?.destroy?.();
    editor?.destroy?.();
    bar = editor = null;
    $('notesCommands').replaceChildren();
    $('notesEditor').replaceChildren();
  }
  async function render() {
    await renderMarkdown($('notesRender'), text, value => call('markdownHtml', { text: value }));
    follow(currentPage());
  }
  // Scroll the notes (not the caret) to the section of page `index` (0-based).
  function follow(index) {
    if (!core || panel.hidden || !$('notesFollow').checked) return;
    const target = previewing
      ? $('notesRender').querySelector(`.md-page[data-page="${index + 1}"]`)
      : (() => { const line = markerLine(text, index + 1); return line == null ? null : $('notesEditor').querySelector('.TinyMDE')?.children[line]; })();
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  $('notesEditor').addEventListener('click', event => {
    const chip = event.target.closest('[data-page]');
    if (chip) jump(Number(chip.dataset.page) - 1);
  });
  $('notesRender').addEventListener('click', event => {
    const chip = event.target.closest('.md-page');
    if (chip) jump(Number(chip.dataset.page) - 1);
  });
  attachMarkdownPrefabContextMenu({
    editorContainer: $('notesEditor'),
    previewContainer: $('notesRender'),
    getText: () => text,
    setText: (next) => {
      text = next;
      if (editor) {
        editor.setContent(text);
        requestAnimationFrame(markLines);
      }
      if (previewing && !panel.hidden) render();
      if (shared) shared.local(text);
      if (!shared || shared.persist) save();
    },
    editPrefab,
  });
  $('notesMarker').onclick = () => {
    if (!editor) return;
    const n = currentPage() + 1, at = editor.getSelection() || { row: 0, col: 0 };
    const line = text.split('\n')[at.row] || '';
    editor.paste(`${line.trim() ? '\n' : ''}<!-- page ${n} -->\n`, at, at);
    status(`Notes after this line belong to page ${n}.`);
  };
  $('notesPreview').onclick = () => {
    previewing = !previewing;
    $('notesPreview').setAttribute('aria-pressed', String(previewing));
    $('notesEditor').hidden = $('notesCommands').hidden = previewing;
    $('notesMarker').hidden = previewing || !core;
    $('notesRender').hidden = !previewing;
    if (previewing) render();
    else mount().catch(error => status(error.message, true));
  };
  return {
    // A note was opened: its notes come from the file (project or .notecomplete),
    // else from what was typed for it on this device.
    // { core: false }: an HTML page (no session, no pages: no + Page or Follow).
    async load(fingerprint, { core: inCore = true } = {}) {
      if (saveTimer) await flush();
      const placeholderChanged = core !== inCore;
      core = inCore;
      key = fingerprint ? `notes:${fingerprint}` : '';
      mdEl()?.__zhIme?.refresh();
      $('notesMarker').hidden = previewing || !core;
      panel.querySelector('.notes-follow').hidden = !core;
      const inFile = core ? await call('getMarkdown').catch(() => '') : '';
      const kept = key ? await store.get('settings', key).catch(() => '') : '';
      text = inFile || kept || '';
      // Transcripts appended from Recent (batch-transcribe.js) while the note was closed.
      const pending = key ? await store.get('settings', `notes-pending:${fingerprint}`).catch(() => '') : '';
      if (pending) {
        text = `${text.trimEnd()}${pending}`;
        await store.set('settings', `notes-pending:${fingerprint}`, '').catch(() => {});
        if (core) await call('setMarkdown', { text }).catch((e) => console.warn('Set markdown:', e));
        await store.set('settings', key, text).catch((e) => console.warn('Save notes:', e));
        status?.('Transcripts from Recent added to the Markdown notes.');
      }
      if (core && text && !inFile) await call('setMarkdown', { text }).catch((e) => console.warn('Set markdown:', e));
      if (text && inFile && key && kept !== inFile) store.set('settings', key, text).catch((e) => console.warn('Save notes:', e));
      // The placeholder differs between notes and pages: the editor is made again for it.
      if (editor && placeholderChanged) { unmount(); if (!panel.hidden && !previewing) await mount().catch(error => status(error.message, true)); }
      else if (editor) { editor.setContent(text); requestAnimationFrame(markLines); }
      if (previewing && !panel.hidden) render();
    },
    async open() {
      panel.hidden = false;
      if (previewing) render();
      else await mount().catch(error => status(error.message, true));
    },
    async close() {
      panel.hidden = true;
      if (saveTimer) await flush();
      unmount();
    },
    pageChanged: follow,
    // Notes shared in a session. persist: this reader keeps them (the host); others only edit.
    share(session) {
      shared = session;
      shared.applying = false;
      text = session.text();
      if (editor) { shared.applying = true; editor.setContent(text); shared.applying = false; requestAnimationFrame(markLines); }
      $('notesEditor').querySelector('.TinyMDE')?.setAttribute('contenteditable', String(session.canEdit));
      if (previewing && !panel.hidden) render();
      if (session.persist) save();
    },
    unshare() {
      shared = null;
      $('notesEditor').querySelector('.TinyMDE')?.setAttribute('contenteditable', 'true');
      $('notesCursors')?.replaceChildren();
    },
    // Others' edits arrived: show them, keeping this person's caret where it was in the text.
    remote(next, delta) {
      if (!shared) return;
      const focused = editor && $('notesEditor').contains(document.activeElement);
      const caret = focused ? editor.getSelection() : null, anchor = focused ? editor.getSelection(true) : null;
      const before = text;
      text = next;
      if (editor) {
        shared.applying = true;
        editor.setContent(text);
        shared.applying = false;
        if (caret) {
          const move = (pos) => toRowCol(text, moveIndex(toIndex(before, pos), delta));
          editor.setSelection(move(caret), anchor ? move(anchor) : null);
        }
        requestAnimationFrame(markLines);
      } else if (previewing && !panel.hidden) render();
      if (shared.persist) save();
    },
    // This person's caret as a character index, for the others' view of it.
    caret() {
      if (!editor || !$('notesEditor').contains(document.activeElement)) return null;
      const focus = editor.getSelection(), anchor = editor.getSelection(true);
      return focus ? { index: toIndex(text, focus), anchor: anchor ? toIndex(text, anchor) : null } : null;
    },
    // Where a character index is drawn in the editor, relative to the editor box.
    caretBox(index) {
      const lines = $('notesEditor').querySelector('.TinyMDE')?.children;
      const { row, col } = toRowCol(text, index);
      const line = lines?.[row];
      if (!line) return null;
      const box = $('notesEditor').getBoundingClientRect();
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let left = col, node;
      const range = document.createRange();
      while ((node = walker.nextNode())) {
        if (left <= node.length) { range.setStart(node, left); range.collapse(true); break; }
        left -= node.length;
      }
      if (!node) { range.selectNodeContents(line); range.collapse(false); }
      const r = range.getClientRects()[0] || line.getBoundingClientRect();
      return { x: r.left - box.left + $('notesEditor').scrollLeft, y: r.top - box.top + $('notesEditor').scrollTop, height: r.height || 18 };
    },
    scrollToIndex(index) {
      const lines = $('notesEditor').querySelector('.TinyMDE')?.children;
      lines?.[toRowCol(text, index).row]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    get sharing() { return !!shared; },
    flush: () => (saveTimer ? flush() : Promise.resolve()),
    // Add Markdown at the end (Scratchpad → Add to notes), in the editor too when it is open.
    async append(markdown) {
      text = text.trim() ? `${text.replace(/\s+$/, '')}\n\n${markdown}\n` : `${markdown}\n`;
      if (editor) editor.setContent(text);
      else if (previewing && !panel.hidden) render();
      await flush();
    },
    get visible() { return !panel.hidden; },
    get text() { return text; },
  };
}
