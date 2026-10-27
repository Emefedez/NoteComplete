import { timedWords, wordAt } from './transcript-timing.js';
import { download } from './download.js';
import { prepareSpeech, speechSettings } from './audio-processing.js';
const $ = id => document.getElementById(id);

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
  } finally { db.close(); }
}

// Export formats: plain text, SRT and WebVTT subtitles (one cue per ~12 words), JSON words.
const stamp = (t, comma) => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${comma ? ',' : '.'}${String(ms % 1000).padStart(3, '0')}`;
};
export function transcriptExport(words, format) {
  if (format === 'json') return JSON.stringify({ words }, null, 2);
  if (format === 'txt') return words.map(w => w.text).join(' ').replace(/\s+([,.;:!?])/g, '$1') + '\n';
  const cues = [];
  for (let i = 0; i < words.length; i += 12) cues.push(words.slice(i, i + 12));
  const body = cues.map((cue, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${stamp(cue[0].start, format === 'srt')} --> ${stamp(cue.at(-1).end ?? cue.at(-1).start, format === 'srt')}\n${cue.map(w => w.text).join(' ')}\n`).join('\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}` : body;
}
// Segments with times (Voxtype pieces, Gemini) become words with interpolated starts.
export function segmentWords(segments) {
  return segments.flatMap(({ start, end, text }) => {
    const parts = text.split(/\s+/).filter(Boolean), span = Math.max(0.2, (end ?? start) - start);
    return parts.map((t, i) => ({ text: t, start: start + (span * i) / parts.length, end: start + (span * (i + 1)) / parts.length }));
  });
}
const MIME = { txt: 'text/plain', srt: 'application/x-subrip', vtt: 'text/vtt', json: 'application/json' };

export class TranscriptController {
  constructor(audio) {
    this.audio = audio;
    this.words = [];
    this.results = new Map();
    this.keys = new Map();
    this.job = null;
    $('hideTranscript').onclick = () => { $('transcriptPanel').open = false; };
    $('transcriptPanel').ontoggle = () => this.update();
    $('transcriptPrevious').onclick = () => this.browse(-1);
    $('transcriptNext').onclick = () => this.browse(1);
    $('transcriptFollow').onchange = () => this.update();
    $('transcribeAudio').onclick = () => this.start();
    $('cancelTranscript').onclick = () => this.cancel();
    $('downloadTranscript').onclick = async () => {
      const format = $('transcriptFormat').value || 'txt';
      try { await download(new Blob([transcriptExport(this.words, format)], { type: MIME[format] }), `transcript.${format}`, MIME[format]); }
      catch (error) { this.status(error.message); }
    };
    $('transcriptBackend').onchange = () => {
      try { localStorage.setItem('notecomplete-transcript-backend', $('transcriptBackend').value); } catch { /* Optional. */ }
      this.describe();
    };
  }
  // Backends: Whisper in the reader, plus what the desktop app finds (Voxtype, Gemini via Antigravity).
  async loadBackends() {
    const select = $('transcriptBackend');
    if (select.dataset.loaded) return;
    select.dataset.loaded = '1';
    const extra = await globalThis.notecompleteTranscribe?.backends?.().catch(() => []) || [];
    for (const b of extra) { const o = new Option(b.available ? b.label : `${b.label} · not installed`, b.id); o.disabled = !b.available; select.add(o); }
    try { const saved = localStorage.getItem('notecomplete-transcript-backend'); if ([...select.options].some(o => o.value === saved && !o.disabled)) select.value = saved; } catch { /* Optional. */ }
    this.describe();
  }
  backend() { return $('transcriptBackend').value || 'whisper'; }
  describe() {
    const b = this.backend();
    $('transcriptModelRow').hidden = b !== 'whisper';
    if (!this.job) this.status(b === 'antigravity' ? 'Gemini transcribes through your Antigravity account: the audio is sent to Google.' : b === 'voxtype' ? 'Voxtype transcribes on this computer with whisper.cpp, piece by piece.' : 'Whisper runs on this device and downloads its model on first use.');
  }
  status(message) { $('transcriptStatus').textContent = message; }
  // Controls for the recording on screen: a job may be running for another one.
  controls() {
    const mine = this.job && this.job.asset.id === this.asset?.id;
    $('transcribeAudio').disabled = !this.asset || !!this.job;
    $('transcribeAudio').title = this.job && !mine ? 'Another recording is being transcribed; see the bar.' : '';
    $('cancelTranscript').hidden = !this.job;
    $('transcriptProgress').hidden = !mine;
  }
  progress(fraction, phase) {
    if (!this.job) return;
    this.job.chip?.set(fraction, phase);
    if (this.job.asset.id === this.asset?.id) {
      $('transcriptProgress').value = Math.round(fraction * 100);
      this.status(`${phase} · playback remains available.`);
    }
  }
  cancel() {
    const job = this.job;
    if (!job) return;
    this.job = null;
    job.cancelled = true;
    job.worker?.terminate();
    if (job.external) globalThis.notecompleteTranscribe?.cancel();
    job.chip?.fail('Transcription cancelled.');
    if (job.asset.id === this.asset?.id) this.render(this.results.get(job.asset.id) || []);
    this.controls();
    this.status('Transcription cancelled.');
  }
  reset() { this.cancel(); this.select(null); this.results.clear(); }
  // Switching recordings keeps a running transcription going in the background.
  select(asset) {
    this.asset = asset;
    this.editing = false;
    this.render(asset ? this.results.get(asset.id) || (this.job?.asset.id === asset.id ? this.job.partial : []) || [] : [], this.job?.asset.id === asset?.id && !this.results.has(asset?.id));
    this.controls();
    this.loadBackends();
    if (!this.job) this.describe();
  }
  render(words, provisional = false) {
    this.words = words;
    this.provisional = provisional;
    this.offset = provisional ? Math.max(0, Math.floor((words.length - 1) / 100) * 100) : 0;
    this.renderWindow();
    $('downloadTranscript').hidden = $('transcriptFormat').hidden = !words.length || provisional;
    $('transcriptEdit').hidden = !words.length || provisional;
    this.update();
  }
  browse(direction) {
    $('transcriptFollow').checked = false;
    this.offset = Math.max(0, Math.min(Math.floor((this.words.length - 1) / 100) * 100, this.offset + direction * 100));
    this.renderWindow(); this.update();
  }
  renderWindow() {
    this.active = -1;
    const fragment = document.createDocumentFragment();
    this.buttons = this.words.slice(this.offset, this.offset + 100).map(word => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = word.text;
      button.title = this.editing ? 'Click to correct this word' : Number.isFinite(word.start) ? `Seek to ${word.start.toFixed(1)} seconds` : '';
      button.onclick = () => (this.editing ? this.editWord(word, button) : Number.isFinite(word.start) && this.audio.seek(word.start));
      fragment.append(button, document.createTextNode(' '));
      return button;
    });
    $('transcriptWords').classList.toggle('provisional', !!this.provisional);
    $('transcriptWords').replaceChildren(fragment);
    $('transcriptNavigation').hidden = !this.words.length;
    $('transcriptPrevious').disabled = this.offset === 0;
    $('transcriptNext').disabled = this.offset + 100 >= this.words.length;
    $('transcriptRange').textContent = `${this.offset + 1}–${Math.min(this.words.length, this.offset + 100)} / ${this.words.length}`;
  }
  update() {
    if (!$('transcriptPanel').open || this.provisional) return;
    const index = wordAt(this.words, this.audio.time);
    if ($('transcriptFollow').checked && index >= 0 && (index < this.offset || index >= this.offset + 100)) {
      this.offset = Math.floor(index / 100) * 100;
      this.renderWindow();
    }
    if (index === this.active) return;
    this.buttons?.[this.active - this.offset]?.removeAttribute('aria-current');
    this.active = index;
    const button = this.buttons?.[index - this.offset];
    button?.setAttribute('aria-current', 'true');
    if (button && $('transcriptPanel').open && !this.audio.audio.paused) {
      const box = $('transcriptWords');
      const top = button.getBoundingClientRect().top - box.getBoundingClientRect().top;
      if (top < 0 || top > box.clientHeight - button.offsetHeight)
        box.scrollTop += top - box.clientHeight / 2;
    }
  }
  // Cache key for a recording under the chosen backend, model, language and processing settings.
  async key(asset, bytes) {
    const language = $('transcriptLanguage').value || '';
    const backend = this.backend();
    const model = backend === 'whisper' ? $('transcriptModel').value || 'base' : backend;
    const settings = speechSettings();
    const buffer = bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    // Local-network HTTP readers can run WASM but may lack SubtleCrypto.
    const digest = globalThis.crypto?.subtle ? await crypto.subtle.digest('SHA-256', buffer) : null;
    return { buffer, language, model, settings, key: digest ? `whisper-v2:${model}:${language}:${JSON.stringify(settings)}:` + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') : null };
  }
  // A transcript made earlier with the current settings, without transcribing.
  async cached(asset) {
    if (this.results.has(asset.id)) return this.results.get(asset.id);
    const { key } = await this.key(asset, await this.audio.read(asset.id));
    this.keys.set(asset.id, key);
    const words = key ? await storedTranscript(key) : null;
    if (words) this.results.set(asset.id, words);
    return words;
  }
  // One transcription at a time, kept as a background job with a chip in the bar.
  async start() {
    if (!this.asset || this.job) return;
    const asset = this.asset, backend = this.backend();
    const name = this.audio.label?.(this.audio.entries.find(e => e.asset?.id === asset.id)) || 'recording';
    const job = this.job = { asset, backend, partial: [] };
    job.chip = this.jobs?.start(`Transcript · ${name}`, { kind: 'transcript', cancel: () => this.cancel() });
    this.controls();
    $('transcriptPanel').open = true;
    this.progress(0.02, 'Preparing audio');
    const alive = () => this.job === job;
    const shows = () => this.asset?.id === asset.id;
    // Partial text, shown greyed while the rest is being transcribed.
    const partial = words => { job.partial = words; if (shows() && !this.results.has(asset.id)) this.render(words, true); };
    try {
      const bytes = await this.audio.read(asset.id);
      if (!alive()) return;
      const { buffer, language, model, settings, key } = await this.key(asset, bytes);
      this.keys.set(asset.id, key);
      const cached = key ? await storedTranscript(key).catch(() => null) : null;
      if (!alive()) return;
      if (cached) return this.finish(cached, asset, job);
      let words;
      if (backend === 'whisper') {
        const { samples, duration } = await prepareSpeech(buffer, settings);
        if (!alive()) return;
        words = await new Promise((resolve, reject) => {
          const worker = job.worker = new Worker(new URL('./transcript-worker.js', import.meta.url), { type: 'module' });
          this.progress(0.05, 'Loading Whisper (downloads once)');
          worker.onerror = event => reject(Error(event.message || 'The local speech engine could not start'));
          worker.onmessage = ({ data }) => {
            if (!alive()) return;
            if (data.type === 'progress' && data.progress.status === 'progress') this.progress(0.05 * (data.progress.progress || 0) / 100, `Loading speech model ${Math.round(data.progress.progress || 0)} %`);
            if (data.type === 'speaking') {
              this.progress(0.05 + 0.95 * data.done / data.total, `Transcribing ${Math.round(100 * data.done / data.total)} %`);
              if (data.text) partial([...job.partial, ...data.text.split(/\s+/).filter(Boolean).map(text => ({ text }))]);
            }
            if (data.type === 'error') reject(Error(data.error));
            if (data.type === 'complete') resolve(timedWords(data.result.chunks, duration));
          };
          worker.postMessage({ samples, language, model }, [samples.buffer]);
        }).finally(() => { job.worker?.terminate(); job.worker = null; });
      } else {
        job.external = true;
        this.progress(0.03, backend === 'antigravity' ? 'Sending audio to Gemini' : 'Splitting audio for Voxtype');
        const segments = await globalThis.notecompleteTranscribe.run({ backend, bytes: new Uint8Array(buffer), language }, ({ done, total, segments }) => {
          if (!alive()) return;
          this.progress(0.03 + 0.97 * done / total, `Piece ${done} of ${total}`);
          partial(segmentWords(segments));
        });
        words = segmentWords(segments);
      }
      if (!alive()) return;
      this.finish(words, asset, job);
      if (key) storedTranscript(key, words).catch(() => { if (shows()) this.status('Transcript ready for this session; export it to keep it.'); });
    } catch (error) {
      if (!alive()) return;
      this.job = null;
      job.chip?.fail(`Could not transcribe: ${error.message}`);
      if (shows()) { this.render(this.results.get(asset.id) || []); this.status(`Could not transcribe: ${error.message}. You can retry.`); }
      this.controls();
    }
  }
  // Edit mode: a word becomes a text box; its timing is kept. Corrections are
  // stored with the cached transcript and reach Find and the AI context.
  toggleEdit() {
    this.editing = !this.editing;
    $('transcriptEdit').setAttribute('aria-pressed', String(this.editing));
    $('transcriptEdit').textContent = this.editing ? 'Done' : 'Edit';
    this.status(this.editing ? 'Click a word to correct it; Enter keeps it, Esc cancels, an empty word is removed.' : 'Corrections saved.');
    this.renderWindow();
  }
  editWord(word, button) {
    const input = document.createElement('input');
    input.value = word.text; input.className = 'transcript-word-edit';
    input.size = Math.max(3, word.text.length + 1);
    button.replaceWith(input);
    input.focus(); input.select();
    const finish = save => {
      if (!input.isConnected) return;
      if (save) {
        const text = input.value.trim();
        if (text) word.text = text;
        else this.words.splice(this.words.indexOf(word), 1);
        this.saveEdits();
      }
      this.renderWindow();
    };
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
    input.onblur = () => finish(true);
  }
  saveEdits() {
    const asset = this.asset, key = asset && this.keys?.get(asset.id);
    if (!asset) return;
    this.results.set(asset.id, this.words);
    this.onwords?.(asset, this.words);
    if (key) storedTranscript(key, this.words).catch(() => this.status('Correction kept for this session only.'));
  }
  finish(words, asset, job = this.job) {
    if (job && this.job === job) this.job = null;
    this.results.set(asset.id, words);
    this.onwords?.(asset, words);
    job?.chip?.finish(words.length ? `Transcript ready: ${words.length} words.` : 'No speech detected.');
    if (this.asset?.id === asset.id) {
      this.render(words);
      this.status(words.length ? 'Transcript ready. Click a word to seek. Automatic words and timings may need correction.' : 'No timed speech detected.');
    }
    this.controls();
  }
}
