// The kit's step player (docs/ALGORITHM-ANIMATIONS.md, docs/CHINESE-INPUT.md §7.2): play/pause
// (Space), step back/forward (← →), first/last (Home/End), speed, a scrubbable timeline and a
// caption, with prefers-reduced-motion. It owns no picture: `draw(i, t)` draws steps < i done and
// step i at t ∈ [0, 1] (t = 0 also when i = steps: everything done). Stepping forward animates
// the step (`duration(i)` ms at 1×); stepping back and scrubbing jump. The algorithms player
// has the same controls and keys (its own copy, older than this).
//   const p = stepPlayer(host, { steps: 7, draw, caption: (at) => `Stroke ${at} of 7` });
//   p.play(); p.go(3); p.replay(); p.setSteps(n); p.destroy();
import { make, button, selectInput, loadKitStyles } from './shell.js';
import { icon } from '../../icons.js';

export const SPEEDS = [['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['4', '4×']];
const remembered = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Optional. */ } };
const typing = (t) => t?.closest?.('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable=""], [contenteditable="true"]');

// `steps`: how many; `start`: steps done at first (default 0); `duration(i)`: ms of step i at 1×;
// `gap`: ms between steps while playing; `key`: names the remembered speed; `onChange(at)`.
// `nextStep(at, { repeating })`: optional custom stepper returning the next step index to animate,
// or `{ start, wait }` to begin a repeat cycle after `wait` ms, or `null` to finish playback.
export function stepPlayer(host, { steps = 0, start = 0, draw, caption = (at, n) => `${at} / ${n}`, duration = () => 700, gap = 220, key = 'steps', onChange = null, onStop = null, nextStep = null, keys = true } = {}) {
  loadKitStyles();
  let n = steps, at = Math.max(0, Math.min(n, start)), raf = 0, timer = 0, playing = false, repeating = false;
  let speed = Number(remembered(`pk-speed:${key}`, '1')) || 1;
  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  const captionEl = make('p', { className: 'pk-step-caption', role: 'status' });
  const timeline = make('input', { type: 'range', className: 'pk-step-timeline', min: 0, step: 1 });
  timeline.setAttribute('aria-label', 'Step');
  const count = make('span', { className: 'pk-step-count' });
  const firstBtn = button('flagStart', 'First step (Home)', { iconOnly: true });
  const prevBtn = button('chevronLeft', 'Step back (←)', { iconOnly: true });
  const playBtn = button('play', 'Play (Space)', { iconOnly: true, primary: true });
  const nextBtn = button('chevronRight', 'Step forward (→)', { iconOnly: true });
  const lastBtn = button('flagEnd', 'Last step (End)', { iconOnly: true });
  const speedSel = selectInput(SPEEDS, String(speed), (v) => { speed = Number(v) || 1; keep(`pk-speed:${key}`, String(speed)); });
  speedSel.title = 'Speed';
  speedSel.setAttribute('aria-label', 'Speed');
  const controls = make('div', { className: 'pk-step-controls' }, firstBtn, prevBtn, playBtn, nextBtn, lastBtn, count, speedSel);
  const el = make('div', { className: 'pk-step-player', tabIndex: keys ? 0 : -1 }, captionEl, timeline, controls);
  host.append(el);

  const playIcon = () => {
    const [name, title] = playing ? ['pause', 'Pause (Space)'] : at >= n && n > 0 ? ['restart', 'Play again (Space)'] : ['play', 'Play (Space)'];
    playBtn.replaceChildren(icon(name)); playBtn.title = title; playBtn.setAttribute('aria-label', title);
  };
  function paint(i = at, t = 0) {
    draw?.(i, t);
    captionEl.textContent = caption(at, n) || '';
    timeline.max = String(n); timeline.value = String(at);
    count.textContent = `${at} / ${n}`;
    firstBtn.disabled = prevBtn.disabled = at === 0;
    nextBtn.disabled = lastBtn.disabled = at >= n;
    playBtn.disabled = n === 0;
    playIcon();
  }
  const halt = () => { cancelAnimationFrame(raf); clearTimeout(timer); raf = 0; timer = 0; };
  // Step `at` animated to its end, then `then()`.
  function animate(then) {
    const i = at, ms = duration(i) / speed;
    if (reduced.matches || ms <= 0) { at = i + 1; paint(); onChange?.(at); then?.(); return; }
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      if (t < 1) { draw?.(i, t); raf = requestAnimationFrame(frame); return; }
      raf = 0; at = i + 1; paint(); onChange?.(at); then?.();
    };
    draw?.(i, 0);
    raf = requestAnimationFrame(frame);
  }
  function advance() {
    if (!playing) return;
    const planNext = nextStep ? nextStep(at, { repeating }) : (at < n ? at : null);
    if (planNext == null) {
      playing = false; repeating = false; onStop?.(false); playIcon();
      return;
    }
    if (typeof planNext === 'object') {
      const wait = Math.max(0, Number(planNext.wait ?? 520)) / speed;
      timer = setTimeout(() => {
        if (!playing) return;
        // Re-check repeat condition right when the beat ends (in case repeat was unchecked during the pause).
        const recheck = nextStep ? nextStep(at, { repeating: true, recheck: true }) : null;
        if (recheck == null) { playing = false; repeating = false; onStop?.(false); playIcon(); return; }
        const startIdx = typeof recheck === 'object' ? recheck.start : recheck;
        repeating = true;
        at = Math.max(0, Math.min(n - 1, startIdx));
        paint(); onChange?.(at);
        advance();
      }, wait);
      return;
    }
    if (planNext !== at) { at = planNext; paint(); onChange?.(at); }
    animate(() => {
      if (!playing) return;
      const after = nextStep ? nextStep(at, { repeating }) : (at < n ? at : null);
      if (after == null) { playing = false; repeating = false; onStop?.(false); playIcon(); return; }
      if (typeof after === 'object') { advance(); return; }
      timer = setTimeout(advance, (reduced.matches ? Math.max(gap, duration(after)) : gap) / speed);
    });
  }
  function play() {
    if (!n) return;
    halt();
    repeating = false;
    if (at >= n) { at = 0; paint(); onChange?.(at); }
    playing = true; playIcon();
    advance();
  }
  function pause() { halt(); playing = false; repeating = false; onStop?.(true); paint(); }
  function go(i) { halt(); playing = false; repeating = false; onStop?.(true); at = Math.max(0, Math.min(n, i)); paint(); onChange?.(at); }
  // A step pressed while one animates: that one ends at once, the next animates.
  function forward() {
    if (raf) { halt(); at = Math.min(n, at + 1); paint(); onChange?.(at); }
    if (at >= n) return;
    halt(); playing = false; repeating = false; onStop?.(true); playIcon(); animate();
  }

  firstBtn.onclick = () => go(0);
  prevBtn.onclick = () => go(at - 1);
  nextBtn.onclick = forward;
  lastBtn.onclick = () => go(n);
  playBtn.onclick = () => (playing ? pause() : play());
  timeline.oninput = () => go(Number(timeline.value));
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (e.target === timeline && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); forward(); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(n); }
  };
  if (keys) el.addEventListener('keydown', onKey);
  paint();
  return {
    el, controls, caption: captionEl, timeline,
    get index() { return at; }, get steps() { return n; }, get playing() { return playing; }, get speed() { return speed; },
    play, pause, go, forward, replay: () => { go(0); play(); },
    setSteps(count, startAt = 0) { halt(); playing = false; n = Math.max(0, count | 0); at = Math.max(0, Math.min(n, startAt)); paint(); },
    redraw: () => paint(),
    onKey,
    destroy() { halt(); playing = false; el.remove(); },
  };
}
