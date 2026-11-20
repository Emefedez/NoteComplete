// Global bar MP3 player: appears directly on #commandBar whenever an .mp3 file is opened
// (from a folder, File -> Open, drag & drop, archive, or cloud storage) without closing the open note.
import { icon } from './icons.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SPEED_KEY = 'notecomplete-global-audio-speed';
const SKIP_SEC = 10;

export function formatAudioClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function cleanTrackTitle(name) {
  const base = String(name || 'Audio').split(/[\\/]/).pop() || 'Audio';
  return base.replace(/\.mp3$/i, '') || base;
}

export function globalAudioController({ bar, header = null, status = () => {} } = {}) {
  if (!bar) return { playFile: async () => {}, close: () => {}, get isOpen() { return false; }, get currentName() { return ''; } };
  const doc = bar.ownerDocument || document;
  const audio = doc.createElement('audio');
  audio.preload = 'metadata';

  let url = '';
  let currentName = '';
  let rate = 1;
  let raf = 0;
  let seeking = false;
  let hideTimer = 0;
  try {
    const saved = Number(localStorage.getItem(SPEED_KEY));
    if (SPEEDS.includes(saved)) rate = saved;
  } catch { /* Optional */ }

  bar.replaceChildren();

  const headsetBtn = doc.createElement('button');
  headsetBtn.type = 'button';
  headsetBtn.className = 'ga-btn ga-headset';
  headsetBtn.title = 'Mute / unmute';
  headsetBtn.setAttribute('aria-label', 'Mute or unmute audio');
  headsetBtn.append(icon('headphones'));

  const titleEl = doc.createElement('span');
  titleEl.className = 'ga-title';

  const backBtn = doc.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'ga-btn ga-skip';
  backBtn.title = `Back ${SKIP_SEC} seconds`;
  backBtn.setAttribute('aria-label', `Back ${SKIP_SEC} seconds`);
  backBtn.append(icon('chevronLeft'));

  const playBtn = doc.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'ga-btn ga-play';
  playBtn.title = 'Play / pause';
  playBtn.setAttribute('aria-label', 'Play');
  playBtn.append(icon('play'));

  const fwdBtn = doc.createElement('button');
  fwdBtn.type = 'button';
  fwdBtn.className = 'ga-btn ga-skip';
  fwdBtn.title = `Forward ${SKIP_SEC} seconds`;
  fwdBtn.setAttribute('aria-label', `Forward ${SKIP_SEC} seconds`);
  fwdBtn.append(icon('chevronRight'));

  const seek = doc.createElement('input');
  seek.type = 'range';
  seek.className = 'ga-seek';
  seek.min = '0';
  seek.max = '100';
  seek.step = '0.1';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Audio position');

  const timeEl = doc.createElement('span');
  timeEl.className = 'ga-time';
  timeEl.textContent = '0:00 / 0:00';

  const speedBtn = doc.createElement('button');
  speedBtn.type = 'button';
  speedBtn.className = 'ga-btn ga-speed';
  speedBtn.title = 'Playback speed (click to cycle, Shift-click to slow down)';

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ga-btn ga-close';
  closeBtn.title = 'Close audio player';
  closeBtn.setAttribute('aria-label', 'Close audio player');
  closeBtn.append(icon('close'));

  bar.append(headsetBtn, titleEl, backBtn, playBtn, fwdBtn, seek, timeEl, speedBtn, closeBtn);

  function syncSpeed() {
    audio.playbackRate = audio.defaultPlaybackRate = rate;
    if ('preservesPitch' in audio) audio.preservesPitch = true;
    speedBtn.textContent = `${rate}×`;
    speedBtn.classList.toggle('is-custom', rate !== 1);
    speedBtn.setAttribute('aria-label', `Playback speed ${rate}×`);
  }
  syncSpeed();

  function syncPlayState() {
    const playing = !audio.paused && !audio.ended;
    bar.classList.toggle('is-playing', playing);
    bar.classList.toggle('is-muted', audio.muted);
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtn.title = playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    headsetBtn.setAttribute('aria-pressed', String(audio.muted));
    headsetBtn.title = audio.muted ? 'Unmute audio' : 'Mute audio';
  }

  function paintProgress(cur = audio.currentTime || 0, dur = Number.isFinite(audio.duration) ? audio.duration : 0) {
    const pct = dur > 0 ? Math.max(0, Math.min(100, (cur / dur) * 100)) : 0;
    if (!seeking) {
      seek.max = String(dur > 0 ? dur : 100);
      seek.value = String(dur > 0 ? Math.min(dur, cur) : 0);
    }
    seek.style.setProperty('--ga-pct', `${pct.toFixed(2)}%`);
    timeEl.textContent = `${formatAudioClock(cur)} / ${formatAudioClock(dur)}`;
  }

  function tick() {
    paintProgress();
    if (!audio.paused && !audio.ended) raf = requestAnimationFrame(tick);
    else raf = 0;
  }

  function jumpBy(delta) {
    const dur = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    const next = Math.max(0, Math.min(dur, (audio.currentTime || 0) + delta));
    audio.currentTime = next;
    paintProgress(next, Number.isFinite(audio.duration) ? audio.duration : 0);
  }

  headsetBtn.onclick = () => {
    audio.muted = !audio.muted;
    syncPlayState();
  };
  backBtn.onclick = () => jumpBy(-SKIP_SEC);
  fwdBtn.onclick = () => jumpBy(SKIP_SEC);
  playBtn.onclick = async () => {
    if (!url) return;
    if (audio.paused || audio.ended) {
      try { await audio.play(); } catch (e) { status(e.message || 'Could not play audio.', true); }
    } else {
      audio.pause();
    }
  };
  speedBtn.onclick = (e) => {
    const i = SPEEDS.indexOf(rate);
    const step = e.shiftKey ? -1 : 1;
    rate = SPEEDS[((i < 0 ? 2 : i) + step + SPEEDS.length) % SPEEDS.length];
    try { localStorage.setItem(SPEED_KEY, String(rate)); } catch { /* Optional */ }
    syncSpeed();
  };
  speedBtn.onwheel = (e) => {
    e.preventDefault();
    const i = SPEEDS.indexOf(rate);
    const step = e.deltaY < 0 ? 1 : -1;
    rate = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + step))];
    try { localStorage.setItem(SPEED_KEY, String(rate)); } catch { /* Optional */ }
    syncSpeed();
  };
  seek.oninput = () => {
    seeking = true;
    const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
    const val = Number(seek.value) || 0;
    paintProgress(val, dur);
  };
  seek.onchange = () => {
    seeking = false;
    const val = Number(seek.value) || 0;
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Math.max(0, Math.min(audio.duration, val));
    paintProgress();
  };
  closeBtn.onclick = () => close();

  audio.addEventListener('loadedmetadata', () => paintProgress());
  audio.addEventListener('durationchange', () => paintProgress());
  audio.addEventListener('timeupdate', () => { if (audio.paused) paintProgress(); });
  audio.addEventListener('seeked', () => paintProgress());
  audio.addEventListener('play', () => { syncPlayState(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  audio.addEventListener('pause', () => { cancelAnimationFrame(raf); raf = 0; syncPlayState(); paintProgress(); });
  audio.addEventListener('ended', () => { cancelAnimationFrame(raf); raf = 0; syncPlayState(); paintProgress(); });
  audio.addEventListener('error', () => { status(`Could not play ${currentName || 'this MP3 file'}.`, true); syncPlayState(); });

  function showBar() {
    clearTimeout(hideTimer);
    bar.hidden = false;
    // Let layout observe `hidden = false` before toggling `.is-open` for the smooth entrance.
    requestAnimationFrame(() => {
      bar.classList.add('is-open');
      header?.classList.add('has-global-audio');
    });
  }

  function close() {
    cancelAnimationFrame(raf);
    raf = 0;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (url) { URL.revokeObjectURL(url); url = ''; }
    currentName = '';
    bar.classList.remove('is-open', 'is-playing');
    header?.classList.remove('has-global-audio');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!url) bar.hidden = true; }, 220);
  }

  async function playFile(file) {
    if (!file) return;
    cancelAnimationFrame(raf);
    raf = 0;
    audio.pause();
    if (url) { URL.revokeObjectURL(url); url = ''; }
    const blob = file.type ? file : new Blob([file], { type: 'audio/mpeg' });
    url = URL.createObjectURL(blob);
    currentName = file.name || 'Audio.mp3';
    const label = cleanTrackTitle(currentName);
    titleEl.textContent = label;
    titleEl.title = currentName;
    audio.src = url;
    syncSpeed();
    paintProgress(0, 0);
    showBar();
    syncPlayState();
    try {
      await audio.play();
      status(`Playing ${label}`);
    } catch {
      syncPlayState();
      status(`Loaded ${label} — press Play to listen.`);
    }
  }

  return {
    playFile,
    close,
    get isOpen() { return Boolean(url); },
    get currentName() { return currentName; },
    audio,
  };
}
