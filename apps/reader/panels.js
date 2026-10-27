// Floating side panels (Ask AI, audio): resize from the left edge (width), the
// bottom edge (height) or the bottom-left corner (both). Sizes are remembered.
export function resizable(panel, key, { minWidth = 280, minHeight = 220 } = {}) {
  for (const edge of ['left', 'bottom', 'corner']) {
    const grip = document.createElement('div');
    grip.className = `panel-grip grip-${edge}`;
    grip.setAttribute('aria-hidden', 'true');
    grip.title = 'Drag to resize';
    panel.append(grip);
    grip.onpointerdown = event => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const box = panel.getBoundingClientRect(), parent = panel.offsetParent.getBoundingClientRect();
      grip.onpointermove = e => {
        if (edge !== 'bottom') panel.style.width = `${Math.max(minWidth, Math.min(box.right - parent.left - 16, box.right - e.clientX))}px`;
        if (edge !== 'left') {
          panel.style.bottom = 'auto';
          panel.style.height = `${Math.max(minHeight, Math.min(parent.bottom - box.top - 8, e.clientY - box.top))}px`;
        }
      };
      grip.onpointerup = () => {
        grip.onpointermove = grip.onpointerup = null;
        try { localStorage.setItem(key, JSON.stringify({ width: panel.style.width, height: panel.style.height })); } catch { /* Optional. */ }
      };
    };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved?.width) panel.style.width = saved.width;
    if (saved?.height) { panel.style.height = saved.height; panel.style.bottom = 'auto'; }
  } catch { /* Optional. */ }
}
