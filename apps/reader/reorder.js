// Drag to reorder a row of buttons (tools, tabs): the dragged item lifts and
// follows the pointer, the others slide out of its way, and the new order is
// reported when it is dropped. A press without a drag stays a normal click.
// With a finger or stylus the row may scroll sideways, so a drag starts only after a
// press-and-hold (the item lifts); a quick swipe still scrolls the row.
const THRESHOLD = 6, HOLD_MS = 320, HOLD_SLOP = 10, EDGE = 32;

// A drag counts as pulled out of the row once the pointer is this far above or
// below it, or out of the window.
const DETACH = 48;
export function pulledOut({ x, y }, row, view) {
  return y < row.top - DETACH || y > row.bottom + DETACH || x < 0 || y < 0 || x > view.width || y > view.height;
}

// Where an item at `x` (its centre) belongs among the others' centres.
export function slotFor(x, centres) {
  return centres.filter(c => c < x).length;
}

export function sortable(container, { items, key, onReorder, onDetach = null, ignore = '' }) {
  container.addEventListener('pointerdown', down => {
    const item = down.target.closest(items);
    if (!item || down.button !== 0 || !container.contains(item) || (ignore && down.target.closest(ignore))) return;
    const startX = down.clientX, startY = down.clientY, pointer = down.pointerId;
    const touch = down.pointerType === 'touch' || down.pointerType === 'pen';
    let dragging = false, grab = 0, out = false, held = !touch, holdTimer = 0;
    const siblings = () => [...container.querySelectorAll(items)];
    // Touch: lifted after a hold; until then a move is the row scrolling (or a tap).
    if (touch) {
      holdTimer = setTimeout(() => {
        held = true;
        item.classList.add('lifted');
        navigator.vibrate?.(8);
      }, HOLD_MS);
    }
    // While lifted the page and the row stay put, and no long-press menu opens.
    const still = e => { if (held && touch) e.preventDefault(); };
    container.addEventListener('touchmove', still, { passive: false });
    container.addEventListener('contextmenu', still);
    const move = event => {
      if (event.pointerId !== pointer) return;
      if (!held) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > HOLD_SLOP) finish(event, true);
        return;
      }
      if (!dragging) {
        if (!touch && Math.abs(event.clientX - startX) < THRESHOLD) return;
        dragging = true;
        grab = startX - item.getBoundingClientRect().left;
        item.classList.add('dragging');
        container.classList.add('reordering');
        try { item.setPointerCapture(pointer); } catch { /* Released already. */ }
      }
      // Pulled out of the row: it will open in a window of its own when dropped.
      if (onDetach) {
        out = siblings().length > 1 && pulledOut({ x: event.clientX, y: event.clientY }, container.getBoundingClientRect(), { width: innerWidth, height: innerHeight });
        item.classList.toggle('detaching', out);
        if (out) return;
      }
      // Near an edge of a row that scrolls, it scrolls to reach the items beyond.
      const box = container.getBoundingClientRect();
      if (container.scrollWidth > container.clientWidth) {
        if (event.clientX < box.left + EDGE) container.scrollLeft -= 8;
        else if (event.clientX > box.right - EDGE) container.scrollLeft += 8;
      }
      // Lay the item where its centre now falls, animating the others (FLIP).
      item.style.transform = '';
      const others = siblings().filter(el => el !== item);
      const left = event.clientX - grab, centre = left + item.offsetWidth / 2;
      const index = slotFor(centre, others.map(el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; }));
      const ref = others[index];
      const inPlace = ref ? item.nextElementSibling === ref : others.at(-1)?.nextElementSibling === item;
      if (!inPlace && others.length) {
        const before = new Map(others.map(el => [el, el.getBoundingClientRect().left]));
        if (ref) container.insertBefore(item, ref);
        else others.at(-1).after(item);
        for (const el of others) {
          const dx = before.get(el) - el.getBoundingClientRect().left;
          if (!dx) continue;
          el.style.transition = 'none';
          el.style.transform = `translateX(${dx}px)`;
          el.getBoundingClientRect();
          el.style.transition = '';
          el.style.transform = '';
        }
      }
      item.style.transform = `translateX(${left - item.getBoundingClientRect().left}px)`;
    };
    const up = event => { if (event.pointerId === pointer) finish(event, false); };
    function finish(event, scrolled) {
      clearTimeout(holdTimer);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      container.removeEventListener('touchmove', still);
      // The contextmenu a long press fires comes after the hold; it is ignored a moment longer.
      setTimeout(() => container.removeEventListener('contextmenu', still), 400);
      item.classList.remove('lifted');
      if (scrolled || !dragging) {
        // A hold that never moved is not a tap either.
        if (held && touch && !scrolled) swallowClick();
        return;
      }
      item.classList.remove('dragging', 'detaching');
      container.classList.remove('reordering');
      item.style.transform = '';
      // The press became a drag: its click must not also choose the item.
      swallowClick();
      if (event.type !== 'pointerup') return;
      if (out) onDetach(key(item));
      else onReorder(siblings().map(key), key(item));
    }
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

function swallowClick() {
  const swallow = e => { e.stopPropagation(); e.preventDefault(); };
  addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', swallow, { capture: true }), 0);
}
