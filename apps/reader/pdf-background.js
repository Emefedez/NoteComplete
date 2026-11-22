// Rasterize only the visible embedded PDF page. Ink stays editable SVG above it.
import { normalizeQuality } from "./quality.js";
import { lagLog } from "./lag-log.js";
let pdfjs;
export async function openPdf(data) {
  pdfjs ||= await import("./vendor/pdfjs/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "./vendor/pdfjs/build/pdf.worker.mjs",
    import.meta.url,
  ).href;
  const base = new URL("./vendor/pdfjs/", import.meta.url).href;
  const task = pdfjs.getDocument({
    data,
    cMapUrl: base + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: base + "standard_fonts/",
    wasmUrl: base + "wasm/",
    isEvalSupported: false,
  });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy().catch(() => { /* Optional. */ });
    throw error;
  }
}

// The quality setting's scale is for a 2× screen (tablets, phones, most laptops); a 1×
// screen gets half as many pixels per side, never fewer than it shows (Balanced 2× → 1×,
// Sharp 3× → 1.5×). Drawing at 2× for a 1× screen took four times the memory and time.
function pixelsPerCssPixel(pixelRatio, prefs) {
  const ratio = Math.max(1, Math.min(Number(pixelRatio) || 1, 3));
  return prefs ? Math.min(prefs.scale, Math.max(1, (ratio * prefs.scale) / 2)) : Math.max(2, ratio);
}
// Keep raster output sharp when a page is shown wider than its PDF user units.
// The cache is keyed by the resulting pixel size so zooming can request a
// higher-resolution image without reusing a blurry fit-width raster.
export function rasterTarget(original, cssWidth, pixelRatio = globalThis.devicePixelRatio || 1, settings) {
  const prefs = settings ? normalizeQuality(settings) : null;
  const quality = pixelsPerCssPixel(pixelRatio, prefs);
  const maxPixels = 8192;
  const requestedWidth = Math.max(1, Math.ceil(cssWidth * quality));
  const scale = Math.min(
    requestedWidth / original.width,
    maxPixels / Math.max(original.width, original.height),
    Math.sqrt((prefs?.megapixels ?? 12) * 1_000_000 / (original.width * original.height)),
  );
  return {
    scale,
    width: Math.min(requestedWidth, Math.ceil(original.width * scale)),
    height: Math.ceil(original.height * scale),
  };
}

// Fast zoom sharpening (quality.js zoomDetail): the part of a zoomed PDF page on screen,
// drawn at the zoomed resolution, over a page raster kept at fit-to-window size. `box` is
// [left, top, right, bottom] as fractions of the PDF page as shown. The result is whole
// device pixels, so `box` comes back snapped to them (place the tile by the returned box).
export const DETAIL_MAX_SIDE = 4096;
export function regionTarget(original, cssWidth, box, pixelRatio = globalThis.devicePixelRatio || 1, settings) {
  const prefs = settings ? normalizeQuality(settings) : null;
  const [x0, y0, x1, y1] = box.map((n) => Math.max(0, Math.min(1, n)));
  const spanW = Math.max(1e-6, x1 - x0) * original.width, spanH = Math.max(1e-6, y1 - y0) * original.height;
  const budget = (prefs?.megapixels ?? 12) * 1_000_000;
  const scale = Math.min(
    Math.ceil(cssWidth * pixelsPerCssPixel(pixelRatio, prefs)) / original.width,
    DETAIL_MAX_SIDE / Math.max(spanW, spanH),
    Math.sqrt(budget / (spanW * spanH)),
  );
  const pageW = original.width * scale, pageH = original.height * scale;
  const left = Math.floor(x0 * pageW), top = Math.floor(y0 * pageH);
  const right = Math.min(Math.ceil(pageW), Math.ceil(x1 * pageW)), bottom = Math.min(Math.ceil(pageH), Math.ceil(y1 * pageH));
  return {
    scale, left, top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    box: [left / pageW, top / pageH, right / pageW, bottom / pageH],
  };
}

// The CSS font of a pdf.js text item: the font pdf.js loaded for it (its loadedName is the
// item's fontName, registered in the document once the page is drawn), then the family pdf.js
// guessed for it (serif, sans-serif, monospace), which is used when the first one is not
// loaded or maps its glyphs elsewhere.
function fontFor(fontName, styles) {
  const family = styles?.[fontName]?.fontFamily || "sans-serif";
  return /^[\w-]+$/.test(fontName || "") ? `"${fontName}", ${family}` : family;
}
const measured = (measure, text, font) => {
  if (!measure || !text) return 0;
  try { const w = measure(text, font); return Number.isFinite(w) && w > 0 ? w : 0; } catch { return 0; }
};
// Text widths with a canvas (100 px type, so rounding is small), or null where there is none.
let measureContext;
export function textMeasure() {
  if (measureContext === undefined) {
    try {
      measureContext = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1).getContext("2d")
        : typeof document === "object" ? document.createElement("canvas").getContext("2d") : null;
    } catch { measureContext = null; }
  }
  if (!measureContext) return null;
  return (text, font) => {
    const css = `100px ${font}`;
    if (measureContext.font !== css) measureContext.font = css;
    return measureContext.measureText(text).width;
  };
}
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
// Words of a pdf.js text layer with boxes in page units. Each item is mapped
// through the viewport (rotation included), split at spaces, then placed through the
// page's PDF rect. A word's place along its item comes from `measure(text, font)`: the
// widths of the item's text up to the word's start and end, in any unit, scaled so the
// whole text is the item's width. Sharing the width by character count instead put
// words a few letters off in proportional fonts ("iiii" is as wide as "MMMM"), so a text
// highlight started and ended in the middle of words. Without a measure (no canvas), or
// when it fails, the count is used.
//
// A spaced-out title ("A R Q U I T E C T U R A  D E", letter-spacing in the PDF) comes from
// pdf.js as one item with a space between every two letters, word gaps or not, so it copied as
// separate letters. With `glyphs` (textGlyphs: where the PDF draws each glyph) its letters are
// joined into words again, broken where the PDF drew a space or left a word-sized gap.
export function textWords(items, viewport, place, measure = textMeasure(), styles = {}, glyphs = null) {
  const out = [];
  const sx = place.width / viewport.width, sy = place.height / viewport.height;
  // Whether a space came before each word (`space`): the PDF's own spaces, also those it
  // writes as items of their own, which tell a spaced-out title's letters from its words.
  let spaceBefore = false;
  for (const item of items) {
    if (typeof item.str === 'string' && !item.str.trim()) { if (item.str || item.hasEOL) spaceBefore = true; continue; }
    if (!item.str || !item.transform) continue;
    const t = multiply(viewport.transform, item.transform);
    const length = Math.hypot(t[0], t[1]) || 1, width = (item.width || 0) * viewport.scale;
    const dir = [t[0] / length, t[1] / length], up = [t[2], t[3]];
    const font = fontFor(item.fontName, styles);
    const whole = measured(measure, item.str, font);
    const at = (i) => whole ? width * measured(measure, item.str.slice(0, i), font) / whole : width * i / item.str.length;
    let matches = [...item.str.matchAll(/\S+/g)].map((m) => ({ text: m[0], index: m.index, end: m.index + m[0].length, gap: m.index > 0 }));
    const words = glyphs && letterSpaced(item.str) ? spacedWords(item, matches, glyphs, viewport.scale) : null;
    if (words) matches = words;
    for (const match of matches) {
      const a = match.from ?? at(match.index), b = match.to ?? at(match.end);
      const corners = [a, b].flatMap(d => {
        const base = [t[4] + dir[0] * d, t[5] + dir[1] * d];
        return [base, [base[0] + up[0], base[1] + up[1]]];
      });
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      out.push({ text: match.text, box: [place.x + x0 * sx, place.y + y0 * sy, (Math.max(...xs) - x0) * sx, (Math.max(...ys) - y0) * sy], space: match.gap || spaceBefore });
      spaceBefore = false;
    }
    spaceBefore = /\s$/.test(item.str) || !!item.hasEOL;
  }
  return out;
}

// Whether pdf.js wrote an item as spaced-out letters: most of its pieces one character long
// ("A R Q U I T E C T U R A D E", "PA R C I A L I"; "TA" where kerning closed the gap).
export function letterSpaced(str) {
  const pieces = str.split(/\s+/).filter(Boolean);
  return pieces.length >= 3 && pieces.filter((p) => [...p].length === 1).length >= pieces.length * 0.6;
}

// Where a page's glyphs are drawn, from its pdf.js operator list (`OPS` names its operators;
// `fontOf(name)` gives the loaded font, for its matrix and writing direction): each glyph's
// text, whether it is a space, its start and end on its baseline and its size, in the PDF's
// user space (the space of text items' transforms). Horizontal text only; what this does not
// follow (Type 3 fonts' own drawing) still has its place, only its width may be off.
export function textGlyphs(opList, OPS, fontOf = () => null) {
  const out = [];
  const { fnArray = [], argsArray = [] } = opList || {};
  const identity = [1, 0, 0, 1, 0, 0];
  let ctm = identity;
  let s = { cs: 0, ws: 0, hs: 1, lead: 0, rise: 0, size: 0, dir: 1, fm: [0.001, 0, 0, 0.001, 0, 0], vertical: false, tm: identity, x: 0, y: 0, lx: 0, ly: 0 };
  const stack = [];
  const move = (x, y) => { s.lx += x; s.ly += y; s.x = s.lx; s.y = s.ly; };
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const show = (glyphs) => {
    if (!s.size || s.vertical || !Array.isArray(glyphs)) return;
    const m = multiply(ctm, s.tm), hs = s.hs * s.dir, scale = s.size * s.fm[0];
    const size = Math.abs(s.size) * Math.hypot(m[2], m[3]);
    let x = 0;
    for (const g of glyphs) {
      if (typeof g === 'number') { x -= g * s.size / 1000; continue; }
      if (!g) continue;
      const width = (g.width || 0) * scale, px = s.x + x * hs, py = s.y + s.rise;
      const [x0, y0] = apply(m, px, py), [x1, y1] = apply(m, px + width * hs, py);
      const text = typeof g.unicode === 'string' ? g.unicode : '';
      out.push({ text, space: !!g.isSpace || (text !== '' && !text.trim()), x: x0, y: y0, ex: x1, ey: y1, size });
      x += width + ((g.isSpace ? s.ws : 0) + s.cs) * s.dir;
    }
    s.x += x * hs;
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], a = argsArray[i] || [];
    switch (fn) {
      case OPS.save: stack.push([ctm, { ...s }]); break;
      case OPS.restore: if (stack.length) [ctm, s] = stack.pop(); break;
      case OPS.transform: ctm = multiply(ctm, a[0]?.length === 6 ? [...a[0]] : a); break;
      case OPS.paintFormXObjectBegin: stack.push([ctm, { ...s }]); if (a[0]?.length === 6) ctm = multiply(ctm, [...a[0]]); break;
      case OPS.paintFormXObjectEnd: if (stack.length) [ctm, s] = stack.pop(); break;
      case OPS.beginText: s.tm = identity; s.x = s.y = s.lx = s.ly = 0; break;
      case OPS.setCharSpacing: s.cs = a[0] || 0; break;
      case OPS.setWordSpacing: s.ws = a[0] || 0; break;
      case OPS.setHScale: s.hs = (a[0] ?? 100) / 100; break;
      case OPS.setLeading: s.lead = -(a[0] || 0); break;
      case OPS.setTextRise: s.rise = a[0] || 0; break;
      case OPS.setFont: {
        const font = (() => { try { return fontOf(a[0]); } catch { return null; } })();
        s.size = Math.abs(a[1] || 0); s.dir = a[1] < 0 ? -1 : 1;
        s.fm = font?.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
        s.vertical = !!font?.vertical;
        break;
      }
      case OPS.moveText: move(a[0] || 0, a[1] || 0); break;
      case OPS.setLeadingMoveText: s.lead = a[1] || 0; move(a[0] || 0, a[1] || 0); break;
      case OPS.setTextMatrix: {
        // One matrix (a Float32Array in pdf.js 6), or its six numbers.
        const m = a[0]?.length === 6 ? a[0] : a;
        if (m.length === 6) { s.tm = [...m]; s.x = s.y = s.lx = s.ly = 0; }
        break;
      }
      case OPS.nextLine: move(0, s.lead); break;
      case OPS.showText: case OPS.showSpacedText: show(a[0]); break;
      case OPS.nextLineShowText: move(0, s.lead); show(a[0]); break;
      case OPS.nextLineSetSpacingShowText: s.ws = a[0] || 0; s.cs = a[1] || 0; move(0, s.lead); show(a[2]); break;
    }
  }
  return out;
}

// The words of a spaced-out item (letterSpaced), from where its glyphs are drawn: letters
// joined, broken where the PDF drew a space glyph, or (a PDF that draws none) where the gap is
// clearly wider than the gaps between letters.
// `pieces` are the item's pdf.js pieces; each word is one or more of them with `from` and `to`
// along the item in viewport units. Null when the glyphs do not match the item's text.
function spacedWords(item, pieces, glyphs, scale) {
  const [a, b, c, d, ox, oy] = item.transform;
  const len = Math.hypot(a, b) || 1, ux = a / len, uy = b / len;
  const size = Math.hypot(c, d) || len;
  const along = (x, y) => (x - ox) * ux + (y - oy) * uy;
  const across = (x, y) => (y - oy) * ux - (x - ox) * uy;
  const chars = (text) => [...text.normalize('NFKC')];
  const want = pieces.map((p) => chars(p.text));
  const total = want.reduce((n, w) => n + w.length, 0);
  const first = want[0][0];
  const start = glyphs.findIndex((g) => !g.space && g.text && Math.abs(along(g.x, g.y)) < size * 0.3 && Math.abs(across(g.x, g.y)) < size * 0.3 && chars(g.text)[0] === first);
  if (start < 0) return null;
  // The item's glyphs in drawing order, each with whether a space glyph came before it.
  const run = [];
  let count = 0, space = false;
  for (let i = start; i < glyphs.length && count < total; i++) {
    const g = glyphs[i];
    if (Math.abs(across(g.x, g.y)) > size * 0.5) return null;
    if (g.space) { space = true; continue; }
    if (!g.text) return null;
    const own = chars(g.text);
    run.push({ g, at: count, chars: own, space });
    count += own.length; space = false;
  }
  if (run.flatMap((r) => r.chars).join('') !== want.flat().join('')) return null;
  // Each piece's first and last glyph.
  const ends = [];
  let at = 0, k = 0;
  for (const w of want) {
    const from = run.findIndex((r) => r.at === at);
    at += w.length;
    while (k < run.length && run[k].at + run[k].chars.length < at) k++;
    if (from < 0 || k >= run.length || run[k].at + run[k].chars.length !== at) return null;
    ends.push([run[from], run[k]]);
  }
  // The gap before each piece but the first, and whether a word starts there.
  const gaps = ends.slice(1).map(([next], i) => {
    const last = ends[i][1].g;
    return { gap: along(next.g.x, next.g.y) - along(last.ex, last.ey), space: next.space, letters: /[\p{L}\p{N}]$/u.test(pieces[i].text) && /^[\p{L}\p{N}]/u.test(pieces[i + 1].text) };
  });
  const sorted = gaps.map((g) => g.gap).sort((x, y) => x - y);
  const letter = sorted[Math.floor(sorted.length / 4)] ?? 0;
  const drawsSpaces = gaps.some((g) => g.space);
  // Without space glyphs, gaps that are all as wide as a space (a quarter of the type) are
  // spaces: letters spaced that far apart are not a title's letter-spacing.
  const breaks = gaps.map((g) => g.space || !g.letters || (drawsSpaces
    ? g.gap > Math.max(size * 0.3, letter + size * 0.15)
    : letter > size * 0.25 || g.gap > letter + size * 0.12));
  const words = [];
  pieces.forEach((piece, i) => {
    const [g0, g1] = ends[i];
    const from = along(g0.g.x, g0.g.y) * scale, to = along(g1.g.ex, g1.g.ey) * scale;
    const word = words.at(-1);
    if (i > 0 && !breaks[i - 1]) { word.text += piece.text; word.end = piece.end; word.to = to; }
    else words.push({ text: piece.text, index: piece.index, end: piece.end, gap: piece.gap, from, to });
  });
  return words;
}

// Where the PDF page sits on its Noteful page. Widened pages keep the PDF at
// native scale in `rect`; older cores without it fill the whole page.
export function backgroundPlacement(background, size) {
  const [x, y, width, height] = background?.rect ?? [0, 0, size[0], size[1]];
  return { x, y, width, height, share: width / size[0] };
}

// How many page rasters stay ready for scrolling back.
export const RASTERS_KEPT = 3;

// PDF pages are drawn by pdf.js into a canvas and shown in one of two ways (app.js chooses
// per page, by how much ink is on it):
// - "canvas": the canvas itself, under the page's SVG. Its memory is freed the moment the
//   page leaves the screen. But a canvas is a compositing layer of its own, and while ink
//   changes over it (a stroke being drawn) Chromium checks every ink element against that
//   layer each frame: about 0.013 ms per element, 10 ms a frame with a few hundred strokes.
// - "url": a PNG (blob: URL) in an <image> inside the SVG, a plain picture to the browser
//   whatever the ink. The browser keeps decoded pictures in a cache it empties only when
//   memory runs short, so this is for pages with much ink. The PNG is encoded in a worker
//   (raster-encoder.js), not with toDataURL here: that took 60–100 ms per page.
// A canvas reaches the screen as one GPU texture, and many Android tablets (Xiaomi Pad 5) take
// none larger than 4096 px a side: a larger canvas is not drawn at all. A picture is drawn in
// tiles, so a raster that large (a page zoomed in) is shown as a picture whatever the ink.
export const CANVAS_MAX_SIDE = 4096;
export const CANVAS_MAX_PIXELS = 16_000_000;
export function rasterKind(kind, target) {
  const large = Math.max(target.width, target.height) > CANVAS_MAX_SIDE || target.width * target.height > CANVAS_MAX_PIXELS;
  return kind === "canvas" && large ? "url" : kind;
}

// A canvas for a second place on screen (one canvas can be in only one place).
export function copyCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d").drawImage(source, 0, 0);
  return canvas;
}
// A drawn canvas as a still picture: a "bitmaprenderer" canvas holding an ImageBitmap of it.
// The browser may hand a 2D canvas's pixels to the compositor again on every frame (Chromium
// copied a whole page per frame while ink was drawn over it); a bitmap goes once. Where that
// is unsupported, the 2D canvas itself.
async function settled(canvas) {
  try {
    const still = document.createElement("canvas");
    const context = still.getContext("bitmaprenderer");
    if (!context || typeof createImageBitmap !== "function") return canvas;
    still.width = canvas.width;
    still.height = canvas.height;
    context.transferFromImageBitmap(await createImageBitmap(canvas));
    canvas.width = canvas.height = 0;
    return still;
  } catch {
    return canvas;
  }
}
// A 2D canvas gives its pixels back when it shrinks to nothing. A bitmap canvas is left to the
// garbage collector, which frees it promptly once nothing refers to it: replacing its bitmap
// (transferFromImageBitmap) makes the browser keep both for seconds.
function wipe(canvas) {
  if (canvas.getContext("bitmaprenderer")) return;
  canvas.width = canvas.height = 0;
}
let encoder = null, encodes = 0;
const waiting = new Map();
function encoderWorker() {
  if (encoder !== null) return encoder;
  try {
    if (typeof OffscreenCanvas !== "function" || typeof Worker !== "function" || typeof createImageBitmap !== "function") throw Error("unsupported");
    encoder = new Worker(new URL("./raster-encoder.js", import.meta.url));
    encoder.onmessage = ({ data: { id, blob, error } }) => {
      const job = waiting.get(id);
      waiting.delete(id);
      if (job) blob ? job.resolve(blob) : job.reject(Error(error));
    };
    encoder.onerror = () => {
      for (const job of waiting.values()) job.reject(Error("The page encoder stopped."));
      waiting.clear();
      encoder = false;
    };
  } catch {
    encoder = false;
  }
  return encoder;
}
const onMainThread = (canvas) => new Promise((resolve, reject) =>
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Error("Could not draw the PDF page."))), "image/png"));
// The canvas as a PNG Blob; in the worker where browsers have one (Safari 16.4+), else here.
export async function pngOf(canvas) {
  const worker = encoderWorker();
  if (!worker) return onMainThread(canvas);
  try {
    const bitmap = await createImageBitmap(canvas);
    const id = ++encodes;
    return await new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, bitmap }, [bitmap]);
    });
  } catch {
    return onMainThread(canvas);
  }
}

export class PdfBackgrounds {
  constructor(read, { maxKept = RASTERS_KEPT } = {}) {
    this.read = read;
    this.documents = new Map();
    this.images = new Map();
    this.rasters = new Map();
    this.drawing = new Map();
    this.wants = new Map();
    this.maxKept = Math.max(RASTERS_KEPT, Number(maxKept) || RASTERS_KEPT);
    this.closed = false;
  }
  setMaxKept(limit) {
    this.maxKept = Math.max(RASTERS_KEPT, Math.min(48, Math.round(Number(limit) || RASTERS_KEPT)));
    while (this.rasters.size > this.maxKept) {
      const [oldest, old] = this.rasters.entries().next().value;
      this.rasters.delete(oldest);
      this.release(old);
    }
  }
  rasterKey(background, size, displayWidth = size[0], settings, kind = "canvas") {
    const rasterSettings = settings ? { scale: settings.scale, megapixels: settings.megapixels } : settings;
    return JSON.stringify([background, size, Math.ceil(displayWidth), rasterSettings, globalThis.devicePixelRatio || 1, kind]);
  }
  // Synchronous cache hit check so scrolling back to a preloaded page attaches on the same frame
  // without waiting for scrollPause (eliminates blank white flicker).
  peekRaster(background, size, displayWidth = size[0], settings, kind = "canvas") {
    const key = this.rasterKey(background, size, displayWidth, settings, kind);
    const kept = this.rasters.get(key);
    if (kept) {
      this.rasters.delete(key);
      this.rasters.set(key, kept);
    }
    return kept || null;
  }
  // The PDF page for the page view, as a canvas or a blob: URL (`kind`, see above; a canvas
  // too large for some screens comes as a URL). The last `maxKept` stay, for scrolling
  // back; release() lets go of one no longer shown.
  // `wanted()`: false once the page has moved on (scrolled away, redrawn): a raster still
  // waiting its turn is then not drawn at all.
  async raster(background, size, displayWidth = size[0], settings, kind = "canvas", wanted = null) {
    const key = this.rasterKey(background, size, displayWidth, settings, kind);
    const kept = this.rasters.get(key);
    if (kept) {
      this.rasters.delete(key);
      this.rasters.set(key, kept);
      return kept;
    }
    // Every page waiting for this raster says whether it still wants it.
    const wants = this.wants.get(key) || [];
    wants.push(wanted || (() => true));
    this.wants.set(key, wants);
    if (this.drawing.has(key)) return this.drawing.get(key);
    const job = this.oneAtATime(async () => {
      if (!wants.some((w) => w())) throw Error("No longer shown");
      const { page, target, viewport, canvas } = await this.blankCanvas(background, displayWidth, settings);
      let shown;
      try {
        await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
        shown = rasterKind(kind, target) === "url" ? URL.createObjectURL(await pngOf(canvas)) : await settled(canvas);
      } finally {
        if (shown !== canvas) canvas.width = canvas.height = 0;
        page.cleanup();
      }
      if (this.closed) {
        this.release(shown);
        throw Error("Document closed");
      }
      this.rasters.set(key, shown);
      while (this.rasters.size > this.maxKept) {
        const [oldest, old] = this.rasters.entries().next().value;
        this.rasters.delete(oldest);
        this.release(old);
      }
      return shown;
    });
    this.drawing.set(key, job);
    try { return await job; } finally { this.drawing.delete(key); this.wants.delete(key); }
  }
  // Page rasters are drawn one after another, with a turn of the event loop between them:
  // several pages asked for at once (scrolling stopped, a zoom ended) drew interleaved, and
  // their pieces landed in the same long task (250 ms and more at tablet speed).
  oneAtATime(work) {
    const run = (this.turn || Promise.resolve()).then(() => new Promise((resolve) => setTimeout(resolve, 0))).then(async () => {
      const done = lagLog.begin("drawing a PDF page");
      try { return await work(); } finally { done(); }
    });
    this.turn = run.catch(() => { /* The next one still runs. */ });
    return run;
  }
  // A part of the PDF page (regionTarget) as a still canvas, or a PNG blob: URL with
  // kind "url"; never cached: the caller owns it and drops it when the view moves on.
  region(background, cssWidth, box, settings, kind = "canvas", wanted = null) {
    return this.oneAtATime(() => {
      if (wanted && !wanted()) throw Error("No longer shown");
      return this.drawRegion(background, cssWidth, box, settings, kind);
    });
  }
  async drawRegion(background, cssWidth, box, settings, kind) {
    const doc = await this.document(background.resource_id);
    const page = await doc.getPage(background.page_index + 1);
    const canvas = document.createElement("canvas");
    let shown;
    try {
      const target = regionTarget(page.getViewport({ scale: 1 }), cssWidth, box, undefined, settings);
      const viewport = page.getViewport({ scale: target.scale, offsetX: -target.left, offsetY: -target.top });
      canvas.width = target.width;
      canvas.height = target.height;
      await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
      shown = kind === "url" ? URL.createObjectURL(await pngOf(canvas)) : await settled(canvas);
      if (this.closed) throw Error("Document closed");
      return { raster: shown, box: target.box };
    } catch (error) {
      if (typeof shown === "string") URL.revokeObjectURL(shown);
      else if (shown && shown !== canvas) wipe(shown);
      throw error;
    } finally {
      if (shown !== canvas) canvas.width = canvas.height = 0;
      page.cleanup();
    }
  }
  // A raster no longer shown: freed, unless it is kept or still on a page.
  release(raster) {
    if (!raster) return;
    for (const kept of this.rasters.values()) if (kept === raster) return;
    if (typeof raster === "string") {
      if (!raster.startsWith("blob:") || globalThis.document?.querySelector?.(`image[href="${raster}"]`)) return;
      URL.revokeObjectURL(raster);
    } else if (!raster.isConnected) {
      wipe(raster);
    }
  }
  // Quality changed: every raster is drawn again.
  clear() {
    this.images.clear();
    const old = [...this.rasters.values()];
    this.rasters.clear();
    for (const raster of old) this.release(raster);
  }
  async document(id) {
    if (!this.documents.has(id))
      this.documents.set(
        id,
        (async () => {
          const data = await this.read(id);
          if (this.closed) throw Error("Document closed");
          const doc = await openPdf(data);
          if (this.closed) {
            await doc.loadingTask.destroy();
            throw Error("Document closed");
          }
          return doc;
        })(),
      );
    return this.documents.get(id);
  }
  // A background's PDF page and an empty canvas of the size it is drawn at for
  // `displayWidth`. The caller renders, then frees the canvas and calls page.cleanup().
  async blankCanvas(background, displayWidth, settings) {
    const doc = await this.document(background.resource_id);
    const page = await doc.getPage(background.page_index + 1);
    const target = rasterTarget(page.getViewport({ scale: 1 }), displayWidth, undefined, settings);
    const viewport = page.getViewport({ scale: target.scale });
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    return { page, target, viewport, canvas };
  }
  async image(background, size, displayWidth = size[0], settings) {
    const key = JSON.stringify([background, size, Math.ceil(displayWidth), settings]);
    // Least recently used goes first: the page being written on asks for its thumbnail's
    // PDF again after every pause and stays, however many thumbnails scrolling has made.
    if (this.images.has(key)) {
      const url = this.images.get(key);
      this.images.delete(key);
      this.images.set(key, url);
      return url;
    }
    const { page, viewport, canvas } = await this.blankCanvas(background, displayWidth, settings);
    try {
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      const url = canvas.toDataURL("image/png");
      if (!this.closed) {
        this.images.set(key, url);
        if (this.images.size > 6)
          this.images.delete(this.images.keys().next().value);
      }
      return url;
    } finally {
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  }
  // The PDF page's own text, for search; pages without a text layer return [].
  async words(background, size) {
    const doc = await this.document(background.resource_id);
    const page = await doc.getPage(background.page_index + 1);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      // Spaced-out titles need where each glyph is drawn (textWords); only pages with one
      // read their operator list.
      let glyphs = null;
      if (pdfjs?.OPS && content.items.some((item) => typeof item.str === "string" && letterSpaced(item.str))) {
        try {
          const ops = await page.getOperatorList();
          glyphs = textGlyphs(ops, pdfjs.OPS, (name) => page.commonObjs.has(name) ? page.commonObjs.get(name) : null);
        } catch { glyphs = null; }
      }
      return textWords(content.items, viewport, backgroundPlacement(background, size), textMeasure(), content.styles, glyphs);
    } finally { page.cleanup(); }
  }
  close() {
    this.closed = true;
    this.clear();
    for (const task of this.documents.values())
      task.then((d) => d.loadingTask.destroy()).catch(() => { /* Optional. */ });
    this.documents.clear();
  }
}
