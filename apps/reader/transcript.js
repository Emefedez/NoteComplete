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

export class TranscriptController {
  constructor(audio) {
    this.audio = audio;
    this.generation = 0;
    this.words = [];
    this.results = new Map();
    $('hideTranscript').onclick = () => { $('transcriptPanel').open = false; };
    $('transcriptPanel').ontoggle = () => this.update();
    $('transcriptPrevious').onclick = () => this.browse(-1);
    $('transcriptNext').onclick = () => this.browse(1);
    $('transcriptFollow').onchange = () => this.update();
    $('transcribeAudio').onclick = () => this.start();
    $('cancelTranscript').onclick = () => this.cancel();
    $('downloadTranscript').onclick = async () => {
      try {
        await download(new Blob([JSON.stringify({ words: this.words }, null, 2)],
          { type: 'application/json' }), 'transcript.json', 'application/json');
      } catch (error) { this.status(error.message); }
    };
  }
  status(message) { $('transcriptStatus').textContent = message; }
  busy(value) {
    $('transcribeAudio').disabled = value || !this.asset;
    $('cancelTranscript').hidden = !value;
    const bar = $('transcriptProgress');
    bar.hidden = !value;
    bar.removeAttribute('value');
  }
  progress(done, total) {
    const bar = $('transcriptProgress');
    if (!total) { bar.removeAttribute('value'); return; }
    bar.value = Math.min(100, Math.round((done / total) * 100));
    this.status(`Transcribing… ${bar.value}%. Playback remains available.`);
  }
  cancel() {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.busy(false);
    this.status('Transcription cancelled.');
  }
  reset() { this.select(null); this.results.clear(); }
  select(asset) {
    this.cancel();
    this.asset = asset;
    this.busy(false);
    this.render(asset ? this.results.get(asset.id) || [] : []);
    this.status('Whisper downloads its model on first use. Audio stays on this device. Transcripts are stored in this browser.');
  }
  render(words) {
    this.words = words;
    this.offset = 0;
    this.renderWindow();
    $('downloadTranscript').hidden = !words.length;
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
      button.title = `Seek to ${word.start.toFixed(1)} seconds`;
      button.onclick = () => this.audio.seek(word.start);
      fragment.append(button, document.createTextNode(' '));
      return button;
    });
    $('transcriptWords').replaceChildren(fragment);
    $('transcriptNavigation').hidden = !this.words.length;
    $('transcriptPrevious').disabled = this.offset === 0;
    $('transcriptNext').disabled = this.offset + 100 >= this.words.length;
    $('transcriptRange').textContent = `${this.offset + 1}–${Math.min(this.words.length, this.offset + 100)} / ${this.words.length}`;
  }
  update() {
    if (!$('transcriptPanel').open) return;
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
  // Cache key for a recording under the current model, language and processing settings.
  async key(asset, bytes) {
    const language = $('transcriptLanguage').value || '';
    const model = $('transcriptModel').value || 'base';
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
    const words = key ? await storedTranscript(key) : null;
    if (words) this.results.set(asset.id, words);
    return words;
  }
  async start() {
    if (!this.asset || this.worker) return;
    const asset = this.asset, generation = ++this.generation;
    this.busy(true);
    $('transcriptPanel').open = true;
    this.status('Preparing audio on this device…');
    try {
      const bytes = await this.audio.read(asset.id);
      if (generation !== this.generation) return;
      const { buffer, language, model, settings, key } = await this.key(asset, bytes);
      if (generation !== this.generation) return;
      const cached = key ? await storedTranscript(key).catch(() => null) : null;
      if (generation !== this.generation) return;
      if (cached) { this.finish(cached, asset); return; }
      const { samples, duration } = await prepareSpeech(buffer, settings);
      if (generation !== this.generation) return;
      this.worker = new Worker(new URL('./transcript-worker.js', import.meta.url), { type: 'module' });
      this.status('Loading Whisper on this device… First use needs a model download.');
      const fail = message => {
        if (generation !== this.generation) return;
        this.worker?.terminate(); this.worker = null;
        this.busy(false); this.status(`Could not transcribe: ${message}. You can retry.`);
      };
      this.worker.onerror = event => fail(event.message || 'The local speech engine could not start');
      this.worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'progress' && data.progress.status === 'progress') {
          $('transcriptProgress').value = Math.round(data.progress.progress || 0);
          this.status(`Loading speech model: ${Math.round(data.progress.progress || 0)}% (${data.progress.file})`);
        }
        if (data.type === 'working') { $('transcriptProgress').removeAttribute('value'); this.status('Transcribing… Playback remains available.'); }
        if (data.type === 'speaking') this.progress(data.done, data.total);
        if (data.type === 'error') fail(data.error);
        if (data.type === 'complete') {
          const words = timedWords(data.result.chunks, duration);
          this.worker.terminate(); this.worker = null;
          this.finish(words, asset);
          if (key) storedTranscript(key, words).catch(() => {
            if (generation === this.generation) this.status('Transcript ready for this session. Browser storage is unavailable; export to keep it.');
          });
          else this.status('Transcript ready for this session. Export to keep it.');
        }
      };
      this.worker.postMessage({ samples, language, model }, [samples.buffer]);
    } catch (error) {
      if (generation === this.generation) {
        this.worker?.terminate(); this.worker = null;
        this.busy(false); this.status(`Could not transcribe: ${error.message}. You can retry.`);
      }
    }
  }
  finish(words, asset) {
    this.results.set(asset.id, words);
    this.onwords?.(asset, words);
    this.render(words); this.busy(false);
    this.status(words.length ? 'Transcript ready. Click a word to seek. Automatic words and timings may need correction.' : 'No timed speech detected.');
  }
}
