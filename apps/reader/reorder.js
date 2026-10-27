// Drag to reorder a row of buttons (tools, tabs): the dragged item lifts and
// follows the pointer, the others slide out of its way, and the new order is
// reported when it is dropped. A press without a drag stays a normal click.
const THRESHOLD = 6;

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
    const startX = down.clientX, pointer = down.pointerId;
    let dragging = false, grab = 0, out = false;
    const siblings = () => [...container.querySelectorAll(items)];
    const move = event => {
      if (event.pointerId !== pointer) return;
      if (!dragging) {
        if (Math.abs(event.clientX - startX) < THRESHOLD) return;
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
    const up = event => {
      if (event.pointerId !== pointer) return;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!dragging) return;
      item.classList.remove('dragging', 'detaching');
      container.classList.remove('reordering');
      item.style.transform = '';
      // The press became a drag: its click must not also choose the item.
      const swallow = e => { e.stopPropagation(); e.preventDefault(); };
      addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', swallow, { capture: true }), 0);
      if (event.type !== 'pointerup') return;
      if (out) onDetach(key(item));
      else onReorder(siblings().map(key), key(item));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}
