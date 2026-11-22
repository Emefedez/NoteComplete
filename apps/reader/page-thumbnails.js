// Thumbnails in the page list: drawn one at a time, top first, each as soon as it is ready;
// redrawn once the pen has paused (not after every stroke) and only for pages whose own
// content changed. Also which page the list marks as current.
// app.js wires it in with pageThumbnails().
import { backgroundPlacement } from "./pdf-background.js";
import { imageReady } from "./image-ready.js";

export function pageThumbnails({ call, paintTapes, pdfImage, syncPageMoveMenus, app }) {
  // Thumbnails render one at a time, top first, so each shows as soon as it is ready
  // instead of all of them starting together and finishing together.
  const thumbQueue = new Set();
  let thumbBusy = false;
  function queueThumbnail(panel) { thumbQueue.add(panel); pumpThumbnails(); }
  async function pumpThumbnails() {
    if (thumbBusy) return;
    const next = [...thumbQueue].sort((a, b) => a.index - b.index)[0];
    if (!next) return;
    thumbQueue.delete(next);
    thumbBusy = true;
    try { await renderThumbnail(next); } finally { thumbBusy = false; pumpThumbnails(); }
  }
  async function renderThumbnail(panel) {
    if (panel.thumbnailLoading || panel.thumbnailReady || !app.doc) return;
    panel.thumbnailLoading = true;
    const note = app.epoch, edits = pageEdits(panel), cache = app.backgrounds;
    try {
      const result = panel.view || (await call("view", { page: panel.index }));
      if (note !== app.epoch) return;
      const render = document.createElement("div");
      render.innerHTML = result.svg;
      paintTapes(render, `t${panel.index}`);
      if (result.pdf_background) {
        const thumb = panel.pageButton.querySelector(".page-thumb");
        const width = Math.max(80, thumb?.clientWidth || 128);
        const place = backgroundPlacement(result.pdf_background, panel.size);
        const image = await cache.image(result.pdf_background, panel.size, Math.min(width, 160) * place.share);
        render.querySelector("[data-background]")?.append(pdfImage(image, place));
      }
      const source = render.querySelector(":scope > svg");
      const target = panel.pageButton.querySelector(".page-thumb");
      if (source && target) {
        // Store a small bitmap, never a duplicate page SVG or full-resolution PDF.
        const width = 256, height = Math.max(1, Math.round(width * panel.size[1] / panel.size[0]));
        source.setAttribute("width", width);
        source.setAttribute("height", height);
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(source)], { type: "image/svg+xml" }));
        const image = new Image();
        try {
          await imageReady(image, url);
          if (note !== app.epoch || edits !== pageEdits(panel)) return;
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(image, 0, 0, width, height);
          // Encoded off the main thread (toDataURL would stall it while writing).
          const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
          canvas.width = canvas.height = 0;
          if (!blob || note !== app.epoch || edits !== pageEdits(panel)) return;
          const preview = new Image();
          preview.alt = "";
          preview.src = URL.createObjectURL(blob);
          if (panel.thumbUrl) URL.revokeObjectURL(panel.thumbUrl);
          panel.thumbUrl = preview.src;
          target.replaceChildren(preview);
        } finally { URL.revokeObjectURL(url); }
        panel.thumbnailReady = true;
        panel.thumbnailEdits = edits;
      }
    } catch {
      // The numbered fallback remains useful if a thumbnail cannot be decoded.
    } finally {
      panel.thumbnailLoading = false;
      // Edited while it was drawn: again once the pen pauses, not at once (it would redraw
      // continuously while writing).
      if (note === app.epoch && edits !== pageEdits(panel)) updatePagePreview(panel, true);
    }
  }
  // A page's thumbnail is redrawn once the pen has paused, not after every stroke: drawing it
  // (the page as an image, its PDF background) holds the main thread, and the next stroke's
  // pen events would wait behind it.
  const thumbsDue = new Set();
  let thumbsTimer = 0;
  function refreshThumbnailsSoon() { clearTimeout(thumbsTimer); thumbsTimer = setTimeout(refreshThumbnails, 1200); }
  // Edits made to each page (showEdit), so a thumbnail is redrawn when its own page changed,
  // not because the note did: an edit anywhere used to redraw every page's thumbnail as it
  // was scrolled past, and pages never shown in the panel got one drawn too.
  const pageEdits = (panel) => panel.edits || 0;
  function updatePagePreview(panel, drawing = false) {
    // Thumbnails not drawn yet are drawn when they come into view in the panel.
    if (!(panel.thumbnailReady || drawing) || panel.thumbnailEdits === pageEdits(panel)) return;
    thumbsDue.add(panel);
    clearTimeout(thumbsTimer);
    thumbsTimer = setTimeout(refreshThumbnails, 1200);
  }
  function refreshThumbnails() {
    if (app.gesture || app.mutationPending > 0) { thumbsTimer = setTimeout(refreshThumbnails, 600); return; }
    const due = [...thumbsDue];
    thumbsDue.clear();
    for (const panel of due) {
      if (!app.panels.includes(panel) || panel.thumbnailEdits === pageEdits(panel)) continue;
      panel.thumbnailReady = false;
      queueThumbnail(panel);
    }
  }
  let markedPage = -1;
  function markPage() {
    app.panels[markedPage]?.pageButton?.removeAttribute("aria-current");
    // The list can be rebuilt: clear stray marks only then.
    if (markedPage < 0) for (const panel of app.panels) panel.pageButton?.removeAttribute("aria-current");
    app.panels[app.page]?.pageButton?.setAttribute("aria-current", "page");
    markedPage = app.page;
    syncPageMoveMenus();
  }
  return { markPage, pageEdits, queueThumbnail, refreshThumbnailsSoon, thumbQueue, thumbsDue, updatePagePreview };
}
