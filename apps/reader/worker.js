import init, { EditorSession, markdown_html, markdown_export, jpeg_pages_pdf, md5_hex, notecomplete_audio, compose_preview, handwriting_dialect } from "./pkg/noteful_wasm.js";
const ready = init();
let session;
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
const READS = new Set(["view", "save", "pick", "pickLock", "selection", "getMarkdown", "exportMarkdown", "exportNotecomplete", "export", "audio", "pdf", "digest", "historyMark", "prefixDigest", "compactPreview", "markdownHtml", "dialect", "composePreview", "md5", "jpegPagesPdf"]);

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

// Operations that need no open document.
const standalone = {
  open(args) {
    const bytes = new Uint8Array(args.bytes);
    let candidate;
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
        : args.project
          ? EditorSession.load_project(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            )
          : new EditorSession(bytes);
      if (args.canvas) candidate.set_canvas(true);
      if (args.image) candidate.add_image(0, JSON.stringify(args.image));
      const result = Object.assign(JSON.parse(candidate.view(0)), { engine_state: state });
      // Recordings added in NoteComplete travel inside .notecomp files.
      if (args.notecomplete)
        result.added_audio = JSON.parse(notecomplete_audio(bytes)).map(({ offset, length, ...audio }) => ({ ...audio, bytes: bytes.slice(offset, offset + length) }));
      session?.free();
      session = candidate;
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
    return true;
  },
  // Handwriting preview of Markdown; needs no open document.
  composePreview: (args) => JSON.parse(compose_preview(args.markdown, JSON.stringify(args.options || {}), args.max || 3)),
  md5: (args) => md5_hex(new Uint8Array(args.bytes)),
  jpegPagesPdf: (args) => jpeg_pages_pdf(args.data, args.layout, args.title),
};

// Operations on the open document.
const onDocument = {
  view: (args, page) => view(page),
  save: () => session.save_project(),
  pick: (args, page) => JSON.parse(session.pick_item(page, args.x, args.y, args.tolerance)),
  pickLock: (args, page) => JSON.parse(session.pick_lockable(page, args.x, args.y, args.tolerance)),
  selection: (args, page) => JSON.parse(session.selection(page, args.itemId)),
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
  audio: (args) => session.audio_bytes(args.resource),
  pdf: (args) => session.pdf_bytes(args.resource),
  recognized(args) {
    session.set_recognized_text(JSON.stringify(args.pages || {}));
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
    for (const line of args.lines || []) { session.draw(page, JSON.stringify({ ...line, joined: !first })); first = false; }
    for (const image of args.images || []) { session.add_image(page, JSON.stringify({ ...image, joined: !first })); first = false; }
  }),
  erase: edit((args, page) => session.erase(page, JSON.stringify(args.points), args.radius)),
  insertHandwritten: edit((args) => session.insert_handwritten(args.at, args.markdown, JSON.stringify(args.options || {}))),
  insertPages: edit((args) => session.insert_pages(args.at, JSON.stringify(args.pages), args.pdf ? JSON.stringify(args.pdf) : undefined)),
  undo: lastPageLeft(() => session.undo()),
  redo: lastPageLeft(() => session.redo()),
};

// Replies that are bytes made for this message: their buffer is handed over, not copied.
const TRANSFERRED = new Set(["jpegPagesPdf", "exportNotecomplete", "export", "audio", "pdf"]);

self.onmessage = async ({ data: { id, op, page = 0, ...args } }) => {
  try {
    await ready;
    const needsDocument = !Object.hasOwn(standalone, op);
    if (needsDocument && !Object.hasOwn(onDocument, op)) throw Error(`Unknown engine operation: ${op}`);
    if (needsDocument && !session) throw Error("Open a document first.");
    if (!READS.has(op)) state++;
    const result = (needsDocument ? onDocument : standalone)[op](args, page);
    postMessage({ id, result }, TRANSFERRED.has(op) ? [result.buffer] : []);
  } catch (e) {
    postMessage({ id, error: String(e) });
  }
};
