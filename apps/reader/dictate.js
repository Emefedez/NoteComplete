// Dictation for the Ask AI fields (Ask AI, quiz Clarify, flashcard Ask AI): the mic button
// records, a second press (or Enter) stops, and the words are typed into the field at the
// cursor, ready to edit before sending; Esc drops the take. It transcribes with the engine,
// language and model chosen for transcripts in the audio panel (Whisper on this device by
// default), keeping the speech model loaded between takes.
import { prepareSpeech, speechSettings } from './audio-processing.js';
import { recordingMime } from './recorder.js';
import { icon } from './icons.js';
const $ = id => document.getElementById(id);

// Spoken text joined to what is already typed, with one space between.
export function insertText(value, start, end, spoken) {
  const before = value.slice(0, start), after = value.slice(end), text = spoken.trim();
  if (!text) return { value, caret: end };
  const lead = before && !/\s$/.test(before) ? ' ' : '', tail = after && !/^\s/.test(after) ? ' ' : '';
  return { value: before + lead + text + tail + after, caret: (before + lead + text).length };
}

let worker = null;
function whisper(samples, language, model) {
  worker ||= new Worker(new URL('./transcript-worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onerror = event => { worker = null; reject(Error(event.message || 'The local speech engine could not start')); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'error') reject(Error(data.error));
      if (data.type === 'complete') resolve(String(data.result?.text || (data.result?.chunks || []).map(c => c.text).join(' ')));
    };
    worker.postMessage({ samples, language, model }, [samples.buffer]);
  });
}
async function transcribe(blob) {
  const backend = $('transcriptBackend')?.value || 'whisper', language = $('transcriptLanguage')?.value || '';
  const buffer = await blob.arrayBuffer();
  if (backend !== 'whisper' && globalThis.notecompleteTranscribe?.run) {
    const segments = await globalThis.notecompleteTranscribe.run({ backend, bytes: new Uint8Array(buffer), language }, () => {});
    return segments.map(s => s.text).join(' ');
  }
  const { samples } = await prepareSpeech(buffer, speechSettings());
  return whisper(samples, language, $('transcriptModel')?.value || 'base');
}

export function dictation({ status }) {
  let take = null;
  async function stop(keep = true) {
    const current = take;
    if (!current) return;
    take = null;
    current.button.classList.remove('recording'); current.button.classList.add('busy');
    current.button.setAttribute('aria-pressed', 'false');
    current.button.title = 'Transcribing…';
    document.removeEventListener('keydown', current.keys, true);
    if (current.media.state !== 'inactive') current.media.stop();
    try {
      const blob = await current.done;
      if (!keep || !blob.size) return;
      const spoken = await transcribe(blob);
      const field = current.input, { value, caret } = insertText(field.value, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, spoken);
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus(); field.setSelectionRange?.(caret, caret);
      if (!spoken.trim()) status('Nothing was heard.', true);
    } catch (error) {
      status(`Could not transcribe: ${error.message}`, true);
    } finally {
      for (const track of current.stream.getTracks()) track.stop();
      current.button.classList.remove('busy');
      current.button.title = current.label;
    }
  }
  async function start(button, input) {
    if (take) return stop(take.button === button);
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) return status('This device cannot record audio here.', true);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (error) { return status(error.name === 'NotAllowedError' ? 'Microphone access was refused.' : error.message, true); }
    const mime = recordingMime(), media = new MediaRecorder(stream, mime ? { mimeType: mime } : {}), chunks = [];
    media.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(resolve => { media.onstop = () => resolve(new Blob(chunks, { type: media.mimeType || mime || 'audio/webm' })); });
    // Enter stops and keeps; Esc drops the take.
    const keys = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stop(false); }
      else if (event.key === 'Enter' && document.activeElement === input) { event.preventDefault(); event.stopPropagation(); stop(true); }
    };
    take = { button, input, stream, media, done, keys, label: button.title };
    media.start();
    document.addEventListener('keydown', keys, true);
    button.classList.add('recording'); button.setAttribute('aria-pressed', 'true');
    button.title = 'Listening… press again or Enter to stop, Esc to cancel';
    input.focus();
  }
  // A mic button placed before `before` (usually the field's send button).
  function attach(input, before) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'icon-button dictate';
    button.title = 'Dictate: speak your question (press again or Enter to stop)';
    button.setAttribute('aria-label', 'Dictate'); button.setAttribute('aria-pressed', 'false');
    button.append(icon('mic'));
    button.onclick = () => start(button, input);
    before.before(button);
    return button;
  }
  return { attach, stop };
}
