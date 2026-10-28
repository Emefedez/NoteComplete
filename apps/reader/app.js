import {
  prepareDocument,
  readImage,
  imageBounds,
  fileKind,
} from "./media-import.js";
import { htmlViewer } from "./html-view.js";
import { textViewer, isMarkdownName } from "./text-view.js";
import { groupStore, groupPanel, localMember } from "./groups.js";
import { driveBrowser } from "./drive-browser.js";
import { Library } from "./library.js";
import { homeScreen } from "./home.js";
import { commandPalette } from "./command-palette.js";
import { findController, noteFingerprint } from "./find.js";
import { studyController, ankiDecks, studyGroups } from "./study.js";
import { allQuizzes } from "./all-quizzes.js";
import { updateNotice } from "./updates.js";
import { scratchpad } from "./scratchpad.js";
import { dictation } from "./dictate.js";
import { chatController } from "./chat.js";
import { themeController } from "./theme.js";
import { getAiFile } from "./rich-text.js";
import { quizController } from "./quiz.js";
import { jobChip } from "./jobs.js";
import { selectedText } from "./text-layer.js";
import { floatingWindow } from "./floating.js";
import { pageExporter, IMAGE_TYPES } from "./page-export.js";
import { versionChooser } from "./versions.js";
import { receiveNativeFiles } from "./import.js";
import { SelectionController } from "./selection.js";
import { ChromeState, highlightPoints } from "./chrome-state.js";
import { download } from "./download.js";
import { enhanceSelects, refreshSelects } from "./select.js";
import { decorateIcons } from "./icons.js";
import { qualitySettings } from "./quality.js";
import { PdfBackgrounds, backgroundPlacement, openPdf } from "./pdf-background.js";
import { PRESETS, SPACE, blankSize, pdfPages, insertAt, unitsToMm, mmToUnits, UNITS_PER_POINT } from "./insert-pages.js";
import { AudioController } from "./audio.js";
import { addedAudio, AUDIO_TYPES, clock } from "./recorder.js";
import { TranscriptController } from "./transcript.js";
import { AudioProcessing } from "./audio-processing.js";
import { indexTimedInk, updateTimedInk } from "./ink-timeline.js";
import { shapePoints } from "./shapes.js";
import { tabStrip } from "./tab-strip.js";
import { sortable } from "./reorder.js";
const $ = (id) => document.getElementById(id),
  ns = "http://www.w3.org/2000/svg";
// Colour choices shared by the pen, shapes and text.
const SWATCHES = ["#1f2328", "#246bce", "#d13b2f", "#2a9d63", "#8a4fd0", "#ff9f1c", "#ffdf38", "#e3c6e6"];
enhanceSelects();
decorateIcons();
// Command bar menus close on outside clicks and after choosing an item.
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll("details.menu[open]"))
    if (!menu.contains(event.target) || event.target.closest(".menu-content button"))
      menu.open = false;
});
document.addEventListener("toggle", (event) => {
  if (!event.target.matches?.("details.bar-menu") || !event.target.open) return;
  for (const menu of document.querySelectorAll("details.bar-menu[open]"))
    if (menu !== event.target) menu.open = false;
}, true);
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#toolbar,.select-menu") && !$("toolOptions").hidden)
    setCompact(true);
});
const worker = new Worker("./worker.js", { type: "module" }),
  pending = new Map();
let request = 0,
  epoch = 0,
  revision = 0,
  ready = false,
  dirty = false,
  // Changed since it was opened: a fresh PDF or image is unsaved (dirty) but has nothing to lose.
  changed = false,
  editing = false,
  doc = null,
  sideFp = "",
  page = 0,
  tool = "pan",
  activeLayer = 0,
  gesture = null,
  backgrounds = null;
let mutationPending = 0;
const busy = () => editing || mutationPending > 0;
// A floppy disk beside the title: a dot while there are unsaved changes,
// and a click saves like Ctrl S.
function savedState() {
  tabBar.update({ title: doc ? $("title").textContent : "Home", dirty: !!doc && dirty && changed });
  const label = dirty ? "Unsaved changes. Click to save (Ctrl S)" : "Project saved";
  $("saveState").hidden = !doc;
  $("saveState").classList.toggle("dirty", dirty);
  $("saveState").setAttribute("aria-label", label);
  $("saveState").title = label;
}
$("saveState").onclick = () => $("save").click();

// Desktop tabs: the strip in the top bar; title and unsaved state go to the window.
const tabBar = tabStrip(window.notecompleteTabs || null, { dirty: () => !!doc && dirty });
if (window.notecompleteTabs) {
  $("newTab").hidden = false;
  $("newTab").onclick = () => window.notecompleteTabs.open();
}
const theme = themeController({ toggle: $("themeToggle"), system: $("themeSystem"), status });
const chromeState = new ChromeState();
let chromeSettling = false;
let panels = [],
  observer = null,
  thumbnailObserver = null,
  scrollFrame = 0,
  zoom = "fit";
let displayQuality;
qualitySettings((value, rasterChanged) => {
  displayQuality = value;
  // Always a filter list (never "none"): dark pages append invert() to it, and "none invert()" is invalid CSS.
  document.documentElement.style.setProperty("--page-filter", `contrast(${value.contrast}%) brightness(${value.brightness}%)`);
  if (!rasterChanged) return;
  backgrounds?.images.clear();
  for (const panel of panels) {
    panel.token++;
    if (panel.near) renderPage(panel, panel.view);
  }
});
const audio = new AudioController(
  (resource) => call("audio", { resource }),
  jump,
  syncInk,
);
audio.transcript = new TranscriptController(audio);
audio.processing = new AudioProcessing(audio.audio);
let addedStore = null; // recordings added in NoteComplete, set up with the library below
const selection = new SelectionController({
  call,
  patch: patchItem,
  remove: (item) => action("remove", { page: item.page, itemId: item.id }),
  panel: (index) => panels[index],
  editable: () => !!doc && !busy(),
  changed: toolOptions,
  status,
});
// Status is a transient toast, not a permanent strip; errors stay up longer.
let statusTimer = 0;
function status(text, error = false) {
  $("status").textContent = text;
  $("status").className = (error ? "error " : "") + (text ? "show" : "");
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => $("status").classList.remove("show"), error ? 8000 : 2800);
}
function call(op, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++request;
    pending.set(id, { resolve, reject });
    worker.postMessage(
      { id, op, page, ...args },
      args.bytes ? [args.bytes] : [],
    );
  });
}
worker.onmessage = ({ data }) => {
  if (data.ready) {
    ready = true;
    $("open").disabled = $("emptyOpen").disabled = false;
    status("Ready. Everything is processed on your device.");
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({ type: "noteful-ready" }),
    );
    return;
  }
  if (data.fatal) {
    status(data.fatal, true);
    return;
  }
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
};
worker.onerror = (e) => {
  for (const p of pending.values()) p.reject(Error(e.message));
  pending.clear();
  ready = false;
  status("Engine error: " + e.message, true);
};
function canReplace() {
  return (
    !(dirty && changed) ||
    confirm("You have unsaved changes. Open another document and discard them?")
  );
}
// While a document opens (`opening`), Home stays hidden so switching never flashes it.
function reset({ opening = false } = {}) {
  resizeMode = null;
  if (notes?.visible) {
    notes.close();
    $("notesToggle").setAttribute("aria-expanded", "false");
  }
  selection.clear();
  cancelGesture();
  chromeState.reset();
  barState.reset();
  document.body.classList.remove("bar-compact");
  setCompact(false);
  observer?.disconnect();
  thumbnailObserver?.disconnect();
  backgrounds?.close();
  stopRecording();
  audio.reset();
  panels = [];
  doc = null;
  sideFp = "";
  htmlView?.close();
  textView?.close();
  $("pages").replaceChildren();
  $("editor").hidden = true;
  $("htmlView").hidden = true;
  $("textView").hidden = true;
  $("title").textContent = "Home";
  document.title = "NoteComplete";
  tabBar.update({ title: "Home", dirty: false });
  dirty = false;
  documentControls();
  if (!opening) home?.show(false);
}
// The format Save writes for a document made with New document; null saves a project.
let saveAs = null;
const SAVE_EXT = { project: ".nfedit", noteful: ".noteful", markdown: ".noteful", notecomplete: ".notecomp", notepart: ".notepart" };
function saveLabel() { $("save").firstChild.textContent = saveAs ? `Save (${SAVE_EXT[saveAs]})` : "Save project"; }
async function load(file, preparedDocument = null) {
  if (!ready || busy()) {
    status("Wait for the current operation to finish.", true);
    return;
  }
  editing = true;
  status("Opening document…");
  try {
    const fingerprint = noteFingerprint(file).catch(() => "");
    const prepared = preparedDocument || await prepareDocument(file);
    // HTML pages and text/Markdown files have their own views instead of the page editor.
    if (prepared.kind === "html" || prepared.kind === "text") {
      reset({ opening: true });
      sideFp = await fingerprint;
      const sideTitle = prepared.title || file.name || "Document";
      $("title").textContent = sideTitle;
      document.title = `${sideTitle} — NoteComplete`;
      tabBar.update({ title: sideTitle, dirty: false });
      if (prepared.kind === "html") htmlView.open({ text: prepared.text, fingerprint: sideFp, name: sideTitle });
      else await textView.open({ text: prepared.text, name: sideTitle, markdown: isMarkdownName(file.name) });
      showDocument();
      rememberDocument();
      documentControls();
      status(prepared.kind === "html" ? "HTML document opened." : "Text document opened.");
      return;
    }
    const result = await call("open", {
      ...prepared,
      project: prepared.kind === "project",
      notecomplete: prepared.kind === "notecomplete",
      page: 0,
    });
    // Both worker and UI retain the previous document until the replacement validates.
    reset({ opening: true });
    tapeMode = "note";
    tapeTaps.clear();
    find.reset(await fingerprint);
    notes?.load(find.fingerprint);
    const token = ++epoch;
    revision++;
    doc = result;
    page = 0;
    activeLayer =
      result.layers.find((l) => l.visible && !l.locked)?.id ??
      result.layers[0]?.id ??
      0;
    dirty = ["pdf", "image", "blank"].includes(prepared.kind);
    changed = false;
    saveAs = prepared.saveAs || null;
    saveLabel();
    savedState();
    backgrounds = new PdfBackgrounds((resource) => {
      if (token !== epoch) throw Error("Document closed");
      return call("pdf", { resource });
    });
    $("title").textContent = result.title || "Untitled note";
    document.title = `${$("title").textContent} — NoteComplete`;
    tabBar.update({ title: $("title").textContent, dirty: dirty && changed });
    showDocument();
    $("pageNumber").max = result.pages;
    documentControls();
    buildPages(result.page_sizes);
    updateTools(result);
    layerPanel(result.layers);
    // Recordings that came inside a .notecomp join the ones kept for this note.
    const incoming = (result.added_audio || []).map((a) => ({ id: a.id, name: a.name, mime: a.mime, created: a.created, blob: new Blob([a.bytes], { type: a.mime }) }));
    audio.open(result.audio || [], result.recordings || [], await addedStore.load(find.fingerprint, incoming));
    rememberDocument();
    await renderPage(panels[0], result);
    status("Document opened.");
  } catch (e) {
    status("Could not open: " + e.message, true);
    throw e;
  } finally {
    editing = false;
  }
}
async function importImages(files) {
  if (!doc || busy()) return;
  const targetPage = page,
    layer = activeLayer,
    note = epoch;
  const targetLayer = doc.layers.find((l) => l.id === layer);
  if (!targetLayer?.visible || targetLayer.locked) {
    status("Choose a visible, unlocked layer before importing an image.", true);
    return;
  }
  editing = true;
  status("Importing image…");
  try {
    for (const file of files) {
      const decoded = await readImage(file);
      if (note !== epoch) return;
      const image = {
        base64: decoded.base64,
        mime: decoded.mime,
        bounds: imageBounds(decoded.size, panels[targetPage].size),
        layer,
      };
      const result = await call("image", { page: targetPage, image });
      if (note !== epoch) return;
      dirty = changed = true;
      revision++;
      doc = result;
      updateTools(result);
      savedState();
      await renderPage(panels[targetPage], result);
    }
    document.querySelector("[data-tool=select]").click();
    await selection.selectId(targetPage, `image:${doc.edit_count - 1}`);
    status("Image imported. Drag or resize it with Select.");
  } catch (e) {
    status("Could not import image: " + e.message, true);
  } finally {
    editing = false;
  }
}
function buildPages(sizes) {
  const fragment = document.createDocumentFragment();
  panels = sizes.map((size, index) => {
    const el = document.createElement("article");
    el.className = "sheet";
    el.dataset.page = index;
    el.dataset.tool = tool;
    el.setAttribute("aria-label", `Page ${index + 1}`);
    el.style.aspectRatio = size.join("/");
    const p = {
      index,
      size,
      el,
      view: null,
      near: false,
      token: 0,
      loading: false,
      pdfReady: false,
      rasterWidth: 0,
    };
    placeholder(p);
    fragment.append(el);
    el.onpointerdown = (e) => {
      if (e.target.closest(".text-editor, .text-format, .page-resize-frame")) return;
      p.audioTap = tool === "pan" && e.button === 0 ? [e.clientX, e.clientY] : null;
      pointerDown(e, p);
    };
    el.onpointermove = (e) => {
      if (p.audioTap && Math.hypot(e.clientX - p.audioTap[0], e.clientY - p.audioTap[1]) > 6)
        p.audioTap = null;
      pointerMove(e);
    };
    el.onpointerup = pointerUp;
    el.onpointercancel = () => { p.audioTap = null; cancelGesture(); };
    // Double-clicking a typed text box with Select types into it.
    el.ondblclick = (event) => {
      const item = selection.item;
      if (tool !== "select" || item?.kind !== "text" || item.page !== p.index) return;
      const existing = (p.view?.texts || []).find((t) => t.id === item.id);
      if (!existing) return;
      document.querySelector('#toolbar [data-tool="text"]').click();
      openTextEditor(p, point(event, p), existing);
    };
    el.oncontextmenu = async (event) => {
      // Right-click removes the element under the pointer; Ctrl+Z brings it back.
      event.preventDefault();
      if (!doc || editing || busy() || !p.view) return;
      // Not while text is selected: a right-click there means copy, not delete.
      if (selectedText(window.getSelection())) return status("Press Ctrl+C to copy the selected text.");
      const [x, y] = point(event, p);
      try {
        const item = await call("pick", { page: p.index, x, y,
          tolerance: 8 * p.size[0] / p.el.getBoundingClientRect().width });
        if (!item || !doc || editing || busy()) return;
        if (selection.item?.page === p.index && selection.item?.id === item.id) selection.clear();
        await action("remove", { page: p.index, itemId: item.id });
        status("Element removed. Press Ctrl+Z to undo it.");
      } catch (error) { status(error.message, true); }
    };
    el.onclick = async (event) => {
      if (!p.audioTap || tool !== "pan") return;
      // Tapping tape uncovers or covers what is under it, as in Noteful.
      const [tx, ty] = point(event, p);
      const tape = [...(p.view?.tapes || [])].reverse().find(({ bounds: [bx, by, bw, bh] }) => tx >= bx && tx <= bx + bw && ty >= by && ty <= by + bh);
      if (tape) {
        p.audioTap = null;
        toggleTape(p, tape);
        return;
      }
      if (!p.view?.timings.length) return;
      p.audioTap = null;
      const note = epoch, [x, y] = point(event, p);
      try {
        const item = await call("pick", { page: p.index, x, y,
          tolerance: 8 * p.size[0] / p.el.getBoundingClientRect().width });
        if (note !== epoch || tool !== "pan") return;
        const timing = p.view?.timings.find(t => t.item_id === item?.id);
        if (timing && await audio.seekRecording(timing.recording_id, timing.start)) {
          refreshSelects();
          status(`Audio positioned at ${timing.start.toFixed(1)} seconds.`);
        }
      } catch (error) { status(error.message, true); }
    };
    el.onlostpointercapture = () => {
      if (gesture?.panel === p) cancelGesture();
      selection.lostCapture(p);
    };
    return p;
  });
  $("pages").append(fragment);
  buildPageList();
  resize();
  $("viewport").scrollTop = 0;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const p = panels[Number(entry.target.dataset.page)];
        if (!p || p.el !== entry.target) continue;
        p.near = entry.isIntersecting;
        if (p.near) {
          if (!p.view) renderPage(p);
        } else if (gesture?.panel !== p) {
          p.token++;
          p.view = null;
          p.ink = null;
          p.pdfReady = false;
          placeholder(p);
        }
      }
    },
    { root: $("viewport"), rootMargin: "600px 0px" },
  );
  for (const p of panels) observer.observe(p.el);
}
function buildPageList() {
  const fragment = document.createDocumentFragment();
  for (const panel of panels) {
    const button = document.createElement("button");
    button.className = "page-link";
    button.setAttribute("aria-label", `Page ${panel.index + 1}`);
    const thumb = document.createElement("span");
    thumb.className = "page-thumb";
    thumb.style.aspectRatio = panel.size.join(" / ");
    const fallback = document.createElement("span");
    fallback.className = "thumb-fallback";
    fallback.textContent = panel.index + 1;
    thumb.append(fallback);
    const label = document.createElement("span");
    label.className = "page-label";
    label.textContent = `Page ${panel.index + 1}`;
    button.append(thumb, label);
    button.onclick = () => {
      jump(panel.index);
      $("pagesPanel").classList.remove("open");
      syncPagePanel();
    };
    panel.pageButton = button;
    fragment.append(button);
  }
  $("pageList").replaceChildren(fragment);
  thumbnailObserver?.disconnect();
  thumbQueue.clear();
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const panel = panels.find((candidate) => candidate.pageButton === entry.target);
        if (!panel) continue;
        if (!entry.isIntersecting) thumbQueue.delete(panel);
        else if (!panel.thumbnailReady) queueThumbnail(panel);
      }
    },
    { root: $("pagesPanel"), rootMargin: "240px 0px" },
  );
  for (const panel of panels) thumbnailObserver.observe(panel.pageButton);
  markPage();
}
// Paper stays underneath so widened pages show blank paper beside the PDF.
// Text tool: a text box typed in place. Its layout matches the core's text
// rendering (first baseline 8 + size, line advance size + max(8, size/5 + 8),
// 5 units of left padding), so the box does not jump when it is committed.
// A format bar sits on the box while typing, and on a selected text box with
// Select: font, size, bold, italic and colour apply at once. The last style
// used is the one new boxes start with.
const FONT_STACKS = {
  Helvetica: "Helvetica, Arial, sans-serif",
  "Times New Roman": "'Times New Roman', Times, serif",
  "Courier New": "'Courier New', monospace",
  Noteworthy: "Noteworthy, 'Comic Neue', 'Comic Sans MS', cursive",
};
const TEXT_SIZES = [10, 12, 14, 16, 18, 22, 28, 36, 48, 64, 96];
const textAdvance = (size) => size + Math.max(8, size * 0.2 + 8);
const cssFont = (style, size = style.size) => `${style.italic ? "italic " : ""}${style.bold ? 700 : 400} ${size}px ${FONT_STACKS[style.font] || FONT_STACKS.Helvetica}`;
function textBoxSize(text, style) {
  const context = document.createElement("canvas").getContext("2d");
  context.font = cssFont(style);
  const lines = text.split("\n");
  return [Math.ceil(Math.max(...lines.map((l) => context.measureText(l).width)) + 12), Math.ceil(8 + lines.length * textAdvance(style.size))];
}
const hexColor = (rgba) => "#" + rgba.slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
const rgbaOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1);
let textDefaults = { font: "Helvetica", size: 16, bold: false, italic: false, rgba: [0.12, 0.14, 0.16, 1] };
try { textDefaults = { ...textDefaults, ...JSON.parse(localStorage.getItem("notecomplete-text-style") || "{}") }; } catch { /* Optional. */ }
const styleOf = (run) => run ? { font: run.font_family || "Helvetica", size: run.font_size, bold: run.bold, italic: run.italic, rgba: run.rgba } : { ...textDefaults };
const textPayload = (value, style) => ({ text: value, font_size: style.size, rgba: style.rgba, bold: style.bold, italic: style.italic, font: style.font });
const boxText = (existing) => existing.runs.map((r) => r.text).join("").replaceAll("​", "");
for (const size of TEXT_SIZES) $("textSize").add(new Option(String(size), String(size)));
for (const color of SWATCHES) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.dataset.color = color;
  b.style.setProperty("--swatch", color);
  b.title = color;
  b.setAttribute("role", "radio");
  $("textSwatches").append(b);
}
const textFormatBar = $("textFormat");
// Which box the bar formats: the one being typed, or a selected one.
let textFormatTarget = null;
function showTextFormat(p, bounds, style, apply) {
  const bar = textFormatBar;
  textFormatTarget = { p, style, apply };
  syncTextFormatControls(style);
  bar.style.left = `${(bounds[0] / p.size[0]) * 100}%`;
  bar.style.top = `${(bounds[1] / p.size[1]) * 100}%`;
  // Above the box, or below it when the box is at the top of the page.
  bar.classList.toggle("below", bounds[1] / p.size[1] < 0.06);
  if (bar.classList.contains("below")) bar.style.top = `${((bounds[1] + bounds[3]) / p.size[1]) * 100}%`;
  if (bar.parentElement !== p.el) p.el.append(bar);
  bar.hidden = false;
}
function syncTextFormatControls(style) {
  $("textFont").value = FONT_STACKS[style.font] ? style.font : "Helvetica";
  if (![...$("textSize").options].some((o) => Number(o.value) === style.size)) $("textSize").add(new Option(String(style.size), String(style.size)));
  $("textSize").value = String(style.size);
  $("textBold").setAttribute("aria-pressed", String(!!style.bold));
  $("textItalic").setAttribute("aria-pressed", String(!!style.italic));
  const hex = hexColor(style.rgba);
  $("textColor").value = hex;
  for (const b of $("textSwatches").children) b.setAttribute("aria-checked", String(b.dataset.color.toLowerCase() === hex));
}
function hideTextFormat() {
  textFormatTarget = null;
  textFormatBar.hidden = true;
  document.body.append(textFormatBar);
}
function changeTextStyle(change) {
  const t = textFormatTarget;
  if (!t) return;
  Object.assign(t.style, change);
  textDefaults = { ...t.style };
  try { localStorage.setItem("notecomplete-text-style", JSON.stringify(textDefaults)); } catch { /* Optional. */ }
  syncTextFormatControls(t.style);
  t.apply(t.style);
}
// Buttons keep the typing focus; the dropdowns hand it back after a choice.
// A press anywhere on the bar keeps the box open while focus moves to it.
let textFormatPressed = 0;
textFormatBar.addEventListener("pointerdown", () => { textFormatPressed = Date.now(); }, true);
for (const el of textFormatBar.querySelectorAll("button")) el.addEventListener("pointerdown", (e) => e.preventDefault());
$("textBold").onclick = () => changeTextStyle({ bold: !textFormatTarget?.style.bold });
$("textItalic").onclick = () => changeTextStyle({ italic: !textFormatTarget?.style.italic });
$("textFont").onchange = () => changeTextStyle({ font: $("textFont").value });
$("textSize").onchange = () => changeTextStyle({ size: Number($("textSize").value) });
$("textColor").oninput = () => changeTextStyle({ rgba: rgbaOf($("textColor").value) });
$("textSwatches").onclick = (e) => { const c = e.target.closest("[data-color]")?.dataset.color; if (c) changeTextStyle({ rgba: rgbaOf(c) }); };
textFormatBar.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape" && textEditor) { e.preventDefault(); textEditor.area.focus(); }
});
// With Select: the bar follows a selected typed text box and restyles it at once.
function syncTextFormat() {
  if (textEditor) return;
  const item = selection.item, p = item && panels[item.page];
  const existing = tool === "select" && item?.kind === "text" && (p?.view?.texts || []).find((t) => t.id === item.id);
  if (!existing) return hideTextFormat();
  const style = styleOf(existing.runs[0]);
  showTextFormat(p, existing.bounds, style, (next) => {
    const value = boxText(existing), [w, h] = textBoxSize(value, next);
    action("editText", { page: p.index, itemId: existing.id, text: textPayload(value, next), width: w, height: h });
  });
}
let textEditor = null;
async function openTextEditor(p, [x, y], known = null) {
  if (textEditor) return commitText();
  if (!doc || editing || busy() || !p.view) return;
  const layer = doc.layers.find((l) => l.id === activeLayer);
  // A click on a typed text box edits it; elsewhere it starts a new one.
  let existing = known;
  if (!existing) try {
    const item = await call("pick", { page: p.index, x, y, tolerance: 2 });
    if (item?.kind === "text") {
      existing = (p.view.texts || []).find((t) => t.id === item.id);
      if (!existing) return status("Text from Noteful cannot be edited here yet; move it with Select.", true);
    }
  } catch { /* Nothing under the pointer. */ }
  if (!existing && (!layer?.visible || layer.locked)) return status("Select a visible, unlocked layer.", true);
  const style = styleOf(existing?.runs?.[0]);
  const [bx, by] = existing ? existing.bounds : [x - 5, y - 8 - style.size * 0.8];
  const area = document.createElement("textarea");
  area.className = "text-editor";
  area.wrap = "off";
  area.value = existing ? boxText(existing) : "";
  area.setAttribute("aria-label", "Text box");
  const fit = () => {
    const s = p.el.clientWidth / p.size[0], [w, h] = textBoxSize(area.value || " ", style);
    Object.assign(area.style, {
      left: `${(bx / p.size[0]) * 100}%`, top: `${(by / p.size[1]) * 100}%`,
      width: `${Math.max(w, 40) * s}px`, height: `${h * s}px`,
      font: `${cssFont(style, style.size * s).replace(/px /, `px/${textAdvance(style.size) * s}px `)}`,
      padding: `${Math.max(0, 8 + 0.2 * style.size - (textAdvance(style.size) - style.size) / 2) * s}px 0 0 ${5 * s}px`,
      color: `rgba(${style.rgba.slice(0, 3).map((c) => Math.round(c * 255)).join(",")},${style.rgba[3]})`,
    });
  };
  fit();
  area.oninput = fit;
  const hidden = existing && p.render?.querySelector(`[data-item="${existing.id}"]`);
  hidden?.setAttribute("visibility", "hidden");
  p.el.append(area);
  selection.clear();
  textEditor = { p, area, existing, style, initial: { ...style }, bx, by, hidden, layer: activeLayer };
  showTextFormat(p, [bx, by, 0, 0], style, () => { fit(); area.focus(); });
  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeText(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { commitText(); return; }
    // Typing stays in the box: no tool or study shortcuts while editing.
    e.stopPropagation();
  });
  // Leaving the box finishes it, unless the focus went to its format bar.
  area.addEventListener("blur", () => setTimeout(() => {
    if (textEditor?.area !== area || textFormatBar.contains(document.activeElement) || Date.now() - textFormatPressed < 1000) return;
    commitText();
  }, 0));
  requestAnimationFrame(() => area.focus());
  status(existing ? "Editing text. Ctrl+Enter or a click outside finishes; Esc cancels." : "Type your text. Ctrl+Enter or a click outside finishes; Esc cancels.");
}
function closeText() {
  if (!textEditor) return;
  textEditor.hidden?.removeAttribute("visibility");
  textEditor.area.remove();
  textEditor = null;
  hideTextFormat();
}
async function commitText() {
  const t = textEditor;
  if (!t) return;
  const value = t.area.value.replace(/\s+$/, "");
  closeText();
  const text = textPayload(value, t.style);
  const [w, h] = textBoxSize(value || " ", t.style);
  if (t.existing) {
    const same = value === boxText(t.existing) && JSON.stringify(t.style) === JSON.stringify(t.initial);
    if (same) return;
    if (!value.trim()) return action("remove", { page: t.p.index, itemId: t.existing.id });
    return action("editText", { page: t.p.index, itemId: t.existing.id, text, width: w, height: h });
  }
  if (!value.trim()) return;
  await action("image", { page: t.p.index, image: { base64: "", mime: "", bounds: [t.bx, t.by, w, h], layer: t.layer, text } });
}
// Locked items: a dashed outline with a padlock, shown while the Lock tool is chosen.
function lockMarks(view) {
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("lock-layer");
  svg.setAttribute("viewBox", `0 0 ${view.size.join(" ")}`);
  const unit = Math.max(view.size[0], view.size[1]) / 120;
  for (const { bounds: [x, y, w, h] } of view.locked || []) {
    const rect = document.createElementNS(ns, "rect");
    for (const [k, v] of Object.entries({ x: x - unit / 2, y: y - unit / 2, width: w + unit, height: h + unit, rx: unit / 2, "stroke-width": unit / 4, "stroke-dasharray": `${unit} ${unit / 2}` }))
      rect.setAttribute(k, v);
    const badge = document.createElementNS(ns, "g");
    badge.setAttribute("transform", `translate(${x + w - unit * 1.6} ${y - unit * 1.4}) scale(${unit / 10})`);
    badge.innerHTML = `<circle cx="12" cy="12" r="12"/><path d="M7 11h10v8H7zM9 11V8a3 3 0 0 1 6 0v3"/>`;
    svg.append(rect, badge);
  }
  return svg;
}
function pdfImage(href, place) {
  const el = document.createElementNS(ns, "image");
  for (const [k, v] of Object.entries({ href, x: place.x, y: place.y, width: place.width, height: place.height, preserveAspectRatio: "none" }))
    el.setAttribute(k, v);
  return el;
}
// Tape state is a view choice: a mode for the whole note plus per-tape taps.
let tapeMode = "note";
const tapeTaps = new Map();
function tapeOpen(p, tape) {
  const key = `${p.index}:${tape.id}`;
  if (tapeTaps.has(key)) return tapeTaps.get(key);
  return tapeMode === "note" ? tape.revealed : tapeMode === "revealed";
}
function applyTapes(p, render = p.render) {
  for (const tape of p.view?.tapes || []) {
    const el = render?.querySelector(`[data-tape="${tape.id}"]`);
    if (!el) continue;
    const open = tapeOpen(p, tape);
    el.dataset.revealed = open ? "1" : "0";
    el.setAttribute("opacity", open ? "0.18" : "1");
  }
}
function toggleTape(p, tape) {
  tapeTaps.set(`${p.index}:${tape.id}`, !tapeOpen(p, tape));
  applyTapes(p);
  status(tapeOpen(p, tape) ? "Tape lifted. Tap again to cover." : "Covered.");
}
function setTapeMode(mode) {
  tapeMode = mode;
  tapeTaps.clear();
  for (const p of panels) applyTapes(p);
  status(mode === "revealed" ? "All tape lifted." : mode === "covered" ? "All tape covering." : "Tape as saved in the note.");
}
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
  if (panel.thumbnailLoading || panel.thumbnailReady || !doc) return;
  panel.thumbnailLoading = true;
  const note = epoch, version = revision, cache = backgrounds;
  try {
    const result = panel.view || (await call("view", { page: panel.index }));
    if (note !== epoch) return;
    const render = document.createElement("div");
    render.innerHTML = result.svg;
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
        image.src = url;
        await image.decode();
        if (note !== epoch || version !== revision) return;
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(image, 0, 0, width, height);
        const preview = new Image();
        preview.alt = "";
        preview.src = canvas.toDataURL("image/png");
        canvas.width = canvas.height = 0;
        target.replaceChildren(preview);
      } finally { URL.revokeObjectURL(url); }
      panel.thumbnailReady = true;
      panel.thumbnailRevision = version;
    }
  } catch {
    // The numbered fallback remains useful if a thumbnail cannot be decoded.
  } finally {
    panel.thumbnailLoading = false;
    if (note === epoch && version !== revision) renderThumbnail(panel);
  }
}
function updatePagePreview(panel) {
  if (panel.thumbnailRevision === revision) return;
  panel.thumbnailReady = false;
  renderThumbnail(panel);
}
function markPage() {
  for (const panel of panels) {
    if (panel.index === page)
      panel.pageButton?.setAttribute("aria-current", "page");
    else panel.pageButton?.removeAttribute("aria-current");
  }
}
function syncPagePanel() {
  const small = matchMedia("(max-width:700px)").matches;
  $("pagesToggle").setAttribute(
    "aria-expanded",
    String(
      small
        ? $("pagesPanel").classList.contains("open")
        : !$("pagesPanel").hidden,
    ),
  );
}
$("pagesToggle").onclick = () => {
  if (matchMedia("(max-width:700px)").matches) {
    $("pagesPanel").hidden = false;
    $("pagesPanel").classList.toggle("open");
  } else {
    $("pagesPanel").hidden = !$("pagesPanel").hidden;
  }
  syncPagePanel();
  resize();
};
$("closePages").onclick = () => {
  $("pagesPanel").classList.remove("open");
  syncPagePanel();
  $("pagesToggle").focus();
};
matchMedia("(max-width:700px)").addEventListener("change", () => {
  $("pagesPanel").hidden = false;
  syncPagePanel();
});
// Narrow windows: undo, redo and the panel toggles join the page row, so phones get two
// bars (pages, tools) instead of three. Wider windows drop the tool labels before the
// toolbar would wrap or push tools out of sight.
const phoneLayout = matchMedia("(max-width:700px)");
function placeToolbarActions() {
  const actions = document.querySelector(".toolbar-actions");
  if (phoneLayout.matches) document.querySelector(".navigation .spacer").after(actions);
  else $("toolbar").querySelector(".segmented").after(actions);
  fitTools();
}
let fitFrame = 0;
function fitTools() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const bar = $("toolbar"), tools = bar.querySelector(".segmented"), actions = document.querySelector(".toolbar-actions");
    bar.classList.remove("tools-icons");
    const overflowing = phoneLayout.matches
      ? tools.scrollWidth > tools.clientWidth + 1
      : bar.scrollWidth > bar.clientWidth + 1 || tools.getBoundingClientRect().right > bar.getBoundingClientRect().right || actions.offsetTop > tools.offsetTop + 4;
    bar.classList.toggle("tools-icons", overflowing);
  });
}
phoneLayout.addEventListener("change", placeToolbarActions);
addEventListener("resize", fitTools);
placeToolbarActions();
syncPagePanel();
function placeholder(p) {
  p.render = null;
  p.overlay = null;
  p.ink = null;
  const span = document.createElement("span");
  span.className = "page-placeholder";
  span.textContent = `Page ${p.index + 1}`;
  p.el.replaceChildren(span);
}
function resize() {
  if (!doc) return;
  const fit = zoom === "fit",
    pages = $("pages"),
    styles = getComputedStyle(pages);
  const gutter =
    parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const space = Math.max(1, $("viewport").clientWidth - gutter);
  const reraster = [];
  for (const p of panels) {
    p.el.style.width =
      (fit ? space : p.size[0] * zoom) + "px";
    const width = p.el.clientWidth;
    if (
      p.view?.pdf_background &&
      p.rasterWidth > 0 &&
      Math.abs(width - p.rasterWidth) / p.rasterWidth > 0.08 &&
      !p.loading
    )
      reraster.push(p);
  }
  updateZoom();
  selection.render(panels[selection.item?.page]);
  for (const p of reraster) renderPage(p, p.view);
}
async function renderPage(p, provided) {
  if (gesture?.panel === p) {
    p.stale = true;
    return;
  }
  if (p.loading) {
    p.retry = true;
    return;
  }
  p.retry = false;
  p.loading = true;
  const token = ++p.token,
    version = revision,
    note = epoch;
  try {
    const result = provided || (await call("view", { page: p.index }));
    if (note !== epoch || token !== p.token || version !== revision) return;
    if (gesture?.panel === p) {
      p.stale = true;
      return;
    }
    p.view = result;
    const render = document.createElement("div");
    render.className = "render";
    render.innerHTML = result.svg;
    // An edit redraws the page's ink; the PDF raster under it stays the same,
    // so the existing image moves over at once instead of blinking out while
    // the background cache answers.
    const displayWidth = p.el.clientWidth || p.size[0];
    // At another width the old raster (placed in page units) stays as a
    // placeholder until the sharper one arrives.
    const pdfKey = result.pdf_background && JSON.stringify([result.pdf_background, p.size, displayWidth, displayQuality]);
    const previous = result.pdf_background && p.pdfKey && JSON.stringify(JSON.parse(p.pdfKey).slice(0, 2)) === JSON.stringify([result.pdf_background, p.size])
      ? p.render?.querySelector("[data-background] > image") : null;
    if (previous) render.querySelector("[data-background]")?.append(previous);
    const kept = pdfKey === p.pdfKey ? previous : null;
    applyTapes({ ...p, view: result }, render);
    const overlay = document.createElementNS(ns, "svg");
    overlay.classList.add("overlay");
    overlay.setAttribute("viewBox", `0 0 ${p.size.join(" ")}`);
    p.render = render;
    p.overlay = overlay;
    p.el.replaceChildren(render, overlay, lockMarks(result));
    if (resizeMode?.page === p.index) p.el.append(resizeFrame(p));
    if (textFormatTarget?.p === p) p.el.append(textFormatBar);
    find.paint(p);
    find.selectable(p);
    p.pdfReady = !result.pdf_background || !!kept;
    p.ink = indexTimedInk(render, result.timings);
    for (const item of p.ink) {
      item.el.setAttribute("data-timed-ink", "");
      const title = document.createElementNS(ns, "title");
      title.textContent = `Pan: click to seek audio to ${item.timing.start.toFixed(1)} seconds`;
      item.el.prepend(title);
    }
    syncInk();
    shapeHandles(p);
    if (p.index === page) updateTools(result);
    updatePagePreview(p);
    if (result.pdf_background && !kept) {
      const place = backgroundPlacement(result.pdf_background, p.size);
      const image = await backgrounds.image(
        result.pdf_background,
        p.size,
        displayWidth * place.share,
        displayQuality,
      );
      if (note !== epoch || token !== p.token || version !== revision) return;
      render.querySelector("[data-background]").append(pdfImage(image, place));
      previous?.remove();
      p.pdfKey = pdfKey;
      p.pdfReady = true;
      p.rasterWidth = displayWidth;
      updatePagePreview(p);
    }
  } catch (e) {
    if (note === epoch && token === p.token) {
      const error = document.createElement("p");
      error.className = "page-error";
      error.textContent = "Could not display this page: " + e.message;
      p.el.append(error);
    }
  } finally {
    p.loading = false;
    if (note === epoch) {
      if (p.near && (p.retry || version !== revision || token !== p.token))
        renderPage(p);
      if (p.index === page) $("svg").disabled = !p.pdfReady;
    }
  }
}
function updateTools(result) {
  refreshSelects();
  $("undo").disabled = !doc.can_undo;
  $("redo").disabled = !doc.can_redo;
  $("pageNumber").value = page + 1;
  $("pageLabel").textContent = `of ${doc.pages}`;
  $("counts").textContent =
    `${result.visible_imported} ${result.visible_imported === 1 ? "item" : "items"} · ${result.visible_added} new`;
  $("warnings").textContent = result.warnings.join(" ");
  $("svg").disabled = !panels[page]?.pdfReady;
}
function setPage(index) {
  if (index === page) return;
  panels[page]?.el.classList.remove("active");
  page = index;
  markPage();
  const p = panels[page];
  p.el.classList.add("active");
  $("pageNumber").value = page + 1;
  if (p.view) updateTools(p.view);
  else renderPage(p);
  updateZoom();
  notes?.pageChanged(index);
}
// With a box (page units) the page scrolls so that box sits in the upper third.
function jump(index, box) {
  if (!doc || !Number.isInteger(index) || index < 0 || index >= doc.pages)
    return;
  cancelGesture();
  setPage(index);
  const viewport = $("viewport"), rect = panels[index].el.getBoundingClientRect();
  const within = box ? (box[1] / panels[index].size[1]) * rect.height - viewport.clientHeight / 3 : -24;
  viewport.scrollTop += rect.top - viewport.getBoundingClientRect().top + Math.max(-24, within);
  status(`Page ${index + 1}.`);
}
function scrollViewport(key) {
  const viewport = $("viewport"),
    vertical = Math.max(48, Math.round(viewport.clientHeight * 0.8)),
    horizontal = Math.max(48, Math.round(viewport.clientWidth * 0.8));
  if (key === "Home" || key === "End") {
    viewport.scrollTo({
      top: key === "Home" ? 0 : viewport.scrollHeight,
      behavior: "smooth",
    });
    return true;
  }
  const delta = {
    ArrowUp: [0, -vertical],
    ArrowDown: [0, vertical],
    PageUp: [0, -vertical],
    PageDown: [0, vertical],
    ArrowLeft: [-horizontal, 0],
    ArrowRight: [horizontal, 0],
  }[key];
  if (!delta) return false;
  viewport.scrollBy({ left: delta[0], top: delta[1], behavior: "smooth" });
  return true;
}
const barState = new ChromeState();
$("viewport").onscroll = () => {
  document.body.classList.toggle("bar-compact", barState.observe($("viewport").scrollTop));
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    if (!doc) return;
    const top = $("viewport").getBoundingClientRect().top + 80;
    let low = 0,
      high = panels.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (panels[mid].el.getBoundingClientRect().bottom < top) low = mid + 1;
      else high = mid;
    }
    setPage(low);
  });
};
// Tool settings open when a tool is chosen (View menu can turn that off), and
// pressing the selected tool again toggles them.
let toolSettingsAuto = true, optionsOpen = true;
try { toolSettingsAuto = localStorage.getItem("notecomplete-tool-settings-auto") !== "0"; } catch { /* Optional. */ }
$("toolSettingsAuto").setAttribute("aria-checked", String(toolSettingsAuto));
$("toolSettingsAuto").onclick = () => {
  toolSettingsAuto = !toolSettingsAuto;
  $("toolSettingsAuto").setAttribute("aria-checked", String(toolSettingsAuto));
  try { localStorage.setItem("notecomplete-tool-settings-auto", toolSettingsAuto ? "1" : "0"); } catch { /* Optional. */ }
  status(toolSettingsAuto ? "Tool settings open when you choose a tool." : "Press the selected tool again to see its settings.");
};
function toolOptions() {
  $("shapeOptions").hidden = tool !== "shape";
  $("highlightOptions").hidden = tool !== "highlight";
  $("tapeOptions").hidden = tool !== "tape";
  $("drawingOptions").hidden = tool === "select";
  // The eraser shows only its size; color and width do not apply to it.
  $("drawingOptions").classList.toggle("erasing", tool === "erase");
  $("eraseOptions").hidden = tool !== "erase";
  $("selectionOptions").hidden = tool !== "select" || !selection.item;
  $("toolOptions").hidden =
    chromeState.compact || !optionsOpen ||
    (!["draw", "highlight", "shape", "tape", "erase"].includes(tool) &&
      !(tool === "select" && selection.item));
  $("toolbarToggle").setAttribute("aria-expanded", String(!$("toolOptions").hidden));
  syncChoices();
  if (!$("toolOptions").hidden) {
    const anchor = document.querySelector(`#toolbar [data-tool="${tool}"]`), bar = $("toolbar").getBoundingClientRect();
    if (anchor && !matchMedia("(max-width: 700px)").matches) {
      const left = anchor.getBoundingClientRect().left - bar.left;
      $("toolOptions").style.left = `${Math.max(8, Math.min(left, bar.width - $("toolOptions").offsetWidth - 8))}px`;
    }
  }
  syncTextFormat();
  const settingsLabel = $("toolOptions").hidden ? "Show tool settings" : "Hide tool settings";
  $("toolbarToggle").setAttribute("aria-label", settingsLabel);
  $("toolbarToggle").title = settingsLabel;
}
function setCompact(compact) {
  const changed =
    document.body.classList.contains("compact-chrome") !== compact;
  document.body.classList.toggle("compact-chrome", compact);
  chromeState.compact = compact;
  $("toolbarToggle").setAttribute("aria-expanded", String(!compact));
  $("toolbarToggle").setAttribute(
    "aria-label",
    compact ? "Show tools" : "Collapse tools",
  );
  $("toolbarToggle").title = compact ? "Show tools" : "Collapse tools";
  toolOptions();
  if (changed) {
    chromeSettling = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        chromeState.anchor = $("viewport").scrollTop;
        chromeSettling = false;
      }),
    );
  }
}
$("toolbarToggle").onclick = () => {
  cancelGesture();
  setCompact(chromeState.toggle($("viewport").scrollTop));
};
async function action(op, args = {}) {
  if (!doc || editing) return;
  mutationPending++;
  const token = epoch;
  try {
    const result = await call(op, args);
    if (token !== epoch) return;
    dirty = changed = true;
    revision++;
    doc = result;
    savedState();
    // Inserted pages, or a page size changed (a resize, or its undo/redo).
    if (result.pages !== panels.length || result.page_sizes.some((s, i) => s[0] !== panels[i].size[0] || s[1] !== panels[i].size[1])) {
      restructure(result, args.focus ?? Math.min(page, result.pages - 1), op === "resizePage" ? "Page resized. You can undo this change." : undefined);
      return;
    }
    if (op === "draw" && args.line.shape && !gesture) {
      document.querySelector("[data-tool=select]").click();
      selection.selectId(args.page ?? page, `new:${result.edit_count - 1}`);
    } else if (selection.item) {
      selection.selectId(selection.item.page, selection.item.id);
    }
    updateTools(result);
    layerPanel(result.layers);
    // Ink edits change one page; undo, redo and layers may change any.
    const only = ["draw", "erase", "remove", "lock", "image", "editText"].includes(op) ? args.page : null;
    for (const p of panels) {
      if (only != null && p.index !== only) continue;
      p.token++;
      if (p.near || p.index === page)
        renderPage(p, p.index === result.page ? result : undefined);
    }
    status(
      op === "erase"
        ? "Erased. You can undo this change."
        : op === "lock"
          ? args.locked ? "Locked in place: it cannot be selected, moved or erased. Click it again to unlock." : "Unlocked."
          : "Unsaved changes. Save your project to keep them.",
    );
  } catch (e) {
    if (token === epoch) status(e.message, true);
  } finally {
    mutationPending--;
    if (token === epoch) {
      for (const p of panels) {
        if (gesture?.panel !== p) {
          p.overlay?.replaceChildren();
          shapeHandles(p);
        }
      }
    }
  }
}
function syncInk() {
  const recording = audio.recording,
    time = audio.time;
  for (const p of panels) {
    if (p.view) updateTimedInk(p.ink || [], recording?.id, time);
  }
}
function layerPanel(layers) {
  if (!layers.some((l) => l.id === activeLayer))
    activeLayer = layers[0]?.id || 0;
  $("layersList").replaceChildren();
  for (const layer of layers) {
    const row = document.createElement("div");
    row.className = "layer" + (layer.id === activeLayer ? " active" : "");
    const controls = document.createElement("div");
    controls.className = "layer-controls";
    const select = document.createElement("button");
    select.textContent = layer.id === activeLayer ? "●" : "○";
    select.setAttribute("aria-label", `Select ${layer.name}`);
    select.setAttribute("aria-pressed", String(layer.id === activeLayer));
    select.onclick = () => {
      activeLayer = layer.id;
      layerPanel(layers);
    };
    const name = document.createElement("input");
    name.className = "layer-title";
    name.value = layer.name;
    name.setAttribute("aria-label", `Layer name ${layer.id + 1}`);
    name.onchange = () =>
      action("layer", { layer: { ...layer, name: name.value } });
    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.checked = layer.visible;
    visible.setAttribute("aria-label", `Show ${layer.name}`);
    visible.onchange = () =>
      action("layer", { layer: { ...layer, visible: visible.checked } });
    const lock = document.createElement("button");
    lock.textContent = layer.locked ? "Locked" : "Lock";
    lock.setAttribute("aria-label", `Lock ${layer.name}`);
    lock.setAttribute("aria-pressed", String(layer.locked));
    lock.onclick = () =>
      action("layer", { layer: { ...layer, locked: !layer.locked } });
    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = 0;
    opacity.max = 1;
    opacity.step = 0.05;
    opacity.value = layer.opacity;
    opacity.setAttribute("aria-label", `Opacity ${layer.name}`);
    opacity.onchange = () =>
      action("layer", { layer: { ...layer, opacity: Number(opacity.value) } });
    controls.append(select, name, visible);
    row.append(controls, lock, opacity);
    $("layersList").append(row);
  }
}
$("closeLayers").onclick = () => {
  $("layersPanel").hidden = true;
  $("layersToggle").setAttribute("aria-expanded", "false");
  $("layersToggle").focus();
  resize();
};
$("layersToggle").onclick = () => {
  $("layersPanel").hidden = !$("layersPanel").hidden;
  $("layersToggle").setAttribute(
    "aria-expanded",
    String(!$("layersPanel").hidden),
  );
  resize();
};
$("addLayer").onclick = () => {
  const id = Math.max(...doc.layers.map((l) => l.id), -1) + 1;
  activeLayer = id;
  action("layer", {
    layer: {
      id,
      name: `Layer ${id + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
    },
  });
};
function cancelGesture() {
  selection.cancel();
  const g = gesture;
  gesture = null;
  if (!g) return;
  g.panel.overlay?.replaceChildren();
  if (g.hidden) g.hidden.style.visibility = "";
  shapeHandles(g.panel);
  if (g.panel.el.hasPointerCapture(g.id))
    g.panel.el.releasePointerCapture(g.id);
  if (g.panel.stale) {
    g.panel.stale = false;
    renderPage(g.panel);
  }
}
function point(e, p) {
  const r = p.el.getBoundingClientRect();
  return [
    Math.max(
      0,
      Math.min(p.size[0], ((e.clientX - r.left) / r.width) * p.size[0]),
    ),
    Math.max(
      0,
      Math.min(p.size[1], ((e.clientY - r.top) / r.height) * p.size[1]),
    ),
  ];
}
function pointerDown(e, p) {
  if (gesture) {
    if (e.pointerId !== gesture.id) cancelGesture();
    return;
  }
  if (!doc || editing || !p.view || e.button !== 0) return;
  setPage(p.index);
  if (selection.down(e, p, tool)) return;
  if (tool === "pan") {
    // On PDF or recognized words the mouse selects text instead of panning.
    if (e.pointerType !== "mouse" || e.target.closest?.(".text-layer tspan")) return;
    window.getSelection()?.removeAllRanges();
    e.preventDefault();
    gesture = {
      id: e.pointerId,
      tool,
      panel: p,
      x: e.clientX,
      y: e.clientY,
      left: $("viewport").scrollLeft,
      top: $("viewport").scrollTop,
    };
    p.el.setPointerCapture(e.pointerId);
    return;
  }
  if (tool === "text") {
    e.preventDefault();
    openTextEditor(p, point(e, p));
    return;
  }
  if (tool === "lock") {
    e.preventDefault();
    const [x, y] = point(e, p), note = epoch;
    call("pickLock", { page: p.index, x, y, tolerance: 8 * p.size[0] / p.el.getBoundingClientRect().width })
      .then((item) => {
        if (note !== epoch || tool !== "lock") return;
        if (!item) return status("Nothing to lock here. Click a stroke, shape, image or text box.");
        return action("lock", { page: p.index, itemId: item.id, locked: !item.locked });
      })
      .catch((error) => status(error.message, true));
    return;
  }
  if (tool === "grab") {
    e.preventDefault();
    const start = point(e, p), el = document.createElementNS(ns, "rect");
    el.setAttribute("class", "grab-rect");
    p.overlay.append(el);
    $("grabMenu").hidden = true;
    gesture = { id: e.pointerId, tool, panel: p, start, points: [start], el, dot: document.createElementNS(ns, "g") };
    p.el.setPointerCapture(e.pointerId);
    return;
  }
  const layer = doc.layers.find((l) => l.id === activeLayer);
  if (tool !== "erase" && (!layer?.visible || layer.locked)) {
    status("Select a visible, unlocked layer.", true);
    return;
  }
  e.preventDefault();
  const start = point(e, p),
    width = tool === "erase" ? eraserRadius() * 2 : Number($("width").value),
    color = $("color").value;
  const el = document.createElementNS(ns, "polyline"),
    dot = document.createElementNS(ns, "circle");
  for (const [k, v] of Object.entries({
    fill: "none",
    stroke: tool === "erase" ? "#ed6b55" : color,
    "stroke-width": width,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    opacity: tool === "erase" ? 0.3 : tool === "highlight" ? 0.5 : tool === "tape" ? 0.85 : 1,
  }))
    el.setAttribute(k, v);
  // Tape and highlighter rectangles are bands with square ends.
  const box = (tool === "tape" && $("tapeMode").value === "box") || (tool === "highlight" && $("highlightMode").value === "box");
  if (tool === "tape" || box) el.setAttribute("stroke-linecap", "butt");
  dot.setAttribute("r", width / 2);
  dot.setAttribute("fill", tool === "erase" ? "#ed6b55" : color);
  dot.setAttribute(
    "opacity",
    tool === "highlight" ? 0.5 : tool === "erase" ? 0.3 : 1,
  );
  p.overlay.append(el, dot);
  gesture = {
    id: e.pointerId,
    tool,
    box,
    straight: tool === "tape" || (tool === "highlight" && $("highlightMode").value === "straight"),
    panel: p,
    points: [start],
    start,
    width,
    color,
    layer: activeLayer,
    el,
    dot,
  };
  p.el.setPointerCapture(e.pointerId);
  preview();
}
function preview() {
  const g = gesture;
  if (!g || g.tool === "pan") return;
  if (g.tool === "grab") {
    const [x, y, w, h] = grabRect(g);
    for (const [k, v] of Object.entries({ x, y, width: w, height: h })) g.el.setAttribute(k, v);
    return;
  }
  g.el.setAttribute("points", g.points.map((p) => p.join(",")).join(" "));
  g.dot.style.display = g.points.length > 1 ? "none" : "";
  g.dot.setAttribute("cx", g.points[0][0]);
  g.dot.setAttribute("cy", g.points[0][1]);
}
function appendPoint(e) {
  const g = gesture;
  if (g.tool === "shape") {
    g.points = shapePoints($("shape").value, g.start, point(e, g.panel));
  } else if (g.tool === "grab") {
    g.points = [g.start, point(e, g.panel)];
  } else if (g.box) {
    const end = point(e, g.panel), y = (g.start[1] + end[1]) / 2;
    g.width = Math.max(4, Math.abs(end[1] - g.start[1]));
    g.points = [[Math.min(g.start[0], end[0]), y], [Math.max(g.start[0], end[0]), y]];
    g.el.setAttribute("stroke-width", g.width);
  } else if (g.straight) {
    g.points = highlightPoints(g.start, point(e, g.panel));
  } else {
    const samples = e.getCoalescedEvents?.() || [];
    for (const sample of samples.length ? samples : [e]) {
      const p = point(sample, g.panel),
        last = g.points.at(-1);
      if (
        Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.3 &&
        g.points.length < 8192
      )
        g.points.push(p);
    }
  }
  preview();
}
function pointerMove(e) {
  if (selection.move(e)) return;
  if (!gesture || gesture.id !== e.pointerId) return;
  e.preventDefault();
  if (gesture.tool === "pan") {
    $("viewport").scrollLeft = gesture.left + gesture.x - e.clientX;
    $("viewport").scrollTop = gesture.top + gesture.y - e.clientY;
  } else appendPoint(e);
}
function pointerUp(e) {
  if (selection.up(e)) return;
  if (!gesture || gesture.id !== e.pointerId) return;
  if (gesture.tool === "pan") {
    cancelGesture();
    return;
  }
  appendPoint(e);
  const g = gesture;
  gesture = null;
  g.panel.stale = false;
  g.panel.el.releasePointerCapture(e.pointerId);
  if (g.tool === "grab") {
    const rect = grabRect(g);
    if (rect[2] < 8 || rect[3] < 8) { g.el.remove(); return; }
    showGrabMenu(g.panel, rect, g.el);
    return;
  }
  // Tape tool: a tap lifts or covers the tape under it; a drag lays new tape.
  if (g.tool === "tape") {
    const [a, b] = [g.start, point(e, g.panel)];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 8) {
      g.el.remove();
      g.dot.remove();
      const tape = [...(g.panel.view?.tapes || [])].reverse().find(({ bounds: [x, y, w, h] }) => a[0] >= x && a[0] <= x + w && a[1] >= y && a[1] <= y + h);
      if (tape) toggleTape(g.panel, tape);
      else status("Drag across what you want to cover with tape.");
      return;
    }
  }
  if (g.tool === "erase")
    action("erase", { page: g.panel.index, points: g.points, radius: eraserRadius() });
  else {
    const rgba = [1, 3, 5].map(
      (i) => parseInt(g.color.slice(i, i + 2), 16) / 255,
    );
    action("draw", {
      page: g.panel.index,
      line: {
        points: g.points,
        width: g.width,
        rgba: [...rgba, 1],
        tool: g.tool === "highlight" ? 1 : g.tool === "tape" ? 2 : 0,
        layer: g.layer,
        ...(g.box && g.tool === "highlight" ? { square: true } : {}),
        ...(g.tool === "shape"
          ? {
              shape: {
                kind: $("shape").value,
                start: g.start,
                end: point(e, g.panel),
              },
            }
          : {}),
      },
    });
  }
}
for (const button of document.querySelectorAll("[data-tool]"))
  button.onclick = () => {
    cancelGesture();
    // Pressing the selected tool again shows or hides its settings.
    if (tool === button.dataset.tool) {
      optionsOpen = chromeState.compact || !optionsOpen;
      setCompact(false);
      return;
    }
    tool = button.dataset.tool;
    endResizeDrag();
    optionsOpen = toolSettingsAuto;
    if (tool !== "select") selection.clear();
    if (tool !== "grab") clearGrab();
    chromeState.reset($("viewport").scrollTop);
    setCompact(false);
    for (const p of panels) p.el.dataset.tool = tool;
    for (const b of document.querySelectorAll("button[data-tool]"))
      b.setAttribute("aria-pressed", String(b === button));
    for (const p of panels) shapeHandles(p);
    if (tool === "highlight") {
      $("color").value = "#ffdf38";
      $("width").value = "16";
    } else if (tool === "draw") {
      $("color").value = "#246bce";
      $("width").value = "2";
    } else if (tool === "tape") {
      $("color").value = "#e3c6e6";
      $("width").value = "40";
    }
    toolOptions();
    refreshSelects();
    status(
      tool === "select"
        ? "Tap an item to move or edit it."
        : tool === "highlight"
          ? highlightHint()
          : tool === "grab"
            ? "Grab: drag a box to copy its text or ask AI about it."
          : tool === "tape"
            ? "Tape: drag across text to cover it; tap a tape to lift or cover it."
          : tool === "erase"
            ? "Drag to erase whole strokes."
            : tool === "pan"
              ? "Scroll through the pages."
              : "Draw on the selected layer.",
    );
  };
function highlightHint() {
  return { straight: "Straight highlight: drag between the endpoints.", free: "Freehand highlight: draw on the page.", box: "Rectangle highlight: drag a box over what to highlight." }[$("highlightMode").value];
}
$("highlightMode").onchange = () => {
  cancelGesture();
  status(highlightHint());
};
$("shape").onchange = () =>
  document.querySelector('[data-tool="shape"]').click();
// Tool settings are rows of visual choices, like the shapes; hidden selects and
// the color input stay the data source the drawing code reads.
const CHOICE_ICONS = {
  highlightMode: { straight: '<path d="M4 12h16"/>', free: '<path d="M3 14c3-6 5 4 8-2s5 5 10-3"/>', box: '<rect x="4" y="7" width="16" height="10" rx="0.5" fill="currentColor" fill-opacity="0.35"/>' },
  tapeMode: { band: '<rect x="3" y="9" width="18" height="6" rx="0.5"/>', box: '<rect x="5" y="5" width="14" height="14" rx="0.5"/>' },
};
function buildChoices() {
  for (const row of document.querySelectorAll(".choice-row[data-for]")) {
    const id = row.dataset.for, source = $(id);
    const values = id === "color" ? SWATCHES : [...source.options].map((o) => o.value);
    row.replaceChildren(...values.map((value) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.value = value;
      b.setAttribute("role", "radio");
      if (id === "color") {
        b.className = "swatch";
        b.style.setProperty("--swatch", value);
        b.title = value;
      } else {
        const label = source.querySelector(`option[value="${value}"]`).textContent;
        b.title = label;
        b.setAttribute("aria-label", label);
        const line = id === "width" ? `<path d="M3 12h18" stroke-width="${Math.min(14, Math.max(1, Number(value) / 3))}"/>`
          : id === "eraserSize" ? `<circle cx="12" cy="12" r="${Math.min(10, 2 + Math.sqrt(Number(value)) * 1.25).toFixed(1)}"/>` : CHOICE_ICONS[id][value];
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${line}</svg>`;
      }
      b.onclick = () => {
        source.value = value;
        source.dispatchEvent(new Event("change"));
        syncChoices();
      };
      return b;
    }));
  }
}
function syncChoices() {
  for (const row of document.querySelectorAll(".choice-row[data-for]")) {
    const value = $(row.dataset.for).value.toLowerCase();
    for (const b of row.children) b.setAttribute("aria-checked", String(b.dataset.value.toLowerCase() === value));
  }
}
// Eraser size (page units around the pointer); remembered on this device.
const eraserRadius = () => Number($("eraserSize").value) || 10;
try { const saved = localStorage.getItem("notecomplete-eraser-size"); if (saved && $("eraserSize").querySelector(`option[value="${saved}"]`)) $("eraserSize").value = saved; } catch { /* Optional. */ }
$("eraserSize").addEventListener("change", () => { try { localStorage.setItem("notecomplete-eraser-size", $("eraserSize").value); } catch { /* Optional. */ } });
buildChoices();
$("color").addEventListener("input", syncChoices);
// The visible shape row drives the (hidden) select that the drawing code reads.
function syncShapePicker() {
  for (const b of document.querySelectorAll("#shapePicker [data-shape]"))
    b.setAttribute("aria-checked", String(b.dataset.shape === $("shape").value));
}
for (const b of document.querySelectorAll("#shapePicker [data-shape]"))
  b.onclick = () => {
    $("shape").value = b.dataset.shape;
    syncShapePicker();
    if (tool !== "shape") document.querySelector('[data-tool="shape"]').click();
  };
syncShapePicker();
$("pageNumber").onchange = () => jump(Number($("pageNumber").value) - 1);
$("zoomFit").onclick = () => setZoom("fit");
$("zoomOut").onclick = () => stepZoom(-1);
$("zoomIn").onclick = () => stepZoom(1);
// Type a percentage (or "fit") in the zoom box.
$("zoomValue").onkeydown = (e) => {
  if (e.key === "Escape") { e.preventDefault(); $("zoomValue").blur(); updateZoom(); }
  if (e.key !== "Enter") return;
  e.preventDefault();
  const text = $("zoomValue").value.trim().toLowerCase(), n = parseFloat(text.replace(",", "."));
  if (/^(fit|ajustar)/.test(text)) setZoom("fit");
  else if (Number.isFinite(n) && n > 0) setZoom(Math.max(0.1, Math.min(4, n / 100)));
  $("zoomValue").blur();
  updateZoom();
};
$("zoomValue").onfocus = () => $("zoomValue").select();
$("zoomValue").onblur = () => updateZoom();
new ResizeObserver(resize).observe($("viewport"));
// Trackpad pinch (and Ctrl+wheel) zooms towards the pointer. During the gesture
// only a CSS transform scales the pages; the real zoom, with one re-raster of
// the visible PDFs, is applied when the gesture pauses.
let pinch = null;
$("viewport").addEventListener("wheel", (e) => {
  if (!e.ctrlKey || !doc) return;
  e.preventDefault();
  const viewport = $("viewport"), box = viewport.getBoundingClientRect();
  if (!pinch) {
    const base = currentZoom();
    pinch = { base, scale: 1, x: e.clientX - box.left, y: e.clientY - box.top, clientX: e.clientX, clientY: e.clientY };
    // Anchor: the page point under the pointer, as fractions of that page.
    const sheet = document.elementFromPoint(e.clientX, e.clientY)?.closest(".sheet");
    const panel = sheet && panels.find((p) => p.el === sheet);
    if (panel) {
      const r = panel.el.getBoundingClientRect();
      pinch.anchor = { panel, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
    }
    pinch.cx = viewport.scrollLeft + pinch.x;
    pinch.cy = viewport.scrollTop + pinch.y;
    $("pages").style.transformOrigin = `${pinch.cx}px ${pinch.cy}px`;
    $("pages").style.willChange = "transform";
  }
  // Trackpads send small deltas; a wheel notch is ~100 px, so each event is capped to about ×1.2.
  const delta = Math.max(-20, Math.min(20, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
  const step = Math.exp(-delta * 0.009);
  pinch.scale = Math.max(0.1 / pinch.base, Math.min(4 / pinch.base, pinch.scale * step));
  $("pages").style.transform = `scale(${pinch.scale})`;
  $("zoomValue").value = Math.round(pinch.base * pinch.scale * 100) + "%";
  clearTimeout(pinch.timer);
  pinch.timer = setTimeout(() => {
    const { base, scale, cx, cy, x, y, anchor, clientX, clientY } = pinch;
    pinch = null;
    $("pages").style.transform = $("pages").style.transformOrigin = $("pages").style.willChange = "";
    setZoom(Math.round(base * scale * 1000) / 1000);
    if (anchor) {
      // Put the same page point back under the pointer; gaps and centring do not scale.
      const r = anchor.panel.el.getBoundingClientRect();
      viewport.scrollLeft += r.left + anchor.fx * r.width - clientX;
      viewport.scrollTop += r.top + anchor.fy * r.height - clientY;
    } else {
      viewport.scrollLeft = cx * scale - x;
      viewport.scrollTop = cy * scale - y;
    }
  }, 160);
}, { passive: false });
$("undo").onclick = () => {
  cancelGesture();
  action("undo");
};
$("redo").onclick = () => {
  cancelGesture();
  action("redo");
};
// Single-key shortcuts (no modifier, outside text fields). Listed in Help → Keyboard shortcuts.
const SHORTCUTS = [
  ["V", "Pan tool"], ["S", "Select tool"], ["P", "Pen"], ["H", "Highlighter"], ["E", "Eraser"], ["T", "Tape"], ["R", "Shapes"], ["G", "Grab: copy text or ask AI about a region"], ["W", "Text: click to type a text box, or click a text box to edit it"], ["O", "Lock: click an item to lock or unlock it in place"],
  ["/", "Find in note"], ["D", "Dark pages"], ["Shift L", "Layers"], ["N", "Notes (Markdown beside the pages)"], ["A", "Audio and transcript"], ["Shift A", "Go to the page where the recording starts"], ["Shift R", "Record audio into this note / stop and keep it"], ["I", "Dim ink not yet written at this point of the recording"], ["K", "Play / pause recording"], ["J / L", "Back / forward 10 s"], ["Q", "Resume quiz"], ["Shift Q", "New quiz"], ["Shift C", "New flashcards"], ["Shift D", "Saved decks and quizzes"], ["?", "Show keys on buttons (again to hide)"],
  ["Ctrl K", "Commands"], ["Ctrl F", "Find"], ["Ctrl J", "Ask AI"], ["Ctrl N", "New document"], ["Ctrl O", "Open"], ["Ctrl S", "Save"], ["Ctrl Shift N", "New window"], ["Ctrl Z / Ctrl Shift Z", "Undo / redo"], ["Ctrl + / − / 0", "Zoom in / out / fit"], ["Ctrl Shift + / − / 0", "Interface larger / smaller / 100% (desktop app)"], ["Ctrl + trackpad", "Zoom towards the pointer"],
  ["Space", "Flashcards: show answer"], ["1 / 2", "Flashcards: not yet / I knew it"], ["E / V", "Flashcards: edit / double check the card"], ["X (twice)", "Flashcards: discard the card"], ["C", "Flashcards: ask AI to explain the card (the last answer is kept)"], ["M", "Flashcards: minimize the practice window"],
  ["Shift W", "Retake wrong answers"], ["1–4", "Quiz: answer"], ["H", "Quiz: hint (1 point instead of 2)"], ["C", "Quiz: clarify with AI"], ["X (twice)", "Quiz: dispute a wrong question"], ["V", "Quiz: double check and correct"], ["Enter", "Quiz: next question"], ["M / Esc", "Quiz: minimize"],
];
// The tool row can be put in any order by dragging its buttons; remembered here.
const toolGroup = document.querySelector("#toolbar .segmented");
const toolKey = (el) => el.dataset.tool || el.id;
const toolItems = 'button[data-tool], #importImage';
const defaultToolOrder = [...toolGroup.querySelectorAll(toolItems)].map(toolKey);
function arrangeTools(order) {
  const rank = (key) => { const i = order.indexOf(key); return i < 0 ? order.length + defaultToolOrder.indexOf(key) : i; };
  for (const el of [...toolGroup.querySelectorAll(toolItems)].sort((a, b) => rank(toolKey(a)) - rank(toolKey(b)))) toolGroup.append(el);
}
try { const saved = JSON.parse(localStorage.getItem("notecomplete-tool-order") || "null"); if (Array.isArray(saved)) arrangeTools(saved); } catch { /* Optional. */ }
sortable(toolGroup, {
  items: toolItems,
  key: toolKey,
  onReorder: (order) => {
    try { localStorage.setItem("notecomplete-tool-order", JSON.stringify(order)); } catch { /* Optional. */ }
    if (!$("toolOptions").hidden) toolOptions();
    status("Tool order saved. View → Reset tool order puts it back.");
  },
});
$("resetToolOrder").onclick = () => {
  arrangeTools(defaultToolOrder);
  try { localStorage.removeItem("notecomplete-tool-order"); } catch { /* Optional. */ }
  if (!$("toolOptions").hidden) toolOptions();
};
const TOOL_KEYS = { v: "pan", s: "select", p: "draw", h: "highlight", e: "erase", t: "tape", r: "shape", g: "grab", w: "text", o: "lock" };
// "?" toggles a key badge on every button with a single-key shortcut (menus already show theirs, Ctrl ones included).
const KEY_HINTS = {
  ...Object.fromEntries(Object.entries(TOOL_KEYS).map(([key, tool]) => [`#toolbar [data-tool="${tool}"]`, key.toUpperCase()])),
  "#notesToggle": "N", "#audioToggle": "A", "#audioPage": "⇧A", "#recordAudio": "⇧R", "#stopRecording": "⇧R", ".icon-toggle:has(#syncEnabled)": "I", "#layersToggle": "⇧L", "#pagesDark": "D", "#htmlDark": "D", "#textDark": "D", "#backAudio": "J", "#playAudio": "K", "#forwardAudio": "L",
  "#chatToggle": "Ctrl J", "#findClose": "Esc", "#quizMinimize": "M",
  "#practiceReveal": "Space", "#practiceAgain": "1", "#practiceKnow": "2",
};
for (const [selector, key] of Object.entries(KEY_HINTS))
  for (const el of document.querySelectorAll(selector)) {
    el.dataset.key = key;
    // Icon buttons (no visible label) get a corner badge; labelled ones show the key after the label.
    const label = [...el.childNodes].some((n) => (n.nodeType === 3 ? n.textContent.trim().length > 1 : !n.matches?.("svg, input, .sr-only")));
    if (!label && key.length <= 2) el.dataset.keyIcon = "";
  }
function toggleKeyHints() {
  const on = document.body.classList.toggle("show-keys");
  status(on ? "Keys shown on buttons. Press ? again to hide them; Help lists them all." : "Key hints hidden.");
}
function shortcut(e) {
  const k = e.key;
  if (!doc) return sideView()?.visible && k === "d" ? ($("htmlDark").click(), true) : false;
  const tool = !e.shiftKey && TOOL_KEYS[k.toLowerCase()];
  if (tool && !$("editor").hidden) return document.querySelector(`#toolbar [data-tool="${tool}"]`)?.click(), true;
  if (k === "/") return showDocument(), find.open(), true;
  if (k === "L") return $("layersToggle").click(), true;
  if (k === "n") return $("notesToggle").click(), true;
  if (k.toLowerCase() === "a" && !e.shiftKey) return $("audioToggle")?.click(), true;
  if (k === "A" && !$("audioToggle").hidden) return $("audioPage").click(), true;
  if (k === "R" && !$("audioToggle").hidden) return (addedStore.recording ? stopRecording() : (toggleAudio(true), startRecording())), true;
  if (k === "i" && !$("audioToggle").hidden) return $("syncEnabled").click(), true;
  if (!$("audioToggle").hidden && ["j", "k", "l"].includes(k)) {
    if (k === "k") $("playAudio").click();
    else (k === "j" ? $("backAudio") : $("forwardAudio")).click();
    return true;
  }
  if (k === "d") return $("pagesDark").click(), true;
  if (k === "q") return resumeQuiz(), true;
  if (k === "Q") return study.quiz(), true;
  if (k === "C") return study.cards(), true;
  if (k === "D") return study.saved(), true;
  if (k === "W") return showDocument(), quizzes.retakeWrong(), true;
  return false;
}
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!$("qualityDialog").open) openPalette();
    return;
  }
  if ($("qualityDialog").open || $("paletteDialog").open) return;
  if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.matches?.("input,select,textarea,[contenteditable=true]")) {
    e.preventDefault();
    toggleKeyHints();
    return;
  }
  // Flashcard practice floats over the pages: its keys come first.
  if (study.key(e)) {
    e.preventDefault();
    return;
  }
  if (document.querySelector("dialog[open]:not(.floating)")) return;
  if (quizzes.key(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === "Escape") {
    endResizeDrag();
    cancelGesture();
    setCompact(true);
    $("layersPanel").hidden = true;
    $("layersToggle").setAttribute("aria-expanded", "false");
    $("pagesPanel").classList.remove("open");
    syncPagePanel();
    for (const menu of document.querySelectorAll("details.menu")) menu.open = false;
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && doc && !$("editor").hidden && ["+", "=", "-", "_", "0"].includes(e.key)) {
    e.preventDefault();
    if (e.key === "0") setZoom("fit");
    else stepZoom(e.key === "-" || e.key === "_" ? -1 : 1);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    openLocal();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    $("newDocument").click();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    $("newWindow").click();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "j" && doc) {
    e.preventDefault();
    showDocument();
    chat.toggle();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f" && doc && $("editor").hidden === false) {
    e.preventDefault();
    // Ctrl+F toggles: a second press closes the find bar, from the box or anywhere else.
    if (!$("findBar").hidden) $("findClose").click();
    else find.open();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (saveAs) save(saveAs === "noteful", saveAs);
    else save(false);
    return;
  }
  if (e.target.matches?.("input,select,textarea,[contenteditable=true]"))
    return;
  if (!e.metaKey && !e.ctrlKey && !e.altKey && shortcut(e)) {
    e.preventDefault();
    return;
  }
  if (
    !e.target.matches?.("button,[role=option],[data-handle]") &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    scrollViewport(e.key)
  ) {
    e.preventDefault();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    action(e.shiftKey ? "redo" : "undo");
  }
});
$("open").onclick = $("emptyOpen").onclick = () => openLocal();
$("file").onchange = (e) => {
  if (e.target.files[0] && !busy() && canReplace()) {
    notePath = noteEntryKey = "";
    load(e.target.files[0]).then(() => setDocMember(null)).catch(() => {});
  }
  e.target.value = "";
};
$("importImage").onclick = () => $("imageFile").click();
$("imageFile").onchange = (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length) importImages(files);
};
for (const event of ["dragover", "drop"])
  $("drop").addEventListener(event, async (e) => {
    e.preventDefault();
    $("drop").classList.toggle("drag", event === "dragover");
    if (event !== "drop" || busy() || !e.dataTransfer.files.length) return;
    const files = [...e.dataTransfer.files];
    try {
      const bytes = new Uint8Array(await files[0].slice(0, 64).arrayBuffer());
      if (doc && fileKind(files[0].name, bytes) === "image")
        await importImages(files);
      else if (canReplace()) { await load(files[0]); setDocMember(null); }
    } catch (error) {
      status(error.message, true);
    }
  });
$("drop").ondragleave = () => $("drop").classList.remove("drag");
function filename() {
  return (doc?.title || "Note").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}
// Save the project, or export: Noteful alone, Noteful plus the notes as
// Markdown (page breaks marked), or a .notecomp archive holding both.
async function save(native, as = native ? "noteful" : "project") {
  if (!doc || busy()) return;
  cancelGesture();
  editing = true;
  const token = epoch;
  try {
    await notes?.flush();
    const op = { project: "save", noteful: "export", markdown: "export", notecomplete: "exportNotecomplete", notepart: "exportNotecomplete" }[as];
    const data = await call(op, as === "notecomplete" || as === "notepart" ? await addedStore.packed() : {});
    if (token !== epoch) return;
    const delivery = await download(
      data,
      filename() + SAVE_EXT[as],
      as === "project" ? "application/json" : "application/octet-stream",
    );
    if (token !== epoch) return;
    if (as === "markdown") {
      const text = await call("exportMarkdown", { title: doc.title || filename() });
      await download(new TextEncoder().encode(text), filename() + ".md", "text/markdown");
    }
    if (as === saveAs && !delivery.shared) {
      dirty = false;
      savedState();
      status(`Saved as ${filename()}${SAVE_EXT[as]}.`);
      return;
    }
    if (as === "notecomplete" || as === "markdown") {
      const takes = addedStore.list.length;
      status(as === "markdown" ? ".noteful and .md files exported." : `.notecomp file exported: the note, its notes${takes ? ` and ${takes} added recording${takes === 1 ? "" : "s"}` : ""}.`);
      return;
    }
    if (!native && !delivery.shared) {
      dirty = false;
      savedState();
    }
    status(
      delivery.shared
        ? "Choose Save in the device menu."
        : native
          ? ".noteful file exported."
          : "Project saved.",
    );
  } catch (e) {
    status(e.message, true);
  } finally {
    if (token === epoch) editing = false;
  }
}
$("save").onclick = () => (saveAs ? save(saveAs === "noteful", saveAs) : save(false));
// New document: blank pages of a chosen size, saved in the chosen format.
for (const [value, { label }] of Object.entries(PRESETS)) if (value !== "current") $("newPreset").add(new Option(label, value));
$("newPreset").onchange = () => { $("newCustom").hidden = $("newPreset").value !== "custom"; };
$("newDocument").onclick = () => {
  for (const m of document.querySelectorAll("details.menu")) m.open = false;
  try { const f = localStorage.getItem("notecomplete-new-format"); const box = document.querySelector(`[name="newFormat"][value="${f}"]`); if (box) box.checked = true; } catch { /* Optional. */ }
  $("newDialog").showModal();
  $("newName").select();
};
$("newCancel").onclick = () => $("newDialog").close();
$("newCreate").onclick = async () => {
  if (!canReplace()) return;
  const preset = $("newPreset").value, count = Math.max(1, Math.min(200, Math.round(Number($("newCount").value) || 1)));
  const size = preset === "custom" ? [Number($("newWidth").value), Number($("newHeight").value)].map(mmToUnits) : PRESETS[preset].mm.map(mmToUnits);
  if (!size.every((n) => Number.isFinite(n) && n > 0)) return status("Choose a page size.", true);
  const format = document.querySelector('[name="newFormat"]:checked')?.value || "notecomplete";
  try { localStorage.setItem("notecomplete-new-format", format); } catch { /* Optional. */ }
  const title = $("newName").value.trim() || "Untitled";
  $("newDialog").close();
  // A unique stand-in file, so this document's notes and study material get their own key.
  const seed = crypto.getRandomValues(new Uint8Array(16));
  await load(new File([seed], `${title}${SAVE_EXT[format]}`), { kind: "blank", title, sizes: Array.from({ length: count }, () => size), bytes: new ArrayBuffer(0), saveAs: format });
};
$("native").onclick = () => save(true);
$("nativeMarkdown").onclick = () => save(true, "markdown");
$("exportNotecomplete").onclick = () => save(true, "notecomplete");
// Pages as PDF (every page, in the background) or the current page as an image; the IMG
// button opens the format list under the row.
const pageExport = pageExporter({ pageCanvas, call, documentInfo: () => ({ pages: doc?.pages || 0, title: doc?.title || "Note" }), currentPage: () => page, filename, download, jobs: { start: (...a) => jobs.start(...a) }, status });
$("exportPdf").onclick = () => { closeMenus(); if (!busy()) pageExport.pdf(); };
$("imageTypes").replaceChildren(...IMAGE_TYPES.map((t) => {
  const b = document.createElement("button");
  b.type = "button"; b.setAttribute("role", "menuitem"); b.dataset.palette = `Export page as ${t.label}`;
  b.innerHTML = `<span>${t.label}</span><span class="muted">${t.hint}</span>`;
  b.onclick = () => { closeMenus(); pageExport.image(t.id); };
  return b;
}));
$("exportImage").onclick = (e) => {
  e.stopPropagation();
  const open = $("imageTypes").hidden;
  $("imageTypes").hidden = !open;
  $("exportImage").setAttribute("aria-expanded", String(open));
};
function closeMenus() {
  for (const menu of document.querySelectorAll("details.menu")) menu.open = false;
  $("imageTypes").hidden = true;
  $("exportImage").setAttribute("aria-expanded", "false");
}
// Notes panel: Markdown beside the pages (notes.js, loaded on first use).
let notes = null, notesLoading = null;
function notesApi() {
  return notesLoading ||= import("./notes.js").then(({ notesController }) => {
    notes = notesController({ call, jump, currentPage: () => page, store: library.store, status });
    if (doc) return notes.load(find.fingerprint).then(() => notes);
    return notes;
  });
}
$("notesToggle").onclick = async () => {
  const api = await notesApi();
  if (api.visible) await api.close();
  else await api.open();
  $("notesToggle").setAttribute("aria-expanded", String(api.visible));
  resize();
};
$("closeNotes").onclick = () => $("notesToggle").click();
// The panel's left edge resizes it; the width is remembered.
try { const w = Number(localStorage.getItem("notecomplete-notes-width")); if (w >= 240) $("notesPanel").style.width = `${w}px`; } catch { /* Optional. */ }
$("notesResize").onpointerdown = (down) => {
  down.preventDefault();
  const start = down.clientX, width = $("notesPanel").offsetWidth;
  $("notesResize").setPointerCapture(down.pointerId);
  $("notesResize").onpointermove = (e) => { $("notesPanel").style.width = `${Math.max(240, Math.min(innerWidth * 0.7, width + start - e.clientX))}px`; };
  $("notesResize").onpointerup = () => {
    $("notesResize").onpointermove = $("notesResize").onpointerup = null;
    try { localStorage.setItem("notecomplete-notes-width", String($("notesPanel").offsetWidth)); } catch { /* Optional. */ }
    resize();
  };
};
$("svg").onclick = async () => {
  const p = panels[page];
  if (p?.pdfReady && !busy()) {
    await download(
      new XMLSerializer().serializeToString(p.render.firstElementChild),
      `${filename()}-p${page + 1}.svg`,
      "image/svg+xml",
    ).catch((e) => status(e.message, true));
  }
};
window.addEventListener("beforeunload", (e) => {
  if (dirty && changed) {
    e.preventDefault();
    e.returnValue = "";
  }
});
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});

function shapeHandles(p) {
  selection.render(p);
}
async function patchItem(item, adjustment, crop = null) {
  if (busy() || !doc) return null;
  editing = true;
  const token = epoch;
  try {
    const result = crop
      ? await call("crop", { page: item.page, itemId: item.id, rect: crop })
      : await call("adjust", { page: item.page, itemId: item.id, adjustment });
    if (token !== epoch) return null;
    dirty = changed = true;
    savedState();
    Object.assign(doc, {
      can_undo: result.can_undo,
      can_redo: result.can_redo,
      edit_count: result.edit_count,
    });
    const p = panels[item.page],
      el = p.render?.querySelector(`[data-item="${item.id}"]`);
    if (el) {
      el.innerHTML = result.svg;
      el.removeAttribute("transform");
    }
    if (p.view) {
      Object.assign(p.view, {
        can_undo: result.can_undo,
        can_redo: result.can_redo,
        edit_count: result.edit_count,
      });
    }
    $("undo").disabled = !result.can_undo;
    $("redo").disabled = !result.can_redo;
    status("Item updated. You can undo this change.");
    return result;
  } catch (e) {
    if (token === epoch) status(e.message, true);
    return null;
  } finally {
    if (token === epoch) editing = false;
  }
}
$("insertShape").onclick = () => {
  if (!doc || editing) return;
  document.querySelector('[data-tool="shape"]').click();
  const p = panels[page],
    r = p.el.getBoundingClientRect(),
    v = $("viewport").getBoundingClientRect();
  const cy = Math.max(
    80,
    Math.min(
      p.size[1] - 80,
      (((Math.max(r.top, v.top) + Math.min(r.bottom, v.bottom)) / 2 - r.top) /
        r.height) *
        p.size[1],
    ),
  );
  const start = [p.size[0] / 2 - 100, Math.min(p.size[1] - 160, cy - 60)],
    end = [p.size[0] / 2 + 100, Math.min(p.size[1] - 20, cy + 60)],
    shape = { kind: $("shape").value, start, end },
    rgba = [1, 3, 5].map(
      (i) => parseInt($("color").value.slice(i, i + 2), 16) / 255,
    );
  action("draw", {
    page,
    line: {
      points: shapePoints(shape.kind, start, end),
      shape,
      width: Number($("width").value),
      rgba: [...rgba, 1],
      tool: 0,
      layer: activeLayer,
    },
  });
};

$("audioDownload").onclick = async (event) => {
  if (!window.ReactNativeWebView) return;
  event.preventDefault();
  try {
    const { href, download: name } = event.currentTarget;
    const blob = await (await fetch(href)).blob();
    await download(blob, name, blob.type);
  } catch (e) {
    status(e.message, true);
  }
};

function currentZoom() {
  const p = panels[page];
  return p ? p.el.getBoundingClientRect().width / p.size[0] : 1;
}
function updateZoom() {
  const value = currentZoom();
  if (document.activeElement !== $("zoomValue")) $("zoomValue").value = zoom === "fit" ? "Fit" : Math.round(value * 100) + "%";
  $("zoomFit").setAttribute("aria-pressed", String(zoom === "fit"));
  $("zoomOut").disabled = value <= 0.1;
  $("zoomIn").disabled = value >= 4;
}
function setZoom(value) {
  cancelGesture();
  zoom = value;
  resize();
}
function stepZoom(direction) {
  const value = Math.round(currentZoom() * 100) / 100;
  setZoom(Math.max(0.1, Math.min(4, value + direction * 0.1)));
}

receiveNativeFiles({ open: load, canReplace, isBusy: busy, status });

// Audio and transcript live in a side panel opened from the toolbar (A).
function toggleAudio(open = $("audioBar").hidden) {
  if ($("audioToggle").hidden) return;
  $("audioBar").hidden = !open;
  $("audioToggle").setAttribute("aria-expanded", String(open));
  if (open) audio.transcript.lookup();
}
// Dark pages: inverts the document and its page previews (presentation only, never exported).
// HTML documents follow the same switch (Dark Reader inside the page, see htmlDarkApply).
function setDarkPages(on) {
  document.body.classList.toggle("pages-dark", on);
  $("pagesDark").setAttribute("aria-pressed", String(on));
  try { localStorage.setItem("notecomplete-dark-pages", on ? "1" : ""); } catch { /* Optional. */ }
  if (htmlViewReady) htmlDarkApply();
}
$("pagesDark").onclick = () => setDarkPages(!document.body.classList.contains("pages-dark"));
// Page position (left, middle, right) when pages are narrower than the window; remembered.
function setPageAlign(align) {
  // Keep the current page where it is on screen while the layout changes.
  const sheet = panels[page]?.el, before = sheet?.getBoundingClientRect().left;
  $("pages").dataset.align = align;
  if (sheet && before !== undefined) $("viewport").scrollLeft += sheet.getBoundingClientRect().left - before;
  for (const b of document.querySelectorAll("#pageAlign [data-align]")) b.setAttribute("aria-checked", String(b.dataset.align === align));
  $("pageAlignFree").setAttribute("aria-pressed", String(align === "free"));
  for (const b of document.querySelectorAll("[data-align-menu]")) b.setAttribute("aria-pressed", String(b.dataset.alignMenu === align));
  try { localStorage.setItem("notecomplete-page-align", align); } catch { /* Optional. */ }
}
for (const b of document.querySelectorAll("#pageAlign [data-align]")) b.onclick = () => setPageAlign(b.dataset.align);
$("pageAlignFree").onclick = () => setPageAlign($("pages").dataset.align === "free" ? "center" : "free");
for (const b of document.querySelectorAll("[data-align-menu]")) b.onclick = () => { setPageAlign(b.dataset.alignMenu); for (const m of document.querySelectorAll("details.menu")) m.open = false; };
try { setPageAlign(["left", "right", "free"].includes(localStorage.getItem("notecomplete-page-align")) ? localStorage.getItem("notecomplete-page-align") : "center"); } catch { setPageAlign("center"); }
// Audio for transcription: a small popover under the transport row.
$("speechSettingsToggle").onclick = () => {
  const open = $("speechSettings").hidden;
  $("speechSettings").hidden = !open;
  $("speechSettingsToggle").setAttribute("aria-expanded", String(open));
};
try { setDarkPages(localStorage.getItem("notecomplete-dark-pages") === "1"); } catch { /* Optional. */ }
$("audioToggle").onclick = () => toggleAudio();
// Floating windows may cover the whole screen below the top bar (menus stay reachable).
const screenArea = () => { const top = Math.round(document.querySelector("header.chrome")?.getBoundingClientRect().bottom || 0); return { left: 0, top, width: innerWidth, height: innerHeight - top }; };
floatingWindow($("audioBar"), { screen: screenArea, key: "notecomplete-audio-window", head: $("audioBar").querySelector(".audio-head"), close: $("audioClose"), label: "Audio", compact: { cls: "compact" }, scroll: true });
floatingWindow($("chatPanel"), { screen: screenArea, key: "notecomplete-chat-window", head: $("chatPanel").querySelector(".chat-head"), close: $("chatClose"), label: "Ask AI", compact: { cls: "compact" }, minHeight: 220 });
$("audioClose").onclick = () => toggleAudio(false);
$("transcriptEdit").onclick = () => audio.transcript.toggleEdit();

// Opening from Drive or Recent goes through the same unsaved-changes check as local files.
async function openChosen(file) {
  if (!ready || busy()) throw Error("Wait for the current operation to finish, then choose the file again.");
  if (!canReplace()) return false;
  await load(file);
  return true;
}
const library = new Library();
// Audio added here: Record (Shift R) and Import in the audio panel, kept per note (recorder.js).
addedStore = addedAudio({ store: library.store });
let addedList = addedStore.list, clockTimer = 0;
addedStore.onchange = (list) => {
  if (list !== addedList) { addedList = list; audio.setAdded(list); }
  recordingState();
};
function recordingState() {
  const r = addedStore.recording;
  $("recordingRow").hidden = !r;
  $("audioSources").hidden = !!r;
  for (const el of [$("audioToggle"), $("recordingRow")]) { el.classList.toggle("recording", !!r); el.classList.toggle("paused", !!r?.paused); }
  $("audioToggle").title = r ? `Recording ${clock(r.seconds)}: audio and transcript (A)` : "Audio and transcript (A)";
  if (r) {
    $("recordingClock").textContent = clock(r.seconds);
    $("recordingNote").textContent = r.paused ? "Paused" : "Recording";
    $("pauseRecording").textContent = r.paused ? "Resume" : "Pause";
  }
  clearTimeout(clockTimer);
  if (r && !r.paused) clockTimer = setTimeout(recordingState, 500);
  $("removeAudio").hidden = !audio.selected?.added;
}
async function startRecording() {
  if (addedStore.recording) return;
  try {
    await addedStore.start();
    audio.audio.pause();
    status("Recording. Stop keeps it in this note.");
  } catch (e) {
    status(e.name === "NotAllowedError" ? "Microphone access was refused." : e.name === "NotFoundError" ? "No microphone found." : e.message, true);
  }
  recordingState();
}
async function stopRecording() {
  if (!addedStore?.recording) return;
  try {
    const take = await addedStore.stop();
    if (take) status(`${take.name} kept in this note (${Math.round(take.blob.size / 1024)} KB).`);
  } catch (e) { status(e.message, true); }
  recordingState();
}
function disarmRemove() { delete $("removeAudio").dataset.armed; $("removeAudio").textContent = "Remove"; }
audio.onselect = () => { disarmRemove(); recordingState(); };
$("recordAudio").onclick = startRecording;
$("stopRecording").onclick = stopRecording;
$("pauseRecording").onclick = () => { addedStore.pause(); recordingState(); };
$("importAudio").onclick = () => $("audioFile").click();
$("audioFile").accept = AUDIO_TYPES;
$("audioFile").onchange = async () => {
  const file = $("audioFile").files[0];
  $("audioFile").value = "";
  if (!file) return;
  try { const added = await addedStore.import(file); status(`${added.name} added to this note.`); }
  catch (e) { status(e.message, true); }
};
$("removeAudio").onclick = async () => {
  const entry = audio.selected, button = $("removeAudio");
  if (!entry?.added) return;
  if (button.dataset.armed !== "1") { button.dataset.armed = "1"; button.textContent = "Press again to remove"; return; }
  disarmRemove();
  await addedStore.remove(entry.added.id).catch((e) => status(e.message, true));
  status(`${entry.added.name} removed from this note.`);
};
window.addEventListener("beforeunload", (e) => { if (addedStore.recording) { e.preventDefault(); e.returnValue = ""; } });
// The open note's file on disk (desktop), so AI tools can read other pages via MCP,
// and its Recent entry, so removing it can first upload unsaved changes to Drive.
let notePath = "", noteEntryKey = "";
const drive = driveBrowser({
  library,
  onCards: () => home?.applyFilters(),
  open: async (file, driveFile) => {
    const opened = await openChosen(file);
    if (opened) {
      home.rememberCover(library.coverKey(driveFile), file);
      home.rememberFacts(library.coverKey(driveFile), file);
      notePath = await library.pathOf(await library.entry(driveFile)).catch(() => "");
      noteEntryKey = library.key(driveFile);
      rememberDocument(noteEntryKey);
      setDocMember({ key: noteEntryKey, name: driveFile.name, source: "drive" });
    }
    return opened;
  },
});
// The kept copy's MD5 (the core computes it), to match Drive's md5Checksum.
library.md5 = (bytes) => call("md5", { bytes: bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer });
async function openFromLibrary(file, entry) {
  const opened = await openChosen(file);
  if (opened) {
    notePath = await library.pathOf(entry).catch(() => ""); noteEntryKey = entry?.key || ""; rememberDocument(noteEntryKey);
    setDocMember(entry?.source === "local" ? localMember(entry.path, entry.name) : entry?.key ? { key: entry.key, name: entry.name, source: "drive" } : null);
  }
  return opened;
}
// Which file a fingerprint belongs to, for All quizzes (`doc:<fingerprint>`).
async function rememberDocument(entryKey = "") {
  const fp = (doc && find.fingerprint) || (sideView() && sideFp);
  if (!fp) return;
  const before = await library.store.get("settings", `doc:${fp}`).catch(() => null);
  await library.store.set("settings", `doc:${fp}`, { title: doc?.title || sideView()?.name || $("title").textContent, entryKey: entryKey || before?.entryKey || "", at: Date.now() }).catch(() => {});
}
// ⋯ on a Recent note: its decks and quizzes to Anki, without opening it.
async function exportStudyOf(entry) {
  const file = await library.open(entry);
  if (!file) throw Error(`${entry.name} is no longer kept on this device.`);
  const fp = await noteFingerprint(file), title = entry.name.replace(/\.[^.]+$/, "");
  const [decks, quizList] = await Promise.all(["decks", "quizzes"].map((kind) => library.store.get("settings", `${kind}:${fp}`).catch(() => null)));
  const groups = studyGroups(title, decks || [], quizList || []);
  if (!groups.length) return status(`${title} has no flashcards or quizzes yet.`, true);
  await download(ankiDecks(groups), `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")} · study.txt`, "text/plain");
  status(`Exported ${groups.length} deck${groups.length === 1 ? "" : "s"} to Anki. In Anki: File → Import.`);
}
// Recent asks Drive for newer versions before opening a Drive note (versions.js).
const versions = versionChooser({ library, drive, open: openFromLibrary, status, fingerprint: (file) => noteFingerprint(file).catch(() => "") });
// Dark pages (moon, D) darken HTML documents too; pages already dark are left alone.
let darkReader = null;
const htmlView = htmlViewer({
  root: $("htmlView"),
  frame: $("htmlFrame"),
  title: $("htmlTitle"),
  reload: $("htmlReload"),
  clear: $("htmlClear"),
  status,
  darkScript: () => (darkReader ||= fetch("vendor/darkreader/darkreader.js").then((r) => {
    if (!r.ok) throw Error("Dark Reader is missing from this build.");
    return r.text();
  }).catch((error) => { darkReader = null; status(error.message, true); throw error; })),
  // The dark theme's --canvas and --ink, also when the app itself is light.
  darkColors: () => ({ mode: 1, brightness: 100, contrast: 100, sepia: 0, darkSchemeBackgroundColor: "#15171b", darkSchemeTextColor: "#e5e8ed" }),
  onOwnDark: (own) => {
    $("htmlDark").title = own ? "Dark pages (D): this page already has a dark design, so it is left as it is" : "Dark pages: darken this page (D)";
  },
});
function htmlDarkApply() {
  const on = document.body.classList.contains("pages-dark");
  $("htmlDark").setAttribute("aria-pressed", String(on));
  $("textDark").setAttribute("aria-pressed", String(on));
  htmlView.setDark(on);
}
$("htmlDark").onclick = $("textDark").onclick = () => setDarkPages(!document.body.classList.contains("pages-dark"));
var htmlViewReady = true;
const textView = textViewer({ root: $("textView"), body: $("textBody"), title: $("textTitle"), format: $("textMarkdown"), toHtml: (value) => call("markdownHtml", { text: value }) });
// The open HTML or text document, when one is open instead of a note.
function sideView() { return htmlView.hasDocument ? htmlView : textView.hasDocument ? textView : null; }
htmlDarkApply();
var home = homeScreen({
  library,
  drive,
  versions,
  open: openFromLibrary,
  status,
  exportStudy: exportStudyOf,
  current: () => ({
    entryKey: noteEntryKey,
    dirty,
    exportBlob: async () => new Blob([await call("export")], { type: "application/octet-stream" }),
  }),
});
// The desktop bridge opens files itself so Recent can reopen them by path.
async function openLocal() {
  const bridge = window.notecompleteFiles;
  if (!bridge?.openFile) return $("file").click();
  try {
    const chosen = await bridge.openFile();
    if (!chosen) return;
    const file = new File([chosen.bytes], chosen.name);
    if (busy() || !canReplace()) return;
    await load(file);
    await openedLocal(chosen.path, chosen.name, file);
  } catch (error) {
    status(error.message, true);
  }
}
async function openedLocal(path, name, file) {
  notePath = path;
  noteEntryKey = "";
  const entry = await library.rememberLocal(path, name, file.size);
  rememberDocument(entry.key);
  home.rememberCover(entry.key, file);
  home.rememberFacts(entry.key, file);
  setDocMember(localMember(path, name));
}
// Groups (groups.js): the open document's group is listed beside it, in the pages panel or
// at the left of HTML and text documents. Only documents reopenable by key can be grouped.
const groups = groupStore({ store: library.store });
const groupList = groupPanel({ root: $("groupPanel"), name: $("groupName"), list: $("groupList"), add: $("groupAdd"), groups, open: openMember, status, onChange: () => syncSideButtons() });
// The sidebar button of HTML and text documents shows or hides the group list, like Pages in notes.
let sideListOpen = true;
function syncSideButtons() {
  const grouped = Boolean(groupList.group);
  for (const id of ["htmlSide", "textSide"]) {
    $(id).disabled = !grouped;
    $(id).setAttribute("aria-expanded", String(grouped && sideListOpen));
    $(id).title = !grouped ? "Documents: File → Add documents… groups files to jump between" : sideListOpen ? "Hide the documents in this group" : "Show the documents in this group";
  }
  for (const body of document.querySelectorAll(".side-body")) body.classList.toggle("group-off", !sideListOpen);
}
$("htmlSide").onclick = $("textSide").onclick = () => { sideListOpen = !sideListOpen; syncSideButtons(); };
let docMember = null;
function setDocMember(member) {
  docMember = member;
  groupList.mount(htmlView.hasDocument ? $("htmlGroupSlot") : textView.hasDocument ? $("textGroupSlot") : $("pagesGroupSlot"));
  $("addDocuments").disabled = !member;
  return groupList.set(member);
}
async function openMember(member) {
  if (busy() || !canReplace()) return;
  if (member.source === "local") {
    const bytes = await window.notecompleteFiles?.readRecent(member.path);
    if (!bytes) throw Error(`${member.name} is no longer in its folder.`);
    const file = new File([bytes], member.name);
    await load(file);
    return openedLocal(member.path, member.name, file);
  }
  const entry = await library.store.get("entries", member.key).catch(() => null);
  const file = entry && await library.open(entry);
  if (!file) throw Error(`${member.name} is not kept on this device any more. Open it again from Drive.`);
  await openFromLibrary(file, entry);
}
if (window.notecompleteFiles?.openFolder) {
  $("openFolder").hidden = $("addDocuments").hidden = false;
  $("openFolder").onclick = async () => {
    try {
      const chosen = await window.notecompleteFiles.openFolder();
      if (!chosen) return;
      await groups.openFolder(chosen);
      if (!chosen.files.length) return status(`${chosen.name} has no notes, PDFs, HTML, text or images.`, true);
      await openMember(localMember(chosen.files[0].path, chosen.files[0].name));
    } catch (error) { status(error.message, true); }
  };
  $("addDocuments").onclick = () => groupList.pick().catch((error) => status(error.message, true));
}
function showDocument() {
  home.hide();
  const side = sideView();
  if (side) {
    $("editor").hidden = true;
    side.show();
  } else {
    $("htmlView").hidden = true;
    $("textView").hidden = true;
    $("editor").hidden = false;
    if (panels[page]) resize();
  }
}
function showHome() {
  if (!$("editor").hidden && doc) $("editor").hidden = true;
  sideView()?.hide();
  home.show(Boolean(doc || sideView()));
}
$("homeButton").onclick = showHome;
$("homeBack").onclick = () => (doc || sideView()) && showDocument();
$("driveOpen").onclick = () => {
  showHome();
  $("driveSection").scrollIntoView({ behavior: "smooth", block: "start" });
};
function documentControls() {
  const open = !!doc;
  for (const id of ["save", "native", "nativeMarkdown", "exportNotecomplete", "exportPdf", "exportImage", "importImage", "gotoPage", "findOpen", "ocrOpen", "insertBlank", "insertPdf", "resizePage", "resizeDrag", "tapeReveal", "tapeCover", "tapeNote", "studyCards", "studyQuiz", "studyResume", "studyRetake", "studyOpenDeck", "studyExportQuiz", "exportStudy", "scratchOpen", "chatOpen", "chatToggle"])
    if ($(id)) $(id).disabled = !open;
  if (!open) $("svg").disabled = true;
}
// Menu items that mirror toolbar controls share their handler and state.
const proxies = [...document.querySelectorAll("#commandBar [data-proxy], #commandBar [data-proxy-tool]")];
function proxyTarget(item) {
  return item.dataset.proxy
    ? $(item.dataset.proxy)
    : document.querySelector(`#toolbar button[data-tool="${item.dataset.proxyTool}"]`);
}
function syncMenus() {
  for (const item of proxies) {
    const target = proxyTarget(item);
    const inEditor = target?.closest("#editor");
    item.disabled = !target || target.disabled || target.hidden || (!!inEditor && (!doc || $("editor").hidden));
    if (item.dataset.proxyTool) item.setAttribute("aria-checked", String(target?.getAttribute("aria-pressed") === "true"));
  }
}
for (const item of proxies) item.onclick = () => proxyTarget(item)?.click();
for (const menu of document.querySelectorAll("details.bar-menu")) {
  menu.addEventListener("toggle", () => menu.open && syncMenus());
  // Like a native menubar: once one menu is open, hovering another switches to it.
  menu.querySelector("summary").addEventListener("pointerenter", () => {
    if (!menu.open && document.querySelector("details.bar-menu[open]")) menu.open = true;
  });
}
$("gotoPage").onclick = () => palette.open("page ");
// Text selected on a page copies as lines in reading order.
document.addEventListener("copy", (event) => {
  const text = selectedText(window.getSelection());
  if (!text) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
  status(`Copied ${text.split(/\s+/).length} words.`);
});
// Grab tool: a region of a page for the AI chat, or its text for the clipboard.
function grabRect(g) {
  const [a, b] = [g.start, g.points.at(-1)];
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
}
let grabbed = null;
function showGrabMenu(p, rect, el) {
  grabbed?.el.remove();
  grabbed = { page: p.index, rect, el };
  const box = p.el.getBoundingClientRect(), work = document.querySelector(".workspace").getBoundingClientRect(), k = box.width / p.size[0];
  const menu = $("grabMenu");
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(work.width - menu.offsetWidth - 8, box.left - work.left + rect[0] * k))}px`;
  menu.style.top = `${Math.max(8, Math.min(work.height - 44, box.top - work.top + (rect[1] + rect[3]) * k + 8))}px`;
}
function clearGrab() {
  grabbed?.el.remove();
  grabbed = null;
  $("grabMenu").hidden = true;
}
async function grabImage() {
  const { page: index, rect: [x, y, w, h] } = grabbed;
  const { canvas, scale } = await pageCanvas(index, 2200, { liftTape: true });
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, Math.round(w * scale));
  crop.height = Math.max(1, Math.round(h * scale));
  crop.getContext("2d").drawImage(canvas, x * scale, y * scale, crop.width, crop.height, 0, 0, crop.width, crop.height);
  canvas.width = canvas.height = 0;
  return crop.toDataURL("image/jpeg", 0.88);
}
$("grabCopy").onclick = async () => {
  if (!grabbed) return;
  const text = await find.wordsIn(grabbed.page, grabbed.rect);
  if (!text) return status("No text there yet. Run Pages → Recognize text (OCR) on this page to copy handwriting.", true);
  try { await navigator.clipboard.writeText(text); status(`Copied ${text.split(/\s+/).length} words.`); }
  catch { status("The clipboard is not available here.", true); }
  clearGrab();
};
$("grabAttach").onclick = async () => {
  if (!grabbed) return;
  chat.attach(await grabImage(), `a region of page ${grabbed.page + 1}`);
  await chat.open();
  clearGrab();
};
$("grabAsk").onclick = async () => {
  if (!grabbed) return;
  chat.attach(await grabImage(), `a region of page ${grabbed.page + 1}`);
  await chat.open();
  $("chatInput").placeholder = "What would you like to know about this region?";
  $("chatInput").focus();
  clearGrab();
};
$("grabCancel").onclick = clearGrab;
$("tapeReveal").onclick = () => setTapeMode("revealed");
$("tapeCover").onclick = () => setTapeMode("covered");
$("tapeNote").onclick = () => setTapeMode("note");
$("findOpen").onclick = () => { showDocument(); find.open(); };
$("ocrOpen").onclick = () => find.openOcr(page);
// Inserted pages (or undoing them) change the page list: rebuild it and stay on `focus`.
function restructure(result, focus, message) {
  observer?.disconnect();
  thumbnailObserver?.disconnect();
  selection.clear();
  $("pages").replaceChildren();
  buildPages(result.page_sizes);
  $("pageNumber").max = result.pages;
  updateTools(result);
  layerPanel(result.layers);
  find.restructure();
  requestAnimationFrame(() => {
    jump(Math.max(0, Math.min(focus, result.pages - 1)));
    status(message || `${result.pages} pages. You can undo this change.`);
  });
}
// Pages → Page size: presets, extra writing space or a custom size; the PDF
// keeps its place unless it is scaled to the new size.
const RESIZE_PRESETS = {
  right50: "Add space on the right (half width)", right100: "Add space on the right (full width)", below50: "Add space below (half height)",
  a4: PRESETS.a4.label, a4l: PRESETS.a4l.label, letter: PRESETS.letter.label, slide43: PRESETS.slide43.label, slide169: PRESETS.slide169.label,
  original: "Original size", custom: "Custom size",
};
for (const [value, label] of Object.entries(RESIZE_PRESETS)) $("resizePreset").add(new Option(label, value));
$("resizePreset").onchange = () => { $("resizeCustom").hidden = $("resizePreset").value !== "custom"; };
const mm = (units) => Math.round(unitsToMm(units));
function resizeTarget() {
  const view = panels[page]?.view, base = view?.base_size || view?.size;
  const preset = $("resizePreset").value;
  if (SPACE[preset]) return base.map((v, i) => v * SPACE[preset].grow[i]);
  if (preset === "original") return [...base];
  if (preset === "custom") return [Number($("resizeWidth").value), Number($("resizeHeight").value)].map(mmToUnits);
  return PRESETS[preset].mm.map(mmToUnits);
}
$("resizePage").onclick = () => {
  const view = panels[page]?.view;
  if (!doc || !view) return;
  $("resizeCurrent").textContent = `Page ${page + 1} is ${mm(view.size[0])} × ${mm(view.size[1])} mm.`;
  $("resizeWidth").value = mm(view.size[0]);
  $("resizeHeight").value = mm(view.size[1]);
  $("resizeFitRow").hidden = !view.pdf_background;
  $("resizeFit").checked = false;
  $("resizeCustom").hidden = $("resizePreset").value !== "custom";
  $("resizeDialog").showModal();
};
$("resizeCancel").onclick = () => $("resizeDialog").close();
// Resize by dragging: handles on the current page's right edge, bottom edge
// and corner (content is anchored top left, so those are the edges that move).
let resizeMode = null;
function resizeFrame(p) {
  const frame = document.createElement("div");
  frame.className = "page-resize-frame";
  const label = document.createElement("div");
  label.className = "page-resize-label";
  const done = document.createElement("button");
  done.type = "button";
  done.textContent = "Done";
  done.onclick = () => endResizeDrag();
  const text = document.createElement("span");
  const show = (size) => {
    frame.style.width = `${(size[0] / p.size[0]) * 100}%`;
    frame.style.height = `${(size[1] / p.size[1]) * 100}%`;
    text.textContent = `${mm(size[0])} × ${mm(size[1])} mm`;
  };
  label.append(text, done);
  frame.append(label);
  for (const edge of ["e", "s", "se"]) {
    const handle = document.createElement("div");
    handle.className = `page-resize-handle ${edge}`;
    handle.title = { e: "Drag to change the width", s: "Drag to change the height", se: "Drag to change the size" }[edge];
    handle.onpointerdown = (e) => {
      if (e.button !== 0 || !doc || busy()) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const rect = p.el.getBoundingClientRect(), scale = rect.width / p.size[0];
      let size = [...p.size];
      handle.onpointermove = (m) => {
        size = [
          edge.includes("e") ? Math.max(50, (m.clientX - rect.left) / scale) : p.size[0],
          edge.includes("s") ? Math.max(50, (m.clientY - rect.top) / scale) : p.size[1],
        ];
        show(size);
      };
      handle.onpointerup = handle.onpointercancel = (u) => {
        handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
        const next = size.map((v) => Math.round(v));
        if (u.type === "pointerup" && next.some((v, i) => Math.abs(v - p.size[i]) >= 1))
          action("resizePage", { page: p.index, size: next, focus: p.index });
        else show(p.size);
      };
    };
    frame.append(handle);
  }
  show(p.size);
  return frame;
}
function startResizeDrag() {
  const p = panels[page];
  if (!doc || !p?.view) return;
  endResizeDrag();
  resizeMode = { page };
  p.el.append(resizeFrame(p));
  status("Drag the right or bottom border of the page. Done or Esc to finish.");
}
function endResizeDrag() {
  if (!resizeMode) return;
  resizeMode = null;
  for (const frame of document.querySelectorAll(".page-resize-frame")) frame.remove();
}
$("resizeDrag").onclick = startResizeDrag;
$("resizeDragInstead").onclick = () => { $("resizeDialog").close(); startResizeDrag(); };
$("resizeConfirm").onclick = () => {
  const view = panels[page]?.view;
  // Whole units (exact in the project file); the original size is kept as it was.
  const size = $("resizePreset").value === "original" ? resizeTarget() : resizeTarget().map((v) => Math.round(v));
  if (!view || size.some((v) => !Number.isFinite(v) || v < 10)) return status("Choose a valid size.", true);
  let pdfRect;
  if (view.pdf_background && $("resizeFit").checked) {
    // The PDF fills the page as far as its own proportions allow, centred.
    const [, , w, h] = view.pdf_background.rect, scale = Math.min(size[0] / w, size[1] / h);
    pdfRect = [(size[0] - w * scale) / 2, (size[1] - h * scale) / 2, w * scale, h * scale];
  }
  $("resizeDialog").close();
  action("resizePage", { page, size, pdfRect, focus: page });
};
// Pages → Insert: blank pages of a chosen size, or pages of another PDF at native scale.
let insertPdfSource = null;
for (const [value, { label }] of Object.entries(PRESETS)) $("insertPreset").add(new Option(label, value));
for (const [value, { label }] of Object.entries(SPACE)) $("insertSpace").add(new Option(label, value));
$("insertPreset").onchange = () => {
  $("insertCustom").hidden = $("insertPreset").value !== "custom";
};
function openInsert(pdf) {
  insertPdfSource = pdf;
  $("insertTitle").textContent = pdf ? "Insert PDF pages" : "Insert blank pages";
  $("insertSource").textContent = pdf ? `${pdf.name}: ${pdf.sizes.length} ${pdf.sizes.length === 1 ? "page" : "pages"}. The PDF keeps its scale; extra space is blank paper beside it.` : "New pages use white paper.";
  $("insertBlankOptions").hidden = !!pdf;
  $("insertPdfOptions").hidden = !pdf;
  const [w, h] = panels[page].size.map(unitsToMm);
  $("insertWidth").value = Math.round(w);
  $("insertHeight").value = Math.round(h);
  $("insertCustom").hidden = $("insertPreset").value !== "custom";
  if (pdf) {
    $("insertFrom").max = $("insertTo").max = pdf.sizes.length;
    $("insertFrom").value = 1;
    $("insertTo").value = pdf.sizes.length;
  }
  $("insertStatus").textContent = "";
  $("insertDialog").showModal();
}
$("insertBlank").onclick = () => doc && openInsert(null);
$("insertPdf").onclick = () => doc && $("pdfPagesFile").click();
$("pdfPagesFile").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || !doc) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await openPdf(bytes.slice());
    const sizes = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i), viewport = p.getViewport({ scale: 1 });
        sizes.push([viewport.width, viewport.height]);
        p.cleanup();
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
    openInsert({ name: file.name, bytes, sizes });
  } catch (error) {
    status(`Could not read that PDF: ${error.message}`, true);
  }
};
// Units per PDF point in this note: from the current page's PDF when it has one.
async function noteUnitsPerPoint() {
  const view = panels[page]?.view;
  if (!view?.pdf_background || !backgrounds) return UNITS_PER_POINT;
  try {
    const pdf = await backgrounds.document(view.pdf_background.resource_id);
    const p = await pdf.getPage(view.pdf_background.page_index + 1);
    const width = p.getViewport({ scale: 1 }).width;
    p.cleanup();
    const ratio = backgroundPlacement(view.pdf_background, view.size).width / width;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : UNITS_PER_POINT;
  } catch {
    return UNITS_PER_POINT;
  }
}
$("insertCancel").onclick = () => $("insertDialog").close();
$("insertConfirm").onclick = async () => {
  if (!doc || busy()) return;
  const at = insertAt($("insertWhere").value, page, doc.pages);
  let pages, pdf;
  if (insertPdfSource) {
    const count = insertPdfSource.sizes.length;
    const from = Math.max(1, Math.min(count, Number($("insertFrom").value) || 1)) - 1;
    const to = Math.max(from + 1, Math.min(count, Number($("insertTo").value) || count)) - 1;
    const id = "pdf-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    pages = pdfPages(id, insertPdfSource.sizes, from, to, $("insertSpace").value, await noteUnitsPerPoint());
    let binary = "";
    for (let i = 0; i < insertPdfSource.bytes.length; i += 0x8000)
      binary += String.fromCharCode(...insertPdfSource.bytes.subarray(i, i + 0x8000));
    pdf = { id, base64: btoa(binary) };
  } else {
    const size = blankSize($("insertPreset").value, panels[page].size, [Number($("insertWidth").value), Number($("insertHeight").value)]);
    if (size.some((v) => !(v >= 10))) {
      $("insertStatus").textContent = "Enter a width and height of at least 20 mm.";
      return;
    }
    const count = Math.max(1, Math.min(100, Number($("insertCount").value) || 1));
    pages = Array.from({ length: count }, () => ({ size }));
  }
  $("insertDialog").close();
  await action("insertPages", { at, pages, pdf, focus: at });
};
// Page pixels for OCR: the PDF at about 2200 px wide under the ink and images.
// `inkOnly` keeps just the handwriting, in black on white: no PDF, images,
// typed text or highlighter, so recognition sees the ink alone (null when there is none).
async function pageCanvas(index, width = 2200, { liftTape = false, inkOnly = false } = {}) {
  const view = await call("view", { page: index });
  const holder = document.createElement("div");
  holder.innerHTML = view.svg;
  if (liftTape) for (const tape of holder.querySelectorAll("[data-tape]")) tape.setAttribute("opacity", "0.18");
  if (inkOnly) {
    for (const item of holder.querySelectorAll("[data-item]"))
      if (!item.dataset.item.startsWith("stroke:") || item.querySelector('[style*="multiply"]')) item.remove();
    for (const image of holder.querySelectorAll("image")) image.remove();
    if (!holder.querySelector("[data-item]")) return null;
    for (const mark of holder.querySelectorAll("[data-item] [stroke]")) if (mark.getAttribute("stroke") !== "none") mark.setAttribute("stroke", "#000");
    for (const mark of holder.querySelectorAll("[data-item] [fill]")) if (mark.getAttribute("fill") !== "none") mark.setAttribute("fill", "#000");
  }
  const svg = holder.querySelector("svg"), [w, h] = view.size, scale = width / w;
  if (view.pdf_background && !inkOnly) {
    const place = backgroundPlacement(view.pdf_background, view.size);
    // rasterTarget renders at twice the requested CSS width.
    const href = await backgrounds.image(view.pdf_background, view.size, (width * place.share) / 2);
    svg.querySelector("[data-background]").append(pdfImage(href, place));
  }
  const height = Math.round(h * scale);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return { canvas, scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}
const find = findController({
  call,
  library,
  backgrounds: () => backgrounds,
  panels: () => panels,
  jump,
  audio,
  status,
  pageCanvas,
  documentInfo: () => ({ pages: doc?.pages || 0 }),
  jobs: () => jobs,
});
const ai = window.notecompleteAI || null;
// Scratchpad: AI conversations kept per note (View → Scratchpad…).
const scratch = scratchpad({
  store: library.store,
  key: () => (doc ? `scratch:${find.fingerprint || doc.title || "note"}` : ""),
  markdown: (text) => call("markdownHtml", { text }),
  status,
  notes: async (text) => (await notesApi()).append(text),
});
$("scratchOpen").onclick = () => { for (const m of document.querySelectorAll("details.menu")) m.open = false; scratch.open(); };
const studyDeps = {
  keep: (entry) => scratch.keep(entry),
  ai,
  pageCanvas,
  pageText: (p) => find.pageText(p),
  documentInfo: () => ({ pages: doc?.pages || 0, title: doc?.title || "Note" }),
  currentPage: () => page,
  notePath: () => notePath,
  // The note's Markdown notes (loads the notes module on first use).
  notesText: async () => (doc ? (await notesApi()).text : ""),
  status,
};
// Chat answers onto the page: a text box with the answer's text, wrapped to the
// page, near the top of what is in view; selected so it can be dragged.
function wrapText(text, style, width) {
  const context = document.createElement("canvas").getContext("2d");
  context.font = cssFont(style);
  return text.split("\n").map((line) => {
    const out = [];
    let current = "";
    for (const word of line.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (current && context.measureText(next).width > width) { out.push(current); current = word; }
      else current = next;
    }
    return [...out, current].join("\n");
  }).join("\n");
}
async function answerToTextBox(text) {
  const p = panels[page], layer = doc?.layers.find((l) => l.id === activeLayer);
  if (!doc || !p?.view || !text.trim()) return;
  if (!layer?.visible || layer.locked) return status("Select a visible, unlocked layer first.", true);
  const style = { ...textDefaults }, wrapped = wrapText(text, style, p.size[0] * 0.8 - 12);
  const [w, h] = textBoxSize(wrapped, style);
  const rect = p.el.getBoundingClientRect(), view = $("viewport").getBoundingClientRect(), scale = rect.width / p.size[0];
  const y = Math.min(Math.max(0, (view.top - rect.top) / scale) + 40, Math.max(20, p.size[1] - h - 20));
  await action("image", { page, image: { base64: "", mime: "", bounds: [p.size[0] * 0.08, y, w, h], layer: activeLayer, text: textPayload(wrapped, style) } });
  document.querySelector('#toolbar [data-tool="select"]').click();
  await selection.selectId(page, `image:${doc.edit_count - 1}`);
  status("Answer added as a text box: drag it into place, double-click to edit.");
}
const chat = chatController({ ...studyDeps, selection, providers: () => ai.providers(), markdown: (text) => call("markdownHtml", { text }), toTextBox: answerToTextBox });
const jobs = jobChip({ status });
audio.transcript.jobs = jobs;
audio.transcript.context = () => ({ title: doc?.title || "" });
// Briefly outline the region of a page that answers a quiz question.
function highlightRegion(index, box) {
  const p = panels[index];
  if (!p?.el || !box) return;
  const [x0, y0, x1, y1] = box, rect = document.createElement("div");
  rect.className = "region-flash";
  Object.assign(rect.style, { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` });
  p.el.append(rect);
  setTimeout(() => rect.remove(), 2600);
}
// The source PDF a page is drawn on, to attach to an AI request.
async function pagePdfOf(index) {
  const view = panels[index]?.view || (await call("view", { page: index }));
  if (!view?.pdf_background || !backgrounds) return null;
  const bytes = await call("pdf", { resource: view.pdf_background.resource_id });
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { bytes: data, type: "application/pdf", label: "source", page: view.pdf_background.page_index + 1 };
}
const continueInChat = (thread) => { showDocument(); return chat.continueThread(thread); };
// The quiz and flashcard windows grow to fit an answer being written (floating.js fit).
let quizWindow = null, practiceWindow = null;
const quizzes = quizController({
  ...studyDeps,
  grow: () => quizWindow?.fit(),
  continueInChat,
  markdown: (text) => call("markdownHtml", { text }),
  pagePdf: (index) => pagePdfOf(index),
  library,
  key: () => `quizzes:${find.fingerprint || doc?.title || "note"}`,
  pageCanvas,
  jump: (p) => { showDocument(); jump(p); },
  highlight: highlightRegion,
  clarify: ({ question, image }) => { showDocument(); chat.askAbout({ question, image, label: "the part of the notes that answers the quiz question" }); },
  status,
  // Double check: the AI re-reads the region and says which option is right and why.
  factCheck: async (q, image) => {
    if (!ai) throw Error("Double check needs the desktop app and an AI tool.");
    let provider = "claude";
    try { provider = localStorage.getItem("notecomplete-ai-provider") || provider; } catch { /* Optional. */ }
    const images = [];
    if (image) { const blob = await (await fetch(image)).blob(); images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), type: "image/jpeg", label: "notes-region" }); }
    const { text } = await ai.run({ provider, images, notePath, tag: "check", prompt: `A student disputes a quiz question about their notes${image ? " (the attached image is the region of the notes the quiz cites)" : ""}. Using the notes, decide which option is correct, or say that none is. Write in the question's language.\nQuestion: ${q.question}\n${q.options.map((o, i) => `${i}: ${o}`).join("\n")}\nReply with ONLY JSON: {"answer": <index of the correct option, or null>, "reason": "two or three sentences that cite the notes"}` });
    const value = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { answer: Number.isInteger(value.answer) ? value.answer : null, reason: String(value.reason || "") };
  },
});
const study = studyController({
  ...studyDeps,
  growWindow: () => practiceWindow?.fit(),
  continueInChat,
  library,
  fingerprint: () => find.fingerprint,
  jump: (p) => { showDocument(); jump(p); },
  download,
  jobs,
  quizzes,
  markdown: (text) => call("markdownHtml", { text }),
  pagePdf: (index) => pagePdfOf(index),
});
// The quiz and the flashcard practice are floating windows too.
quizWindow = floatingWindow($("quizPanel"), { screen: screenArea, key: "notecomplete-quiz-window", head: $("quizPanel").querySelector(".quiz-panel-head"), close: $("quizPanelClose"), label: "Quiz", compact: { cls: "minimized", button: $("quizMinimize") }, minWidth: 300, minHeight: 200 });
practiceWindow = floatingWindow($("deckDialog"), { screen: screenArea, key: "notecomplete-practice-window", head: $("deckDialog").querySelector(".deck-head"), close: $("deckFloatClose"), label: "Flashcards", compact: { cls: "minimized", button: $("deckMinimize") }, enabled: () => $("deckDialog").classList.contains("floating"), minWidth: 380, minHeight: 240, buttonClass: "deck-float-only" });
// Focus: the sun in the quiz and flashcard windows dims everything behind them
// while one of them is open (the pages can still be scrolled underneath).
let focusDim = false;
try { focusDim = localStorage.getItem("notecomplete-focus-dim") === "1"; } catch { /* Optional. */ }
function syncDim() {
  const shown = (el) => !el.classList.contains("minimized") && !el.classList.contains("in-tray");
  const quiz = !$("quizPanel").hidden && shown($("quizPanel"));
  const cards = $("deckDialog").open && $("deckDialog").classList.contains("floating") && shown($("deckDialog"));
  document.body.classList.toggle("focus-dim", focusDim && (quiz || cards));
  for (const id of ["quizDim", "deckDim"]) $(id).setAttribute("aria-pressed", String(focusDim));
}
for (const id of ["quizDim", "deckDim"]) $(id).onclick = () => {
  focusDim = !focusDim;
  try { localStorage.setItem("notecomplete-focus-dim", focusDim ? "1" : "0"); } catch { /* Optional. */ }
  syncDim();
};
new MutationObserver(syncDim).observe($("quizPanel"), { attributes: true, attributeFilter: ["hidden", "class"] });
new MutationObserver(syncDim).observe($("deckDialog"), { attributes: true, attributeFilter: ["open", "class"] });
syncDim();
// Q resumes the latest unfinished quiz of this note.
async function resumeQuiz() {
  if (quizzes.current && !$("quizPanel").hidden) return $("quizPanel").classList.remove("minimized", "in-tray");
  const open = (await quizzes.list()).find((q) => !q.done) || (await quizzes.list())[0];
  if (open) { showDocument(); quizzes.open(open); } else study.quiz();
}
$("studyResume").onclick = resumeQuiz;
$("studyRetake").onclick = () => { showDocument(); quizzes.retakeWrong(); };
$("studyExportQuiz").onclick = () => study.exportQuiz();
$("quizAnki").onclick = () => study.exportQuiz(quizzes.current);
$("exportStudy").onclick = () => { for (const m of document.querySelectorAll("details.menu")) m.open = false; study.exportAll(); };
// Study → All quizzes…: every quiz with its document; another document is opened first.
const quizIndex = allQuizzes({
  library, status,
  // The note on screen (not one left loaded behind Home).
  currentFingerprint: () => (doc && !$("editor").hidden ? find.fingerprint : ""),
  openEntry: async (key) => {
    const entry = await library.store.get("entries", key).catch(() => null);
    const file = entry && await library.open(entry).catch(() => null);
    if (!file) { status("That note is no longer kept on this device. Open it again from Drive or your files.", true); return false; }
    return openFromLibrary(file, entry);
  },
  openItem: async (kind, id) => {
    showDocument();
    if (kind === "decks") return study.openDeck(id);
    const quiz = (await quizzes.list()).find((q) => q.id === id);
    if (!quiz) return status("That quiz is no longer saved with the note.", true);
    quizzes.open(quiz);
  },
  exportItem: (kind, item) => (kind === "decks" ? study.exportDeck(item) : study.exportQuiz(item)),
});
updateNotice({ status });
// Mic buttons in the Ask AI fields: speak the question, edit it, send it.
const dictate = dictation({ status });
dictate.attach($("chatInput"), $("chatSend"));
dictate.attach($("practiceAskInput"), $("practiceAskForm").querySelector('button[type="submit"]'));
{ const box = $("quizExplainBox").querySelector(".practice-ask-form"); if (box) dictate.attach(box.querySelector("input"), box.querySelector('button[type="submit"]')); }
$("studyAllQuizzes").onclick = () => { for (const m of document.querySelectorAll("details.menu")) m.open = false; quizIndex.open(); };
$("shortcutsOpen").onclick = () => {
  $("shortcutsList").replaceChildren(...SHORTCUTS.map(([keys, what]) => {
    const row = document.createElement("tr"), a = document.createElement("td"), b = document.createElement("td");
    for (const part of keys.split(" / ")) { const k = document.createElement("kbd"); k.textContent = part; a.append(k, " "); }
    b.textContent = what;
    row.append(a, b);
    return row;
  }));
  $("shortcutsDialog").showModal();
};
$("shortcutsClose").onclick = () => $("shortcutsDialog").close();
$("studyCards").onclick = () => study.cards();
$("studyQuiz").onclick = () => study.quiz();
$("studyOpenDeck").onclick = () => study.saved();
$("chatOpen").onclick = $("chatToggle").onclick = () => { if (doc) { showDocument(); chat.toggle(); } };
// Bars above the pages may change height (menubar compaction, wrapping tool
// row); scroll by the same amount in that frame so the pages never move.
{
  let top = null;
  const keep = () => {
    if (!doc || $("editor").hidden) return void (top = null);
    const now = $("viewport").getBoundingClientRect().top;
    if (top !== null && now !== top) $("viewport").scrollTop += now - top;
    top = now;
  };
  const watch = new ResizeObserver(keep);
  for (const el of [$("commandBar"), $("toolbar"), document.querySelector(".navigation")].filter(Boolean)) watch.observe(el);
}
audio.transcript.onwords = (asset, words) =>
  find.transcribed(audio.entries.find((entry) => entry.asset?.id === asset.id), words);
documentControls();
home.show(false);

const palette = commandPalette({
  dialog: $("paletteDialog"),
  input: $("paletteInput"),
  list: $("paletteList"),
  commands: () => [
    ...[...document.querySelectorAll("#commandBar button[id], #commandBar .menu-content button")]
      .filter((b) => b.id !== "paletteOpen" && b.id !== "exportImage" && b.dataset.proxy !== "paletteOpen" && b.textContent.trim())
      .map((b) => ({
        id: b.id,
        title: (b.closest(".bar-menu") ? b.closest(".bar-menu").querySelector("summary").textContent.trim() + ": " : "") + (b.dataset.palette || [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim()),
        hint: b.querySelector("kbd")?.textContent,
        group: b.closest(".bar-menu")?.querySelector("summary").textContent.trim() || "General",
        enabled: () => (b.dataset.proxy || b.dataset.proxyTool ? syncMenus() : 0, !b.disabled && !b.hidden),
        run: () => b.click(),
      })),
  ],
  dynamic: (query) => {
    const items = otherWindows
      .filter((w) => !query.trim() || w.title.toLowerCase().includes(query.trim().toLowerCase()) || ["tab", "window"].some((k) => k.startsWith(query.trim().toLowerCase())))
      .map((w) => ({ id: `window-${w.id}`, title: `Tab: ${w.title}`, group: "Open notes", run: () => windows.focus(w.id) }));
    const phrase = query.trim().match(/^(?:find|buscar)\s+(.+)$/i);
    if (phrase && doc) items.push({ id: "find", title: `Find “${phrase[1]}” in this note`, group: "Navigate", run: () => { showDocument(); find.find(phrase[1]); } });
    const number = query.trim().match(/^(?:p(?:age|ágina)?\.?\s*|:)?(\d+)$/i);
    if (number && doc) {
      const target = Math.min(doc.pages, Math.max(1, Number(number[1])));
      items.push({ id: "goto", title: `Go to page ${target} of ${doc.pages}`, group: "Navigate", run: () => { showDocument(); jump(target - 1); } });
    }
    return items;
  },
});
// Other open windows (desktop) appear in the palette so any of them can be brought forward.
const windows = window.notecompleteWindows || null;
let otherWindows = [];
async function openPalette(query = "") {
  otherWindows = windows ? (await windows.list().catch(() => [])).filter((w) => !w.current) : [];
  palette.open(query);
}
$("paletteOpen").onclick = () => openPalette();
$("newWindow").onclick = () => (windows ? windows.open() : window.open(location.href, "_blank"));
// Interface size (desktop app; browsers have their own zoom).
if (windows?.zoom) {
  $("uiSizeItems").hidden = false;
  const size = (step) => windows.zoom(step).then((z) => status(`Interface size ${Math.round(z * 100)}%`)).catch(() => {});
  $("uiSmaller").onclick = () => size(-1);
  $("uiLarger").onclick = () => size(1);
  $("uiReset").onclick = () => size(0);
}

// Links in AI answers: page links jump to the page, attached images open large;
// web links open through the desktop app's window handler (target=_blank).
document.addEventListener("click", (e) => {
  const a = e.target.closest?.(".chat-body a");
  if (!a) return;
  if (a.dataset.page) {
    e.preventDefault();
    if (!doc) return;
    for (const d of document.querySelectorAll("dialog[open]:not(.floating)")) d.close();
    showDocument();
    jump(Math.min(doc.pages, Number(a.dataset.page)) - 1);
    return;
  }
  const url = a.dataset.aiImage || (a.dataset.aiFile && getAiFile(a.dataset.aiFile)?.url);
  if (a.dataset.aiFile || a.dataset.aiImage) {
    e.preventDefault();
    if (!url) return status("That image is no longer available.", true);
    const viewer = $("imageViewer");
    $("imageViewerImage").src = url; $("imageViewerImage").alt = a.textContent;
    viewer.onclick = () => viewer.close();
    viewer.showModal();
  }
});
