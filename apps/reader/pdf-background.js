// Rasterize only the visible embedded PDF page. Ink stays editable SVG above it.
import { normalizeQuality } from "./quality.js";
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
    await task.destroy().catch(() => {});
    throw error;
  }
}

// Keep raster output sharp when a page is shown wider than its PDF user units.
// The cache is keyed by the resulting pixel size so zooming can request a
// higher-resolution image without reusing a blurry fit-width raster.
export function rasterTarget(original, cssWidth, pixelRatio = globalThis.devicePixelRatio || 1, settings) {
  const prefs = settings ? normalizeQuality(settings) : null;
  const quality = prefs?.scale ?? Math.max(2, Math.min(Number(pixelRatio) || 1, 3));
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

const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
// Words of a pdf.js text layer with boxes in page units. Each item is mapped
// through the viewport (rotation included), split at spaces with widths shared
// by character count, then placed through the page's PDF rect.
export function textWords(items, viewport, place) {
  const out = [];
  const sx = place.width / viewport.width, sy = place.height / viewport.height;
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const t = multiply(viewport.transform, item.transform);
    const length = Math.hypot(t[0], t[1]) || 1, width = (item.width || 0) * viewport.scale;
    const dir = [t[0] / length, t[1] / length], up = [t[2], t[3]];
    for (const match of item.str.matchAll(/\S+/g)) {
      const a = width * match.index / item.str.length, b = width * (match.index + match[0].length) / item.str.length;
      const corners = [a, b].flatMap(d => {
        const base = [t[4] + dir[0] * d, t[5] + dir[1] * d];
        return [base, [base[0] + up[0], base[1] + up[1]]];
      });
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      out.push({ text: match[0], box: [place.x + x0 * sx, place.y + y0 * sy, (Math.max(...xs) - x0) * sx, (Math.max(...ys) - y0) * sy] });
    }
  }
  return out;
}

// Where the PDF page sits on its Noteful page. Widened pages keep the PDF at
// native scale in `rect`; older cores without it fill the whole page.
export function backgroundPlacement(background, size) {
  const [x, y, width, height] = background?.rect ?? [0, 0, size[0], size[1]];
  return { x, y, width, height, share: width / size[0] };
}

export class PdfBackgrounds {
  constructor(read) {
    this.read = read;
    this.documents = new Map();
    this.images = new Map();
    this.closed = false;
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
  async image(background, size, displayWidth = size[0], settings) {
    const key = JSON.stringify([background, size, Math.ceil(displayWidth), settings]);
    if (this.images.has(key)) return this.images.get(key);
    const doc = await this.document(background.resource_id);
    const page = await doc.getPage(background.page_index + 1);
    const original = page.getViewport({ scale: 1 });
    const target = rasterTarget(original, displayWidth, undefined, settings);
    const viewport = page.getViewport({ scale: target.scale });
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    try {
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      const url = canvas.toDataURL("image/png");
      if (!this.closed) {
        this.images.set(key, url);
        if (this.images.size > 3)
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
      return textWords(content.items, viewport, backgroundPlacement(background, size));
    } finally { page.cleanup(); }
  }
  close() {
    this.closed = true;
    this.images.clear();
    for (const task of this.documents.values())
      task.then((d) => d.loadingTask.destroy()).catch(() => {});
    this.documents.clear();
  }
}
