// Download queue for batch downloads across Cloud providers (Google Drive & Internet Archive).
// Runs in the background, keeps local copies in the user's library, and updates badges.

export function createDownloadQueue({ library = null, onUpdate = () => {}, onItemDone = () => {} } = {}) {
  const items = [];
  let active = null;
  let running = false;
  let paused = false;

  const idOf = (item) => {
    if (typeof item === 'string') return item;
    if (item.source === 'archive') return `archive:${item.sourceId}:${item.path || item.doc?.path || item.name || item.doc?.name}`;
    if (item.source === 'drive' || (!item.source && (item.id || item.doc?.id))) {
      return `drive:${item.id || item.doc?.id || item.name || item.doc?.name}`;
    }
    return item.id || `file:${item.name || item.doc?.name}`;
  };

  function stats() {
    const total = items.length;
    const completed = items.filter(i => i.status === 'done').length;
    const pending = items.filter(i => i.status === 'queued').length;
    const errors = items.filter(i => i.status === 'error').length;
    const activeItem = items.find(i => i.status === 'downloading') || null;
    let overallProgress = 0;
    if (total > 0) {
      const doneWeight = completed;
      const activeWeight = activeItem ? (activeItem.progress || 0) : 0;
      overallProgress = (doneWeight + activeWeight) / total;
    }
    return {
      items: [...items],
      total,
      completed,
      pending,
      errors,
      activeItem,
      overallProgress,
      isBusy: !!activeItem || pending > 0,
      isPaused: paused
    };
  }

  function notify() {
    onUpdate(stats());
  }

  function enqueue(newItems) {
    const list = Array.isArray(newItems) ? newItems : [newItems];
    let added = 0;
    for (const raw of list) {
      const id = idOf(raw);
      const existing = items.find(i => i.id === id);
      if (existing) {
        if (existing.status === 'error') {
          existing.status = 'queued';
          existing.error = null;
          existing.progress = 0;
          added++;
        }
        continue;
      }
      items.push({
        id,
        source: raw.source || 'drive',
        sourceId: raw.sourceId || '',
        name: raw.name || raw.doc?.name || 'document',
        size: Number(raw.size || raw.doc?.size) || 0,
        doc: raw.doc || raw,
        client: raw.client || null,
        status: 'queued',
        progress: 0,
        error: null,
        controller: null
      });
      added++;
    }
    if (added > 0) {
      notify();
      processQueue();
    }
    return added;
  }

  async function processQueue() {
    if (running || paused) return;
    const next = items.find(i => i.status === 'queued');
    if (!next) {
      running = false;
      notify();
      return;
    }

    running = true;
    next.status = 'downloading';
    next.progress = 0;
    const controller = new AbortController();
    next.controller = controller;
    active = next;
    notify();

    try {
      let downloadedBlob = null;
      const onProgress = (received, total) => {
        if (total > 0) next.progress = Math.min(1, received / total);
        notify();
      };

      if (next.source === 'archive' && next.client) {
        downloadedBlob = await next.client.download(next.sourceId, next.doc, controller.signal, onProgress);
      } else if (next.source === 'drive' && next.client) {
        downloadedBlob = await next.client.download(next.doc, controller.signal, onProgress);
      } else if (typeof next.downloadFn === 'function') {
        downloadedBlob = await next.downloadFn(controller.signal, onProgress);
      } else {
        throw new Error('No download client available for this provider.');
      }

      if (controller.signal.aborted) return;

      // Keep file in local library so it shows up in Recent and on disk
      if (library && downloadedBlob) {
        const fileRef = next.source === 'archive'
          ? { source: 'archive', archiveId: next.sourceId, path: next.doc.path || next.name, name: next.name, size: downloadedBlob.size }
          : next.doc;
        await library.keep(fileRef, downloadedBlob).catch(() => null);
      }

      next.status = 'done';
      next.progress = 1;
      next.controller = null;
      onItemDone(next, downloadedBlob);
    } catch (err) {
      if (controller.signal.aborted) {
        const idx = items.indexOf(next);
        if (idx !== -1) items.splice(idx, 1);
      } else {
        next.status = 'error';
        next.error = err.message || 'Download failed';
      }
    } finally {
      next.controller = null;
      active = null;
      running = false;
      notify();
      processQueue();
    }
  }

  function cancel(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    if (item.status === 'downloading' && item.controller) {
      item.controller.abort();
    }
    const idx = items.indexOf(item);
    if (idx !== -1) items.splice(idx, 1);
    notify();
    if (!running) processQueue();
  }

  function clear() {
    if (active?.controller) {
      active.controller.abort();
    }
    items.length = 0;
    active = null;
    running = false;
    notify();
  }

  function has(id) {
    return items.some(i => i.id === id);
  }

  function statusOf(id) {
    return items.find(i => i.id === id)?.status || null;
  }

  return {
    enqueue,
    cancel,
    clear,
    has,
    statusOf,
    stats,
    idOf,
    pause() { paused = true; notify(); },
    resume() { paused = false; notify(); processQueue(); }
  };
}

// ⋯ on a Google Drive or Internet Archive card: downloads and opens the note, then exports it
// (the same formats as the File menu's Export row). `pick(kind)` does the opening.
export const exportable = (name) => /\.(noteful|nfedit|notecomp|notecomplete|notepart|pdf)$/i.test(name || '');
const EXPORT_KINDS = [['noteful', 'NF', 'Export Noteful (.noteful)'], ['markdown', 'N+MD', 'Export Noteful + Markdown'], ['project', 'NFE', 'Export the project (.nfedit) with its whole edit history'], ['notecomplete', 'NC', 'Export NoteComplete (.notecomp)'], ['pdf', 'PDF', 'Every page as one PDF']];
let exportMenu = null;
const closeExportMenu = () => { if (exportMenu) exportMenu.hidden = true; };
export function addExportMenu(item, { label, pick }) {
  const more = document.createElement('button');
  more.type = 'button'; more.className = 'note-more'; more.textContent = '⋯';
  more.title = 'Download and export'; more.setAttribute('aria-label', `Download and export ${label}`); more.setAttribute('aria-haspopup', 'menu');
  more.onclick = (event) => {
    event.stopPropagation();
    if (!exportMenu) {
      exportMenu = document.createElement('div');
      exportMenu.className = 'note-export cloud-export-menu'; exportMenu.setAttribute('role', 'menu'); exportMenu.hidden = true;
      document.body.append(exportMenu);
      document.addEventListener('pointerdown', (e) => { if (!exportMenu.hidden && !exportMenu.contains(e.target) && !e.target.closest?.('.note-more')) closeExportMenu(); }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeExportMenu(); }, true);
    }
    const title = Object.assign(document.createElement('span'), { textContent: 'Download and export' });
    exportMenu.replaceChildren(title, ...EXPORT_KINDS.map(([kind, text, hint]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = text; b.title = hint;
      b.onclick = () => { closeExportMenu(); pick(kind); };
      return b;
    }));
    exportMenu.hidden = false;
    const r = more.getBoundingClientRect(), w = exportMenu.offsetWidth, h = exportMenu.offsetHeight;
    exportMenu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    exportMenu.style.top = `${innerHeight - r.bottom > h + 12 ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
  };
  item.append(more);
}
