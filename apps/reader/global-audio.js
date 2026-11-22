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
  return base.replace(/\.(mp3|m4a|wav|ogg|oga|opus|flac|aac|weba)$/i, '') || base;
}

const AUDIO_MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', aac: 'audio/aac', weba: 'audio/webm',
};
const audioMimeFor = (name) => AUDIO_MIME[String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]] || 'audio/mpeg';

export function globalAudioController({ bar, header = null, status = () => {} } = {}) {
  if (!bar) return { playFile: async () => {}, close: () => {}, get isOpen() { return false; }, get currentName() { return ''; } };
  const doc = bar.ownerDocument || document;
  const audio = doc.createElement('audio');
  audio.preload = 'metadata';

  let url = '';
  let currentName = '';
  let external = null;
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

  const titleEl = doc.createElement('button');
  titleEl.type = 'button';
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
  closeBtn.title = 'Stop and close audio player';
  closeBtn.setAttribute('aria-label', 'Stop and close audio player');
  closeBtn.append(icon('close'));

  bar.append(headsetBtn, titleEl, backBtn, playBtn, fwdBtn, seek, timeEl, speedBtn, closeBtn);

  function syncSpeed() {
    const curRate = external ? (external.getRate?.() || 1) : rate;
    if (!external) {
      audio.playbackRate = audio.defaultPlaybackRate = rate;
      if ('preservesPitch' in audio) audio.preservesPitch = true;
    }
    const labelRate = Number(curRate.toFixed(2));
    speedBtn.textContent = `${labelRate}×`;
    speedBtn.classList.toggle('is-custom', Math.abs(curRate - 1) > 0.001);
    speedBtn.setAttribute('aria-label', `Playback speed ${labelRate}×`);
  }
  syncSpeed();

  function syncPlayState() {
    const playing = external ? !external.isPaused() : (!audio.paused && !audio.ended);
    const muted = external ? Boolean(external.isMuted?.()) : audio.muted;
    bar.classList.toggle('is-playing', playing);
    bar.classList.toggle('is-muted', muted);
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtn.title = playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    headsetBtn.setAttribute('aria-pressed', String(muted));
    headsetBtn.title = muted ? 'Unmute audio' : 'Mute audio';
    if (external) {
      const t = external.getTitle?.() || 'Note audio';
      if (titleEl.textContent !== t) { titleEl.textContent = t; titleEl.title = `${t} — click to open Audio panel`; }
      syncSpeed();
    }
  }

  function paintProgress(cur = null, dur = null) {
    const c = cur ?? (external ? external.getTime() : (audio.currentTime || 0));
    const d = dur ?? (external ? external.getDuration() : (Number.isFinite(audio.duration) ? audio.duration : 0));
    const pct = d > 0 ? Math.max(0, Math.min(100, (c / d) * 100)) : 0;
    if (!seeking) {
      seek.max = String(d > 0 ? d : 100);
      seek.value = String(d > 0 ? Math.min(d, c) : 0);
    }
    seek.style.setProperty('--ga-pct', `${pct.toFixed(2)}%`);
    timeEl.textContent = `${formatAudioClock(c)} / ${formatAudioClock(d)}`;
  }

  function tick() {
    if (external) {
      syncPlayState();
      paintProgress();
      raf = requestAnimationFrame(tick);
      return;
    }
    paintProgress();
    if (!audio.paused && !audio.ended) raf = requestAnimationFrame(tick);
    else raf = 0;
  }

  function jumpBy(delta) {
    if (external) {
      external.skip?.(delta);
      paintProgress();
      return;
    }
    const dur = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    const next = Math.max(0, Math.min(dur, (audio.currentTime || 0) + delta));
    audio.currentTime = next;
    paintProgress(next, Number.isFinite(audio.duration) ? audio.duration : 0);
  }

  titleEl.onclick = () => { if (external?.onOpen) external.onOpen(); };
  headsetBtn.onclick = () => {
    if (external) { external.toggleMute?.(); syncPlayState(); return; }
    audio.muted = !audio.muted;
    syncPlayState();
  };
  backBtn.onclick = () => jumpBy(-SKIP_SEC);
  fwdBtn.onclick = () => jumpBy(SKIP_SEC);
  playBtn.onclick = async () => {
    if (external) { await external.togglePlay?.(); syncPlayState(); paintProgress(); return; }
    if (!url) return;
    if (audio.paused || audio.ended) {
      try { await audio.play(); } catch (e) { status(e.message || 'Could not play audio.', true); }
    } else {
      audio.pause();
    }
  };
  speedBtn.onclick = (e) => {
    if (external) { external.stepRate?.(e.shiftKey ? -1 : 1); syncSpeed(); return; }
    const i = SPEEDS.indexOf(rate);
    const step = e.shiftKey ? -1 : 1;
    rate = SPEEDS[((i < 0 ? 2 : i) + step + SPEEDS.length) % SPEEDS.length];
    try { localStorage.setItem(SPEED_KEY, String(rate)); } catch { /* Optional */ }
    syncSpeed();
  };
  speedBtn.onwheel = (e) => {
    e.preventDefault();
    if (external) { external.stepRate?.(e.deltaY < 0 ? 1 : -1); syncSpeed(); return; }
    const i = SPEEDS.indexOf(rate);
    const step = e.deltaY < 0 ? 1 : -1;
    rate = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + step))];
    try { localStorage.setItem(SPEED_KEY, String(rate)); } catch { /* Optional */ }
    syncSpeed();
  };
  seek.oninput = () => {
    seeking = true;
    const dur = external ? external.getDuration() : (Number.isFinite(audio.duration) ? audio.duration : 0);
    const val = Number(seek.value) || 0;
    paintProgress(val, dur);
  };
  seek.onchange = () => {
    seeking = false;
    const val = Number(seek.value) || 0;
    if (external) { external.seek?.(val); paintProgress(); return; }
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Math.max(0, Math.min(audio.duration, val));
    paintProgress();
  };
  closeBtn.onclick = () => close();

  audio.addEventListener('loadedmetadata', () => { if (!external) paintProgress(); });
  audio.addEventListener('durationchange', () => { if (!external) paintProgress(); });
  audio.addEventListener('timeupdate', () => { if (!external && audio.paused) paintProgress(); });
  audio.addEventListener('seeked', () => { if (!external) paintProgress(); });
  audio.addEventListener('play', () => { if (!external) { syncPlayState(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); } });
  audio.addEventListener('pause', () => { if (!external) { cancelAnimationFrame(raf); raf = 0; syncPlayState(); paintProgress(); } });
  audio.addEventListener('ended', () => { if (!external) { cancelAnimationFrame(raf); raf = 0; syncPlayState(); paintProgress(); } });
  audio.addEventListener('error', () => { if (!external) { status(`Could not play ${currentName || 'this MP3 file'}.`, true); syncPlayState(); } });

  function showBar() {
    clearTimeout(hideTimer);
    bar.hidden = false;
    requestAnimationFrame(() => {
      bar.classList.add('is-open');
      header?.classList.add('has-global-audio');
    });
  }

  function hideBar() {
    bar.classList.remove('is-open', 'is-playing', 'is-external');
    header?.classList.remove('has-global-audio');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!url && !external) bar.hidden = true; }, 220);
  }

  function detachExternal({ stop = false } = {}) {
    if (!external) return;
    const prev = external;
    external = null;
    cancelAnimationFrame(raf);
    raf = 0;
    if (stop) prev.onStop?.();
    if (!url) hideBar();
  }

  function attachExternal(adapter) {
    if (!adapter) return;
    // Pause any standalone MP3 if we are docking note audio to the top bar.
    if (url) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      url = '';
      currentName = '';
    }
    cancelAnimationFrame(raf);
    external = adapter;
    bar.classList.add('is-external');
    syncPlayState();
    paintProgress();
    showBar();
    raf = requestAnimationFrame(tick);
  }

  function close() {
    if (external) {
      detachExternal({ stop: true });
      return;
    }
    cancelAnimationFrame(raf);
    raf = 0;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (url) { URL.revokeObjectURL(url); url = ''; }
    currentName = '';
    hideBar();
  }

  async function playFile(file) {
    if (!file) return;
    if (external) detachExternal({ stop: true });
    cancelAnimationFrame(raf);
    raf = 0;
    audio.pause();
    if (url) { URL.revokeObjectURL(url); url = ''; }
    const blob = file.type ? file : new Blob([file], { type: audioMimeFor(file.name) });
    url = URL.createObjectURL(blob);
    currentName = file.name || 'Audio.mp3';
    const label = cleanTrackTitle(currentName);
    titleEl.textContent = label;
    titleEl.title = currentName;
    bar.classList.remove('is-external');
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
    attachExternal,
    detachExternal,
    close,
    get isOpen() { return Boolean(url || external); },
    get isExternal() { return Boolean(external); },
    get currentName() { return external ? (external.getTitle?.() || '') : currentName; },
    audio,
  };
}
