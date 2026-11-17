// Notes kept with a figure (a chart in chart-editor.js, a diagram in uml-editor.js): Markdown
// stored in the figure's own spec (`notes`), so they travel with it in the note, the .nfedit and
// a saved prefab, and are never drawn on the page. Written in the same editor as the note's
// notes (TinyMDE), or read rendered (headings, lists, tables, maths) as in the notes panel.
import { renderMarkdown } from './rich-text.js';
import { icon } from './icons.js';

const READ_KEY = 'notecomplete.figure-notes.read';

// Without the app's engine (charts.html, uml.html): one worker of its own, started when first
// needed, renders the Markdown the same way.
let own = null;
function ownHtml(text) {
  own ||= (() => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const waiting = new Map();
    let next = 0;
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.ready) return resolve();
        if (data.fatal) return reject(Error(data.fatal));
        const w = waiting.get(data.id);
        if (!w) return;
        waiting.delete(data.id);
        if (data.error) w.reject(Error(data.error)); else w.resolve(data.result);
      };
    });
    return { ready, ask: (op, args) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject }); worker.postMessage({ id, op, page: 0, ...args }); }) };
  })();
  return own.ready.then(() => own.ask('markdownHtml', { text }));
}

function ensureStyles() {
  if (document.getElementById('fig-notes-css')) return;
  const style = document.createElement('style');
  style.id = 'fig-notes-css';
  style.textContent = `
.fig-notes { display: flex; flex-direction: column; min-height: 0; }
.fig-notes-tabs { display: flex; gap: 2px; padding: 3px; border-bottom: 1px solid var(--c-line, var(--line, #ddd)); }
.fig-notes-tabs button { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 0; border-radius: 5px; background: none; color: var(--c-muted, var(--muted, #666)); font: inherit; font-size: 12px; cursor: pointer; }
.fig-notes-tabs button svg { width: 14px; height: 14px; }
.fig-notes-tabs button[aria-pressed="true"] { color: var(--c-accent, var(--accent, #2563eb)); background: var(--c-soft, var(--accent-soft, #eef2ff)); }
.fig-notes-body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
.fig-notes-body > * { flex: 1 1 auto; }
.fig-notes-render { padding: 8px 12px; font: 13px/1.55 system-ui, sans-serif; color: var(--c-ink, var(--ink, #111)); overflow-wrap: break-word; cursor: text; }
.fig-notes-render > :first-child { margin-top: 0; }
.fig-notes-render h1, .fig-notes-render h2, .fig-notes-render h3 { line-height: 1.25; margin: .8em 0 .35em; font-weight: 700; text-transform: none; letter-spacing: 0; }
.fig-notes-render h1 { font-size: 1.45em; } .fig-notes-render h2 { font-size: 1.25em; } .fig-notes-render h3 { font-size: 1.1em; }
.fig-notes-render code { padding: 1px 4px; border-radius: 4px; background: var(--c-soft, var(--chrome, #f2f2f2)); font-size: 12px; }
.fig-notes-render pre { padding: 8px; border-radius: 6px; background: var(--c-soft, var(--chrome, #f2f2f2)); white-space: pre-wrap; }
.fig-notes-render pre code { padding: 0; background: none; }
.fig-notes-render blockquote { margin: 0; padding-left: 10px; border-left: 3px solid var(--c-line, var(--line, #ddd)); color: var(--c-muted, var(--muted, #666)); }
.fig-notes-render table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
.fig-notes-render th, .fig-notes-render td { padding: 3px 7px; border: 1px solid var(--c-line, var(--line, #ddd)); }
.fig-notes-render img { max-width: 100%; }
.fig-notes-empty { color: var(--c-muted, var(--muted, #666)); font-style: italic; }
.fig-notes .TinyMDE { min-height: 100%; padding: 8px 10px; outline: none; font-size: 13px; line-height: 1.5; color: var(--c-ink, var(--ink, #111)); background: transparent; }
.fig-notes-plain { resize: none; border: 0; padding: 8px 10px; font: 13px/1.5 ui-monospace, monospace; background: transparent; color: var(--c-ink, var(--ink, #111)); }
`;
  document.head.append(style);
}

const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};

// `get()` the notes now ('' for none), `set(text)` when they are written; `toHtml(text)` the
// app's Markdown renderer (the engine's markdownHtml), or a worker of its own without it.
export function figureNotes({ get, set, toHtml = null, placeholder = 'Notes (Markdown)', className = '' }) {
  ensureStyles();
  let reading = false;
  try { reading = localStorage.getItem(READ_KEY) === '1'; } catch { /* Optional. */ }
  const writeBtn = make('button', { type: 'button', className: 'fig-notes-write', title: 'Write the notes (Markdown)' }, icon('note'), make('span', { textContent: 'Write' }));
  const readBtn = make('button', { type: 'button', className: 'fig-notes-read', title: 'Read the notes rendered: headings, lists, tables, maths (double-click to write)' }, icon('eye'), make('span', { textContent: 'Read' }));
  const body = make('div', { className: 'fig-notes-body' });
  const pane = make('div', { className: `fig-notes ${className}`.trim() }, make('div', { className: 'fig-notes-tabs', role: 'group' }, writeBtn, readBtn), body);
  let editor = null, loading = null, shown = false, rendered = null;
  const tabs = () => { writeBtn.setAttribute('aria-pressed', String(!reading)); readBtn.setAttribute('aria-pressed', String(reading)); };
  tabs();

  async function write() {
    if (editor || loading) return loading;
    loading = (async () => {
      try {
        const { loadEditor } = await import('./notes.js');
        const TinyMDE = await loadEditor();
        if (!shown || reading) return;
        const host = make('div', { className: 'fig-notes-editor' });
        body.replaceChildren(host);
        editor = new TinyMDE.Editor({ element: host, content: get() || '', placeholder });
        editor.addEventListener('change', (e) => { if ((get() || '') !== e.content) set(e.content); });
      } catch {
        if (!shown || reading) return;
        // Without the Markdown editor: a plain text box.
        const area = make('textarea', { className: 'fig-notes-plain', spellcheck: true, placeholder });
        area.value = get() || '';
        area.oninput = () => set(area.value);
        body.replaceChildren(area);
        editor = { getContent: () => area.value, setContent: (v) => { area.value = v; } };
      } finally { loading = null; }
    })();
    return loading;
  }
  async function read() {
    const text = get() || '';
    if (rendered === text && body.firstChild?.classList?.contains('fig-notes-render')) return;
    rendered = text;
    const out = make('div', { className: 'fig-notes-render', title: 'Double-click to write' });
    out.ondblclick = () => setReading(false);
    body.replaceChildren(out);
    if (!text.trim()) { out.append(make('p', { className: 'fig-notes-empty', textContent: 'No notes yet. Write them in Write.' })); return; }
    await renderMarkdown(out, text, toHtml || ownHtml).catch(() => { out.style.whiteSpace = 'pre-wrap'; out.textContent = text; });
  }
  function setReading(value) {
    if (reading === value) return;
    reading = value;
    try { localStorage.setItem(READ_KEY, value ? '1' : '0'); } catch { /* Optional. */ }
    tabs();
    editor = null; rendered = null;
    body.replaceChildren();
    if (shown) show().then(() => { if (!reading) focus(); });
  }
  writeBtn.onclick = () => setReading(false);
  readBtn.onclick = () => setReading(true);
  function show() { shown = true; return reading ? read() : write(); }
  function focus() { body.querySelector('.TinyMDE, textarea')?.focus(); }
  return {
    pane,
    show,
    focus,
    get reading() { return reading; },
    setReading,
    hide() { shown = false; editor = null; rendered = null; body.replaceChildren(); },
    // The figure changed under the notes (undo, its JSON, another figure loaded).
    sync() {
      if (!shown) return;
      if (reading) { read(); return; }
      if (!editor) { write(); return; }
      if (editor.getContent && editor.getContent() !== (get() || '')) editor.setContent(get() || '');
    },
  };
}
