// Audio and lightweight edit-history animations added in NoteComplete: recorded here
// or imported audio files, kept per note in the library's settings store
// (`recordings:<fingerprint>`, carried to newer versions like study material, see
// versions.js) and written into .nfedit files by the core.
const MAX_IMPORT = 500 * 1024 * 1024;

export const AUDIO_TYPES = 'audio/*,.m4a,.mp3,.wav,.ogg,.oga,.opus,.webm,.flac,.caf,.aac';
export const ANIMATION_MIME = 'application/vnd.notecomplete.animation+json';

// The first format this engine can record; Chromium records WebM/Opus, Safari MP4.
export function recordingMime(supported = t => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => supported(t)) || '';
}

export function extensionOf(mime, name = '') {
  if (mime === ANIMATION_MIME) return 'json';
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const base = String(mime).split(';')[0].trim();
  return { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/aac': 'aac' }[base] || 'audio';
}

export function recordingTitle(created, locale = 'en') {
  const when = new Date(created);
  return `Recording · ${when.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function animationTitle(created, locale = 'en') {
  const when = new Date(created);
  return `Animation · ${when.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export const clock = s => { const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

// Recordings that came with an opened project file, added to the kept ones once (by id).
export function mergeAdded(kept, incoming) {
  const ids = new Set(kept.map(a => a.id));
  return [...kept, ...incoming.filter(a => a?.id && !ids.has(a.id))];
}

// The layout the core reads: bytes one after another, metadata in the same order.
export async function packAdded(list) {
  const parts = await Promise.all(list.map(async a => new Uint8Array(await a.blob.arrayBuffer())));
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { data.set(p, at); at += p.length; }
  const layout = list.map((a, i) => ({ id: a.id, name: a.name, mime: a.mime, created: a.created, length: parts[i].length }));
  return { audioData: data, audioLayout: JSON.stringify(layout) };
}

export function addedAudio({ store, now = () => Date.now() }) {
  let fingerprint = '', list = [], recorder = null, onchange = () => {};
  const key = fp => `recordings:${fp}`;
  const id = () => `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const elapsedSeconds = (take) => {
    const end = take.pausedAt || now();
    return Math.max(0, (end - take.started - take.paused) / 1000);
  };
  async function read(fp) {
    const value = fp ? await store.get('settings', key(fp)).catch(() => null) : null;
    return Array.isArray(value) ? value.filter(a => a?.id && a.blob instanceof Blob) : [];
  }
  async function write(fp, next) {
    if (fp) await store.set('settings', key(fp), next);
    if (fp === fingerprint) { list = next; onchange(list); }
  }
  async function add(fp, entry) { await write(fp, [...(await read(fp)), entry]); return entry; }

  // Recording: bound to the note it started on, so switching notes mid-take still saves it there.
  async function start() {
    if (recorder) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw Error('This device cannot record audio here.');
    // Raw audio is best for transcribing, but a browser that does not know those settings (Safari
    // on an iPad has refused them) is asked again with none; a refusal by the user is final.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } })
      .catch(error => (['NotAllowedError', 'SecurityError', 'NotFoundError'].includes(error.name) ? Promise.reject(error) : navigator.mediaDevices.getUserMedia({ audio: true })));
    const mime = recordingMime();
    // The same for the recorder: a type or bit rate it rejects falls back to its own choice.
    let media;
    try { media = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : {}); }
    catch { media = new MediaRecorder(stream); }
    const chunks = [], take = { mode: 'audio', fp: fingerprint, media, stream, started: now(), paused: 0, pausedAt: 0 };
    media.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    take.done = new Promise((resolve, reject) => {
      media.onstop = () => resolve(new Blob(chunks, { type: media.mimeType || mime || 'audio/webm' }));
      media.onerror = e => reject(e.error || Error('Recording failed.'));
    });
    media.start(1000);
    recorder = take;
    onchange(list);
  }
  function startAnimation() {
    if (recorder) return;
    recorder = { mode: 'animation', fp: fingerprint, started: now(), paused: 0, pausedAt: 0, state: 'recording', timings: [], pages: [] };
    onchange(list);
  }
  function recordTiming(itemId, pageIndex = 0, strokeDuration = 0.25) {
    if (!recorder || recorder.mode !== 'animation' || recorder.fp !== fingerprint || !itemId) return false;
    const end = elapsedSeconds(recorder);
    const startSec = Math.max(0, end - Math.max(0, Number(strokeDuration) || 0));
    recorder.timings.push({ item_id: String(itemId), start: startSec, end });
    if (Number.isInteger(pageIndex) && pageIndex >= 0 && !recorder.pages.includes(pageIndex)) {
      recorder.pages.push(pageIndex);
    }
    return true;
  }
  function pause() {
    if (!recorder) return;
    if (recorder.mode === 'animation') {
      if (recorder.state === 'recording') { recorder.state = 'paused'; recorder.pausedAt = now(); }
      else if (recorder.state === 'paused') { recorder.state = 'recording'; recorder.paused += now() - recorder.pausedAt; recorder.pausedAt = 0; }
      onchange(list);
      return;
    }
    if (recorder.media.state === 'recording') { recorder.media.pause(); recorder.pausedAt = now(); }
    else if (recorder.media.state === 'paused') { recorder.media.resume(); recorder.paused += now() - recorder.pausedAt; recorder.pausedAt = 0; }
    onchange(list);
  }
  async function stop() {
    const take = recorder;
    if (!take) return null;
    recorder = null;
    if (take.mode === 'animation') {
      try {
        if (!take.timings.length) throw Error('Draw something on a page while recording to keep an animation.');
        const duration = Math.max(elapsedSeconds(take), ...take.timings.map(t => t.end), 0.1);
        const payload = JSON.stringify({ version: 1, duration, pages: take.pages, timings: take.timings });
        const blob = new Blob([payload], { type: ANIMATION_MIME });
        return await add(take.fp, { id: id(), name: animationTitle(take.started), mime: ANIMATION_MIME, created: take.started, blob });
      } finally {
        onchange(list);
      }
    }
    if (take.media.state !== 'inactive') take.media.stop();
    try {
      const blob = await take.done;
      if (!blob.size) throw Error('Nothing was recorded.');
      return await add(take.fp, { id: id(), name: recordingTitle(take.started), mime: blob.type, created: take.started, blob });
    } finally {
      for (const track of take.stream.getTracks()) track.stop();
      onchange(list);
    }
  }
  return {
    get list() { return list; },
    get recording() {
      if (!recorder) return null;
      const paused = recorder.mode === 'animation' ? recorder.state === 'paused' : recorder.media.state === 'paused';
      return { mode: recorder.mode || 'audio', seconds: elapsedSeconds(recorder), paused, here: recorder.fp === fingerprint };
    },
    set onchange(fn) { onchange = fn; },
    async load(fp, incoming = []) {
      fingerprint = fp || '';
      let kept = await read(fingerprint);
      if (incoming.length) {
        const merged = mergeAdded(kept, incoming);
        if (merged.length !== kept.length) { await write(fingerprint, merged).catch((e) => console.warn('Save recordings:', e)); kept = merged; }
      }
      if (fingerprint === (fp || '')) list = kept;
      return list;
    },
    start, startAnimation, recordTiming, pause, stop,
    async import(file) {
      if (file.size > MAX_IMPORT) throw Error('Audio files over 500 MB are not supported.');
      const mime = file.type || `audio/${extensionOf('', file.name)}`;
      return add(fingerprint, { id: id(), name: file.name.replace(/\.[^.]+$/, '') || 'Imported audio', mime, created: now(), blob: file.slice(0, file.size, mime) });
    },
    async remove(audioId) { await write(fingerprint, list.filter(a => a.id !== audioId)); },
    packed: () => packAdded(list),
  };
}
