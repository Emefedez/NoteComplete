// Floating windows (Ask AI, audio, quiz, flashcard practice): drag them by their
// head, resize them from any edge or corner, and they stay inside their area so
// the head and its × are always reachable. The head gets _ (put away in the
// window tray at the bottom left, from which it comes back) and □ (small or
// large) next to ×. Place and size are remembered per window.
// Stroke icons (24×24, currentColor), the same set as layout.html.
const PATHS = { minimize: 'M6 17h12', maximize: 'M6 6h12v12H6Z', restore: 'M9 9h9v9H9ZM6 15V6h9' };
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS(svg.namespaceURI, 'path');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) svg.setAttribute(k, v);
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}

const $ = id => document.getElementById(id);
const EDGES = { left: 'l', right: 'r', top: 't', bottom: 'b', 'bottom-left': 'bl', 'bottom-right': 'br', 'top-left': 'tl', 'top-right': 'tr' };

// Keep a rect inside the area: no wider or taller than it, and fully on it.
export function clampRect({ left, top, width, height }, area, min = { width: 0, height: 0 }) {
  width = Math.max(Math.min(min.width, area.width), Math.min(width, area.width));
  height = Math.max(Math.min(min.height, area.height), Math.min(height, area.height));
  left = Math.max(0, Math.min(area.width - width, left));
  top = Math.max(0, Math.min(area.height - height, top));
  return { left, top, width, height };
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

export function floatingWindow(el, { key, head, close, label, compact = null, enabled = () => true, minWidth = 280, minHeight = 200, scroll = false, buttonClass = '' }) {
  const fixed = () => getComputedStyle(el).position === 'fixed';
  const area = () => {
    if (fixed()) return { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const r = (el.offsetParent || document.body).getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  const min = { width: minWidth, height: minHeight };
  const isCompact = () => !!compact && el.classList.contains(compact.cls);
  // The window's rect relative to its area, as placed now.
  function current() {
    const r = el.getBoundingClientRect(), a = area();
    return { left: r.left - a.left, top: r.top - a.top, width: r.width, height: r.height };
  }
  function apply(rect, save = false) {
    const a = area(), c = clampRect(rect, a, isCompact() ? { width: min.width, height: 0 } : min);
    Object.assign(el.style, { left: `${c.left}px`, top: `${c.top}px`, width: `${c.width}px`, right: 'auto', bottom: 'auto', margin: '0' });
    if (!isCompact()) el.style.height = `${c.height}px`;
    if (save) {
      const keep = { left: c.left, top: c.top, width: c.width, height: isCompact() ? saved()?.height ?? c.height : c.height };
      try { localStorage.setItem(key, JSON.stringify(keep)); } catch { /* Optional. */ }
    }
  }
  const saved = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const visible = () => enabled() && !el.hidden && (el.tagName !== 'DIALOG' || el.open) && !el.classList.contains('in-tray');
  // Put back where it was left, inside the current area.
  function place() {
    if (!visible()) return;
    const s = saved();
    if (s) apply(s);
    else if (el.style.left) apply(current());
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

  // Drag by the head (not its controls).
  head.addEventListener('pointerdown', down => {
    if (!enabled() || down.button !== 0 || down.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
    const start = current(), x = down.clientX, y = down.clientY;
    const move = e => apply({ ...start, left: start.left + e.clientX - x, top: start.top + e.clientY - y });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); apply(current(), true); el.classList.remove('dragging'); };
    el.classList.add('dragging');
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    down.preventDefault();
  });
  head.classList.add('window-head');

  // Resize from every edge and corner.
  for (const [name, edges] of Object.entries(EDGES)) {
    const grip = document.createElement('div');
    grip.className = `panel-grip grip-${name}`;
    grip.setAttribute('aria-hidden', 'true');
    el.append(grip);
    grip.onpointerdown = down => {
      if (!enabled() || isCompact() && /[tb]/.test(edges)) return;
      down.preventDefault();
      grip.setPointerCapture(down.pointerId);
      const start = current(), a = area();
      grip.onpointermove = e => apply(resizeRect(start, e.clientX - down.clientX, e.clientY - down.clientY, edges, min, a));
      grip.onpointerup = () => { grip.onpointermove = grip.onpointerup = null; apply(current(), true); };
    };
  }

  // Closing takes it out of the tray; showing it, or making it large again, puts it
  // back in place (only then: other class changes, like dragging, leave it alone).
  let wasShown = visible(), wasCompact = isCompact();
  new MutationObserver(() => {
    const closed = el.hidden || (el.tagName === 'DIALOG' && !el.open) || !enabled();
    if (closed) {
      if (trayed.delete(el)) renderTray();
      if (el.classList.contains('in-tray')) el.classList.remove('in-tray');
    }
    const shown = visible(), small = isCompact();
    if (shown && (!wasShown || (wasCompact && !small))) place();
    if (small !== wasCompact) sizeIcon();
    wasShown = shown; wasCompact = small;
  }).observe(el, { attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  addEventListener('resize', () => { if (visible() && el.style.left) apply(current()); });
  place();
  return { place, putAway };
}
