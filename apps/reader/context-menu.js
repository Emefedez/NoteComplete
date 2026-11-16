// A menu at the pointer, as on a computer: right-click on the page, a long press of a finger,
// or the ⋯ circle of a selection. Entries: { label, icon, run, danger?, disabled?, key? }, or
// "-" for a divider. `host`: where it goes (a modal dialog it opens over). It closes on a choice, Escape, a press elsewhere, scrolling or resizing.
import { icon } from './icons.js';

let open = null;

export function closeContextMenu() {
  if (!open) return;
  const { el, cleanup } = open;
  open = null;
  cleanup();
  el.remove();
}

export function contextMenuOpen() {
  return !!open;
}

export function openContextMenu(x, y, entries, { title = '', host = null } = {}) {
  closeContextMenu();
  const list = entries.filter(Boolean);
  if (!list.some((e) => e !== '-')) return null;
  const el = document.createElement('div');
  el.className = 'context-menu';
  el.setAttribute('role', 'menu');
  if (title) {
    const head = document.createElement('div');
    head.className = 'context-menu-title';
    head.textContent = title;
    el.append(head);
  }
  list.forEach((entry, i) => {
    if (entry === '-') {
      if (i && list[i - 1] !== '-' && i < list.length - 1) el.append(document.createElement('hr'));
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (entry.danger) b.classList.add('danger');
    b.disabled = !!entry.disabled;
    b.append(icon(entry.icon || 'note'), Object.assign(document.createElement('span'), { textContent: entry.label }));
    if (entry.key) b.append(Object.assign(document.createElement('kbd'), { textContent: entry.key }));
    b.onclick = (event) => {
      event.stopPropagation();
      closeContextMenu();
      entry.run?.();
    };
    el.append(b);
  });
  // Presses inside stay inside (no drawing or panning under the menu).
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  // Inside an open modal dialog when asked (the rest of the page is inert under one).
  (host || document.body).append(el);
  // Inside the window: flipped to the left or up when it would run past an edge.
  const r = el.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, m = 8;
  const left = x + r.width + m > vw ? Math.max(m, x - r.width) : x;
  const top = y + r.height + m > vh ? Math.max(m, y - r.height) : y;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  const away = (e) => { if (!el.contains(e.target)) closeContextMenu(); };
  const keys = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeContextMenu(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...el.querySelectorAll('button:not(:disabled)')];
    const at = items.indexOf(document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const gone = () => closeContextMenu();
  // A tick later, so the press or release that opened it does not close it.
  const timer = setTimeout(() => {
    document.addEventListener('pointerdown', away, true);
    addEventListener('wheel', gone, { passive: true });
  }, 0);
  document.addEventListener('keydown', keys, true);
  addEventListener('resize', gone);
  addEventListener('blur', gone);
  open = {
    el,
    cleanup: () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', keys, true);
      removeEventListener('wheel', gone);
      removeEventListener('resize', gone);
      removeEventListener('blur', gone);
    },
  };
  el.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  return el;
}
