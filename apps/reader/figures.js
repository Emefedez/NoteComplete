// Graphs, tables, prefabs and UML diagrams on the page: inserting them (Insert menu, a box
// dragged with the Shapes tool, the math keypad), opening their editors (one at a time),
// placing what an editor returns, editing or resizing one already there, and the window
// of kept exercise references. They are drawn as ordinary items, parts of one object
// (part.rs), so any of it selects all of it. app.js wires it in with figureInserts().
import { rgbaOf } from "./text-box.js";
import { graphItems } from "./graph.js";
import { tableItems, tableNaturalSize } from "./table.js";
import { editorOf, moduleOf } from "./prefab-registry.js";
import { editGraph, editTable } from "./compound-dialogs.js";
import { choosePrefab, editPrefab, notePrefabUsed, prefabAspect, prefabItems, prefabName, prefabPng, prefabSvg } from "./prefabs.js";
import { icon } from "./icons.js";
import { editorKind } from "./chart-model.js";
import { fileKind } from "./media-import.js";
import { sideDocument } from "./side-document.js";
import { entryTitle } from "./library.js";
import { savedUmlView } from "./uml.js";

export function figureInserts({ $, TOOL_DEFAULTS, action, call, canReplace, closeMenus, drawPlantuml, ensureEditableLayer, importImages, library, openBlankNoteForPrefab, pageCanvas, selection, status, textBox, app }) {
  // Graphs and tables (graph.js, table.js, compound-dialogs.js): drawn as ordinary items, parts
  // of one object (part.rs) so that any of it selects all of it and its editor brings back
  // what it is. Insert → Graph or Table, a box dragged with the Shapes tool's Graph or Table,
  // or the math keypad's graph key; Edit graph / Edit table on the selected object.
  const COMPOUND_SIZE = { graph: [420, 300], table: [360, 132] };
  const compoundId = (kind) => `${kind[0]}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const penStyle = () => { const pen = { ...TOOL_DEFAULTS.draw, ...app.toolPrefs.draw }; return { rgba: [...rgbaOf(pen.color).slice(0, 3), 1], width: Number(pen.width) || 2 }; };
  function compoundItems(kind, box, spec, id = compoundId(kind)) {
    return kind === "graph" ? graphItems(box, spec, { ...penStyle(), layer: app.activeLayer, id }) : tableItems(box, spec, { layer: app.activeLayer, id });
  }
  // A box on the page for a new graph or table: centred on `at` (or the middle of the view),
  // inside the page with room for a graph's axis names past its edges.
  function compoundBox(p, kind, box = null, size = COMPOUND_SIZE[kind]) {
    if (box && box[2] >= 40 && box[3] >= 30) return box;
    const [w, h] = [Math.min(size[0], p.size[0] - 60), size[1]];
    let x, y;
    if (box) [x, y] = box;
    else {
      const r = p.el.getBoundingClientRect(), v = $("viewport").getBoundingClientRect();
      y = (((Math.max(r.top, v.top) + Math.min(r.bottom, v.bottom)) / 2 - r.top) / r.height) * p.size[1] - h / 2;
      x = (p.size[0] - w) / 2;
    }
    return [Math.max(20, Math.min(x, p.size[0] - w - 40)), Math.max(30, Math.min(y, p.size[1] - h - 30)), w, h];
  }
  // The editor for a new graph or table, then the object in `box` (one undo step).
  // If no document is open, edits first and opens a fresh note once accepted.
  async function insertCompound(p, kind, box = null, spec = {}) {
    const startedEmpty = !app.doc;
    if (startedEmpty ? !canReplace() : (!p || !ensureEditableLayer())) return false;
    const note = app.epoch;
    const chosen = await oneFigure(() => compoundEditor(kind, spec));
    if (!chosen || !sameNote(note, startedEmpty)) return false;
    if (startedEmpty) {
      p = await openBlankNoteForPrefab(kind === "graph" ? "Graph" : "Table");
      if (!p || !ensureEditableLayer()) return false;
    }
    let items;
    // A table as tall as its rows need (fit rows, a row per line of text), within the page.
    const size = kind === "table" ? ((w, h) => [w, Math.min(h, p.size[1] - 60)])(...tableNaturalSize(chosen)) : undefined;
    try { items = compoundItems(kind, compoundBox(p, kind, box, size), chosen); } catch (e) { return status(e.message, true), false; }
    await action("drawMany", { page: p.index, lines: items.lines, images: items.images });
    status(`${kind === "graph" ? "Graph" : "Table"} inserted. Select it to move it, resize it or edit it again; one undo removes it.`);
    return true;
  }
  // The editor of a graph or table: its module's (prefabs/graph, prefabs/table: a movable window
  // over the page, compound-dialogs.js), or the editor.js of a module put in their place.
  async function compoundEditor(kind, spec = {}, editing = false) {
    const { editor } = editorOf({ module: kind });
    if (editor === "module") return openFigureEditor({ module: kind, ...spec }, { editing });
    return (editor || kind) === "table" ? editTable({ spec, editing }) : editGraph({ spec, editing, rgba: penStyle().rgba, keypad: textBox.mathKeys });
  }
  $("insertGraph").onclick = () => insertPrefab(app.panels[app.page]);
  // Prefabs (prefabs.js): the picker, then a graph or table's own editor, or an exam figure's.
  // `box`: dragged with the Shapes tool's Prefab, or null for the middle of the view.
  // `choice`: a PREFABS entry already chosen (a recent one), or null for the picker.
  // One picker or figure editor at a time: on a slow first load, more taps on Insert prefab (or
  // a card) opened one over another, and the ones under the last were left without a way out.
  let figureOpen = false;
  const figureIsOpen = () => figureOpen;
  async function oneFigure(open) {
    if (figureOpen) return null;
    figureOpen = true;
    try { return await open(); } finally { figureOpen = false; }
  }
  async function svgToPngFile(svgText, baseName = "diagram") {
    const { imageReady } = await import("./image-ready.js");
    const img = new Image();
    await imageReady(img, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`);
    const scale = 2, w = Math.max(1, Math.round((img.naturalWidth || 600) * scale)), h = Math.max(1, Math.round((img.naturalHeight || 400) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return new File([blob], `${baseName.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
  }
  async function importDiagramSpec(text, fileName = "") {
    if (/@startuml/i.test(text)) {
      const { parsePlantUml, layoutFromPlantuml } = await import("./uml-plantuml.js");
      const parsed = parsePlantUml(text);
      if (!parsed.laidOut) {
        try { const drawn = await drawPlantuml(text); if (drawn?.svg) layoutFromPlantuml(parsed.model, drawn.svg); } catch { /* Auto-laid-out fallback. */ }
      }
      if (parsed.preamble.length) parsed.model.preamble = parsed.preamble;
      if (!parsed.model.name && fileName) parsed.model.name = fileName.replace(/\.[^.]+$/, "");
      return parsed.model;
    }
    const { importUml, detectFormat, vpDiagrams } = await import("./uml-xml.js");
    const list = detectFormat(text) === "vp-xml" ? vpDiagrams(text).filter((d) => d.shapes) : [];
    return importUml(text, list.length > 1 ? { diagram: list[0].index } : undefined);
  }
  async function insertPrefab(p, box = null, choice = null) {
    const startedEmpty = !app.doc;
    if (app.editing || figureOpen) return false;
    if (startedEmpty ? !canReplace() : !p) return false;
    choice ||= await oneFigure(() => choosePrefab());
    if (!choice) return false;
    if (choice.kind === "uml-import") {
      if (!startedEmpty && !ensureEditableLayer()) return false;
      try {
        const imported = await importDiagramSpec(choice.text, choice.fileName);
        const note = app.epoch;
        const spec = await umlEditor(imported, false);
        if (!spec || !sameNote(note, startedEmpty)) return false;
        if (startedEmpty) p = await openBlankNoteForPrefab(prefabName(spec) || choice.fileName || "Diagram");
        if (!p || !ensureEditableLayer()) return false;
        const done = await placePrefab(p, spec, box);
        if (done) status(`${prefabName(spec)} inserted. Right-click it, hold it, or tap its ⋯ to edit it again; one undo removes it.`);
        return done;
      } catch (e) {
        // Non-editable PlantUML diagrams (activity, sequence, state…) insert as a rendered picture.
        if (/picture/i.test(e.message) && /@startuml/i.test(choice.text)) {
          const res = await drawPlantuml(choice.text);
          if (res?.svg) {
            if (startedEmpty) await openBlankNoteForPrefab(choice.fileName?.replace(/\.[^.]+$/, "") || "Diagram");
            await importImages([await svgToPngFile(res.svg, choice.fileName)]);
            return true;
          }
        }
        status(e.message, true);
        return false;
      }
    }
    notePrefabUsed(choice.id);
    if (choice.kind !== "prefab" && choice.kind !== "uml") return insertCompound(p, choice.kind, box);
    if (!startedEmpty && !ensureEditableLayer()) return false;
    const note = app.epoch;
    // A card of a type module draws a type another module owns: its spec names its own module,
    // so that it edits in that module's base editor (and keeps its name) from the start.
    const start = choice.module && choice.spec && !choice.spec.module && moduleOf(choice.spec)?.manifest.id !== choice.module ? { module: choice.module, ...choice.spec } : choice.spec;
    const spec = await figureEditor(start);
    if (!spec || !sameNote(note, startedEmpty)) return false;
    if (startedEmpty) {
      p = await openBlankNoteForPrefab(prefabName(spec) || choice.label || "Prefab");
      if (!p || !ensureEditableLayer()) return false;
    }
    const done = await placePrefab(p, spec, box);
    if (done) status(`${prefabName(spec)} inserted. Right-click it, hold it, or tap its ⋯ to edit it again; one undo removes it.`);
    return done;
  }
  // The editor of a prefab's figure: the diagram editor for UML and node graphs, the chart
  // editor (chart-editor.js) for process states, CPU timelines, charts and plots, and the JSON
  // one for the rest or when asked (`mode` "json"). `mode` "answer" fills an exercise in.
  // Snippets kept from the Grab tool (Keep for exercises), shown while filling a figure in; for
  // this session only.
  const exerciseRefs = [];
  let keptRefsWin = null;
  function syncKeptRefsUi() {
    const n = exerciseRefs.length;
    const pill = $("keptRefsPill");
    const count = $("keptRefsCount");
    if (pill) pill.hidden = !n;
    if (count) count.textContent = `Kept (${n})`;
    const menuBtn = $("keptRefsOpen");
    if (menuBtn) {
      const label = n ? `Kept for exercises (${n})…` : "Kept for exercises…";
      const textNode = [...menuBtn.childNodes].find((c) => c.nodeType === 3 && c.textContent.trim());
      if (textNode) textNode.textContent = label;
      else menuBtn.append(document.createTextNode(label));
    }
    keptRefsWin?.render?.();
  }
  async function openExerciseRefsWindow() {
    if (keptRefsWin) { keptRefsWin.show(); keptRefsWin.render(); return; }
    const { movableWindow } = await import("./prefabs/kit/window.js");
    const win = movableWindow({
      key: "kept-refs",
      title: "Kept for exercises",
      width: 420,
      height: 520,
      minWidth: 280,
      minHeight: 240,
      onClose: () => { win.destroy(); keptRefsWin = null; },
    });
    const host = document.createElement("div");
    host.className = "kept-refs-window";
    const bar = document.createElement("div");
    bar.className = "kept-refs-bar";
    const fileIn = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true, hidden: true });
    const addBtn = Object.assign(document.createElement("button"), { type: "button", className: "chip" });
    addBtn.append(icon("image"), document.createTextNode("Add picture…"));
    addBtn.onclick = () => fileIn.click();
    fileIn.onchange = () => {
      for (const f of fileIn.files || []) {
        exerciseRefs.push({ name: f.name, src: URL.createObjectURL(f), kind: "image" });
      }
      fileIn.value = "";
      syncKeptRefsUi();
    };
    const clearBtn = Object.assign(document.createElement("button"), { type: "button", className: "chip danger" });
    clearBtn.append(icon("trash"), document.createTextNode("Clear all"));
    clearBtn.onclick = () => { exerciseRefs.length = 0; syncKeptRefsUi(); };
    bar.append(addBtn, fileIn, Object.assign(document.createElement("span"), { className: "spacer" }), clearBtn);
    const list = document.createElement("div");
    list.className = "kept-refs-list";
    host.append(bar, list);
    win.body.append(host);
    const render = () => {
      clearBtn.hidden = !exerciseRefs.length;
      if (!exerciseRefs.length) {
        list.replaceChildren(Object.assign(document.createElement("p"), {
          className: "muted",
          textContent: "No snippets kept yet. Use the Grab tool on any page and tap ★ Keep for exercises, or add a picture above. Kept snippets also appear inside figure/chart editors.",
        }));
        return;
      }
      list.replaceChildren(...exerciseRefs.map((ref, i) => {
        const fig = document.createElement("figure");
        fig.className = "kept-ref-card";
        const cap = document.createElement("figcaption");
        const nameSpan = Object.assign(document.createElement("span"), { textContent: ref.name || `Snippet ${i + 1}` });
        const copyBtn = Object.assign(document.createElement("button"), { type: "button", className: "icon-button", title: "Copy image", ariaLabel: "Copy image" });
        copyBtn.append(icon("copy"));
        copyBtn.onclick = async () => {
          try {
            const blob = await (await fetch(ref.src)).blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
            status("Copied snippet image.");
          } catch { status("Could not copy image on this browser.", true); }
        };
        const rmBtn = Object.assign(document.createElement("button"), { type: "button", className: "icon-button", title: "Remove", ariaLabel: `Remove ${ref.name || "snippet"}` });
        rmBtn.append(icon("close"));
        rmBtn.onclick = () => { exerciseRefs.splice(i, 1); syncKeptRefsUi(); };
        cap.append(nameSpan, copyBtn, rmBtn);
        fig.append(cap);
        if (ref.src && ref.kind === "image") {
          const img = Object.assign(document.createElement("img"), { src: ref.src, alt: ref.name || "Kept snippet" });
          img.onclick = () => {
            const viewer = $("imageViewer"), vImg = $("imageViewerImg");
            if (viewer && vImg) { vImg.src = ref.src; vImg.alt = ref.name || ""; viewer.showModal(); }
          };
          fig.append(img);
        }
        return fig;
      }));
    };
    keptRefsWin = { show: () => { win.el.classList.remove("in-tray"); win.el.style.zIndex = "44"; }, render };
    render();
  }
  if ($("keptRefsOpen")) $("keptRefsOpen").onclick = () => { closeMenus(); openExerciseRefsWindow(); };
  if ($("keptRefsPill")) $("keptRefsPill").onclick = () => openExerciseRefsWindow();
  // The menu bar stays usable over the editors: if another note was opened (or this one closed)
  // meanwhile, what the editor returns is not put on it.
  function sameNote(note, startedEmpty = false) {
    if (startedEmpty ? (!app.doc && note === app.epoch) : (app.doc && note === app.epoch)) return true;
    status("Another note was opened while the editor was open; nothing was changed.", true);
    return false;
  }
  // A module loaded the first time an editor opens can take a while on a tablet: past a
  // moment, a toast says it is on its way (and goes once it is there).
  async function loading(promise, text = "Opening the editor…") {
    let shown = false;
    const timer = setTimeout(() => { shown = true; status(text); clearTimeout(app.statusTimer); }, 350);
    try { return await promise; } finally { clearTimeout(timer); if (shown) status(""); }
  }
  function figureEditor(spec, options = {}) {
    return oneFigure(() => openFigureEditor(spec, options));
  }
  async function openFigureEditor(spec, { editing = false, mode = "author", references = [] } = {}) {
    // The editor its module's manifest names (prefab-registry.js editorOf): its own editor.js,
    // the chart or diagram editor, a window, or the JSON one; a type module edits in its base.
    // A manifest that names none: chosen by the spec's type, as before modules.
    const { editor, module: owner } = editorOf(spec);
    const keepModule = (result) => (result && spec?.module && result.module !== spec.module ? { ...result, module: spec.module } : result);
    if (editor === "module") {
      try {
        const { openModuleEditor } = await loading(import("./prefab-host.js"));
        return keepModule(await openModuleEditor(owner, spec, { editing, mode }));
      } catch (e) {
        status(`The ${owner.manifest.label || owner.manifest.id} editor could not open: ${e.message}`, true);
        return null;
      }
    }
    if (editor === "graph" || editor === "table") return keepModule(await compoundEditor(editor, spec, editing));
    if (editor === "data") return keepModule(await editPrefab({ spec, editing }));
    if (editor === "uml-editor" || (!editor && spec?.type === "uml")) return keepModule(await openUmlEditor(spec, editing));
    if ((editor === "chart-editor" || !editor) && editorKind(spec)) {
      try {
        const { openChartEditor } = await loading(import("./chart-editor.js"));
        return keepModule(await openChartEditor(spec, { editing, mode, references: [...references, ...exerciseRefs], onReference: (ref) => { if (!exerciseRefs.includes(ref)) { exerciseRefs.push(ref); syncKeptRefsUi(); } }, notePages, recentNotes: recentReferenceNotes, markdown: (text) => call("markdownHtml", { text }) }));
      } catch (e) {
        status(`The chart editor could not open: ${e.message}`, true);
        return null;
      }
    }
    // The chart module's figures the chart editor does not paint (custom SVG), and the rest.
    return keepModule(await editPrefab({ spec, editing }));
  }
  // "To look at" in the chart editors: another note's pages as pictures. The note opens in an
  // engine worker of its own (the open note's stays as it is), its pages are drawn like the
  // page snapshots (pageCanvas), and the worker goes away again.
  async function notePages(file, maxPages = 20) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = fileKind(file.name, bytes);
    if (kind === "pdf" || kind === "image") return { kind, src: URL.createObjectURL(file) };
    if (!["note", "notecomplete", "project", "notebook"].includes(kind)) throw Error("only notes, notebooks, PDFs and pictures can be shown here");
    const side = sideDocument();
    try {
      const first = await side.open(file, { kind, bytes: bytes.buffer });
      const count = Math.min(Number(first.pages) || 1, maxPages);
      const source = { view: (i) => (i === 0 ? first : side.view(i)), backgrounds: side.backgrounds };
      const pages = [];
      for (let i = 0; i < count; i++) {
        const { canvas } = await pageCanvas(i, 1200, {}, source);
        pages.push(canvas.toDataURL("image/jpeg", 0.85));
        canvas.width = canvas.height = 0;
      }
      return { pages };
    } finally {
      side.close();
    }
  }
  // Recent notes the editor can show: the ones this device can read without a download.
  async function recentReferenceNotes() {
    const entries = await library.recent(30).catch(() => []);
    return entries
      .filter((entry) => entry && entry.source !== "web" && /\.(noteful|nfedit|notecomp(lete)?|notepart|goodnotes|ntb|pdf)$/i.test(entry.name || ""))
      .map((entry) => ({
        title: entryTitle(entry),
        open: async () => {
          const file = await library.open(entry);
          if (!file) throw Error("this note is not on this device");
          return notePages(file);
        },
      }));
  }
  // The UML diagram editor (uml-editor.js), loaded the first time it is needed.
  function umlEditor(spec, editing = false) {
    return oneFigure(() => openUmlEditor(spec, editing));
  }
  async function openUmlEditor(spec, editing = false) {
    try {
      const { openUmlEditor: open } = await loading(import("./uml-editor.js"));
      // A new diagram opens in the view chosen in Insert prefab (drawing, PlantUML or both).
      return await open(spec, { editing, view: editing ? null : savedUmlView(), markdown: (text) => call("markdownHtml", { text }), draw: drawPlantuml });
    } catch (e) {
      status(`The diagram editor could not open: ${e.message}`, true);
      return null;
    }
  }
  // An exam figure drawn into `box` (its width kept, its height from the figure), or a new box;
  // `replace`: the items of the prefab it replaces, in the same undo step.
  async function placePrefab(p, spec, box = null, replace = null, id = undefined) {
    const aspect = prefabAspect(spec);
    let at;
    if (box && box[2] >= 40) at = [box[0], box[1], box[2], box[2] * aspect];
    else {
      // A tap (no box dragged) places it from that point; nothing, in the middle of the view.
      // A UML diagram keeps its own size (its units are the page's), when it fits.
      const natural = spec?.type === "uml" || spec?.type === "stickynote" ? prefabSvg(spec)?.width || (spec?.type === "stickynote" ? 256 : 440) : 440;
      const w = Math.min(natural, p.size[0] - 60, (p.size[1] - 60) / aspect), h = w * aspect;
      at = box ? [Math.max(20, Math.min(box[0], p.size[0] - w - 20)), Math.max(20, Math.min(box[1], p.size[1] - h - 20)), w, h] : compoundBox(p, "graph", null, [w, h]);
    }
    try {
      const png = await prefabPng(spec, [at[2], at[3]]);
      const items = prefabItems(at, spec, png, { layer: app.activeLayer, ...(id ? { id } : {}) });
      await action("drawMany", { page: p.index, ...(replace ? { replace } : {}), lines: items.lines, images: items.images });
      return true;
    } catch (e) {
      status(e.message, true);
      return false;
    }
  }
  $("insertTable").onclick = () => insertCompound(app.panels[app.page], "table");
  // A UML diagram straight away (the picker's UML cards do the same): a class diagram to start.
  async function insertUml(p, box = null, diagram = "class") {
    const startedEmpty = !app.doc;
    if (app.editing || (startedEmpty ? !canReplace() : (!p || !ensureEditableLayer()))) return false;
    const { starterModel } = await import("./uml.js");
    const note = app.epoch;
    const spec = await umlEditor(starterModel(diagram));
    if (!spec || !sameNote(note, startedEmpty)) return false;
    if (startedEmpty) {
      p = await openBlankNoteForPrefab(prefabName(spec) || "UML Diagram");
      if (!p || !ensureEditableLayer()) return false;
    }
    const done = await placePrefab(p, spec, box);
    if (done) status(`${prefabName(spec)} inserted. Right-click it, hold it, or tap its ⋯ to edit it again; one undo removes it.`);
    return done;
  }
  $("insertUml").onclick = () => insertUml(app.panels[app.page]);
  // The editor on a page of its own (a window of its own in the desktop app).
  $("openUmlPage").onclick = () => { if (!window.open("./uml.html", "_blank")) status("The UML editor page could not open here; it is at uml.html next to the app.", true); };
  $("openChartsPage").onclick = () => { if (!window.open("./charts.html", "_blank")) status("The chart editor page could not open here; it is at charts.html next to the app.", true); };
  // The box a graph or table has now: its frame's (moved or resized since it was drawn).
  async function compoundFrame(item) {
    const c = item.compound, info = await call("selection", { page: item.page, itemId: c.frame });
    const [x, y, w, h] = info.bounds, a = info.adjustment, pad = info.base_width / 2;
    const cw = (w - 2 * pad) * a.scale[0], ch = (h - 2 * pad) * a.scale[1], cx = x + w / 2 + a.translation[0], cy = y + h / 2 + a.translation[1];
    return [cx - cw / 2, cy - ch / 2, cw, ch];
  }
  // A table given rows, columns or lines of text in its editor grows by as much (and shrinks when
  // they go), from where it is, at the size it was given; kept inside the page.
  function tableGrown(page, kind, box, before, after) {
    if (kind !== "table") return box;
    const [w0, h0] = tableNaturalSize(before), [w1, h1] = tableNaturalSize(after), size = app.panels[page]?.size;
    const [x, y, w, h] = box;
    let nw = w * w1 / w0, nh = h * h1 / h0;
    if (size) { nw = Math.min(nw, Math.max(w, size[0] - x - 10)); nh = Math.min(nh, Math.max(h, size[1] - y - 10)); }
    return [x, y, Math.max(40, nw), Math.max(20, nh)];
  }
  // Edit graph / Edit table: its editor with what it is, then drawn again where it is now.
  async function editCompound(item, mode = "author") {
    const c = item?.compound;
    if (!c || !app.doc) return;
    let spec = {};
    try { spec = JSON.parse(c.spec || "{}"); } catch { /* Drawn again from the defaults. */ }
    if (c.kind === "prefab") {
      // Filling in: the page the exercise is on, to read its statement beside the canvas.
      let references = [];
      if (mode === "answer") {
        try {
          const { canvas } = await pageCanvas(item.page, 1400);
          references = [{ name: `Page ${item.page + 1}`, src: canvas.toDataURL("image/jpeg", 0.85), kind: "image" }];
          canvas.width = canvas.height = 0;
        } catch { /* The editor opens without it. */ }
      }
      const note = app.epoch;
      const chosen = await figureEditor(spec, { editing: true, mode, references });
      if (!chosen || !sameNote(note)) return;
      const frame = await compoundFrame(item);
      selection.clear();
      if (await placePrefab(app.panels[item.page], chosen, frame, c.items, c.id)) status(`${prefabName(chosen)} changed. One undo brings back the one before.`);
      return;
    }
    const note = app.epoch;
    const chosen = await oneFigure(() => compoundEditor(c.kind, spec, true));
    if (!chosen || !sameNote(note)) return;
    let items;
    // The page stayed usable behind the window: it may have been moved, or deleted meanwhile.
    try { items = compoundItems(c.kind, tableGrown(item.page, c.kind, await compoundFrame(item), spec, chosen), chosen, c.id); } catch (e) { return status(e.message, true); }
    selection.clear();
    await action("drawMany", { page: item.page, replace: c.items, lines: items.lines, images: items.images });
    status(`${c.kind === "graph" ? "Graph" : "Table"} changed. One undo brings back the one before.`);
  }
  // A graph, table or prefab resized with Select: drawn again into the box it was given, from
  // what it is (its spec), so text and lines stay sharp at any size, in one undo step. A prefab
  // keeps its own proportions (its width decides); a graph or table takes the box as it is.
  async function redrawResized(item, adjustment) {
    const c = item.compound, p = app.panels[item.page];
    if (!c || !p || !app.doc) return false;
    let spec = {};
    try { spec = JSON.parse(c.spec || "{}"); } catch { return false; }
    try {
      const [fx, fy, fw, fh] = await compoundFrame(item), [bx, by, bw, bh] = item.bounds;
      const cx = bx + bw / 2, cy = by + bh / 2, [sx, sy] = adjustment.scale, [tx, ty] = adjustment.translation;
      let targetW = Math.max(20, fw * sx), targetH = Math.max(12, fh * sy);
      if (c.kind === "prefab") {
        const aspect = prefabAspect(spec) || (fh / Math.max(1, fw));
        const scale = Math.abs(sy - 1) > Math.abs(sx - 1) ? sy : sx;
        targetW = Math.max(40, fw * scale);
        targetH = Math.max(20, targetW * aspect);
      }
      // Anchored as the drag scaled the frame (its offset from the item's centre scales too), so
      // a graph whose labels stick out of its frame does not jump on each resize.
      const box = [cx + (fx - cx) * (targetW / Math.max(1, fw)) + tx, cy + (fy - cy) * (targetH / Math.max(1, fh)) + ty, targetW, targetH];
      selection.clear();
      if (c.kind === "prefab") {
        if (!(await placePrefab(p, spec, box, c.items, c.id))) return false;
      } else {
        const items = compoundItems(c.kind, box, spec, c.id);
        await action("drawMany", { page: item.page, replace: c.items, lines: items.lines, images: items.images });
      }
      // Still selected, as it was.
      const again = await pickWhole({ page: item.page, x: box[0] + box[2] / 2, y: box[1] + box[3] / 2, tolerance: 4 }).catch(() => null);
      if (again?.compound?.id === c.id) selection.show(again);
      return true;
    } catch (e) {
      status(e.message, true);
      return false;
    }
  }
  // Any part picked selects the whole graph or table: a group of its parts, with what it is.
  async function pickWhole(args) {
    const item = await call("pick", args);
    const parts = app.panels[args.page]?.view?.parts;
    let part = item && parts?.find((q) => q.item === item.id);
    if (!part && parts?.length && Number.isFinite(args.x) && Number.isFinite(args.y)) {
      // A click beside the drawn parts but inside a figure's frame: the frames asked for together
      // (one round trip's wait, not one per figure), the topmost hit wins.
      const frames = parts.filter((q) => q.spec);
      const infos = await Promise.all(frames.map((f) => call("selection", { page: args.page, itemId: f.item }).catch(() => null)));
      for (let i = frames.length - 1; i >= 0; i--) {
        const f = frames[i], info = infos[i];
        if (!info?.bounds) continue;
        const [bx, by, bw, bh] = info.bounds, a = info.adjustment || { translation: [0, 0], scale: [1, 1] };
        const cx = bx + bw / 2 + a.translation[0], cy = by + bh / 2 + a.translation[1];
        const hw = (bw * Math.abs(a.scale[0])) / 2, hh = (bh * Math.abs(a.scale[1])) / 2;
        if (args.x >= cx - hw && args.x <= cx + hw && args.y >= cy - hh && args.y <= cy + hh) {
          part = f;
          break;
        }
      }
    }
    if (!part) return item;
    const own = parts.filter((q) => q.id === part.id), frame = own.find((q) => q.spec);
    if (!frame) return item;
    const members = (await Promise.all(own.map((q) => call("selection", { page: args.page, itemId: q.item }).catch(() => null)))).filter(Boolean);
    if (members.length < 2) return item;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of members) {
      const [x, y, w, h] = m.bounds, a = m.adjustment, cx = x + w / 2 + a.translation[0], cy = y + h / 2 + a.translation[1], hw = (w * Math.abs(a.scale[0])) / 2, hh = (h * Math.abs(a.scale[1])) / 2;
      x0 = Math.min(x0, cx - hw); y0 = Math.min(y0, cy - hh); x1 = Math.max(x1, cx + hw); y1 = Math.max(y1, cy + hh);
    }
    return {
      kind: "group", page: args.page, id: `group:${part.id}`, bounds: [x0, y0, x1 - x0, y1 - y0],
      base_rotation: 0, base_width: 1, base_rgba: [0, 0, 0, 1], styled: false,
      adjustment: { translation: [0, 0], scale: [1, 1], rotation: 0 }, members,
      compound: { id: part.id, kind: part.kind, spec: frame?.spec, frame: frame?.item ?? own[0].item, items: own.map((q) => q.item) },
    };
  }
  $("editCompound").onclick = () => editCompound(selection.item);
  return { editCompound, exerciseRefs, figureEditor, figureIsOpen, importDiagramSpec, insertCompound, insertPrefab, insertUml, pickWhole, placePrefab, redrawResized, svgToPngFile, syncKeptRefsUi };
}
