// Audio added in NoteComplete: recorded here or imported, kept per note in the
// library's settings store (`recordings:<fingerprint>`, carried to newer versions
// like study material, see versions.js) and written into .notecomp files by the core.
const MAX_IMPORT = 500 * 1024 * 1024;

export const AUDIO_TYPES = 'audio/*,.m4a,.mp3,.wav,.ogg,.oga,.opus,.webm,.flac,.caf,.aac';

// The first format this engine can record; Chromium records WebM/Opus, Safari MP4.
export function recordingMime(supported = t => globalThis.MediaRecorder?.isTypeSupported?.(t)) {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => supported(t)) || '';
}

export function extensionOf(mime, name = '') {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const base = String(mime).split(';')[0].trim();
  return { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/aac': 'aac' }[base] || 'audio';
}

export function recordingTitle(created, locale = 'en') {
  const when = new Date(created);
  return `Recording · ${when.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Recordings that came with an opened .notecomp, added to the kept ones once (by id).
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    const mime = recordingMime();
    const media = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : {});
    const chunks = [], take = { fp: fingerprint, media, stream, started: now(), paused: 0, pausedAt: 0 };
    media.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    take.done = new Promise((resolve, reject) => {
      media.onstop = () => resolve(new Blob(chunks, { type: media.mimeType || mime || 'audio/webm' }));
      media.onerror = e => reject(e.error || Error('Recording failed.'));
    });
    media.start(1000);
    recorder = take;
    onchange(list);
  }
  function pause() {
    if (!recorder) return;
    if (recorder.media.state === 'recording') { recorder.media.pause(); recorder.pausedAt = now(); }
    else if (recorder.media.state === 'paused') { recorder.media.resume(); recorder.paused += now() - recorder.pausedAt; recorder.pausedAt = 0; }
    onchange(list);
  }
  async function stop() {
    const take = recorder;
    if (!take) return null;
    recorder = null;
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
      const end = recorder.pausedAt || now();
      return { seconds: (end - recorder.started - recorder.paused) / 1000, paused: recorder.media.state === 'paused', here: recorder.fp === fingerprint };
    },
    set onchange(fn) { onchange = fn; },
    async load(fp, incoming = []) {
      fingerprint = fp || '';
      let kept = await read(fingerprint);
      if (incoming.length) {
        const merged = mergeAdded(kept, incoming);
        if (merged.length !== kept.length) { await write(fingerprint, merged).catch(() => {}); kept = merged; }
      }
      if (fingerprint === (fp || '')) list = kept;
      return list;
    },
    start, pause, stop,
    async import(file) {
      if (file.size > MAX_IMPORT) throw Error('Audio files over 500 MB are not supported.');
      const mime = file.type || `audio/${extensionOf('', file.name)}`;
      return add(fingerprint, { id: id(), name: file.name.replace(/\.[^.]+$/, '') || 'Imported audio', mime, created: now(), blob: file.slice(0, file.size, mime) });
    },
    async remove(audioId) { await write(fingerprint, list.filter(a => a.id !== audioId)); },
    packed: () => packAdded(list),
  };
}
