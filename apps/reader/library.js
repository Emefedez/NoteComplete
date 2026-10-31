// Downloaded and recently opened notes. Metadata and covers live in a small
// key-value store (IndexedDB in the app); note bytes live in a folder:
//   folder     the desktop app's chosen directory (Electron bridge)
//   directory  a directory this browser was granted (File System Access)
//   browser    the origin-private file system, when no folder was chosen
// Drive copies are reused while Drive reports the same modifiedTime and size, or the
// same content (md5Checksum): Noteful backups re-upload unchanged notes as new files.

export function idbStore(name = 'notecomplete-library') {
  let db;
  const open = () => db ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      for (const store of ['entries', 'covers', 'settings', 'search'])
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async (store, mode, fn) => {
    const tx = (await open()).transaction(store, mode), request = fn(tx.objectStore(store));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (store, key) => run(store, 'readonly', s => s.get(key)),
    set: (store, key, value) => run(store, 'readwrite', s => s.put(value, key)),
    delete: (store, key) => run(store, 'readwrite', s => s.delete(key)),
    values: store => run(store, 'readonly', s => s.getAll()),
    keys: store => run(store, 'readonly', s => s.getAllKeys()),
  };
}

export function memoryStore() {
  const stores = { entries: new Map(), covers: new Map(), settings: new Map(), search: new Map() };
  return {
    get: async (store, key) => stores[store].get(key),
    set: async (store, key, value) => { stores[store].set(key, value); },
    delete: async (store, key) => { stores[store].delete(key); },
    values: async store => [...stores[store].values()],
    keys: async store => [...stores[store].keys()],
  };
}

// Names stay readable in the folder; only the path separators and control bytes go.
// One entry per content: entries sharing an md5 collapse to the newest Drive version.
export function sameContentOnce(entries) {
  const best = new Map();
  for (const e of entries) {
    if (!e.md5) continue;
    const seen = best.get(e.md5);
    if (!seen || Date.parse(e.modifiedTime || 0) > Date.parse(seen.modifiedTime || 0)) best.set(e.md5, e);
  }
  return entries.filter(e => !e.md5 || best.get(e.md5) === e);
}
export function safeName(name) {
  const cleaned = String(name || 'Note').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').slice(0, 180).trim();
  return cleaned || 'Note';
}

function directoryFolder(handle, kind, label) {
  const permitted = async (ask) => {
    if (!handle.queryPermission) return true;
    let state = await handle.queryPermission({ mode: 'readwrite' });
    if (state === 'prompt' && ask) state = await handle.requestPermission({ mode: 'readwrite' });
    return state === 'granted';
  };
  return {
    kind, label,
    async read(name) {
      if (!(await permitted(true))) return null;
      try { return await (await handle.getFileHandle(name)).getFile(); } catch { return null; }
    },
    async remove(name) {
      if (!(await permitted(true))) return;
      await handle.removeEntry(name).catch(() => {});
    },
    async write(name, blob) {
      if (!(await permitted(true))) throw Error('NoteComplete no longer has access to the downloads folder. Choose it again.');
      const writable = await (await handle.getFileHandle(name, { create: true })).createWritable();
      await writable.write(blob);
      await writable.close();
    },
  };
}

function bridgeFolder(bridge, label) {
  return {
    kind: 'folder', label,
    async read(name) {
      const bytes = await bridge.read(name);
      return bytes ? new Blob([bytes]) : null;
    },
    async write(name, blob) { await bridge.write(name, new Uint8Array(await blob.arrayBuffer())); },
    remove: name => bridge.remove(name),
  };
}

// What Recent shows for an entry: the user's title, else the file name without extension.
export const plainTitle = (name) => String(name || '').replace(/\.(noteful|notepart|notecomp|notecomplete|nfedit)$/i, '');
export const entryTitle = (entry) => entry?.title || plainTitle(entry?.name);
export class Library {
  constructor({ store = idbStore(), bridge = globalThis.notecompleteFiles, storage = globalThis.navigator?.storage, picker = globalThis.showDirectoryPicker, md5 = null } = {}) {
    Object.assign(this, { store, bridge, storage, picker, md5 });
    this.folder = null;
    this.last = 0;
  }
  // Strictly increasing, so opens within one millisecond still order correctly.
  now() { return (this.last = Math.max(Date.now(), this.last + 1)); }
  // Which folder downloads go to, resolved once and again after choose().
  async location() {
    if (this.folder) return this.folder;
    if (this.bridge) {
      const label = await this.bridge.folder();
      return (this.folder = bridgeFolder(this.bridge, label));
    }
    const handle = await this.store.get('settings', 'directory').catch(() => null);
    if (handle) return (this.folder = directoryFolder(handle, 'directory', handle.name));
    if (this.storage?.getDirectory) {
      this.storage.persist?.().catch(() => {});
      return (this.folder = directoryFolder(await this.storage.getDirectory(), 'browser', 'Browser storage'));
    }
    return (this.folder = { kind: 'none', label: 'Not available', read: async () => null, write: async () => { throw Error('This browser cannot keep downloaded notes.'); } });
  }
  get canChoose() { return !!(this.bridge || this.picker); }
  async choose() {
    if (this.bridge) {
      const label = await this.bridge.choose();
      if (!label) return null;
      this.folder = bridgeFolder(this.bridge, label);
    } else if (this.picker) {
      const handle = await this.picker({ id: 'notecomplete-downloads', mode: 'readwrite' });
      await this.store.set('settings', 'directory', handle);
      this.folder = directoryFolder(handle, 'directory', handle.name);
    } else return null;
    return this.folder;
  }
  key(file) {
    if (typeof file === 'string') return file;
    if (file?.source === 'archive' || file?.archiveId) return `archive:${file.archiveId}:${file.path || file.name}`;
    return 'drive:' + file.id;
  }
  entry(file) { return this.store.get('entries', this.key(file)); }
  // The kept copy of a Drive file, or null when it must be downloaded.
  async cached(file) {
    const entry = await this.entry(file);
    if (entry && (!file.modifiedTime || entry.modifiedTime === file.modifiedTime) && (!file.size || String(entry.size) === String(file.size))) {
      const blob = await (await this.location()).read(entry.filename);
      if (blob && (!entry.size || blob.size === Number(entry.size))) return new File([blob], file.name, { type: file.mimeType || '' });
    }
    return this.reuse(file);
  }
  // A kept copy with the same content (Drive's md5Checksum), under another Drive id or
  // date: it now stands for this file, so nothing is downloaded and Recent keeps one entry.
  // Copies kept before checksums were stored are checked once, only with the same name and size.
  async reuse(file) {
    if (!file.md5Checksum) return null;
    const entries = (await this.store.values('entries')).filter(e => e.source === 'drive');
    let match = entries.find(e => e.md5 === file.md5Checksum);
    if (!match && this.md5) {
      for (const e of entries.filter(e => !e.md5 && e.name === file.name && String(e.size) === String(file.size))) {
        const blob = await (await this.location()).read(e.filename);
        if (!blob) continue;
        e.md5 = await this.md5(new Uint8Array(await blob.arrayBuffer()));
        await this.store.set('entries', e.key, e);
        if (e.md5 === file.md5Checksum) { match = e; break; }
      }
    }
    if (!match) return null;
    const blob = await (await this.location()).read(match.filename);
    if (!blob) return null;
    const entry = { ...match, key: this.key(file), driveId: file.id, resourceKey: file.resourceKey, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, size: String(blob.size), md5: file.md5Checksum, parent: file.parents?.[0] || match.parent || null };
    await this.store.set('entries', entry.key, entry);
    if (match.key !== entry.key) {
      const cover = await this.cover(this.coverKey({ id: match.driveId, modifiedTime: match.modifiedTime }));
      if (cover) await this.saveCover(this.coverKey(file), cover);
      await this.store.delete('entries', match.key);
    }
    return new File([blob], file.name, { type: file.mimeType || '' });
  }
  async keep(file, downloaded) {
    const folder = await this.location();
    const previous = await this.entry(file);
    let filename = previous?.filename || safeName(file.name);
    const taken = (await this.store.values('entries')).some(e => e.filename === filename && e.key !== this.key(file));
    if (taken) filename = filename.replace(/(\.[^.]*)?$/, ` (${String(file.id || file.archiveId || 'arc').slice(0, 6)})$1`);
    await folder.write(filename, downloaded);
    const isArchive = file.source === 'archive' || !!file.archiveId;
    const entry = {
      key: this.key(file),
      source: isArchive ? 'archive' : 'drive',
      name: file.name,
      mimeType: file.mimeType || (file.name.endsWith('.pdf') ? 'application/pdf' : ''),
      modifiedTime: file.modifiedTime || null,
      size: String(downloaded.size),
      filename,
      openedAt: this.now(),
      ...(isArchive
        ? { archiveId: file.archiveId, path: file.path }
        : { driveId: file.id, resourceKey: file.resourceKey, md5: file.md5Checksum || null, parent: file.parents?.[0] || null }),
      ...(previous?.title ? { title: previous.title } : {})
    };
    await this.store.set('entries', entry.key, entry);
    return entry;
  }
  // Locally opened files the desktop bridge can reopen by path.
  async rememberLocal(path, name, size) {
    const previous = await this.store.get('entries', 'local:' + path);
    const entry = { key: 'local:' + path, source: 'local', path, name, size: String(size), openedAt: this.now(), ...(previous?.title ? { title: previous.title } : {}) };
    await this.store.set('entries', entry.key, entry);
    return entry;
  }
  // A local file renamed on disk: its Recent entry and cover move to the new path.
  async moveLocal(oldPath, newPath, name) {
    const oldKey = 'local:' + oldPath, entry = await this.store.get('entries', oldKey);
    if (!entry) return null;
    const moved = { ...entry, key: 'local:' + newPath, path: newPath, name };
    await this.store.set('entries', moved.key, moved);
    const cover = await this.cover(oldKey);
    if (cover) await this.saveCover(moved.key, cover);
    await this.store.delete('entries', oldKey);
    await this.store.delete('covers', oldKey);
    return moved;
  }
  // Recent shows `title` when the user renamed the entry; `name` stays the file's own name
  // (Drive matching, file type, the kept copy). An empty or original title clears it.
  async rename(key, title) {
    const entry = await this.store.get('entries', key);
    if (!entry) return null;
    const next = String(title || '').trim().slice(0, 200);
    const { title: _old, ...rest } = entry;
    const renamed = next && next !== plainTitle(entry.name) ? { ...rest, title: next } : rest;
    await this.store.set('entries', key, renamed);
    return renamed;
  }
  // Web links in Recent: nothing is downloaded; `name` is the page title (Rename still applies).
  async rememberWeb(url, name) {
    const key = 'web:' + url, previous = await this.store.get('entries', key);
    const entry = { key, source: 'web', url, name: name || previous?.name || url, openedAt: this.now(), ...(previous?.title ? { title: previous.title } : {}) };
    await this.store.set('entries', key, entry);
    return entry;
  }
  async touch(key) {
    const entry = await this.store.get('entries', key);
    if (entry) await this.store.set('entries', key, { ...entry, openedAt: this.now() });
  }
  // Remove from Recent; with `deleteFile`, also delete the kept copy (never a local original).
  async forget(key, { deleteFile = false } = {}) {
    const entry = await this.store.get('entries', key);
    if (deleteFile && entry?.source === 'drive' && entry.filename) await (await this.location()).remove?.(entry.filename);
    await this.store.delete('entries', key);
    await this.store.delete('covers', key);
    if (entry?.source === 'drive') await this.store.delete('covers', this.coverKey({ id: entry.driveId, modifiedTime: entry.modifiedTime }));
  }
  // Most recently opened first; copies with the same content show once (the newest in Drive).
  async recent(limit = 24) {
    const all = (await this.store.values('entries')).sort((a, b) => b.openedAt - a.openedAt);
    return sameContentOnce(all).slice(0, limit);
  }
  // Recent duplicates kept before checksums were stored (same name and size): check them
  // once; identical ones are merged into the newest and the extra copy is deleted.
  async mergeDuplicates() {
    if (!this.md5) return 0;
    const drive = (await this.store.values('entries')).filter(e => e.source === 'drive');
    const groups = new Map();
    for (const e of drive) { const k = `${e.name}\u0000${e.size}`; groups.set(k, [...(groups.get(k) || []), e]); }
    let merged = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const e of group.filter(e => !e.md5)) {
        const blob = await (await this.location()).read(e.filename);
        if (!blob) continue;
        e.md5 = await this.md5(new Uint8Array(await blob.arrayBuffer()));
        await this.store.set('entries', e.key, e);
      }
      const byMd5 = new Map();
      for (const e of group.filter(e => e.md5)) byMd5.set(e.md5, [...(byMd5.get(e.md5) || []), e]);
      for (const same of byMd5.values()) {
        const [keep, ...extra] = same.sort((a, b) => Date.parse(b.modifiedTime || 0) - Date.parse(a.modifiedTime || 0));
        for (const e of extra) {
          if (e.filename !== keep.filename) await (await this.location()).remove?.(e.filename);
          await this.store.delete('entries', e.key);
          keep.openedAt = Math.max(keep.openedAt, e.openedAt);
          merged++;
        }
        await this.store.set('entries', keep.key, keep);
      }
    }
    return merged;
  }
  // Where a kept or local note lives on disk (desktop only), for AI tools that read files.
  async pathOf(entry) {
    if (!entry) return '';
    if (entry.source === 'local') return entry.path;
    const folder = await this.location();
    return folder.kind === 'folder' ? `${folder.label.replace(/\/$/, '')}/${entry.filename}` : '';
  }
  async open(entry) {
    if (entry.source === 'web') return null;
    if (entry.source === 'local') {
      const bytes = await this.bridge?.readRecent(entry.path);
      return bytes ? new File([bytes], entry.name) : null;
    }
    const blob = await (await this.location()).read(entry.filename);
    return blob ? new File([blob], entry.name, { type: entry.mimeType || '' }) : null;
  }
  // Covers are keyed by file and version so a changed note gets a new one.
  coverKey(file) { return `${this.key(file)}@${file.modifiedTime || ''}`; }
  cover(key) { return this.store.get('covers', key).catch(() => null); }
  // Filter facts (recordings, tags) per file version, like covers.
  facts(key) { return this.store.get('settings', `facts:${key}`).catch(() => null); }
  saveFacts(key, value) { return this.store.set('settings', `facts:${key}`, value).catch(() => {}); }
  // Extracted PDF text and OCR results, keyed by a fingerprint of the note's bytes.
  searchData(fingerprint) { return this.store.get('search', fingerprint).catch(() => null); }
  saveSearchData(fingerprint, value) { return this.store.set('search', fingerprint, value).catch(() => {}); }
  saveCover(key, url) { return this.store.set('covers', key, url).catch(() => {}); }
}
