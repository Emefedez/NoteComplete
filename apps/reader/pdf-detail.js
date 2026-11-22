// Fast zoom sharpening (Display quality; quality.js loadZoomDetail). A zoomed PDF page keeps
// its raster at most window-wide, and the part of it on screen (with a margin) is drawn again
// at the zoomed resolution, as a canvas: a few megapixels instead of a whole page.
// app.js wires it in with pdfDetail(); `app` gives the open note and the display settings.
import { backgroundPlacement } from "./pdf-background.js";

export function pdfDetail({ $, INK_HEAVY, ns, placeRaster, app }) {
  // Fast zoom sharpening (Display quality; quality.js loadZoomDetail). A zoomed PDF page keeps
  // its raster at most window-wide, which zooming in never has to wait for, and the part of it on
  // screen (with a margin) is drawn again at the zoomed resolution: a few megapixels instead of a
  // whole page at up to 24, and as a canvas, where a whole zoomed page is too large for many
  // Android GPUs and goes through a PNG first. Redrawn when a pan or zoom pauses, and every
  // DETAIL_PAN_MS during a long pan.
  const DETAIL_PAUSE_MS = 90, DETAIL_PAN_MS = 350, DETAIL_MARGIN = 0.15;
  let detailTimer = 0, detailDue = 0, detailBusy = false, detailAgain = false;
  const rasterWidthFor = (width) => (app.zoomDetail ? Math.min(width, Math.max(1, $("viewport").clientWidth)) : width);
  // After a zoom step the sharp part waits longer, also when a scroll asks for it meanwhile.
  const ZOOM_DETAIL_PAUSE_MS = 220;
  let zoomHoldUntil = 0;
  function scheduleDetail(pause = DETAIL_PAUSE_MS) {
    if (!app.zoomDetail || !app.doc) return;
    const now = performance.now();
    if (pause > DETAIL_PAUSE_MS) zoomHoldUntil = now + pause;
    detailDue ||= now + DETAIL_PAN_MS;
    clearTimeout(detailTimer);
    detailTimer = setTimeout(drawDetail, Math.max(0, Math.min(pause, detailDue - now), zoomHoldUntil - now));
  }
  async function drawDetail() {
    detailDue = 0;
    if (detailBusy) { detailAgain = true; return; }
    detailBusy = true;
    try {
      // Nearest the middle of the window first: a long pan shows those sooner.
      const middle = $("viewport").getBoundingClientRect(), y = (middle.top + middle.bottom) / 2;
      const order = app.panels.filter((p) => p.near).sort((a, b) => {
        const ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
        return Math.abs((ra.top + ra.bottom) / 2 - y) - Math.abs((rb.top + rb.bottom) / 2 - y);
      });
      for (const p of app.panels) if (!p.near) dropDetail(p);
      for (const p of order) {
        // A pinch scales the pages with a transform; its end (setZoom) asks again.
        if (app.pinch || !app.zoomDetail) break;
        await drawPageDetail(p).catch(() => { /* The page raster stays. */ });
      }
    } finally {
      detailBusy = false;
      if (detailAgain) { detailAgain = false; scheduleDetail(); }
    }
  }
  const pageDetail = (p) => p.render?.querySelector(":scope > .pdf-detail, [data-background] > .pdf-detail");
  function dropDetail(p) {
    const old = pageDetail(p);
    if (!old) return;
    old.remove();
    if (old.localName === "image") URL.revokeObjectURL(old.getAttribute("href"));
  }
  // The part of the window over the PDF's rectangle, as fractions of that rectangle.
  function detailBox(pdf, view, margin) {
    const mx = view.width * margin, my = view.height * margin;
    return [
      (Math.max(view.left - mx, pdf.left) - pdf.left) / pdf.width,
      (Math.max(view.top - my, pdf.top) - pdf.top) / pdf.height,
      (Math.min(view.right + mx, pdf.left + pdf.width) - pdf.left) / pdf.width,
      (Math.min(view.bottom + my, pdf.top + pdf.height) - pdf.top) / pdf.height,
    ];
  }
  async function drawPageDetail(p) {
    const background = p.view?.pdf_background, render = p.render;
    if (!background || !render || p.loading || !p.pdfReady) return;
    const width = p.el.clientWidth;
    if (width <= rasterWidthFor(width) * 1.05) return dropDetail(p);
    const place = backgroundPlacement(background, p.size);
    const r = p.el.getBoundingClientRect(), view = $("viewport").getBoundingClientRect();
    const kx = r.width / p.size[0], ky = r.height / p.size[1];
    const pdf = { left: r.left + place.x * kx, top: r.top + place.y * ky, width: place.width * kx, height: place.height * ky };
    const seen = detailBox(pdf, view, 0);
    if (seen[2] <= seen[0] || seen[3] <= seen[1]) return dropDetail(p);
    const key = JSON.stringify([background, width, app.displayQuality, globalThis.devicePixelRatio || 1]);
    const have = pageDetail(p)?.detail;
    if (have?.key === key && have.box[0] <= seen[0] + 1e-3 && have.box[1] <= seen[1] + 1e-3 && have.box[2] >= seen[2] - 1e-3 && have.box[3] >= seen[3] - 1e-3) return;
    // Under an SVG with its own paper (a picture-backed page, much ink) only a picture shows.
    const kind = render.dataset.paper && !(p.inkItems > INK_HEAVY) ? "canvas" : "url";
    const tile = await app.backgrounds.region(background, pdf.width, detailBox(pdf, view, DETAIL_MARGIN), app.displayQuality, kind, () => p.render === render && render.isConnected && p.near);
    if (p.render !== render || !render.isConnected || p.el.clientWidth !== width || !app.zoomDetail) {
      if (typeof tile.raster === "string") URL.revokeObjectURL(tile.raster);
      return;
    }
    const [x0, y0, x1, y1] = tile.box;
    const at = { x: place.x + x0 * place.width, y: place.y + y0 * place.height, width: (x1 - x0) * place.width, height: (y1 - y0) * place.height };
    let el;
    if (typeof tile.raster === "string") {
      el = pdfImage(tile.raster, at);
      el.classList.add("pdf-detail");
    } else {
      el = placeRaster(tile.raster, at, p.size);
      el.className = "pdf-detail";
    }
    el.detail = { key, box: tile.box };
    dropDetail(p);
    if (el.localName === "image") render.querySelector("[data-background]")?.append(el);
    else render.querySelector(":scope > svg")?.before(el);
  }
  function pdfImage(href, place) {
    const el = document.createElementNS(ns, "image");
    for (const [k, v] of Object.entries({ href, x: place.x, y: place.y, width: place.width, height: place.height, preserveAspectRatio: "none" }))
      el.setAttribute(k, v);
    return el;
  }
  return { ZOOM_DETAIL_PAUSE_MS, dropDetail, pdfImage, rasterWidthFor, scheduleDetail };
}
