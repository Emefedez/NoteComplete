// Touch gestures on the pages, for phones, tablets and touchscreen computers alike:
// two fingers move the pages and pinch to zoom; a quick tap with two fingers undoes and
// with three fingers redoes. One finger keeps doing what the tool does (draws, selects,
// or scrolls with Pan); a second finger cancels a stroke the first one had just begun.
// A two-finger scroll keeps gliding after the fingers lift (momentum.js). A stylus (Apple
// Pencil) is never one of the fingers: it draws, and a palm or finger beside it does not
// cancel its stroke.
import { VelocityTracker } from './momentum.js';

const TAP_MS = 300, TAP_SLOP = 12, PAN_START = 8, ZOOM_START = 0.08, HOLD_MS = 380;

export function measure(touches) {
  const list = [...touches];
  const x = list.reduce((s, t) => s + t.clientX, 0) / list.length;
  const y = list.reduce((s, t) => s + t.clientY, 0) / list.length;
  const d = list.length > 1 ? Math.hypot(list[0].clientX - list[1].clientX, list[0].clientY - list[1].clientY) : 0;
  return { x, y, d };
}

// The pure part: fed touch snapshots, it says what to do (tested in touch.test.mjs).
export class TouchGesture {
  constructor() { this.reset(); }
  reset() { this.active = null; }
  // Two fingers held still (not moved, not zooming or scrolling) for HOLD_MS: the quick
  // menu at their centre. Asked by a timer, since nothing else happens meanwhile.
  hold(time) {
    const a = this.active;
    if (!a || a.held || a.moved || a.mode || a.count !== 2 || time - a.time < HOLD_MS) return [];
    a.held = true;
    return [{ type: 'menu', x: a.last.x, y: a.last.y }];
  }
  // `touches`: [{clientX, clientY}], `time`: ms. Returns actions to apply.
  start(touches, time) {
    const n = touches.length, m = measure(touches);
    if (!this.active) this.active = { count: n, time, origin: m, last: m, moved: false, multi: n > 1, speed: new VelocityTracker() };
    else {
      // Another finger: measure from here (the centre jumps when a finger lands).
      if (n > this.active.count) { this.active.origin = m; this.active.mode = null; }
      this.active.count = Math.max(this.active.count, n);
      this.active.multi ||= n > 1;
      this.active.last = m;
    }
    return n > 1 ? [{ type: 'cancel' }] : [];
  }
  move(touches, time = 0) {
    const a = this.active;
    if (!a) return [];
    const m = measure(touches), out = [];
    if (Math.hypot(m.x - a.origin.x, m.y - a.origin.y) > TAP_SLOP || (a.origin.d && Math.abs(m.d - a.origin.d) > TAP_SLOP)) a.moved = true;
    if (touches.length >= 2) {
      // Fingers moving together always change their gap a little: a gesture zooms only
      // when they clearly spread or close, else it scrolls, and keeps that until lifted.
      // Once decided, the movement made while deciding counts too (from the origin), so
      // the pages start moving with the fingers instead of after a dead zone.
      let from = a.last;
      if (!a.mode && a.origin.d && m.d) {
        // A zoom also needs the gap to change by a few px: fingers held close together shift
        // that much as they settle on the glass (iPad), and that is still a hold.
        if (Math.abs(m.d / a.origin.d - 1) > ZOOM_START && Math.abs(m.d - a.origin.d) > PAN_START) { a.mode = 'zoom'; from = a.origin; }
        else if (Math.hypot(m.x - a.origin.x, m.y - a.origin.y) > PAN_START) { a.mode = 'pan'; from = a.origin; }
      }
      if (a.mode === 'zoom' && from.d && m.d && m.d !== from.d) out.push({ type: 'zoom', x: m.x, y: m.y, step: m.d / from.d });
      else if (a.mode === 'pan') {
        out.push({ type: 'pan', dx: m.x - from.x, dy: m.y - from.y });
        a.speed.add(m.x, m.y, time);
      }
    }
    a.last = m;
    return out;
  }
  end(remaining, time) {
    const a = this.active;
    if (!a) return [];
    // The scroll ends when fewer than two fingers are left: it glides on from there.
    const out = [];
    if (a.mode === 'pan' && remaining.length < 2) {
      const { vx, vy } = a.speed.velocity(time);
      a.mode = 'done';
      if (vx || vy) out.push({ type: 'fling', vx: -vx, vy: -vy });
    }
    if (remaining.length) { a.last = measure(remaining); return out; }
    this.active = null;
    if (a.held) return out;
    if (a.multi && !a.moved && time - a.time < TAP_MS) return [{ type: a.count >= 3 ? 'redo' : 'undo' }];
    return out;
  }
}

// Two fingers that mean it: they land within 250 ms of each other and neither is clearly a
// palm resting on the screen. Safari on iPad reports a fingertip's radius in coarse steps
// (about 21, 31 or 42 px, larger when pressed flat), so only a radius well past that is a
// palm. A radius that is missing or 0 (not reported) counts as a finger.
export const PALM_RADIUS = 55;
export function deliberate(touches, gapMs) {
  if (gapMs > 250) return false;
  const radius = (t) => Math.max(Number(t.radiusX) || 0, Number(t.radiusY) || 0);
  return [...touches].every((t) => radius(t) <= PALM_RADIUS);
}

// Fingers only: an Apple Pencil's touches (touchType "stylus") are left to the pointer events.
const fingers = (list) => [...list].filter((t) => t.touchType !== 'stylus');

export function touchGestures({ viewport, pinchBy, cancelGesture, undo, redo, fling = () => {}, stop = () => {}, menu = () => {}, penBusy = () => false, enabled = () => true }) {
  const g = new TouchGesture();
  let holdTimer = 0, firstAt = 0;
  const apply = (actions) => {
    for (const a of actions) {
      if (a.type === 'cancel') cancelGesture();
      else if (a.type === 'zoom') pinchBy(a.x, a.y, a.step);
      else if (a.type === 'pan') { viewport.scrollLeft -= a.dx; viewport.scrollTop -= a.dy; }
      else if (a.type === 'undo') undo();
      else if (a.type === 'redo') redo();
      else if (a.type === 'fling') fling(a.vx, a.vy);
      else if (a.type === 'menu') menu(a.x, a.y);
    }
  };
  const on = (type, handler) => viewport.addEventListener(type, handler, { passive: false });
  on('touchstart', (e) => {
    // A touch catches the pages that were still gliding.
    stop();
    const touches = fingers(e.touches);
    if (!enabled()) { g.reset(); return; }
    if (!touches.length) return;
    if (touches.length > 1) e.preventDefault();
    // Every finger down is new: a new gesture. Fingers that land together come in one event
    // (often on iPad), and the last gesture may never have heard its fingers lift (its
    // touchend went to a part of the page redrawn meanwhile); neither must spoil this one.
    if (touches.length === fingers(e.changedTouches).length) {
      g.reset();
      firstAt = e.timeStamp;
    }
    apply(g.start(touches, e.timeStamp));
    clearTimeout(holdTimer);
    // Two fingers held still open the quick menu, if they look deliberate: both landed
    // together, neither is a resting palm, and no stylus was just writing (palm rejection
    // on iPad with the Pencil).
    if (touches.length === 2 && deliberate(touches, e.timeStamp - firstAt) && !penBusy()) {
      const at = e.timeStamp;
      holdTimer = setTimeout(() => apply(g.hold(at + HOLD_MS + 10)), HOLD_MS + 10);
    }
  });
  on('touchmove', (e) => {
    if (!g.active) return;
    const touches = fingers(e.touches);
    // One finger: the browser scrolls (Pan) or the tool draws; two or more are ours.
    if (touches.length > 1) e.preventDefault();
    apply(g.move(touches, e.timeStamp));
  });
  const end = (e) => { clearTimeout(holdTimer); if (g.active) apply(g.end(fingers(e.touches), e.timeStamp)); };
  on('touchend', end);
  on('touchcancel', () => { clearTimeout(holdTimer); g.reset(); });
  // Safari's own pinch (its gesture events) would zoom the whole page and can cancel the
  // touches; two fingers are handled above.
  on('gesturestart', (e) => e.preventDefault());
  return g;
}
