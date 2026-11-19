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
    stage.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(1, w)} ${opts.size}" width="${w}" height="${opts.size}" style="display:block;max-width:100%;height:auto;margin:0 auto" role="img" aria-label="Stroke order of ${chars.join('')}">${body}</svg>`;
    masks = plan.map((p) => stage.querySelector(`[data-g="${p.c}"] [data-i="${p.s}"]`));
    plan.forEach((p, i) => { p.len = Number(masks[i]?.dataset.len) || 600; });
  }
  // Strokes < i whole, stroke i at t.
  function draw(i, t) {
    masks.forEach((m, k) => {
      if (!m) return;
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
    set(next) { const at = player.index; Object.assign(opts, next); build(); player.setSteps(plan.length, at); },
    focus: () => player.el.focus({ preventScroll: true }),
    destroy() { player.destroy(); el.remove(); },
  };
}
