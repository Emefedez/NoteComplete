// Text from part of a recording (the scissors in the audio panel): choose a segment on the
// position bar (two handles, typed times, or "here" at the playing position), hear it, and get
// only its text. With a transcript of the whole recording made before, its words in the segment
// are taken at once; otherwise only that part of the audio is transcribed, with the panel's
// engine and settings (TranscriptController.transcribeRange). The whole transcript and its cache
// are left as they were.
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
export const RATE = 16000;
const MIN = 0.5; // Shortest segment, in seconds.

// m:ss, m:ss.s, h:mm:ss or plain seconds; NaN for anything else.
export function parseClock(text) {
  const parts = String(text ?? '').trim().replace(',', '.').split(':');
  if (!parts[0] || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}
export function formatClock(t) {
  const tenths = Math.round(Math.max(0, t) * 10), s = tenths / 10, h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
// A valid segment inside the recording: ordered, at least MIN long.
export function clampRange(start, end, duration) {
  let a = Math.max(0, Math.min(start, end)), b = Math.min(duration, Math.max(start, end));
  if (b - a < MIN) {
    b = Math.min(duration, a + MIN);
    a = Math.max(0, b - MIN);
  }
  return [a, b];
}
// Words of a transcript said in [start, end] (a word half inside counts).
export function wordsInRange(words, start, end) {
  return (words || []).filter((w) => (w.end ?? w.start) > start && w.start < end);
}
export function shiftWords(words, by) {
  return words.map((w) => ({ ...w, start: w.start + by, end: (w.end ?? w.start) + by }));
}
export function wordsText(words) {
  return words.map((w) => w.text).join(' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}
export function sliceSamples(samples, rate, start, end) {
  return samples.slice(Math.max(0, Math.floor(start * rate)), Math.min(samples.length, Math.ceil(end * rate)));
}
// Mono 16-bit PCM WAV, for engines that take a file (Voxtype, Gemini on the desktop).
export function wavBytes(samples, rate = RATE) {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  text(36, 'data'); out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) out.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Uint8Array(out.buffer);
}

// The panel. `audio`: the AudioController; `toNotes(text)` and `toTextBox(text)` put the text in
// the note's notes or in a text box on the page.
export function audioTrim({ audio, status = () => {}, toNotes, toTextBox }) {
  const transcript = () => audio.transcript;
  const duration = () => (Number.isFinite(audio.audio.duration) ? audio.audio.duration : 0);
  let range = null, job = null, playingTo = null, result = '';

  const iconButton = (glyph, title, action, className = 'icon-button') => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className, title });
    b.setAttribute('aria-label', title);
    b.append(icon(glyph));
    b.onclick = action;
    return b;
  };
  // The scissors in the transport row open and close the panel.
  const toggle = iconButton('scissors', 'Text from part of the recording: choose a segment and get only its text (Shift K)', () => (panel.hidden ? open() : close()));
  toggle.id = 'trimAudio';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-controls', 'trimPanel');
  $('forwardAudio').after(toggle);

  // The band over the position bar, with a handle at each end.
  const seek = document.querySelector('.audio-seek');
  const band = document.createElement('div');
  band.className = 'trim-band';
  band.hidden = true;
  const handles = ['start', 'end'].map((which) => {
    const h = document.createElement('span');
    h.className = `trim-handle trim-${which}`;
    h.tabIndex = 0;
    h.setAttribute('role', 'slider');
    h.setAttribute('aria-label', which === 'start' ? 'Segment start' : 'Segment end');
    h.dataset.which = which;
    band.append(h);
    return h;
  });
  seek.append(band);

  const panel = document.createElement('div');
  panel.id = 'trimPanel';
  panel.className = 'trim-panel';
  panel.hidden = true;
  const field = (label) => {
    const input = Object.assign(document.createElement('input'), { type: 'text', inputMode: 'decimal', spellcheck: false, className: 'trim-time' });
    input.setAttribute('aria-label', label);
    input.title = `${label} (m:ss)`;
    return input;
  };
  const startField = field('Segment start'), endField = field('Segment end');
  const length = Object.assign(document.createElement('output'), { className: 'muted trim-length' });
  const go = Object.assign(document.createElement('button'), { type: 'button', className: 'primary trim-go' });
  go.append(icon('scissors'), Object.assign(document.createElement('span'), { textContent: 'Get text' }));
  go.title = 'Only the text of this segment';
  go.onclick = () => (job ? cancel() : run());
  const row = document.createElement('div');
  row.className = 'trim-row';
  row.append(
    iconButton('flagStart', 'Start here (at the playing position)', () => set(audio.time, range[1])),
    startField, Object.assign(document.createElement('span'), { className: 'muted', textContent: '–' }), endField,
    iconButton('flagEnd', 'End here (at the playing position)', () => set(range[0], audio.time)),
    length,
    iconButton('playSegment', 'Play the segment', play),
    go,
    iconButton('close', 'Close', close),
  );
  const state = Object.assign(document.createElement('p'), { className: 'muted trim-state' });
  state.setAttribute('role', 'status');
  const out = document.createElement('div');
  out.className = 'trim-result';
  out.hidden = true;
  const text = Object.assign(document.createElement('div'), { className: 'trim-text' });
  const actions = document.createElement('div');
  actions.className = 'trim-actions';
  actions.append(
    iconButton('copy', 'Copy the text', async () => {
      try { await navigator.clipboard.writeText(result); say('Copied.'); } catch { say('Could not copy: select the text and copy it.'); }
    }),
    ...(toNotes ? [iconButton('note', 'Add to the notes beside the pages', async () => { await toNotes(result); say('Added to the notes.'); })] : []),
    ...(toTextBox ? [iconButton('text', 'Put it in a text box on the page', () => toTextBox(result))] : []),
  );
  out.append(text, actions);
  panel.append(row, state, out);
  seek.after(panel);

  const say = (message) => { state.textContent = message; };
  function set(a, b) {
    if (!duration()) return;
    range = clampRange(a, b, duration());
    startField.value = formatClock(range[0]);
    endField.value = formatClock(range[1]);
    length.textContent = `${formatClock(range[1] - range[0])}`;
    const d = duration();
    band.style.left = `${(range[0] / d) * 100}%`;
    band.style.width = `${((range[1] - range[0]) / d) * 100}%`;
    handles[0].setAttribute('aria-valuenow', String(range[0]));
    handles[1].setAttribute('aria-valuenow', String(range[1]));
    for (const h of handles) { h.setAttribute('aria-valuemin', '0'); h.setAttribute('aria-valuemax', String(d)); h.setAttribute('aria-valuetext', formatClock(Number(h.getAttribute('aria-valuenow')))); }
  }
  for (const [input, i] of [[startField, 0], [endField, 1]]) {
    input.onchange = () => {
      const t = parseClock(input.value);
      if (!Number.isFinite(t)) { say('Type a time as m:ss, for example 1:30.'); return set(...range); }
      set(i ? range[0] : t, i ? t : range[1]);
    };
    input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') input.onchange(); };
  }
  // Dragging a handle (mouse, finger or pen) moves that end; arrows move it 1 s (Shift: 10 s).
  for (const h of handles) {
    const end = h.dataset.which === 'end';
    h.onpointerdown = (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const box = seek.querySelector('input[type=range]').getBoundingClientRect();
      const move = (ev) => {
        const t = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width)) * duration();
        set(end ? range[0] : t, end ? t : range[1]);
      };
      h.onpointermove = move;
      h.onpointerup = h.onpointercancel = () => { h.onpointermove = null; };
    };
    h.onkeydown = (e) => {
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      const by = step * (e.shiftKey ? 10 : 1);
      set(end ? range[0] : range[0] + by, end ? range[1] + by : range[1]);
    };
  }
  function open() {
    if (!duration()) return status('Choose a recording that has loaded first.');
    panel.hidden = band.hidden = false;
    toggle.setAttribute('aria-pressed', 'true');
    // From the playing position, 30 s long, inside the recording.
    const at = audio.time;
    set(Math.min(at, Math.max(0, duration() - 30)), at + 30);
    say(transcript()?.results?.has(transcript()?.asset?.id) ? 'The transcript covers this recording: the text comes at once.' : 'Only this part will be transcribed, with the engine and language above.');
  }
  function close() {
    cancel();
    panel.hidden = band.hidden = true;
    toggle.setAttribute('aria-pressed', 'false');
  }
  // Plays the segment and stops at its end.
  function play() {
    audio.seek(range[0]);
    playingTo = range[1];
    audio.audio.play().catch(() => {});
  }
  audio.audio.addEventListener('timeupdate', () => {
    if (playingTo != null && audio.time >= playingTo) { audio.audio.pause(); playingTo = null; }
  });
  audio.audio.addEventListener('pause', () => { if (playingTo != null && audio.time < playingTo - 0.3) playingTo = null; });
  async function run() {
    const t = transcript(), asset = t?.asset;
    if (!asset || !range) return;
    const [a, b] = range;
    const mine = job = { cancelled: false };
    go.lastChild.textContent = 'Cancel';
    say('Getting the text…');
    try {
      const { words, from } = await t.transcribeRange(asset, a, b, (share, label) => { if (job === mine) say(`${label || 'Transcribing'} ${Math.round(share * 100)} %`); }, mine);
      if (job !== mine) return;
      result = wordsText(words);
      text.textContent = result || '(Nothing was said in this segment.)';
      out.hidden = false;
      say(`${formatClock(a)}–${formatClock(b)}: ${words.length} ${words.length === 1 ? 'word' : 'words'}${from === 'transcript' ? ', from the transcript' : ''}.`);
    } catch (error) {
      if (job === mine) say(`Could not get the text: ${error.message}`);
    } finally {
      if (job === mine) { job = null; go.lastChild.textContent = 'Get text'; }
    }
  }
  function cancel() {
    if (!job) return;
    job.cancelled = true;
    job.worker?.terminate();
    if (job.external) globalThis.notecompleteTranscribe?.cancel();
    job = null;
    go.lastChild.textContent = 'Get text';
    say('Cancelled.');
  }
  // Another recording (its source is emptied first): the segment belonged to the one before.
  audio.audio.addEventListener('emptied', () => { if (!panel.hidden) close(); out.hidden = true; });
  return { close, get open() { return !panel.hidden; } };
}
