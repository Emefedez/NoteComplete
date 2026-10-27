// Downloaded and recently opened notes. Metadata and covers live in a small
// key-value store (IndexedDB in the app); note bytes live in a folder:
//   folder     the desktop app's chosen directory (Electron bridge)
//   directory  a directory this browser was granted (File System Access)
//   browser    the origin-private file system, when no folder was chosen
// Drive copies are reused while Drive reports the same modifiedTime and size.

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
  };
}

export function memoryStore() {
  const stores = { entries: new Map(), covers: new Map(), settings: new Map(), search: new Map() };
  return {
    get: async (store, key) => stores[store].get(key),
    set: async (store, key, value) => { stores[store].set(key, value); },
    delete: async (store, key) => { stores[store].delete(key); },
    values: async store => [...stores[store].values()],
  };
}

// Names stay readable in the folder; only the path separators and control bytes go.
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
  };
}

export class Library {
  constructor({ store = idbStore(), bridge = globalThis.notecompleteFiles, storage = globalThis.navigator?.storage, picker = globalThis.showDirectoryPicker } = {}) {
    Object.assign(this, { store, bridge, storage, picker });
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
  key(file) { return 'drive:' + file.id; }
  entry(file) { return this.store.get('entries', this.key(file)); }
  // The kept copy of a Drive file, or null when Drive has a newer one.
  async cached(file) {
    const entry = await this.entry(file);
    if (!entry || entry.modifiedTime !== file.modifiedTime || (file.size && String(entry.size) !== String(file.size))) return null;
    const blob = await (await this.location()).read(entry.filename);
    if (!blob || (entry.size && blob.size !== Number(entry.size))) return null;
    return new File([blob], file.name, { type: file.mimeType || '' });
  }
  async keep(file, downloaded) {
    const folder = await this.location();
    const previous = await this.entry(file);
    let filename = previous?.filename || safeName(file.name);
    const taken = (await this.store.values('entries')).some(e => e.filename === filename && e.key !== this.key(file));
    if (taken) filename = filename.replace(/(\.[^.]*)?$/, ` (${String(file.id).slice(0, 6)})$1`);
    await folder.write(filename, downloaded);
    const entry = { key: this.key(file), source: 'drive', driveId: file.id, resourceKey: file.resourceKey, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, size: String(downloaded.size), filename, openedAt: this.now() };
    await this.store.set('entries', entry.key, entry);
    return entry;
  }
  // Locally opened files the desktop bridge can reopen by path.
  async rememberLocal(path, name, size) {
    const entry = { key: 'local:' + path, source: 'local', path, name, size: String(size), openedAt: this.now() };
    await this.store.set('entries', entry.key, entry);
    return entry;
  }
  async touch(key) {
    const entry = await this.store.get('entries', key);
    if (entry) await this.store.set('entries', key, { ...entry, openedAt: this.now() });
  }
  async forget(key) { await this.store.delete('entries', key); await this.store.delete('covers', key); }
  async recent(limit = 24) {
    return (await this.store.values('entries')).sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
  }
  // Where a kept or local note lives on disk (desktop only), for AI tools that read files.
  async pathOf(entry) {
    if (!entry) return '';
    if (entry.source === 'local') return entry.path;
    const folder = await this.location();
    return folder.kind === 'folder' ? `${folder.label.replace(/\/$/, '')}/${entry.filename}` : '';
  }
  async open(entry) {
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
  // Extracted PDF text and OCR results, keyed by a fingerprint of the note's bytes.
  searchData(fingerprint) { return this.store.get('search', fingerprint).catch(() => null); }
  saveSearchData(fingerprint, value) { return this.store.set('search', fingerprint, value).catch(() => {}); }
  saveCover(key, url) { return this.store.set('covers', key, url).catch(() => {}); }
}
