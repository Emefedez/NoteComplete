// The kit's movable window (docs/PREFAB-MODULES.md, "window" modules): an editor over the page
// that is not modal, so the page stays in sight and scrolls behind it. Dragged by its title bar,
// resized from every edge and corner (mouse, finger or pen), free on the whole screen (over the
// top bar too), pushed against an edge it gets smaller from that edge, as floating.js windows
// do (a strip always stays to grab it back); its place and size remembered by `key`. Esc or ×
// closes it (`onClose`), Ctrl Enter applies (`onApply`); keys typed in it stay in it, so the
// page's tool shortcuts do not fire behind it.
import { clampRect, shownRect, resizeRect, largeRect, overBar, trayPut, trayDrop } from '../../floating.js';
import { icon } from '../../icons.js';
import { loadKitStyles, make } from './shell.js';

const STORE = 'pk-window:';
// A phone (narrow, or a short landscape screen): windows fill the screen under the tab strip
// (a big editor) or sit at the bottom as a sheet (Chinese mode's small panels, zh-window.js).
export const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 600px), (max-height: 500px) and (orientation: landscape)').matches;
// How much of a window stays on the screen when it is pushed out (floating.js uses the same).
const GRAB = 56;
const modalTop = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-top')) || 0;

// Where a window may be: the whole browser window (it may cover the top bar when moved there).
export function windowArea() {
  return { left: 0, top: 0, width: Math.max(0, innerWidth), height: Math.max(0, innerHeight) };
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
// `phone`: on a phone, 'full' fills the screen under the tab strip (not moved or resized);
// anything else leaves it to the caller's CSS (Chinese mode's bottom sheets).
// Returns { el, head, body, foot, setTitle(text), rect(), destroy() }: fill `body` and `foot`.
export function movableWindow({ key = 'module', title = '', width = 560, height = null, minWidth = 300, minHeight = 180, className = '', onClose = null, onApply = null, phone = 'full' } = {}) {
  loadKitStyles();
  const min = { width: minWidth, height: minHeight };
  const titleEl = make('strong', { className: 'pk-window-title', textContent: title });
  const away = make('button', { type: 'button', className: 'pk-window-btn', title: 'Put away (bring it back from the tray at the bottom left)' }, icon('minimize'));
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
  const full = () => phone === 'full' && isPhone();
  el.classList.toggle('pk-phone', full());
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
  let large = false, beforeLarge = null;
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
      const big = largeRect(area, { min });
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
  // _ puts it in the app's one tray (floating.js), with the other windows put away.
  away.onclick = () => {
    el.classList.add('in-tray');
    trayPut(el, titleEl.textContent || 'Editor', () => { el.classList.remove('in-tray'); apply(rect); });
  };
  // `rect`: where it is (screen pixels), whole even while pushed over an edge; what is drawn is
  // the part on the screen (smaller), so the content keeps the most room it can.
  let pushed = false;
  const apply = (r, store = false) => {
    const area = windowArea();
    el.classList.toggle('pk-phone', full());
    if (full()) {
      // The whole screen under the tab strip; its desktop place stays remembered.
      const top = modalTop();
      Object.assign(el.style, { left: '0px', top: `${top}px`, width: '100%', height: `${innerHeight - top}px`, maxHeight: '', zIndex: '35' });
      return;
    }
    // An auto height follows the content (measured while not squashed), up to the screen.
    const natural = pushed && rect.naturalHeight ? rect.naturalHeight : el.offsetHeight;
    const h = fixedHeight ?? Math.min(natural || r.height || minHeight, area.height);
    const c = clampRect({ left: r.left - area.left, top: r.top - area.top, width: r.width, height: h }, area, min, GRAB);
    const v = shownRect(c, area);
    pushed = v.left !== c.left || v.top !== c.top || v.width !== c.width || v.height !== c.height;
    rect = { left: Math.round(c.left + area.left), top: Math.round(c.top + area.top), width: Math.round(c.width), height: fixedHeight == null ? null : Math.round(c.height), ...(fixedHeight == null && pushed ? { naturalHeight: Math.round(c.height) } : {}) };
    el.classList.toggle('pushed', pushed);
    const over = overBar(v.top + area.top);
    el.classList.toggle('over-bar', over);
    Object.assign(el.style, {
      left: `${Math.round(v.left + area.left)}px`, top: `${Math.round(v.top + area.top)}px`, width: `${Math.round(v.width)}px`,
      height: fixedHeight == null && !pushed ? '' : `${Math.round(v.height)}px`, maxHeight: `${area.height}px`,
      zIndex: over ? '41' : '35',
    });
    el.classList.toggle('sized', fixedHeight != null);
    if (store) { const { naturalHeight, ...keep } = rect; remember(key, keep); }
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
  const drag = (e, mode, anyButton = false) => {
    if (el.classList.contains('pk-phone')) return;
    if (!anyButton && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const target = e.currentTarget, id = e.pointerId;
    try { target.setPointerCapture(id); } catch { /* Synthetic pointer. */ }
    // Moving starts from where it is (whole, even while pushed); resizing from what is drawn.
    const box = el.getBoundingClientRect();
    const start = mode === 'move'
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height ?? rect.naturalHeight ?? box.height }
      : { left: box.left, top: box.top, width: box.width, height: box.height };
    const x0 = e.clientX, y0 = e.clientY;
    el.classList.add(mode === 'move' ? 'moving' : 'sizing');
    const move = (m) => {
      if (m.pointerId !== id) return;
      const dx = m.clientX - x0, dy = m.clientY - y0;
      if (mode === 'move') apply({ ...start, left: start.left + dx, top: start.top + dy });
      else {
        const vertical = /[tb]/.test(mode);
        if (vertical) fixedHeight = start.height;
        const area = windowArea();
        const r = resizeRect({ ...start, left: start.left - area.left, top: start.top - area.top }, dx, dy, mode, min, area);
        if (vertical) fixedHeight = r.height;
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
      if (anyButton) {
        // The click that ends a Ctrl + drag does not press the button it started on.
        const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
        el.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  head.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) drag(e, 'move'); });
  for (const g of grips) g.addEventListener('pointerdown', (e) => drag(e, g.dataset.edges));
  // Ctrl/⌘+drag anywhere moves; Ctrl/⌘+right-drag resizes from the nearest corner.
  el.addEventListener('pointerdown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    e.stopPropagation();
    if (e.button === 0) return drag(e, 'move', true);
    if (e.button === 2) {
      const box = el.getBoundingClientRect();
      const edges = (e.clientX < box.left + box.width / 2 ? 'l' : 'r') + (e.clientY < box.top + box.height / 2 ? 't' : 'b');
      return drag(e, edges, true);
    }
  }, true);
  // Ctrl + right button is a resize here, not a context menu.
  el.addEventListener('contextmenu', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.target.closest('input, select, textarea, [contenteditable="true"]')) e.preventDefault();
  }, true);
  // Double-click on the title bar: toggle large / normal size.
  head.addEventListener('dblclick', (e) => {
    if (e.target.closest('button') || el.classList.contains('pk-phone')) return;
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
    setTitle(text) { titleEl.textContent = text; el.setAttribute('aria-label', text); },
    rect: () => ({ ...rect }),
    destroy() { trayDrop(el); grown?.disconnect(); removeEventListener('resize', resized); el.remove(); },
  };
}
