// Crop an image in place (Select → Crop): the whole image shows faintly, the kept part
// brightly inside a frame with corner and edge handles; drag the frame to move it.
// Enter or Done applies (one undoable edit in the core), Esc or Cancel leaves it as it was.
const ns = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

// Native image units ↔ page units, from the selection the core reports.
export function cropFrame(item) {
  const [x, y, w, h] = item.bounds, a = item.adjustment, c = item.crop;
  const angle = (item.base_rotation + a.rotation) * Math.PI / 180;
  const kx = w * a.scale[0] / (c[2] - c[0]), ky = h * a.scale[1] / (c[3] - c[1]);
  const center = [x + w / 2 + a.translation[0], y + h / 2 + a.translation[1]], mid = [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    kx, ky, angle,
    transform: `translate(${center[0]} ${center[1]}) rotate(${angle * 180 / Math.PI}) scale(${kx} ${ky}) translate(${-mid[0]} ${-mid[1]})`,
    toNative([px, py]) {
      const dx = px - center[0], dy = py - center[1];
      return [(dx * cos + dy * sin) / kx + mid[0], (-dx * sin + dy * cos) / ky + mid[1]];
    },
  };
}

// Handles 0–3 are corners (top-left clockwise), 4–7 edges (top, right, bottom, left).
const MOVES = [[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 0, 0]];
export function dragRect(start, handle, [dx, dy], [sw, sh], min) {
  let [x0, y0, x1, y1] = start;
  if (handle === 'move') {
    const mx = Math.max(-x0, Math.min(sw - x1, dx)), my = Math.max(-y0, Math.min(sh - y1, dy));
    return [x0 + mx, y0 + my, x1 + mx, y1 + my];
  }
  const [l, t, r, b] = MOVES[handle];
  if (l) x0 = Math.max(0, Math.min(x1 - min[0], x0 + dx));
  if (t) y0 = Math.max(0, Math.min(y1 - min[1], y0 + dy));
  if (r) x1 = Math.min(sw, Math.max(x0 + min[0], x1 + dx));
  if (b) y1 = Math.min(sh, Math.max(y0 + min[1], y1 + dy));
  return [x0, y0, x1, y1];
}

export function cropMode({ p, item, coords, apply, done }) {
  const element = p.render?.querySelector(`[data-item="${item.id}"]`), href = element?.querySelector('image')?.getAttribute('href');
  if (!href || !item.native || !item.crop) return null;
  const frame = cropFrame(item), [sw, sh] = item.native;
  const unit = p.size[0] / p.el.getBoundingClientRect().width;
  const hs = [6 * unit / frame.kx, 6 * unit / frame.ky], min = [16 * unit / frame.kx, 16 * unit / frame.ky];
  let rect = [...item.crop], drag = null;
  const overlay = svg('svg', { viewBox: `0 0 ${p.size.join(' ')}`, class: 'selection-overlay crop-overlay', 'aria-label': 'Crop image' });
  const g = svg('g', { transform: frame.transform });
  const clip = `nc-crop-editing-${item.id.replace(/\W/g, '')}`;
  const clipRect = svg('rect', {});
  const defs = svg('clipPath', { id: clip }); defs.append(clipRect);
  const image = extra => svg('image', { href, x: 0, y: 0, width: sw, height: sh, preserveAspectRatio: 'none', ...extra });
  const outline = svg('rect', { class: 'crop-frame', 'vector-effect': 'non-scaling-stroke' });
  outline.style.pointerEvents = 'all'; outline.style.cursor = 'move'; outline.dataset.cropHandle = 'move';
  g.append(defs, image({ opacity: .35 }), image({ 'clip-path': `url(#${clip})` }), outline);
  const handles = MOVES.map((_, i) => {
    const h = svg('rect', { class: 'crop-handle', 'vector-effect': 'non-scaling-stroke', 'data-crop-handle': i, role: 'button', 'aria-label': ['Top left', 'Top right', 'Bottom right', 'Bottom left', 'Top edge', 'Right edge', 'Bottom edge', 'Left edge'][i] + ' of the crop' });
    h.style.pointerEvents = 'all';
    h.style.cursor = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize', 'ns-resize', 'ew-resize', 'ns-resize', 'ew-resize'][i];
    g.append(h);
    return h;
  });
  overlay.append(g);
  // Done / Whole image / Cancel float above the image, in the app's menu look.
  const bar = document.createElement('div');
  bar.className = 'grab-menu crop-menu';
  bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Crop');
  const button = (text, onclick, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = cls; b.onclick = onclick; return b; };
  bar.append(button('Whole image', () => { rect = [0, 0, sw, sh]; draw(); }), button('Cancel', () => finish(false)), button('Done', () => finish(true), 'primary'));
  function draw() {
    const [x0, y0, x1, y1] = rect, w = x1 - x0, h = y1 - y0;
    for (const el of [clipRect, outline]) { el.setAttribute('x', x0); el.setAttribute('y', y0); el.setAttribute('width', w); el.setAttribute('height', h); }
    const at = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0 + w / 2, y0], [x1, y0 + h / 2], [x0 + w / 2, y1], [x0, y0 + h / 2]];
    handles.forEach((el, i) => { el.setAttribute('x', at[i][0] - hs[0]); el.setAttribute('y', at[i][1] - hs[1]); el.setAttribute('width', 2 * hs[0]); el.setAttribute('height', 2 * hs[1]); });
  }
  const down = event => {
    const target = event.target.closest?.('[data-crop-handle]');
    if (!target || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    p.el.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, handle: target.dataset.cropHandle === 'move' ? 'move' : Number(target.dataset.cropHandle), start: [...rect], from: frame.toNative(coords(event, p)) };
  };
  const move = event => {
    if (drag?.id !== event.pointerId) return;
    event.stopPropagation();
    const at = frame.toNative(coords(event, p));
    rect = dragRect(drag.start, drag.handle, [at[0] - drag.from[0], at[1] - drag.from[1]], [sw, sh], min);
    draw();
  };
  const up = event => { if (drag?.id === event.pointerId) { event.stopPropagation(); drag = null; } };
  const key = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(true); }
  };
  overlay.addEventListener('pointerdown', down, true);
  p.el.addEventListener('pointermove', move, true);
  p.el.addEventListener('pointerup', up, true);
  document.addEventListener('keydown', key, true);
  if (element) element.style.visibility = 'hidden';
  draw();
  p.el.append(overlay, bar);
  // The bar sits above the crop's highest point, in page percentages so zoom keeps it there.
  const box = overlay.getBoundingClientRect(), frameBox = outline.getBoundingClientRect();
  bar.style.left = `${((frameBox.left - box.left) / box.width) * 100}%`;
  bar.style.top = `calc(${((frameBox.top - box.top) / box.height) * 100}% - 40px)`;
  bar.querySelector('.primary').focus();
  let ended = false;
  function finish(keep) {
    if (ended) return;
    ended = true;
    overlay.remove(); bar.remove();
    p.el.removeEventListener('pointermove', move, true);
    p.el.removeEventListener('pointerup', up, true);
    document.removeEventListener('keydown', key, true);
    if (element) element.style.visibility = '';
    const changed = rect.some((n, i) => Math.abs(n - item.crop[i]) > 1e-6);
    if (keep && changed) apply(rect); else done();
  }
  return { cancel: () => finish(false) };
}
