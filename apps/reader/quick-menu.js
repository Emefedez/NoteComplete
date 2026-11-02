// Quick menu: a ring of tools around the pen or pointer, with colours and actions on an
// outer ring. It opens with a key (hold it, point at an item and let go; or tap it and
// click), a pen's side button (S Pen, Wacom barrel button), or two fingers held still on
// the page. Esc, a click outside or the centre closes it.

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

const INNER = 66, OUTER = 120, SIZE = 44;

// `inner` and `outer`: [{ label, icon (Node), swatch?, active?(), run() }].
export function quickMenu({ inner, outer, onOpen = () => {}, onClose = () => {} }) {
  let root = null, hovered = null, items = [];
  function build(x, y) {
    root = document.createElement('div');
    root.className = 'quick-menu';
    root.setAttribute('role', 'menu');
    root.setAttribute('aria-label', 'Quick menu');
    const disc = document.createElement('div');
    disc.className = 'qm-disc';
    disc.style.left = `${x}px`;
    disc.style.top = `${y}px`;
    root.append(disc);
    items = [];
    const place = (list, radius, ringName) => ring(list.length, radius).forEach((at, i) => {
      const entry = list[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `qm-item qm-${ringName}${entry.swatch ? ' qm-swatch' : ''}`;
      b.title = entry.label;
      b.setAttribute('aria-label', entry.label);
      b.setAttribute('role', 'menuitem');
      if (entry.swatch) b.style.setProperty('--swatch', entry.swatch);
      else if (entry.icon) b.append(entry.icon.cloneNode(true));
      if (entry.active?.()) b.setAttribute('aria-pressed', 'true');
      // Inner items answer to the number keys 1–8.
      if (ringName === 'inner') b.dataset.key = String(i + 1);
      b.style.left = `${x + at.x - SIZE / 2}px`;
      b.style.top = `${y + at.y - SIZE / 2}px`;
      b.onpointerenter = () => { hovered = entry; };
      b.onpointerleave = () => { if (hovered === entry) hovered = null; };
      b.onclick = (e) => { e.stopPropagation(); pick(entry); };
      items.push(b);
      root.append(b);
    });
    place(inner, INNER, 'inner');
    place(outer, OUTER, 'outer');
    const centre = document.createElement('button');
    centre.type = 'button';
    centre.className = 'qm-item qm-centre';
    centre.title = 'Close (Esc)';
    centre.setAttribute('aria-label', 'Close the quick menu');
    centre.textContent = '×';
    centre.style.left = `${x - SIZE / 2}px`;
    centre.style.top = `${y - SIZE / 2}px`;
    centre.onclick = (e) => { e.stopPropagation(); close(); };
    root.append(centre);
    // Anywhere else closes it, without drawing or choosing what is underneath.
    root.addEventListener('pointerdown', (e) => { if (e.target === root || e.target === disc) { e.preventDefault(); e.stopPropagation(); close(); } });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(root);
  }
  function open(x, y) {
    close();
    const at = fitCentre(x, y, OUTER + SIZE / 2, { width: innerWidth, height: innerHeight });
    hovered = null;
    build(at.x, at.y);
    onOpen();
    items[0]?.focus({ preventScroll: true });
  }
  function close() {
    if (!root) return;
    root.remove();
    root = null;
    hovered = null;
    onClose();
  }
  function pick(entry) {
    close();
    entry?.run();
  }
  return {
    open,
    close,
    get isOpen() { return !!root; },
    // Letting go of the key (or the side button) over an item chooses it; elsewhere the
    // menu stays open to click. Returns whether one was chosen.
    release() { if (!root || !hovered) return false; pick(hovered); return true; },
    // Keys while open: Esc closes, 1–8 choose an inner item.
    key(e) {
      if (!root) return false;
      if (e.key === 'Escape') { close(); return true; }
      if (/^[1-8]$/.test(e.key) && inner[Number(e.key) - 1]) { pick(inner[Number(e.key) - 1]); return true; }
      return false;
    },
  };
}
