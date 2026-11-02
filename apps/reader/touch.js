// Touch gestures on the pages, for phones, tablets and touchscreen computers alike:
// two fingers move the pages and pinch to zoom; a quick tap with two fingers undoes and
// with three fingers redoes. One finger keeps doing what the tool does (draws, selects,
// or scrolls with Pan); a second finger cancels a stroke the first one had just begun.
// A two-finger scroll keeps gliding after the fingers lift (momentum.js). A stylus (Apple
// Pencil) is never one of the fingers: it draws, and a palm or finger beside it does not
// cancel its stroke.
import { VelocityTracker } from './momentum.js';

const TAP_MS = 300, TAP_SLOP = 12, ZOOM_START = 0.08;

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
      if (!a.mode && a.origin.d && m.d) {
        if (Math.abs(m.d / a.origin.d - 1) > ZOOM_START) a.mode = 'zoom';
        else if (Math.hypot(m.x - a.origin.x, m.y - a.origin.y) > TAP_SLOP) a.mode = 'pan';
      }
      if (a.mode === 'zoom' && a.last.d && m.d && m.d !== a.last.d) out.push({ type: 'zoom', x: m.x, y: m.y, step: m.d / a.last.d });
      else if (a.mode === 'pan') {
        out.push({ type: 'pan', dx: m.x - a.last.x, dy: m.y - a.last.y });
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
    if (a.multi && !a.moved && time - a.time < TAP_MS) return [{ type: a.count >= 3 ? 'redo' : 'undo' }];
    return out;
  }
}

// Fingers only: an Apple Pencil's touches (touchType "stylus") are left to the pointer events.
const fingers = (list) => [...list].filter((t) => t.touchType !== 'stylus');

export function touchGestures({ viewport, pinchBy, cancelGesture, undo, redo, fling = () => {}, stop = () => {}, enabled = () => true }) {
  const g = new TouchGesture();
  const apply = (actions) => {
    for (const a of actions) {
      if (a.type === 'cancel') cancelGesture();
      else if (a.type === 'zoom') pinchBy(a.x, a.y, a.step);
      else if (a.type === 'pan') { viewport.scrollLeft -= a.dx; viewport.scrollTop -= a.dy; }
      else if (a.type === 'undo') undo();
      else if (a.type === 'redo') redo();
      else if (a.type === 'fling') fling(a.vx, a.vy);
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
    apply(g.start(touches, e.timeStamp));
  });
  on('touchmove', (e) => {
    if (!g.active) return;
    const touches = fingers(e.touches);
    // One finger: the browser scrolls (Pan) or the tool draws; two or more are ours.
    if (touches.length > 1) e.preventDefault();
    apply(g.move(touches, e.timeStamp));
  });
  const end = (e) => { if (g.active) apply(g.end(fingers(e.touches), e.timeStamp)); };
  on('touchend', end);
  on('touchcancel', () => g.reset());
  return g;
}
