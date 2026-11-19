// Batch audio transcription for Recent notes: discovers native Noteful recordings and added
// recordings inside .noteful, .nfedit, .notecomp and .notepart files, greys out notes without
// audio during selection mode, selects notes (and individual recordings when a note has multiple
// audios, all selected by default) with the standard circle tick, and runs batch transcription.
import { fields, noteIndex, blobReader } from './note-cover.js';
import { ANIMATION_MIME } from './recorder.js';
import { prepareSpeech, speechSettings } from './audio-processing.js';
import { timedWords } from './transcript-timing.js';
import { transcriptExport, segmentWords } from './transcript.js';
import { download } from './download.js';
import { entryTitle } from './library.js';
import { openContextMenu } from './context-menu.js';

const NOTE_AUDIO_EXT = /\.(noteful|nfedit|notecomp(lete)?|notepart|tar)$/i;
const get = (map, ...path) => path.reduce((v, k) => (v instanceof Map ? v.get(k) : undefined), map);

export const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const s = Math.max(1, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

function formatRecordingLabel(rawName, startUs, index) {
  if (typeof rawName === 'string' && rawName.trim()) return rawName.trim();
  if (startUs) {
    try {
      const date = new Date(Number(BigInt(startUs) / 1000n) + 978307200000);
      if (Number.isFinite(date.getTime())) {
        return `Recording ${index + 1} · ${date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}`;
      }
    } catch { /* Fallback below */ }
  }
  return `Audio ${index + 1}`;
}

// Parse native Noteful recordings from a ranged reader (read(start, end), size).
export async function readNotefulRecordings(read, size) {
  const { keys, extent, slice } = await noteIndex(read, size);
  const drawing = keys.find((k) => typeof k === 'string' && k.startsWith('d:'));
  if (!drawing) return [];
  const d = fields(await slice(...extent(drawing)));
  const rawList = get(d, 7, 0) || [];
  const out = [];
  for (let i = 0; i < rawList.length; i++) {
    const r = rawList[i];
    if (!(r instanceof Map)) continue;
    const id = String(r.get(1) || `rec-${i}`);
    const rawName = String(r.get(2) || '');
    const assetId = String(r.get(3) || '');
    const startUs = r.get(5);
    const duration = Number(r.get(6));
    if (!Number.isFinite(duration) || duration < 0) continue;
    const blockExtent = assetId ? extent(assetId) : null;
    if (!blockExtent) continue; // Animation-only recording with no audio media
    out.push({
      id: assetId || id,
      assetId: assetId || id,
      name: formatRecordingLabel(rawName, startUs, out.length),
      duration,
      mime: 'audio/mp4',
      readBytes: async () => {
        const bytes = await slice(...blockExtent);
        return bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
      },
    });
  }
  return out;
}

// Walk a tar archive (.nfedit, .notecomp, .notepart) to find note.noteful and any bundled audio/N members.
export async function readTarNoteRecordings(read, size) {
  const text = (bytes) => new TextDecoder().decode(bytes).replace(/\0.*$/s, '');
  let notefulRange = null;
  let manifestRange = null;
  const audioMembers = new Map();

  for (let at = 0, members = 0; at + 512 <= size && members < 512; members++) {
    const header = await read(at, at + 512);
    if (header.length < 512 || header.every((b) => b === 0)) break;
    if (text(header.subarray(257, 262)) !== 'ustar') return null;
    const length = parseInt(text(header.subarray(124, 136)).trim() || '0', 8);
    if (!Number.isFinite(length) || length < 0) return null;
    const prefix = text(header.subarray(345, 500));
    const name = text(header.subarray(0, 100));
    const path = prefix ? `${prefix}/${name}` : name;
    const type = header[156];
    const start = at + 512;
    if ((type === 0 || type === 0x30) && start + length <= size) {
      if (/\.noteful$/i.test(path)) {
        notefulRange = [start, length];
      } else if (path === 'manifest.json') {
        manifestRange = [start, length];
      } else if (/^audio\//i.test(path)) {
        audioMembers.set(path, [start, length]);
      }
    }
    at = start + Math.ceil(length / 512) * 512;
  }

  if (!notefulRange && !manifestRange) return null;
  const results = [];
  if (notefulRange) {
    const [nStart, nLen] = notefulRange;
    const native = await readNotefulRecordings((a, b) => read(nStart + a, nStart + b), nLen).catch(() => []);
    results.push(...native);
  }
  if (manifestRange && audioMembers.size) {
    try {
      const [mStart, mLen] = manifestRange;
      const mBytes = await read(mStart, mStart + mLen);
      const manifest = JSON.parse(new TextDecoder().decode(mBytes));
      const addedList = Array.isArray(manifest?.added_audio) ? manifest.added_audio : [];
      addedList.forEach((meta, idx) => {
        if (!meta || meta.mime === ANIMATION_MIME) return;
        const range = audioMembers.get(`audio/${idx}`);
        if (!range) return;
        const [aStart, aLen] = range;
        results.push({
          id: `added:${meta.id || idx}`,
          assetId: `added:${meta.id || idx}`,
          name: meta.name || `Added Audio ${idx + 1}`,
          duration: Number(meta.duration) || 0,
          mime: meta.mime || 'audio/webm',
          readBytes: async () => {
            const b = await read(aStart, aStart + aLen);
            return b instanceof Uint8Array ? b.slice() : new Uint8Array(b);
          },
        });
      });
    } catch { /* Ignore malformed manifest */ }
  }
  return results;
}

// Discover all audio recordings for a Recent library entry.
export async function discoverNoteRecordings(entry, library) {
  if (!entry || entry.source === 'web' || !NOTE_AUDIO_EXT.test(entry.name || '')) return [];
  const file = await library.open(entry).catch(() => null);
  if (!file || !(file.size >= 20)) return [];
  const reader = blobReader(file);
  if (/\.noteful$/i.test(entry.name || '')) {
    return readNotefulRecordings(reader, file.size).catch(() => []);
  }
  const fromTar = await readTarNoteRecordings(reader, file.size).catch(() => null);
  if (fromTar) return fromTar;
  return readNotefulRecordings(reader, file.size).catch(() => []);
}

async function storedTranscript(key, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('notecomplete-transcripts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('transcripts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('transcripts', value ? 'readwrite' : 'readonly');
      const store = tx.objectStore('transcripts');
      const request = value ? store.put(value, key) : store.get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function transcriptCacheKey(bytes, { backend = 'whisper', model = 'base', language = '', settings = speechSettings() } = {}) {
  const effectiveModel = backend === 'whisper' ? (model || 'base') : backend;
  const buffer = bytes instanceof ArrayBuffer
    ? bytes.slice(0)
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = globalThis.crypto?.subtle ? await crypto.subtle.digest('SHA-256', buffer) : null;
  const key = digest
    ? `whisper-v2:${effectiveModel}:${language}:${JSON.stringify(settings)}:` + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    : null;
  return { buffer, key, settings, effectiveModel };
}

function runWhisperWorker(samples, duration, { language, model }, job, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = (job.worker = new Worker(new URL('./transcript-worker.js', import.meta.url), { type: 'module' }));
    worker.onerror = (event) => reject(Error(event.message || 'The local speech engine could not start'));
    worker.onmessage = ({ data }) => {
      if (job.cancelled) return;
      if (data.type === 'progress' && data.progress?.status === 'progress') {
        onProgress(0.05 * ((data.progress.progress || 0) / 100), `Loading Whisper model ${Math.round(data.progress.progress || 0)}%`);
      }
      if (data.type === 'speaking') {
        onProgress(0.05 + 0.95 * (data.done / Math.max(1, data.total)), `Transcribing ${Math.round((100 * data.done) / Math.max(1, data.total))}%`);
      }
      if (data.type === 'error') reject(Error(data.error));
      if (data.type === 'complete') resolve(timedWords(data.result.chunks, duration));
    };
    worker.postMessage({ samples, language, model }, [samples.buffer]);
  }).finally(() => {
    job.worker?.terminate();
    job.worker = null;
  });
}

export function setupBatchTranscribe({ library, status = () => {}, jobs = null, doc = document }) {
  const $ = (id) => doc.getElementById(id);
  let selecting = false;
  // Map<entryKey, { entry, title, recordings: Array, selectedIds: Set<string> }>
  const noteMap = new Map();
  const selectedNotes = new Set();
  let inspectToken = 0;

  function totalSelectedRecordings() {
    let notes = 0, recs = 0;
    for (const key of selectedNotes) {
      const info = noteMap.get(key);
      if (!info) continue;
      const count = info.selectedIds.size;
      if (count > 0) {
        notes++;
        recs += count;
      }
    }
    return { notes, recs };
  }

  function selectableCards() {
    return [...doc.querySelectorAll('#recentList .note-card.has-audio')].filter((c) => !c.closest('li')?.hidden);
  }

  function updateToolbar() {
    const modeBtn = $('batchTranscribeMode');
    const allBtn = $('batchTranscribeSelectAll');
    const startBtn = $('batchTranscribeStart');
    const cancelBtn = $('batchTranscribeCancel');
    if (!modeBtn) return;

    modeBtn.hidden = selecting;
    if (allBtn) allBtn.hidden = !selecting;
    if (startBtn) startBtn.hidden = !selecting;
    if (cancelBtn) cancelBtn.hidden = !selecting;

    if (!selecting) return;
    const cards = selectableCards();
    const allSelected = cards.length > 0 && cards.every((c) => selectedNotes.has(c.dataset.entryKey));
    if (allBtn) {
      allBtn.textContent = allSelected ? 'Deselect all' : 'Select all';
      allBtn.disabled = cards.length === 0;
    }
    const { notes, recs } = totalSelectedRecordings();
    if (startBtn) {
      startBtn.disabled = recs === 0;
      startBtn.textContent = recs > 0 ? `Transcribe (${notes} ${notes === 1 ? 'note' : 'notes'} · ${recs} ${recs === 1 ? 'audio' : 'audios'})…` : 'Transcribe (0)…';
    }
  }

  function syncCardVisual(card) {
    const key = card?.dataset?.entryKey;
    if (!key) return;
    const info = noteMap.get(key);
    const hasAudio = Boolean(info && info.recordings.length > 0);
    const isSel = hasAudio && selectedNotes.has(key) && info.selectedIds.size > 0;
    card.classList.toggle('has-audio', hasAudio);
    card.classList.toggle('no-audio', !hasAudio);
    card.classList.toggle('is-selected', isSel);

    let pill = card.parentElement?.querySelector('.card-audio-pick');
    if (!selecting || !hasAudio) {
      if (pill) pill.hidden = true;
      return;
    }
    if (!pill) {
      pill = doc.createElement('button');
      pill.type = 'button';
      pill.className = 'chip card-audio-pick';
      pill.onclick = (e) => {
        e.stopPropagation();
        openCardAudioMenu(card, pill, info);
      };
      card.parentElement?.append(pill);
    }
    pill.hidden = false;
    const total = info.recordings.length;
    const picked = isSel ? info.selectedIds.size : total;
    pill.textContent = total > 1 ? `${picked}/${total} audios ▾` : `1 audio (${formatDuration(info.recordings[0]?.duration)})`;
    pill.title = total > 1 ? 'Choose which audio recordings in this note to transcribe (all selected by default)' : info.recordings[0]?.name || '1 audio recording';
  }

  function openCardAudioMenu(card, anchor, info) {
    const key = info.entry.key;
    if (!selectedNotes.has(key)) {
      selectedNotes.add(key);
      if (!info.selectedIds.size) info.recordings.forEach((r) => info.selectedIds.add(r.id));
    }
    const r = anchor.getBoundingClientRect();
    const rebuild = () => {
      openContextMenu(r.left, r.bottom + 4, [
        {
          label: info.selectedIds.size === info.recordings.length ? 'Deselect all audios in this note' : 'Select all audios in this note',
          icon: 'check',
          run: () => {
            if (info.selectedIds.size === info.recordings.length) {
              info.selectedIds.clear();
              selectedNotes.delete(key);
            } else {
              info.recordings.forEach((rec) => info.selectedIds.add(rec.id));
              selectedNotes.add(key);
            }
            syncCardVisual(card);
            updateToolbar();
          },
        },
        '-',
        ...info.recordings.map((rec) => ({
          label: `${rec.name} (${formatDuration(rec.duration)})`,
          checked: info.selectedIds.has(rec.id),
          run: () => {
            if (info.selectedIds.has(rec.id)) info.selectedIds.delete(rec.id);
            else info.selectedIds.add(rec.id);
            if (info.selectedIds.size === 0) selectedNotes.delete(key);
            else selectedNotes.add(key);
            syncCardVisual(card);
            updateToolbar();
            setTimeout(rebuild, 0);
          },
        })),
      ], { title: `${info.title} · Audios` });
    };
    rebuild();
  }

  async function inspectRecentCards() {
    const token = ++inspectToken;
    const cards = [...doc.querySelectorAll('#recentList .note-card')];
    await Promise.all(cards.map(async (card) => {
      const entry = card.noteEntry;
      if (!entry) {
        card.classList.add('no-audio');
        return;
      }
      card.dataset.entryKey = entry.key;
      let info = noteMap.get(entry.key);
      if (!info) {
        const recordings = await discoverNoteRecordings(entry, library).catch(() => []);
        if (token !== inspectToken) return;
        info = {
          entry,
          title: entryTitle(entry),
          recordings,
          // By default, all recordings in the note are selected for transcription
          selectedIds: new Set(recordings.map((r) => r.id)),
        };
        noteMap.set(entry.key, info);
      }
      if (card.note && info.recordings.length > 0 && !card.note.facts?.audio?.count) {
        card.note.facts = {
          ...(card.note.facts || { title: info.title, pages: 0, tags: [] }),
          audio: {
            count: info.recordings.length,
            seconds: info.recordings.reduce((sum, r) => sum + (Number(r.duration) || 0), 0),
          },
        };
      }
      syncCardVisual(card);
    }));
    if (token === inspectToken) updateToolbar();
  }

  function enterSelectionMode() {
    selecting = true;
    selectedNotes.clear();
    for (const info of noteMap.values()) {
      info.selectedIds = new Set(info.recordings.map((r) => r.id));
    }
    $('recentList')?.classList.add('queue-selecting', 'batch-transcribe-selecting');
    updateToolbar();
    void inspectRecentCards();
  }

  function exitSelectionMode() {
    selecting = false;
    inspectToken++;
    selectedNotes.clear();
    $('recentList')?.classList.remove('queue-selecting', 'batch-transcribe-selecting');
    for (const card of doc.querySelectorAll('#recentList .note-card')) {
      card.classList.remove('is-selected', 'no-audio', 'has-audio');
    }
    for (const pill of doc.querySelectorAll('#recentList .card-audio-pick')) {
      pill.hidden = true;
    }
    updateToolbar();
  }

  function handleCardClick(card, entry) {
    if (!selecting) return false;
    const key = entry?.key || card.dataset.entryKey;
    const info = noteMap.get(key);
    if (!info || info.recordings.length === 0) {
      status('This note has no audio recordings to transcribe.');
      return true;
    }
    if (selectedNotes.has(key)) {
      selectedNotes.delete(key);
    } else {
      selectedNotes.add(key);
      if (info.selectedIds.size === 0) {
        // Restore default: all recordings selected
        info.recordings.forEach((r) => info.selectedIds.add(r.id));
      }
    }
    syncCardVisual(card);
    updateToolbar();
    return true;
  }

  function toggleSelectAll() {
    if (!selecting) return;
    const cards = selectableCards();
    const allSelected = cards.length > 0 && cards.every((c) => selectedNotes.has(c.dataset.entryKey));
    for (const card of cards) {
      const key = card.dataset.entryKey;
      const info = noteMap.get(key);
      if (!info || !info.recordings.length) continue;
      if (allSelected) {
        selectedNotes.delete(key);
      } else {
        selectedNotes.add(key);
        info.recordings.forEach((r) => info.selectedIds.add(r.id));
      }
      syncCardVisual(card);
    }
    updateToolbar();
  }

  async function openBatchDialog() {
    const dlg = $('batchTranscribeDialog');
    if (!dlg) return;

    // Populate backends from #transcriptBackend (and desktop backends if available)
    const backendSel = $('btBackend');
    if (backendSel && !backendSel.dataset.loaded) {
      backendSel.dataset.loaded = '1';
      const extra = await globalThis.notecompleteTranscribe?.backends?.().catch(() => []) || [];
      for (const b of extra) {
        if (![...backendSel.options].some((o) => o.value === b.id)) {
          const o = new Option(b.available ? b.label : `${b.label} · not installed`, b.id);
          o.disabled = !b.available;
          backendSel.add(o);
        }
      }
    }
    const syncModelRow = () => {
      if ($('btModelField')) $('btModelField').hidden = ($('btBackend')?.value || 'whisper') !== 'whisper';
    };
    if (backendSel) backendSel.onchange = syncModelRow;
    syncModelRow();

    const listEl = $('btNotesList');
    const summaryEl = $('btSummary');
    const confirmBtn = $('btConfirmBtn');
    const selectAllModalBtn = $('btModalSelectAll');

    function renderModalChecklist() {
      listEl.replaceChildren();
      const activeInfos = [...noteMap.values()].filter((info) => info.recordings.length > 0 && (selectedNotes.has(info.entry.key) || info.selectedIds.size > 0));
      for (const info of activeInfos) {
        const noteLi = doc.createElement('div');
        noteLi.className = 'bt-note-group';
        const noteSelected = selectedNotes.has(info.entry.key) && info.selectedIds.size > 0;

        const head = doc.createElement('div');
        head.className = `bt-note-head${noteSelected ? ' is-selected' : ''}`;
        head.innerHTML = `<span class="note-select-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span>
          <strong class="bt-note-title"></strong>
          <span class="muted bt-note-count"></span>`;
        head.querySelector('.bt-note-title').textContent = info.title;
        head.querySelector('.bt-note-count').textContent = `${info.selectedIds.size} of ${info.recordings.length} ${info.recordings.length === 1 ? 'audio' : 'audios'}`;
        head.onclick = () => {
          if (noteSelected && info.selectedIds.size === info.recordings.length) {
            info.selectedIds.clear();
            selectedNotes.delete(info.entry.key);
          } else {
            info.recordings.forEach((r) => info.selectedIds.add(r.id));
            selectedNotes.add(info.entry.key);
          }
          const card = doc.querySelector(`#recentList .note-card[data-entry-key="${CSS.escape(info.entry.key)}"]`);
          if (card) syncCardVisual(card);
          updateToolbar();
          renderModalChecklist();
        };
        noteLi.append(head);

        if (info.recordings.length > 1) {
          const recUl = doc.createElement('div');
          recUl.className = 'bt-rec-list';
          for (const rec of info.recordings) {
            const on = noteSelected && info.selectedIds.has(rec.id);
            const row = doc.createElement('button');
            row.type = 'button';
            row.className = `bt-rec-row${on ? ' is-selected' : ''}`;
            row.innerHTML = `<span class="note-select-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span>
              <span class="bt-rec-name"></span>
              <span class="muted bt-rec-dur"></span>`;
            row.querySelector('.bt-rec-name').textContent = rec.name;
            row.querySelector('.bt-rec-dur').textContent = formatDuration(rec.duration);
            row.onclick = () => {
              if (on) {
                info.selectedIds.delete(rec.id);
                if (info.selectedIds.size === 0) selectedNotes.delete(info.entry.key);
              } else {
                info.selectedIds.add(rec.id);
                selectedNotes.add(info.entry.key);
              }
              const card = doc.querySelector(`#recentList .note-card[data-entry-key="${CSS.escape(info.entry.key)}"]`);
              if (card) syncCardVisual(card);
              updateToolbar();
              renderModalChecklist();
            };
            recUl.append(row);
          }
          noteLi.append(recUl);
        }
        listEl.append(noteLi);
      }

      const { notes, recs } = totalSelectedRecordings();
      if (summaryEl) summaryEl.textContent = `${notes} ${notes === 1 ? 'note' : 'notes'} · ${recs} ${recs === 1 ? 'recording' : 'recordings'} queued`;
      if (confirmBtn) {
        confirmBtn.disabled = recs === 0;
        confirmBtn.textContent = recs > 0 ? `Transcribe ${recs} ${recs === 1 ? 'audio' : 'audios'}` : 'Transcribe';
      }
      if (selectAllModalBtn) {
        const allChecked = activeInfos.length > 0 && activeInfos.every((info) => selectedNotes.has(info.entry.key) && info.selectedIds.size === info.recordings.length);
        selectAllModalBtn.textContent = allChecked ? 'Deselect all' : 'Select all';
        selectAllModalBtn.onclick = () => {
          for (const info of activeInfos) {
            if (allChecked) {
              info.selectedIds.clear();
              selectedNotes.delete(info.entry.key);
            } else {
              info.recordings.forEach((r) => info.selectedIds.add(r.id));
              selectedNotes.add(info.entry.key);
            }
            const card = doc.querySelector(`#recentList .note-card[data-entry-key="${CSS.escape(info.entry.key)}"]`);
            if (card) syncCardVisual(card);
          }
          updateToolbar();
          renderModalChecklist();
        };
      }
    }

    renderModalChecklist();
    dlg.showModal();
  }

  async function runBatchTranscription() {
    const dlg = $('batchTranscribeDialog');
    const backend = $('btBackend')?.value || 'whisper';
    const model = $('btModel')?.value || 'base';
    const language = $('btLanguage')?.value || '';
    const saveCache = $('btOutCache') ? $('btOutCache').checked : true;
    const appendNotes = $('btOutNotes') ? $('btOutNotes').checked : false;
    const downloadFile = $('btOutDownload') ? $('btOutDownload').checked : false;
    const format = $('btFormat')?.value || 'txt';
    const skipCached = $('btSkipCached') ? $('btSkipCached').checked : true;

    const tasks = [];
    for (const key of selectedNotes) {
      const info = noteMap.get(key);
      if (!info) continue;
      for (const rec of info.recordings) {
        if (info.selectedIds.has(rec.id)) {
          tasks.push({ info, rec });
        }
      }
    }
    if (!tasks.length) return;

    dlg?.close();
    exitSelectionMode();

    const jobState = { cancelled: false, worker: null, external: false };
    const chip = jobs?.start(`Batch transcript · ${tasks.length} ${tasks.length === 1 ? 'audio' : 'audios'}`, {
      kind: 'transcript',
      cancel: () => {
        jobState.cancelled = true;
        jobState.worker?.terminate();
        if (jobState.external) globalThis.notecompleteTranscribe?.cancel?.();
        chip?.fail('Batch transcription cancelled.');
      },
    });

    let completed = 0;
    const combinedOutputs = [];

    try {
      for (let i = 0; i < tasks.length; i++) {
        if (jobState.cancelled) return;
        const { info, rec } = tasks[i];
        const prefix = `[${i + 1}/${tasks.length}] ${info.title} (${rec.name})`;
        chip?.set(i / tasks.length, `${prefix}: reading audio…`);
        status(`Batch transcribing ${prefix}…`);

        const bytes = await rec.readBytes();
        if (jobState.cancelled) return;
        const { buffer, key, settings } = await transcriptCacheKey(bytes, { backend, model, language });
        let words = skipCached && key ? await storedTranscript(key).catch(() => null) : null;

        if (!words) {
          if (backend === 'whisper') {
            const { samples, duration } = await prepareSpeech(buffer, settings);
            if (jobState.cancelled) return;
            words = await runWhisperWorker(samples, duration, { language, model }, jobState, (share, label) => {
              chip?.set((i + share) / tasks.length, `${prefix}: ${label}`);
            });
          } else {
            jobState.external = true;
            const segments = await globalThis.notecompleteTranscribe.run(
              { backend, bytes: new Uint8Array(buffer), language },
              ({ done, total }) => {
                chip?.set((i + done / Math.max(1, total)) / tasks.length, `${prefix}: piece ${done}/${total}`);
              },
            );
            words = segmentWords(segments);
          }
          if (jobState.cancelled) return;
          if (saveCache && key && words?.length) {
            await storedTranscript(key, words).catch(() => {});
          }
        }

        if (words?.length) {
          completed++;
          const plain = transcriptExport(words, 'txt').trim();
          if (appendNotes && plain) {
            const noteKey = `notes:${info.entry.key}`;
            const existing = (await library.store.get('settings', noteKey).catch(() => '')) || '';
            const block = `\n\n## Transcript — ${rec.name}\n\n${plain}\n`;
            await library.store.set('settings', noteKey, `${existing.trimEnd()}${block}`).catch(() => {});
          }
          if (downloadFile) {
            combinedOutputs.push({
              title: info.title,
              recName: rec.name,
              words,
              content: transcriptExport(words, format),
            });
          }
        }
      }

      if (downloadFile && combinedOutputs.length) {
        const MIME = { txt: 'text/plain', srt: 'application/x-subrip', vtt: 'text/vtt', json: 'application/json' };
        if (combinedOutputs.length === 1) {
          const single = combinedOutputs[0];
          const safe = `${single.title} - ${single.recName}`.replace(/[^\w.\- ]+/g, '_');
          await download(new Blob([single.content], { type: MIME[format] }), `${safe}.${format}`, MIME[format]);
        } else {
          const joined = format === 'json'
            ? JSON.stringify(combinedOutputs.map((o) => ({ note: o.title, recording: o.recName, words: o.words })), null, 2)
            : combinedOutputs.map((o) => `# ${o.title} — ${o.recName}\n\n${o.content.trim()}`).join('\n\n---\n\n') + '\n';
          await download(new Blob([joined], { type: MIME[format] }), `batch-transcripts.${format}`, MIME[format]);
        }
      }

      chip?.finish(`Transcribed ${completed} of ${tasks.length} ${tasks.length === 1 ? 'recording' : 'recordings'}.`);
      status(`Batch transcription finished: ${completed} of ${tasks.length} ${tasks.length === 1 ? 'recording' : 'recordings'} ready.`);
    } catch (err) {
      if (jobState.cancelled) return;
      chip?.fail(`Batch transcription failed: ${err.message}`);
      status(`Batch transcription failed: ${err.message}`, true);
    }
  }

  if ($('batchTranscribeMode')) $('batchTranscribeMode').onclick = () => enterSelectionMode();
  if ($('batchTranscribeSelectAll')) $('batchTranscribeSelectAll').onclick = () => toggleSelectAll();
  if ($('batchTranscribeCancel')) $('batchTranscribeCancel').onclick = () => exitSelectionMode();
  if ($('batchTranscribeStart')) $('batchTranscribeStart').onclick = () => { void openBatchDialog(); };
  if ($('btCancelBtn')) $('btCancelBtn').onclick = () => $('batchTranscribeDialog')?.close();
  if ($('btConfirmBtn')) $('btConfirmBtn').onclick = () => { void runBatchTranscription(); };

  return {
    get selecting() { return selecting; },
    handleCardClick,
    onRecentRendered: () => {
      if (selecting) void inspectRecentCards();
    },
    exitSelectionMode,
  };
}
