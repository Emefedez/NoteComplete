// Floating side panels (Ask AI, audio): resize from the left edge (width), the
// top or bottom edge (height) or the bottom-left corner (both). Sizes are
// remembered. A panel whose content scrolls gets an inner scroll area, so the
// grips stay on its frame instead of scrolling away with the content.
export function resizable(panel, key, { minWidth = 280, minHeight = 220, scroll = false } = {}) {
  if (scroll) {
    const body = document.createElement('div');
    body.className = 'panel-body';
    body.append(...panel.childNodes);
    panel.append(body);
    panel.classList.add('has-body');
  }
  for (const edge of ['left', 'top', 'bottom', 'corner']) {
    const grip = document.createElement('div');
    grip.className = `panel-grip grip-${edge}`;
    grip.setAttribute('aria-hidden', 'true');
    grip.title = 'Drag to resize';
    panel.append(grip);
    grip.onpointerdown = event => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const box = panel.getBoundingClientRect(), parent = panel.offsetParent.getBoundingClientRect();
      // The panel is placed by top and height from here on.
      panel.style.top = `${box.top - parent.top}px`;
      panel.style.height = `${box.height}px`;
      panel.style.bottom = 'auto';
      grip.onpointermove = e => {
        if (edge === 'left' || edge === 'corner') panel.style.width = `${Math.max(minWidth, Math.min(box.right - parent.left - 16, box.right - e.clientX))}px`;
        if (edge === 'bottom' || edge === 'corner') panel.style.height = `${Math.max(minHeight, Math.min(parent.bottom - box.top - 8, e.clientY - box.top))}px`;
        if (edge === 'top') {
          const top = Math.max(parent.top + 8, Math.min(box.bottom - minHeight, e.clientY));
          panel.style.top = `${top - parent.top}px`;
          panel.style.height = `${box.bottom - top}px`;
        }
      };
      grip.onpointerup = () => {
        grip.onpointermove = grip.onpointerup = null;
        try { localStorage.setItem(key, JSON.stringify({ width: panel.style.width, height: panel.style.height, top: panel.style.top })); } catch { /* Optional. */ }
      };
    };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved?.width) panel.style.width = saved.width;
    if (saved?.height) { panel.style.height = saved.height; panel.style.bottom = 'auto'; }
    if (saved?.top) panel.style.top = saved.top;
  } catch { /* Optional. */ }
}
