// Quick menu: a ring of tools around the pen or pointer, and around it the settings of the
// chosen tool (colours, widths, modes) with undo and redo. It opens with a key (hold it,
// point at an item and let go; or tap it and click), a pen's side button (S Pen, Wacom
// barrel button), or two fingers held still on the page. Esc, a click outside or the
// centre closes it. Holding a tool lifts it: drag it to another place on the ring.

// Centres of `count` items on a circle of `radius`, the first at the top, clockwise.
export function ring(count, radius, start = -Math.PI / 2) {
  return Array.from({ length: count }, (_, i) => {
    const angle = start + (i * 2 * Math.PI) / count;
    return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
  });
}

// The centre moved in so the whole ring (out to `reach`) stays inside the view.
export function fitCentre(x, y, reach, { width, height }, margin = 8) {
  const clamp = (v, size) => (size < 2 * (reach + margin) ? size / 2 : Math.min(size - reach - margin, Math.max(reach + margin, v)));
  return { x: clamp(x, width), y: clamp(y, height) };
}

// The slot (0…count-1) on a ring nearest to a point (dx, dy) from its centre.
export function slotAt(dx, dy, count, start = -Math.PI / 2) {
  const turn = (Math.atan2(dy, dx) - start + 4 * Math.PI) % (2 * Math.PI);
  return Math.round(turn / ((2 * Math.PI) / count)) % count;
}

// `list` with the item at `from` moved to `to`.
export function moved(list, from, to) {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

const INNER = 50, OUTER = 94, SIZE = 36, GAP = 6, HOLD_MS = 260, SLOP = 8;
// The outer ring grows when it holds many settings, so its items never touch.
export const outerRadius = (count) => Math.max(OUTER, Math.ceil((count * (SIZE + GAP)) / (2 * Math.PI)));

// `inner()` and `outer()` return [{ key?, label, icon (Node), swatch?, active?(), run(),
// stay?() }]; they are asked again after each choice, so the outer ring follows the tool.
// A choice whose stay() is true keeps the menu open (a setting, or a tool that has some).
export function quickMenu({ inner, outer, onReorder = () => {}, onOpen = () => {}, onClose = () => {} }) {
  let root = null, hovered = null, centre = null, lift = null;
  const list = (source) => (typeof source === 'function' ? source() : source);
  function draw() {
    const { x, y } = centre;
    root.replaceChildren();
    const tools = list(inner), settings = list(outer);
    // Only as large as it needs: the outer ring appears when there are settings to show.
    const outerR = outerRadius(settings.length);
    const radius = (settings.length ? outerR : INNER) + SIZE / 2 + 6;
    const disc = document.createElement('div');
    disc.className = `qm-disc${settings.length ? ' qm-full' : ''}`;
    Object.assign(disc.style, { left: `${x}px`, top: `${y}px`, width: `${radius * 2}px`, height: `${radius * 2}px`, margin: `${-radius}px 0 0 ${-radius}px` });
    root.append(disc);
    const place = (entries, radius, name) => ring(entries.length, radius).forEach((at, i) => {
      const entry = entries[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `qm-item qm-${name}${entry.swatch ? ' qm-swatch' : ''}`;
      b.title = entry.label;
      b.setAttribute('aria-label', entry.label);
      b.setAttribute('role', 'menuitem');
      if (entry.swatch) b.style.setProperty('--swatch', entry.swatch);
      else if (entry.icon) b.append(entry.icon.cloneNode(true));
      if (entry.active?.()) b.setAttribute('aria-pressed', 'true');
      if (name === 'inner') b.dataset.key = String(i + 1);
      b.style.left = `${x + at.x - SIZE / 2}px`;
      b.style.top = `${y + at.y - SIZE / 2}px`;
      b.onpointerenter = () => { hovered = entry; };
      b.onpointerleave = () => { if (hovered === entry) hovered = null; };
      b.onclick = (e) => { e.stopPropagation(); if (b.dataset.lifted) return; pick(entry); };
      if (name === 'inner') b.addEventListener('pointerdown', (e) => holdToMove(e, b, i, tools));
      root.append(b);
    });
    place(tools, INNER, 'inner');
    place(settings, outerR, 'outer');
    const close_ = document.createElement('button');
    close_.type = 'button';
    close_.className = 'qm-item qm-centre';
    close_.title = 'Close (Esc)';
    close_.setAttribute('aria-label', 'Close the quick menu');
    close_.textContent = '×';
    close_.style.left = `${x - SIZE / 2}px`;
    close_.style.top = `${y - SIZE / 2}px`;
    close_.onclick = (e) => { e.stopPropagation(); close(); };
    root.append(close_);
  }
  // Holding a tool lifts it; it follows the pointer and drops into the nearest place.
  function holdToMove(down, button, index, tools) {
    if (down.button !== 0) return;
    const start = [down.clientX, down.clientY];
    const timer = setTimeout(() => {
      lift = { button, index };
      button.dataset.lifted = '1';
      button.classList.add('qm-lifted');
      navigator.vibrate?.(8);
    }, HOLD_MS);
    const move = (e) => {
      if (!lift) { if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > SLOP) clearTimeout(timer); return; }
      e.preventDefault();
      button.style.left = `${e.clientX - SIZE / 2}px`;
      button.style.top = `${e.clientY - SIZE / 2}px`;
    };
    const up = (e) => {
      clearTimeout(timer);
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', up, true);
      removeEventListener('pointercancel', up, true);
      if (!lift) return;
      const to = slotAt(e.clientX - centre.x, e.clientY - centre.y, tools.length);
      lift = null;
      // The click that ends the hold does not also choose the tool.
      setTimeout(() => { delete button.dataset.lifted; }, 0);
      if (to !== index) onReorder(moved(tools, index, to).map((t) => t.key));
      if (root) draw();
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
  }
  function open(x, y) {
    close();
    centre = fitCentre(x, y, outerRadius(16) + SIZE / 2, { width: innerWidth, height: innerHeight });
    hovered = null;
    root = document.createElement('div');
    // Only opening animates; a redraw after a choice does not flash.
    root.className = 'quick-menu qm-opening';
    setTimeout(() => root?.classList.remove('qm-opening'), 90);
    root.setAttribute('role', 'menu');
    root.setAttribute('aria-label', 'Quick menu');
    // Anywhere else closes it, without drawing or choosing what is underneath.
    root.addEventListener('pointerdown', (e) => { if (e.target === root || e.target.classList.contains('qm-disc')) { e.preventDefault(); e.stopPropagation(); close(); } });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('touchmove', (e) => { if (lift) e.preventDefault(); }, { passive: false });
    draw();
    document.body.append(root);
    onOpen();
    root.querySelector('.qm-inner')?.focus({ preventScroll: true });
  }
  function close() {
    if (!root) return;
    root.remove();
    root = null;
    hovered = null;
    lift = null;
    onClose();
  }
  function pick(entry, closing = false) {
    entry?.run();
    if (!root) return;
    if (closing || !entry?.stay?.()) close();
    else { hovered = null; draw(); }
  }
  return {
    open,
    close,
    get isOpen() { return !!root; },
    // Letting go of the key over an item chooses it and closes the menu; elsewhere the
    // menu stays open to click. Returns whether one was chosen.
    release() { if (!root || !hovered) return false; pick(hovered, true); return true; },
    // Keys while open: Esc closes, 1–8 choose an inner item.
    key(e) {
      if (!root) return false;
      if (e.key === 'Escape') { close(); return true; }
      const tools = list(inner);
      if (/^[1-9]$/.test(e.key) && tools[Number(e.key) - 1]) { pick(tools[Number(e.key) - 1]); return true; }
      return false;
    },
  };
}
