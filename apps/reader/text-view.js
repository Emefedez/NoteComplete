// Reader and editor for text files. Markdown (with LaTeX) is rendered by the core and KaTeX,
// as in the Notes panel; other text is shown as written. Edit opens TinyMDE for Markdown
// (loaded on first use, like the Notes editor) or a plain editor for other text; the app
// saves the result (onChange reports every edit).
import { renderMarkdown } from './rich-text.js';

export { isTextName, isMarkdownName } from './text-types.js';

const ZOOMS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
const ZOOM_KEY = 'notecomplete-text-zoom';

// Zoom steps shared by text documents and HTML pages; remembered on this device.
export function zoomControl({ key = ZOOM_KEY, out, into, value, apply }) {
  let zoom = 1;
  try { const z = Number(localStorage.getItem(key)); if (ZOOMS.includes(z)) zoom = z; } catch { /* Optional. */ }
  const show = () => {
    value.textContent = `${Math.round(zoom * 100)}%`;
    out.disabled = zoom <= ZOOMS[0];
    into.disabled = zoom >= ZOOMS.at(-1);
    apply(zoom);
  };
  const step = (dir) => {
    const i = ZOOMS.indexOf(zoom);
    zoom = dir === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))];
    try { localStorage.setItem(key, String(zoom)); } catch { /* Optional. */ }
    show();
  };
  out.onclick = () => step(-1);
  into.onclick = () => step(1);
  value.onclick = () => step(0);
  show();
  return { step, get zoom() { return zoom; }, show };
}

export function textViewer({ root, body, editorHost, title, format, edit, zoom, toHtml, loadEditor, onChange = () => {} }) {
  let text = '', name = '', key = '', markdown = false, renders = 0, editing = false, mde = null, mount = 0;
  const zoomer = zoomControl({ ...zoom, apply: (z) => root.style.setProperty('--text-zoom', String(z)) });
  body.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoomer.step(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  async function render() {
    const token = ++renders;
    format.setAttribute('aria-pressed', String(markdown));
    body.classList.toggle('text-plain', !markdown);
    if (!markdown) { body.textContent = text; return; }
    const scratch = body.ownerDocument.createElement('div');
    await renderMarkdown(scratch, text, toHtml);
    if (token === renders) body.replaceChildren(...scratch.childNodes);
  }
  function changed(next) { text = next; onChange(text); }
  // The editor follows MD: with it, TinyMDE (formatting toolbar) for any text file; without, plain.
  function unmount() {
    mount++;
    mde?.bar?.destroy?.();
    mde?.editor?.destroy?.();
    mde = null;
    editorHost.replaceChildren();
  }
  async function startEditing() {
    editing = true;
    edit.setAttribute('aria-pressed', 'true');
    body.hidden = true;
    editorHost.hidden = false;
    unmount();
    const mine = mount;
    if (markdown && loadEditor) {
      const TinyMDE = await loadEditor();
      if (!editing || mine !== mount) return;
      const commands = document.createElement('div'), area = document.createElement('div');
      // The Notes panel's classes, so TinyMDE follows the app theme the same way.
      commands.className = 'notes-commands';
      area.className = 'notes-editor';
      editorHost.append(commands, area);
      const editor = new TinyMDE.Editor({ element: area, content: text });
      const bar = new TinyMDE.CommandBar({ element: commands, editor });
      editor.addEventListener('change', (event) => changed(event.content));
      mde = { editor, bar };
    } else {
      const area = document.createElement('textarea');
      area.className = 'doc-editor-plain';
      area.spellcheck = false;
      area.value = text;
      area.oninput = () => changed(area.value);
      editorHost.append(area);
      area.focus();
    }
  }
  function stopEditing() {
    if (!editing) return;
    editing = false;
    unmount();
    editorHost.hidden = true;
    body.hidden = false;
    edit.setAttribute('aria-pressed', 'false');
    render();
  }
  // MD on or off is remembered per file on this device.
  const remembered = (k, fallback) => { try { const v = localStorage.getItem(`notecomplete-text-md:${k}`); return v === null ? fallback : v === '1'; } catch { return fallback; } };
  format.onclick = () => {
    markdown = !markdown;
    try { if (key) localStorage.setItem(`notecomplete-text-md:${key}`, markdown ? '1' : '0'); } catch { /* Optional. */ }
    format.setAttribute('aria-pressed', String(markdown));
    if (editing) startEditing(); else render();
  };
  edit.onclick = () => (editing ? stopEditing() : startEditing());
  return {
    // Markdown files start formatted, other text as written, until MD is switched for that file.
    open({ text: content, name: shown, markdown: formatted, key: id = shown }) {
      stopEditing();
      text = content; name = shown; key = id; markdown = remembered(id, formatted);
      if (title) title.textContent = shown;
      root.hidden = false;
      body.scrollTop = 0;
      return render();
    },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    close() { stopEditing(); renders++; root.hidden = true; body.replaceChildren(); text = ''; name = ''; },
    zoom: (dir) => zoomer.step(dir),
    get visible() { return !root.hidden; },
    get hasDocument() { return Boolean(name); },
    get editing() { return editing; },
    get name() { return name; },
    get text() { return text; },
  };
}
