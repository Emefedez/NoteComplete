// The kit's movable window (docs/PREFAB-MODULES.md, "window" modules): an editor over the page
// that is not modal, so the page stays in sight and scrolls behind it. Dragged by its title bar,
// resized from its right and bottom edges or its corner (mouse, finger or pen), always kept
// inside the window under the tab strip, and its place and size remembered by `key`. Esc or ×
// closes it (`onClose`), Ctrl Enter applies (`onApply`); keys typed in it stay in it, so the
// page's tool shortcuts do not fire behind it.
import { clampRect, resizeRect, largeRect } from '../../floating.js';
import { icon } from '../../icons.js';
import { loadKitStyles, make } from './shell.js';

const STORE = 'pk-window:';
const MARGIN = 8;

// Where a window may be: the browser window under the tab strip (--modal-top), less a margin.
export function windowArea() {
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-top')) || 0;
  return { left: MARGIN, top: top + MARGIN, width: Math.max(0, innerWidth - 2 * MARGIN), height: Math.max(0, innerHeight - top - 2 * MARGIN) };
}
// A rect ({ left, top, width, height }, page pixels) kept whole inside `area` and no smaller
// than `min`: what a drag, a resize or a smaller browser window leaves.
export function keepInside(rect, area, min = { width: 0, height: 0 }) {
  const r = clampRect({ left: rect.left - area.left, top: rect.top - area.top, width: rect.width, height: rect.height }, area, min);
  return { left: Math.round(r.left + area.left), top: Math.round(r.top + area.top), width: Math.round(r.width), height: Math.round(r.height) };
}
const remembered = (key) => {
  try { const r = JSON.parse(localStorage.getItem(STORE + key) || 'null'); return r && ['left', 'top', 'width'].every((k) => Number.isFinite(r[k])) ? r : null; } catch { return null; }
};
const remember = (key, rect) => { try { localStorage.setItem(STORE + key, JSON.stringify(rect)); } catch { /* Not kept: it opens at its default place next time. */ } };

// `key`: names the remembered place. `title`. `width`/`height`: the first size (height null:
// as tall as its content, up to the window). `className`: extra classes on the window.
// Returns { el, head, body, foot, setTitle(text), rect(), destroy() }: fill `body` and `foot`.
export function movableWindow({ key = 'module', title = '', width = 560, height = null, minWidth = 300, minHeight = 180, className = '', onClose = null, onApply = null } = {}) {
  loadKitStyles();
  const min = { width: minWidth, height: minHeight };
  const titleEl = make('strong', { className: 'pk-window-title', textContent: title });
  const away = make('button', { type: 'button', className: 'pk-window-btn', title: 'Put away (bring back from bottom left)' }, icon('minimize'));
  away.setAttribute('aria-label', `Put ${title || 'window'} away`);
  const sizeBtn = make('button', { type: 'button', className: 'pk-window-btn', title: 'Make it large' }, icon('maximize'));
  sizeBtn.setAttribute('aria-label', 'Make it large');
  const close = make('button', { type: 'button', className: 'pk-window-close', title: 'Close without changes (Esc)' }, icon('close'));
  close.setAttribute('aria-label', 'Close');
  const head = make('div', { className: 'pk-window-head' }, titleEl, away, sizeBtn, close);
  const body = make('div', { className: 'pk-window-body' });
  const foot = make('div', { className: 'pk-window-foot' });
  const grips = ['l', 'r', 't', 'b', 'lt', 'rt', 'lb', 'rb'].map((edges) => { const g = make('div', { className: `pk-window-grip pk-grip-${edges}` }); g.dataset.edges = edges; return g; });
  const el = make('section', { className: `pk-window ${className}`.trim() }, head, body, foot, ...grips);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-label', title);
  // Placed before its stylesheet arrives, so it never shows for a moment at the page's foot.
  Object.assign(el.style, { position: 'fixed', zIndex: '35', boxSizing: 'border-box' });

  // First time: on the right, under the app's bars (its #viewport, when there is one), so the
  // middle of the page stays in sight.
  const firstRect = () => {
    const area = windowArea();
    const pages = document.getElementById('viewport')?.getBoundingClientRect();
    const top = pages && pages.height > 200 ? Math.max(area.top, pages.top + 12) : area.top + 40;
    return { left: area.left + area.width - Math.min(width, area.width) - 16, top, width, height };
  };
  const saved = remembered(key);
  let rect = saved || firstRect();
  let fixedHeight = saved ? saved.height ?? null : height;
  let large = false, beforeLarge = null, trayPill = null;
  const syncSizeIcon = () => {
    sizeBtn.replaceChildren(icon(large ? 'restore' : 'maximize'));
    const label = large ? 'Restore size' : 'Make it large';
    sizeBtn.title = label;
    sizeBtn.setAttribute('aria-label', label);
  };
  const setLarge = (next) => {
    large = Boolean(next);
    if (large) {
      beforeLarge = { rect: { ...rect }, fixedHeight };
      const area = windowArea();
      const big = largeRect(area, { ratio: 0.88, maxWidth: 1080, maxHeight: 860, min });
      fixedHeight = big.height;
      apply({ left: big.left + area.left, top: big.top + area.top, width: big.width, height: big.height });
    } else if (beforeLarge) {
      fixedHeight = beforeLarge.fixedHeight;
      apply(beforeLarge.rect, true);
      beforeLarge = null;
    }
    syncSizeIcon();
  };
  sizeBtn.onclick = () => setLarge(!large);
  const restoreFromTray = () => {
    el.classList.remove('in-tray');
    trayPill?.remove();
    trayPill = null;
    apply(rect);
  };
  away.onclick = () => {
    el.classList.add('in-tray');
    if (!trayPill) {
      trayPill = make('button', { type: 'button', className: 'pk-window-tray-pill', textContent: titleEl.textContent || 'Editor' });
      trayPill.title = 'Restore editor window';
      trayPill.onclick = restoreFromTray;
      document.body.append(trayPill);
    }
  };
  const apply = (r, store = false) => {
    const area = windowArea();
    const h = fixedHeight ?? Math.min(el.offsetHeight || r.height || minHeight, area.height);
    const k = keepInside({ ...r, height: h }, area, min);
    rect = { left: k.left, top: k.top, width: k.width, height: fixedHeight == null ? null : k.height };
    Object.assign(el.style, { left: `${k.left}px`, top: `${k.top}px`, width: `${k.width}px`, height: fixedHeight == null ? '' : `${k.height}px`, maxHeight: `${area.height}px` });
    if (store) remember(key, rect);
  };
  document.body.append(el);
  apply(rect);
  // As its content comes in or changes (an auto height grows): kept inside again.
  let settling = false;
  const grown = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (settling || !el.isConnected || el.classList.contains('sizing')) return;
    settling = true;
    apply(rect);
    requestAnimationFrame(() => { settling = false; });
  }) : null;
  grown?.observe(el);
  requestAnimationFrame(() => el.isConnected && apply(rect));

  // Drag by the title bar; resize by the grips. Pointer events: mouse, finger and pen alike.
  const drag = (e, mode) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const target = e.currentTarget, id = e.pointerId;
    try { target.setPointerCapture(id); } catch { /* Synthetic pointer. */ }
    const box = el.getBoundingClientRect();
    const start = { left: box.left, top: box.top, width: box.width, height: box.height }, x0 = e.clientX, y0 = e.clientY;
    el.classList.add(mode === 'move' ? 'moving' : 'sizing');
    const move = (m) => {
      if (m.pointerId !== id) return;
      const dx = m.clientX - x0, dy = m.clientY - y0;
      if (mode === 'move') apply({ ...start, left: start.left + dx, top: start.top + dy });
      else {
        if (mode.includes('b')) fixedHeight = start.height;
        const area = windowArea();
        const r = resizeRect({ ...start, left: start.left - area.left, top: start.top - area.top }, dx, dy, mode, min, area);
        if (mode.includes('b')) fixedHeight = r.height;
        apply({ ...r, left: r.left + area.left, top: r.top + area.top });
      }
    };
    const up = (u) => {
      if (u.pointerId !== id) return;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      el.classList.remove('moving', 'sizing');
      apply(rect, true);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  head.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) drag(e, 'move'); });
  for (const g of grips) g.addEventListener('pointerdown', (e) => drag(e, g.dataset.edges));
  // Ctrl/⌘+drag anywhere moves; Ctrl/⌘+right-drag resizes from the nearest corner.
  el.addEventListener('pointerdown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
    if (e.button === 0) return drag(e, 'move');
    if (e.button === 2) {
      const box = el.getBoundingClientRect();
      const edges = (e.clientX < box.left + box.width / 2 ? 'l' : 'r') + (e.clientY < box.top + box.height / 2 ? 't' : 'b');
      return drag(e, edges);
    }
  }, true);
  // Double-click on the title bar: toggle large / normal size.
  head.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    setLarge(!large);
  });
  close.onclick = () => onClose?.();
  const keys = (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose?.(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && onApply) { e.preventDefault(); onApply(); }
    e.stopPropagation();
  };
  el.addEventListener('keydown', keys);
  const resized = () => apply(rect);
  addEventListener('resize', resized);
  return {
    el, head, body, foot,
    setTitle(text) { titleEl.textContent = text; el.setAttribute('aria-label', text); if (trayPill) trayPill.textContent = text; },
    rect: () => ({ ...rect }),
    destroy() { trayPill?.remove(); trayPill = null; grown?.disconnect(); removeEventListener('resize', resized); el.remove(); },
  };
}
