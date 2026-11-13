import { ArchiveClient, PRELOADED_ARCHIVE, archiveId, archiveListing } from './archive-client.js';
import { TYPES } from './note-facts.js';
import { addExportMenu, exportable } from './download-queue.js';
import { queueButton, markQueueDone, selectionCheck, updateQueueControls as queueControls } from './queue-controls.js';

function documentCoverSvg(name) {
  const isPdf = /\.pdf$/i.test(name);
  const color = isPdf ? '#d9534f' : '#2b6cb0';
  const label = isPdf ? 'PDF' : (name.split('.').pop() || 'DOC').toUpperCase().slice(0, 4);
  const baseName = name.replace(/\.[^.]+$/, '').trim();
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const title = esc(baseName.slice(0, 36));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240"><rect width="320" height="240" fill="#f8fafc"/><rect x="48" y="24" width="224" height="192" rx="8" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/><rect x="68" y="44" width="46" height="20" rx="4" fill="${color}" fill-opacity="0.12"/><text x="91" y="58" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="${color}" text-anchor="middle">${label}</text><text x="68" y="98" font-family="system-ui, sans-serif" font-size="13" font-weight="600" fill="#1e2433">${title}</text><rect x="68" y="122" width="160" height="6" rx="3" fill="#eef2f6"/><rect x="68" y="138" width="130" height="6" rx="3" fill="#eef2f6"/><rect x="68" y="154" width="145" height="6" rx="3" fill="#eef2f6"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function archiveBrowser({ open, client = new ArchiveClient(), library = null, queue = null, exportRequest = null }) {
  const $ = id => document.getElementById(id);
  const key = 'notecomplete-archive-sources-v1', lastKey = 'notecomplete-archive-last-v1';
  let added = [];
  try { added = (JSON.parse(localStorage.getItem(key)) || []).filter(s => archiveId(s?.id)); } catch { /* Optional. */ }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(added)); } catch { /* Optional. */ } };
  const sources = () => [...PRELOADED_ARCHIVE, ...added.filter(s => !PRELOADED_ARCHIVE.some(p => p.id === s.id))];

  let currentRepo = null, itemData = null, trail = [], controller = null, busy = false, visible = false;
  let filterText = '';
  let selectingQueue = false;
  const selectedDocs = new Set();

  const message = (text, error = false) => {
    const el = $('archiveStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', error);
  };
  const mb = size => `${(Number(size) / 1048576).toFixed(1)} MB`;
  function cancel() {
    controller?.abort();
    controller = null;
    busy = false;
    if ($('archiveProgress')) $('archiveProgress').hidden = true;
  }

  function renderRepositories() {
    const list = sources();
    $('archiveRepoView').hidden = false;
    $('archiveFileView').hidden = true;
    $('archiveBack').hidden = true;
    $('archiveFolderUp').hidden = true;
    $('archiveTitle').textContent = 'Internet Archive';

    const cards = list.map(source => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-card archive-source-card';

      const cover = document.createElement('img');
      cover.className = 'note-cover';
      cover.alt = '';
      cover.loading = 'lazy';
      cover.crossOrigin = 'anonymous';
      cover.src = `https://archive.org/services/img/${encodeURIComponent(source.id)}`;
      cover.onerror = () => { cover.src = documentCoverSvg(source.title || source.id); };

      const meta = document.createElement('div');
      meta.className = 'note-meta';
      const name = document.createElement('strong');
      name.textContent = source.title || source.id;
      name.title = source.title ? `${source.title}\nID: ${source.id}` : source.id;
      const detail = document.createElement('span');
      detail.textContent = `archive.org/details/${source.id}`;
      const badge = document.createElement('span');
      badge.className = 'note-badge';
      badge.textContent = 'Repository';
      meta.append(name, detail, badge);

      button.append(cover, meta);
      button.onclick = () => openRepo(source.id);
      li.append(button);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'note-more';
      remove.textContent = '×';
      remove.title = `Remove ${source.title || source.id}`;
      remove.setAttribute('aria-label', remove.title);
      remove.onclick = (e) => {
        e.stopPropagation();
        added = added.filter(s => s.id !== source.id);
        save();
        renderRepositories();
      };
      li.append(remove);

      return li;
    });

    $('archiveRepoList').replaceChildren(...cards);
  }

  function renderListing() {
    if (!itemData) return;
    $('archiveRepoView').hidden = true;
    $('archiveFileView').hidden = false;
    $('archiveBack').hidden = false;
    $('archiveFolderUp').hidden = trail.length === 0;

    const pathText = [itemData.title, ...trail].join(' / ');
    $('archivePath').textContent = pathText;
    $('archivePath').title = pathText;

    const { folders, documents } = archiveListing(itemData.files, trail);
    const filter = filterText.trim().toLowerCase();
    const visibleFolders = filter ? folders.filter(f => f.toLowerCase().includes(filter)) : folders;
    const visibleDocs = filter ? documents.filter(d => d.name.toLowerCase().includes(filter)) : documents;

    const fragment = document.createDocumentFragment();

    for (const folderName of visibleFolders) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'folder-chip';
      const meta = document.createElement('div');
      meta.className = 'note-meta';
      const name = document.createElement('strong');
      name.textContent = folderName;
      const detail = document.createElement('span');
      detail.textContent = 'Folder';
      meta.append(name, detail);
      b.append(meta);
      b.onclick = () => {
        trail = [...trail, folderName];
        selectingQueue = false;
        selectedDocs.clear();
        renderListing();
      };
      li.append(b);
      fragment.append(li);
    }

    for (const doc of visibleDocs) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'note-card';
      // What the home filters and sort look at.
      b.note = { name: doc.name, modified: Date.parse(doc.modifiedTime) || 0, size: Number(doc.size) || 0, facts: null };

      const cover = document.createElement('img');
      cover.className = 'note-cover';
      cover.alt = '';
      cover.loading = 'lazy';
      cover.src = documentCoverSvg(doc.name);

      const meta = document.createElement('div');
      meta.className = 'note-meta';
      const name = document.createElement('strong');
      name.textContent = doc.name;
      name.title = doc.name;

      const dateStr = doc.modifiedTime ? new Date(doc.modifiedTime).toLocaleDateString() : '';
      const sizeStr = doc.size ? mb(doc.size) : '';
      const detail = document.createElement('span');
      detail.textContent = [dateStr, sizeStr].filter(Boolean).join(' · ') || 'Internet Archive';

      meta.append(name, detail);

      const hit = Object.entries(TYPES).find(([, [, re]]) => re.test(doc.name || ''))?.[1][0] || 'File';
      const badge = document.createElement('span');
      badge.className = 'note-badge';
      badge.textContent = hit;
      meta.append(badge);

      const docKey = doc.path || doc.name;
      const isSelected = selectedDocs.has(docKey);
      if (isSelected) b.classList?.add?.('is-selected');

      const check = selectionCheck();

      b.append(cover, meta, check);
      b.onclick = () => {
        if (selectingQueue) {
          if (selectedDocs.has(docKey)) {
            selectedDocs.delete(docKey);
            b.classList?.remove?.('is-selected');
          } else {
            selectedDocs.add(docKey);
            b.classList?.add?.('is-selected');
          }
          updateQueueControls(visibleDocs);
        } else {
          chooseDoc(doc);
        }
      };
      li.append(b);
      if (exportRequest && exportable(doc.name)) addExportMenu(li, { label: doc.name, pick: (kind) => { Object.assign(exportRequest, { kind, key: `archive:${currentRepo}:${doc.path || doc.name}` }); chooseDoc(doc); } });

      if (queue) {
        const qBtn = queueButton({
          queue,
          id: `archive:${currentRepo}:${doc.path || doc.name}`,
          item: () => ({ source: 'archive', sourceId: currentRepo, name: doc.name, size: Number(doc.size) || 0, doc, client }),
          kept: library ? library.entry({ source: 'archive', archiveId: currentRepo, path: doc.path || doc.name }) : null,
        });
        li.append(qBtn);
      }

      fragment.append(li);
    }

    updateQueueControls(visibleDocs);

    $('archiveList').replaceChildren(fragment);
    message(
      visibleFolders.length + visibleDocs.length
        ? `${visibleFolders.length} folder${visibleFolders.length === 1 ? '' : 's'} · ${visibleDocs.length} document${visibleDocs.length === 1 ? '' : 's'}`
        : filter ? `Nothing matches “${filter}”.` : 'This folder is empty.'
    );
  }

  async function openRepo(id) {
    cancel();
    currentRepo = id;
    trail = [];
    itemData = null;
    filterText = '';
    if ($('archiveSearch')) $('archiveSearch').value = '';

    try { localStorage.setItem(lastKey, id); } catch {}

    $('archiveRepoView').hidden = true;
    $('archiveFileView').hidden = false;
    $('archiveBack').hidden = false;
    $('archiveFolderUp').hidden = true;
    $('archiveList').replaceChildren();
    $('archivePath').textContent = 'Loading repository…';
    message('Loading repository from archive.org…');

    const mine = controller = new AbortController();
    try {
      const loaded = await client.item(id, mine.signal);
      if (currentRepo !== id || mine.signal.aborted) return;
      itemData = loaded;

      const known = added.find(s => s.id === id);
      if (known && known.title !== loaded.title) {
        known.title = loaded.title;
        save();
      }
      renderListing();
    } catch (error) {
      if (error.name !== 'AbortError') {
        message(`Could not read repository: ${error.message}`, true);
        $('archivePath').textContent = `Error loading ${id}`;
      }
    }
  }

  async function chooseDoc(doc) {
    if (busy) return;
    cancel();
    busy = true;

    const mine = controller = new AbortController();
    const bar = $('archiveProgress');
    if (bar) {
      bar.hidden = false;
      bar.value = 0;
      bar.max = 1;
    }
    let shown = 0;

    try {
      message(`Downloading ${doc.name}…`);
      const file = await client.download(currentRepo, doc, mine.signal, (received, total) => {
        const now = Date.now();
        if (now - shown < 60 && total > 0 && received < total) return;
        shown = now;
        if (bar && total > 0) {
          bar.value = Math.min(1, received / total);
        }
        message(`Downloading ${doc.name}: ${total > 0 ? `${Math.round((received / total) * 100)} % · ` : ''}${mb(received)}${total > 0 ? ` of ${mb(total)}` : ''}`);
      });

      if (mine.signal.aborted) return;
      if (bar) bar.hidden = true;

      if (library && file) {
        await library.keep({ source: 'archive', archiveId: currentRepo, path: doc.path || doc.name, name: doc.name, size: file.size }, file).catch(() => {});
      }

      const opened = await open(file, { source: 'archive', id: currentRepo, path: doc.path });
      message(opened ? `Opened ${doc.name}.` : 'Open cancelled.');
    } catch (error) {
      if (error.name !== 'AbortError') message(`Failed to fetch ${doc.name}: ${error.message}`, true);
    } finally {
      busy = false;
      if (bar) bar.hidden = true;
    }
  }

  function updateQueueControls(visibleDocs = []) {
    queueControls(
      { mode: $('archiveQueueMode'), download: $('archiveQueueDownload'), cancel: $('archiveQueueCancel'), all: $('archiveQueueAll'), list: $('archiveList') },
      { available: !!queue, count: visibleDocs.length, selecting: selectingQueue, selected: selectedDocs.size },
    );
  }

  // Wiring buttons
  const qMode = $('archiveQueueMode');
  if (qMode) {
    qMode.onclick = () => {
      selectingQueue = true;
      selectedDocs.clear();
      renderListing();
    };
  }
  const qDl = $('archiveQueueDownload');
  if (qDl) {
    qDl.onclick = () => {
      const { documents } = archiveListing(itemData?.files || [], trail);
      const filter = filterText.trim().toLowerCase();
      const visibleDocs = filter ? documents.filter(d => d.name.toLowerCase().includes(filter)) : documents;
      const toEnqueue = visibleDocs.filter(d => selectedDocs.has(d.path || d.name));
      if (toEnqueue.length) {
        queue?.enqueue(toEnqueue.map(d => ({
          source: 'archive',
          sourceId: currentRepo,
          name: d.name,
          size: Number(d.size) || 0,
          doc: d,
          client
        })));
      }
      selectingQueue = false;
      selectedDocs.clear();
      renderListing();
    };
  }
  const qCancel = $('archiveQueueCancel');
  if (qCancel) {
    qCancel.onclick = () => {
      selectingQueue = false;
      selectedDocs.clear();
      renderListing();
    };
  }
  const qAll = $('archiveQueueAll');
  if (qAll) {
    qAll.onclick = () => {
      const { documents } = archiveListing(itemData?.files || [], trail);
      const filter = filterText.trim().toLowerCase();
      const visibleDocs = filter ? documents.filter(d => d.name.toLowerCase().includes(filter)) : documents;
      queue?.enqueue(visibleDocs.map(d => ({
        source: 'archive',
        sourceId: currentRepo,
        name: d.name,
        size: Number(d.size) || 0,
        doc: d,
        client
      })));
    };
  }

  $('archiveBack').onclick = () => {
    cancel();
    trail = [];
    currentRepo = null;
    itemData = null;
    selectingQueue = false;
    selectedDocs.clear();
    renderRepositories();
  };

  $('archiveFolderUp').onclick = () => {
    if (trail.length > 0) {
      trail.pop();
      selectingQueue = false;
      selectedDocs.clear();
      renderListing();
    }
  };

  if ($('archiveSearch')) {
    $('archiveSearch').oninput = () => {
      filterText = $('archiveSearch').value;
      renderListing();
    };
  }

  // Add Repository Dialog
  const addDialog = $('archiveAddDialog');
  const addBtn = $('archiveAddBtn');
  const addInput = $('archiveAddInput');
  const addSubmit = $('archiveAddSubmit');
  const addCancel = $('archiveAddCancel');

  if (addBtn && addDialog) {
    addBtn.onclick = () => {
      addInput.value = '';
      addDialog.showModal();
      addInput.focus();
    };
  }
  if (addCancel && addDialog) {
    addCancel.onclick = () => addDialog.close();
  }
  if (addSubmit && addDialog) {
    const doAdd = () => {
      const val = addInput.value.trim();
      const id = archiveId(val);
      if (!id) {
        message('Invalid Internet Archive identifier or URL.', true);
        return;
      }
      if (!sources().some(s => s.id === id)) {
        added.push({ id, title: id });
        save();
      }
      addDialog.close();
      openRepo(id);
    };
    addSubmit.onclick = doAdd;
    addInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doAdd();
      }
    };
  }

  renderRepositories();

  return {
    show() {
      visible = true;
      if (!currentRepo) renderRepositories();
    },
    hide() {
      visible = false;
      cancel();
    },
    onQueueItemDone(item) {
      if (item.source !== 'archive' || item.sourceId !== currentRepo) return;
      for (const li of $('archiveList').children) {
        const b = li.querySelector('.note-card');
        if (b && (b.querySelector('strong')?.textContent === item.name)) {
          markQueueDone(li.querySelector('.card-queue-btn'));
        }
      }
    },
    get visible() { return visible; },
    openRepo,
  };
}
