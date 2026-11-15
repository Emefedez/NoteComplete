/**
 * Overwrite-in-place routing for normal Save (Ctrl+S / Save button).
 * Never overwrites a file whose extension differs from targetExt (e.g. .noteful vs .nfedit).
 */

export function hasMatchingExtension(nameOrPath, targetExt) {
  if (typeof nameOrPath !== 'string' || typeof targetExt !== 'string' || !targetExt) return false;
  return nameOrPath.toLowerCase().endsWith(targetExt.toLowerCase());
}

function saveFiltersFor(targetExt) {
  return targetExt === '.noteful'
    ? [{ name: 'Noteful note', extensions: ['noteful'] }]
    : [{ name: 'NoteComplete project', extensions: ['nfedit'] }];
}

async function ensureReadWritePermission(handle) {
  if (!handle) return false;
  if (typeof handle.queryPermission === 'function') {
    const state = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
    if (state === 'granted') return true;
    if (typeof handle.requestPermission === 'function') {
      const next = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
      return next === 'granted';
    }
    return false;
  }
  return true;
}

export async function saveDocumentInPlace({
  bytes,
  suggestedName,
  targetExt,
  mime = 'application/octet-stream',
  docMember = null,
  noteEntryKey = '',
  saveFileHandle = null,
  bridge = null,
  library = null,
  showSaveFilePicker = null,
  download = null,
}) {
  // 1. Desktop opened/saved local file whose extension matches what we're writing.
  if (
    docMember?.source === 'local'
    && docMember.path
    && typeof bridge?.writeOpened === 'function'
    && hasMatchingExtension(docMember.path, targetExt)
  ) {
    await bridge.writeOpened(docMember.path, bytes);
    return {
      kind: 'local',
      overwritten: true,
      cancelled: false,
      shared: false,
      path: docMember.path,
      name: docMember.name || suggestedName,
      size: bytes.byteLength,
    };
  }

  // 2. Browser File System Access handle whose name/extension matches.
  if (
    saveFileHandle
    && typeof saveFileHandle.createWritable === 'function'
    && hasMatchingExtension(saveFileHandle.name, targetExt)
    && await ensureReadWritePermission(saveFileHandle)
  ) {
    const writable = await saveFileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return {
      kind: 'handle',
      overwritten: true,
      cancelled: false,
      shared: false,
      handle: saveFileHandle,
      name: saveFileHandle.name,
      size: bytes.byteLength,
    };
  }

  // 3. Imported library copy (browser OPFS / Desktop storage) when extension matches.
  const importedKey = docMember?.source === 'imported'
    ? docMember.key
    : (typeof noteEntryKey === 'string' && noteEntryKey.startsWith('imported:') ? noteEntryKey : '');
  if (importedKey && library) {
    const entry = await library.entry(importedKey).catch(() => null);
    if (
      entry?.source === 'imported'
      && entry.filename
      && hasMatchingExtension(entry.filename, targetExt)
      && hasMatchingExtension(entry.name || entry.filename, targetExt)
    ) {
      const loc = await library.location();
      if (loc && loc.kind !== 'none' && typeof loc.write === 'function') {
        await loc.write(entry.filename, new Blob([bytes], { type: mime }));
        const updated = {
          ...entry,
          size: String(bytes.byteLength),
          openedAt: typeof library.now === 'function' ? library.now() : Date.now(),
        };
        await library.store.set('entries', entry.key, updated);
        return {
          kind: 'imported',
          overwritten: true,
          cancelled: false,
          shared: false,
          entry: updated,
          name: updated.name || entry.filename,
          size: bytes.byteLength,
        };
      }
    }
  }

  // 4. First save of a new/converted document (or saving .noteful/.pdf as .nfedit):
  // ask once on Desktop or Chromium so later Ctrl+S overwrites that chosen file.
  if (typeof bridge?.saveFile === 'function') {
    const chosen = await bridge.saveFile(suggestedName, bytes, saveFiltersFor(targetExt));
    if (!chosen) return { kind: 'cancelled', overwritten: false, cancelled: true, shared: false };
    return {
      kind: 'local',
      overwritten: false,
      cancelled: false,
      shared: false,
      path: chosen.path,
      name: chosen.name,
      size: chosen.size ?? bytes.byteLength,
    };
  }

  if (typeof showSaveFilePicker === 'function') {
    try {
      const handle = await showSaveFilePicker({
        suggestedName,
        types: [{
          description: targetExt === '.noteful' ? 'Noteful note' : 'NoteComplete project',
          accept: { [mime]: [targetExt] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return {
        kind: 'handle',
        overwritten: false,
        cancelled: false,
        shared: false,
        handle,
        name: handle.name || suggestedName,
        size: bytes.byteLength,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { kind: 'cancelled', overwritten: false, cancelled: true, shared: false };
      }
      throw error;
    }
  }

  // 5. Fallback (iOS/Firefox/Safari without File System Access): regular download.
  if (typeof download !== 'function') throw Error('No save handler available.');
  const delivery = await download(bytes, suggestedName, mime);
  return {
    kind: 'download',
    overwritten: false,
    cancelled: Boolean(delivery?.cancelled),
    shared: Boolean(delivery?.shared),
    name: suggestedName,
    size: bytes.byteLength,
  };
}
