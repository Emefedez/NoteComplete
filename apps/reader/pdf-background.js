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
  close() {
    this.closed = true;
    this.images.clear();
    for (const task of this.documents.values())
      task.then((d) => d.loadingTask.destroy()).catch(() => {});
    this.documents.clear();
  }
}
