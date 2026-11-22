// The archive window: what a .zip, .tar, .tar.gz/.tgz or .gz holds, as a tree (names, sizes,
// dates), each entry marked intact or not, with a summary at the top. It floats beside the
// document (data-window), so entries can be opened one after another. Nested archives open in
// the same window, with a path back at the top. The reading and checking is archive.js.
import { icon } from './icons.js';
import {
  readArchive, extractEntry, archiveTree, formatSize, typeLabel, formatLabel, looksLikeGoodnotes,
  notebookTitle, packFolder,
} from './archive.js';
import { zipFiles } from './zip.js';

const KIND_ICON = { note: 'note', pdf: 'pdfBg', image: 'image', html: 'code', audio: 'headphones', video: 'video', office: 'text', text: 'text', archive: 'archive' };
const BAD = new Set(['damaged', 'unsafe']);
const STATUS_TEXT = { ok: 'Intact', damaged: 'Damaged', encrypted: 'Encrypted', unsupported: 'Not checked', unsafe: 'Unsafe name', refused: 'Not unpacked', unchecked: 'Not checked' };

// `open(file, title)`: opens an entry as a document (false when it was not); `save(bytes, name)`.
export function archiveView({ $ = (id) => document.getElementById(id), open, save, status = () => {} }) {
  const dlg = $('zipWindow');
  let stack = [], controller = null, expanded = new Set(), filter = '';
  const top = () => stack[stack.length - 1];
  const dateText = (d) => (d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  function crumbs() {
    const box = $('zipCrumbs');
    box.replaceChildren(...stack.flatMap((level, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'zip-crumb'; b.textContent = level.name;
      b.disabled = i === stack.length - 1;
      b.onclick = () => { stack = stack.slice(0, i + 1); render(); };
      return i ? [Object.assign(document.createElement('span'), { className: 'zip-sep', textContent: '›' }), b] : [b];
    }));
  }
  function summary() {
    const level = top(), box = $('zipSummary');
    box.replaceChildren();
    box.className = 'zip-summary';
    if (!level.archive) {
      box.classList.add('busy');
      box.append(level.progress || 'Checking…');
      return;
    }
    const s = level.archive.summary;
    box.classList.add(s.broken ? 'bad' : s.ok ? 'ok' : 'warn');
    box.append(icon(s.ok ? 'check' : 'warn'));
    const text = document.createElement('span');
    text.textContent = `${formatLabel[level.archive.format] || ''} · ${s.text}`;
    box.append(text);
    if (s.problems.length) {
      const more = document.createElement('small');
      more.textContent = s.problems.join(' ');
      box.append(more);
    }
  }
  function row(node, depth) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    const line = document.createElement('div');
    line.className = 'zip-row marquee-host';
    line.style.setProperty('--depth', depth);
    const e = node.entry, level = top();
    const notebookFolder = node.dir && looksLikeGoodnotes(level.archive.entries, node.path);
    const folder = node.dir && !notebookFolder;
    if (folder) {
      const open = expanded.has(node.path) || !!filter;
      li.setAttribute('aria-expanded', String(open));
      const caret = document.createElement('button');
      caret.type = 'button'; caret.className = 'zip-caret'; caret.setAttribute('aria-label', open ? 'Collapse' : 'Expand');
      caret.append(icon(open ? 'arrowDown' : 'arrowRight'));
      caret.onclick = () => { open ? expanded.delete(node.path) : expanded.add(node.path); render(); };
      line.append(caret);
      line.ondblclick = caret.onclick;
    } else line.append(Object.assign(document.createElement('span'), { className: 'zip-caret' }));
    const opens = notebookFolder ? 'note' : e?.opens || '';
    line.append(icon(folder ? 'folder' : KIND_ICON[opens] || 'note'));
    const name = document.createElement('span');
    name.className = 'zip-name marquee';
    name.textContent = node.name;
    name.title = node.path;
    line.append(name);
    const type = document.createElement('span');
    type.className = 'zip-type';
    type.textContent = folder ? `${node.files} file${node.files === 1 ? '' : 's'}` : notebookFolder ? 'Goodnotes notebook (folder)' : e.kind === 'link' ? 'Link' : typeLabel(node.name);
    line.append(type);
    const size = document.createElement('span');
    size.className = 'zip-size';
    size.textContent = folder || e?.kind === 'link' ? (folder ? formatSize(node.size) : '') : formatSize(notebookFolder ? node.size : e.size);
    line.append(size);
    const date = document.createElement('span');
    date.className = 'zip-date';
    date.textContent = dateText(e?.date);
    line.append(date);
    const mark = document.createElement('span');
    mark.className = 'zip-mark';
    if (folder) {
      if (node.bad) { mark.classList.add('bad'); mark.append(icon('warn')); mark.title = `${node.bad} damaged inside`; }
    } else if (!notebookFolder && e.kind === 'file') {
      const bad = BAD.has(e.status), ok = e.status === 'ok';
      mark.classList.add(bad ? 'bad' : ok ? 'ok' : 'warn');
      mark.append(icon(ok ? 'check' : 'warn'));
      mark.title = e.problem || STATUS_TEXT[e.status] || e.status;
      mark.setAttribute('aria-label', STATUS_TEXT[e.status] || e.status);
      if (!ok) line.title = e.problem;
    }
    line.append(mark);
    const actions = document.createElement('span');
    actions.className = 'zip-actions';
    if (opens) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'zip-open'; b.textContent = 'Open';
      b.onclick = () => (notebookFolder ? openFolderNotebook(node) : openEntry(e));
      actions.append(b);
      line.ondblclick = b.onclick;
      line.classList.add('opens');
    } else if (!folder) line.classList.add('off');
    if (!folder && !notebookFolder && e.kind === 'file' && !['unsafe', 'encrypted', 'unsupported', 'damaged'].includes(e.status)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'icon-button zip-save'; b.title = `Save ${node.name}…`; b.setAttribute('aria-label', `Save ${node.name}`);
      b.append(icon('import'));
      b.onclick = () => saveEntry(e);
      actions.append(b);
    }
    line.append(actions);
    li.append(line);
    if (folder && (expanded.has(node.path) || filter)) {
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'group');
      ul.append(...node.children.filter(visible).map((c) => row(c, depth + 1)));
      li.append(ul);
    }
    return li;
  }
  const visible = (node) => !filter || node.path.toLowerCase().includes(filter) || (node.dir && node.children.some(visible));
  function render() {
    crumbs();
    summary();
    const level = top(), list = $('zipTree');
    if (!level.archive) { list.replaceChildren(); return; }
    level.tree ||= archiveTree(level.archive.entries);
    list.replaceChildren(...level.tree.children.filter(visible).map((c) => row(c, 0)));
    $('zipEmpty').hidden = !!level.tree.children.length;
  }
  async function check(level) {
    controller?.abort();
    const c = controller = new AbortController();
    try {
      level.archive = await readArchive(level.bytes, {
        name: level.name, signal: c.signal,
        onProgress: (done, total) => { level.progress = `Checking… ${Math.round((done / Math.max(1, total)) * 100)}%`; if (top() === level) summary(); },
      });
      level.bytes = null; // kept by the archive itself
      // Small archives open with every folder shown; big ones with their first level.
      expanded = new Set();
      const dirs = level.archive.entries.length <= 80;
      if (dirs) for (const e of level.archive.entries) { const parts = e.path.split('/'); for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/')); }
    } catch (error) {
      if (c.signal.aborted) return;
      stack.pop();
      status(error.message, true);
      if (!stack.length) { dlg.close(); return; }
    }
    if (top() === level || !stack.length) render();
  }
  // Opens an archive file: `bytes` (Uint8Array) named `name`; a nested one is added to the path.
  async function show(bytes, name, { nested = false } = {}) {
    if (!nested) stack = [];
    const level = { name, bytes, archive: null, tree: null, progress: 'Checking…' };
    stack.push(level);
    filter = ''; $('zipFilter').value = '';
    $('zipTitle').textContent = stack[0].name;
    if (!dlg.open) dlg.showModal();
    render();
    await check(level);
  }
  const titleOf = (path) => `${stack.map((l) => l.name).join(' › ')} › ${path}`;
  async function entryBytes(entry) {
    status(`Unpacking ${entry.name}…`);
    return extractEntry(top().archive, entry);
  }
  async function openEntry(entry) {
    try {
      const bytes = await entryBytes(entry);
      if (entry.opens === 'archive') {
        // A zipped Goodnotes notebook opens as the notebook; other archives in this window.
        const inner = await readArchive(bytes, { name: entry.name, verify: false }).catch(() => null);
        if (inner && inner.format === 'zip' && looksLikeGoodnotes(inner.entries)) {
          return void (await open(new File([bytes], `${notebookTitle(entry.name)}.goodnotes`), titleOf(entry.path)));
        }
        status(`${entry.name}: inside ${top().name}.`);
        return void (await show(bytes, entry.name, { nested: true }));
      }
      await open(new File([bytes], entry.name), titleOf(entry.path));
    } catch (error) { status(error.message, true); }
  }
  async function openFolderNotebook(node) {
    try {
      status(`Packing ${node.name}…`);
      const bytes = await packFolder(top().archive, node.path, { zipFiles, onProgress: (d, t) => status(`Packing ${node.name}… ${Math.round((d / Math.max(1, t)) * 100)}%`) });
      await open(new File([bytes], `${notebookTitle(node.name)}.goodnotes`), titleOf(node.path));
    } catch (error) { status(error.message, true); }
  }
  async function saveEntry(entry) {
    try {
      const bytes = await entryBytes(entry);
      await save(bytes, entry.name);
    } catch (error) { status(error.message, true); }
  }
  $('zipFilter').oninput = () => { filter = $('zipFilter').value.trim().toLowerCase(); render(); };
  $('zipX').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { controller?.abort(); stack = []; $('zipTree').replaceChildren(); });
  return {
    show,
    get open() { return dlg.open; },
    // For tests and the e2e: the archive on screen.
    get current() { return top()?.archive || null; },
  };
}
