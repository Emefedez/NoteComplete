// Floating windows (Ask AI, audio, quiz, flashcard practice): drag them by their
// head, resize them from any edge or corner (or anywhere, like a tiling window manager:
// Ctrl/⌘ + drag moves, Shift + drag resizes from the nearest corner), and they can be dragged mostly out of
// their area to get the space back (a strip of the head always stays reachable). The head gets _ (put away in the
// window tray at the bottom left, from which it comes back) and □ (small or
// large) next to ×. Place and size are remembered per window.
import { icon } from './icons.js';

const $ = id => document.getElementById(id);
// How much of a window must stay on screen when it is dragged out of bounds.
const GRAB = 56;
const EDGES = { left: 'l', right: 'r', top: 't', bottom: 'b', 'bottom-left': 'bl', 'bottom-right': 'br', 'top-left': 'tl', 'top-right': 'tr' };

// Keep a rect inside the area: no wider or taller than it, and fully on it.
// With `grab` > 0 a window may be pushed mostly out of the area on any side: only `grab` px
// of it must stay in, so it can still be grabbed back (see shownRect for what is drawn).
export function clampRect({ left, top, width, height }, area, min = { width: 0, height: 0 }, grab = 0) {
  width = Math.max(Math.min(min.width, area.width), Math.min(width, area.width));
  height = Math.max(Math.min(min.height, area.height), Math.min(height, area.height));
  if (grab > 0) {
    const g = Math.min(grab, width, height);
    left = Math.max(g - width, Math.min(area.width - g, left));
    top = Math.max(g - height, Math.min(area.height - g, top));
    return { left, top, width, height };
  }
  left = Math.max(0, Math.min(area.width - width, left));
  top = Math.max(0, Math.min(area.height - height, top));
  return { left, top, width, height };
}

// What of a pushed window is drawn: the part inside the area. A window pushed over an edge
// gets smaller instead of being cut off, and grows back as it is moved back in.
export function shownRect({ left, top, width, height }, area) {
  const l = Math.max(0, left), t = Math.max(0, top);
  const r = Math.min(area.width, left + width), b = Math.min(area.height, top + height);
  return { left: l, top: t, width: Math.max(0, r - l), height: Math.max(0, b - t) };
}

// A comfortable reading/workspace rect centered inside `area`, clamped to `area` and `min`.
// No upper limit by default: on a small screen "large" is almost all of it.
export function largeRect(area, { ratio = 0.94, maxWidth = Infinity, maxHeight = Infinity, min = { width: 0, height: 0 } } = {}) {
  const aw = Math.max(0, Number(area?.width) || 0);
  const ah = Math.max(0, Number(area?.height) || 0);
  const mw = Math.max(0, Number(min?.width) || 0);
  const mh = Math.max(0, Number(min?.height) || 0);
  const width = Math.max(Math.min(mw, aw), Math.min(maxWidth, Math.round(aw * ratio)));
  const height = Math.max(Math.min(mh, ah), Math.min(maxHeight, Math.round(ah * ratio)));
  const left = Math.round((aw - width) / 2);
  const top = Math.round((ah - height) / 2);
  return clampRect({ left, top, width, height }, { width: aw, height: ah }, { width: mw, height: mh });
}

// A rect resized by a pointer move (dx, dy) on some edges ('l', 'r', 't', 'b' combined).
export function resizeRect(start, dx, dy, edges, min, area) {
  let { left, top, width, height } = start;
  if (edges.includes('r')) width = Math.min(area.width - left, Math.max(min.width, start.width + dx));
  if (edges.includes('b')) height = Math.min(area.height - top, Math.max(min.height, start.height + dy));
  if (edges.includes('l')) {
    const right = start.left + start.width;
    left = Math.max(0, Math.min(right - min.width, start.left + dx));
    width = right - left;
  }
  if (edges.includes('t')) {
    const bottom = start.top + start.height;
    top = Math.max(0, Math.min(bottom - min.height, start.top + dy));
    height = bottom - top;
  }
  return { left, top, width, height };
}

// Stacking: the window used last is in front. Layers start at --window-z, which the
// focus dimming raises above its veil, so the order is the same with or without it.
const stack = [];
const windows = new WeakMap();
export function windowOf(el) { return el ? windows.get(el) || null : null; }
// A window moved over the top bar comes above it (--window-floor, `.over-bar`): it is where the
// user put it, so it is not hidden under the bar.
function restack() { stack.forEach((w, i) => { w.style.zIndex = `calc(max(var(--window-z, 26), var(--window-floor, 0)) + ${i})`; }); }
// Whether a rect drawn on the screen covers part of the top bar (header.chrome).
export function overBar(top) {
  const bar = typeof document !== 'undefined' && typeof document.querySelector === 'function' ? document.querySelector('header.chrome')?.getBoundingClientRect?.() : null;
  return !!bar && bar.height > 0 && top < bar.bottom;
}
function raise(el) {
  if (stack.at(-1) === el) return;
  stack.splice(stack.indexOf(el), 1);
  stack.push(el);
  restack();
}

// The tray: one button with a caret listing the windows put away; choosing one brings it back.
let trayEl = null;
const trayed = new Map(); // element -> { label, restore }
function tray() {
  if (trayEl) return trayEl;
  trayEl = document.createElement('div');
  trayEl.className = 'window-tray';
  trayEl.hidden = true;
  trayEl.innerHTML = '<div class="window-tray-menu" role="menu" hidden></div><button type="button" class="has-caret window-tray-button" aria-haspopup="menu" aria-expanded="false" title="Windows you put away"><span class="window-tray-label"></span><span class="caret"></span></button>';
  document.body.append(trayEl);
  const button = trayEl.querySelector('button'), menu = trayEl.querySelector('.window-tray-menu');
  const show = open => { menu.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
  button.onclick = () => show(menu.hidden);
  document.addEventListener('pointerdown', e => { if (!trayEl.contains(e.target)) show(false); });
  trayEl.show = show;
  return trayEl;
}
function renderTray() {
  const el = tray(), menu = el.querySelector('.window-tray-menu');
  el.hidden = !trayed.size;
  el.querySelector('.window-tray-label').textContent = trayed.size === 1 ? [...trayed.values()][0].label : `${trayed.size} windows`;
  menu.replaceChildren(...[...trayed.entries()].map(([, item]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = item.label;
    b.onclick = () => { el.show(false); item.restore(); };
    return b;
  }));
  if (!trayed.size) el.show(false);
}
// For other movable windows (the prefab kit's): the same tray. `restore` brings it back.
export function trayPut(el, label, restore) {
  trayed.set(el, { label, restore: () => { trayed.delete(el); renderTray(); restore(); } });
  renderTray();
}
export function trayDrop(el) { if (trayed.delete(el)) renderTray(); }

// Windows are free on the whole screen (`screen`), over the toolbars, side panels and, when
// moved there, the top bar; pushed against an edge of the screen they get smaller from that edge. They start where their CSS places them in the work area.
export function floatingWindow(el, { key, head, close, label, compact = null, enabled = () => true, minWidth = 280, minHeight = 200, scroll = false, buttonClass = '', screen = null }) {
  key = `${key}:screen`;
  const fixed = () => getComputedStyle(el).position === 'fixed';
  const area = () => {
    if (fixed()) return screen?.() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const r = (el.offsetParent || document.body).getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  const min = { width: minWidth, height: minHeight };
  const isCompact = () => !!compact && el.classList.contains(compact.cls);
  let large = false, beforeLarge = null;
  // The window's rect relative to its area, as drawn now.
  function drawn() {
    const r = el.getBoundingClientRect(), a = area();
    return { left: r.left - a.left, top: r.top - a.top, width: r.width, height: r.height };
  }
  // Where it is: the full rect while it is pushed over an edge (what is drawn is smaller).
  let pushed = false, want = null;
  function current() { return pushed && want ? { ...want } : drawn(); }
  function apply(rect, save = false) {
    const a = area(), c = clampRect(rect, a, isCompact() ? { width: min.width, height: 0 } : min, GRAB);
    // Fixed windows are placed on the screen; the area may start below the top bar.
    const off = fixed() ? a : { left: 0, top: 0 };
    // Pushed over an edge: the part inside is drawn (smaller), the head gets shorter at the top.
    const v = shownRect(c, a);
    pushed = v.left !== c.left || v.top !== c.top || v.width !== c.width || (!isCompact() && v.height !== c.height);
    want = pushed ? c : null;
    el.classList.toggle('pushed', pushed);
    el.classList.toggle('tucked', c.top < 0 && !isCompact());
    Object.assign(el.style, { left: `${off.left + v.left}px`, top: `${off.top + v.top}px`, width: `${v.width}px`, right: 'auto', bottom: 'auto', margin: '0' });
    el.classList.toggle('over-bar', fixed() && overBar(off.top + v.top));
    if (!isCompact()) el.style.height = `${v.height}px`;
    if (save) {
      if (large) {
        large = false;
        beforeLarge = null;
        el.classList.remove('window-large');
      }
      const keep = { left: c.left, top: c.top, width: c.width, height: isCompact() ? saved()?.height ?? c.height : c.height };
      try { localStorage.setItem(key, JSON.stringify(keep)); } catch { /* Optional. */ }
    }
  }
  const saved = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const visible = () => enabled() && !el.hidden && (el.tagName !== 'DIALOG' || el.open) && !el.classList.contains('in-tray');
  // Put back where it was left, inside the current area.
  // Placed by left/top from the start (not bottom), so □ collapses it under its head
  // instead of moving the head; width never changes with □.
  function place() {
    if (!visible()) return;
    if (large) {
      if (!el.classList.contains('screen-window')) el.classList.add('screen-window');
      apply(largeRect(area(), { min }), false);
      return;
    }
    const s = saved();
    // First shown: placed by its CSS in the work area, then free on the whole screen.
    if (!el.classList.contains('screen-window')) {
      const r = el.getBoundingClientRect(), stretched = getComputedStyle(el).bottom !== 'auto' && getComputedStyle(el).top !== 'auto';
      el.classList.add('screen-window');
      if (!s) {
        const a = area();
        apply({ left: r.left - a.left, top: r.top - a.top, width: r.width, height: r.height });
        if (!stretched && !isCompact()) el.style.height = '';
        return;
      }
    }
    if (s) apply(s);
    else if (!isCompact()) {
      // Position and width; the height too for windows stretched between two edges
      // (Ask AI, audio). Others keep following their content until resized by hand.
      const style = getComputedStyle(el), stretched = style.top !== 'auto' && style.bottom !== 'auto';
      const c = clampRect(current(), area(), min, GRAB);
      Object.assign(el.style, { left: `${c.left}px`, top: `${c.top}px`, width: `${c.width}px`, right: 'auto', bottom: 'auto', margin: '0' });
      if (stretched) el.style.height = `${c.height}px`;
    }
  }

  // Content that scrolls goes in an inner body, so the grips stay on the frame.
  if (scroll) {
    const body = document.createElement('div');
    body.className = 'panel-body';
    body.append(...[...el.childNodes].filter(n => n !== head));
    el.append(body);
    el.classList.add('has-body');
  }

  // Head buttons: _ (to the tray) and □ (small / large) before ×.
  const away = document.createElement('button');
  away.type = 'button'; away.className = `icon-button window-away ${buttonClass}`.trim();
  away.title = 'Put away (bring it back from the tray at the bottom left)'; away.setAttribute('aria-label', `Put ${label} away`);
  away.append(icon('minimize'));
  away.onclick = () => putAway();
  let size = compact?.button;
  if (compact && !size) {
    size = document.createElement('button');
    size.type = 'button'; size.className = `icon-button ${buttonClass}`.trim();
    size.onclick = () => el.classList.toggle(compact.cls);
  }
  const sizeIcon = () => {
    if (!size) return;
    const small = isCompact();
    size.replaceChildren(icon(small ? 'maximize' : 'restore'));
    size.title = small ? 'Make it large' : 'Make it small';
    size.setAttribute('aria-label', size.title);
    size.classList.add('icon-button', 'window-size');
  };
  close.before(away);
  if (size) away.after(size);
  sizeIcon();

  function putAway() {
    el.classList.add('in-tray');
    trayed.set(el, { label, restore: () => { el.classList.remove('in-tray'); trayed.delete(el); renderTray(); place(); } });
    renderTray();
  }

  stack.push(el);
  restack();
  el.addEventListener('pointerdown', () => raise(el), true);

  // Drag by the head (not its controls).
  head.addEventListener('pointerdown', down => {
    if (!enabled() || down.button !== 0 || !down.buttons || down.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
    const start = current(), x = down.clientX, y = down.clientY;
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('blur', up);
      apply(current(), true);
      el.classList.remove('dragging');
    };
    const move = e => {
      if (e.pointerId !== down.pointerId) return;
      if (!e.buttons) return up();
      apply({ ...start, left: start.left + e.clientX - x, top: start.top + e.clientY - y });
    };
    el.classList.add('dragging');
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up); addEventListener('blur', up);
    down.preventDefault();
  });
  head.classList.add('window-head');
  head.addEventListener('dblclick', e => {
    if (!enabled() || !visible() || e.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
    setLarge(!large);
  });

  // Anywhere on the window, as in a tiling window manager: Ctrl (⌘ on a Mac) + drag moves
  // it, Ctrl + right-button drag resizes it from the corner nearest the pointer. Text fields
  // keep their own clicks.
  el.addEventListener('pointerdown', down => {
    const mod = down.ctrlKey || down.metaKey, moving = mod && down.button === 0, sizing = mod && down.button === 2;
    if (!enabled() || down.altKey || !(moving || sizing) || !down.buttons || !visible()) return;
    if (down.target.closest('input, textarea, select, [contenteditable="true"], .panel-grip')) return;
    const start = moving ? current() : drawn(), a = area(), r = el.getBoundingClientRect();
    let edges = (down.clientX < r.left + r.width / 2 ? 'l' : 'r') + (down.clientY < r.top + r.height / 2 ? 't' : 'b');
    if (isCompact()) edges = edges.replace(/[tb]/, '');
    down.preventDefault();
    down.stopPropagation();
    el.setPointerCapture(down.pointerId);
    const cls = moving ? 'dragging' : 'resizing';
    el.classList.add(cls);
    const up = e => {
      if (e?.pointerId !== undefined && e.pointerId !== down.pointerId) return;
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.classList.remove(cls);
      apply(current(), true);
      // The click that ends the gesture does not press the button it started on.
      const swallow = c => { c.stopPropagation(); c.preventDefault(); };
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
    };
    const move = e => {
      if (e.pointerId !== down.pointerId) return;
      if (!e.buttons) return up(e);
      const dx = e.clientX - down.clientX, dy = e.clientY - down.clientY;
      apply(moving ? { ...start, left: start.left + dx, top: start.top + dy } : resizeRect(start, dx, dy, edges, min, a));
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }, true);

  // Ctrl + right button is a resize here, not a context menu.
  el.addEventListener('contextmenu', e => {
    if ((e.ctrlKey || e.metaKey) && !e.target.closest('input, textarea, select, [contenteditable="true"], .panel-grip')) e.preventDefault();
  }, true);

  // Resize from every edge and corner.
  for (const [name, edges] of Object.entries(EDGES)) {
    const grip = document.createElement('div');
    grip.className = `panel-grip grip-${name}`;
    grip.setAttribute('aria-hidden', 'true');
    el.append(grip);
    grip.onpointerdown = down => {
      if (!enabled() || !down.buttons || isCompact() && /[tb]/.test(edges)) return;
      down.preventDefault();
      grip.setPointerCapture(down.pointerId);
      const start = drawn(), a = area();
      const finish = () => { grip.onpointermove = grip.onpointerup = grip.onpointercancel = null; apply(current(), true); };
      grip.onpointermove = e => {
        if (e.pointerId !== down.pointerId) return;
        if (!e.buttons) return finish();
        apply(resizeRect(start, e.clientX - down.clientX, e.clientY - down.clientY, edges, min, a));
      };
      grip.onpointerup = grip.onpointercancel = finish;
    };
  }

  function restoreFromLarge() {
    large = false;
    el.classList.remove('window-large');
    const restore = saved() || beforeLarge;
    beforeLarge = null;
    if (restore) apply(restore);
    else {
      Object.assign(el.style, { left: '', top: '', width: '', height: '', right: '', bottom: '', margin: '' });
      el.classList.remove('screen-window');
    }
    return restore;
  }

  /** Expand/center the window inside the screen area without overwriting the saved small rect. */
  function setLarge(on = true) {
    const next = !!on;
    if (next === large) {
      if (next && visible()) {
        if (!el.classList.contains('screen-window')) el.classList.add('screen-window');
        apply(largeRect(area(), { min }), false);
        raise(el);
      }
      return;
    }
    if (next) {
      if (!beforeLarge) beforeLarge = saved() || (el.classList.contains('screen-window') && visible() ? current() : null);
      large = true;
      el.classList.add('window-large');
      if (compact && el.classList.contains(compact.cls)) {
        el.classList.remove(compact.cls);
        sizeIcon();
      }
      if (el.classList.contains('in-tray')) el.classList.remove('in-tray');
      if (trayed.delete(el)) renderTray();
      if (visible()) {
        if (!el.classList.contains('screen-window')) el.classList.add('screen-window');
        apply(largeRect(area(), { min }), false);
        raise(el);
      }
      return;
    }
    const restored = restoreFromLarge();
    if (visible() && !restored) place();
  }

  /** Ensure the floating window is visible and opened in large reading/workspace mode. */
  function openLarge() {
    if (el.tagName === 'DIALOG') {
      if (!el.open) el.showModal?.();
    } else if (el.hidden) {
      el.hidden = false;
    }
    setLarge(true);
  }

  function toggleLarge() {
    setLarge(!large);
    return large;
  }

  // Closing takes it out of the tray; showing it, or making it large again, puts it
  // back in place (only then: other class changes, like dragging, leave it alone).
  let wasShown = visible(), wasCompact = isCompact();
  new MutationObserver(() => {
    const closed = el.hidden || (el.tagName === 'DIALOG' && !el.open) || !enabled();
    if (closed && el.classList.contains('in-tray')) el.classList.remove('in-tray');
    if (closed && large) restoreFromLarge();
    // Closed, or brought back by the app itself: off the tray.
    if ((closed || !el.classList.contains('in-tray')) && trayed.delete(el)) renderTray();
    const shown = visible(), small = isCompact();
    if (shown && !wasShown) raise(el);
    if (shown && (!wasShown || (wasCompact && !small))) place();
    if (small !== wasCompact) sizeIcon();
    wasShown = shown; wasCompact = small;
  }).observe(el, { attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  addEventListener('resize', () => {
    if (!visible()) return;
    if (large) apply(largeRect(area(), { min }), false);
    else if (el.style.left) apply(current());
  });
  // Grow to show what would scroll inside (an AI answer being written), up to the area,
  // moving up when it would pass the bottom. Not remembered: the saved size stays.
  let fitting = 0;
  function fit() {
    cancelAnimationFrame(fitting);
    fitting = requestAnimationFrame(() => {
      if (!visible() || isCompact()) return;
      const scroll = [...el.querySelectorAll('*')].filter(n => n.clientHeight && /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1);
      const extra = scroll.filter(n => !scroll.some(m => m !== n && n.contains(m))).reduce((s, n) => s + n.scrollHeight - n.clientHeight, 0);
      const r = current(), a = area();
      if (extra) apply({ ...r, height: r.height + extra });
      else if (r.top + r.height > a.height + 1) apply(r);
    });
  }
  place();
  const api = { place, putAway, fit, setLarge, openLarge, toggleLarge, get large() { return large; } };
  windows.set(el, api);
  return api;
}
