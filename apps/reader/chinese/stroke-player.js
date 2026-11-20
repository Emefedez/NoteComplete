// The stroke-order player (docs/CHINESE-INPUT.md §7.2): the characters of `text` side by side on
// a 米字格 / 田字格 grid, each stroke revealed along its median (stroke-svg.js), driven by the
// kit's step player (play/pause Space, ← →, Home/End, speed, timeline, reduced motion). A step
// is one stroke; the characters play one after another. Used by the hanzi prefab's editor, the
// character look-up panel and the candidate menu's popover.
//
//   const p = strokePlayer(host, { text: '你好', size: 200, grid: 'mi', outline: true, autoplay: true });
//   await p.ready;            // stroke data loaded (strokes.js) unless given as `data`
//   p.play(); p.pause(); p.go(n); p.forward(); p.replay(); p.index; p.steps;
//   p.setText('谢谢'); p.set({ grid: 'tian', outline: false }); p.data; p.destroy();
import { stepPlayer } from '../prefabs/kit/step-player.js';
import { glyphSvg, gridSvg } from './stroke-svg.js';
import { strokesFor } from './strokes.js';

let players = 0;
const STROKE_MS = (d) => 260 + Math.min(700, (d?.len || 600) * 0.75);
export const isHan = (c) => /\p{Script=Han}/u.test(c);

// Dotted circular repeat arrow icon (for per-character and toggle-all loop controls).
function loopIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.1', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const arc = document.createElementNS(svg.namespaceURI, 'path');
  arc.setAttribute('d', 'M20 12a8 8 0 1 1-2.35-5.65');
  arc.setAttribute('stroke-dasharray', '2.5 2.7');
  const head = document.createElementNS(svg.namespaceURI, 'path');
  head.setAttribute('d', 'M20 4.5v4.5h-4.5');
  svg.append(arc, head);
  return svg;
}

// `text`, `data` ({ char: strokeData }, loaded when missing), `size` (px per character), `grid`
// ("mi" | "tian" | "none"), `outline` (grey character under the strokes), `start` (strokes done
// at first; default 0, or all when `still`), `autoplay`, `colour`, `active`, `onStep(at, steps)`,
// `caption(at, info)`: a caption of your own. Keys work when the player has focus.
export function strokePlayer(host, { text = '', data = null, size = 180, grid = 'mi', outline = true, start = 0, autoplay = false, colour = '#1f2328', active = '#d1242f', gridColour = '#e3a9a9', onStep = null, caption = null } = {}) {
  const id = `hzp${++players}`;
  const opts = { size, grid, outline, colour, active, gridColour };
  const el = document.createElement('div');
  el.className = 'hz-player';
  const stage = document.createElement('div');
  stage.className = 'hz-stage';
  el.append(stage);
  host.append(el);
  let chars = [], glyphs = {}, plan = [], masks = [];
  const cellLoops = new Map(); // k -> { active, raf, timer, btn }
  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  const info = (at) => {
    if (!plan.length) return null;
    const k = Math.max(0, Math.min(plan.length - 1, at - 1));
    return { ...plan[k], total: plan.filter((p) => p.c === plan[k].c).length };
  };
  const captionOf = (at) => {
    const missing = chars.filter((c) => isHan(c) && !glyphs[c]);
    const note = missing.length ? ` · No stroke order for ${[...new Set(missing)].join(' ')}` : '';
    if (caption) return caption(at, info(at)) + note;
    if (!plan.length) return missing.length ? `No stroke order for ${[...new Set(missing)].join(' ')}` : '';
    if (at === 0) return `${plan.length} strokes${note}`;
    const i = info(at);
    return `${i.char} · stroke ${i.s + 1} of ${i.total}${chars.length > 1 ? ` · ${at} of ${plan.length}` : ''}${note}`;
  };
  const player = stepPlayer(el, { steps: 0, key: 'hanzi', duration: (i) => STROKE_MS(plan[i]), gap: 160, caption: captionOf, draw, onChange: (at) => onStep?.(at, plan.length) });

  // Toggle-all loop button in the player controls row: alternates all characters on / off.
  const loopAllBtn = document.createElement('button');
  loopAllBtn.type = 'button';
  loopAllBtn.className = 'pk-button pk-icon hz-loop-all';
  loopAllBtn.append(loopIcon());
  loopAllBtn.setAttribute('aria-pressed', 'false');
  loopAllBtn.title = 'Loop animation for all characters';
  loopAllBtn.setAttribute('aria-label', 'Loop animation for all characters');
  player.controls.append(loopAllBtn);

  const loopableIndices = () => chars.map((c, k) => (glyphs[c] ? k : -1)).filter((k) => k >= 0);
  function syncLoopAll() {
    const ks = loopableIndices();
    const allOn = ks.length > 0 && ks.every((k) => cellLoops.get(k)?.active);
    const someOn = ks.some((k) => cellLoops.get(k)?.active);
    loopAllBtn.disabled = ks.length === 0;
    loopAllBtn.setAttribute('aria-pressed', String(allOn));
    loopAllBtn.classList.toggle('is-partial', someOn && !allOn);
    const label = allOn ? 'Stop looping all characters' : 'Loop animation for all characters';
    loopAllBtn.title = label;
    loopAllBtn.setAttribute('aria-label', label);
  }
  function paintCell(k, strokeIndex, t) {
    const indices = [];
    plan.forEach((p, idx) => { if (p.c === k) indices.push(idx); });
    indices.forEach((planIdx, localS) => {
      const m = masks[planIdx];
      if (!m) return;
      const len = plan[planIdx].len;
      const f = localS < strokeIndex ? 1 : localS === strokeIndex ? t : 0;
      m.setAttribute('stroke-dashoffset', String(Math.round(len * (1 - f))));
      m.setAttribute('stroke', localS === strokeIndex && t > 0 && t < 1 ? opts.active : opts.colour);
    });
  }
  function stopCellLoop(k, repaint = true) {
    const st = cellLoops.get(k);
    if (!st) return;
    cancelAnimationFrame(st.raf);
    clearTimeout(st.timer);
    st.raf = 0; st.timer = 0; st.active = false;
    st.btn?.setAttribute('aria-pressed', 'false');
    syncLoopAll();
    if (repaint) draw(player.index, 0);
  }
  function stopAllLoops(repaint = false) {
    for (const k of [...cellLoops.keys()]) stopCellLoop(k, repaint);
  }
  function startCellLoop(k) {
    const st = cellLoops.get(k);
    if (!st || !glyphs[chars[k]]) return;
    cancelAnimationFrame(st.raf);
    clearTimeout(st.timer);
    st.active = true;
    st.btn?.setAttribute('aria-pressed', 'true');
    syncLoopAll();
    const indices = [];
    plan.forEach((p, idx) => { if (p.c === k) indices.push(idx); });
    if (!indices.length) return;
    let s = 0;
    const step = () => {
      if (!st.active) return;
      if (s >= indices.length) {
        paintCell(k, indices.length, 0);
        st.timer = setTimeout(() => { if (!st.active) return; s = 0; step(); }, Math.round(520 / (player.speed || 1)));
        return;
      }
      const planIdx = indices[s];
      const ms = STROKE_MS(plan[planIdx]) / (player.speed || 1);
      if (reduced.matches || ms <= 0) {
        s++;
        paintCell(k, s, 0);
        st.timer = setTimeout(step, Math.round(280 / (player.speed || 1)));
        return;
      }
      const t0 = performance.now();
      const frame = (now) => {
        if (!st.active) return;
        const t = Math.min(1, (now - t0) / ms);
        if (t < 1) {
          paintCell(k, s, t);
          st.raf = requestAnimationFrame(frame);
          return;
        }
        st.raf = 0;
        s++;
        paintCell(k, s, 0);
        st.timer = setTimeout(step, Math.round(150 / (player.speed || 1)));
      };
      paintCell(k, s, 0);
      st.raf = requestAnimationFrame(frame);
    };
    step();
  }
  function toggleCellLoop(k) {
    const st = cellLoops.get(k);
    if (!st) return;
    if (st.active) stopCellLoop(k, true);
    else startCellLoop(k);
  }
  loopAllBtn.onclick = () => {
    const ks = loopableIndices();
    if (!ks.length) return;
    const allOn = ks.every((k) => cellLoops.get(k)?.active);
    if (allOn) { for (const k of ks) stopCellLoop(k, true); }
    else { for (const k of ks) if (!cellLoops.get(k)?.active) startCellLoop(k); }
  };

  function build(keepLoopSet = null) {
    stopAllLoops(false);
    cellLoops.clear();
    const gap = Math.round(opts.size * 0.08);
    stage.style.gap = `${gap}px`;
    stage.replaceChildren();
    plan = [];
    chars.forEach((c, k) => {
      const d = glyphs[c];
      const cell = document.createElement('div');
      cell.className = 'hz-cell';
      const gridMarkup = gridSvg(0, 0, opts.size, opts.grid, opts.gridColour);
      const inner = d
        ? `${gridMarkup}<g data-g="${k}">${glyphSvg(d, { x: 0, y: 0, size: opts.size, animated: true, done: 0, outline: opts.outline, colour: opts.colour, outlineColour: '#dde1e6', id: `${id}-${k}` })}</g>`
        : `${gridMarkup}<text x="${opts.size / 2}" y="${opts.size * 0.8}" font-size="${opts.size * 0.78}" text-anchor="middle" fill="#9aa1ab">${c.replace(/[&<>]/g, '')}</text>`;
      if (d) d.strokes.forEach((_, s) => plan.push({ c: k, char: c, s }));
      cell.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.size} ${opts.size}" width="${opts.size}" height="${opts.size}" style="display:block;max-width:100%;height:auto" role="img" aria-label="Stroke order of ${c}">${inner}</svg>`;
      if (d) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hz-cell-loop';
        btn.append(loopIcon());
        btn.setAttribute('aria-pressed', 'false');
        btn.title = `Loop animation for ${c}`;
        btn.setAttribute('aria-label', `Loop animation for ${c}`);
        btn.onclick = (e) => { e.stopPropagation(); toggleCellLoop(k); };
        cell.append(btn);
        cellLoops.set(k, { active: false, raf: 0, timer: 0, btn });
      }
      stage.append(cell);
    });
    masks = plan.map((p) => stage.querySelector(`[data-g="${p.c}"] [data-i="${p.s}"]`));
    plan.forEach((p, i) => { p.len = Number(masks[i]?.dataset.len) || 600; });
    syncLoopAll();
    if (keepLoopSet?.size) {
      for (const k of keepLoopSet) if (cellLoops.has(k)) startCellLoop(k);
    }
  }
  // Strokes < i whole, stroke i at t (skipping cells running their own independent loop).
  function draw(i, t) {
    masks.forEach((m, k) => {
      if (!m || cellLoops.get(plan[k].c)?.active) return;
      const len = plan[k].len, f = k < i ? 1 : k === i ? t : 0;
      m.setAttribute('stroke-dashoffset', String(Math.round(len * (1 - f))));
      m.setAttribute('stroke', k === i && t > 0 && t < 1 ? opts.active : opts.colour);
    });
  }
  async function setText(next, given = null) {
    chars = [...String(next || '')].filter((c) => c.trim());
    const want = chars.filter(isHan);
    glyphs = { ...(given || {}) };
    const missing = want.filter((c) => !glyphs[c]);
    if (missing.length) Object.assign(glyphs, await strokesFor(missing.join('')).catch(() => ({})));
    build();
    player.setSteps(plan.length, start === 'all' ? plan.length : start);
    if (autoplay) player.play();
    return glyphs;
  }
  const ready = setText(text, data);
  return {
    el, player, ready,
    get data() { return glyphs; }, get index() { return player.index; }, get steps() { return player.steps; }, get plan() { return plan; },
    play: () => player.play(), pause: () => player.pause(), go: (i) => player.go(i), forward: () => player.forward(), replay: () => player.replay(),
    setText: (t, d) => { autoplay = false; return setText(t, d); },
    set(next) {
      const at = player.index;
      const activeLoops = new Set([...cellLoops.entries()].filter(([, st]) => st.active).map(([k]) => k));
      Object.assign(opts, next);
      build(activeLoops);
      player.setSteps(plan.length, at);
    },
    focus: () => player.el.focus({ preventScroll: true }),
    destroy() { stopAllLoops(false); player.destroy(); el.remove(); },
  };
}
