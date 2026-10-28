// Reader for .txt and Markdown files. Markdown (with LaTeX) is rendered by the core and
// KaTeX, as in the Notes panel; plain text is shown as written. The file is never changed.
import { renderMarkdown } from './rich-text.js';

export const isTextName = (name) => /\.(txt|md|markdown)$/i.test(name || '');
export const isMarkdownName = (name) => /\.(md|markdown)$/i.test(name || '');

export function textViewer({ root, body, title, format, toHtml }) {
  let text = '', name = '', markdown = false, renders = 0;
  async function render() {
    const token = ++renders;
    format.setAttribute('aria-pressed', String(markdown));
    body.classList.toggle('text-plain', !markdown);
    if (!markdown) { body.textContent = text; return; }
    const scratch = body.ownerDocument.createElement('div');
    await renderMarkdown(scratch, text, toHtml);
    if (token === renders) body.replaceChildren(...scratch.childNodes);
  }
  format.onclick = () => { markdown = !markdown; render(); };
  return {
    // Markdown files start formatted, .txt as plain text; Markdown switches either way.
    open({ text: content, name: shown, markdown: formatted }) {
      text = content; name = shown; markdown = formatted;
      if (title) title.textContent = shown;
      root.hidden = false;
      body.scrollTop = 0;
      return render();
    },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    close() { renders++; root.hidden = true; body.replaceChildren(); text = ''; name = ''; },
    get visible() { return !root.hidden; },
    get hasDocument() { return Boolean(name); },
    get name() { return name; },
    get text() { return text; },
  };
}
