// The stroke-order player (docs/CHINESE-INPUT.md §7.2): the characters of `text` side by side on
// a 米字格 / 田字格 grid, each stroke revealed along its median (stroke-svg.js), driven by the
// kit's step player (play/pause Space, ← →, Home/End, speed, timeline, reduced motion). A step
// is one stroke; the characters play one after another. Used by the hanzi prefab's editor, the
// character look-up panel and the candidate menu's popover.
//
//   const p = strokePlayer(host, { text: '你好', size: 200, grid: 'mi', outline: true, autoplay: true });
//   await p.ready;            // stroke data loaded (strokes.js) unless given as `data`
//   p.play(); p.pause(); p.go(n); p.forward(); p.replay(); p.index; p.steps;
//   p.setText('谢谢'); p.set({ grid: 'tian', outline: false, still: true }); p.data; p.destroy();
// Repeat (the player's loop button, L) plays it over and over; with several characters, the
// small loop button over each one's corner picks which of them repeat (the others stay drawn).
// `still`: a finished copy of the characters beside the animated ones.
import { stepPlayer } from '../prefabs/kit/step-player.js';
import { glyphSvg, gridSvg } from './stroke-svg.js';
import { strokesFor } from './strokes.js';
import { icon } from '../icons.js';

let players = 0;
const STROKE_MS = (d) => 260 + Math.min(700, (d?.len || 600) * 0.75);
export const isHan = (c) => /\p{Script=Han}/u.test(c);

// `text`, `data` ({ char: strokeData }, loaded when missing), `size` (px per character), `grid`
// ("mi" | "tian" | "none"), `outline` (grey character under the strokes), `still` (a finished copy
// beside them), `start` (strokes done at first: a number, or "all"), `autoplay`, `colour`, `active`,
// `onStep(at, steps)`, `caption(at, info)`: a caption of your own. Keys work when the player has focus.
export function strokePlayer(host, { text = '', data = null, size = 180, grid = 'mi', outline = true, still = false, start = 0, autoplay = false, colour = '#1f2328', active = '#d1242f', gridColour = '#e3a9a9', onStep = null, caption = null } = {}) {
  const id = `hzp${++players}`;
  const opts = { size, grid, outline, still, colour, active, gridColour };
  const el = document.createElement('div');
  el.className = 'hz-player';
  const stage = document.createElement('div');
  stage.className = 'hz-stage';
  el.append(stage);
  host.append(el);
  let chars = [], glyphs = {}, plan = [], masks = [], wheels = [], player = null;
  // The characters that repeat (indexes into `chars`); all of them unless some were picked.
  const looped = new Set();
  const animated = () => chars.map((c, k) => (glyphs[c] ? k : -1)).filter((k) => k >= 0);
  const some = () => player?.looping && looped.size > 0 && looped.size < animated().length;
  const left = (k) => some() && !looped.has(k);
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
  const loop = {
    from: () => (some() ? Math.max(0, plan.findIndex((p) => looped.has(p.c))) : 0),
    skip: (i) => left(plan[i]?.c),
    onToggle: (on) => { looped.clear(); if (on) animated().forEach((k) => looped.add(k)); paintWheels(); draw(player.index, 0); },
  };
  player = stepPlayer(el, { steps: 0, key: 'hanzi', duration: (i) => STROKE_MS(plan[i]), gap: 160, caption: captionOf, draw, loop, onChange: (at) => onStep?.(at, plan.length) });

  function paintWheels() {
    for (const b of wheels) {
      const on = player.looping && looped.has(Number(b.dataset.k));
      b.setAttribute('aria-pressed', String(on));
      b.title = `${on ? 'Repeats' : 'Does not repeat'}: ${chars[b.dataset.k]} (click to change)`;
    }
  }
  function toggleWheel(k) {
    const next = new Set(player.looping ? looped : []);
    if (next.has(k)) next.delete(k); else next.add(k);
    if (!next.size) { player.looping = false; return; }
    player.looping = true;
    looped.clear();
    next.forEach((x) => looped.add(x));
    paintWheels();
    draw(player.index, 0);
  }

  function build() {
    const gap = Math.round(opts.size * 0.08), w = chars.length * opts.size + Math.max(0, chars.length - 1) * gap;
    plan = [];
    const body = chars.map((c, k) => {
      const x = k * (opts.size + gap), d = glyphs[c];
      const cell = gridSvg(x, 0, opts.size, opts.grid, opts.gridColour);
      if (!d) return `${cell}<text x="${x + opts.size / 2}" y="${opts.size * 0.8}" font-size="${opts.size * 0.78}" text-anchor="middle" fill="#9aa1ab">${c.replace(/[&<>]/g, '')}</text>`;
      d.strokes.forEach((_, s) => plan.push({ c: k, char: c, s }));
      return `${cell}<g data-g="${k}">${glyphSvg(d, { x, y: 0, size: opts.size, animated: true, done: 0, outline: opts.outline, colour: opts.colour, outlineColour: '#dde1e6', id: `${id}-${k}` })}</g>`;
    }).join('');
    const svg = (inner, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1, w)} ${opts.size}" width="${w}" height="${opts.size}" role="img" aria-label="${label}">${inner}</svg>`;
    const cells = document.createElement('div');
    cells.className = 'hz-cells';
    cells.style.maxWidth = `${w}px`;
    cells.innerHTML = svg(body, `Stroke order of ${chars.join('')}`);
    // One loop button over each character's top right corner, when there are several.
    const withData = animated();
    wheels = withData.length > 1 ? withData.map((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hz-wheel';
      b.dataset.k = String(k);
      b.style.left = `${((k * (opts.size + gap) + opts.size) / w) * 100}%`;
      b.append(icon('loop'));
      b.onclick = () => toggleWheel(k);
      return b;
    }) : [];
    cells.append(...wheels);
    const parts = [cells];
    // The finished characters beside the animated ones (only where something animates).
    if (opts.still && withData.length) {
      const copy = document.createElement('div');
      copy.className = 'hz-still';
      copy.style.maxWidth = `${w}px`;
      copy.innerHTML = svg(chars.map((c, k) => {
        const x = k * (opts.size + gap), d = glyphs[c];
        return gridSvg(x, 0, opts.size, opts.grid, opts.gridColour) + (d ? glyphSvg(d, { x, y: 0, size: opts.size, colour: opts.colour }) : '');
      }).join(''), `${chars.join('')}, finished`);
      parts.push(copy);
    }
    stage.classList.toggle('with-still', parts.length > 1);
    stage.replaceChildren(...parts);
    masks = plan.map((p) => cells.querySelector(`[data-g="${p.c}"] [data-i="${p.s}"]`));
    plan.forEach((p, i) => { p.len = Number(masks[i]?.dataset.len) || 600; });
    paintWheels();
  }
  // Strokes < i whole, stroke i at t (while some characters repeat, the others whole).
  function draw(i, t) {
    masks.forEach((m, k) => {
      if (!m) return;
      const len = plan[k].len, f = k < i || left(plan[k].c) ? 1 : k === i ? t : 0;
      m.setAttribute('stroke-dashoffset', String(Math.round(len * (1 - f))));
      m.setAttribute('stroke', k === i && t > 0 && t < 1 ? opts.active : opts.colour);
    });
  }
  async function setText(next, given = null) {
    chars = [...String(next || '')].filter((c) => c.trim());
    const want = chars.filter(isHan);
    glyphs = { ...(given || {}) };
    looped.clear();
    const missing = want.filter((c) => !glyphs[c]);
    if (missing.length) Object.assign(glyphs, await strokesFor(missing.join('')).catch(() => ({})));
    build();
    if (player.looping) animated().forEach((k) => looped.add(k));
    paintWheels();
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
    set(next) { const at = player.index, playing = player.playing; Object.assign(opts, next); build(); player.setSteps(plan.length, at); if (playing) player.play(); },
    focus: () => player.el.focus({ preventScroll: true }),
    destroy() { player.destroy(); el.remove(); },
  };
}
