// Auto-save: while it is on, the open note is copied every so often into automatic slots
// kept on this device (IndexedDB), never over the file the user saved. Each slot is a
// lossless project (.nfedit bytes: the original plus every edit, and the Markdown notes),
// so after a crash, a closed tab or a lost sharing session the note can be recovered.
// A note keeps its last SLOTS slots; the oldest go first. In a sharing session the host's
// switch decides for everyone (collab.js).

export const SLOTS = 5;      // per note
export const TOTAL = 40;     // across notes, the oldest dropped first
export const EVERY_MS = 60_000;

// Which slots to delete after adding one: beyond `keep` for a note, beyond `cap` overall.
export function pruned(slots, keep = SLOTS, cap = TOTAL) {
  const newest = [...slots].sort((a, b) => b.time - a.time);
  const perNote = new Map(), drop = new Set();
  for (const slot of newest) {
    const n = (perNote.get(slot.key) || 0) + 1;
    perNote.set(slot.key, n);
    if (n > keep) drop.add(slot.id);
  }
  const kept = newest.filter((s) => !drop.has(s.id));
  for (const slot of kept.slice(cap)) drop.add(slot.id);
  return [...drop];
}

// Whether to offer the automatic save when a note opens: it is newer than the last time
// the note was saved by hand (or opened from its file with no saves since).
export function offerRecovery(latest, manualAt = 0) {
  return !!latest && latest.time > manualAt + 1000;
}

// "Today 10:32", "Yesterday 18:05", "3 Nov 09:12".
export function when(time, now = Date.now()) {
  const d = new Date(time), today = new Date(now);
  const clock = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(today) - day(d)) / 86_400_000);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${clock}`;
}

// The slots: metadata in `meta` (small, listed for the menu), bytes in `data`.
export function autosaveStore(backend = idbBackend()) {
  let next = 0;
  return {
    // `mark` ({edits, digest}): where the note's edit history was, so the history up to
    // this save can later be compacted (File menu). `content`: a digest of what the note
    // holds (its .noteful export), so a note can be recognised as the same whatever its
    // history, e.g. after a save in another format.
    async save({ key, title, project, shared = false, time = Date.now(), mark = null, content = null }) {
      const id = `${time}-${next++}-${Math.random().toString(36).slice(2, 8)}`;
      const slot = { id, key, title: title || 'Untitled note', time, size: project.byteLength, shared, ...(mark ? { edits: mark.edits, digest: mark.digest } : {}), ...(content ? { content } : {}) };
      await backend.putData(id, project);
      await backend.putMeta(slot);
      for (const gone of pruned(await this.list())) await this.remove(gone);
      return slot;
    },
    // Newest first; `key` for one note's slots.
    async list(key) {
      const all = (await backend.allMeta()).filter((m) => !m.manual);
      return all.filter((m) => !key || m.key === key).sort((a, b) => b.time - a.time);
    },
    load: (id) => backend.getData(id),
    async remove(id) { await backend.deleteMeta(id); await backend.deleteData(id); },
    async clear() { for (const m of await backend.allMeta()) { await backend.deleteMeta(m.id); await backend.deleteData(m.id).catch(() => {}); } },
    // When the note was last saved by hand (or opened from its file).
    async markManual(key, time = Date.now()) { await backend.putMeta({ id: `manual:${key}`, key, manual: true, time }); },
    async manualAt(key) { return (await backend.allMeta()).find((m) => m.id === `manual:${key}`)?.time || 0; },
  };
}

// In memory, for tests and when IndexedDB is unavailable (private windows).
export function memoryBackend() {
  const meta = new Map(), data = new Map();
  return {
    putMeta: async (m) => { meta.set(m.id, { ...m }); },
    allMeta: async () => [...meta.values()].map((m) => ({ ...m })),
    deleteMeta: async (id) => { meta.delete(id); },
    putData: async (id, bytes) => { data.set(id, bytes); },
    getData: async (id) => data.get(id) || null,
    deleteData: async (id) => { data.delete(id); },
  };
}

export function idbBackend(name = 'notecomplete-autosave') {
  if (!globalThis.indexedDB) return memoryBackend();
  let opened = null;
  const db = () => (opened ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta', { keyPath: 'id' });
      request.result.createObjectStore('data');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
  const run = async (store, mode, work) => {
    const tx = (await db()).transaction(store, mode);
    const result = work(tx.objectStore(store));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error('Auto-save storage is full.'));
    });
  };
  return {
    putMeta: (m) => run('meta', 'readwrite', (s) => s.put(m)),
    allMeta: () => run('meta', 'readonly', (s) => s.getAll()),
    deleteMeta: (id) => run('meta', 'readwrite', (s) => s.delete(id)),
    putData: (id, bytes) => run('data', 'readwrite', (s) => s.put(bytes, id)),
    getData: (id) => run('data', 'readonly', (s) => s.get(id)),
    deleteData: (id) => run('data', 'readwrite', (s) => s.delete(id)),
  };
}
