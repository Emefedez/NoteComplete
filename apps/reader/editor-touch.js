// The note pages' finger and pen gestures, in the chart and diagram editors' canvases:
// - a quick tap with two fingers undoes, with three fingers redoes;
// - two fingers held still, or the pen held still on the canvas, open the quick menu there;
// - a pen hovering over the canvas shows where it points (a small ring), as on the pages.
// The editors keep their own one-finger, pen and pinch handling; this only adds to it.
const TAP_MS = 300, TAP_SLOP = 12, HOLD_MS = 450, PEN_HOLD_MS = 550, PEN_SLOP = 4;

// The pure part (editor-touch.test.mjs): fed the touches as they go down, move and lift, it
// says when a tap of n fingers happened or when two fingers have been held long enough.
export function fingerTaps() {
  let gesture = null;
  return {
    down(id, x, y, time) {
      if (!gesture) gesture = { start: time, points: new Map(), max: 0, moved: false, held: false };
      gesture.points.set(id, [x, y, x, y]);
      gesture.max = Math.max(gesture.max, gesture.points.size);
    },
    move(id, x, y) {
      const p = gesture?.points.get(id);
      if (!p) return;
      p[2] = x; p[3] = y;
      if (Math.hypot(x - p[0], y - p[1]) > TAP_SLOP) gesture.moved = true;
    },
    // A lifted finger: 'undo' or 'redo' when the last one of a quick, still tap lifts.
    up(id, time) {
      if (!gesture?.points.has(id)) return null;
      gesture.points.delete(id);
      if (gesture.points.size) return null;
      const g = gesture;
      gesture = null;
      if (g.moved || g.held || time - g.start > TAP_MS) return null;
      return g.max === 2 ? 'undo' : g.max === 3 ? 'redo' : null;
    },
    // Asked by a timer: two fingers down and still for HOLD_MS gives their centre, once.
    hold(time) {
      const g = gesture;
      if (!g || g.held || g.moved || g.points.size !== 2 || time - g.start < HOLD_MS) return null;
      g.held = true;
      const [a, b] = [...g.points.values()];
      return [(a[2] + b[2]) / 2, (a[3] + b[3]) / 2];
    },
    cancel() { gesture = null; },
  };
}

// `el`: the canvas. `undo()`, `redo()`; `menuAt(x, y)` opens the quick menu at a screen point;
// `cancel()` stops what a first finger or the pen had started (a pan, a move) before a menu.
export function editorTouch(el, { undo, redo, menuAt, cancel = () => {} }) {
  const taps = fingerTaps();
  let holdTimer = 0, pen = null;
  const ring = document.createElement('div');
  ring.className = 'pen-hover-ring';
  ring.hidden = true;
  document.body.append(ring);
  const showRing = (e) => {
    ring.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    ring.hidden = false;
  };
  const down = (e) => {
    if (e.pointerType === 'touch') {
      taps.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        const at = taps.hold(performance.now());
        if (at) { cancel(); menuAt(at[0], at[1]); }
      }, HOLD_MS + 20);
    } else if (e.pointerType === 'pen') {
      ring.hidden = true;
      clearTimeout(pen?.timer);
      pen = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { pen = null; cancel(); menuAt(e.clientX, e.clientY); }, PEN_HOLD_MS) };
    }
  };
  const move = (e) => {
    if (e.pointerType === 'touch') taps.move(e.pointerId, e.clientX, e.clientY);
    else if (e.pointerType === 'pen') {
      if (pen && Math.hypot(e.clientX - pen.x, e.clientY - pen.y) > PEN_SLOP) { clearTimeout(pen.timer); pen = null; }
      if (!e.buttons) showRing(e);
      else ring.hidden = true;
    } else ring.hidden = true;
  };
  const up = (e) => {
    if (e.pointerType === 'touch') {
      const act = taps.up(e.pointerId, e.timeStamp);
      if (act) { cancel(); (act === 'undo' ? undo : redo)(); }
    } else if (e.pointerType === 'pen' && pen) { clearTimeout(pen.timer); pen = null; }
  };
  const gone = (e) => {
    if (e.pointerType === 'touch') taps.cancel();
    if (e.pointerType === 'pen' && pen) { clearTimeout(pen.timer); pen = null; }
  };
  const leave = () => { ring.hidden = true; };
  el.addEventListener('pointerdown', down, true);
  el.addEventListener('pointermove', move, true);
  el.addEventListener('pointerup', up, true);
  el.addEventListener('pointercancel', gone, true);
  el.addEventListener('pointerleave', leave);
  return {
    destroy() {
      clearTimeout(holdTimer);
      clearTimeout(pen?.timer);
      ring.remove();
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true);
      el.removeEventListener('pointercancel', gone, true);
      el.removeEventListener('pointerleave', leave);
    },
  };
}
