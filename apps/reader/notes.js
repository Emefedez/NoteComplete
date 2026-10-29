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
    editor.addEventListener('change', event => { text = event.content; save(); requestAnimationFrame(markLines); });
    markLines();
    follow(currentPage());
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
