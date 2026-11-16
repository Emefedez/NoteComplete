// A menu at the pointer, as on a computer: right-click on the page, a long press of a finger,
// or the ⋯ circle of a selection. Entries: { label, icon, run, danger?, disabled?, key?,
// submenu? }, or "-" for a divider. `submenu` (entries, or a function that returns them)
// slides out to the side when the pointer rests on the entry or the right arrow is pressed
// (`swatch`: a colour shown in place of the icon; `iconEl`: an svg to show, copied; `checked`: marks the current choice);
// a click runs the entry's own `run`, or opens the submenu when it has none. `host`: where it
// goes (a modal dialog it opens over). It closes on a choice, Escape, a press elsewhere,
// scrolling or resizing.
import { icon } from './icons.js';

let open = null;

export function closeContextMenu() {
  if (!open) return;
  const { el, cleanup } = open;
  open = null;
  cleanup();
  for (const sub of el.__subs || []) sub.remove();
  el.remove();
}

export function contextMenuOpen() {
  return !!open;
}

// One menu panel (the menu itself, or a submenu of it).
function panel(list, title, root, depth) {
  const el = document.createElement('div');
  el.className = depth ? 'context-menu context-submenu' : 'context-menu';
  el.setAttribute('role', 'menu');
  if (title) {
    const head = document.createElement('div');
    head.className = 'context-menu-title';
    head.textContent = title;
    el.append(head);
  }
  let timer = 0;
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
    // `swatch`: a colour dot in place of the icon; `checked`: the current choice.
    const lead = entry.swatch ? Object.assign(document.createElement('i'), { className: 'context-swatch' })
      : entry.iconEl ? entry.iconEl.cloneNode(true) : icon(entry.icon || 'note');
    if (entry.iconEl) lead.classList.add('context-glyph');
    if (entry.swatch) lead.style.background = entry.swatch;
    if (entry.checked) { b.classList.add('checked'); b.setAttribute('aria-checked', 'true'); }
    b.append(lead, Object.assign(document.createElement('span'), { textContent: entry.label }));
    if (entry.key) b.append(Object.assign(document.createElement('kbd'), { textContent: entry.key }));
    const sub = entry.submenu;
    if (sub) {
      b.classList.add('has-submenu');
      b.setAttribute('aria-haspopup', 'menu');
      const chev = icon('arrowRight');
      chev.classList.add('context-chevron');
      b.append(chev);
    }
    const showSub = () => {
      const items = (typeof sub === 'function' ? sub() : sub || []).filter(Boolean);
      openSub(root, el, b, items, entry.subtitle || '', depth + 1);
    };
    b.onclick = (event) => {
      event.stopPropagation();
      if (sub && !entry.run) { showSub(); return; }
      closeContextMenu();
      entry.run?.();
    };
    // Resting on an entry: its submenu slides out, or the one open goes.
    b.addEventListener('pointerenter', () => {
      clearTimeout(timer);
      timer = setTimeout(() => (sub ? showSub() : closeSubs(root, depth + 1)), sub ? 180 : 250);
    });
    b.addEventListener('pointerleave', () => clearTimeout(timer));
    b.addEventListener('keydown', (e) => {
      if (sub && e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); showSub(); root.__subs?.at(-1)?.querySelector('button:not(:disabled)')?.focus(); }
      else if (depth && e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); const owner = el.__owner; closeSubs(root, depth); owner?.focus(); }
    });
    el.append(b);
  });
  // Presses inside stay inside (no drawing or panning under the menu).
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  return el;
}

// Inside the window: flipped to the left or up when it would run past an edge.
function place(el, x, y, flipX = null) {
  const r = el.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, m = 8;
  const left = x + r.width + m > vw ? Math.max(m, (flipX ?? x) - r.width) : x;
  const top = y + r.height + m > vh ? Math.max(m, vh - r.height - m) : y;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function closeSubs(root, depth) {
  const subs = root.__subs || [];
  while (subs.length >= depth) { const s = subs.pop(); s.__owner?.setAttribute('aria-expanded', 'false'); s.remove(); }
}

function openSub(root, parent, button, items, title, depth) {
  if (root.__subs?.[depth - 1]?.__owner === button) return;
  closeSubs(root, depth);
  if (!items.some((e) => e !== '-')) return;
  const el = panel(items, title, root, depth);
  el.__owner = button;
  button.setAttribute('aria-expanded', 'true');
  (root.__host || document.body).append(el);
  const r = button.getBoundingClientRect();
  place(el, r.right - 2, r.top - 5, r.left + 2);
  (root.__subs ||= []).push(el);
}

export function openContextMenu(x, y, entries, { title = '', host = null } = {}) {
  closeContextMenu();
  const list = entries.filter(Boolean);
  if (!list.some((e) => e !== '-')) return null;
  // `state`: the host and the submenus open (deepest last), shared by every panel.
  const state = { __host: host || document.body, __subs: [] };
  const el = panel(list, title, state, 0);
  el.__subs = state.__subs;
  // Inside an open modal dialog when asked (the rest of the page is inert under one).
  state.__host.append(el);
  place(el, x, y);
  const inside = (t) => el.contains(t) || el.__subs.some((s) => s.contains(t));
  const away = (e) => { if (!inside(e.target)) closeContextMenu(); };
  const keys = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (state.__subs.length) { const owner = state.__subs.at(-1).__owner; closeSubs(state, state.__subs.length); owner?.focus(); return; }
      closeContextMenu();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const box = [el, ...el.__subs].find((m) => m.contains(document.activeElement)) || el;
    const items = [...box.querySelectorAll(':scope > button:not(:disabled)')];
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
