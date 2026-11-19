import init, { EditorSession, markdown_html, markdown_export, jpeg_pages_pdf, md5_hex, notecomplete_audio, compose_preview, handwriting_dialect, compose_note_file, create_pdf_note_with_tapes, is_project_archive, project_archive_from_json, extract_note_summary, extract_note_pdf } from "./pkg/noteful_wasm.js";
const ready = init();
// The notebook importer (pkg/import), loaded the first time a notebook is opened.
let importer = null;
async function importModule() {
  importer ||= import("./pkg/import/noteful_import_wasm.js").then(async (m) => { await m.default(); return m; });
  return importer.catch((e) => { importer = null; throw e; });
}
async function convertNotebook(name, bytes) {
  const m = await importModule();
  const format = m.notebook_format(bytes);
  if (!format) throw Error("This is not a Goodnotes or Notability notebook.");
  const noteful = m.convert_notebook(name, bytes);
  return { noteful, format, warnings: JSON.parse(m.notebook_warnings()) };
}
let session;
// Another note, or none: the PDF kept for Edit PDF belonged to the last one (ids repeat across
// notes, "imported-pdf").
function forgetPdf() {
  importer?.then((m) => m.pdf_edit_close()).catch(() => { /* Not loaded. */ });
}
// The importer with the PDF `resource` of the open note read (Edit PDF mode).
async function pdfEditing(resource) {
  const m = await importModule();
  if (!m.pdf_edit_has(resource)) m.pdf_edit_open(resource, session.pdf_bytes(resource));
  return m;
}
ready
  .then(() => postMessage({ ready: true }))
  .catch((e) => postMessage({ fatal: String(e) }));
// Every operation the reader can ask for, by name. A handler gets the message's arguments
// and its page and returns the reply's result; a name that is not here is answered with an
// error, so a misspelt operation cannot pass for a page view.

// The engine's state has a number, and every operation that may change the note gives it
// the next one. A view says which state it shows (`engine_state`), and a drawn line which
// state it was added to (`base_state`): the reader puts the line into a view it holds only
// when that view shows exactly that state, and asks for the view otherwise. The numbers
// start somewhere else in every worker, so a view from a worker that was replaced
// (engine.js) never passes for one of this worker's.
let state = Math.floor(Math.random() * 2 ** 40);
// Operations that leave the note as it is. Any other, also one that fails, moves the state on.
const READS = new Set(["view", "copyItems", "save", "projectBreakdown", "exportFilteredProject", "pick", "pickLock", "pickTimed", "selection", "getMarkdown", "exportMarkdown", "exportNotecomplete", "export", "contentDigest", "audio", "pdf", "pdfResources", "digest", "historyMark", "prefixDigest", "compactPreview", "markdownHtml", "dialect", "composePreview", "md5", "jpegPagesPdf", "composeNoteFile", "createPdfNoteWithTapes", "extractNoteSummary", "extractNotePdf", "getExam", "setExam", "getChinese", "setChinese", "saveFile", "pdfBlocks", "pdfWithout", "pdfIsolate", "pdfFont", "pdfFontMissing", "pdfEditClose"]);

// The page as it now is: what `view` and every edit but a drawn line answer with.
const view = (page) => Object.assign(JSON.parse(session.view(page)), { engine_state: state });
// An edit: the change, then the page's view after it.
const edit = (change) => (args, page) => { change(args, page); return view(page); };
// Undoing inserted pages can take away the page in view: show the last one left.
const lastPageLeft = (step) => (args, page) => {
  step();
  for (;;) {
    try { return view(page); }
    catch (e) { if (page <= 0) throw e; page--; }
  }
};

// A composed note as the file it is saved as: the v13 archive in place of the project JSON.
const composedFile = (composed) => ({ ...composed, project: project_archive_from_json(composed.project) });

// Operations that need no open document.
const standalone = {
  async open(args) {
    const bytes = new Uint8Array(args.bytes);
    // A Goodnotes or Notability notebook: the importer module makes it a Noteful note first.
    if (args.notebook) args = { ...args, notebook: await convertNotebook(args.name || "Notebook", bytes) };
    let candidate;
    // A v13 .nfedit is a tar like .notecomp: opened, and listed, as the project it is.
    if (args.notecomplete && is_project_archive(bytes)) { args = { ...args, notecomplete: false, project: true }; }
    try {
      candidate = args.notecomplete
        ? EditorSession.open_notecomplete(bytes)
        : args.markdown != null
        ? EditorSession.create_handwritten(args.title, args.markdown, JSON.stringify(args.options || {}))
        : args.sizes
        ? EditorSession.create_document(
            args.title,
            JSON.stringify(args.sizes),
            bytes,
          )
        : args.notebook
          ? EditorSession.open_imported(args.notebook.noteful, args.notebook.format, args.name || "Notebook", bytes)
        : args.project
          ? EditorSession.load_project_bytes(bytes)
          : new EditorSession(bytes);
      if (args.canvas) candidate.set_canvas(true);
      if (args.image) candidate.add_image(0, JSON.stringify(args.image));
      const result = Object.assign(JSON.parse(candidate.view(0)), { engine_state: state });
      // A Goodnotes or Notability notebook: what could not be brought over, and where it came from.
      if (args.notebook) result.import_warnings = args.notebook.warnings;
      const origin = JSON.parse(candidate.origin_json());
      if (origin) result.origin = origin;
      // Recordings added in NoteComplete travel inside .notecomp files.
      if (args.notecomplete)
        result.added_audio = JSON.parse(notecomplete_audio(bytes)).map(({ offset, length, ...audio }) => ({ ...audio, bytes: bytes.slice(offset, offset + length) }));
      // Study sets, embedded exam HTML, and added audio travel inside .nfedit projects.
      if (args.project) {
        const study = JSON.parse(candidate.study());
        if (study.decks?.length || study.quizzes?.length || study.scratch?.length) result.study = study;
        const exam = JSON.parse(candidate.exam());
        if (exam?.html || exam?.source) result.has_exam = true;
        const addedMeta = JSON.parse(candidate.project_added_audio_meta());
        if (addedMeta.length) {
          result.added_audio = addedMeta.map((meta, i) => ({ ...meta, bytes: candidate.project_added_audio_bytes(i) }));
        }
      }
      session?.free();
      session = candidate;
      forgetPdf();
      candidate = undefined;
      return result;
    } finally {
      candidate?.free();
    }
  },
  markdownHtml: (args) => markdown_html(args.text),
  dialect: () => handwriting_dialect(),
  // The document was closed in the reader: release its archive and scene now.
  close() {
    session?.free();
    session = undefined;
    forgetPdf();
    return true;
  },
  // Handwriting preview of Markdown; needs no open document.
  composePreview: (args) => JSON.parse(compose_preview(args.markdown, JSON.stringify(args.options || {}), args.max || 3)),
  composeNoteFile: (args) => composedFile(JSON.parse(compose_note_file(args.title || "Untitled note", args.markdown || "", JSON.stringify(args.options || {}), args.exam ? JSON.stringify(args.exam) : undefined))),
  createPdfNoteWithTapes: (args) => project_archive_from_json(create_pdf_note_with_tapes(args.title || "Exam", JSON.stringify(args.sizes || []), new Uint8Array(args.pdf || []), JSON.stringify(args.tapes || []), args.exam ? JSON.stringify(args.exam) : undefined)),
  extractNoteSummary: (args) => JSON.parse(extract_note_summary(new Uint8Array(args.bytes || []), args.maxPages || 0)),
  extractNotePdf: (args) => extract_note_pdf(new Uint8Array(args.bytes || []), args.pdfId || ""),
  md5: (args) => md5_hex(new Uint8Array(args.bytes)),
  jpegPagesPdf: (args) => jpeg_pages_pdf(args.data, args.layout, args.title),
};

// Operations on the open document.
const onDocument = {
  view: (args, page) => view(page),
  save(args) {
    if (args.audioData !== undefined || args.audioLayout !== undefined) {
      session.set_added_audio(new Uint8Array(args.audioData || []), args.audioLayout || "");
    }
    return session.save_project();
  },
  // What a .nfedit file holds (a v13 archive); `save` stays the JSON form for auto-save copies.
  saveFile(args) {
    if (args.audioData !== undefined || args.audioLayout !== undefined) {
      session.set_added_audio(new Uint8Array(args.audioData || []), args.audioLayout || "");
    }
    return session.save_project_archive();
  },
  projectBreakdown(args) {
    if (args.audioData !== undefined || args.audioLayout !== undefined) {
      session.set_added_audio(new Uint8Array(args.audioData || []), args.audioLayout || "");
    }
    return JSON.parse(session.project_breakdown());
  },
  exportFilteredProject(args) {
    if (args.audioData !== undefined || args.audioLayout !== undefined) {
      session.set_added_audio(new Uint8Array(args.audioData || []), args.audioLayout || "");
    }
    return session.export_filtered_project_archive(JSON.stringify(args.options || {}));
  },
  pick: (args, page) => JSON.parse(session.pick_item(page, args.x, args.y, args.tolerance)),
  pickLock: (args, page) => JSON.parse(session.pick_lockable(page, args.x, args.y, args.tolerance)),
  pickTimed: (args, page) => JSON.parse(session.pick_timed(page, args.x, args.y, args.tolerance)),
  selection: (args, page) => JSON.parse(session.selection(page, args.itemId)),
  copyItems: (args, page) => JSON.parse(session.copy_items(page, JSON.stringify(args.ids))),
  crop: (args, page) => JSON.parse(session.crop_item(page, args.itemId, JSON.stringify(args.rect))),
  adjust: (args, page) => JSON.parse(session.adjust_item(page, args.itemId, JSON.stringify(args.adjustment))),
  // Markdown notes: kept in the session (saved with projects and .notecomplete).
  getMarkdown: () => session.markdown(),
  setMarkdown(args) {
    session.set_markdown(args.text);
    return session.markdown();
  },
  exportMarkdown: (args) => markdown_export(session.markdown(), args.title || ""),
  exportNotecomplete: (args) => session.export_notecomplete(new Uint8Array(args.audioData || []), args.audioLayout || ""),
  export: () => session.export_noteful(),
  contentDigest: () => session.content_digest(),
  audio: (args) => session.audio_bytes(args.resource),
  pdf: (args) => session.pdf_bytes(args.resource),
  pdfResources: () => JSON.parse(session.pdf_resources()),
  // Edit PDF mode (pdf-edit.js, docs/PDF-EDITOR.md), in the importer module: the PDF resource
  // is read there once and kept while its pages are asked about.
  async pdfBlocks(args) {
    const m = await pdfEditing(args.resource);
    return JSON.parse(m.pdf_edit_blocks(args.resource, args.pageIndex));
  },
  async pdfWithout(args) {
    const m = await pdfEditing(args.resource);
    return m.pdf_edit_without(args.resource, args.pageIndex, JSON.stringify(args.ops || []), JSON.stringify(args.annots || []));
  },
  async pdfIsolate(args) {
    const m = await pdfEditing(args.resource);
    return m.pdf_edit_isolate(args.resource, args.pageIndex, JSON.stringify(args.ops || []), JSON.stringify(args.annots || []));
  },
  async pdfFont(args) {
    const m = await pdfEditing(args.resource);
    return m.pdf_edit_font(args.resource, args.pageIndex ?? 0, args.hash);
  },
  async pdfFontMissing(args) {
    const m = await pdfEditing(args.resource);
    return m.pdf_edit_font_missing(args.resource, args.hash, args.text);
  },
  async pdfEditClose() {
    if (importer) (await importModule()).pdf_edit_close();
    return true;
  },
  recognized(args) {
    session.set_recognized_text(JSON.stringify(args.pages || {}));
    return true;
  },
  getStudy: () => JSON.parse(session.study()),
  study(args) {
    session.set_study(JSON.stringify(args.study || {}));
    return true;
  },
  // Chinese mode settings kept in the note (chinese/ruby.js; docs/CHINESE-INPUT.md §9).
  getChinese: () => JSON.parse(session.chinese()),
  setChinese(args) {
    session.set_chinese(JSON.stringify(args.chinese || {}));
    return true;
  },
  getExam: () => JSON.parse(session.exam()),
  setExam(args) {
    session.set_exam(JSON.stringify(args.exam || {}));
    return true;
  },
  digest: () => session.history_digest(),
  historyMark: () => JSON.parse(session.history_mark()),
  prefixDigest: (args) => session.prefix_digest(args.edits),
  // The history compacted up to `upto` edits: the report, with the page view after it.
  compactPreview: (args) => JSON.parse(session.compact_preview(args.upto)),
  compactHistory(args, page) {
    const report = JSON.parse(session.compact_history(args.upto));
    return { report, view: view(page) };
  },

  remove: edit((args, page) => session.remove_item(page, args.itemId)),
  lock: edit((args, page) => session.set_locked(page, args.itemId, args.locked)),
  resizePage: edit((args, page) => session.resize_page(page, args.size[0], args.size[1], args.pdfRect ? JSON.stringify(args.pdfRect) : undefined)),
  resizePages: edit((args) => session.resize_pages(JSON.stringify(args.pages.map((p) => ({ page: p.page, size: p.size, pdf_rect: p.pdfRect || null }))))),
  editText: edit((args, page) => session.edit_text(page, args.itemId, JSON.stringify(args.text), args.width, args.height)),
  resize: edit((args, page) => session.resize_shape(page, args.shapeId, JSON.stringify(args.shape))),
  layer: edit((args) => session.set_layer(JSON.stringify(args.layer))),
  reorderLayers: edit((args) => session.reorder_layers(JSON.stringify(args.order))),
  // A line answers with itself alone (`drawn`: the new item and the few fields of the view
  // that change), not with the page: the reader adds it to the view it holds
  // (draw-patch.js), or asks for the view when it holds none of the state before.
  draw(args, page) {
    const drawn = JSON.parse(session.draw(page, JSON.stringify(args.line)));
    // A shape recognised at an angle (shape-recognize.js) is added level, then turned about
    // its centre in the same step: one undo removes both, and every copy in a sharing
    // session does the same, since the op travels with its arguments.
    if (Number.isFinite(args.turn) && args.turn) {
      session.adjust_item(page, drawn.id, JSON.stringify({ translation: [0, 0], scale: [1, 1], rotation: args.turn, joined: true }));
      return view(page);
    }
    // Without `item` the page changed by more than the line (a canvas that grew).
    return drawn.item ? { drawn: { ...drawn, base_state: state - 1, engine_state: state } } : view(page);
  },
  image: edit((args, page) => session.add_image(page, JSON.stringify(args.image))),
  // Several lines, then typed text boxes, as one undo step (graph.js: an inserted graph).
  drawMany: edit((args, page) => {
    // `replace`: the items of a graph or table drawn again, removed first in the same step.
    let first = true;
    if (Array.isArray(args.replace) && args.replace.length) { session.remove_items(page, JSON.stringify(args.replace), false); first = false; }
    // `cut`: items taken from another page in the same step (moved there, or cut and pasted).
    if (args.cut && Array.isArray(args.cut.ids) && args.cut.ids.length) { session.remove_items(args.cut.page, JSON.stringify(args.cut.ids), !first); first = false; }
    for (const line of args.lines || []) { session.draw(page, JSON.stringify({ ...line, joined: !first })); first = false; }
    for (const image of args.images || []) { session.add_image(page, JSON.stringify({ ...image, joined: !first })); first = false; }
  }),
  erase: edit((args, page) => session.erase(page, JSON.stringify(args.points), args.radius)),
  insertHandwritten: edit((args) => session.insert_handwritten(args.at, args.markdown, JSON.stringify(args.options || {}))),
  insertPages: edit((args) => session.insert_pages(args.at, JSON.stringify(args.pages), args.pdf ? JSON.stringify(args.pdf) : undefined)),
  setPageBackgrounds: edit((args) => session.set_page_backgrounds(JSON.stringify(args.pages), args.pdf ? JSON.stringify(args.pdf) : undefined)),
  // Edit PDF: a page's PDF without the converted text, then the text boxes that replace it,
  // as one undo step.
  replacePdfText: edit((args, page) => {
    session.set_page_backgrounds(JSON.stringify(args.pages), JSON.stringify(args.pdf));
    for (const image of args.images || []) session.add_image(page, JSON.stringify({ ...image, joined: true }));
  }),
  movePage: edit((args) => session.move_page(args.from, args.to)),
  deleteAudio: edit((args) => session.delete_audio(args.assetId)),
  stripAudioMedia: edit((args) => session.strip_audio_media(args.assetId)),
  undo: lastPageLeft(() => session.undo()),
  redo: lastPageLeft(() => session.redo()),
};

// Replies that are bytes made for this message: their buffer is handed over, not copied.
const TRANSFERRED = new Set(["jpegPagesPdf", "exportNotecomplete", "export", "audio", "pdf", "pdfWithout", "pdfIsolate", "pdfFont"]);

self.onmessage = async ({ data: { id, op, page = 0, ...args } }) => {
  try {
    await ready;
    const needsDocument = !Object.hasOwn(standalone, op);
    if (needsDocument && !Object.hasOwn(onDocument, op)) throw Error(`Unknown engine operation: ${op}`);
    if (needsDocument && !session) throw Error("Open a document first.");
    if (!READS.has(op)) state++;
    const result = await (needsDocument ? onDocument : standalone)[op](args, page);
    postMessage({ id, result }, TRANSFERRED.has(op) ? [result.buffer] : []);
  } catch (e) {
    postMessage({ id, error: String(e) });
  }
};
