// Reader and editor for text files. Markdown (with LaTeX) is rendered by the core and KaTeX,
// as in the Notes panel; other text is shown as written, source code (.java, .py, .sh…)
// coloured by its language. Edit opens TinyMDE for Markdown (loaded on first use, like the
// Notes editor), a code editor for source code (code-highlight.js) or a plain editor for other
// text; the app saves the result (onChange reports every edit).
import { renderMarkdown } from './rich-text.js';
import { highlight, langFromName, codeEditor } from './code-highlight.js';
import { attachIme, zhButton } from './chinese/ime.js';
import { fieldMode, setFieldMode } from './chinese/settings.js';
import { rubyOn, setRuby, rubyElement } from './chinese/ruby.js';
import { decorateTinyMdeLines, attachMarkdownPrefabContextMenu } from './markdown-prefab.js';

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
// tablePage(info): where a rendered table can go as a page table, tableNotify(message, error):
// a word after a table's copy (table-filter.js attachTableFilters says more).
export function textViewer({ root, body, editorHost, title, format, edit, ruby = null, split = null, zoom, editorZoom = null, toHtml, loadEditor, onChange = () => {}, openLink = () => {}, imageUrl = null, diagram = null, editPrefab = null, tablePage = null, tableNotify = () => {} }) {
  let text = '', name = '', key = '', markdown = false, renders = 0, editing = false, splitPreview = false, mde = null, code = null, ime = null, mount = 0, splitTimer = 0, diagramUrl = '', diagramDoc = null, lastDiagramSvg = '', diagramBar = null, helpSheet = null;
  attachMarkdownPrefabContextMenu({
    editorContainer: editorHost,
    previewContainer: body,
    getText: () => text,
    setText: (next) => {
      if (mde?.editor) {
        mde.editor.setContent(next);
        requestAnimationFrame(() => decorateTinyMdeLines(editorHost?.querySelector('.TinyMDE')));
      }
      const area = editorHost?.querySelector('textarea.doc-editor-plain');
      if (area) area.value = next;
      changed(next);
      if (!editing || splitPreview) render();
    },
    editPrefab,
  });
  const rubyBtn = ruby || root?.querySelector?.('#textRubyToggle') || null;
  const splitBtn = split || root?.querySelector?.('#textSplitToggle') || null;
  const zhSlotEl = root?.querySelector?.('#textZhSlot') || null;
  const zhOptionsEl = root?.querySelector?.('#textZhOptions') || null;
  const traceBtn = root?.querySelector?.('#textTraceBtn') || null;
  const helpBtn = root?.querySelector?.('#textHelpBtn') || null;
  const zhKey = () => `zh-md-${key || 'draft'}`;
  const currentZhMode = () => ime?.mode || fieldMode(zhKey()) || 'off';
  const syncRubyBtn = () => { if (rubyBtn) rubyBtn.setAttribute('aria-pressed', String(rubyOn())); };
  if (rubyBtn) rubyBtn.onclick = () => { setRuby(!rubyOn()); syncRubyBtn(); };
  globalThis.addEventListener?.('zh-ruby-refresh', syncRubyBtn);
  const zhToggle = edit?.parentElement ? zhButton(() => mde?.editor ? editorHost?.querySelector('.TinyMDE') : editorHost?.querySelector('textarea.doc-editor-plain')) : null;
  if (zhToggle) {
    if (zhSlotEl) zhSlotEl.prepend(zhToggle);
    else if (zhOptionsEl && zhOptionsEl.parentElement === edit.parentElement) zhOptionsEl.before(zhToggle);
    else edit.before(zhToggle);
  }
  const syncZhBar = () => {
    const mode = currentZhMode();
    const isZh = mode !== 'off';
    if (zhToggle) {
      zhToggle.hidden = false;
      zhToggle.textContent = '中';
      zhToggle.setAttribute('aria-pressed', String(isZh));
      zhToggle.dataset.zhMode = mode;
    }
    // 拼 (pinyin over characters) is there whenever the text has Chinese, to read it; 笔 (trace)
    // only while typing Chinese.
    if (zhOptionsEl) zhOptionsEl.hidden = !isZh && !/\p{Script=Han}/u.test(text || '');
    if (traceBtn) traceBtn.hidden = !isZh;
  };
  if (zhToggle) {
    zhToggle.addEventListener('click', () => {
      if (!ime) {
        const next = currentZhMode() === 'hanzi' ? 'off' : 'hanzi';
        setFieldMode(zhKey(), next);
      }
      syncZhBar();
    });
  }
  async function insertMarkdownSnippet(snippet) {
    if (!snippet) return;
    if (!editing) await startEditing();
    const area = editorHost?.querySelector('textarea.doc-editor-plain');
    if (mde?.editor) {
      const sel = globalThis.getSelection?.();
      if (sel?.rangeCount && !sel.isCollapsed && editorHost?.contains(sel.anchorNode)) {
        sel.collapseToEnd();
      }
      mde.editor.paste(snippet);
      requestAnimationFrame(() => decorateTinyMdeLines(editorHost?.querySelector('.TinyMDE')));
    } else if (area) {
      const pos = Math.max(area.selectionStart ?? area.value.length, area.selectionEnd ?? area.value.length);
      area.setRangeText(snippet, pos, pos, 'end');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      changed(`${text}${snippet}`);
    }
  }
  async function insertTraceForSelected() {
    let selected = '';
    let hasExplicitSelection = false;
    const area = editorHost?.querySelector('textarea.doc-editor-plain');
    if (area && area.selectionStart !== area.selectionEnd) {
      selected = area.value.slice(area.selectionStart, area.selectionEnd);
      hasExplicitSelection = true;
    } else {
      selected = globalThis.getSelection?.()?.toString?.() || '';
      hasExplicitSelection = Boolean(selected);
    }
    let han = ([...selected].filter((c) => /\p{Script=Han}/u.test(c))).slice(0, 12).join('');
    if (hasExplicitSelection && !han) {
      return;
    }
    if (!han) {
      // Fallback: last Chinese characters in the document
      const allHan = text.match(/\p{Script=Han}+/gu);
      han = allHan?.at(-1)?.slice(0, 6) || '';
    }
    if (!han) return;
    if (editPrefab) {
      const chosen = await editPrefab({ type: 'hanzi', text: han, show: 'steps', grid: 'mi', outline: true });
      if (chosen) await insertTraceSpec(chosen);
      return;
    }
    const { markdownTraceBlockFor } = await import('./chinese/zh-menu.js');
    const block = await markdownTraceBlockFor(han);
    if (block) await insertMarkdownSnippet(block);
  }
  async function insertTraceSpec(spec) {
    const han = ([...String(spec?.text ?? '')].filter((c) => /\p{Script=Han}/u.test(c))).slice(0, 12).join('');
    if (!han) return;
    const { markdownPrefabBlockForSpec } = await import('./chinese/zh-menu.js');
    const block = await markdownPrefabBlockForSpec({ ...spec, type: 'hanzi', text: han, show: spec?.show || 'steps' });
    if (block) await insertMarkdownSnippet(`\n\n${block}\n`);
  }
  if (traceBtn) {
    traceBtn.onclick = () => { insertTraceForSelected().catch((e) => console.warn(e)); };
  }
  if (helpBtn && root) {
    helpBtn.onclick = async () => {
      if (!helpSheet) {
        const { cheatSheet } = await import('./cheat-sheet.js');
        helpSheet = cheatSheet(root, {
          key: 'markdown-editor',
          title: 'Markdown & Chinese Cheat Sheet',
          sections: [
            { title: 'Markdown formatting', icon: 'note', rows: [
              { keys: '#  ##  ###', does: 'Headings (level 1, 2, 3)' },
              { keys: '**bold**  *italic*', does: 'Bold and italic text' },
              { keys: '$x^2$  $$\\int f(x)dx$$', does: 'Inline and display LaTeX math formulas' },
              { keys: '- item  1. item', does: 'Bullet and numbered lists' },
              { keys: '`code`  ```lang', does: 'Inline code and fenced code blocks' },
            ] },
            { title: 'Chinese input, pinyin & stroke order', icon: 'draw', rows: [
              { keys: '中 / Ctrl Shift Space', does: 'Toggle Chinese mode (Hanzi / Pinyin tones / Latin) and show Pinyin & Trace tools' },
              { keys: '拼', does: 'Show or hide Pinyin ruby annotations above Chinese characters' },
              { keys: '笔', does: 'Highlight Chinese characters and click 笔 to insert their stroke order (with English meaning & variants)' },
              { keys: 'Right-click character', does: 'See English equivalent, Simplified/Traditional variants, and open the stroke order editor' },
            ] },
            { title: 'Document shortcuts', icon: 'keyboard', rows: [
              { keys: 'Ctrl S', does: 'Save changes' },
              { keys: 'Ctrl F', does: 'Find in document' },
            ] },
          ],
        });
      }
      helpSheet.toggle();
    };
  }
  const editorZoomEl = root?.querySelector?.('#textEditorZoom') || null;
  const previewZoomEl = root?.querySelector?.('#textZoomGroup') || null;
  const splitHandle = root?.querySelector?.('#textSplitResize') || null;
  const SPLIT_RATIO_KEY = 'notecomplete-text-split-ratio';
  const setSplitRatio = (pct, persist = false) => {
    const clamped = Math.max(15, Math.min(85, Math.round(Number(pct) * 10) / 10));
    root?.style?.setProperty?.('--split-editor-basis', `${clamped}%`);
    if (persist) { try { localStorage.setItem(SPLIT_RATIO_KEY, String(clamped)); } catch { /* Optional. */ } }
  };
  try { const savedRatio = Number(localStorage.getItem(SPLIT_RATIO_KEY)); if (savedRatio >= 15 && savedRatio <= 85) setSplitRatio(savedRatio); } catch { /* Optional. */ }
  if (splitHandle) {
    splitHandle.addEventListener('pointerdown', (down) => {
      if (down.button !== 0 || !root?.classList?.contains('split-preview')) return;
      down.preventDefault();
      const sideBody = splitHandle.parentElement;
      if (!sideBody) return;
      splitHandle.setPointerCapture?.(down.pointerId);
      splitHandle.classList.add('dragging');
      const stacked = getComputedStyle(sideBody).flexDirection === 'column';
      let lastPct = 50;
      const move = (e) => {
        if (e.pointerId !== down.pointerId) return;
        const rect = sideBody.getBoundingClientRect();
        const groupEl = sideBody.querySelector('.group-panel');
        const groupW = !stacked && groupEl && !sideBody.classList.contains('group-off') ? groupEl.getBoundingClientRect().width : 0;
        const avail = stacked ? rect.height : Math.max(1, rect.width - groupW);
        const pos = stacked ? (e.clientY - rect.top) : (e.clientX - rect.left - groupW);
        lastPct = Math.max(15, Math.min(85, (pos / avail) * 100));
        setSplitRatio(lastPct);
      };
      const up = (e) => {
        if (e?.pointerId !== undefined && e.pointerId !== down.pointerId) return;
        splitHandle.removeEventListener('pointermove', move);
        splitHandle.removeEventListener('pointerup', up);
        splitHandle.removeEventListener('pointercancel', up);
        splitHandle.classList.remove('dragging');
        setSplitRatio(lastPct, true);
      };
      splitHandle.addEventListener('pointermove', move);
      splitHandle.addEventListener('pointerup', up);
      splitHandle.addEventListener('pointercancel', up);
    });
    splitHandle.addEventListener('dblclick', () => setSplitRatio(50, true));
  }
  const syncSplitLayout = () => {
    const canSplit = Boolean(editing && markdown && !isDiagram());
    const inSplit = Boolean(canSplit && splitPreview);
    if (splitBtn) {
      splitBtn.hidden = !canSplit;
      splitBtn.setAttribute('aria-pressed', String(inSplit));
    }
    root?.classList?.toggle('split-preview', inSplit);
    root?.classList?.toggle('text-markdown-edit', canSplit);
    if (inSplit) body.hidden = false;
    else if (editing) body.hidden = true;
    // Show independent Edit & View zoom controls in Split mode, or just the active pane's zoom otherwise.
    if (editorZoomEl) editorZoomEl.hidden = !editing;
    if (previewZoomEl) previewZoomEl.hidden = editing && !inSplit;
  };
  if (splitBtn) {
    splitBtn.onclick = () => {
      splitPreview = !splitPreview;
      syncSplitLayout();
      if (editing && splitPreview) render();
    };
  }
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
  const zoomer = zoomControl({ ...zoom, key: 'notecomplete-text-preview-zoom', apply: (z) => { root.style.setProperty('--text-preview-zoom', String(z)); root.style.setProperty('--text-zoom', String(z)); } });
  const editorZoomer = editorZoom
    ? zoomControl({ ...editorZoom, key: 'notecomplete-text-editor-zoom', apply: (z) => root.style.setProperty('--text-editor-zoom', String(z)) })
    : zoomer;
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
    if ((!event.ctrlKey && !event.metaKey) || diagramDoc) return;
    event.preventDefault();
    zoomer.step(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  editorHost?.addEventListener?.('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    editorZoomer.step(event.deltaY < 0 ? 1 : -1);
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
    // Tables get a filter bar and sorting (view only), and Put on page (table-filter.js).
    if (body.querySelector('table')) {
      import('./table-filter.js').then(({ attachTableFilters }) => { if (token === renders) attachTableFilters(body, { pageMenu: tablePage, notify: tableNotify }); }).catch(() => {});
    }
    // Pinyin over the Chinese where it now is (chinese/ruby.js), kept registered for live toggles.
    if (/\p{Script=Han}/u.test(text)) rubyElement(body).catch(() => {});
  }
  function changed(next) {
    text = next;
    onChange(text);
    if (editing && splitPreview && markdown && !isDiagram()) {
      clearTimeout(splitTimer);
      splitTimer = setTimeout(() => { if (editing && splitPreview) render(); }, 120);
    }
  }
  // The editor follows MD: with it, TinyMDE (formatting toolbar) for any text file; without, plain.
  function unmount() {
    mount++;
    clearTimeout(splitTimer);
    ime?.detach?.();
    ime = null;
    syncZhBar();
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
    editorHost.hidden = false;
    syncSplitLayout();
    unmount();
    const mine = mount;
    const wireIme = (target, insert = null) => {
      if (!target || !zhToggle) return;
      zhToggle.hidden = false;
      ime = attachIme(target, {
        kind: insert ? 'contenteditable' : 'textarea',
        ...(insert ? { insert } : {}),
        getMode: () => fieldMode(zhKey()),
        setMode: (m) => { setFieldMode(zhKey(), m); syncZhBar(); },
      });
      ime.addButton(zhToggle);
      syncZhBar();
    };
    if (markdown && loadEditor && !isDiagram()) {
      const TinyMDE = await loadEditor();
      if (!editing || mine !== mount) return;
      const commands = document.createElement('div'), area = document.createElement('div');
      // The Notes panel's classes, so TinyMDE follows the app theme the same way.
      commands.className = 'notes-commands';
      area.className = 'notes-editor';
      editorHost.append(commands, area);
      const { MARKDOWN_COMMANDS, MARKDOWN_GRAMMAR } = await import('./notes.js');
      const editor = new TinyMDE.Editor({ ...MARKDOWN_GRAMMAR, element: area, content: text, placeholder: 'Write Markdown here (# heading, **bold**, ==highlight==, $math$, - list)…' });
      const bar = new TinyMDE.CommandBar({ element: commands, editor, commands: MARKDOWN_COMMANDS });
      const markEditorLines = () => decorateTinyMdeLines(area.querySelector('.TinyMDE'));
      editor.addEventListener('change', (event) => {
        changed(event.content);
        requestAnimationFrame(markEditorLines);
      });
      mde = { editor, bar };
      markEditorLines();
      wireIme(area.querySelector('.TinyMDE'), (t) => editor.paste(t));
      area.querySelector('.TinyMDE')?.focus?.();
    } else if (!markdown && codeLang() && text.length <= CODE_LIMIT) {
      // Source code: coloured as it is typed; Tab indents, Enter keeps the indentation. The
      // textarea keeps the plain editor's class, so Find in the document works the same.
      code = codeEditor(editorHost, { value: text, lang: codeLang(), onChange: changed, className: 'doc-code', inputClass: 'doc-editor-plain', label: name || 'Code' });
      wireIme(editorHost.querySelector('textarea.doc-editor-plain'));
      code.focus();
    } else {
      const area = document.createElement('textarea');
      area.className = 'doc-editor-plain';
      area.spellcheck = false;
      area.value = text;
      area.oninput = () => changed(area.value);
      editorHost.append(area);
      wireIme(area);
      area.focus();
    }
    if (splitPreview) render();
  }
  function stopEditing() {
    if (!editing) return;
    editing = false;
    unmount();
    editorHost.hidden = true;
    body.hidden = false;
    syncSplitLayout();
    edit.setAttribute('aria-pressed', 'false');
    render();
  }
  // MD on or off is remembered per file on this device.
  const remembered = (k, fallback) => { try { const v = localStorage.getItem(`notecomplete-text-md:${k}`); return v === null ? fallback : v === '1'; } catch { return fallback; } };
  format.onclick = () => {
    markdown = !markdown;
    try { if (key) localStorage.setItem(`notecomplete-text-md:${key}`, markdown ? '1' : '0'); } catch { /* Optional. */ }
    format.setAttribute('aria-pressed', String(markdown));
    syncSplitLayout();
    if (editing) startEditing(); else render();
  };
  edit.onclick = () => (editing ? stopEditing() : startEditing());
  return {
    // Markdown files start formatted, other text as written, until MD is switched for that file.
    open({ text: content, name: shown, markdown: formatted, key: id = shown, edit: openEdit = false, split: openSplit = false }) {
      stopEditing();
      text = content; name = shown; key = id; markdown = openEdit && formatted ? true : remembered(id, formatted);
      splitPreview = Boolean(openSplit);
      labelFormat();
      syncRubyBtn();
      syncZhBar();
      if (title) title.textContent = shown;
      root.hidden = false;
      body.scrollTop = 0;
      return openEdit ? startEditing() : render();
    },
    insertTraceSpec,
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
    close() { stopEditing(); helpSheet?.destroy?.(); helpSheet = null; renders++; dropDiagramDoc(); releaseDiagram(); root.hidden = true; body.replaceChildren(); text = ''; name = ''; },
    get diagram() { return isDiagram(); },
    diagramModel: () => diagramDoc?.model?.() || null,
    diagramPlantuml: () => diagramDoc?.plantuml?.() || text,
    diagramSvg: () => lastDiagramSvg,
    zoom: (dir) => {
      if (diagramDoc) return diagramDoc.zoom(dir);
      const inEditor = editing && (!splitPreview || editorHost?.contains?.(document.activeElement));
      return (inEditor ? editorZoomer : zoomer).step(dir);
    },
    get visible() { return !root.hidden; },
    get hasDocument() { return Boolean(name); },
    get editing() { return editing; },
    get name() { return name; },
    get key() { return key; },
    get text() { return text; },
  };
}
