// Notes: Markdown beside the pages, kept with the note. The editor (TinyMDE,
// vendor/tinymde) formats and colours Markdown as it is typed; the preview is
// rendered by the Rust core. `<!-- page N -->` lines tie what follows to a
// page: clicking one jumps there, and with Follow pages the notes scroll to
// the current page's section. Loaded on first use; the editor is destroyed
// when the panel closes, so nothing of it runs while it is hidden.
import { renderMarkdown } from './rich-text.js';

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

export function notesController({ call, jump, currentPage, store, status }) {
  // `core`: notes of a note live in its session (saved with projects and .notecomplete);
  // an HTML page has no session or pages, so its notes are only kept on this device.
  let text = '', key = '', editor = null, bar = null, saveTimer = 0, previewing = false, core = true;
  // A sharing session's notes (collab.js): a Y.Text everyone edits, with cursors.
  let shared = null;
  const panel = $('notesPanel');
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 600);
  };
  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (core) await call('setMarkdown', { text }).catch(error => status(error.message, true));
    if (key) await store.set('settings', key, text).catch(() => {});
  }
  // Marker lines are HTML blocks to the editor: tag them so they show as
  // chips, and a click on one shows its page.
  function markLines() {
    for (const line of $('notesEditor').querySelector('.TinyMDE')?.children || []) {
      const page = line.textContent.match(MARKER)?.[1];
      if (page) line.dataset.page = page;
      else delete line.dataset.page;
    }
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
    markLines();
    follow(currentPage());
    shared?.mounted?.();
  }
  function unmount() {
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
      $('notesMarker').hidden = previewing || !core;
      panel.querySelector('.notes-follow').hidden = !core;
      const inFile = core ? await call('getMarkdown').catch(() => '') : '';
      const kept = key ? await store.get('settings', key).catch(() => '') : '';
      text = inFile || kept || '';
      if (core && text && !inFile) await call('setMarkdown', { text }).catch(() => {});
      if (text && inFile && key && kept !== inFile) store.set('settings', key, text).catch(() => {});
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
