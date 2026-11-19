// Shared multi-source picker UI for Batch AI Notes and AI Exam Generator.
// Supports: Open document (+ page range), Recents (with search + Drive filter),
// Folders (NoteComplete groups AND disk folders), Local files / folders, and Custom Topics.
import { icon } from './icons.js';
import { cleanTitle, isSupportedSourceName, normalizeSourceKey } from './source-extract.js';

export function createSourcePicker(container, {
  library,
  groups,
  hasOpenDoc = () => false,
  openDocTitle = () => 'Current note',
  openDocPages = () => 0,
  openDocKey = () => '',
  bridge = globalThis.notecompleteFiles,
  allowTopics = true,
  onChange = () => {},
} = {}) {
  const selected = new Map();
  let recentEntries = [];
  let folderList = [];
  let activeTab = 'recents';

  const recentId = (e) => `recent:${normalizeSourceKey(e)}`;
  const isAlreadySelected = ({ key = '', path = '', name = '', size = 0 } = {}) => {
    const openKey = openDocKey?.() || '';
    if (selected.has('open:current') && openKey && key && openKey === key) return true;
    for (const item of selected.values()) {
      const ik = item.entry ? normalizeSourceKey(item.entry) : (item.canonicalKey || '');
      if (key && ik && key === ik) return true;
      if (path && item.entry?.path && path === item.entry.path) return true;
      if (size && name && item.file?.name === name && item.file?.size === size) return true;
      if (!size && name && item.name && !path && !key && item.name.toLowerCase() === name.toLowerCase()) return true;
    }
    return false;
  };

  container.innerHTML = `
    <div class="source-picker">
      <div class="sp-tabs" role="tablist" aria-label="Source type">
        <button type="button" class="sp-tab" data-tab="recents" role="tab" aria-selected="true"></button>
        <button type="button" class="sp-tab" data-tab="folders" role="tab" aria-selected="false"></button>
        <button type="button" class="sp-tab" data-tab="drive" role="tab" aria-selected="false"></button>
        <button type="button" class="sp-tab" data-tab="files" role="tab" aria-selected="false"></button>
        <button type="button" class="sp-tab" data-tab="topics" role="tab" aria-selected="false"${allowTopics ? '' : ' hidden'}></button>
      </div>
      <div class="sp-open-row" hidden>
        <label class="sp-check">
          <input type="checkbox" class="sp-include-open" />
          <span class="sp-open-title"></span>
        </label>
        <input type="text" class="sp-open-range" placeholder="All pages (or e.g. 1-6, 9)" aria-label="Pages from open document" />
      </div>
      <div class="sp-panel" data-panel="recents">
        <div class="sp-search-row">
          <input type="search" class="sp-search" placeholder="Search recent notes, PDFs, HTML…" aria-label="Search recent documents" />
        </div>
        <div class="sp-list sp-recent-list" role="group" aria-label="Recent documents"></div>
      </div>
      <div class="sp-panel" data-panel="folders" hidden>
        <div class="sp-actions-row">
          <button type="button" class="sp-pick-disk-folder"></button>
          <input type="file" class="sp-dir-input" webkitdirectory directory multiple hidden />
        </div>
        <div class="sp-list sp-folder-list" role="group" aria-label="Folders"></div>
      </div>
      <div class="sp-panel" data-panel="drive" hidden>
        <p class="muted sp-hint">Google Drive and Dropbox notes opened or cached on this device appear here and can be combined with any other source.</p>
        <div class="sp-list sp-drive-list" role="group" aria-label="Cloud documents"></div>
      </div>
      <div class="sp-panel" data-panel="files" hidden>
        <div class="sp-actions-row">
          <button type="button" class="sp-pick-files"></button>
          <button type="button" class="sp-pick-files-folder"></button>
          <input type="file" class="sp-file-input" multiple accept=".noteful,.nfedit,.notecomp,.notecomplete,.pdf,.html,.htm,.md,.markdown,.txt,.docx,.odt,.xlsx,.ods,.csv,.tsv,.png,.jpg,.jpeg,.webp" hidden />
        </div>
        <p class="muted sp-hint">Add multiple notes, PDFs, HTML exams, Office docs, Markdown files, or images from disk.</p>
      </div>
      <div class="sp-panel" data-panel="topics" hidden>
        <textarea class="sp-topics-input" rows="4" placeholder="Write one topic per line (e.g., Cache coherence protocols MESI&#10;Pipeline hazards &amp; branch prediction) or paste outline text…" aria-label="Topics or study material"></textarea>
        <div class="sp-actions-row">
          <button type="button" class="sp-add-topics"></button>
        </div>
      </div>
      <div class="sp-selected">
        <div class="sp-selected-head">
          <span class="sp-count muted">0 sources selected</span>
          <button type="button" class="sp-clear" hidden>Clear all</button>
        </div>
        <div class="sp-chips"></div>
      </div>
    </div>
  `;

  const q = (sel) => container.querySelector(sel);
  const setBtn = (btn, iconName, label) => {
    btn.replaceChildren(icon(iconName), document.createTextNode(' ' + label));
  };
  setBtn(q('[data-tab="recents"]'), 'history', 'Recents');
  setBtn(q('[data-tab="folders"]'), 'folder', 'Folders');
  setBtn(q('[data-tab="drive"]'), 'cloud', 'Cloud');
  setBtn(q('[data-tab="files"]'), 'open', 'Local files');
  setBtn(q('[data-tab="topics"]'), 'spark', 'Topics');
  setBtn(q('.sp-pick-disk-folder'), 'folder', 'Choose folder from disk…');
  setBtn(q('.sp-pick-files'), 'plus', 'Choose files…');
  setBtn(q('.sp-pick-files-folder'), 'folder', 'Choose folder from disk…');
  setBtn(q('.sp-add-topics'), 'plus', 'Add topics');
  setBtn(q('.sp-clear'), 'close', 'Clear');

  function syncSummary() {
    const items = list();
    q('.sp-count').textContent = `${items.length} source${items.length === 1 ? '' : 's'} selected`;
    q('.sp-clear').hidden = items.length === 0;
    const chips = q('.sp-chips');
    chips.replaceChildren(...items.map((item) => {
      const chip = document.createElement('span');
      chip.className = 'sp-chip';
      const glyph = item.kind === 'group' ? 'folder' : item.kind === 'topic' ? 'spark' : item.kind === 'open' ? 'note' : 'open';
      chip.append(icon(glyph));
      const label = document.createElement('span');
      label.textContent = item.label || item.name || 'Source';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'sp-chip-rm';
      rm.setAttribute('aria-label', `Remove ${label.textContent}`);
      rm.append(icon('close'));
      rm.onclick = () => {
        selected.delete(item.id);
        if (item.kind === 'open') q('.sp-include-open').checked = false;
        syncCheckboxes();
        syncSummary();
      };
      chip.append(label, rm);
      return chip;
    }));
    onChange(items);
  }

  function syncCheckboxes() {
    for (const input of container.querySelectorAll('input[data-source-id]')) {
      input.checked = selected.has(input.dataset.sourceId);
    }
  }

  function toggleItem(item, checked) {
    if (checked) {
      // Prevent adding the open document twice or re-adding an identical file from Recents vs Drive.
      if (item.kind === 'open') {
        const openKey = openDocKey?.() || '';
        if (openKey) {
          for (const [k, existing] of selected) {
            if (existing.kind === 'recent' && normalizeSourceKey(existing.entry) === openKey) selected.delete(k);
          }
        }
      } else if (item.kind === 'recent') {
        const rk = normalizeSourceKey(item.entry);
        const openKey = openDocKey?.() || '';
        if (selected.has('open:current') && openKey && rk && openKey === rk) {
          syncCheckboxes();
          return;
        }
      }
      selected.set(item.id, item);
    } else {
      selected.delete(item.id);
    }
    syncCheckboxes();
    syncSummary();
  }

  function renderCheckRow(id, label, sublabel, glyph, itemBuilder) {
    const row = document.createElement('label');
    row.className = 'sp-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.sourceId = id;
    cb.checked = selected.has(id);
    cb.onchange = () => toggleItem(itemBuilder(), cb.checked);
    const meta = document.createElement('span');
    meta.className = 'sp-item-meta';
    const title = document.createElement('strong');
    title.textContent = label;
    meta.append(title);
    if (sublabel) {
      const sub = document.createElement('small');
      sub.className = 'muted';
      sub.textContent = sublabel;
      meta.append(sub);
    }
    row.append(cb, icon(glyph), meta);
    return row;
  }

  function renderRecents(filter = '') {
    const term = filter.trim().toLowerCase();
    const listEl = q('.sp-recent-list');
    const items = recentEntries
      .filter((e) => e.source !== 'web' && isSupportedSourceName(e.name || ''))
      .filter((e) => !term || `${e.title || ''} ${e.name || ''}`.toLowerCase().includes(term));
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted sp-empty';
      empty.textContent = term ? 'No matching recent documents.' : 'No recent documents yet.';
      listEl.replaceChildren(empty);
      return;
    }
    listEl.replaceChildren(...items.map((e) => {
      const id = recentId(e);
      const srcLabel = e.source === 'drive' ? 'Drive' : e.source === 'dropbox' ? 'Dropbox' : e.source === 'archive' ? 'Archive' : 'Local';
      const srcIcon = e.source === 'drive' ? 'drive' : e.source === 'dropbox' ? 'cloud' : 'note';
      return renderCheckRow(
        id,
        e.title || cleanTitle(e.name),
        `${srcLabel} · ${e.name}`,
        srcIcon,
        () => ({ id, kind: 'recent', entry: e, canonicalKey: normalizeSourceKey(e), label: e.title || cleanTitle(e.name), name: e.name }),
      );
    }));
  }

  function renderDrive() {
    const listEl = q('.sp-drive-list');
    const items = recentEntries.filter((e) => (e.source === 'drive' || e.source === 'dropbox') && isSupportedSourceName(e.name || ''));
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted sp-empty';
      empty.textContent = 'No Google Drive or Dropbox documents in Recents yet. Open one from Home → Cloud or Recents.';
      listEl.replaceChildren(empty);
      return;
    }
    listEl.replaceChildren(...items.map((e) => {
      const id = recentId(e);
      return renderCheckRow(
        id,
        e.title || cleanTitle(e.name),
        `${e.source === 'dropbox' ? 'Dropbox' : 'Drive'} · ${e.name}`,
        e.source === 'dropbox' ? 'cloud' : 'drive',
        () => ({ id, kind: 'recent', entry: e, canonicalKey: normalizeSourceKey(e), label: e.title || cleanTitle(e.name), name: e.name }),
      );
    }));
  }

  function renderFolders() {
    const listEl = q('.sp-folder-list');
    if (!folderList.length) {
      const empty = document.createElement('p');
      empty.className = 'muted sp-empty';
      empty.textContent = 'No saved folders yet. Use “Choose folder from disk…” above.';
      listEl.replaceChildren(empty);
      return;
    }
    listEl.replaceChildren(...folderList.map((g) => {
      const id = `group:${g.id}`;
      const sub = g.folder ? g.folder : `${(g.members || []).length} item${(g.members || []).length === 1 ? '' : 's'}`;
      const row = renderCheckRow(
        id,
        g.name || 'Folder',
        sub,
        'folder',
        () => ({ id, kind: 'group', group: g, label: `Folder: ${g.name}` }),
      );
      // Disk folders are a history; × forgets one here (the folder on disk is untouched).
      if (g.folder && g.kind !== 'folder' && groups?.delete) {
        const forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'sp-chip-rm sp-forget';
        forget.title = `Remove ${g.name || 'folder'} from this list (the folder on disk is not touched)`;
        forget.setAttribute('aria-label', forget.title);
        forget.append(icon('close'));
        forget.onclick = async (event) => {
          event.preventDefault(); event.stopPropagation();
          await groups.delete(g).catch(() => {});
          selected.delete(id);
          folderList = folderList.filter((x) => x.id !== g.id);
          renderFolders();
          syncSummary();
        };
        row.append(forget);
      }
      return row;
    }));
  }

  async function pickDiskFolder() {
    if (bridge?.openFolder && groups) {
      const chosen = await bridge.openFolder();
      if (!chosen) return;
      const group = await groups.openFolder(chosen);
      folderList = await groups.folders();
      const id = `group:${group.id}`;
      selected.set(id, { id, kind: 'group', group, label: `Folder: ${group.name}` });
      renderFolders();
      syncSummary();
      return;
    }
    q('.sp-dir-input').click();
  }

  async function pickLocalFiles() {
    if (bridge?.pickFiles && library) {
      const picked = await bridge.pickFiles();
      for (const f of picked || []) {
        if (!isSupportedSourceName(f.name)) continue;
        const entry = { key: `local:${f.path}`, source: 'local', path: f.path, name: f.name };
        if (isAlreadySelected({ key: entry.key, path: f.path, name: f.name })) continue;
        const id = recentId(entry);
        selected.set(id, { id, kind: 'recent', entry, canonicalKey: entry.key, label: cleanTitle(f.name), name: f.name });
      }
      syncCheckboxes();
      syncSummary();
      return;
    }
    q('.sp-file-input').click();
  }

  // Event bindings
  for (const btn of container.querySelectorAll('.sp-tab')) {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      for (const b of container.querySelectorAll('.sp-tab')) b.setAttribute('aria-selected', String(b === btn));
      for (const p of container.querySelectorAll('.sp-panel')) p.hidden = p.dataset.panel !== activeTab;
    };
  }
  q('.sp-search').oninput = (e) => renderRecents(e.target.value);
  q('.sp-pick-disk-folder').onclick = pickDiskFolder;
  q('.sp-pick-files-folder').onclick = pickDiskFolder;
  q('.sp-pick-files').onclick = pickLocalFiles;

  q('.sp-file-input').onchange = () => {
    for (const file of q('.sp-file-input').files || []) {
      if (!isSupportedSourceName(file.name)) continue;
      if (isAlreadySelected({ name: file.name, size: file.size })) continue;
      const id = `file:${file.name}:${file.size}:${file.lastModified}`;
      selected.set(id, { id, kind: 'file', file, label: cleanTitle(file.name), name: file.name });
    }
    q('.sp-file-input').value = '';
    syncSummary();
  };

  q('.sp-dir-input').onchange = () => {
    const files = Array.from(q('.sp-dir-input').files || []).filter((f) => isSupportedSourceName(f.name));
    const folderName = files[0]?.webkitRelativePath?.split('/')?.[0] || 'Folder';
    for (const file of files) {
      if (isAlreadySelected({ name: file.name, size: file.size })) continue;
      const id = `file:${folderName}:${file.webkitRelativePath || file.name}:${file.size}`;
      selected.set(id, { id, kind: 'file', file, folderName, label: `${folderName}/${file.name}`, name: file.name });
    }
    q('.sp-dir-input').value = '';
    syncSummary();
  };

  q('.sp-add-topics').onclick = () => {
    const raw = q('.sp-topics-input').value;
    const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    if (lines.length === 1 && raw.length > 180) {
      const id = `topic:${Date.now()}`;
      selected.set(id, { id, kind: 'topic', text: raw.trim(), label: cleanTitle(lines[0]).slice(0, 42) });
    } else {
      for (const line of lines) {
        const id = `topic:${line.toLowerCase()}`;
        selected.set(id, { id, kind: 'topic', text: line, label: line.slice(0, 48) });
      }
    }
    q('.sp-topics-input').value = '';
    syncSummary();
  };

  q('.sp-clear').onclick = () => {
    selected.clear();
    q('.sp-include-open').checked = false;
    syncCheckboxes();
    syncSummary();
  };

  q('.sp-include-open').onchange = (e) => {
    if (e.target.checked && hasOpenDoc()) {
      const range = q('.sp-open-range').value.trim();
      const title = openDocTitle() || 'Current document';
      selected.set('open:current', {
        id: 'open:current',
        kind: 'open',
        range,
        label: range ? `${title} (p. ${range})` : title,
      });
    } else {
      selected.delete('open:current');
    }
    syncSummary();
  };
  q('.sp-open-range').oninput = () => {
    if (!q('.sp-include-open').checked || !selected.has('open:current')) return;
    const range = q('.sp-open-range').value.trim();
    const title = openDocTitle() || 'Current document';
    selected.set('open:current', {
      id: 'open:current',
      kind: 'open',
      range,
      label: range ? `${title} (p. ${range})` : title,
    });
    syncSummary();
  };

  function list() {
    return [...selected.values()];
  }

  async function refresh({ preselectOpen = false } = {}) {
    const open = hasOpenDoc();
    q('.sp-open-row').hidden = !open;
    if (open) {
      const pages = openDocPages();
      q('.sp-open-title').textContent = `Open now: ${openDocTitle()}${pages ? ` (${pages} pages)` : ''}`;
      if (preselectOpen && selected.size === 0) {
        q('.sp-include-open').checked = true;
        selected.set('open:current', {
          id: 'open:current',
          kind: 'open',
          range: q('.sp-open-range').value.trim(),
          label: openDocTitle() || 'Current document',
        });
      }
    } else {
      selected.delete('open:current');
      q('.sp-include-open').checked = false;
    }

    recentEntries = (await library?.recent?.(80).catch(() => [])) || [];
    folderList = (await groups?.folders?.().catch(() => [])) || [];
    renderRecents(q('.sp-search').value || '');
    renderDrive();
    renderFolders();
    syncCheckboxes();
    syncSummary();
  }

  return { refresh, list, clear: () => q('.sp-clear').click() };
}
