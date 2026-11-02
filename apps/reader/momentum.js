// Scrolling that keeps going after the fingers lift, as native apps do: the release
// velocity decays exponentially, the way UIScrollView decelerates (Apple's "Designing
// Fluid Interfaces"), so a flick throws the pages and a slow drag stops where it is.
export const DECELERATION = 0.998; // per millisecond; 0.99 feels snappier
const WINDOW_MS = 100, MAX_SPEED = 8000, MIN_SPEED = 60, STOP_SPEED = 12;

// How far a release at `velocity` (px/s) travels before it comes to rest.
export function project(velocity, rate = DECELERATION) {
  return ((velocity / 1000) * rate) / (1 - rate);
}
// How far it has travelled `t` ms after the release (tends to project(velocity)).
export function travelled(velocity, t, rate = DECELERATION) {
  return project(velocity, rate) * (1 - rate ** t);
}

// The pointer's recent positions → its velocity (px/s) when it lifts. Only the last
// 100 ms count, so a drag that paused before lifting does not fling.
export class VelocityTracker {
  constructor() { this.samples = []; }
  reset() { this.samples = []; }
  add(x, y, time) {
    this.samples.push({ x, y, time });
    while (this.samples.length > 2 && time - this.samples[1].time > WINDOW_MS) this.samples.shift();
  }
  velocity(now = this.samples.at(-1)?.time) {
    const last = this.samples.at(-1);
    if (!last || now - last.time > WINDOW_MS) return { vx: 0, vy: 0 };
    const recent = this.samples.filter((s) => last.time - s.time <= WINDOW_MS);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const a = recent[0], b = recent.at(-1), dt = b.time - a.time;
    if (dt <= 0) return { vx: 0, vy: 0 };
    const clamp = (v) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
    return { vx: clamp(((b.x - a.x) / dt) * 1000), vy: clamp(((b.y - a.y) / dt) * 1000) };
  }
}

// Glides by (vx, vy) px/s: `apply(dx, dy)` scrolls and returns false once nothing moved
// (an edge). Any touch, wheel or key stops it (stop()).
export function momentum({ apply, rate = DECELERATION, frame = (f) => requestAnimationFrame(f), cancel = (id) => cancelAnimationFrame(id), now = () => performance.now() }) {
  let id = 0;
  const stop = () => { if (id) cancel(id); id = 0; };
  function fling(vx, vy) {
    stop();
    if (Math.hypot(vx, vy) < MIN_SPEED) return false;
    const start = now();
    let doneX = 0, doneY = 0;
    const step = () => {
      const t = now() - start;
      // Whole pixels at a time (a scroll position rounds a fraction away); the rest waits.
      const dx = Math.trunc(travelled(vx, t, rate) - doneX), dy = Math.trunc(travelled(vy, t, rate) - doneY);
      let moved = true;
      if (dx || dy) { moved = apply(dx, dy); doneX += dx; doneY += dy; }
      if (moved === false || Math.hypot(vx, vy) * rate ** t < STOP_SPEED) { id = 0; return; }
      id = frame(step);
    };
    id = frame(step);
    return true;
  }
  return { fling, stop, get running() { return !!id; } };
}
