// A cover for an Rnote note (.rnote has no picture of its own): its pen strokes and shapes
// drawn small, pictures (usually imported PDF pages) as white pages, on the note's canvas
// colour. The file is gzip JSON in which page pictures are huge base64/SVG strings, so it is
// read as a stream with those strings left out. Once the note has been opened, its rendered
// first page replaces this cover (app.js, ensureDocumentCover).

// The JSON with every "data" (bitmap pixels) and "svg_data" (vector picture) string emptied.
export async function rnoteSkeleton(blob) {
  const text = blob.stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream());
  const MARKS = ['"data":"', '"svg_data":"'];
  let out = '', carry = '', skipping = false;
  for await (const chunk of text) {
    let s = carry + chunk, at = 0;
    carry = '';
    while (at < s.length) {
      if (skipping) {
        // The string ends at the first quote not escaped by a backslash.
        let q = s.indexOf('"', at);
        while (q > 0) {
          let slashes = 0;
          for (let i = q - 1; i >= at && s[i] === '\\'; i--) slashes++;
          if (slashes % 2 === 0) break;
          q = s.indexOf('"', q + 1);
        }
        if (q < 0) {
          // A trailing backslash may escape the next chunk's first character.
          if (s.endsWith('\\')) carry = '\\';
          at = s.length;
          break;
        }
        skipping = false;
        at = q;
        continue;
      }
      let next = -1, mark = '';
      for (const m of MARKS) {
        const i = s.indexOf(m, at);
        if (i >= 0 && (next < 0 || i < next)) { next = i; mark = m; }
      }
      if (next < 0) {
        // Keep a tail that may be the start of a mark split across chunks.
        const keep = Math.min(s.length - at, 12);
        out += s.slice(at, s.length - keep);
        carry = s.slice(s.length - keep);
        at = s.length;
        break;
      }
      out += s.slice(at, next + mark.length);
      at = next + mark.length;
      skipping = true;
    }
  }
  return out + carry;
}

const css = (c, fallback) => {
  if (!c || typeof c !== 'object' || !(Number(c.a ?? 1) > 0.004)) return fallback;
  const v = (x) => Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 255);
  return `rgb(${v(c.r)},${v(c.g)},${v(c.b)})`;
};
const affine = (t) => {
  const a = t?.affine;
  return Array.isArray(a) && a.length >= 9 ? [a[0], a[1], a[3], a[4], a[6], a[7]] : [1, 0, 0, 1, 0, 0];
};
const apply = (a, x, y) => [a[0] * x + a[2] * y + a[4], a[1] * x + a[3] * y + a[5]];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The cover as an SVG string, or null when there is nothing to draw.
export function rnoteCoverSvg(json) {
  const root = JSON.parse(json);
  const es = root?.data?.engine_snapshot || root?.engine_snapshot;
  if (!es) return null;
  const doc = es.document || {};
  const background = css(doc.config?.background?.color, '#ffffff');
  const lines = [], pages = [];
  for (const item of es.stroke_components || []) {
    const v = item?.value;
    if (!v) continue;
    const style = (s) => {
      const inner = s?.smooth || s?.rough || s?.textured || (s && Object.values(s)[0]) || {};
      return { color: css(inner.stroke_color ?? inner.color, '#000'), width: Number(inner.stroke_width ?? inner.width) || 2 };
    };
    if (v.brushstroke?.path?.start?.pos) {
      const p = v.brushstroke.path;
      const pts = [p.start.pos];
      for (const seg of p.segments || []) {
        const end = (seg.lineto || seg.quadbezto || seg.cubbezto)?.end?.pos;
        if (end) pts.push(end);
      }
      lines.push({ pts, ...style(v.brushstroke.style) });
    } else if (v.shapestroke?.shape) {
      const [kind, s] = Object.entries(v.shapestroke.shape)[0] || [];
      let pts = null;
      if (kind === 'line' || kind === 'arrow') pts = [s.start, s.end || s.tip];
      else if (kind === 'rect' && s.cuboid?.half_extents) {
        const [hx, hy] = s.cuboid.half_extents, a = affine(s.transform);
        pts = [apply(a, -hx, -hy), apply(a, hx, -hy), apply(a, hx, hy), apply(a, -hx, hy), apply(a, -hx, -hy)];
      } else if (kind === 'ellipse' && s.radii) {
        const a = affine(s.transform);
        pts = Array.from({ length: 25 }, (_, i) => apply(a, s.radii[0] * Math.cos(i / 24 * 2 * Math.PI), s.radii[1] * Math.sin(i / 24 * 2 * Math.PI)));
      } else if (Array.isArray(s?.path)) pts = [s.start, ...s.path].filter(Array.isArray);
      if (pts?.every(Array.isArray)) lines.push({ pts, ...style(v.shapestroke.style) });
    } else {
      const picture = v.bitmapimage || v.vectorimage;
      const h = picture?.rectangle?.cuboid?.half_extents;
      if (h) {
        const a = affine(picture.rectangle.transform);
        const c = [apply(a, -h[0], -h[1]), apply(a, h[0], h[1])];
        pages.push([Math.min(c[0][0], c[1][0]), Math.min(c[0][1], c[1][1]), Math.abs(c[1][0] - c[0][0]), Math.abs(c[1][1] - c[0][1])]);
      }
    }
  }
  if (!lines.length && !pages.length) return null;
  // The first page-sized area in reading order: the top picture with what is beside it, or
  // the top of the writing.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of pages) { grow(p[0], p[1]); grow(p[0] + p[2], p[1] + p[3]); }
  for (const l of lines) for (const [x, y] of l.pts) grow(x, y);
  const fw = Number(doc.config?.format?.width) || 794, fh = Number(doc.config?.format?.height) || 1123;
  const top = pages.length ? pages.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
  // Notes written to the right of the top page, within its rows, widen the view.
  const beside = top && lines.some((l) => l.pts.some(([x, y]) => x > top[0] + top[2] && y >= top[1] && y <= top[1] + top[3]));
  const view = top
    ? [top[0], top[1], beside ? Math.min(x1 - top[0], top[2] * 2.2) : top[2], top[3]]
    : [x0, y0, Math.min(x1 - x0, Math.max(fw, fh)), Math.min(y1 - y0, Math.max(fw, fh))];
  const [vx, vy] = [view[0] - 16, view[1] - 16];
  const [vw, vh] = [Math.max(view[2] + 32, 50), Math.max(view[3] + 32, 50)];
  const n = (v) => Math.round(v);
  let budget = 9000;
  const paths = [];
  for (const l of lines) {
    if (budget <= 0) break;
    const step = Math.max(1, Math.floor(l.pts.length / 16));
    const pts = l.pts.filter((_, i) => i % step === 0 || i === l.pts.length - 1);
    budget -= pts.length;
    paths.push(`<polyline points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" stroke="${esc(l.color)}" stroke-width="${n(Math.max(l.width, vw / 400))}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" width="320" height="${Math.round(320 * vh / vw)}">`
    + `<rect x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" fill="${esc(background)}"/>`
    + pages.map((p) => `<rect x="${n(p[0])}" y="${n(p[1])}" width="${n(p[2])}" height="${n(p[3])}" fill="#fff" stroke="#d4d4d8" stroke-width="${n(vw / 300)}"/>`).join('')
    + `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g></svg>`;
}

// The cover as a data URL; null when the file cannot be read (a generic cover is used then).
export async function rnoteCover(blob) {
  if (typeof DecompressionStream !== 'function' || !blob?.stream || blob.size > 60 * 1024 * 1024) return null;
  const svg = rnoteCoverSvg(await rnoteSkeleton(blob));
  return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null;
}
