// Interactive Sticky Note controls on rendered pages:
// - Knows every stroke and text box owned by each sticky note (explicit `<stickyId>:ink` parts
//   from Goodnotes imports + any ink/text added on top of the sticky note inside its bounds).
// - Clicking the top adhesive strip toggles pseudo-transparent peek mode, fading both the sticky
//   note card and all its owned ink/text to ~13% opacity (pointer-events: none) so the page
//   content underneath can be read and interacted with, while leaving a sleek top pill to restore.
// - The same toggle as tape has: a tap on the note with Pan (app.js) and its item and page menus
//   (item-menus.js) find it with stickyAt(). What it owns is found again at each toggle, so ink
//   or typed text added on it since the page was drawn fades with it.

const collapsedByNote = new Map();
// The sticky notes drawn in each page's render: [{ id, bounds, hidden(), toggle() }].
const stickiesByRender = new WeakMap();

// The top sticky note under page point (x, y) of this render, or null.
export function stickyAt(render, x, y) {
  const list = render ? stickiesByRender.get(render) : null;
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const [bx, by, bw, bh] = list[i].bounds;
    if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) return list[i];
  }
  return null;
}

function stickySetFor(noteKey) {
  let set = collapsedByNote.get(noteKey);
  if (!set) {
    set = new Set();
    collapsedByNote.set(noteKey, set);
  }
  return set;
}

export function clearStickyStates(noteKey) {
  if (noteKey) collapsedByNote.delete(noteKey);
  else collapsedByNote.clear();
}

function parseBoundsFromGroup(g) {
  if (!g) return null;
  const img = g.querySelector('image');
  if (img) {
    const x = Number(img.getAttribute('x') || 0);
    const y = Number(img.getAttribute('y') || 0);
    const w = Number(img.getAttribute('width') || 0);
    const h = Number(img.getAttribute('height') || 0);
    // Account for transform="translate(cx cy) rotate(...) translate(-w/2 -h/2)" emitted by scene.rs
    const parentG = img.parentElement;
    const tf = parentG?.getAttribute('transform') || '';
    const m = /translate\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/.exec(tf);
    if (m && w > 0 && h > 0) {
      return [Number(m[1]) - w / 2, Number(m[2]) - h / 2, w, h];
    }
    if (w > 0 && h > 0) return [x, y, w, h];
  }
  try {
    const b = g.getBBox?.();
    if (b && b.width > 0 && b.height > 0) return [b.x, b.y, b.width, b.height];
  } catch { /* Not laid out yet. */ }
  return null;
}

function findOwnedElements(svgEl, stickyId, pictureGroup, bounds, parts) {
  const owned = new Set();
  // 1. Explicitly owned parts (`<stickyId>:ink`, e.g. Goodnotes parented strokes + author text).
  const inkKey = `${stickyId}:ink`;
  for (const part of parts) {
    if (part.id === stickyId || part.id === inkKey) {
      const el = svgEl.querySelector(`[data-item="${CSS.escape(part.item)}"]`);
      if (el) owned.add(el);
    }
  }
  // 2. Dynamically written ink/text drawn ON TOP of the sticky note inside its bounds.
  if (pictureGroup && bounds) {
    const [bx, by, bw, bh] = bounds;
    const allItems = [...svgEl.querySelectorAll('[data-item]')];
    const picIdx = allItems.indexOf(pictureGroup);
    if (picIdx >= 0) {
      for (let i = picIdx + 1; i < allItems.length; i++) {
        const el = allItems[i];
        if (owned.has(el)) continue;
        // Don't swallow another sticky note card or unrelated compound prefab.
        const itemId = el.getAttribute('data-item');
        const p = parts.find((q) => q.item === itemId);
        if (p && p.id !== stickyId && p.id !== inkKey) continue;
        try {
          const b = el.getBBox?.();
          if (!b || (b.width === 0 && b.height === 0)) continue;
          const cx = b.x + b.width * 0.5;
          const cy = b.y + b.height * 0.5;
          if (cx >= bx - 6 && cx <= bx + bw + 6 && cy >= by - 6 && cy <= by + bh + 6) {
            owned.add(el);
          }
        } catch { /* Ignore unmeasurable SVG nodes. */ }
      }
    }
  }
  return [...owned];
}

export function syncStickyNotes(panel, render, noteKey = 'default') {
  render.querySelector('.sticky-toggle-layer')?.remove();
  stickiesByRender.delete(render);
  const parts = panel?.view?.parts;
  const svgEl = render?.querySelector(':scope > svg');
  if (!svgEl || !Array.isArray(parts) || !parts.length) return;

  // Identify every stickynote prefab on this page.
  const stickies = [];
  for (const part of parts) {
    if (part.kind !== 'prefab' || !part.spec) continue;
    let spec;
    try { spec = JSON.parse(part.spec); } catch { continue; }
    if (spec?.type !== 'stickynote') continue;
    const picPart = parts.find((q) => q.id === part.id && !q.spec && String(q.item).startsWith('image:'));
    const picEl = picPart ? svgEl.querySelector(`[data-item="${CSS.escape(picPart.item)}"]`) : null;
    const frameEl = svgEl.querySelector(`[data-item="${CSS.escape(part.item)}"]`);
    const bounds = parseBoundsFromGroup(picEl) || parseBoundsFromGroup(frameEl);
    if (!bounds) continue;
    stickies.push({ id: part.id, spec, picEl, frameEl, bounds });
  }
  if (!stickies.length) return;

  const [pageW, pageH] = panel.size || [1000, 1400];
  const collapsedSet = stickySetFor(noteKey);
  const layer = document.createElement('div');
  layer.className = 'sticky-toggle-layer';

  const registered = [];
  for (const st of stickies) {
    let owned = findOwnedElements(svgEl, st.id, st.picEl, st.bounds, parts);
    const [bx, by, bw, bh] = st.bounds;
    const topStripH = Math.max(18, Math.min(34, bh * 0.13));

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sticky-top-toggle';
    btn.style.left = `${(bx / pageW) * 100}%`;
    btn.style.top = `${(by / pageH) * 100}%`;
    btn.style.width = `${(bw / pageW) * 100}%`;
    btn.style.height = `${(topStripH / pageH) * 100}%`;
    btn.style.setProperty('--sticky-color', st.spec.color || '#fae778');

    const pill = document.createElement('span');
    pill.className = 'sticky-top-pill';
    btn.append(pill);

    const applyState = () => {
      const hidden = collapsedSet.has(st.id);
      // Ink or typed text drawn on the note since this page was rendered fades with it too.
      for (const el of owned) el.classList.remove('sticky-owned-hidden');
      if (svgEl.isConnected) owned = findOwnedElements(svgEl, st.id, st.picEl, st.bounds, parts);
      btn.classList.toggle('is-hidden', hidden);
      btn.setAttribute('aria-pressed', String(hidden));
      btn.title = hidden
        ? 'Sticky note dimmed (click top strip to show again)'
        : 'Click top strip to hide / peek under this sticky note';
      pill.textContent = hidden ? 'Show note' : 'Peek under';
      for (const el of owned) {
        el.classList.toggle('sticky-owned-hidden', hidden);
      }
    };

    // Stop pointerdown so clicking the top bar doesn't start a pan/pen stroke.
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggle();
    });
    const toggle = () => {
      if (collapsedSet.has(st.id)) collapsedSet.delete(st.id);
      else collapsedSet.add(st.id);
      applyState();
      return collapsedSet.has(st.id);
    };

    applyState();
    layer.append(btn);
    registered.push({ id: st.id, bounds: st.bounds, hidden: () => collapsedSet.has(st.id), toggle });
  }

  stickiesByRender.set(render, registered);
  render.append(layer);
}
