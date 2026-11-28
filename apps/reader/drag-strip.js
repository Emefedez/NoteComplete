// Single-row strips (the Notes head and its Markdown bar, Ask AI's Send row): click-and-drag
// or wheel scrolls them sideways, and an edge fades while more is hidden that way (data-fade).
export function makeDragScrollStrip(strip) {
  if (!strip || strip.__dragStripWired) return () => {};
  strip.__dragStripWired = true;
  const syncFade = () => {
    const overflow = strip.scrollWidth > strip.clientWidth + 2;
    strip.classList.toggle('is-overflowing', overflow);
    if (!overflow) { delete strip.dataset.fade; return; }
    const left = strip.scrollLeft > 2;
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2;
    if (left && right) strip.dataset.fade = 'both';
    else if (left) strip.dataset.fade = 'left';
    else if (right) strip.dataset.fade = 'right';
    else delete strip.dataset.fade;
  };
  let down = false, dragged = false, startX = 0, startLeft = 0;
  strip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (strip.scrollWidth <= strip.clientWidth + 2) return;
    down = true;
    dragged = false;
    startX = e.clientX;
    startLeft = strip.scrollLeft;
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (!dragged && Math.abs(dx) > 5) {
      dragged = true;
      strip.classList.add('is-dragging');
    }
    if (dragged) {
      strip.scrollLeft = startLeft - dx;
      syncFade();
    }
  });
  const endDrag = () => {
    if (!down) return;
    down = false;
    strip.classList.remove('is-dragging');
    if (dragged) setTimeout(() => { dragged = false; }, 0);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  strip.addEventListener('click', (e) => {
    if (dragged) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  strip.addEventListener('wheel', (e) => {
    if (strip.scrollWidth <= strip.clientWidth + 2) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
      syncFade();
    }
  }, { passive: false });
  strip.addEventListener('scroll', syncFade, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncFade).observe(strip);
  requestAnimationFrame(syncFade);
  return syncFade;
}
