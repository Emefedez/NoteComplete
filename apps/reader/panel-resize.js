// Side panels made wider or narrower with the mouse or a finger (chart and diagram editors).
// A thin grip sits on each panel's inner edge; dragging it sets a CSS variable on the grid
// that holds the panels (the grid's column uses it, with the usual width as its fallback).
// The width is remembered on this device per panel; a double-click on the grip gives the
// usual width back. The grip is placed from the panel's box, so it is not inside the panel
// (which scrolls), and it hides itself while its panel is hidden or stacked (narrow screens).
const STORE = 'notecomplete-panel-width:';
const read = (key) => { try { return Number(localStorage.getItem(STORE + key)) || 0; } catch { return 0; } };
const write = (key, width) => { try { if (width) localStorage.setItem(STORE + key, String(Math.round(width))); else localStorage.removeItem(STORE + key); } catch { /* Optional. */ } };

export const clampWidth = (width, min, max) => Math.round(Math.min(max, Math.max(min, width)));

// `grid`: the element whose columns use the variables (it gets position: relative).
// `panels`: [{ panel, variable: '--ch-left', side: 'left' | 'right', key, min, max }]; a
// 'left' panel has its grip on its right edge and grows to the right, a 'right' panel the
// other way. Returns { update(), destroy() }: update() places the grips again (call it
// after showing or hiding a panel; a ResizeObserver covers the rest).
export function resizablePanels(grid, panels) {
  if (getComputedStyle(grid).position === 'static') grid.style.position = 'relative';
  const grips = [];
  for (const spec of panels) {
    const { panel, variable, side, key, min = 120, max = 640 } = spec;
    const saved = read(key);
    if (saved) grid.style.setProperty(variable, `${clampWidth(saved, min, max)}px`);
    const grip = document.createElement('div');
    grip.className = 'panel-grip';
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'vertical');
    grip.setAttribute('aria-label', 'Drag to resize this panel; double-click for its usual width');
    grip.title = 'Drag to resize · double-click: usual width';
    grip.tabIndex = -1;
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, width: panel.getBoundingClientRect().width };
      grip.classList.add('dragging');
      document.body.classList.add('panel-resizing');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) * (side === 'left' ? 1 : -1);
      grid.style.setProperty(variable, `${clampWidth(drag.width + dx, min, max)}px`);
      place();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      grip.classList.remove('dragging');
      document.body.classList.remove('panel-resizing');
      write(key, panel.getBoundingClientRect().width);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => {
      grid.style.removeProperty(variable);
      write(key, 0);
      place();
    });
    grid.append(grip);
    grips.push({ grip, panel, side });
  }
  // Each grip on its panel's inner edge, in the grid's own coordinates.
  function place() {
    const box = grid.getBoundingClientRect();
    for (const { grip, panel, side } of grips) {
      const r = panel.getBoundingClientRect();
      // Hidden, or stacked above or below the canvas on a narrow screen: no grip.
      const shown = r.width > 0 && r.height > 0 && Math.abs(r.top - box.top) < 2 && r.height >= box.height - 2;
      grip.hidden = !shown;
      if (!shown) continue;
      const edge = (side === 'left' ? r.right : r.left) - box.left;
      grip.style.left = `${edge - 3}px`;
    }
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null;
  observer?.observe(grid);
  for (const { panel } of grips) observer?.observe(panel);
  requestAnimationFrame(place);
  return {
    update: place,
    destroy() { observer?.disconnect(); for (const { grip } of grips) grip.remove(); },
  };
}
