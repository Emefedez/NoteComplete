// Page views the engine has answered, kept while the note stays as it was, so a page that
// scrolls out of the preload band and back (or is jumped to again) is drawn without asking
// the worker to build its SVG, serialize it and copy it over once more. On a tablet a page
// with thousands of strokes or prefab parts took most of its time there.
//
// Any operation that may change the note (every one the worker does not list as a read)
// empties the cache before it is sent, and a view asked before such an operation is not
// kept when it arrives after it. Bounded by entries and by the SVG text held.

// The worker's reads (worker.js READS): operations that leave the note as it is.
// view-cache.test.mjs checks that both lists stay the same.
export const READS = new Set(["view", "copyItems", "save", "projectBreakdown", "exportFilteredProject", "pick", "pickLock", "pickTimed", "selection", "getMarkdown", "exportMarkdown", "exportNotecomplete", "export", "contentDigest", "audio", "pdf", "pdfResources", "digest", "historyMark", "prefixDigest", "compactPreview", "markdownHtml", "dialect", "composePreview", "md5", "jpegPagesPdf", "composeNoteFile", "createPdfNoteWithTapes", "extractNoteSummary", "extractNotePdf", "getExam", "setExam", "getChinese", "setChinese", "saveFile", "pdfBlocks", "pdfWithout", "pdfIsolate", "pdfFont", "pdfFontMissing", "pdfEditClose"]);

export class ViewCache {
  constructor({ maxEntries = 24, maxChars = 12_000_000 } = {}) {
    this.maxEntries = maxEntries;
    this.maxChars = maxChars;
    // Page index -> view, oldest first (a Map keeps insertion order).
    this.views = new Map();
    this.chars = 0;
    // Moves on with every operation that may change the note.
    this.generation = 0;
  }
  // Before an operation is sent to the engine.
  sending(op) {
    if (!READS.has(op)) this.clear();
  }
  clear() {
    this.generation++;
    this.views.clear();
    this.chars = 0;
  }
  get(page) {
    const view = this.views.get(page);
    if (!view) return null;
    // Most recently used last.
    this.views.delete(page);
    this.views.set(page, view);
    return view;
  }
  // `generation`: the cache's generation when the view was asked for.
  put(page, view, generation) {
    if (generation !== this.generation || !view || typeof view.svg !== "string") return;
    const size = view.svg.length;
    if (size > this.maxChars) return;
    this.drop(page);
    this.views.set(page, view);
    this.chars += size;
    for (const [oldest, old] of this.views) {
      if (this.views.size <= this.maxEntries && this.chars <= this.maxChars) break;
      this.views.delete(oldest);
      this.chars -= old.svg.length;
    }
  }
  drop(page) {
    const old = this.views.get(page);
    if (!old) return;
    this.views.delete(page);
    this.chars -= old.svg.length;
  }
  setMaxEntries(count) {
    this.maxEntries = count;
    for (const [oldest, old] of this.views) {
      if (this.views.size <= this.maxEntries) break;
      this.views.delete(oldest);
      this.chars -= old.svg.length;
    }
  }
}
