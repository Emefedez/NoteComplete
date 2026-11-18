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

// A project's size in bytes. The reader passes the project as text (the engine's `save`
// answers with a string), so its UTF-8 length is counted; bytes and Blobs give their own.
export function projectSize(project) {
  if (typeof project === 'string') return new TextEncoder().encode(project).length;
  const size = project?.byteLength ?? project?.size;
  return Number.isFinite(size) ? size : 0;
}

// " · 1.2 MB" for a slot's row in the File menu; nothing for a slot saved before sizes
// were recorded for text projects.
export function sizeLabel(size) {
  return Number.isFinite(size) ? ` · ${(size / 1048576).toFixed(1)} MB` : '';
}

export const bytesText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Reuses the last content digest while the note (`epoch`) and its history mark
// (`{edits, digest}`) have not moved, so a note whose only change is in its Markdown
// notes (or a forced save with no new edits) does not rebuild its .noteful export.
export function contentDigestCache(compute) {
  let last = null;
  return async (mark, epoch = 0) => {
    if (mark && last && last.epoch === epoch && last.edits === mark.edits && last.digest === mark.digest) {
      return last.content;
    }
    try {
      const content = (await compute()) || null;
      if (mark && content) last = { epoch, edits: mark.edits, digest: mark.digest, content };
      return content;
    } catch {
      return null;
    }
  };
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
      const slot = { id, key, title: title || 'Untitled note', time, size: projectSize(project), shared, ...(mark ? { edits: mark.edits, digest: mark.digest } : {}), ...(content ? { content } : {}) };
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
    async clear() { for (const m of await backend.allMeta()) { await backend.deleteMeta(m.id); await backend.deleteData(m.id).catch(() => { /* Optional. */ }); } },
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

// Wires the File menu's automatic saves, recovery dialog and history compaction.
export function autosaveController({
  store = autosaveStore(),
  state,
  call,
  notes,
  status,
  closeMenus = () => {},
  canReplace = () => true,
  openSlotFile,
  onCompacted,
  icon = () => document.createElement('span'),
  $ = (id) => globalThis.document?.getElementById(id),
  docObj = globalThis.document,
  win = globalThis,
  storage = globalThis.localStorage,
  confirmFn = (msg) => globalThis.confirm(msg),
  intervalMs = EVERY_MS,
} = {}) {
  let autosavePref = true, sharedAutosave = null, recoveringKey = null;
  let autosavedRevision = -1, openedRevision = 0, autosaving = false;
  try { autosavePref = storage?.getItem('notecomplete-autosave') !== '0'; } catch { /* Optional. */ }
  const collab = () => state.collab?.();
  const following = () => !!collab() && collab().role !== 'host';
  const autosaveOn = () => (following() ? !!sharedAutosave : autosavePref);
  const titleText = () => $('title')?.textContent || 'Untitled note';
  // A note's slots belong to its file; a shared note's to the session's note title.
  const autosaveKey = () => (following() ? `shared:${collab().docTitle || titleText()}` : state.fingerprint?.() || `title:${titleText()}`);

  function syncSwitch() {
    const b = $('autosaveToggle');
    if (!b) return;
    b.setAttribute('aria-checked', String(autosaveOn()));
    b.disabled = following();
    b.title = following() ? 'Set by the person sharing this note' : 'Copies the note every minute into automatic slots on this device, never over your file';
  }

  const toggleBtn = $('autosaveToggle');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      if (following()) return;
      autosavePref = !autosavePref;
      try { storage?.setItem('notecomplete-autosave', autosavePref ? '1' : '0'); } catch { /* Optional. */ }
      syncSwitch();
      collab()?.settingsChanged?.();
      status(autosavePref ? 'Auto-save on: a copy every minute, in File → automatic saves.' : 'Auto-save off.');
      if (autosavePref) now();
    };
  }
  syncSwitch();

  const contentDigest = contentDigestCache(() => call('contentDigest'));

  // A copy now, if auto-save is on and the note changed since the last one. `always`: also
  // with auto-save off, after a copy under way, and while a text is being typed (a restart
  // for an update keeps unsaved changes this way, desktop session.js).
  async function now({ force = false, always = false } = {}) {
    if (always) for (let i = 0; autosaving && i < 200; i++) await new Promise((r) => setTimeout(r, 50));
    if (!state.doc() || autosaving || (!always && (state.editing?.() || !autosaveOn()))) return null;
    const rev = state.revision();
    if (!force && (rev === autosavedRevision || rev === openedRevision)) return null;
    autosaving = true;
    const at = rev, note = state.epoch(), key = autosaveKey(), title = titleText(), shared = following();
    try {
      await notes?.()?.flush?.();
      const project = await call('save');
      const mark = await call('historyMark').catch(() => null);
      const content = await contentDigest(mark, note);
      if (note !== state.epoch()) return null;
      const slot = await store.save({ key, title, project, shared, mark, content });
      autosavedRevision = at;
      return slot;
    } catch (e) {
      console.warn('Auto-save:', e);
      return null;
    } finally { autosaving = false; }
  }

  // The copy waits while the pen or a finger is busy (`state.active`): copying a large note
  // holds the engine and the page for a moment, which showed as a sudden lag mid-stroke on
  // iPads. It runs at the first pause, or after 30 s of waiting.
  let waited = 0;
  const tick = () => {
    if (state.active?.() && waited < 15) { waited++; setTimeout(tick, 2000); return; }
    waited = 0;
    now();
  };
  const timer = intervalMs > 0 ? setInterval(() => { if (!waited) tick(); }, intervalMs) : null;
  timer?.unref?.();
  if (win?.addEventListener) {
    win.addEventListener('visibilitychange', () => { if (docObj?.visibilityState === 'hidden') now(); });
    win.addEventListener('pagehide', () => { now(); });
  }

  // Opens an automatic save as a copy of its note: unsaved until the user saves it.
  async function openSlot(slot) {
    closeMenus();
    if (!canReplace()) return;
    const bytes = await store.load(slot.id);
    if (!bytes) return status('That automatic save is gone.', true);
    const sameKey = slot.key === autosaveKey();
    recoveringKey = slot.key.startsWith('shared:') || slot.key.startsWith('title:') ? null : slot.key;
    await openSlotFile?.(slot, bytes, { sameKey, label: when(slot.time) });
  }

  // A note just opened: offer its newer automatic save, unless this is that save.
  async function opened(recovered) {
    openedRevision = state.revision();
    autosavedRevision = -1;
    if (recovered || following() || !state.doc()) return;
    const key = autosaveKey(), note = state.epoch();
    try {
      const [latest] = await store.list(key);
      const manual = await store.manualAt(key);
      if (note !== state.epoch() || !offerRecovery(latest, manual)) return;
      const mark = await call('historyMark').catch(() => null);
      if (note !== state.epoch()) return;
      if (mark && latest.digest && latest.edits === mark.edits && latest.digest === mark.digest) {
        store.markManual(key).catch(() => { /* Optional. */ });
        return;
      }
      if (latest.content && (await contentDigest(mark, note)) === latest.content) {
        if (note !== state.epoch()) return;
        store.markManual(key).catch(() => { /* Optional. */ });
        return;
      }
      if (note !== state.epoch()) return;
      const [kept, current] = await Promise.all([store.load(latest.id).catch(() => null), call('save').catch(() => null)]);
      if (note !== state.epoch()) return;
      const encode = (v) => (typeof v === 'string' ? new TextEncoder().encode(v) : v && new Uint8Array(v.buffer || v));
      const a = encode(kept), b = encode(current);
      if (a && b && a.length === b.length && a.every((x, i) => x === b[i])) {
        store.markManual(key).catch(() => { /* Optional. */ });
        return;
      }
      if (!$('recoverDialog')) return;
      // A quiet card in the corner, not a modal: the note stays usable. Ignored, it hides
      // after a while and the save stays in File → Automatic saves.
      const dialog = $('recoverDialog');
      $('recoverText').textContent = `“${latest.title}” has an automatic save from ${when(latest.time)}, newer than ${manual ? `your last save (${when(manual)})` : 'the file you opened'}.`;
      $('recoverAuto').textContent = 'Open it';
      $('recoverManual').textContent = 'Keep the file';
      clearTimeout(dialog._hide);
      const keep = () => { clearTimeout(dialog._hide); dialog.close(); store.markManual(key).catch(() => { /* Optional. */ }); };
      $('recoverAuto').onclick = () => { clearTimeout(dialog._hide); dialog.close(); openSlot(latest); };
      $('recoverManual').onclick = keep;
      if ($('recoverDismiss')) $('recoverDismiss').onclick = keep;
      if (dialog.open) dialog.close();
      dialog.show();
      dialog._hide = setTimeout(() => dialog.close(), 20_000);
    } catch { /* No storage: nothing to offer. */ }
  }

  let previewQueue = Promise.resolve();
  const previewed = new Map();
  function previewCut(upto) {
    const key = `${state.epoch()}:${state.revision()}:${upto}`;
    if (!previewed.has(key)) {
      if (previewed.size > 40) previewed.clear();
      const run = () => (state.doc() && !state.busy?.() ? call('compactPreview', { upto }).then((r) => r.bytes_before - r.bytes_after).catch(() => null) : Promise.resolve(null));
      previewed.set(key, (previewQueue = previewQueue.then(run, run)));
    }
    return previewed.get(key);
  }

  async function compact(upto, label) {
    closeMenus();
    const doc = state.doc();
    if (!doc) return;
    if (collab()) return status('The history cannot be deleted while sharing: every copy of the note keeps the same history. Stop sharing first.', true);
    if (state.busy?.()) return status('Wait for the edit in progress to finish, then try again.', true);
    const freed = await previewCut(upto);
    const frees = freed > 0 ? `its file gets about ${bytesText(freed)} smaller once saved` : 'its file gets smaller once saved';
    if (!confirmFn(`Delete the edit history ${label}?\n\nThe note stays exactly as it is, and ${frees}. You will not be able to undo past this point.`)) return;
    try {
      const { report, view } = await call('compactHistory', { upto });
      const removed = report.edits_before - report.edits_after, saved = report.bytes_before - report.bytes_after;
      const size = bytesText(saved);
      onCompacted?.(view, removed ? `History deleted ${label}: ${removed} ${removed === 1 ? 'edit' : 'edits'} fewer, ${size} smaller. Save to keep it.` : `Nothing to delete ${label}: every edit still shapes the note. Undo now stops there.`);
    } catch (e) {
      status(`Could not delete the history: ${e.message}`, true);
    }
  }

  async function openAllDialog() {
    closeMenus();
    const slots = await store.list().catch(() => []);
    $('autosavesAll').replaceChildren(...(slots.length ? slots.map((slot) => {
      const li = docObj.createElement('li');
      const name = docObj.createElement('span');
      name.textContent = `${slot.shared ? 'Shared · ' : ''}${slot.title} · ${when(slot.time)}${sizeLabel(slot.size)}`;
      const open = Object.assign(docObj.createElement('button'), { type: 'button', textContent: 'Open', onclick: () => { $('autosavesDialog').close(); openSlot(slot); } });
      const remove = Object.assign(docObj.createElement('button'), { type: 'button', textContent: 'Delete', onclick: async () => { await store.remove(slot.id); li.remove(); } });
      li.append(name, open, remove);
      return li;
    }) : [Object.assign(docObj.createElement('li'), { className: 'muted', textContent: 'None yet.' })]));
    $('autosavesDialog').showModal();
  }

  async function drawList() {
    const list = $('autosaveList');
    if (!list) return;
    const doc = state.doc();
    const slots = doc ? await store.list(autosaveKey()).catch(() => []) : [];
    const all = await store.list().catch(() => []);
    list.hidden = !all.length && !doc;
    if (list.hidden) return list.replaceChildren();
    const label = docObj.createElement('span');
    label.className = 'autosave-label';
    label.textContent = slots.length ? 'Automatic saves' : 'No automatic saves of this note';
    const floor = doc?.history_floor || 0, edits = doc?.edit_count || 0;
    const trim = (title, run) => Object.assign(docObj.createElement('button'), { type: 'button', className: 'autosave-trim', title, ariaLabel: title, onclick: run });
    const tell = (button, text, upto, apply) => {
      button.title = `${text}\nWorking out how much space this frees…`;
      previewCut(upto).then((freed) => { apply?.(freed); button.title = `${text}\n${freed == null ? 'Could not work out the space it frees.' : freed > 0 ? `Frees about ${bytesText(freed)} once saved.` : 'Nothing to free: every edit still shapes the note.'}`; });
    };
    const items = await Promise.all(slots.map(async (slot) => {
      const b = docObj.createElement('button');
      b.type = 'button';
      b.textContent = when(slot.time);
      b.title = `Open the automatic save of “${slot.title}” from ${when(slot.time)}`;
      b.onclick = () => openSlot(slot);
      const pair = docObj.createElement('span');
      pair.className = 'autosave-slot';
      pair.append(b);
      const usable = slot.edits > floor && slot.edits <= edits && (await call('prefixDigest', { edits: slot.edits }).catch(() => '')) === slot.digest;
      if (usable) {
        const text = `Delete the history up to this save (${when(slot.time)}): undo stops there; the note stays as it is.`;
        const t = trim(text, () => compact(slot.edits, `up to the automatic save of ${when(slot.time)}`));
        t.append(icon('trim'));
        tell(t, text, slot.edits);
        pair.append(t);
      }
      return pair;
    }));
    const nowBtn = Object.assign(docObj.createElement('button'), { type: 'button', className: 'autosave-now', textContent: 'Delete history up to now', title: 'Delete the whole undo history: the note stays as it is and its file gets smaller', disabled: !doc || (edits <= floor && !doc.can_redo), onclick: () => compact(edits, 'up to now') });
    nowBtn.prepend(icon('trim'));
    if (!nowBtn.disabled) tell(nowBtn, 'Delete the whole undo history: the note stays as it is and its file gets smaller.', edits, (freed) => { if (freed > 0) nowBtn.append(Object.assign(docObj.createElement('span'), { className: 'autosave-saves', textContent: `−${bytesText(freed)}` })); });
    list.replaceChildren(label, ...items, Object.assign(docObj.createElement('button'), { type: 'button', textContent: 'All automatic saves…', onclick: openAllDialog }), nowBtn);
  }

  $('fileMenu')?.addEventListener('toggle', () => { if ($('fileMenu').open) { syncSwitch(); drawList(); } });
  if ($('autosavesClose')) $('autosavesClose').onclick = () => $('autosavesDialog').close();
  if ($('autosavesClear')) $('autosavesClear').onclick = async () => {
    if (!confirmFn('Delete every automatic save on this device?')) return;
    await store.clear();
    $('autosavesDialog').close();
    status('Automatic saves deleted.');
  };

  return {
    now,
    opened,
    compact,
    // An automatic save by its id, opened as when chosen from the list; false when gone.
    async restore(id) {
      const slot = (await store.list()).find((s) => s.id === id);
      if (slot) await openSlot(slot);
      return !!slot;
    },
    takeRecoveringKey() { const k = recoveringKey; recoveringKey = null; return k; },
    markManual() {
      store.markManual(autosaveKey()).catch(() => { /* Optional. */ });
      autosavedRevision = state.revision();
    },
    pref: () => autosavePref,
    setShared(on) { sharedAutosave = !!on; syncSwitch(); },
    async keepCopy() {
      const slot = await now({ force: true });
      sharedAutosave = null;
      syncSwitch();
      return slot && { ...slot, open: () => openSlot(slot), label: when(slot.time) };
    },
  };
}
