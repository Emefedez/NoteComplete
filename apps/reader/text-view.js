// Reader and editor for text files. Markdown (with LaTeX) is rendered by the core and KaTeX,
// as in the Notes panel; other text is shown as written, source code (.java, .py, .sh…)
// coloured by its language. Edit opens TinyMDE for Markdown (loaded on first use, like the
// Notes editor), a code editor for source code (code-highlight.js) or a plain editor for other
// text; the app saves the result (onChange reports every edit).
import { renderMarkdown } from './rich-text.js';
import { highlight, langFromName, codeEditor } from './code-highlight.js';

export { isTextName, isMarkdownName, isDiagramName } from './text-types.js';

// What the Diagram view says when it cannot draw (draw() results from diagrams.js, or no bridge).
export function diagramMessage(result) {
  if (result?.unavailable) return 'PlantUML diagrams are drawn by the NoteComplete desktop app, with PlantUML installed on the computer. Here you see the source.';
  if (result?.missing) return 'PlantUML is not installed on this computer, so this is the source. Install PlantUML (it needs Java): for example sudo pacman -S plantuml, sudo apt install plantuml or brew install plantuml. Then press UML twice to draw it.';
  if (result?.failed) return `PlantUML could not draw this diagram: ${result.failed}`;
  if (result?.error) return `PlantUML found a problem: ${result.error}`;
  return '';
}

// Code bigger than this is shown uncoloured (it would still be quick, but a huge log-like
// file gains nothing from it).
const CODE_LIMIT = 2_000_000;

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

// GitHub-style heading anchors: "## Tema 1: Introducción" is #tema-1-introducción;
// repeated headings get -1, -2…
export function headingSlug(text) {
  return String(text).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}
const loose = (slug) => slug.normalize('NFD').replace(/\p{M}/gu, '').replace(/[-_]+/g, '-').replace(/^-|-$/g, '');
// Which heading (index into `headings`, their texts) an in-document link (#…) names, or -1.
export function headingFor(headings, fragment) {
  let wanted = String(fragment || '');
  try { wanted = decodeURIComponent(wanted); } catch { /* Kept as written. */ }
  wanted = wanted.toLowerCase();
  const seen = new Map(), slugs = headings.map((text) => {
    const base = headingSlug(text), n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  });
  const exact = slugs.indexOf(wanted);
  return exact >= 0 ? exact : slugs.findIndex((slug) => loose(slug) === loose(wanted));
}

// Links in a Markdown document: #anchors scroll to their heading or footnote, web
// links open in the browser (target=_blank, rich-text.js), other links go to openLink
// (a file next to this one).
// diagram = { is(name), draw(text) }: files it names (PlantUML) show as a drawing while the format
// button (UML instead of MD) is on; draw() resolves to { svg, error? }, { missing } or { unavailable }.
export function textViewer({ root, body, editorHost, title, format, edit, zoom, toHtml, loadEditor, onChange = () => {}, openLink = () => {}, imageUrl = null, diagram = null }) {
  let text = '', name = '', key = '', markdown = false, renders = 0, editing = false, mde = null, code = null, mount = 0, diagramUrl = '', diagramDoc = null, lastDiagramSvg = '', diagramBar = null;
  // The language of the open file when it is source code ('' for plain text and Markdown).
  const codeLang = () => { const lang = langFromName(key || name); return lang === 'markdown' ? '' : lang; };
  // The UML editor showing a .puml file (diagram.mount), while it is open.
  const dropDiagramDoc = () => { diagramDoc?.destroy(); diagramDoc = null; body.classList.remove('text-diagram-editor'); dockBar(null); };
  // One bar: the editor's toolbar goes into the document bar, after the title, while it is open
  // (its own zoom replaces the document's). The wrapper keeps the editor's colours and buttons.
  function dockBar(host) {
    diagramBar?.remove(); diagramBar = null;
    root?.classList.remove('diagram-editing');
    const bar = host?.querySelector('.uml-bar'), slot = root?.querySelector('.html-bar');
    if (!bar || !slot) return;
    diagramBar = body.ownerDocument.createElement('div');
    diagramBar.className = 'uml-editor uml-bar-dock';
    diagramBar.append(bar);
    (title?.parentElement === slot ? title : slot.querySelector('.spacer')?.previousElementSibling)?.after(diagramBar);
    root.classList.add('diagram-editing');
  }
  const formatLabel = { text: format.textContent, title: format.title };
  const isDiagram = () => Boolean(diagram?.is(key || name));
  const releaseDiagram = () => { if (diagramUrl) URL.revokeObjectURL(diagramUrl); diagramUrl = ''; lastDiagramSvg = ''; };
  function labelFormat() {
    const uml = isDiagram();
    format.textContent = uml ? 'UML' : formatLabel.text;
    format.title = uml ? 'UML: the diagram drawn with PlantUML. Off: the source as written' : formatLabel.title;
  }
  // The drawing as a picture (an <img> runs no script from the SVG), sized by the text zoom.
  async function renderDiagram(token) {
    // Class, package and use case diagrams: the UML editor, writing back PlantUML as it changes.
    if (diagram.mount) {
      const host = body.ownerDocument.createElement('div');
      host.className = 'diagram-editor-host';
      body.classList.add('text-diagram-editor');
      body.replaceChildren(host);
      let ctl = null;
      try { ctl = await diagram.mount(host, text, { onText: (next) => changed(next) }); } catch (error) { console.warn('Diagram editor:', error); }
      if (token !== renders) { ctl?.destroy(); return; }
      if (ctl) { diagramDoc = ctl; dockBar(host); return; }
      body.classList.remove('text-diagram-editor');
    }
    let result;
    try { result = await diagram.draw(text); } catch (error) { result = { failed: error?.message || String(error) }; }
    if (token !== renders) return;
    const doc = body.ownerDocument, nodes = [];
    const note = diagramMessage(result);
    if (note) { const p = doc.createElement('p'); p.className = 'diagram-note'; p.textContent = note; nodes.push(p); }
    releaseDiagram();
    if (result?.svg) {
      lastDiagramSvg = result.svg;
      diagramUrl = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      const figure = doc.createElement('figure'), img = doc.createElement('img');
      figure.className = 'diagram-view';
      img.alt = `Diagram ${name}`;
      img.onload = () => img.style.setProperty('--diagram-width', `${img.naturalWidth}px`);
      img.src = diagramUrl;
      figure.append(img);
      nodes.push(figure);
    } else {
      const pre = doc.createElement('pre');
      pre.className = 'diagram-source';
      pre.textContent = text;
      nodes.push(pre);
    }
    body.replaceChildren(...nodes);
  }
  const zoomer = zoomControl({ ...zoom, apply: (z) => root.style.setProperty('--text-zoom', String(z)) });
  // Over the UML editor, the bar's − / + / 100% zoom its canvas (100%: the whole diagram).
  for (const [button, dir] of [[zoom.out, -1], [zoom.into, 1], [zoom.value, 0]]) {
    const own = button.onclick;
    button.onclick = (event) => (diagramDoc ? diagramDoc.zoom(dir) : own?.(event));
  }
  body.addEventListener('click', (event) => {
    const a = event.target.closest?.('a[href]');
    if (!a || !body.contains(a) || a.target === '_blank') return;
    event.preventDefault();
    const href = a.getAttribute('href');
    if (!href.startsWith('#')) return openLink(href);
    const fragment = href.slice(1);
    let target = [...body.querySelectorAll('[id], a[name]')].find((el) => el.id === fragment || el.getAttribute('name') === fragment);
    if (!target) {
      const headings = [...body.querySelectorAll('h1, h2, h3, h4, h5, h6')];
      target = headings[headingFor(headings.map((h) => h.textContent), fragment)];
    }
    if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  body.addEventListener('wheel', (event) => {
    if (!event.ctrlKey || diagramDoc) return;
    event.preventDefault();
    zoomer.step(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  async function render() {
    const token = ++renders;
    dropDiagramDoc();
    format.setAttribute('aria-pressed', String(markdown));
    body.classList.toggle('text-plain', !markdown);
    body.classList.toggle('text-diagram', markdown && isDiagram());
    const lang = !markdown && text.length <= CODE_LIMIT ? codeLang() : '';
    body.classList.toggle('text-code', Boolean(lang));
    if (lang) body.dataset.lang = lang; else delete body.dataset.lang;
    if (!markdown) {
      releaseDiagram();
      if (lang) body.innerHTML = highlight(text, lang); else body.textContent = text;
      return;
    }
    if (isDiagram()) return renderDiagram(token);
    const scratch = body.ownerDocument.createElement('div');
    await renderMarkdown(scratch, text, toHtml, { document: true, imageUrl });
    if (token !== renders) return;
    body.replaceChildren(...scratch.childNodes);
    // Pinyin over the Chinese where it now is (chinese/ruby.js).
    if (/[\u3400-\u9fff]/.test(text)) import('./chinese/ruby.js').then(m => m.rubyElement(body)).catch(() => {});
  }
  function changed(next) { text = next; onChange(text); }
  // The editor follows MD: with it, TinyMDE (formatting toolbar) for any text file; without, plain.
  function unmount() {
    mount++;
    mde?.bar?.destroy?.();
    mde?.editor?.destroy?.();
    mde = null;
    code?.destroy();
    code = null;
    editorHost.replaceChildren();
  }
  async function startEditing() {
    dropDiagramDoc();
    editing = true;
    edit.setAttribute('aria-pressed', 'true');
    body.hidden = true;
    editorHost.hidden = false;
    unmount();
    const mine = mount;
    if (markdown && loadEditor && !isDiagram()) {
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
    } else if (!markdown && codeLang() && text.length <= CODE_LIMIT) {
      // Source code: coloured as it is typed; Tab indents, Enter keeps the indentation. The
      // textarea keeps the plain editor's class, so Find in the document works the same.
      code = codeEditor(editorHost, { value: text, lang: codeLang(), onChange: changed, className: 'doc-code', inputClass: 'doc-editor-plain', label: name || 'Code' });
      code.focus();
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
      labelFormat();
      if (title) title.textContent = shown;
      root.hidden = false;
      body.scrollTop = 0;
      return render();
    },
    // New text for the open document (a shared one following its host), keeping the place read.
    async setText(content) {
      if (editing || !name) return;
      text = content;
      const top = body.scrollTop;
      await render();
      body.scrollTop = top;
    },
    get markdown() { return markdown; },
    // The file was renamed on disk: new title and the key MD on/off is remembered under.
    rename(shown, id = shown) { name = shown; key = id; labelFormat(); if (title) title.textContent = shown; },
    // Draw again (pictures beside the file can be read once its place is known).
    rerender() { return editing ? undefined : render(); },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    close() { stopEditing(); renders++; dropDiagramDoc(); releaseDiagram(); root.hidden = true; body.replaceChildren(); text = ''; name = ''; },
    get diagram() { return isDiagram(); },
    diagramModel: () => diagramDoc?.model?.() || null,
    diagramPlantuml: () => diagramDoc?.plantuml?.() || text,
    diagramSvg: () => lastDiagramSvg,
    zoom: (dir) => (diagramDoc ? diagramDoc.zoom(dir) : zoomer.step(dir)),
    get visible() { return !root.hidden; },
    get hasDocument() { return Boolean(name); },
    get editing() { return editing; },
    get name() { return name; },
    get key() { return key; },
    get text() { return text; },
  };
}
