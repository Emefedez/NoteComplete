// Writing practice (docs/CHINESE-INPUT.md §7.2, §7.4): trace a character stroke by stroke with
// the pen, a finger or the mouse, checked like Hanzi Writer's quiz. A stroke is accepted when it
// lies along the expected median, starts and ends near its ends, goes the same way, has about
// its length, and fits it better than any other stroke still to write. After 2 misses on a
// stroke it flashes as a hint. Results go to IndexedDB "notecomplete-chinese", store "practice":
// { char, at, mistakes, strokes: [misses per stroke] }.
//
//   const p = practise(host, { char: '你', onDone: (r) => … });   // r = { char, mistakes, strokes, at }
//   p.ready; p.reset(); p.hint(); p.destroy();
//   scoreStroke(points, medians, index, { from }) → { ok, avg, start, end, cos, ratio, closest }
import { glyphSvg, gridSvg, dist, pathLength, fromScreen } from './stroke-svg.js';
import { strokeData } from './strokes.js';
import { withStore } from './db.js';

// In the 1024 box. Hanzi Writer's: 350 × 0.5 average distance once the first stroke is in or
// an outline shows, 250 at the ends; length as in §7.2, both lengths + 25 so dots are fair.
export const LIMITS = { avg: 175, ends: 250, ratio: [0.5, 1.8], points: 32 };

// `points` spaced evenly along a polyline (n of them).
export function resample(points, n = LIMITS.points) {
  const pts = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 0);
  if (pts.length < 2) return Array.from({ length: n }, () => [...(pts[0] || [0, 0])]);
  const total = pathLength(pts), step = total / (n - 1), out = [[...pts[0]]];
  let k = 1, prev = pts[0], walked = 0;
  for (let i = 1; i < n - 1; i++) {
    const target = i * step;
    while (k < pts.length && walked + dist(prev, pts[k]) < target) { walked += dist(prev, pts[k]); prev = pts[k]; k++; }
    if (k >= pts.length) break;
    const f = (target - walked) / (dist(prev, pts[k]) || 1);
    out.push([prev[0] + (pts[k][0] - prev[0]) * f, prev[1] + (pts[k][1] - prev[1]) * f]);
  }
  while (out.length < n) out.push([...pts[pts.length - 1]]);
  return out;
}
const toSegment = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
// Mean distance from the drawn points to the median line.
export function averageDistance(points, median) {
  if (median.length < 2) return points.reduce((n, p) => n + dist(p, median[0] || [0, 0]), 0) / points.length;
  return points.reduce((n, p) => { let best = Infinity; for (let i = 1; i < median.length; i++) best = Math.min(best, toSegment(p, median[i - 1], median[i])); return n + best; }, 0) / points.length;
}
function measure(user, median) {
  const avg = averageDistance(user, median);
  const start = dist(user[0], median[0]), end = dist(user[user.length - 1], median[median.length - 1]);
  const u = [user[user.length - 1][0] - user[0][0], user[user.length - 1][1] - user[0][1]];
  const m = [median[median.length - 1][0] - median[0][0], median[median.length - 1][1] - median[0][1]];
  const cos = (u[0] * m[0] + u[1] * m[1]) / ((Math.hypot(...u) * Math.hypot(...m)) || 1);
  const ratio = (pathLength(user) + 25) / (pathLength(median) + 25);
  return { avg, start, end, cos, ratio };
}
const fits = (r) => r.avg <= LIMITS.avg && r.start <= LIMITS.ends && r.end <= LIMITS.ends && r.cos > 0 && r.ratio >= LIMITS.ratio[0] && r.ratio <= LIMITS.ratio[1];
const badness = (r) => r.avg + (r.start + r.end) / 2;
// Is `points` (the 1024 box, y up, in the order drawn) stroke `index` of `medians`? `from`: the
// first stroke still to write (default `index`): strokes from it on compete for the drawing.
export function scoreStroke(points, medians, index, { from = index } = {}) {
  const median = medians?.[index];
  if (!median?.length || !points?.length) return { ok: false, avg: Infinity, start: Infinity, end: Infinity, cos: 0, ratio: 0, closest: null };
  const user = resample(points);
  const own = measure(user, median);
  let closest = index;
  for (let j = from; j < medians.length; j++) {
    if (j === index) continue;
    const r = measure(user, medians[j]);
    if (fits(r) && badness(r) < badness(own)) closest = j;
  }
  return { ok: fits(own) && closest === index, ...own, closest };
}

// Practice results, stored.
export const recordPractice = (result) => withStore('practice', 'readwrite', (s) => s.add({ char: result.char, at: result.at || Date.now(), mistakes: result.mistakes, strokes: result.strokes }));

// `char`, `data` (loaded when missing), `size`, `grid`, `outline` (grey character to trace),
// `record` (store the result), `onStroke(score, index)`, `onDone(result)`, `hintAfter` (misses).
export function practise(host, { char, data = null, size = 260, grid = 'mi', outline = true, record = true, hintAfter = 2, colour = '#1f2328', ink = '#245dc4', hintColour = '#7fb0ff', onStroke = null, onDone = null } = {}) {
  const el = document.createElement('div');
  el.className = 'hz-practice';
  host.append(el);
  let d = null, next = 0, misses = [], svg = null, masks = [], drawing = null, finished = false;
  const status = document.createElement('p');
  status.className = 'hz-practice-status';
  status.setAttribute('role', 'status');
  const reveal = (i, colourOf, ms = 260, back = false) => {
    const m = masks[i];
    if (!m) return;
    const len = Number(m.dataset.len);
    m.setAttribute('stroke', colourOf);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frames = back ? [{ strokeDashoffset: len }, { strokeDashoffset: 0, offset: 0.6 }, { strokeDashoffset: 0, opacity: 0 }] : [{ strokeDashoffset: len }, { strokeDashoffset: 0 }];
    if (reduced && !back) { m.setAttribute('stroke-dashoffset', '0'); return; }
    const a = m.animate(frames, { duration: back ? ms * 3 : ms, easing: 'ease-out' });
    a.onfinish = () => m.setAttribute('stroke-dashoffset', back ? String(len) : '0');
    if (!back) m.setAttribute('stroke-dashoffset', '0');
  };
  function build() {
    el.replaceChildren();
    if (!d) { status.textContent = `No stroke order for ${char}`; el.append(status); return; }
    el.insertAdjacentHTML('beforeend', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;max-width:100%;height:auto;margin:0 auto;touch-action:none;cursor:crosshair;background:#fff;border-radius:6px" role="img" aria-label="Write ${char}">${gridSvg(0, 0, size, grid)}${glyphSvg(d, { size, animated: true, done: 0, outline, colour, outlineColour: '#e3e6ea', id: `hzq${Math.random().toString(36).slice(2, 7)}` })}<path class="hz-ink" fill="none" stroke="${ink}" stroke-width="${Math.max(3, size / 40)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    el.append(status);
    svg = el.querySelector('svg');
    masks = [...svg.querySelectorAll('[data-i]')];
    svg.addEventListener('pointerdown', down);
    say();
  }
  const say = (extra = '') => { status.textContent = finished ? `Done: ${misses.reduce((a, b) => a + b, 0)} mistake${misses.reduce((a, b) => a + b, 0) === 1 ? '' : 's'}` : `${extra}Stroke ${next + 1} of ${d.strokes.length}`; };
  const local = (e) => { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse()); return [p.x, p.y]; };
  function down(e) {
    if (finished || drawing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch { /* Synthetic. */ }
    drawing = { id: e.pointerId, pts: [local(e)] };
    const ink = svg.querySelector('.hz-ink');
    const move = (m) => {
      if (m.pointerId !== drawing?.id) return;
      for (const c of m.getCoalescedEvents?.() || [m]) drawing.pts.push(local(c));
      ink.setAttribute('d', `M${drawing.pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`);
    };
    const up = (u) => {
      if (u.pointerId !== drawing?.id) return;
      svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up);
      const pts = drawing.pts.map((q) => fromScreen(q, 0, 0, size));
      drawing = null;
      ink.setAttribute('d', '');
      if (u.type === 'pointercancel' || pts.length < 2) return;
      check(pts);
    };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  }
  function check(pts) {
    const score = scoreStroke(pts, d.medians, next);
    onStroke?.(score, next);
    if (score.ok) {
      reveal(next, colour);
      next++;
      if (next >= d.strokes.length) return finish();
      return say();
    }
    misses[next]++;
    if (misses[next] >= hintAfter) hint();
    say(misses[next] >= hintAfter ? 'Follow the blue stroke · ' : 'Not quite · ');
  }
  function hint() { if (d && !finished) reveal(next, hintColour, 420, true); }
  async function finish() {
    finished = true;
    say();
    const result = { char, at: Date.now(), mistakes: misses.reduce((a, b) => a + b, 0), strokes: [...misses] };
    if (record) await recordPractice(result).catch((e) => console.warn('Practice not recorded:', e));
    onDone?.(result);
  }
  function reset() { next = 0; finished = false; misses = d ? d.strokes.map(() => 0) : []; build(); }
  const ready = (data ? Promise.resolve(data) : strokeData(char).catch(() => null)).then((x) => { d = x; reset(); return d; });
  return { el, ready, reset, hint, get index() { return next; }, get misses() { return [...misses]; }, check: (pts) => check(pts), destroy() { el.remove(); } };
}
