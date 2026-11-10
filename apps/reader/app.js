import { touchGestures } from "./touch.js";
import { followPoint, smoothStroke, pressureRadii, extentOf } from "./stroke-smoothing.js";
import { textLines } from "./text-layer.js";
import { readingOrder, nearestWord, bandsFor, bandLine, distanceTo } from "./text-highlight.js";
import { momentum, VelocityTracker } from "./momentum.js";
import {
  prepareDocument,
  readImage,
  imageBounds,
  fileKind,
} from "./media-import.js";
import { htmlViewer } from "./html-view.js";
import { textViewer, isMarkdownName, zoomControl } from "./text-view.js";
import { textStudy } from "./text-study.js";
import { textFind } from "./text-find.js";
import { groupStore, groupPanel, localMember, webMember } from "./groups.js";
import { webViewer, normalizeLink, linkTitle } from "./web-view.js";
import { driveBrowser } from "./drive-browser.js";
import { Library } from "./library.js";
import { homeScreen } from "./home.js";
import { archiveBrowser } from "./archive-browser.js";
import { createDownloadQueue } from "./download-queue.js";
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
import { versionChooser, carryStudy } from "./versions.js";
import { receiveNativeFiles } from "./import.js";
import { SelectionController } from "./selection.js";
import { regionSweep } from "./selection-geometry.js";
import { ChromeState, highlightPoints } from "./chrome-state.js";
import { download } from "./download.js";
import { zipFiles } from "./zip.js";
import { enhanceSelects, refreshSelects } from "./select.js";
import { decorateIcons, icon } from "./icons.js";
import { qualitySettings } from "./quality.js";
import { PdfBackgrounds, backgroundPlacement, openPdf, copyCanvas } from "./pdf-background.js";
import { PRESETS, SPACE, blankSize, pdfPages, insertAt, unitsToMm, mmToUnits, UNITS_PER_POINT } from "./insert-pages.js";
import { handwritingConverter } from "./convert.js";
import { agentConnector } from "./agents.js";
import { AudioController } from "./audio.js";
import { addedAudio, AUDIO_TYPES, clock } from "./recorder.js";
import { TranscriptController } from "./transcript.js";
import { AudioProcessing } from "./audio-processing.js";
import { Engine } from "./engine.js";
import { indexTimedInk, updateTimedInk } from "./ink-timeline.js";
import { shapePoints, CLOSED_SHAPES } from "./shapes.js";
import { recognizeShape } from "./shape-recognize.js";
import { typesetMath, mathSize, previewMath } from "./math-boxes.js";
import { mathKeypad } from "./math-keypad.js";
import { graphItems } from "./graph.js";
import { tableItems } from "./table.js";
import { editGraph, editTable } from "./compound-dialogs.js";
import { mathField, styleField, mounted, focusField } from "./math-field.js";
import { audioTrim } from "./audio-trim.js";
import { androidUpdates } from "./android-updates.js";
import { tabStrip } from "./tab-strip.js";
import { sortable } from "./reorder.js";
import { quickMenu } from "./quick-menu.js";
import { autosaveStore, offerRecovery, when, EVERY_MS } from "./autosave.js";
import { penButtonDetector, loadPenProfile, profileFrom, describeProfile, PROFILE_KEY } from "./pen-button.js";
import { sharedAI } from "./local-ai.js";
import { runAI, smallSetting } from "./small-model.js";
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
let epoch = 0,
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

// A tab of the web app (tabs.html, tab-host.js): the host gives this frame the same tab
// bridge the desktop app does.
const tabParams = new URLSearchParams(location.search);
if (!window.notecompleteTabs && tabParams.has("tab") && window.parent !== window) {
  try { window.notecompleteTabs = window.parent.notecompleteTabHost?.bridge(tabParams.get("tab")) || undefined; } catch { /* Another origin. */ }
}
// Desktop tabs: the strip in the top bar; title and unsaved state go to the window.
const tabBar = tabStrip(window.notecompleteTabs || null, { dirty: () => !!doc && dirty, beforeClose: () => collab?.beforeClose?.() ?? true });
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
  // A filter list (never "none"): dark pages append invert() to it, and "none invert()" is
  // invalid CSS. At 100 % there is none at all (dark pages fall back to contrast(100%)): an
  // identity filter still makes every page a filtered layer, redrawn whole on each change.
  if (value.contrast === 100 && value.brightness === 100) document.documentElement.style.removeProperty("--page-filter");
  else document.documentElement.style.setProperty("--page-filter", `contrast(${value.contrast}%) brightness(${value.brightness}%)`);
  if (rasterChanged) redrawPdfPages();
});
// PDF pages drawn again: another quality, or a screen with another pixel density (the window
// moved to another screen, or the browser zoom changed; see rasterTarget).
function redrawPdfPages() {
  backgrounds?.clear();
  for (const panel of panels) {
    panel.token++;
    if (panel.near) renderPage(panel, panel.view);
  }
}
(function watchPixelRatio() {
  matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`).addEventListener("change", () => {
    redrawPdfPages();
    watchPixelRatio();
  }, { once: true });
})();
const audio = new AudioController(
  (resource) => call("audio", { resource }),
  jump,
  syncInk,
);
audio.transcript = new TranscriptController(audio);
audio.processing = new AudioProcessing(audio.audio);
let addedStore = null; // recordings added in NoteComplete, set up with the library below
const selection = new SelectionController({
  // A part of a graph or table selects all of it (pickWhole, with the object's editor).
  call: (op, args) => (op === "pick" ? pickWhole(args) : call(op, args)),
  // A graph or table is removed in one step.
  removeWhole: (item) => action("drawMany", { page: item.page, replace: item.compound.items, lines: [], images: [] }),
  patch: patchItem,
  remove: (item) => action("remove", { page: item.page, itemId: item.id }),
  panel: (index) => panels[index],
  editable: () => !!doc && !busy(),
  changed: toolOptions,
  status,
});
// Status is a transient toast, not a permanent strip; errors stay up longer.
let statusTimer = 0;
// Never over the tool bars: above the lowest bar that sits at the bottom (phones, a
// tablet's dock held upright), also after the screen turns.
function placeStatus() {
  let bottom = 0;
  for (const bar of document.querySelectorAll("#toolbar, .navigation, #tabletDock")) {
    const r = bar.getBoundingClientRect();
    if (r.height && r.top > innerHeight / 2) bottom = Math.max(bottom, innerHeight - r.top);
  }
  $("status").style.setProperty("--above-bars", `${bottom}px`);
}
addEventListener("resize", () => { if ($("status").classList.contains("show")) placeStatus(); });
function status(text, error = false) {
  $("status").textContent = text;
  placeStatus();
  $("status").className = (error ? "error " : "") + (text ? "show" : "");
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => $("status").classList.remove("show"), error ? 8000 : 2800);
}
// The app's own links (notecomplete:install), e.g. in the website's welcome notebook.
document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a.ink-link, a[href^='notecomplete:']");
  const href = link?.getAttribute("href") || "";
  if (!href.startsWith("notecomplete:")) return;
  event.preventDefault();
  if (href === "notecomplete:install") installApp();
}, true);
// Add this site to the Home Screen / install it as an app. Browsers that offer an install
// prompt (Chrome, Edge, Android) show it; elsewhere (Safari on iPhone and iPad) the steps.
async function installApp() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone || window.notecompleteUpdates || window.ReactNativeWebView) return status("NoteComplete is already installed here.");
  let host = null, offered = null;
  try { host = window.parent !== window ? window.parent.notecompleteTabHost : null; } catch { /* Another origin. */ }
  try { offered = await (host?.install ? host.install() : installPrompt()); } catch { /* Steps instead. */ }
  if (offered === "accepted") return status("Installed. NoteComplete is on your Home Screen and in your apps.");
  if (offered === "dismissed") return;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  $("installSteps").textContent = ios
    ? "In Safari, tap Share (the square with an arrow), then Add to Home Screen."
    : /Android/.test(navigator.userAgent)
      ? "Open the browser menu (⋮), then Install app or Add to Home screen."
      : "Use the install button at the end of the address bar, or the browser menu → Install NoteComplete.";
  $("installDialog").showModal();
}
$("installOk").onclick = () => $("installDialog").close();
// Help → Add this site as an app…, in browsers only (the desktop and Android apps are installed).
if ($("installApp")) {
  $("installApp").hidden = !!(window.notecompleteUpdates || window.ReactNativeWebView);
  $("installApp").onclick = () => installApp();
}
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstall = event; });
function installPrompt() {
  if (!deferredInstall) return Promise.resolve(null);
  const event = deferredInstall;
  deferredInstall = null;
  return event.prompt().then(() => event.userChoice).then((choice) => choice.outcome);
}
// ?open=<file on this site> opens it at start (the website's welcome notebook), and
// notes=1 shows its Notes panel. Only files of this site, never another address.
let openedFromAddress = false;
async function openFromAddress() {
  const wanted = tabParams.get("open");
  if (openedFromAddress || !wanted) return;
  openedFromAddress = true;
  try {
    const url = new URL(wanted, location.href);
    if (url.origin !== location.origin) return;
    const response = await fetch(url);
    if (!response.ok) throw Error(`Could not open ${url.pathname.split("/").pop()} (${response.status}).`);
    await load(new File([await response.blob()], decodeURIComponent(url.pathname.split("/").pop())));
    // notes=1: the Notes panel open, formatted, so its links can be followed.
    if (tabParams.get("notes") === "1") {
      // Once the panel is open (its notes loaded), not after a guessed delay.
      if ($("notesToggle").getAttribute("aria-expanded") !== "true") await $("notesToggle").onclick();
      if ($("notesPreview")?.getAttribute("aria-pressed") === "false") $("notesPreview").click();
    }
  } catch (e) { status(e.message, true); }
}
// Files the system hands over ("Open with…", double-click, Share): the desktop app's tab asks
// for its file; the installed web app gets them from launchQueue (file_handlers in the
// manifest) or the share target, possibly before the engine is ready, so they wait in launchedFiles. One document per tab:
// the first file opens, the others are named in the status.
const launchedFiles = [];
window.launchQueue?.setConsumer(async (params) => {
  const files = [];
  for (const handle of params?.files || []) {
    try { if (handle.kind !== "directory") files.push(await handle.getFile()); } catch { /* Gone or not allowed. */ }
  }
  if (!files.length) return;
  launchedFiles.splice(0, launchedFiles.length, ...files);
  openLaunched();
});
// Files shared to the installed web app (share_target): sw.js keeps them for this page.
async function sharedFiles() {
  history.replaceState(null, "", location.pathname);
  if (!window.caches) return [];
  const cache = await caches.open("notecomplete-shared"), files = [];
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    files.push(new File([await response.blob()], decodeURIComponent(response.headers.get("x-name") || "Shared file")));
  }
  await caches.delete("notecomplete-shared");
  return files;
}
async function openLaunched() {
  if (!ready) return;
  try {
    const desktop = await window.notecompleteFiles?.launched?.();
    if (desktop) {
      const file = new File([desktop.bytes], desktop.name);
      await load(file);
      return await openedLocal(desktop.path, desktop.name, file);
    }
    if (tabParams.get("shared") === "1" && !launchedFiles.length) launchedFiles.push(...await sharedFiles());
    const [file, ...rest] = launchedFiles.splice(0);
    if (!file || busy() || !canReplace()) return;
    await load(file);
    if (rest.length) status(`Opened ${file.name}. Open ${rest.map((f) => f.name).join(", ")} on its own; one document per window.`);
  } catch (e) { status(e.message, true); }
}
function call(op, args = {}) {
  return engine.call({ op, page, ...args }, args.bytes ? [args.bytes] : []);
}
// A sharing session (collab.js, loaded only when one starts). While it holds the open
// note, edits go into the session's shared order and come back to be applied here
// (applyShared), so every copy applies the same edits in the same order.
let collab = null, sharedText = false;
function mutate(op, args = {}) {
  if (collab?.readOnly) return Promise.reject(Error("This note is shared view-only: you can read it and follow along."));
  return collab?.ink ? collab.submit(op, args) : call(op, args);
}
// Notes of 32 MB and more replace the engine's worker when they close (engine.js).
const engine = new Engine({
  create: () => new Worker("./worker.js", { type: "module" }),
  onReady() {
    if (ready) return;
    ready = true;
    $("open").disabled = $("emptyOpen").disabled = false;
    status("Ready. Everything is processed on your device.");
    openFromAddress();
    openLaunched();
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({ type: "noteful-ready" }),
    );
  },
  onFatal: (text) => status(text, true),
  onError(message) {
    ready = false;
    status("Engine error: " + message, true);
  },
});
const releaseSession = () => engine.release();
function canReplace() {
  return (
    !(dirty && changed) ||
    confirm("You have unsaved changes. Open another document and discard them?")
  );
}
// While a document opens (`opening`), Home stays hidden so switching never flashes it.
function reset({ opening = false, keepSession = false } = {}) {
  resizeMode = null;
  if (notes?.visible) {
    notes.close();
    $("notesToggle").setAttribute("aria-expanded", "false");
    $("htmlNotes").setAttribute("aria-expanded", "false");
  }
  selection.clear();
  cancelGesture();
  chromeState.reset();
  barState.reset();
  document.body.classList.remove("bar-compact");
  setCompact(false);
  observer?.disconnect();
  thumbnailObserver?.disconnect();
  thumbQueue.clear();
  thumbsDue.clear();
  backgrounds?.close();
  stopRecording();
  audio.reset();
  panels = [];
  doc = null;
  sideFp = "";
  htmlView?.close();
  textView?.close();
  textFinder?.close();
  webView?.close();
  $("pages").replaceChildren();
  $("pageList").replaceChildren();
  if (!keepSession) releaseSession();
  $("editor").hidden = true;
  $("htmlView").hidden = true;
  $("textView").hidden = true;
  $("webView").hidden = true;
  $("title").textContent = "Home";
  document.title = "NoteComplete";
  tabBar.update({ title: "Home", dirty: false });
  dirty = changed = false;
  $("textSave").hidden = $("htmlSave").hidden = true;
  converted = false;
  sharedText = false;
  releaseImages();
  $("textEdit").hidden = false;
  $("textSave").title = SAVE_TEXT_TITLE;
  documentControls();
  if (!opening) {
    home?.show(false);
    collab?.documentChanged();
  }
}
// The format Save writes for a document made with New document; null saves a project.
let saveAs = null;
// A Word, OpenDocument, Excel or CSV file shown as Markdown: read-only, Save writes a .md.
let converted = false;
// The pictures of a converted document (files the Markdown links to, "<name>_files/…"), their
// folder name, and the copy this session already saved (a later Save updates it).
let convertedImages = [], convertedFolder = "", copyTarget = null;
const imageUrls = new Map();
const PICTURE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };
// A picture a text document links to: kept in memory for a converted document, read from beside
// the file for a Markdown file on this device (the desktop app), otherwise not available.
async function textImageUrl(path) {
  if (imageUrls.has(path)) return imageUrls.get(path);
  const type = PICTURE_TYPES[path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]];
  if (!type) return null;
  let bytes = convertedImages.find((image) => image.path === path)?.bytes || null;
  if (!bytes && !converted && docMember?.source === "local" && window.notecompleteFiles?.readSibling) bytes = await window.notecompleteFiles.readSibling(docMember.path, path).catch(() => null);
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  imageUrls.set(path, url);
  return url;
}
function releaseImages() {
  for (const url of imageUrls.values()) URL.revokeObjectURL(url);
  imageUrls.clear();
  convertedImages = []; convertedFolder = ""; copyTarget = null;
}
const SAVE_TEXT_TITLE = $("textSave").title;
const SAVE_EXT = { project: ".nfedit", noteful: ".noteful", markdown: ".noteful", notecomplete: ".notecomp", notepart: ".notepart" };
function saveLabel() { $("save").querySelector(".menu-label").textContent = saveAs ? `Save (${SAVE_EXT[saveAs]})` : "Save project"; }
async function load(file, preparedDocument = null) {
  if (!ready || busy()) {
    status("Wait for the current operation to finish.", true);
    return;
  }
  editing = true;
  status("Opening document…");
  try {
    // A recovered automatic save keeps the note it belongs to (its notes, recordings, slots).
    const recovering = recoveringKey;
    recoveringKey = null;
    const fingerprint = recovering ? Promise.resolve(recovering) : noteFingerprint(file).catch(() => "");
    const prepared = preparedDocument || await prepareDocument(file);
    // HTML pages and text/Markdown files have their own views instead of the page editor.
    if (prepared.kind === "html" || prepared.kind === "text") {
      reset({ opening: true });
      if (prepared.converted) { convertedImages = prepared.images || []; convertedFolder = prepared.imageFolder || ""; converted = true; }
      sideFp = await fingerprint;
      const sideTitle = prepared.title || file.name || "Document";
      $("title").textContent = sideTitle;
      document.title = `${sideTitle} — NoteComplete`;
      tabBar.update({ title: sideTitle, dirty: false });
      if (prepared.kind === "html") { htmlView.open({ text: prepared.text, fingerprint: sideFp, name: sideTitle }); notes?.load(sideFp, { core: false }); }
      else {
        await textView.open({ text: prepared.text, name: sideTitle, markdown: prepared.markdown ?? isMarkdownName(file.name), key: file.name });
        textSource.forget();
        // Its notes (a guest keeps the shared ones, bound by the session).
        if (collab?.role !== "guest") notes?.load(sideFp, { core: false });
      }
      if (prepared.converted) {
        // Editable as Markdown: Save writes a copy beside the file, never over it.
        $("textSave").hidden = false;
        $("textSave").title = "Save a Markdown copy (Ctrl S): the original file is never changed";
      }
      showDocument();
      rememberDocument();
      documentControls();
      status(prepared.kind === "html" ? "HTML document opened." : prepared.converted ? `Opened as Markdown. Edit it if you like: Save keeps a .md copy${convertedImages.length ? " and its pictures" : ""} beside the file and never changes the original.` : "Text document opened.");
      collab?.documentChanged();
      return;
    }
    // The bytes are transferred to the worker, so their size is read first.
    const openedBytes = prepared.bytes?.byteLength || 0;
    const result = await call("open", {
      ...prepared,
      project: prepared.kind === "project",
      notecomplete: prepared.kind === "notecomplete",
      page: 0,
    });
    // Both worker and UI retain the previous document until the replacement validates.
    reset({ opening: true, keepSession: true });
    engine.opened(openedBytes);
    tapeMode = "note";
    tapeTaps.clear();
    find.reset(await fingerprint);
    // A guest keeps the session's shared notes (collab.js binds them), not the note's own.
    if (collab?.role !== "guest") notes?.load(find.fingerprint);
    const token = ++epoch;
    revision++;
    doc = result;
    page = 0;
    activeLayer =
      result.layers.find((l) => l.visible && !l.locked)?.id ??
      result.layers[0]?.id ??
      0;
    dirty = ["pdf", "image", "blank", "handwritten"].includes(prepared.kind);
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
    collab?.documentChanged();
    autosaveOpened(recovering);
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
      const result = await mutate("image", { page: targetPage, image });
      if (note !== epoch) return;
      dirty = changed = true;
      revision++;
      panels[targetPage].edits = pageEdits(panels[targetPage]) + 1;
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
// A blank page after page `after`, the size of that page (one undoable edit). Not on an
// infinite canvas, which grows instead. Used by the button below the last page and by a
// drawing tablet's dock (collab.js).
async function addBlankPage(after) {
  if (!doc || busy() || doc.canvas) return;
  const size = panels[after]?.size;
  if (!size) return;
  const at = after + 1;
  await action("insertPages", { at, pages: [{ size: [...size] }], focus: at });
}
// Below the last page: scrolling past the end offers a new blank page of the same size.
function addPageButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "add-page-end";
  button.hidden = !!doc?.canvas;
  button.title = "Add a blank page at the end, the size of the last one";
  button.append(icon("plus"), Object.assign(document.createElement("span"), { textContent: "New page" }));
  button.onclick = async () => {
    if (!doc || busy() || doc.canvas) return;
    await addBlankPage(panels.length - 1);
    status("Page added. You can undo this change.");
  };
  return button;
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
      if (e.target.closest(".text-editor, .text-discard, .text-format, .page-resize-frame")) return;
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
  $("pages").append(addPageButton());
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
// `math`: the text is LaTeX, typeset by KaTeX (math-boxes.js); sent only when set.
const textPayload = (value, style) => ({ text: value, font_size: style.size, rgba: style.rgba, bold: style.bold, italic: style.italic, font: style.font, ...(style.math ? { math: true } : {}) });
// A typed box's style, with its math flag (kept by the box, not by its runs).
const boxStyleOf = (existing) => ({ ...styleOf(existing?.runs?.[0]), ...(existing?.math ? { math: true } : {}) });
// The size a box needs: typeset math is measured, other text from its lines.
const boxSize = (value, style) => (style.math ? mathSize(value, style).catch(() => textBoxSize(value, style)) : Promise.resolve(textBoxSize(value, style)));
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
  // Docked (View → Text format bar in the tool bar): in the tool bar's settings row, never a
  // bar of its own over the page.
  if (textFormatDocked()) {
    if (bar.parentElement !== $("toolOptions")) $("toolOptions").append(bar);
    bar.classList.remove("below");
    bar.style.left = bar.style.top = "";
    bar.hidden = false;
    toolOptions();
    return;
  }
  bar.style.left = `${(bounds[0] / p.size[0]) * 100}%`;
  bar.style.top = `${(bounds[1] / p.size[1]) * 100}%`;
  // Above the box, or below it when the box is at the top of the page.
  bar.classList.toggle("below", bounds[1] / p.size[1] < 0.06);
  if (bar.classList.contains("below")) bar.style.top = `${((bounds[1] + bounds[3]) / p.size[1]) * 100}%`;
  if (bar.parentElement !== p.el) p.el.append(bar);
  bar.hidden = false;
  // Kept inside the window: a box near its right edge, or a phone, moves the bar left (it
  // wraps onto a second row when even that is not enough: style.css).
  const r = bar.getBoundingClientRect(), view = $("viewport").getBoundingClientRect();
  const shift = Math.min(r.right - (view.right - 8), r.left - (view.left + 8));
  if (shift > 0) bar.style.left = `calc(${bar.style.left} - ${shift}px)`;
}
function syncTextFormatControls(style) {
  $("textFont").value = FONT_STACKS[style.font] ? style.font : "Helvetica";
  if (![...$("textSize").options].some((o) => Number(o.value) === style.size)) $("textSize").add(new Option(String(style.size), String(style.size)));
  $("textSize").value = String(style.size);
  $("textBold").setAttribute("aria-pressed", String(!!style.bold));
  $("textItalic").setAttribute("aria-pressed", String(!!style.italic));
  $("textMath").setAttribute("aria-pressed", String(!!style.math));
  const hex = hexColor(style.rgba);
  $("textColor").value = hex;
  for (const b of $("textSwatches").children) b.setAttribute("aria-checked", String(b.dataset.color.toLowerCase() === hex));
}
function hideTextFormat() {
  textFormatTarget = null;
  const docked = textFormatBar.parentElement === $("toolOptions");
  textFormatBar.hidden = true;
  document.body.append(textFormatBar);
  if (docked) toolOptions();
}
// Read from the page (a class on <body>), so the tool bar code can ask before this is set up.
const textFormatDocked = () => document.body.classList.contains("text-format-docked");
function setTextFormatDocked(on) {
  document.body.classList.toggle("text-format-docked", on);
  $("textFormatDock").setAttribute("aria-checked", String(on));
  try { localStorage.setItem("notecomplete-text-format-docked", on ? "1" : "0"); } catch { /* Optional. */ }
  // A bar showing now moves to its new place.
  const t = textFormatTarget;
  if (t) {
    hideTextFormat();
    if (textEditor) showTextFormat(t.p, [textEditor.bx, textEditor.by, 0, 0], t.style, t.apply);
    else syncTextFormat();
  }
}
try { setTextFormatDocked(localStorage.getItem("notecomplete-text-format-docked") === "1"); } catch { /* Optional. */ }
$("textFormatDock").onclick = () => {
  setTextFormatDocked(!textFormatDocked());
  status(textFormatDocked() ? "Text format in the tool bar's settings row." : "Text format in a bar over the text box.");
};
function changeTextStyle(change) {
  const t = textFormatTarget;
  if (!t) return;
  Object.assign(t.style, change);
  // Math is chosen per box: new boxes start as plain text.
  const { math: _math, ...defaults } = t.style;
  textDefaults = defaults;
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
$("textMath").onclick = () => changeTextStyle({ math: !textFormatTarget?.style.math });
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
  const style = boxStyleOf(existing);
  showTextFormat(p, existing.bounds, style, async (next) => {
    const value = boxText(existing), [w, h] = await boxSize(value, next);
    action("editText", { page: p.index, itemId: existing.id, text: textPayload(value, next), width: w, height: h });
  });
}
let textEditor = null;
// The math keypad: shown while a math box (∑) is typed; its Graph key draws the box's function.
const mathKeys = mathKeypad({ onGraph: (value) => graphFromBox(value), onLayout: () => keepTextVisible(), status: (text) => status(text) });
// Phones and tablets open the on-screen keyboard only for a focus made during a tap, and the
// box opens after an await: a hidden field takes the focus at the tap and hands it on.
let keyboardPrimer = null;
function primeKeyboard() {
  if (!keyboardPrimer) {
    keyboardPrimer = Object.assign(document.createElement("textarea"), { className: "keyboard-primer", tabIndex: -1 });
    keyboardPrimer.setAttribute("aria-hidden", "true");
  }
  document.body.append(keyboardPrimer);
  keyboardPrimer.focus({ preventScroll: true });
}
function unprime() {
  if (!keyboardPrimer?.isConnected) return;
  if (document.activeElement === keyboardPrimer) keyboardPrimer.blur();
  keyboardPrimer.remove();
}
// A tap with Text (finger or stylus, pointerUp): finish the open box, or start one there.
async function typeAt(p, at) {
  if (textEditor) return commitText();
  primeKeyboard();
  try { await openTextEditor(p, at); } finally { if (!textEditor) unprime(); }
}
// The on-screen keyboard covers the bottom of the screen (the visual viewport shrinks): the
// box being typed scrolls above it, with room added below the pages to scroll that far.
function keepTextVisible() {
  const vv = window.visualViewport;
  if (!textEditor || !vv) return;
  // The on-screen keyboard, or the math keypad over the bottom of the window.
  const keypad = mathKeys.open ? Math.max(0, innerHeight - mathKeys.top) : 0;
  const covered = Math.max(0, Math.round(innerHeight - vv.offsetTop - vv.height), Math.round(keypad));
  $("pages").style.marginBottom = covered ? `${covered}px` : "";
  // Up by what is hidden, but never past the box's top (and the format bar above it).
  const box = textEditor.area.getBoundingClientRect(), bottom = Math.min(vv.offsetTop + vv.height, mathKeys.open ? mathKeys.top : Infinity) - 16;
  const by = Math.min(box.bottom - bottom, box.top - vv.offsetTop - 56);
  if (by > 0) $("viewport").scrollTop += by;
}
window.visualViewport?.addEventListener("resize", keepTextVisible);
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
  const style = existing ? boxStyleOf(existing) : styleOf(null);
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
  // The × at the box's top-right corner discards the typing.
  const discard = Object.assign(document.createElement("button"), { type: "button", className: "text-discard", textContent: "×", title: "Discard (Shift + Esc)" });
  discard.setAttribute("aria-label", "Discard this text");
  discard.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
  discard.onclick = (e) => { e.stopPropagation(); closeText(); };
  const placeDiscard = () => Object.assign(discard.style, { left: `calc(${area.style.left} + ${area.style.width})`, top: area.style.top });
  // Math (the ∑ button): the formula typeset live under the box while its LaTeX is typed.
  const mathPreview = Object.assign(document.createElement("div"), { className: "math-preview" });
  mathPreview.setAttribute("aria-hidden", "true");
  // A box that is one formula is edited in a math field (math-field.js) over the text box:
  // tap any part to change it, arrows through its structure. The text box keeps its LaTeX.
  // Words mixed with $…$ stay as LaTeX text, with the typeset preview under the box.
  let field = null, fieldLoading = false;
  const placeField = () => {
    if (!field) return;
    const s = p.el.clientWidth / p.size[0];
    styleField(field, { ...style, size: style.size * s });
    Object.assign(field.style, { left: area.style.left, top: area.style.top, minWidth: `${Math.max(48, 40 * s)}px`, minHeight: area.style.height });
    discard.style.left = `calc(${area.style.left} + ${field.offsetWidth}px)`;
  };
  const dropField = () => {
    if (!field) return;
    const focused = document.activeElement === field;
    field.remove();
    field = textEditor && (textEditor.field = null);
    area.classList.remove("under-field");
    if (focused) area.focus();
  };
  const useField = () => {
    if (field || fieldLoading) return placeField();
    fieldLoading = true;
    const s = p.el.clientWidth / p.size[0];
    mathField(area.value, { ...style, size: style.size * s }, {
      onInput: (latex) => { area.value = latex; fit(); placeField(); },
    }).then((mf) => {
      if (textEditor?.area !== area || !style.math || area.value.includes("$")) return;
      field = textEditor.field = mf;
      // Esc and Ctrl+Enter finish the box before the field sees them; other keys go to the
      // field, and stop there (no tool or study shortcuts while a formula is typed).
      mf.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) closeText(); else commitText(); }
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); commitText(); }
      }, true);
      mf.addEventListener("keydown", (e) => e.stopPropagation());
      mf.addEventListener("focusout", () => setTimeout(() => {
        if (textEditor?.field !== mf || document.activeElement === mf || document.activeElement === area || textFormatBar.contains(document.activeElement) || Date.now() - textFormatPressed < 1000) return;
        commitText();
      }, 0));
      area.classList.add("under-field");
      p.el.append(mf);
      mounted(mf);
      placeField();
      mathKeys.attach(mf);
      // MathLive takes the focus only once it is mounted (the hidden text box has lost it).
      focusField(mf);
      keepTextVisible();
    }).catch(() => status("The formula editor could not load: type the LaTeX instead.", true)).finally(() => { fieldLoading = false; });
  };
  const showMath = () => {
    const formula = style.math && !area.value.includes("$");
    if (!formula) dropField();
    mathPreview.hidden = !style.math || formula;
    if (!style.math) return mathKeys.detach();
    if (formula) return useField();
    mathKeys.attach(area);
    const s = p.el.clientWidth / p.size[0];
    Object.assign(mathPreview.style, { left: area.style.left, top: `calc(${area.style.top} + ${area.style.height} + 6px)` });
    previewMath(mathPreview, area.value, { ...style, size: style.size * s }).catch(() => { mathPreview.textContent = "Math needs KaTeX, which could not load."; });
  };
  const refit = () => { fit(); placeDiscard(); showMath(); };
  refit();
  area.oninput = refit;
  hideText(p, existing?.id);
  p.el.append(area, discard, mathPreview);
  selection.clear();
  textEditor = { p, area, discard, mathPreview, existing, style, initial: { ...style }, bx, by, layer: activeLayer, fit: refit };
  showTextFormat(p, [bx, by, 0, 0], style, () => { refit(); area.focus(); });
  area.addEventListener("keydown", (e) => {
    // Esc keeps what was typed (as clicking away does); Shift + Esc, or the ×, throws it away.
    if (e.key === "Escape") { e.preventDefault(); if (e.shiftKey) closeText(); else commitText(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { commitText(); return; }
    // Typing stays in the box: no tool or study shortcuts while editing.
    e.stopPropagation();
  });
  // Leaving the box finishes it, unless the focus went to its format bar (or came back,
  // as when the page is redrawn under it: renderPage).
  area.addEventListener("blur", () => setTimeout(() => {
    if (textEditor?.area !== area || document.activeElement === area || (textEditor.field && document.activeElement === textEditor.field) || textFormatBar.contains(document.activeElement) || Date.now() - textFormatPressed < 1000) return;
    commitText();
  }, 0));
  requestAnimationFrame(() => { area.focus(); unprime(); keepTextVisible(); });
  status(existing ? "Editing text. Esc, Ctrl+Enter or a click outside finishes; Shift+Esc or × discards." : "Type your text. Esc, Ctrl+Enter or a click outside finishes; Shift+Esc or × discards.");
}
// A typed text box's drawn copy, hidden while the box over it shows its text instead.
function hideText(p, id, hidden = true) {
  const item = id != null && p.render?.querySelector(`[data-item="${id}"]`);
  if (item) hidden ? item.setAttribute("visibility", "hidden") : item.removeAttribute("visibility");
}
function endText() {
  const t = textEditor;
  textEditor = null;
  t?.discard.remove();
  t?.mathPreview.remove();
  mathKeys.detach();
  $("pages").style.marginBottom = "";
  hideTextFormat();
  return t;
}
function closeText() {
  const t = endText();
  if (!t) return;
  hideText(t.p, t.existing?.id, false);
  t.area.remove();
  t.field?.remove();
}
// Finished text stays on screen as typed, in the box without its frame, until a render of
// its page with the edit is in place (renderPage): removing the box at once left the text
// gone while the edit was saved and the page redrawn. action() sets `revision` once the
// edit is in the note, or lets the box go if it never gets there.
function holdText() {
  const t = endText();
  // A formula stays as typeset in its field until the page shows it.
  if (t.field) {
    t.area.remove();
    t.field.readOnly = true;
    t.field.tabIndex = -1;
    const hold = { p: t.p, els: [t.field], item: t.existing?.id, revision: Infinity };
    (t.p.held ||= []).push(hold);
    return hold;
  }
  t.area.readOnly = true;
  t.area.tabIndex = -1;
  t.area.setAttribute("aria-hidden", "true");
  t.area.className = "text-placeholder";
  t.area.blur();
  const hold = { p: t.p, els: [t.area], item: t.existing?.id, revision: Infinity };
  (t.p.held ||= []).push(hold);
  return hold;
}
// Finished strokes (this reader's, or another person's live line) stay in the page's
// overlay the same way: a redraw for any other reason, or one with only the edits the
// engine has answered so far, left them gone until a later render had them.
function holdInk(p, ...els) {
  for (const el of els) {
    el.classList.add("pending-ink");
    if (p.overlay && el.parentNode !== p.overlay) p.overlay.append(el);
  }
  const hold = { p, els, ink: true, revision: Infinity };
  (p.held ||= []).push(hold);
  return hold;
}
// The edit was refused, or the note changed: the box goes, and the text it covered shows.
function letGo(hold) {
  if (!hold || hold.revision !== Infinity) return;
  hold.p.held = hold.p.held.filter((h) => h !== hold);
  for (const el of hold.els) el.remove();
  if (!hold.ink) hideText(hold.p, hold.item, false);
}
// After a render of the page at `version` (strokes, `ink`, or text boxes): those whose edit
// it has go; the others stay, strokes in the new overlay and boxes over the page.
function keepHeld(p, version, ink) {
  p.held = (p.held || []).filter((h) => {
    if (!!h.ink !== ink) return true;
    const keep = h.revision > version;
    for (const el of h.els) if (keep) (ink ? p.overlay : p.el).append(el); else el.remove();
    if (keep && !ink) hideText(p, h.item);
    return keep;
  });
}
async function commitText() {
  const t = textEditor;
  if (!t) return;
  const value = t.area.value.replace(/\s+$/, "");
  const text = textPayload(value, t.style);
  const same = t.existing && value === boxText(t.existing) && JSON.stringify(t.style) === JSON.stringify(t.initial);
  if (same || (!t.existing && !value.trim())) return closeText();
  const hold = holdText();
  if (t.existing && !value.trim()) return action("remove", { page: t.p.index, itemId: t.existing.id }, hold);
  const [w, h] = await boxSize(value || " ", t.style);
  if (t.existing) return action("editText", { page: t.p.index, itemId: t.existing.id, text, width: w, height: h }, hold);
  await action("image", { page: t.p.index, image: { base64: "", mime: "", bounds: [t.bx, t.by, w, h], layer: t.layer, text } }, hold);
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
// A PDF page's raster is a canvas under the page's SVG, or a picture inside it on pages with
// much ink (pdf-background.js explains why). Past this many ink elements, a picture.
const INK_HEAVY = 100;
function inkCount(svg) {
  let count = 0;
  for (let at = svg.indexOf('data-item="'); at >= 0; at = svg.indexOf('data-item="', at + 1)) count++;
  return count;
}
// The canvas over the PDF's rectangle on the page.
function placeRaster(canvas, place, size) {
  canvas.className = "pdf-raster";
  Object.assign(canvas.style, {
    left: `${(place.x / size[0]) * 100}%`,
    top: `${(place.y / size[1]) * 100}%`,
    width: `${(place.width / size[0]) * 100}%`,
    height: `${(place.height / size[1]) * 100}%`,
  });
  return canvas;
}
// With the PDF as a canvas beneath the SVG, the paper colour moves from the SVG to the render
// behind both, and blending (highlighter) happens in the render (style.css), not the SVG alone.
function underPaper(render) {
  const svg = render.firstElementChild, paper = svg?.querySelector("[data-background] > rect");
  if (!paper || render.dataset.paper) return;
  render.dataset.paper = paper.getAttribute("fill") || "#ffffff";
  render.style.backgroundColor = render.dataset.paper;
  paper.setAttribute("fill", "none");
  svg.style.isolation = "auto";
}
// The page's SVG to save as a file, as it is in the note: the paper and the PDF inside it.
async function pageSvg(p) {
  const svg = p.render.firstElementChild.cloneNode(true);
  if (p.render.dataset.paper) {
    svg.querySelector("[data-background] > rect")?.setAttribute("fill", p.render.dataset.paper);
    svg.style.isolation = "isolate";
  }
  const raster = p.render.querySelector(":scope > canvas.pdf-raster");
  if (raster && p.view?.pdf_background)
    svg.querySelector("[data-background]")?.append(pdfImage(raster.toDataURL("image/png"), backgroundPlacement(p.view.pdf_background, p.size)));
  // A blob: URL means nothing outside this window.
  for (const image of svg.querySelectorAll('image[href^="blob:"]')) {
    const blob = await (await fetch(image.getAttribute("href"))).blob();
    image.setAttribute("href", await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }));
  }
  return svg;
}
// The raster a page shows (a canvas, or a picture's URL), to release.
const shownRaster = (render) => render?.querySelector(":scope > canvas.pdf-raster") || render?.querySelector("[data-background] > image")?.getAttribute("href");
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
// The tape's stripes (the core's TAPE_DEFS) come as one pattern per page SVG, id ncTape,
// painted onto each tape's copy by a CSS rule. Safari on iOS draws them unreliably that way:
// every page has the same id, and the paint is a url() in a style sheet. Here each page gets
// its own pattern id and the copies get it as plain attributes, which every browser
// resolves; the style rule goes, so no page's copy depends on another page's pattern.
function paintTapes(render, key) {
  const pattern = render?.querySelector('pattern[id^="ncTape"]');
  if (!pattern) return;
  const id = `ncTape-p${key}`;
  pattern.id = id;
  for (const style of render.querySelectorAll("defs > style")) if (style.textContent.includes("nc-tape-pattern")) style.remove();
  for (const el of render.querySelectorAll(".nc-tape-pattern :is(path, rect, circle, polygon, polyline)")) {
    if (el.localName === "polyline") el.setAttribute("stroke", `url(#${id})`);
    else { el.setAttribute("fill", `url(#${id})`); el.setAttribute("stroke", "none"); }
  }
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
  const note = epoch, edits = pageEdits(panel), cache = backgrounds;
  try {
    const result = panel.view || (await call("view", { page: panel.index }));
    if (note !== epoch) return;
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
        image.src = url;
        await image.decode();
        if (note !== epoch || edits !== pageEdits(panel)) return;
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
      panel.thumbnailEdits = edits;
    }
  } catch {
    // The numbered fallback remains useful if a thumbnail cannot be decoded.
  } finally {
    panel.thumbnailLoading = false;
    // Edited while it was drawn: again once the pen pauses, not at once (it would redraw
    // continuously while writing).
    if (note === epoch && edits !== pageEdits(panel)) updatePagePreview(panel, true);
  }
}
// A page's thumbnail is redrawn once the pen has paused, not after every stroke: drawing it
// (the page as an image, its PDF background) holds the main thread, and the next stroke's
// pen events would wait behind it.
const thumbsDue = new Set();
let thumbsTimer = 0;
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
  if (gesture || mutationPending > 0) { thumbsTimer = setTimeout(refreshThumbnails, 600); return; }
  const due = [...thumbsDue];
  thumbsDue.clear();
  for (const panel of due) {
    if (!panels.includes(panel) || panel.thumbnailEdits === pageEdits(panel)) continue;
    panel.thumbnailReady = false;
    queueThumbnail(panel);
  }
}
let markedPage = -1;
function markPage() {
  panels[markedPage]?.pageButton?.removeAttribute("aria-current");
  // The list can be rebuilt: clear stray marks only then.
  if (markedPage < 0) for (const panel of panels) panel.pageButton?.removeAttribute("aria-current");
  panels[page]?.pageButton?.setAttribute("aria-current", "page");
  markedPage = page;
}
// Phones held upright (narrow) and phones held sideways (short) both get the compact
// layout: the page list is a drawer over the pages and undo, redo and the panel toggles
// share the page row, so the chrome does not eat a short screen.
const COMPACT = "(max-width:700px), (orientation: landscape) and (max-height:500px)";
const phoneLayout = matchMedia(COMPACT);
function syncPagePanel() {
  const small = phoneLayout.matches;
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
  if (phoneLayout.matches) {
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
phoneLayout.addEventListener("change", () => {
  $("pagesPanel").hidden = false;
  syncPagePanel();
});
// Narrow windows: undo, redo and the panel toggles join the page row, so phones get two
// bars (pages, tools) instead of three. Wider windows drop the tool labels before the
// toolbar would wrap or push tools out of sight.
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
    bar.classList.toggle("tools-icons", !toolNamesOn() || overflowing);
  });
}
// View → Tool names in the tool bar: off, the tools show only their icons (names in tooltips).
const toolNamesOn = () => $("toolNames").getAttribute("aria-checked") !== "false";
try { if (localStorage.getItem("notecomplete-tool-names") === "0") $("toolNames").setAttribute("aria-checked", "false"); } catch { /* Optional. */ }
$("toolNames").onclick = () => {
  const on = !toolNamesOn();
  $("toolNames").setAttribute("aria-checked", String(on));
  try { localStorage.setItem("notecomplete-tool-names", on ? "1" : "0"); } catch { /* Optional. */ }
  fitTools();
  status(on ? "Tool names shown when they fit." : "Tool bar: icons only.");
};
// View → Tool bar (or the page row's button): the page row and the tools at the top (default)
// or as columns on the left or right, like the drawing tablet's dock. Every layout but a
// phone held upright uses it (style.css); remembered on this device.
function setLandscapeDock(side) {
  if (!["top", "left", "right"].includes(side)) side = "top";
  document.body.dataset.landscapeDock = side;
  for (const b of document.querySelectorAll("[data-dock-menu]")) b.setAttribute("aria-pressed", String(b.dataset.dockMenu === side));
  // The page row's own button shows where the bar is now and moves it on: top → left → right.
  const next = { top: "left", left: "right", right: "top" }[side];
  $("dockCycle").querySelector("svg").innerHTML = document.querySelector(`[data-dock-menu="${side}"] svg`).innerHTML;
  $("dockCycle").title = `Tool bar: ${side}. Move it to the ${next} (also View → Tool bar)`;
  $("dockCycle").setAttribute("aria-label", `Move the tool bar to the ${next}`);
  try { localStorage.setItem("notecomplete-landscape-dock", side); } catch { /* Optional. */ }
  if (doc) requestAnimationFrame(resize);
}
$("dockCycle").onclick = () => setLandscapeDock({ top: "left", left: "right", right: "top" }[document.body.dataset.landscapeDock] || "left");
for (const b of document.querySelectorAll("[data-dock-menu]")) b.onclick = () => { setLandscapeDock(b.dataset.dockMenu); for (const m of document.querySelectorAll("details.menu")) m.open = false; };
try { setLandscapeDock(localStorage.getItem("notecomplete-landscape-dock")); } catch { setLandscapeDock("top"); }
phoneLayout.addEventListener("change", placeToolbarActions);
addEventListener("resize", fitTools);
placeToolbarActions();
syncPagePanel();
function placeholder(p) {
  const raster = shownRaster(p.render);
  p.render = null;
  p.overlay = null;
  p.ink = null;
  // Its text and search layers go with it (find.js makes them again when it is back).
  p.textLayer = null;
  p.findLayer = null;
  const span = document.createElement("span");
  span.className = "page-placeholder";
  span.textContent = `Page ${p.index + 1}`;
  p.el.replaceChildren(span);
  backgrounds?.release(raster);
}
function resize() {
  if (!doc) return;
  const fit = zoom === "fit",
    pages = $("pages"),
    styles = getComputedStyle(pages);
  // Free position pads the sides by half a window so pages can move anywhere; Fit uses the
  // normal margin (the top padding) instead, or the pages would fit into almost nothing.
  const gutter = pages.dataset.align === "free"
    ? 2 * parseFloat(styles.paddingTop)
    : parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
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
  clearTimeout(p.renderTimer);
  // A page from before the pages were rebuilt (restructure) draws nothing more.
  if (panels[p.index] !== p) return;
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
    // A view kept from before (a zoom, a new raster) has only the edits it had then.
    const shows = provided && provided === p.view ? p.viewRevision : version;
    p.view = result;
    p.viewRevision = shows;
    const render = document.createElement("div");
    render.className = "render";
    render.innerHTML = result.svg;
    paintTapes(render, p.index);
    // An edit redraws the page's ink; the PDF raster under it stays the same,
    // so the existing image moves over at once instead of blinking out while
    // the background cache answers.
    const displayWidth = p.el.clientWidth || p.size[0];
    // At another width the old raster (placed in page units) stays as a
    // placeholder until the sharper one arrives.
    const kind = result.pdf_background && (inkCount(result.svg) > INK_HEAVY ? "url" : "canvas");
    const pdfKey = result.pdf_background && JSON.stringify([result.pdf_background, p.size, displayWidth, displayQuality, globalThis.devicePixelRatio || 1, kind]);
    const previous = result.pdf_background && p.pdfKey && JSON.stringify(JSON.parse(p.pdfKey).slice(0, 2)) === JSON.stringify([result.pdf_background, p.size])
      ? p.render?.querySelector(":scope > canvas.pdf-raster, [data-background] > image") : null;
    // A canvas (this page's, or the previous one kept until the new raster is ready) lies
    // beneath the SVG, so the SVG's paper must let it through.
    if (kind === "canvas" || previous?.localName === "canvas") underPaper(render);
    if (previous?.localName === "canvas") render.prepend(previous);
    else if (previous) render.querySelector("[data-background]")?.append(previous);
    const kept = pdfKey === p.pdfKey ? previous : null;
    applyTapes({ ...p, view: result }, render);
    const overlay = document.createElementNS(ns, "svg");
    overlay.classList.add("overlay");
    overlay.setAttribute("viewBox", `0 0 ${p.size.join(" ")}`);
    // The new page goes in at once with what is still drawn over the old one: others' live
    // lines, and strokes waiting for a render with their edit. Nothing blinks out between.
    if (p.overlay) overlay.append(...p.overlay.querySelectorAll(":scope > .remote-ink"));
    p.render = render;
    p.overlay = overlay;
    keepHeld(p, shows, true);
    const typing = textEditor?.p === p && (document.activeElement === textEditor.area || (textEditor.field && document.activeElement === textEditor.field));
    p.el.replaceChildren(render, overlay, lockMarks(result));
    if (resizeMode?.page === p.index) p.el.append(resizeFrame(p));
    // Typed text is not lost to a redraw (another screen's edit, a zoom): finished text
    // waiting for its own render stays, and so does the box being typed in.
    keepHeld(p, shows, false);
    if (textEditor?.p === p) {
      p.el.append(textEditor.area, textEditor.discard, textEditor.mathPreview, ...(textEditor.field ? [textEditor.field] : []));
      hideText(p, textEditor.existing?.id);
      textEditor.fit();
      if (typing) (textEditor.field || textEditor.area).focus({ preventScroll: true });
    }
    if (textFormatTarget?.p === p && !textFormatDocked()) p.el.append(textFormatBar);
    typesetMath(render, result.texts);
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
      let raster = await backgrounds.raster(
        result.pdf_background,
        p.size,
        displayWidth * place.share,
        displayQuality,
        kind,
      );
      if (note !== epoch || token !== p.token || version !== revision) return;
      // A URL also for a canvas too large for some screens (pdf-background.js rasterKind).
      if (typeof raster === "string") render.querySelector("[data-background]").append(pdfImage(raster, place));
      else {
        // The same PDF page on two pages of the note: each shows its own copy.
        if (raster.isConnected && raster.parentNode !== render) raster = copyCanvas(raster);
        render.prepend(placeRaster(raster, place, p.size));
      }
      // Unless another page has taken it from the cache meanwhile: then it is that page's.
      if (previous && previous !== raster && render.contains(previous)) {
        previous.remove();
        backgrounds.release(previous.localName === "canvas" ? previous : previous.getAttribute("href"));
      }
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
      // No text or ink left waiting over a page that could not be drawn.
      for (const h of p.held || []) if (h.revision <= version) for (const el of h.els) el.remove();
      p.held = (p.held || []).filter((h) => h.revision > version);
    }
  } finally {
    p.loading = false;
    if (note === epoch && panels[p.index] === p) {
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
  // The box fits the longest page number (no clipped digits in narrow and compact bars).
  $("pageNumber").style.setProperty("--digits", String(Math.max(2, String(doc.pages).length)));
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
// Shift scrolls three times as far (fast scrolling with the keyboard).
function scrollViewport(key, fast = false) {
  const viewport = $("viewport"), times = fast ? 3 : 1,
    vertical = Math.max(48, Math.round(viewport.clientHeight * 0.8)) * times,
    horizontal = Math.max(48, Math.round(viewport.clientWidth * 0.8)) * times;
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
    // Usually still on the same page (or its neighbour): two reads instead of a search.
    const here = panels[page]?.el.getBoundingClientRect();
    if (here && here.bottom >= top && (page === 0 || panels[page - 1].el.getBoundingClientRect().bottom < top)) return;
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
  $("pressureOptions").hidden = tool !== "draw";
  $("snapOptions").hidden = tool !== "draw";
  $("drawingOptions").hidden = tool === "select" || tool === "text";
  // The eraser shows only its size; color and width do not apply to it.
  $("drawingOptions").classList.toggle("erasing", tool === "erase");
  $("eraseOptions").hidden = tool !== "erase";
  $("selectionOptions").hidden = tool !== "select" || !selection.item;
  // The text format bar, when docked here, shows while a text box is typed or selected.
  const textDock = !$("textFormat").hidden && $("textFormat").parentElement === $("toolOptions");
  const usual = optionsOpen && (["draw", "highlight", "shape", "tape", "erase"].includes(tool) || (tool === "select" && selection.item));
  $("toolOptions").hidden = chromeState.compact || !(usual || textDock);
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
// `hold`: typed text or a stroke kept on screen until the page's render with this edit
// (holdText, holdInk).
async function action(op, args = {}, hold = null) {
  if (!doc || editing) return letGo(hold);
  mutationPending++;
  const token = epoch;
  try {
    const result = await mutate(op, args);
    if (token !== epoch) return;
    if (edited(op, args, result)) return;
    // A new shape is selected to adjust it, except on a drawing tablet (it keeps drawing shapes).
    if (op === "draw" && args.line.shape && !args.recognized && !gesture && collab?.role !== "tablet") {
      document.querySelector("[data-tool=select]").click();
      selection.selectId(args.page ?? page, `new:${result.edit_count - 1}`);
    } else if (selection.item) {
      selection.selectId(selection.item.page, selection.item.id);
    }
    if (hold) hold.revision = revision;
    showEdit(op, args, result);
    // Ordinary edits say nothing: the save icon in the bar shows there are unsaved changes.
    if (collab?.role !== "tablet" && op === "lock") status(args.locked ? "Locked in place: it cannot be selected, moved or erased. Click it again to unlock." : "Unlocked.");
  } catch (e) {
    if (token === epoch) status(e.message, true);
  } finally {
    mutationPending--;
    // A stroke or text that was not saved (refused, or the note changed) does not stay.
    letGo(hold);
    if (token === epoch) {
      for (const p of panels) {
        if (gesture?.panel !== p) {
          // Finished strokes waiting for the page to be redrawn stay (holdInk), and so do
          // others' live lines.
          for (const child of [...(p.overlay?.children || [])]) if (!kept(child)) child.remove();
          shapeHandles(p);
        }
      }
    }
  }
}
// The note changed by `op` (here, or in a sharing session on another screen). Returns
// true when the pages were rebuilt (inserted pages, or a page size changed).
function edited(op, args, result) {
  // A tablet's copy is the computer's note: the computer saves it, not the tablet.
  if (collab?.role !== "tablet") dirty = changed = true;
  revision++;
  doc = result;
  savedState();
  // An infinite canvas that grew (or shrank on undo) keeps its place on screen: the
  // page is resized where it is and redrawn, not rebuilt.
  const size = result.page_sizes[0];
  if (result.canvas && result.pages === 1 && panels.length === 1 && (size[0] !== panels[0].size[0] || size[1] !== panels[0].size[1])) {
    panels[0].size = size;
    panels[0].el.style.aspectRatio = size.join("/");
    resize();
    return false;
  }
  if (result.pages !== panels.length || result.page_sizes.some((s, i) => s[0] !== panels[i].size[0] || s[1] !== panels[i].size[1])) {
    restructure(result, args.focus ?? Math.min(page, result.pages - 1), op === "resizePage" ? "Page resized. You can undo this change." : op === "resizePages" ? `All ${result.pages} pages resized. One undo restores them.` : undefined);
    return true;
  }
  return false;
}
function showEdit(op, args, result) {
  updateTools(result);
  layerPanel(result.layers);
  // Ink edits change one page; undo, redo and layers may change any.
  const only = ["draw", "drawMany", "erase", "remove", "lock", "image", "editText", "adjust", "crop", "resize"].includes(op) ? args.page : null;
  for (const p of panels) {
    if (only != null && p.index !== only) continue;
    p.edits = pageEdits(p) + 1;
    p.token++;
    if (!(p.near || p.index === page)) continue;
    // Strokes in quick succession: the page is redrawn once the pen pauses. Until then the
    // strokes stay on screen as drawn, and the next one starts at once instead of waiting
    // for the whole page to be rebuilt.
    if (op === "draw" && !args.line?.shape && p.index === result.page) laterRender(p, result);
    else renderPage(p, p.index === result.page ? result : undefined);
  }
}
const RENDER_PAUSE = 300;
function laterRender(p, result) {
  clearTimeout(p.renderTimer);
  p.pendingView = result;
  p.pendingRevision = revision;
  const due = () => {
    if (p.pendingRevision !== revision) return; // A later edit draws it.
    if (gesture?.panel === p) { p.renderTimer = setTimeout(due, RENDER_PAUSE); return; }
    const view = p.pendingView;
    p.pendingView = null;
    renderPage(p, view);
  };
  p.renderTimer = setTimeout(due, RENDER_PAUSE);
}
// An edit in the session's shared order. This reader's own edits finish where they
// were made (action, patchItem…); others' are shown here.
// `live`: another person's line for this stroke (collab.js), kept until the page's render
// has the stroke.
async function applyShared({ op, args }, mine, live = null) {
  let held = false;
  try {
    const result = await call(op, args);
    if (!mine && doc && !edited(op, args, result)) {
      if (live && panels[args.page]) {
        holdInk(panels[args.page], live).revision = revision;
        held = true;
      }
      showEdit(op, args, result);
    }
    return result;
  } finally {
    if (!held) live?.remove();
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
  clearTimeout(g.holdTimer);
  collab?.drawn(g, true);
  // A cancelled grab takes only its own box away: a region grabbed before keeps its menu.
  if (g.tool === "grab") {
    g.el.remove();
    if (g.hidMenu && grabbed) $("grabMenu").hidden = false;
  } else for (const child of [...(g.panel.overlay?.children || [])]) if (!kept(child)) child.remove();
  if (g.hidden) g.hidden.style.visibility = "";
  shapeHandles(g.panel);
  if (g.panel.el.hasPointerCapture(g.id))
    g.panel.el.releasePointerCapture(g.id);
  if (g.panel.stale) {
    g.panel.stale = false;
    renderPage(g.panel);
  }
}
// Overlay lines that outlast a gesture or an edit: finished strokes and others' live lines.
const kept = (el) => el.classList.contains("pending-ink") || el.classList.contains("remote-ink");
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
// A stylus counts as in use for half a minute after it last touched or hovered the page.
const PEN_ACTIVE_MS = 30000;
let lastPen = -Infinity, lastPenWrote = -Infinity;
const notePen = (e) => {
  if (e.pointerType === "pen") {
    lastPen = performance.now();
    // Touching the page, not hovering: an Apple Pencil that hovers (held near the screen
    // while two fingers open the quick menu) sends moves all the time.
    if (e.buttons || e.type !== "pointermove") lastPenWrote = lastPen;
  }
  // Fingers and pens never select the text over the pages (it would pick words while
  // scrolling or drawing); the mouse still does.
  if (e.type === "pointerdown") {
    const touchy = e.pointerType !== "mouse";
    document.body.classList.toggle("touch-pointer", touchy);
    if (touchy && e.target.closest?.(".sheet")) window.getSelection()?.removeAllRanges();
  }
};
for (const type of ["pointerdown", "pointermove", "pointerup"]) window.addEventListener(type, notePen, { capture: true, passive: true });
// Pen smoothing on or off (View menu), per device: off, the line follows the pen exactly.
let smoothingOn = true;
try { smoothingOn = localStorage.getItem("notecomplete-pen-smoothing") !== "0"; } catch { /* Optional. */ }
const smoothingSwitch = () => $("penSmoothToggle").setAttribute("aria-checked", String(smoothingOn));
smoothingSwitch();
$("penSmoothToggle").onclick = () => {
  smoothingOn = !smoothingOn;
  try { localStorage.setItem("notecomplete-pen-smoothing", smoothingOn ? "1" : "0"); } catch { /* Optional. */ }
  smoothingSwitch();
  status(smoothingOn ? "Pen smoothing on." : "Pen smoothing off: strokes follow the pen exactly.");
};
// Pen hover preview: a ring at the pen's tip, as wide as it would draw, while it hovers (pointer
// events with no button held). An Apple Pencil shows nothing of its own; Samsung and other
// Android devices draw a system-wide hover pointer, so there it starts off. Per device.
const appleDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let penHoverOn = appleDevice;
try { const saved = localStorage.getItem("notecomplete-pen-hover"); if (saved === "1" || saved === "0") penHoverOn = saved === "1"; } catch { /* Optional. */ }
const penHoverRing = document.createElement("div");
penHoverRing.id = "penHover"; penHoverRing.hidden = true; penHoverRing.setAttribute("aria-hidden", "true");
document.body.append(penHoverRing);
const hidePenHover = () => { penHoverRing.hidden = true; };
function showPenHover(e) {
  if (!penHoverOn || !doc || e.pointerType !== "pen" || e.buttons) return hidePenHover();
  const sheet = e.target.closest?.(".sheet"), p = sheet && panels[Number(sheet.dataset.page)];
  if (!p || !["draw", "highlight", "erase", "tape"].includes(tool)) return hidePenHover();
  const scale = p.el.getBoundingClientRect().width / p.size[0];
  const size = Math.max(6, (tool === "erase" ? eraserRadius() * 2 : Number($("width").value) || 2) * scale);
  const style = penHoverRing.style;
  style.width = style.height = `${size}px`;
  style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size / 2}px)`;
  penHoverRing.dataset.tool = tool;
  style.setProperty("--hover-color", tool === "erase" ? "#ed6b55" : $("color").value);
  penHoverRing.hidden = false;
}
window.addEventListener("pointermove", showPenHover, { capture: true, passive: true });
window.addEventListener("pointerdown", hidePenHover, { capture: true, passive: true });
window.addEventListener("pointerout", (e) => { if (e.pointerType === "pen" && !e.relatedTarget) hidePenHover(); }, { capture: true, passive: true });
window.addEventListener("blur", hidePenHover);
// What a button does, as on a computer: a mouse hover shows the title natively, but a finger has
// no hover. Pressing an icon for a moment (or a pen hovering over it) shows its name; a long
// press that showed it does not also press the button.
const tip = document.createElement("div");
tip.id = "touchTip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
document.body.append(tip);
let tipTimer = 0, tipHide = 0, tipFor = null, tipSuppress = null;
const tipText = (el) => (el.getAttribute("title") || el.getAttribute("aria-label") || "").trim();
const tipTarget = (node) => {
  if (!node?.closest || node.closest(".qm-disc, .qm-item-menu, .text-editor, input, textarea, select")) return null;
  const el = node.closest("button, a, summary, label.icon-toggle, [role=menuitem], [role=radio], [role=tab]");
  return el && tipText(el) ? el : null;
};
const hideTip = () => { clearTimeout(tipTimer); clearTimeout(tipHide); tip.hidden = true; tipFor = null; };
function showTip(el) {
  tip.textContent = tipText(el).split("\n")[0];
  tip.hidden = false; tipFor = el;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.top - h - 8 > 4 ? r.top - h - 8 : r.bottom + 8}px`;
  clearTimeout(tipHide); tipHide = setTimeout(hideTip, 2800);
}
document.addEventListener("pointerdown", (e) => {
  hideTip();
  if (e.pointerType === "mouse") return;
  const el = tipTarget(e.target);
  if (!el) return;
  const x = e.clientX, y = e.clientY;
  tipTimer = setTimeout(() => {
    showTip(el); tipSuppress = el;
    setTimeout(() => { if (tipSuppress === el) tipSuppress = null; }, 1500);
  }, 450);
  const stop = (m) => { if (m.type !== "pointermove" || Math.hypot(m.clientX - x, m.clientY - y) > 10) { clearTimeout(tipTimer); document.removeEventListener("pointermove", stop, true); document.removeEventListener("pointerup", stop, true); document.removeEventListener("pointercancel", stop, true); } };
  document.addEventListener("pointermove", stop, true); document.addEventListener("pointerup", stop, true); document.addEventListener("pointercancel", stop, true);
}, { capture: true, passive: true });
document.addEventListener("click", (e) => {
  if (tipSuppress && tipSuppress.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); tipSuppress = null; }
}, true);
document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "pen") return;
  const el = tipTarget(e.target);
  if (!el || el === tipFor) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(el), 400);
}, { capture: true, passive: true });
document.addEventListener("pointerout", (e) => { if (e.pointerType === "pen") hideTip(); }, { capture: true, passive: true });
document.addEventListener("scroll", hideTip, { capture: true, passive: true });
const penHoverSwitch = () => $("penHoverToggle").setAttribute("aria-checked", String(penHoverOn));
penHoverSwitch();
$("penHoverToggle").onclick = () => {
  penHoverOn = !penHoverOn;
  try { localStorage.setItem("notecomplete-pen-hover", penHoverOn ? "1" : "0"); } catch { /* Optional. */ }
  if (!penHoverOn) hidePenHover();
  penHoverSwitch();
  status(penHoverOn ? "Pen hover preview on: a ring shows where the pen will draw." : "Pen hover preview off.");
};
const penActive = () => performance.now() - lastPen < PEN_ACTIVE_MS;
const FINGER_PANS = new Set(["draw", "highlight", "erase", "tape", "shape"]);
let viewOnlyToldAt = -Infinity;
function pointerDown(e, p) {
  // A view-only guest: say why nothing is drawn (at most every few seconds), and keep Pan.
  if (collab?.readOnly && (e.pointerType === "pen" || tool !== "pan")) {
    if (e.timeStamp - viewOnlyToldAt > 4000) {
      viewOnlyToldAt = e.timeStamp;
      status("This note is shared view-only: you can read it and its notes, and follow along. To draw, ask the host to share it for editing.", true);
    }
    if (tool !== "pan") { chooseTool("pan"); return; }
  }
  if (thumbsDue.size) { clearTimeout(thumbsTimer); thumbsTimer = setTimeout(refreshThumbnails, 1200); }
  if (gesture) {
    if (e.pointerId === gesture.id) return;
    // A stylus has one tip: a new pen-down means the last stroke's lift never arrived
    // (iPadOS can swallow it). That stroke is kept and the new one starts at once.
    if (e.pointerType === "pen" && gesture.pen && gesture.lastClient) {
      const [clientX, clientY] = gesture.lastClient;
      pointerUp({ pointerId: gesture.id, clientX, clientY, timeStamp: e.timeStamp });
    } else {
      cancelGesture();
      return;
    }
  }
  if (!doc || editing || !p.view || e.button !== 0) return;
  // A link written in the handwriting opens on click (Pan and Select); no drag starts.
  if (e.target.closest?.(".ink-link") && (tool === "pan" || tool === "select")) return;
  setPage(p.index);
  // While a stylus is in use, fingers move the page instead of drawing (palm and finger
  // rejection, as in drawing apps); with the stylus put away, a finger draws again.
  const touchPan = collab?.touchPans(e) || (e.pointerType === "touch" && penActive() && FINGER_PANS.has(tool));
  // Text with a finger or stylus: the box opens when the tap lifts, since phones open the
  // keyboard only for a focus made then (not when the tap starts); a drag moves the page.
  const textTap = tool === "text" && e.pointerType !== "mouse" && !textEditor;
  if (!touchPan && selection.down(e, p, tool)) return;
  if (tool === "pan" || touchPan || textTap) {
    // On PDF or recognized words the mouse selects text instead of panning.
    if (!touchPan && !textTap && (e.pointerType !== "mouse" || e.target.closest?.(".text-layer tspan"))) return;
    window.getSelection()?.removeAllRanges();
    e.preventDefault();
    gesture = {
      id: e.pointerId,
      tool: "pan",
      panel: p,
      // A finger or stylus drag glides on when it lifts; a mouse drag stops where it is.
      speed: e.pointerType === "mouse" ? null : new VelocityTracker(),
      x: e.clientX,
      y: e.clientY,
      left: $("viewport").scrollLeft,
      top: $("viewport").scrollTop,
      text: textTap ? point(e, p) : null,
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
    // The box shows once the pointer moves (appendPoint). The first finger of a two-finger
    // hold, or a pen held still, opens the quick menu instead: that cancels this before
    // anything is drawn or the last grab's menu is hidden.
    const slop = e.pointerType === "touch" ? 12 : e.pointerType === "pen" ? 4 : 0;
    gesture = { id: e.pointerId, tool, panel: p, start, points: [start], el, dot: document.createElementNS(ns, "g"), from: [e.clientX, e.clientY], slop };
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
  // The highlighter blends with what is under it (multiply) as it is drawn, as the page's own
  // render of it does, so nothing changes in how it looks when that render arrives.
  if (tool === "highlight") for (const part of [el, dot]) part.style.mixBlendMode = "multiply";
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
    // A stylus reports pressure (0–1); a mouse or finger does not.
    pen: e.pointerType === "pen",
    // Strokes are smoothed: most for a stylus or a finger, a little for a mouse.
    smooth: smoothingOn && (tool === "draw" || (tool === "highlight" && $("highlightMode").value === "free")) ? (e.pointerType === "mouse" ? 0.6 : 0.35) : 0,
    pressures: [e.pressure],
    // The Shapes tool's kind when the drag started (a graph or table opens its editor at the end).
    kind: tool === "shape" ? $("shape").value : null,
  };
  if (tool === "highlight" && $("highlightMode").value === "text") startTextHighlight(gesture);
  p.el.setPointerCapture(e.pointerId);
  preview();
}
// The highlighter's Text mode (text-highlight.js): the words under the drag, as bands. A page
// with no text to pick (a scan, a drawn page) gets a straight highlight instead.
function startTextHighlight(g) {
  const layer = g.panel.textLayer;
  const words = readingOrder(textLines({ pdf: layer?.pdf || [], ocr: layer?.ocr || [] }));
  if (!words.length) {
    g.straight = true;
    status("No text to pick on this page (yet): drawing a straight highlight. Text mode needs a PDF page with text.");
    return;
  }
  g.textMode = { words, anchor: nearestWord(words, g.start), at: nearestWord(words, g.start), bands: [], preview: document.createElementNS(ns, "g") };
  g.el.style.display = "none";
  g.dot.style.display = "none";
  g.textMode.preview.style.mixBlendMode = "multiply";
  g.panel.overlay.append(g.textMode.preview);
  showTextBands(g);
}
// The bands for the words from where the drag started to where it is now.
function showTextBands(g) {
  const t = g.textMode;
  t.bands = bandsFor(t.words, t.anchor, t.at);
  t.preview.replaceChildren(...t.bands.map((b) => {
    const rect = document.createElementNS(ns, "rect");
    const line = bandLine(b, [0, 0, 0], 0);
    rect.setAttribute("x", line.points[0][0]);
    rect.setAttribute("y", b.y0 - line.width * 0.04);
    rect.setAttribute("width", line.points[1][0] - line.points[0][0]);
    rect.setAttribute("height", line.width);
    rect.setAttribute("fill", g.color);
    rect.setAttribute("opacity", 0.5);
    return rect;
  }));
}
function preview() {
  const g = gesture;
  if (!g || g.tool === "pan" || g.textMode) return;
  if (g.tool === "grab") {
    const [x, y, w, h] = grabRect(g);
    for (const [k, v] of Object.entries({ x, y, width: w, height: h })) g.el.setAttribute(k, v);
    return;
  }
  g.el.setAttribute("points", g.points.map((p) => p.join(",")).join(" "));
  // A filled shape shows its inside while it is drawn.
  if (g.tool === "shape") {
    const { fill } = fillFor($("shape").value, g.color);
    g.el.setAttribute("fill", fill ? g.color : "none");
    g.el.setAttribute("fill-opacity", fill ? fill[3] : 0);
  }
  g.dot.style.display = g.points.length > 1 ? "none" : "";
  g.dot.setAttribute("cx", g.points[0][0]);
  g.dot.setAttribute("cy", g.points[0][1]);
}
function appendPoint(e) {
  const g = gesture;
  if (g.textMode) {
    const where = point(e, g.panel), at = nearestWord(g.textMode.words, where);
    g.textMode.end = where;
    if (at !== g.textMode.at) { g.textMode.at = at; showTextBands(g); }
    return;
  }
  if (g.snapped) {
    resizeSnapped(g, point(e, g.panel));
  } else if (g.tool === "shape") {
    g.points = shapePoints($("shape").value, g.start, point(e, g.panel));
  } else if (g.tool === "grab") {
    g.points = [g.start, point(e, g.panel)];
    if (!g.el.isConnected && Math.hypot(e.clientX - g.from[0], e.clientY - g.from[1]) > g.slop) {
      g.panel.overlay.append(g.el);
      g.hidMenu ||= !$("grabMenu").hidden;
      $("grabMenu").hidden = true;
    }
  } else if (g.box) {
    const end = point(e, g.panel), y = (g.start[1] + end[1]) / 2;
    g.width = Math.max(4, Math.abs(end[1] - g.start[1]));
    g.points = [[Math.min(g.start[0], end[0]), y], [Math.max(g.start[0], end[0]), y]];
    g.el.setAttribute("stroke-width", g.width);
  } else if (g.straight) {
    g.points = highlightPoints(g.start, point(e, g.panel));
  } else {
    g.lastClient = [e.clientX, e.clientY];
    const samples = e.getCoalescedEvents?.() || [];
    for (const sample of samples.length ? samples : [e]) {
      const raw = point(sample, g.panel),
        last = g.points.at(-1);
      g.raw = raw;
      const p = followPoint(last, raw, g.smooth, g.smooth ? extentOf(g.points) : Infinity);
      if (
        Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.3 &&
        g.points.length < 8192
      ) {
        g.points.push(p);
        g.pressures.push(sample.pressure);
      }
    }
    // A stylus stroke is saved with its pressure: the line drawn meanwhile takes the
    // same average width, so it does not get thinner when it is finished.
    if (g.pen && g.tool === "draw") {
      const { pressure } = stylusPressure(g);
      if (pressure?.length) g.el.setAttribute("stroke-width", (2 * pressure.reduce((s, r) => s + r, 0)) / pressure.length);
    }
    watchHold(g, e);
  }
  if (g.snapped) return collab?.drawing(g);
  preview();
  collab?.drawing(g);
}
// Shape recognition (shape-recognize.js; docs/SHAPES-TABLES-MATH.md): with the Pen, a stroke
// held still for a moment becomes the shape it looks like (or, opt-in, on every lift).
const shapeSnap = () => $("shapeSnap").value;
const SNAP_HOLD_MS = 550;
// View → Shapes from the pen: on (hold, or on lift when chosen in the Pen's settings) or off.
function syncShapeSnapMenu() { $("shapeSnapMenu").setAttribute("aria-checked", String(shapeSnap() !== "off")); }
$("shapeSnap").addEventListener("change", syncShapeSnapMenu);
$("shapeSnapMenu").onclick = () => {
  $("shapeSnap").value = shapeSnap() === "off" ? "hold" : "off";
  $("shapeSnap").dispatchEvent(new Event("change"));
  syncChoices();
  status(shapeSnap() === "off" ? "Shapes from the pen off: strokes stay as drawn." : "Shapes from the pen: hold the pen still at the end of a stroke to make it a shape.");
};
// The timer restarts whenever the pen moves more than a few pixels.
function watchHold(g, e) {
  // Holding still works in both modes: "On lift" adds shapes made as the pen lifts.
  if (g.tool !== "draw" || shapeSnap() === "off") return;
  if (g.still && Math.hypot(e.clientX - g.still[0], e.clientY - g.still[1]) <= 4) return;
  g.still = [e.clientX, e.clientY];
  clearTimeout(g.holdTimer);
  g.holdTimer = setTimeout(() => {
    if (gesture !== g || g.snapped) return;
    const shape = recognizeShape(g.points);
    if (shape) { snapTo(g, shape); navigator.vibrate?.(8); }
  }, SNAP_HOLD_MS);
}
const SHAPE_NAMES = { line: "Line", arrow: "Arrow", rectangle: "Rectangle", ellipse: "Ellipse", triangle: "Triangle", star: "Star" };
// The stroke on screen becomes the shape; moving on before lifting resizes it.
function snapTo(g, shape, lifted = false) {
  const [x0, y0] = shape.start, [x1, y1] = shape.end;
  const square = ["rectangle", "ellipse"].includes(shape.kind) && Math.abs(Math.abs(x1 - x0) - Math.abs(y1 - y0)) < 1e-6;
  g.snapped = { ...shape, from: g.raw || g.points.at(-1), end0: shape.end };
  // A stylus stroke drawn meanwhile took its pressure's average width; the shape has the pen's.
  g.el.setAttribute("stroke-width", g.width);
  showSnapped(g);
  const name = square ? (shape.kind === "ellipse" ? "Circle" : "Square") : SHAPE_NAMES[shape.kind];
  status(lifted ? `${name} made from your stroke. Undo removes it; Shapes from the pen is in the Pen's settings.` : `${name}: lift to keep it, or move to resize it.`);
}
// The far corner follows the pen, in the shape's own frame when it is turned.
function resizeSnapped(g, at) {
  const s = g.snapped, t = -(s.rotation || 0) * Math.PI / 180, dx = at[0] - s.from[0], dy = at[1] - s.from[1];
  const [ux, uy] = s.kind === "line" || s.kind === "arrow" ? [dx, dy] : [dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t)];
  s.end = [s.end0[0] + ux, s.end0[1] + uy];
  showSnapped(g);
}
// The shape's points as drawn: turned about its box's centre, as the core will turn it.
function snappedPoints(s) {
  const points = shapePoints(s.kind, s.start, s.end);
  if (!s.rotation) return points;
  const c = [(s.start[0] + s.end[0]) / 2, (s.start[1] + s.end[1]) / 2], t = s.rotation * Math.PI / 180;
  return points.map(([x, y]) => [c[0] + (x - c[0]) * Math.cos(t) - (y - c[1]) * Math.sin(t), c[1] + (x - c[0]) * Math.sin(t) + (y - c[1]) * Math.cos(t)]);
}
function showSnapped(g) {
  g.points = snappedPoints(g.snapped);
  g.el.setAttribute("points", g.points.map((p) => p.join(",")).join(" "));
  g.dot.style.display = "none";
}
// A recognised shape is an ordinary shape (Select, corners, turning, fill all apply), in the
// pen's colour and width, and the pen stays the tool. One edit, turned in the same step.
function commitSnapped(g) {
  const s = g.snapped, rgba = [1, 3, 5].map((i) => parseInt(g.color.slice(i, i + 2), 16) / 255);
  const hold = holdInk(g.panel, g.el, g.dot);
  return action("draw", {
    page: g.panel.index,
    recognized: true,
    ...(s.rotation ? { turn: s.rotation } : {}),
    line: { points: shapePoints(s.kind, s.start, s.end), width: g.width, rgba: [...rgba, 1], tool: 0, layer: g.layer, shape: { kind: s.kind, start: s.start, end: s.end } },
  }, hold);
}
// Pen pressure from a stylus, as the core stores it: the drawn radius at each point
// (editor.rs). Light pressure draws about a third of the width, a firm press about 1.7×.
function stylusPressure(g) {
  if (!g.pen || !pressureOn() || g.pressures.length !== g.points.length) return {};
  const radii = pressureRadii(g.pressures, g.points, g.width / 2);
  return { pressure: radii.map((r) => Math.round(r * 1000) / 1000) };
}
// Mouse wheel click (middle button) drags the pages with any tool, as Pan does; text
// documents scroll the same way. It never auto-scrolls or pastes the primary selection.
function middlePan(el) {
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 1 || e.pointerType !== "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    el.classList.add("middle-panning");
  }, true);
  // Pointer events can outnumber frames: only the latest position is written, once a frame.
  let frame = 0, latest = null;
  const apply = () => {
    frame = 0;
    if (!drag || !latest) return;
    el.scrollLeft = drag.left + drag.x - latest[0];
    el.scrollTop = drag.top + drag.y - latest[1];
  };
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    e.stopPropagation();
    latest = [e.clientX, e.clientY];
    if (!frame) frame = requestAnimationFrame(apply);
  }, true);
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (latest) { cancelAnimationFrame(frame); apply(); }
    latest = null;
    drag = null;
    el.classList.remove("middle-panning");
  };
  el.addEventListener("pointerup", end, true);
  el.addEventListener("pointercancel", end, true);
  for (const type of ["mousedown", "auxclick"]) el.addEventListener(type, (e) => { if (e.button === 1) e.preventDefault(); }, true);
}
middlePan($("viewport"));
// Rows that scroll sideways when the window is narrow (the menubar, the tools): a mouse
// wheel scrolls them too, and a faded edge shows there is more on that side.
function sideScroll(el) {
  const mark = () => {
    el.classList.toggle("more-left", el.scrollLeft > 1);
    el.classList.toggle("more-right", el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  el.addEventListener("wheel", (e) => {
    if (el.scrollWidth <= el.clientWidth || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    // An open menu scrolls itself: its wheel must not be taken for the row's.
    if (e.target.closest?.(".menu-content, [role=menu]")) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  el.addEventListener("scroll", mark, { passive: true });
  new ResizeObserver(mark).observe(el);
  mark();
}
sideScroll(document.querySelector(".bar-actions"));
sideScroll(document.querySelector("#toolbar .segmented"));
// On phones the page row holds undo, redo and the panel toggles (they move there in fitTools).
for (const row of document.querySelectorAll(".toolbar-actions")) sideScroll(row);
middlePan($("textBody"));
function pointerMove(e) {
  if (selection.move(e)) return;
  if (!gesture || gesture.id !== e.pointerId) return;
  e.preventDefault();
  if (gesture.tool === "pan") {
    gesture.speed?.add(e.clientX, e.clientY, e.timeStamp);
    // One write per frame, with the latest position.
    gesture.at = [e.clientX, e.clientY];
    if (!gesture.frame) gesture.frame = requestAnimationFrame(() => {
      const g = gesture;
      if (!g || g.tool !== "pan" || !g.at) return;
      g.frame = 0;
      $("viewport").scrollLeft = g.left + g.x - g.at[0];
      $("viewport").scrollTop = g.top + g.y - g.at[1];
    });
  } else appendPoint(e);
}
function pointerUp(e) {
  if (selection.up(e)) return;
  if (!gesture || gesture.id !== e.pointerId) return;
  if (gesture.tool === "pan") {
    const g = gesture, v = g.speed?.velocity(e.timeStamp);
    if (g.at) { cancelAnimationFrame(g.frame); $("viewport").scrollLeft = g.left + g.x - e.clientX; $("viewport").scrollTop = g.top + g.y - e.clientY; }
    cancelGesture();
    if (g.text && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 10) return typeAt(g.panel, g.text);
    if (v) glide.fling(-v.vx, -v.vy);
    return;
  }
  appendPoint(e);
  const g = gesture;
  gesture = null;
  // A tap with tape lifts or covers it here only: the others drop the line drawn meanwhile.
  const lift = point(e, g.panel), tapeTap = g.tool === "tape" && Math.hypot(lift[0] - g.start[0], lift[1] - g.start[1]) < 8;
  collab?.drawn(g, tapeTap);
  g.panel.stale = false;
  if (g.panel.el.hasPointerCapture(e.pointerId)) g.panel.el.releasePointerCapture(e.pointerId);
  if (g.tool === "grab") {
    const rect = grabRect(g);
    // A tap with Grab hides the last grab's menu, as a press always did.
    if (rect[2] < 8 || rect[3] < 8) { g.el.remove(); $("grabMenu").hidden = true; return; }
    showGrabMenu(g.panel, rect, g.el);
    return;
  }
  if (g.textMode) return commitTextHighlight(g);
  // Tape tool: a tap lifts or covers the tape under it; a drag lays new tape.
  if (g.tool === "tape") {
    const a = g.start;
    if (tapeTap) {
      g.el.remove();
      g.dot.remove();
      const tape = [...(g.panel.view?.tapes || [])].reverse().find(({ bounds: [x, y, w, h] }) => a[0] >= x && a[0] <= x + w && a[1] >= y && a[1] <= y + h);
      if (tape) toggleTape(g.panel, tape);
      else status("Drag across what you want to cover with tape.");
      return;
    }
  }
  // A smoothed stroke ends where the pen lifted, and its corners are rounded once.
  if (g.smooth && g.raw) {
    const last = g.points.at(-1);
    if (Math.hypot(g.raw[0] - last[0], g.raw[1] - last[1]) >= 0.3 && g.points.length < 8192) {
      g.points.push(g.raw);
      g.pressures.push(g.pressures.at(-1));
    }
    ({ points: g.points, pressures: g.pressures } = smoothStroke(g.points, g.pressures));
  }
  clearTimeout(g.holdTimer);
  // On lift (opt-in): a stroke that is clearly a shape becomes one.
  if (!g.snapped && g.tool === "draw" && shapeSnap() === "lift") {
    const shape = recognizeShape(g.points, { strict: true });
    if (shape) snapTo(g, shape, true);
  }
  if (g.snapped) return commitSnapped(g);
  // The Shapes tool's Graph and Table: the box dragged is where the object goes, after its editor.
  if (g.tool === "shape" && (g.kind === "graph" || g.kind === "table")) {
    g.el.remove();
    g.dot.remove();
    const end = point(e, g.panel), box = [Math.min(g.start[0], end[0]), Math.min(g.start[1], end[1]), Math.abs(end[0] - g.start[0]), Math.abs(end[1] - g.start[1])];
    insertCompound(g.panel, g.kind, box);
    return;
  }
  if (g.tool === "erase")
    action("erase", { page: g.panel.index, points: g.points, radius: eraserRadius() });
  else {
    const rgba = [1, 3, 5].map(
      (i) => parseInt(g.color.slice(i, i + 2), 16) / 255,
    );
    // The stroke stays on screen as drawn until the page's render has it (holdInk); the
    // smoothed line replaces the one drawn meanwhile.
    if (g.tool !== "shape") g.el.setAttribute("points", g.points.map((q) => q.join(",")).join(" "));
    const hold = holdInk(g.panel, g.el, g.dot);
    action("draw", {
      page: g.panel.index,
      line: {
        points: g.points,
        width: g.width,
        rgba: [...rgba, 1],
        tool: g.tool === "highlight" ? 1 : g.tool === "tape" ? 2 : 0,
        layer: g.layer,
        ...(g.box && g.tool === "highlight" ? { square: true } : {}),
        ...(g.tool === "draw" ? stylusPressure(g) : {}),
        ...(g.tool === "shape"
          ? {
              shape: {
                ...fillFor($("shape").value, g.color),
                kind: $("shape").value,
                start: g.start,
                end: point(e, g.panel),
              },
            }
          : {}),
      },
    }, hold);
  }
}
// A drag that ends: the bands become the highlighter's own lines, one undo step for them all.
// A click on a word highlights that word; a click away from any text does nothing.
async function commitTextHighlight(g) {
  const t = g.textMode;
  g.el.remove();
  g.dot.remove();
  // A click (no drag) counts only on or right beside a word, not anywhere on the page.
  const click = !t.end || Math.hypot(t.end[0] - g.start[0], t.end[1] - g.start[1]) < 4, word = t.words[t.anchor];
  if (!t.bands.length || (click && (!word || distanceTo(word, g.start) > word.h * 1.2))) { t.preview.remove(); return status("Drag across the text to highlight it, or click a word."); }
  const rgba = [1, 3, 5].map((i) => parseInt(g.color.slice(i, i + 2), 16) / 255);
  const hold = holdInk(g.panel, t.preview);
  for (const [i, band] of t.bands.entries()) {
    // The last line's render clears the preview; the lines before it are in that render too.
    await action("draw", { page: g.panel.index, line: bandLine(band, rgba, g.layer, i > 0) }, i === t.bands.length - 1 ? hold : null);
  }
  if (!t.bands.length) letGo(hold);
}
// Switches tool. The tool bar's buttons and the quick menu both come here; only a press in
// the tool bar opens (or toggles) the tool's settings there, since the menu shows its own.
function selectTool(name, { fromMenu = false } = {}) {
  if (fromMenu && tool === name) return;
  cancelGesture();
  // Pressing the selected tool again shows or hides its settings.
  if (tool === name) {
    optionsOpen = chromeState.compact || !optionsOpen;
    setCompact(false);
    return;
  }
  const prevGrab = grabbed;
  tool = name;
  endResizeDrag();
  // From the menu the bar's settings stay closed: the menu shows them. Select's panel
  // belongs to what is selected, so it still opens as usual.
  optionsOpen = fromMenu && tool !== "select" ? false : toolSettingsAuto;
  if (tool !== "select") selection.clear();
  if (tool !== "grab") {
    // A grabbed region becomes the selection, as its Select button does.
    if (tool === "select" && prevGrab) {
      selectGrab(prevGrab);
    } else {
      clearGrab();
    }
  }
  // The menu leaves the tool bar as it was (collapsed stays collapsed).
  if (!fromMenu) {
    chromeState.reset($("viewport").scrollTop);
    setCompact(false);
  }
  for (const p of panels) p.el.dataset.tool = tool;
  for (const b of document.querySelectorAll("button[data-tool]"))
    b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  for (const p of panels) shapeHandles(p);
  // Each tool comes back with the colour and width it was last used with.
  restoreToolPrefs();
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
}
for (const button of document.querySelectorAll("[data-tool]"))
  button.onclick = () => selectTool(button.dataset.tool);
function highlightHint() {
  return { straight: "Straight highlight: drag between the endpoints.", free: "Freehand highlight: draw on the page.", box: "Rectangle highlight: drag a box over what to highlight.", text: "Text highlight: drag across the text of a PDF page; the words under the drag are highlighted." }[$("highlightMode").value];
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
  highlightMode: { straight: '<path d="M4 12h16"/>', free: '<path d="M3 14c3-6 5 4 8-2s5 5 10-3"/>', box: '<rect x="4" y="7" width="16" height="10" rx="0.5" fill="currentColor" fill-opacity="0.35"/>', text: '<rect x="3" y="9.5" width="18" height="5" rx="0.5" fill="currentColor" fill-opacity="0.35" stroke="none"/><path d="M4 7h10M4 12h16M4 17h12"/>' },
  // A stroke that thickens where pressed harder, or one even line.
  pressure: { on: '<path d="M3 15c4-1 6-6 9-6s5 5 9 6" stroke-width="1.2"/><path d="M8 12.5c2-2 3-3.4 4-3.4" stroke-width="3.2"/>', off: '<path d="M3 15c4-1 6-6 9-6s5 5 9 6" stroke-width="2.4"/>' },
  tapeMode: { band: '<rect x="3" y="9" width="18" height="6" rx="0.5"/>', box: '<rect x="5" y="5" width="14" height="14" rx="0.5"/>' },
  // A wobbly loop that becomes a clean box: when the pen is held, on every lift, or never.
  shapeSnap: { hold: '<path d="M5 8c3-3 10-3 13 0" stroke-dasharray="2 2"/><rect x="5" y="11" width="14" height="8" rx="0.5"/><circle cx="19" cy="6" r="2.2" fill="currentColor"/>', lift: '<path d="M4 9c2-4 6 1 8-3s5 2 8-1" stroke-dasharray="2 2"/><rect x="5" y="12" width="14" height="7" rx="0.5"/>', off: '<path d="M4 14c3-6 5 4 8-2s5 5 9-3"/>' },
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
// Whether a stylus's pressure changes the pen's width; remembered on this device.
const pressureOn = () => $("pressure").value !== "off";
try { if (localStorage.getItem("notecomplete-pressure") === "off") $("pressure").value = "off"; } catch { /* Optional. */ }
$("pressure").addEventListener("change", () => { try { localStorage.setItem("notecomplete-pressure", $("pressure").value); } catch { /* Optional. */ } });
try { const saved = localStorage.getItem("notecomplete-eraser-size"); if (saved && $("eraserSize").querySelector(`option[value="${saved}"]`)) $("eraserSize").value = saved; } catch { /* Optional. */ }
$("eraserSize").addEventListener("change", () => { try { localStorage.setItem("notecomplete-eraser-size", $("eraserSize").value); } catch { /* Optional. */ } });
buildChoices();
$("color").addEventListener("input", syncChoices);
// Each drawing tool keeps its own colour and width (remembered on this device), and the
// highlighter, tape and shape kinds keep theirs.
const TOOL_DEFAULTS = {
  draw: { color: "#246bce", width: "4" },
  highlight: { color: "#ffdf38", width: "16" },
  tape: { color: "#e3c6e6", width: "40" },
  shape: { color: "#246bce", width: "2" },
};
let toolPrefs = {};
try { toolPrefs = JSON.parse(localStorage.getItem("notecomplete-tool-prefs") || "{}") || {}; } catch { /* Optional. */ }
function restoreToolPrefs() {
  const pref = { ...TOOL_DEFAULTS[tool], ...toolPrefs[tool] };
  if (pref.color) $("color").value = pref.color;
  if (pref.width) setWidthValue(pref.width);
  buildWidthRow();
}
// Each tool's widths (in px): the presets shown in the tool bar and the quick menu. Hold
// one (or right-click it) to set its value; any width from 0.5 to 100 px. Remembered.
const WIDTH_DEFAULTS = {
  // The pen: 4 px is the width that reads right next to Noteful's, so it is the second one, with
  // a slightly thicker finest and a gentle ramp above it.
  draw: [2, 4, 7, 11],
  highlight: [8, 16, 24, 40],
  tape: [20, 40, 64],
  shape: [1, 2, 4, 8],
};
const WIDTH_LADDER = [1, 2, 4, 8, 16, 24, 40, 64];
let widthPresets = { ...WIDTH_DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem("notecomplete-widths") || "{}");
  // The pen's earlier untouched presets (1, 2, 4, 8) give way to the new ones; edited ones stay.
  if (JSON.stringify(saved.draw) === "[1,2,4,8]") delete saved.draw;
  widthPresets = { ...WIDTH_DEFAULTS, ...saved };
} catch { /* Optional. */ }
const widthLabel = (v) => `${Number(v)} px`;
// The width select holds every value in use; one typed in is added to it.
function setWidthValue(value) {
  const v = String(Number(value));
  if (!$("width").querySelector(`option[value="${v}"]`)) $("width").append(new Option(widthLabel(v), v));
  $("width").value = v;
}
function lineIcon(value) {
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path d="M3 12h18" stroke-width="${Math.min(14, Math.max(0.8, Number(value) / 3))}"/>`;
  return svg;
}
// The tool bar's width row: this tool's presets, each held (or right-clicked) to change it.
function buildWidthRow() {
  const row = document.querySelector('.choice-row[data-for="width"]');
  if (!row) return;
  const presets = widthPresets[tool], values = presets || WIDTH_LADDER;
  row.replaceChildren(...values.map((value, index) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.value = String(value);
    b.setAttribute("role", "radio");
    b.title = presets ? `${widthLabel(value)} (hold or right-click to change it)` : widthLabel(value);
    b.setAttribute("aria-label", widthLabel(value));
    b.append(lineIcon(value));
    let held = false;
    b.onclick = () => { if (held) { held = false; return; } setWidthValue(value); $("width").dispatchEvent(new Event("change")); syncChoices(); };
    if (presets) {
      b.oncontextmenu = (e) => { e.preventDefault(); editWidth(tool, index); };
      b.addEventListener("pointerdown", (down) => {
        if (down.button !== 0) return;
        const timer = setTimeout(() => { held = true; editWidth(tool, index); }, 450);
        const stop = () => { clearTimeout(timer); removeEventListener("pointerup", stop, true); removeEventListener("pointercancel", stop, true); };
        addEventListener("pointerup", stop, true);
        addEventListener("pointercancel", stop, true);
      });
    }
    return b;
  }));
  syncChoices();
}
// The width editor: a number and a slider in px, with a preview of the line.
let widthEditing = null;
function editWidth(name, index) {
  widthEditing = { name, index };
  const value = widthPresets[name][index];
  $("widthTitle").textContent = `${({ draw: "Pen", highlight: "Highlighter", tape: "Tape", shape: "Shapes" })[name] || "Tool"} width`;
  $("widthValue").value = $("widthRange").value = value;
  previewWidth();
  $("widthDialog").showModal();
  $("widthValue").select();
}
function previewWidth() {
  const v = Math.min(100, Math.max(0.5, Number($("widthValue").value) || 1));
  const path = $("widthPreview").querySelector("path");
  path.setAttribute("stroke-width", Math.min(56, v));
  path.style.color = $("color").value;
}
$("widthRange").oninput = () => { $("widthValue").value = $("widthRange").value; previewWidth(); };
$("widthValue").oninput = () => { $("widthRange").value = $("widthValue").value; previewWidth(); };
$("widthValue").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("widthSave").click(); } };
$("widthCancel").onclick = () => $("widthDialog").close();
$("widthReset").onclick = () => {
  const { name } = widthEditing || {};
  if (!name) return;
  widthPresets[name] = [...WIDTH_DEFAULTS[name]];
  saveWidths();
  $("widthDialog").close();
};
$("widthSave").onclick = () => {
  const { name, index } = widthEditing || {};
  const v = Math.round(Math.min(100, Math.max(0.5, Number($("widthValue").value) || 1)) * 2) / 2;
  if (!name) return;
  widthPresets[name] = widthPresets[name].map((w, i) => (i === index ? v : w));
  saveWidths();
  if (tool === name) { setWidthValue(v); $("width").dispatchEvent(new Event("change")); }
  $("widthDialog").close();
};
function saveWidths() {
  try { localStorage.setItem("notecomplete-widths", JSON.stringify(widthPresets)); } catch { /* Optional. */ }
  buildWidthRow();
  try { quick.redraw(); } catch { /* The menu is not made yet. */ }
}
buildWidthRow();
function saveToolPrefs() {
  if (!TOOL_DEFAULTS[tool]) return;
  toolPrefs[tool] = { color: $("color").value, width: $("width").value };
  try { localStorage.setItem("notecomplete-tool-prefs", JSON.stringify(toolPrefs)); } catch { /* Optional. */ }
}
for (const id of ["color", "width"]) $(id).addEventListener("change", saveToolPrefs);
$("color").addEventListener("input", saveToolPrefs);
for (const id of ["highlightMode", "tapeMode", "shape", "shapeSnap"]) {
  try { const saved = localStorage.getItem(`notecomplete-${id}`); if (saved && $(id).querySelector(`option[value="${saved}"]`)) $(id).value = saved; } catch { /* Optional. */ }
  $(id).addEventListener("change", () => { try { localStorage.setItem(`notecomplete-${id}`, $(id).value); } catch { /* Optional. */ } });
}
syncShapeSnapMenu();
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
// Fill of closed shapes: none, a tint of the pen colour, or solid. Remembered; F cycles it.
let shapeFill = "none";
try { shapeFill = ["none", "tint", "solid"].includes(localStorage.getItem("notecomplete-shape-fill")) ? localStorage.getItem("notecomplete-shape-fill") : "none"; } catch { /* Optional. */ }
function setShapeFill(value) {
  shapeFill = value;
  try { localStorage.setItem("notecomplete-shape-fill", value); } catch { /* Optional. */ }
  for (const b of document.querySelectorAll("#shapeFill [data-fill]")) b.setAttribute("aria-checked", String(b.dataset.fill === value));
}
for (const b of document.querySelectorAll("#shapeFill [data-fill]")) b.onclick = () => setShapeFill(b.dataset.fill);
setShapeFill(shapeFill);
// The fill for a new shape of `kind` in pen colour `hex`, or nothing.
function fillFor(kind, hex) {
  if (shapeFill === "none" || !CLOSED_SHAPES.has(kind)) return {};
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return { fill: [...rgb, shapeFill === "tint" ? 0.25 : 1] };
}
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
  // Shift + wheel: fast scrolling down the pages (four times a normal step).
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && doc) {
    const delta = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? $("viewport").clientHeight : 1);
    if (!delta) return;
    e.preventDefault();
    $("viewport").scrollTop += delta * 4;
    return;
  }
  if (!e.ctrlKey || !doc) return;
  e.preventDefault();
  // Trackpads send small deltas; a wheel notch is ~100 px, so each event is capped to about ×1.2.
  const delta = Math.max(-20, Math.min(20, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
  pinchBy(e.clientX, e.clientY, Math.exp(-delta * 0.009));
}, { passive: false });
// Scales the pages by `step` around a screen point; also used by two-finger pinch (collab.js).
function pinchBy(clientX, clientY, step) {
  const e = { clientX, clientY };
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
}
// Fingers on the pages: two move and pinch-zoom, a two-finger tap undoes, three redo.
// Scrolls that keep going after the fingers lift (momentum.js); a touch, wheel or key stops them.
const glide = momentum({
  apply(dx, dy) {
    const v = $("viewport"), left = v.scrollLeft, top = v.scrollTop;
    v.scrollLeft += dx;
    v.scrollTop += dy;
    return v.scrollLeft !== left || v.scrollTop !== top;
  },
});
for (const type of ["wheel", "pointerdown"]) $("viewport").addEventListener(type, () => glide.stop(), { passive: true, capture: true });
addEventListener("keydown", () => glide.stop(), true);
// An Apple Pencil on the pages draws: iPadOS would otherwise take it for Scribble (writing
// into a text box), hold each stroke while it decides, and cancel it. Stopping its touch
// keeps the pointer events coming; nothing else uses a stylus's touches.
const PENCIL_DRAWS = new Set(["draw", "highlight", "erase", "shape", "tape", "grab"]);
$("viewport").addEventListener("touchstart", (e) => {
  if (!doc || ![...e.changedTouches].some((t) => t.touchType === "stylus")) return;
  if (!PENCIL_DRAWS.has(tool) && !document.body.classList.contains("tablet-mode")) return;
  if (e.target.closest?.(".text-editor, .text-format, .ink-link")) return;
  e.preventDefault();
  const typing = document.activeElement;
  if (typing && typing !== document.body && typing.matches?.("input, textarea, select, [contenteditable]") && !typing.closest(".text-editor")) typing.blur();
}, { passive: false, capture: true });
$("viewport").addEventListener("touchmove", (e) => {
  if (doc && gesture && gesture.tool !== "pan" && [...e.changedTouches].some((t) => t.touchType === "stylus")) e.preventDefault();
}, { passive: false, capture: true });
touchGestures({
  fling: (vx, vy) => glide.fling(vx, vy),
  stop: () => glide.stop(),
  viewport: $("viewport"),
  pinchBy: (x, y, step) => pinchBy(x, y, step),
  cancelGesture: () => cancelGesture(),
  undo: () => { if (!$("undo").disabled) $("undo").click(); },
  redo: () => { if (!$("redo").disabled) $("redo").click(); },
  menu: (x, y) => quick.open(x, y),
  // Not while a stylus was just writing: a palm resting beside it is not a gesture.
  penBusy: () => performance.now() - lastPenWrote < 1500,
  enabled: () => !!doc,
});
// Quick menu (quick-menu.js): tools on a ring around the pen, colours and actions around
// them. Shift + S (hold, point, let go; or tap and click), Shift + pen, a pen's side
// button, or two fingers held still on the page open it.
// Grab is last, so the other tools keep their number keys.
// Lock (as in the tool bar) comes after it, hidden at first: ten tools crowd the ring.
const QUICK_TOOLS = [["draw", "Pen"], ["highlight", "Highlighter"], ["erase", "Eraser"], ["select", "Select"], ["shape", "Shapes"], ["text", "Text"], ["tape", "Tape"], ["pan", "Pan"], ["grab", "Grab"], ["lock", "Lock in place"]];
const chooseTool = (name) => selectTool(name, { fromMenu: true });
// The tools' order on the ring (held and dragged in the menu), remembered on this device.
// Tools missing from a saved order (added since) go at the end.
let quickOrder = QUICK_TOOLS.map(([name]) => name);
try { const saved = JSON.parse(localStorage.getItem("notecomplete-quick-order") || "null"); if (Array.isArray(saved)) quickOrder = [...saved.filter((k) => quickOrder.includes(k)), ...quickOrder.filter((k) => !saved.includes(k))]; } catch { /* Optional. */ }
// Remembered on this device: JSON in localStorage, defaults when missing or unreadable.
const remembered = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional. */ } };
// Each tool's colours in the quick menu: editable (hold a colour, or right-click it) and
// in the order the user dragged them.
const DEFAULT_PALETTES = {
  draw: SWATCHES.slice(0, 5),
  highlight: ["#ffdf38", "#ff9f1c", "#2a9d63", "#246bce", "#e3c6e6"],
  shape: SWATCHES.slice(0, 5),
  tape: ["#e3c6e6", "#ffdf38", "#1f2328"],
  text: SWATCHES.slice(0, 5),
};
const palettes = { ...DEFAULT_PALETTES, ...remembered("notecomplete-palettes", {}) };
// The order of each tool's other settings (sizes, modes, undo/redo), as dragged.
const sectionOrder = remembered("notecomplete-quick-sections", {});
const ordered = (name, section, entries) => {
  const order = sectionOrder[name]?.[section];
  if (!order) return entries;
  const rank = (e) => { const i = order.indexOf(e.key); return i < 0 ? order.length : i; };
  return [...entries].sort((a, b) => rank(a) - rank(b));
};
function setColor(value) {
  $("color").value = value;
  $("color").dispatchEvent(new Event("input", { bubbles: true }));
  $("color").dispatchEvent(new Event("change", { bubbles: true }));
}
// The system's colour picker, starting at `value`; `chosen(colour)` as it changes.
function pickColor(value, chosen) {
  const input = Object.assign(document.createElement("input"), { type: "color", value });
  input.style.cssText = "position:fixed;opacity:0;pointer-events:none;left:50%;top:50%";
  document.body.append(input);
  input.addEventListener("input", () => chosen(input.value));
  input.addEventListener("change", () => { chosen(input.value); input.remove(); });
  input.addEventListener("blur", () => setTimeout(() => input.remove(), 1000));
  input.click();
}
// A colour of the palette, chosen again with the system's colour picker.
function editPaletteColor(name, index) {
  pickColor(palettes[name][index], (value) => {
    palettes[name] = palettes[name].map((c, i) => (i === index ? value : c));
    remember("notecomplete-palettes", palettes);
    setColor(value);
    quick.redraw();
  });
}
// Any colour, as the tool bar's custom colour: the palette stays as it is.
const customColorEntry = (name) => ({
  key: "custom",
  label: "Any colour…",
  swatch: "conic-gradient(#d13b2f, #ffdf38, #2a9d63, #246bce, #8a4fd0, #d13b2f)",
  active: () => !palettes[name].some((c) => c.toLowerCase() === $("color").value.toLowerCase()),
  run: () => pickColor($("color").value, (value) => { setColor(value); quick.redraw(); }),
  stay: () => true,
});
const paletteEntries = (name) => [...palettes[name].map((value, i) => ({
  key: String(i),
  label: `Colour ${value} (hold or right-click to change it)`,
  swatch: value,
  active: () => $("color").value.toLowerCase() === value.toLowerCase(),
  run: () => setColor(value),
  edit: () => editPaletteColor(name, i),
  stay: () => true,
})), customColorEntry(name)];
// A tool's other settings, from its own option rows, so the menu and the tool bar agree.
const fromRow = (id, values) => [...document.querySelectorAll(`.choice-row[data-for="${id}"] button`)]
  .filter((b) => !values || values.includes(b.dataset.value))
  .map((b) => ({
    key: b.dataset.value,
    label: `${b.title}`,
    icon: b.querySelector("svg"),
    active: () => $(id).value.toLowerCase() === b.dataset.value.toLowerCase(),
    run: () => b.click(),
    stay: () => true,
  }));
const fromButtons = (selector, attr) => [...document.querySelectorAll(selector)].map((b) => ({
  key: b.dataset[attr], label: b.title, icon: b.querySelector("svg"), active: () => b.getAttribute("aria-checked") === "true", run: () => b.click(), stay: () => true,
}));
// A tool's width presets in the quick menu: each held (or right-clicked) to change it.
const widthEntries = (name) => widthPresets[name].map((value, i) => ({
  key: `w${i}`,
  label: `${widthLabel(value)} (hold or right-click to change it)`,
  icon: lineIcon(value),
  active: () => Number($("width").value) === Number(value),
  run: () => { setWidthValue(value); $("width").dispatchEvent(new Event("change")); syncChoices(); },
  edit: () => editWidth(name, i),
  stay: () => true,
}));
// Shapes from the pen (the tool bar's three choices) as one item: tapped, the next one.
const SNAP_NEXT = { hold: "lift", lift: "off", off: "hold" };
const SNAP_SAID = { hold: "Shapes from the pen: hold the pen still at the end of a stroke.", lift: "Shapes from the pen: large, clean shapes become shapes as the pen lifts; holding still works too.", off: "Shapes from the pen off: strokes stay as drawn." };
const snapEntry = {
  key: "shapeSnap",
  get label() { return `${document.querySelector(`.choice-row[data-for="shapeSnap"] button[data-value="${shapeSnap()}"]`)?.title || "Shapes from the pen"} (tap for the next)`; },
  get icon() { return document.querySelector(`.choice-row[data-for="shapeSnap"] button[data-value="${shapeSnap()}"] svg`) || icon("shape"); },
  active: () => shapeSnap() !== "off",
  run: () => { $("shapeSnap").value = SNAP_NEXT[shapeSnap()] || "hold"; $("shapeSnap").dispatchEvent(new Event("change")); syncChoices(); status(SNAP_SAID[shapeSnap()]); },
  stay: () => true,
};
const pressureEntry = { key: "pressure", label: "Pen pressure", icon: icon("pressure"), active: () => pressureOn(), stay: () => true, run: () => { $("pressure").value = pressureOn() ? "off" : "on"; $("pressure").dispatchEvent(new Event("change")); syncChoices(); status(pressureOn() ? "Pen pressure on." : "Pen pressure off: even width."); } };
const smoothEntry = { key: "smoothing", label: "Pen smoothing", icon: icon("smooth"), active: () => smoothingOn, stay: () => true, run: () => $("penSmoothToggle").click() };
const hoverEntry = { key: "hoverPreview", label: "Pen hover preview", icon: icon("draw"), active: () => penHoverOn, stay: () => true, run: () => $("penHoverToggle").click() };
// Every tool's settings in the same places: colours on top, sizes along the bottom (small
// to large, left to right), modes on the left, undo and redo on the right.
const QUICK_SETTINGS = {
  draw: () => ({ top: paletteEntries("draw"), bottom: widthEntries("draw"), left: [pressureEntry, snapEntry, smoothEntry, hoverEntry] }),
  highlight: () => ({ top: paletteEntries("highlight"), bottom: widthEntries("highlight"), left: fromRow("highlightMode") }),
  erase: () => ({ bottom: fromRow("eraserSize") }),
  // The shapes' widths beside undo and redo, as the bottom holds the kinds of shape.
  shape: () => ({ top: paletteEntries("shape"), bottom: fromButtons("#shapePicker [data-shape]", "shape"), left: fromButtons("#shapeFill [data-fill]", "fill"), right: widthEntries("shape") }),
  tape: () => ({ top: paletteEntries("tape"), bottom: widthEntries("tape"), left: fromRow("tapeMode") }),
  text: () => ({ top: paletteEntries("text") }),
};
// Items hidden from the quick menu (held, or right-clicked: Hide from this menu), per ring:
// 'inner' for the tools, '<tool>:<section>' for a tool's settings. Graph and Table start
// hidden among the shapes, so the Shapes ring stays small; they can be shown again there.
// Lock starts hidden among the tools, and the thinnest and thickest shape widths beside
// undo and redo; a place the user has changed keeps what they chose.
const QUICK_HIDDEN_DEFAULTS = { inner: ["lock"], "shape:right": ["w0", "w3"] };
let quickHidden = { ...QUICK_HIDDEN_DEFAULTS, ...remembered("notecomplete-quick-hidden", {}) };
// Graph and Table are behind the Shapes ring's + now, no longer hidden by default.
if (quickHidden["shape:bottom"]) quickHidden["shape:bottom"] = quickHidden["shape:bottom"].filter((k) => k !== "graph" && k !== "table");
// A ring section shows a few items and keeps the rest behind a tinted +, which expands it in
// place (and − folds it back): the rings stay small, and every choice is still there. The
// chosen item always shows. Per section, by "<tool>:<section>".
// The same rule in every ring: colours are the first three, Any colour and the +; the shape
// kinds start with the three basic ones; the pen's modes with pressure and shapes from the pen.
// The + is always last, and what unfolds comes after the items already shown, in the same
// places, so nothing jumps when it opens. Measured with layoutSections: the pen's and tape's
// rings stay at the base radius (94), the highlighter's and shapes' go from 112 to 101.
const COLOUR_BASE = ["0", "1", "2", "custom"];
const QUICK_BASE = {
  "draw:top": COLOUR_BASE, "highlight:top": COLOUR_BASE, "shape:top": COLOUR_BASE, "tape:top": COLOUR_BASE, "text:top": COLOUR_BASE,
  "shape:bottom": ["rectangle", "ellipse", "triangle"], "draw:left": ["pressure", "shapeSnap"],
};
const quickOpen = {};
function withMore(section, entries) {
  const k = `${tool}:${section}`, base = QUICK_BASE[k];
  if (!base || entries.length <= base.length) return entries;
  const open = !!quickOpen[k];
  // The basic items first, in their own order, then the rest in theirs (unless the user dragged
  // this section into an order of their own).
  const first = sectionOrder[tool]?.[section] || section === "top" ? entries : [...base.map((key) => entries.find((e) => String(e.key) === key)).filter(Boolean), ...entries.filter((e) => !base.includes(String(e.key)))];
  const list = open ? first : first.filter((e) => base.includes(String(e.key)) || e.active?.());
  if (list.length === entries.length && !open) return first;
  return [...list, { key: "__more", fixed: true, more: true, label: open ? "Fewer choices" : `More choices (${entries.length - list.length})`, icon: icon(open ? "minimize" : "plus"), run: () => { quickOpen[k] = !open; }, stay: () => true }];
}
const hiddenKey = (section) => (section === "inner" ? "inner" : `${tool}:${section}`);
const hiddenIn = (section) => new Set((quickHidden[hiddenKey(section)] || []).map(String));
const quickTools = () => quickOrder.map((name) => ({ key: name, label: QUICK_TOOLS.find(([n]) => n === name)[1], icon: icon(name), active: () => tool === name, run: () => chooseTool(name), stay: () => !!QUICK_SETTINGS[name] }));
function quickSettings() {
  const settings = QUICK_SETTINGS[tool]?.();
  if (!settings) return {};
  const out = {};
  for (const [section, entries] of Object.entries(settings)) out[section] = section === "top" ? entries : ordered(tool, section, entries);
  out.right = ordered(tool, "right", [
    ...(settings.right || []),
    { key: "undo", label: "Undo", icon: icon("undo"), run: () => $("undo").disabled || $("undo").click(), stay: () => true },
    { key: "redo", label: "Redo", icon: icon("redo"), run: () => $("redo").disabled || $("redo").click(), stay: () => true },
  ]);
  return out;
}
const shown = (section, entries) => { const hidden = hiddenIn(section); return entries.filter((e) => !hidden.has(String(e.key))); };
const quick = quickMenu({
  // Holding the × shows or hides the tool bar (View → Tool bar, Shift + T).
  onCentreHold: () => setToolsHidden(!document.body.classList.contains("tools-hidden")),
  // Tapping a tool chooses it and shows its settings around it; one without settings closes.
  inner: () => shown("inner", quickTools()),
  // The outer ring only for a tool with settings (with undo and redo beside them); Pan,
  // Select and the like get the small menu.
  outer: () => Object.fromEntries(Object.entries(quickSettings()).map(([section, entries]) => [section, withMore(section, shown(section, entries))])),
  // Held (or right-clicked), any item can leave its ring or section, and come back from there.
  items: {
    hide(section, key) {
      const k = hiddenKey(section);
      quickHidden = { ...quickHidden, [k]: [...new Set([...(quickHidden[k] || []).map(String), String(key)])] };
      remember("notecomplete-quick-hidden", quickHidden);
      status("Hidden from the quick menu. Hold another item in the same place to show it again.");
    },
    show(section, key) {
      const k = hiddenKey(section);
      quickHidden = { ...quickHidden, [k]: (quickHidden[k] || []).map(String).filter((h) => h !== String(key)) };
      remember("notecomplete-quick-hidden", quickHidden);
    },
    hidden(section) {
      const all = section === "inner" ? quickTools() : quickSettings()[section] || [], hidden = hiddenIn(section);
      return all.filter((e) => hidden.has(String(e.key)));
    },
  },
  // A tool, a colour or a setting dragged to another place: remembered. The items hidden
  // from that place keep theirs, after the shown ones.
  onReorder: (section, visibleOrder) => {
    const order = [...visibleOrder, ...[...hiddenIn(section)].filter((k) => !visibleOrder.map(String).includes(k))];
    if (section === "inner") {
      quickOrder = order;
      remember("notecomplete-quick-order", order);
    } else if (section === "bottom" && widthPresets[tool] && order.every((k) => k.startsWith("w"))) {
      widthPresets[tool] = order.map((k) => widthPresets[tool][Number(k.slice(1))]);
      saveWidths();
    } else if (section === "top" && palettes[tool]) {
      // Colours folded behind the + are not in the dragged order: they keep their places after it.
      const shownColours = order.filter((k) => /^\d+$/.test(k)).map(Number);
      const folded = palettes[tool].map((_, i) => i).filter((i) => !shownColours.includes(i));
      palettes[tool] = [...shownColours, ...folded].map((i) => palettes[tool][i]).filter((c) => c != null);
      remember("notecomplete-palettes", palettes);
    } else {
      (sectionOrder[tool] ||= {})[section] = order;
      remember("notecomplete-quick-sections", sectionOrder);
    }
    status("Quick menu order saved.");
  },
  onOpen: () => cancelGesture(),
  // The pen's button counts as released once the menu closes, so the next press opens it
  // again even if its release was never reported (it happened over the menu, or not at all).
  onClose: () => { if (!penClosing) penBtn.reset(); },
});
// Where the pointer last was over the pages: Shift + S opens the menu there.
let lastPointer = null, lastPointerType = "mouse";
// A pen's side button (pen-button.js, docs/S-PEN-BUTTON.md): on Android the S Pen button
// only shows while the pen hovers (pointermove buttons 0 → nonzero) or as a contextmenu
// with no pointer type when the user holds it and taps; desktop pens report button 2 or 5.
// The "Pen button" dialog can calibrate it on this device.
let penProfile = loadPenProfile();
const penBtn = penButtonDetector(() => penProfile);
let penHover = null, penMenuAt = 0, penHold = null;
const onPages = (e) => doc && $("viewport").contains(e.target);
const fields = (e) => ({ type: e.type, pointerType: e.pointerType, button: e.button, buttons: e.buttons, pressure: e.pressure, time: e.timeStamp });
// `toggle`: a press of the button while the pen hovers (or its key) also closes an open
// menu, the way it opened it; a press right after opening is the same press seen twice.
function penMenu(e, toggle = false) {
  const last = penMenuAt;
  penMenuAt = Date.now();
  clearTimeout(penHold?.timer);
  penHold = null;
  if (!quick.isOpen) quick.open(e.clientX, e.clientY);
  else if (toggle && penMenuAt - last > 300) {
    // The button is still down: the detector keeps it as pressed, so the next move is not a
    // new press that opens the menu again (closing otherwise resets it).
    penClosing = true;
    quick.close();
    penClosing = false;
  }
}
let penClosing = false;
document.addEventListener("pointermove", (e) => {
  lastPointer = [e.clientX, e.clientY];
  if (e.pointerType !== "pen") return;
  if (!e.buttons && onPages(e)) {
    // A pen hovering over the pages: Shift opens the menu where it points, and the pages
    // stop selecting text (the button's hold-and-tap would otherwise pick a word).
    penHover = { x: e.clientX, y: e.clientY, at: Date.now() };
    document.body.classList.add("touch-pointer");
  }
  if (penHold && Math.hypot(e.clientX - penHold.x, e.clientY - penHold.y) > 4) { clearTimeout(penHold.timer); penHold = null; }
  if (penBtn.pointer(fields(e)) === "menu" && (onPages(e) || quick.isOpen)) penMenu(e, true);
}, { passive: true, capture: true });
document.addEventListener("pointerdown", (e) => {
  lastPointerType = e.pointerType;
  if (e.pointerType !== "pen") return;
  const button = penBtn.pointer(fields(e)) === "menu";
  if (!onPages(e)) return;
  // The pen's button as it touches the page (never the right-click that removes what is
  // under it), or Shift + pen for pens without a button.
  if (button || e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    penMenu(e);
    return;
  }
  // Opt-in: the pen held still on the page opens the menu.
  if (penProfile?.longPress) {
    const at = { x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY };
    penHold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { penHold = null; cancelGesture(); penMenu(at); }, 550) };
  }
}, true);
for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, (e) => {
  if (e.pointerType !== "pen") return;
  penBtn.pointer(fields(e));
  if (penHold) { clearTimeout(penHold.timer); penHold = null; }
}, true);
// The pen coming into hover range (with the button held, in Brave and Chrome on Android the
// only way the press shows) and leaving it (the next entry counts again).
document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "pen" || e.relatedTarget) return;
  if (penBtn.pointer(fields(e)) === "menu" && (onPages(e) || quick.isOpen)) penMenu(e, true);
}, true);
document.addEventListener("pointerout", (e) => {
  if (e.pointerType === "pen" && !e.relatedTarget) penBtn.pointer({ ...fields(e), type: "pointerleave" });
}, true);
const android = /Android/i.test(navigator.userAgent);
document.addEventListener("contextmenu", (e) => {
  if (!onPages(e)) return;
  const type = e.pointerType || "";
  const button = penBtn.contextmenu({ pointerType: type, time: e.timeStamp, android, last: lastPointerType }) === "menu";
  const mouse = type === "mouse" || (!type && lastPointerType === "mouse");
  if (button || (mouse && e.shiftKey) || Date.now() - penMenuAt <= 800) {
    // The pen's button (or Shift + right-click): the menu. Our menu just opened from the
    // pen: the browser's own menu must not follow it.
    e.preventDefault();
    e.stopPropagation();
    // The button held and a tap: Chromium also selected a word there.
    window.getSelection()?.removeAllRanges();
    if (button || mouse) penMenu(e);
    return;
  }
  // Only a mouse right-click removes what is under it; a long press of a finger or a pen
  // (Samsung's button + touch included) never does.
  if (!mouse) { e.preventDefault(); e.stopPropagation(); }
}, true);
document.addEventListener("keydown", (e) => {
  if (penBtn.key(e) !== "menu" || !doc) return;
  e.preventDefault();
  if (quick.isOpen) { penMenu({}, true); return; }
  const at = penHover && Date.now() - penHover.at < 1500 ? penHover : { x: innerWidth / 2, y: innerHeight / 2 };
  penMenu({ clientX: at.x, clientY: at.y });
}, true);
let quickKeyAt = 0;
const quickKeyAllowed = (e) => doc && !$("editor").hidden && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.matches?.("input,select,textarea,[contenteditable=true],[contenteditable='']") && !document.querySelector("dialog[open]");
document.addEventListener("keydown", (e) => {
  if (quick.isOpen && quick.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  // Shift pressed while a pen hovers over the pages: the menu at the pen.
  if (e.key === "Shift" && !e.repeat && penHover && Date.now() - penHover.at < 1500 && !quick.isOpen && quickKeyAllowed(e)) {
    quick.open(penHover.x, penHover.y);
    quickKeyAt = Date.now();
    return;
  }
  // Shift + S (S being Select): the menu where the pointer is.
  if (e.key.toLowerCase() !== "s" || !e.shiftKey || !quickKeyAllowed(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  // Just opened by the Shift of this same Shift + S (a pen hovering): it stays open.
  if (quick.isOpen) { if (Date.now() - quickKeyAt > 400) quick.close(); return; }
  quickKeyAt = Date.now();
  const box = $("viewport").getBoundingClientRect();
  const [x, y] = lastPointer && lastPointer[0] >= box.left && lastPointer[0] <= box.right && lastPointer[1] >= box.top && lastPointer[1] <= box.bottom ? lastPointer : [box.left + box.width / 2, box.top + box.height / 2];
  quick.open(x, y);
}, true);
document.addEventListener("keyup", (e) => {
  // Held, then let go over an item: that item. A quick tap leaves the menu open to click.
  if (e.key.toLowerCase() === "s" && quick.isOpen && Date.now() - quickKeyAt > 150) quick.release();
}, true);
$("undo").onclick = () => {
  cancelGesture();
  action("undo");
};
$("redo").onclick = () => {
  cancelGesture();
  action("redo");
};
// Auto-save (autosave.js): every minute, while the note has changed, a lossless copy goes
// into automatic slots on this device, never over the saved file. File lists this note's
// slots; opening a note with a newer automatic save than the last manual one asks which to
// keep. In a sharing session the host's switch decides for everyone (collab.js).
const autosaves = autosaveStore();
let autosavePref = true, sharedAutosave = null, recoveringKey = null, autosavedRevision = -1, openedRevision = 0, autosaving = false;
try { autosavePref = localStorage.getItem("notecomplete-autosave") !== "0"; } catch { /* Optional. */ }
const following = () => !!collab && collab.role !== "host";
const autosaveOn = () => (following() ? !!sharedAutosave : autosavePref);
// A note's slots belong to its file; a shared note's to the session's note title.
const autosaveKey = () => (following() ? `shared:${collab.docTitle || $("title").textContent}` : find.fingerprint || `title:${$("title").textContent}`);
function autosaveSwitch() {
  const b = $("autosaveToggle");
  b.setAttribute("aria-checked", String(autosaveOn()));
  b.disabled = following();
  b.title = following() ? "Set by the person sharing this note" : "Copies the note every minute into automatic slots on this device, never over your file";
}
$("autosaveToggle").onclick = () => {
  if (following()) return;
  autosavePref = !autosavePref;
  try { localStorage.setItem("notecomplete-autosave", autosavePref ? "1" : "0"); } catch { /* Optional. */ }
  autosaveSwitch();
  collab?.settingsChanged?.();
  status(autosavePref ? "Auto-save on: a copy every minute, in File → automatic saves." : "Auto-save off.");
  if (autosavePref) autosaveNow();
};
autosaveSwitch();
// What the note holds, apart from its undo history: a digest of its .noteful export (null when
// it cannot be made). Two copies with the same digest are the same note.
async function contentDigest() {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const bytes = await call("export", {});
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
// A copy now, if auto-save is on and the note changed since the last one.
async function autosaveNow({ force = false } = {}) {
  if (!doc || autosaving || editing || !autosaveOn()) return null;
  if (!force && (revision === autosavedRevision || revision === openedRevision)) return null;
  autosaving = true;
  // Read now: a session may end while the copy is being made.
  const at = revision, note = epoch, key = autosaveKey(), title = $("title").textContent, shared = following();
  try {
    await notes?.flush?.();
    const project = await call("save");
    const mark = await call("historyMark").catch(() => null);
    const content = await contentDigest();
    if (note !== epoch) return null;
    const slot = await autosaves.save({ key, title, project, shared, mark, content });
    autosavedRevision = at;
    return slot;
  } catch (e) {
    console.warn("Auto-save:", e);
    return null;
  } finally { autosaving = false; }
}
setInterval(() => { autosaveNow(); }, EVERY_MS);
// Leaving the page or switching away: one more copy (best effort; the browser may not wait).
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") autosaveNow(); });
addEventListener("pagehide", () => { autosaveNow(); });
// A note just opened: offer its newer automatic save, unless this is that save.
async function autosaveOpened(recovered) {
  openedRevision = revision;
  autosavedRevision = -1;
  if (recovered || following() || !doc) return;
  const key = autosaveKey(), note = epoch;
  try {
    const [latest] = await autosaves.list(key);
    const manual = await autosaves.manualAt(key);
    if (note !== epoch || !offerRecovery(latest, manual)) return;
    // Same edit history as the note just opened: nothing to choose between, so do not ask.
    const mark = await call("historyMark").catch(() => null);
    if (note !== epoch) return;
    if (mark && latest.digest && latest.edits === mark.edits && latest.digest === mark.digest) {
      autosaves.markManual(key).catch(() => {});
      return;
    }
    // The same content as the note just opened, whatever its history (a note saved as .noteful
    // comes back with another history): nothing to choose between.
    if (latest.content && (await contentDigest()) === latest.content) {
      if (note !== epoch) return;
      autosaves.markManual(key).catch(() => {});
      return;
    }
    if (note !== epoch) return;
    // The same bytes as the note just opened (its history may be numbered differently after a
    // save in another format): the same note, so nothing to choose between either.
    const [kept, current] = await Promise.all([autosaves.load(latest.id).catch(() => null), call("save").catch(() => null)]);
    if (note !== epoch) return;
    const a = kept && new Uint8Array(kept.buffer || kept), b = current && new Uint8Array(current.buffer || current);
    if (a && b && a.length === b.length && a.every((x, i) => x === b[i])) {
      autosaves.markManual(key).catch(() => {});
      return;
    }
    $("recoverText").textContent = `An automatic save of “${latest.title}” from ${when(latest.time)} is newer than ${manual ? `your last save (${when(manual)})` : "the file you opened"}. Which do you want to open?`;
    $("recoverAuto").textContent = `Automatic save (${when(latest.time)})`;
    $("recoverManual").textContent = manual ? `Manual save (${when(manual)})` : "The file";
    $("recoverAuto").onclick = () => { $("recoverDialog").close(); openAutosave(latest); };
    $("recoverManual").onclick = () => { $("recoverDialog").close(); autosaves.markManual(key).catch(() => {}); };
    $("recoverDialog").showModal();
  } catch { /* No storage: nothing to offer. */ }
}
// Opens an automatic save as a copy of its note: unsaved until the user saves it.
async function openAutosave(slot) {
  closeMenus();
  if (!canReplace()) return;
  const bytes = await autosaves.load(slot.id);
  if (!bytes) return status("That automatic save is gone.", true);
  const keepSaveAs = slot.key === autosaveKey() ? saveAs : null;
  recoveringKey = slot.key.startsWith("shared:") || slot.key.startsWith("title:") ? null : slot.key;
  await load(new File([bytes], `${slot.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}.nfedit`, { type: "application/json" }));
  if (!doc) return;
  saveAs = keepSaveAs;
  saveLabel();
  dirty = changed = true;
  savedState();
  status(`Opened the automatic save from ${when(slot.time)}. Save it to keep it.`);
}
// File menu: this note's automatic saves, newest first, and all of them. Beside each, ✂
// deletes the edit history up to that save (compact.rs), and the last ✂ up to now: the
// note stays as it is, its file gets smaller, and undo stops there.
const bytesText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// The bytes a cut up to `upto` edits would free (null when it cannot be told), one at a time.
let previewQueue = Promise.resolve();
const previewed = new Map();
function previewCut(upto) {
  const key = `${epoch}:${revision}:${upto}`;
  if (!previewed.has(key)) {
    if (previewed.size > 40) previewed.clear();
    const run = () => (doc && !busy() ? call("compactPreview", { upto }).then((r) => r.bytes_before - r.bytes_after).catch(() => null) : Promise.resolve(null));
    previewed.set(key, (previewQueue = previewQueue.then(run, run)));
  }
  return previewed.get(key);
}
async function drawAutosaveList() {
  const list = $("autosaveList");
  const slots = doc ? await autosaves.list(autosaveKey()).catch(() => []) : [];
  const all = await autosaves.list().catch(() => []);
  list.hidden = !all.length && !doc;
  if (list.hidden) return list.replaceChildren();
  const label = document.createElement("span");
  label.className = "autosave-label";
  label.textContent = slots.length ? "Automatic saves" : "No automatic saves of this note";
  const floor = doc?.history_floor || 0, edits = doc?.edit_count || 0;
  const trim = (title, run) => Object.assign(document.createElement("button"), { type: "button", className: "autosave-trim", title, ariaLabel: title, onclick: run });
  // How much space a cut frees, worked out one at a time in the background (it measures the
  // note before and after) and written into the tooltip when ready.
  const tell = (button, text, upto, apply) => {
    button.title = `${text}\nWorking out how much space this frees…`;
    previewCut(upto).then((freed) => { apply?.(freed); button.title = `${text}\n${freed == null ? "Could not work out the space it frees." : freed > 0 ? `Frees about ${bytesText(freed)} once saved.` : "Nothing to free: every edit still shapes the note."}`; });
  };
  const items = await Promise.all(slots.map(async (slot) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = when(slot.time);
    b.title = `Open the automatic save of “${slot.title}” from ${when(slot.time)}`;
    b.onclick = () => openAutosave(slot);
    const pair = document.createElement("span");
    pair.className = "autosave-slot";
    pair.append(b);
    // Offered when the save is part of this note's history as it is now, with edits before it.
    const usable = slot.edits > floor && slot.edits <= edits && (await call("prefixDigest", { edits: slot.edits }).catch(() => "")) === slot.digest;
    if (usable) {
      const text = `Delete the history up to this save (${when(slot.time)}): undo stops there; the note stays as it is.`;
      const t = trim(text, () => compactHistory(slot.edits, `up to the automatic save of ${when(slot.time)}`));
      t.append(icon("trim"));
      tell(t, text, slot.edits);
      pair.append(t);
    }
    return pair;
  }));
  const now = Object.assign(document.createElement("button"), { type: "button", className: "autosave-now", textContent: "Delete history up to now", title: "Delete the whole undo history: the note stays as it is and its file gets smaller", disabled: !doc || (edits <= floor && !doc.can_redo), onclick: () => compactHistory(edits, "up to now") });
  now.prepend(icon("trim"));
  if (!now.disabled) tell(now, "Delete the whole undo history: the note stays as it is and its file gets smaller.", edits, (freed) => { if (freed > 0) now.append(Object.assign(document.createElement("span"), { className: "autosave-saves", textContent: `−${bytesText(freed)}` })); });
  list.replaceChildren(label, ...items, Object.assign(document.createElement("button"), { type: "button", textContent: "All automatic saves…", onclick: openAutosaves }), now);
}
// Deletes the edit history up to `upto` edits (an automatic save's point, or now): the
// edits that no longer shape the note go (strokes drawn and erased, superseded moves, what
// was undone), and undo stops there. The engine checks every page still draws the same.
async function compactHistory(upto, label) {
  closeMenus();
  if (!doc) return;
  if (collab) return status("The history cannot be deleted while sharing: every copy of the note keeps the same history. Stop sharing first.", true);
  if (busy()) return status("Wait for the edit in progress to finish, then try again.", true);
  const freed = await previewCut(upto);
  const frees = freed > 0 ? `its file gets about ${bytesText(freed)} smaller once saved` : "its file gets smaller once saved";
  if (!confirm(`Delete the edit history ${label}?\n\nThe note stays exactly as it is, and ${frees}. You will not be able to undo past this point.`)) return;
  try {
    const { report, view } = await call("compactHistory", { upto });
    const removed = report.edits_before - report.edits_after, saved = report.bytes_before - report.bytes_after;
    revision++;
    dirty = changed = true;
    doc = view;
    savedState();
    const size = bytesText(saved);
    restructure(view, page, removed ? `History deleted ${label}: ${removed} ${removed === 1 ? "edit" : "edits"} fewer, ${size} smaller. Save to keep it.` : `Nothing to delete ${label}: every edit still shapes the note. Undo now stops there.`);
  } catch (e) {
    status(`Could not delete the history: ${e.message}`, true);
  }
}
$("fileMenu").addEventListener("toggle", () => { if ($("fileMenu").open) { autosaveSwitch(); drawAutosaveList(); } });
async function openAutosaves() {
  closeMenus();
  const slots = await autosaves.list().catch(() => []);
  $("autosavesAll").replaceChildren(...(slots.length ? slots.map((slot) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${slot.shared ? "Shared · " : ""}${slot.title} · ${when(slot.time)} · ${(slot.size / 1048576).toFixed(1)} MB`;
    const open = Object.assign(document.createElement("button"), { type: "button", textContent: "Open", onclick: () => { $("autosavesDialog").close(); openAutosave(slot); } });
    const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete", onclick: async () => { await autosaves.remove(slot.id); li.remove(); } });
    li.append(name, open, remove);
    return li;
  }) : [Object.assign(document.createElement("li"), { className: "muted", textContent: "None yet." })]));
  $("autosavesDialog").showModal();
}
$("autosavesClose").onclick = () => $("autosavesDialog").close();
$("autosavesClear").onclick = async () => {
  if (!confirm("Delete every automatic save on this device?")) return;
  await autosaves.clear();
  $("autosavesDialog").close();
  status("Automatic saves deleted.");
};
// View → Tool bar (Shift + T): hides the row of tools and their settings, for more room
// when the quick menu is used instead. Undo, redo and the panel buttons stay. Remembered.
function setToolsHidden(hidden, announce = true) {
  document.body.classList.toggle("tools-hidden", hidden);
  $("toolsToggle").setAttribute("aria-checked", String(!hidden));
  try { localStorage.setItem("notecomplete-tools-hidden", hidden ? "1" : "0"); } catch { /* Optional. */ }
  if (doc) resize();
  if (announce) status(hidden ? "Tool bar hidden: Shift + S, a pen's button or two fingers held still open the tools. Shift + T shows the bar." : "Tool bar shown.");
}
$("toolsToggle").onclick = () => { closeMenus(); setToolsHidden(!document.body.classList.contains("tools-hidden")); };
try { if (localStorage.getItem("notecomplete-tools-hidden") === "1") setToolsHidden(true, false); } catch { /* Optional. */ }
// Single-key shortcuts (no modifier, outside text fields). Listed in Help → Keyboard shortcuts.
const SHORTCUTS = [
  ["V", "Pan tool"], ["S", "Select tool"], ["P", "Pen"], ["H", "Highlighter"], ["E", "Eraser"], ["T", "Tape"], ["R", "Shapes"], ["F", "Shapes: fill none / tint / solid"], ["G", "Grab: copy text or ask AI about a region"], ["W", "Text: click to type a text box, or click a text box to edit it (Esc keeps it, Shift Esc or × discards)"], ["O", "Lock: click an item to lock or unlock it in place"],
  ["/", "Find in note"], ["D", "Dark pages"], ["Shift L", "Layers"], ["Shift P", "Page list"], ["Shift G", "Go to page"], ["Shift I", "Insert image"], ["Shift B", "Insert blank page"], ["Shift X", "Insert graph: a function of x, or axes and a grid to draw on"], ["Shift Y", "Insert table"], ["Shift O", "Recognize text (OCR)"], ["Shift E", "Export flashcards and quizzes to Anki"], ["Shift U", "Lift all tape / cover it again"], ["Shift T", "Show or hide the tool bar (the quick menu has the tools; holding its × does the same)"], ["N", "Notes (Markdown beside the pages)"], ["A", "Audio and transcript"], ["Shift A", "Go to the page where the recording starts"], ["Shift R", "Record audio into this note / stop and keep it"], ["I", "Dim ink not yet written at this point of the recording"], ["K", "Play / pause recording"], ["Shift K", "Text from part of the recording: choose a segment (scissors in the audio panel)"], ["J / L", "Back / forward 10 s"], ["Q", "Resume quiz"], ["Shift Q", "New quiz"], ["Shift C", "New flashcards"], ["Shift F", "Fact check pages with AI (findings go into the notes)"], ["Shift D", "Saved decks and quizzes"], ["Shift S", "Quick menu: tools, and the chosen tool's colours, widths and modes (hold, point and let go, or tap and click; 1–9 choose a tool; hold a tool to move it). Also a pen's side button, or two fingers held still"], ["Shift + pen", "Quick menu at the pen: Shift held as the pen touches the page, or pressed while the pen hovers over it (a pen's button pressed again while hovering closes it)"], ["?", "Show keys on buttons (again to hide)"],
  ["Ctrl K", "Commands"], ["Ctrl F", "Find"], ["Ctrl J", "Ask AI"], ["Ctrl N", "New document"], ["Ctrl O", "Open"], ["Ctrl S", "Save"], ["Ctrl Shift N", "New window"], ["Ctrl Z / Ctrl Shift Z", "Undo / redo"], ["Ctrl + / − / 0", "Zoom in / out / fit"], ["Ctrl Shift + / − / 0", "Interface larger / smaller / 100% (desktop app)"], ["Ctrl + trackpad", "Zoom towards the pointer"], ["Shift + wheel", "Scroll fast"], ["Ctrl + drag on a window", "Move it (Ask AI, quiz, audio, flashcards; ⌘ on a Mac)"], ["Ctrl + right-drag on a window", "Resize it from the nearest corner"], ["Two fingers held still", "Quick menu (any touch screen; also a pen's side button)"], ["Two / three-finger tap", "Undo / redo"], ["Shift + arrows / Page Up, Down", "Scroll three times as far"],
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
  "#notesToggle": "N", "#audioToggle": "A", "#audioPage": "⇧A", "#recordAudio": "⇧R", "#stopRecording": "⇧R", ".icon-toggle:has(#syncEnabled)": "I", "#layersToggle": "⇧L", "#pagesToggle": "⇧P", "#importImage": "⇧I", "#pagesDark": "D", "#htmlDark": "D", "#textDark": "D", "#webDark": "D", "#backAudio": "J", "#playAudio": "K", "#forwardAudio": "L",
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
  // Text documents have the study keys too (flashcards, quizzes, saved decks).
  const studyKey = !doc && textView.visible && { q: resumeQuiz, Q: () => study.quiz(), C: () => study.cards(), F: () => study.check(), D: () => study.saved(), W: () => quizzes.retakeWrong(), "/": () => textFinder.open() }[k];
  if (studyKey) return studyKey(), true;
  if (!doc && (htmlView.visible || textView.visible) && k === "n") return notesButton().click(), true;
  if (!doc) return sideView()?.visible && k === "d" ? ($("htmlDark").click(), true) : false;
  if (k === "f" && tool === "shape" && !$("editor").hidden) return setShapeFill({ none: "tint", tint: "solid", solid: "none" }[shapeFill]), status(`Shape fill: ${shapeFill === "none" ? "outline only" : shapeFill}.`), true;
  const keyTool = !e.shiftKey && TOOL_KEYS[k.toLowerCase()];
  if (keyTool && !$("editor").hidden) return document.querySelector(`#toolbar [data-tool="${keyTool}"]`)?.click(), true;
  if (k === "/") return showDocument(), find.open(), true;
  if (k === "L") return $("layersToggle").click(), true;
  if (k === "P") return $("pagesToggle").click(), true;
  if (k === "G") return $("gotoPage").click(), true;
  if (k === "I") return $("importImage").click(), true;
  if (k === "B") return $("insertBlank").click(), true;
  if (k === "X") return $("insertGraph").click(), true;
  if (k === "Y") return $("insertTable").click(), true;
  if (k === "O") return $("ocrOpen").click(), true;
  if (k === "E") return $("exportStudy").click(), true;
  // Lifts all tape, or covers it all again when it is all lifted.
  if (k === "U") return (tapeAllLifted ? $("tapeCover") : $("tapeReveal")).click(), true;
  if (k === "T") return $("toolsToggle").click(), true;
  if (k === "n") return notesButton().click(), true;
  if (k.toLowerCase() === "a" && !e.shiftKey) return $("audioToggle")?.click(), true;
  if (k === "A" && !$("audioToggle").hidden) return $("audioPage").click(), true;
  // Text from part of the recording (audio-trim.js): the scissors, with the audio panel open.
  if (k === "K" && !$("audioBar").hidden) return $("trimAudio")?.click(), true;
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
  if (k === "F") return study.check(), true;
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
  // Text documents have their own find bar (text-find.js).
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f" && !doc && textView.visible) {
    e.preventDefault();
    textFinder.toggle();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "f" && doc && $("editor").hidden === false) {
    e.preventDefault();
    // Ctrl+F toggles: a second press closes the find bar, from the box or anywhere else.
    if (!$("findBar").hidden) $("findClose").click();
    else find.open();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && (textView.hasDocument || htmlView.hasDocument)) {
    e.preventDefault();
    saveText();
    return;
  }
  // Ctrl +/−/0 on a text document or HTML page: its own zoom (notes zoom their pages below).
  if ((e.metaKey || e.ctrlKey) && !e.altKey && sideView()?.visible && ["+", "=", "-", "_", "0"].includes(e.key)) {
    e.preventDefault();
    const dir = e.key === "0" ? 0 : e.key === "-" || e.key === "_" ? -1 : 1;
    if (textView.visible) textView.zoom(dir); else if (webView.visible) webZoom.step(dir); else htmlZoom.step(dir);
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
    scrollViewport(e.key, e.shiftKey)
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
    // Text recognized in the handwriting goes with the note, so other tools (the MCP
    // server) and other copies find it. .noteful files have no place for it.
    if (as !== "noteful" && as !== "markdown") await call("recognized", { pages: find.recognizedText() }).catch(() => {});
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
    if (!delivery.shared) {
      autosaves.markManual(autosaveKey()).catch(() => {});
      // Just saved by hand: an automatic copy of exactly this state would only be a duplicate.
      autosavedRevision = revision;
    }
    if (as === saveAs && !delivery.shared) {
      dirty = changed = false;
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
      dirty = changed = false;
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
// New document: blank pages of a chosen size, saved in the chosen format, or an
// infinite canvas: one page (two sheets wide, two tall) that grows as ink nears its edge.
const CANVAS_START = [3087, 2182.8];
for (const [value, { label }] of Object.entries(PRESETS)) if (value !== "current") $("newPreset").add(new Option(label, value));
$("newPreset").onchange = () => { $("newCustom").hidden = newKind() === "canvas" || $("newPreset").value !== "custom"; };
const newKind = () => document.querySelector('[name="newKind"]:checked')?.value || "pages";
// A new note is saved as a NoteComplete project (.nfedit) or a Noteful file; .notecomp
// and Noteful + Markdown are exports (File → Export). Noteful has no infinite page: a
// canvas is a project.
const NEW_FORMATS = ["project", "noteful"];
const newFormat = (value) => (NEW_FORMATS.includes(value) ? value : "project");
function newKindChanged() {
  const canvas = newKind() === "canvas", noteful = document.querySelector('[name="newFormat"][value="noteful"]');
  for (const el of document.querySelectorAll("#newDialog .new-pages-only")) el.hidden = canvas;
  noteful.disabled = canvas;
  noteful.closest("label").title = canvas ? "An infinite canvas cannot be a .noteful file" : "";
  if (canvas && noteful.checked) document.querySelector('[name="newFormat"][value="project"]').checked = true;
  $("newPreset").onchange();
}
for (const box of document.querySelectorAll('[name="newKind"]')) box.onchange = newKindChanged;
$("newDocument").onclick = () => {
  for (const m of document.querySelectorAll("details.menu")) m.open = false;
  try { const f = newFormat(localStorage.getItem("notecomplete-new-format")); document.querySelector(`[name="newFormat"][value="${f}"]`).checked = true; } catch { /* Optional. */ }
  newKindChanged();
  $("newDialog").showModal();
  $("newName").select();
};
$("newCancel").onclick = () => $("newDialog").close();
$("newCreate").onclick = async () => {
  if (!canReplace()) return;
  const canvas = newKind() === "canvas";
  const preset = $("newPreset").value, count = canvas ? 1 : Math.max(1, Math.min(200, Math.round(Number($("newCount").value) || 1)));
  const size = canvas ? CANVAS_START : preset === "custom" ? [Number($("newWidth").value), Number($("newHeight").value)].map(mmToUnits) : PRESETS[preset].mm.map(mmToUnits);
  if (!size.every((n) => Number.isFinite(n) && n > 0)) return status("Choose a page size.", true);
  const format = newFormat(document.querySelector('[name="newFormat"]:checked')?.value);
  try { localStorage.setItem("notecomplete-new-format", format); } catch { /* Optional. */ }
  const title = $("newName").value.trim() || "Untitled";
  $("newDialog").close();
  // A unique stand-in file, so this document's notes and study material get their own key.
  const seed = crypto.getRandomValues(new Uint8Array(16));
  await load(new File([seed], `${title}${SAVE_EXT[format]}`), { kind: "blank", title, sizes: Array.from({ length: count }, () => size), bytes: new ArrayBuffer(0), saveAs: format, canvas });
};
// Markdown written as handwriting ink (the MCP ink engine): a new note, or pages in this one.
const converter = handwritingConverter({
  call,
  status,
  ai: sharedAI(),
  hasDocument: () => !!doc,
  sourceText: () => (!doc && textView?.visible && (converted || isMarkdownName(textView.key)) ? textView.text : ""),
  onCreate: async ({ title, markdown, options }) => {
    if (!canReplace()) return;
    let format = "project";
    try { format = newFormat(localStorage.getItem("notecomplete-new-format")); } catch { /* Optional. */ }
    const seed = crypto.getRandomValues(new Uint8Array(16));
    await load(new File([seed], `${title}${SAVE_EXT[format]}`), { kind: "handwritten", title, markdown, options, bytes: new ArrayBuffer(0), saveAs: format });
  },
  onInsert: async ({ markdown, options, where }) => {
    if (!doc || busy()) return;
    const at = insertAt(where, page, doc.pages);
    await action("insertHandwritten", { at, markdown, options, focus: at });
  },
});
$("newHandwritten").onclick = () => { closeMenus(); converter.open(); };
$("newWithAi").hidden = !sharedAI();
$("newWithAi").onclick = () => { closeMenus(); converter.open({ withAi: true }); };
$("insertHandwritten").onclick = () => { closeMenus(); if (doc) converter.open({ insert: true }); };
// The "?" beside Save as (New document) and Export: what each format keeps.
for (const help of document.querySelectorAll("[data-format-help]")) help.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeMenus(); $("formatsDialog").showModal(); };
$("formatsClose").onclick = () => $("formatsDialog").close();
$("native").onclick = () => save(true);
$("nativeMarkdown").onclick = () => save(true, "markdown");
$("exportNotecomplete").onclick = () => save(true, "notecomplete");
$("exportProject").onclick = () => save(true, "project");
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
    if (htmlView.hasDocument || textView.hasDocument) return notes.load(sideFp, { core: false }).then(() => notes);
    return notes;
  });
}
$("notesToggle").onclick = async () => {
  // A guest with no note open has only the notes: they stay.
  if (document.body.classList.contains("guest-mode")) return;
  const api = await notesApi();
  if (api.visible) await api.close();
  else await api.open();
  $("notesToggle").setAttribute("aria-expanded", String(api.visible));
  resize();
};
// HTML pages and text documents have the same Notes, from their bar (N); kept on this device per file.
const notesButton = () => (!doc && htmlView.visible ? $("htmlNotes") : !doc && textView.visible ? $("textNotes") : $("notesToggle"));
for (const id of ["htmlNotes", "textNotes"]) $(id).onclick = async () => {
  const api = await notesApi();
  if (api.visible) await api.close();
  else await api.open();
  for (const button of ["htmlNotes", "textNotes", "notesToggle"]) $(button).setAttribute("aria-expanded", String(api.visible));
};
$("closeNotes").onclick = () => notesButton().click();
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
    try {
      await download(new XMLSerializer().serializeToString(await pageSvg(p)), `${filename()}-p${page + 1}.svg`, "image/svg+xml");
    } catch (e) {
      status(e.message, true);
    }
  }
};
window.addEventListener("beforeunload", (e) => {
  if (dirty && changed) {
    e.preventDefault();
    e.returnValue = "";
  }
});
// A device opening an invite (/join, /tablet) loads the shared note first: the offline copy of
// the app (sw.js) is made once the note is open, or after a minute, not while it downloads.
if ("serviceWorker" in navigator) {
  const register = () => navigator.serviceWorker.register("./sw.js").catch(() => {});
  if (/^\/(join|tablet|send)$/.test(location.pathname)) {
    const later = setTimeout(register, 60000);
    addEventListener("notecomplete:joined", () => { clearTimeout(later); setTimeout(register, 2000); }, { once: true });
  } else register();
}

function shapeHandles(p) {
  selection.render(p);
}
async function patchItem(item, adjustment, crop = null) {
  if (busy() || !doc) return null;
  editing = true;
  const token = epoch;
  try {
    const result = crop
      ? await mutate("crop", { page: item.page, itemId: item.id, rect: crop })
      : await mutate("adjust", { page: item.page, itemId: item.id, adjustment });
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
      paintTapes(p.render, p.index);
      typesetMath(p.render, p.view?.texts);
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
  if (["graph", "table"].includes($("shape").value)) return insertCompound(panels[page], $("shape").value);
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
    shape = { kind: $("shape").value, start, end, ...fillFor($("shape").value, $("color").value) },
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
  if (zoom === "fit") resize();
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
// Groups and folders (groups.js), shared by Home's Folders and the document side list.
const groups = groupStore({ store: library.store });
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
let startingRecording = false;
async function startRecording() {
  if (addedStore.recording || startingRecording) return;
  startingRecording = true;
  // A browser asks for the microphone in its own prompt, and until it is answered nothing shows:
  // say so, and what to do when no prompt appears (Safari on an iPad, a home screen app).
  status("Waiting for the microphone: allow it when the browser asks.");
  const slow = setTimeout(() => status("Still waiting for the microphone. If no question appeared, allow it for this site in the browser's settings (Safari: aA → Website Settings → Microphone), then try again.", true), 6000);
  try {
    await addedStore.start();
    audio.audio.pause();
    status("Recording. Stop keeps it in this note.");
  } catch (e) {
    const said = {
      NotAllowedError: "The microphone is blocked for this site. Allow it in the browser's settings (Safari: aA → Website Settings → Microphone; a home screen app: Settings → Safari → Microphone), then try again.",
      SecurityError: "The browser does not allow the microphone here: it needs a secure (https) page.",
      NotFoundError: "No microphone found.",
      NotReadableError: "The microphone is in use by another app.",
    }[e.name];
    status(said || `Could not record: ${e.message || e.name}`, true);
  } finally { clearTimeout(slow); startingRecording = false; }
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

const mb = (size) => `${(Number(size) / 1048576).toFixed(1)} MB`;

function queueStatusIcon(status) {
  if (status === "done") {
    return `<svg class="queue-status-svg is-done" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>`;
  }
  if (status === "downloading") {
    return `<svg class="queue-status-svg is-downloading" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12m-4-4 4 4 4-4M5 20h14"/></svg>`;
  }
  if (status === "error") {
    return `<svg class="queue-status-svg is-error" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`;
  }
  return `<svg class="queue-status-svg is-queued" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/><path d="M12 7v5l3 3"/></svg>`;
}

function renderQueueList(stats, listEl) {
  listEl.replaceChildren(
    ...stats.items.map((item) => {
      const li = document.createElement("li");
      li.className = "cloud-queue-item";
      const info = document.createElement("span");
      info.className = "cloud-queue-item-info";
      info.innerHTML = `${queueStatusIcon(item.status)}<span>${item.name}${item.size ? ` (${mb(item.size)})` : ""}</span>`;
      if (item.error) info.title = item.error;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "item-remove";
      remove.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
      remove.title = "Remove from queue";
      remove.setAttribute("aria-label", `Remove ${item.name}`);
      remove.onclick = () => downloadQueue.cancel(item.id);
      li.append(info, remove);
      return li;
    })
  );
}

const downloadQueue = createDownloadQueue({
  library,
  onItemDone: (item) => {
    drive?.onQueueItemDone?.(item);
    archive?.onQueueItemDone?.(item);
  },
  onUpdate: (stats) => {
    const bar = $("cloudQueueBar");
    if (!bar) return;
    if (stats.total === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const countEl = $("cloudQueueCount");
    if (countEl) countEl.textContent = `Queue (${stats.completed}/${stats.total})`;
    const progEl = $("cloudQueueProgress");
    if (progEl) progEl.value = stats.overallProgress;

    const iconEl = bar.querySelector(".cloud-queue-icon");
    if (iconEl) {
      if (stats.completed === stats.total && stats.total > 0 && !stats.isBusy) {
        iconEl.innerHTML = `<path d="M5 13l4 4L19 7"/>`;
      } else {
        iconEl.innerHTML = `<path d="M12 3v13m-5-5 5 5 5-5M4 20h16"/>`;
      }
    }

    const statusEl = $("cloudQueueStatus");
    if (statusEl) {
      if (stats.activeItem) {
        const pct = stats.activeItem.progress ? ` (${Math.round(stats.activeItem.progress * 100)}%)` : "";
        statusEl.textContent = `Downloading ${stats.completed + 1} of ${stats.total}: ${stats.activeItem.name}${pct}`;
      } else if (stats.pending > 0) {
        statusEl.textContent = `${stats.pending} item${stats.pending === 1 ? "" : "s"} waiting in queue…`;
      } else {
        statusEl.textContent = `Batch download complete (${stats.completed} files saved to library)`;
      }
    }

    const listEl = $("cloudQueueList");
    if (listEl && !listEl.hidden) {
      renderQueueList(stats, listEl);
    }
  },
});

const toggleBtn = $("cloudQueueToggle");
if (toggleBtn) {
  toggleBtn.onclick = () => {
    const listEl = $("cloudQueueList");
    if (!listEl) return;
    const willOpen = listEl.hidden;
    listEl.hidden = !willOpen;
    toggleBtn.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) renderQueueList(downloadQueue.stats(), listEl);
  };
}

const clearBtn = $("cloudQueueClear");
if (clearBtn) {
  clearBtn.onclick = () => downloadQueue.clear();
}

// A ⋯ export chosen on a Drive or Internet Archive card: the note is exported once it has opened.
const exportRequest = { kind: "", key: "" };
async function exportRequested(key, opened) {
  const { kind, key: wanted } = exportRequest;
  exportRequest.kind = exportRequest.key = "";
  if (!opened || !kind || wanted !== key || !doc) return;
  if (kind === "pdf") return $("exportPdf").click();
  await save(true, kind);
}
const drive = driveBrowser({
  library,
  queue: downloadQueue,
  exportRequest,
  onCards: () => home?.applyFilters(),
  open: async (file, driveFile) => {
    const opened = await openChosen(file);
    exportRequested(`drive:${driveFile.id}`, opened).catch((error) => status(error.message, true));
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
  if (collab?.role === "tablet") return;
  const fp = (doc && find.fingerprint) || (sideView() && sideFp);
  if (!fp) return;
  const before = await library.store.get("settings", `doc:${fp}`).catch(() => null);
  await library.store.set("settings", `doc:${fp}`, { title: doc?.title || sideView()?.name || $("title").textContent, entryKey: entryKey || before?.entryKey || "", at: Date.now() }).catch(() => {});
}
// ⋯ on a Recent note: opens it and deletes its whole edit history (asking first, saying how
// much space that frees); the note stays unsaved until the user saves.
async function cutHistoryOf(entry) {
  const file = await library.open(entry);
  if (!file) throw Error(`${entry.name} is no longer kept on this device.`);
  await library.touch(entry.key);
  if (!(await openFromLibrary(file, entry))) return;
  if (!doc) return;
  if (!(doc.edit_count > (doc.history_floor || 0) || doc.can_redo)) return status("This note has no edit history to delete.");
  await compactHistory(doc.edit_count || 0, "up to now");
}
// ⋯ on a Recent note: opens it and exports it as chosen (the File menu's Export row).
async function exportNoteOf(entry, kind) {
  const file = await library.open(entry);
  if (!file) throw Error(`${entry.name} is no longer kept on this device.`);
  await library.touch(entry.key);
  if (!(await openFromLibrary(file, entry))) return;
  if (!doc) return;
  if (kind === "pdf") return $("exportPdf").click();
  await save(true, kind);
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
// Dark Reader's script, fetched once (vendor/darkreader), for HTML pages and web links.
const loadDarkReader = () => (darkReader ||= fetch("vendor/darkreader/darkreader.js").then((r) => {
  if (!r.ok) throw Error("Dark Reader is missing from this build.");
  return r.text();
}).catch((error) => { darkReader = null; status(error.message, true); throw error; }));
const htmlView = htmlViewer({
  root: $("htmlView"),
  frame: $("htmlFrame"),
  title: $("htmlTitle"),
  reload: $("htmlReload"),
  clear: $("htmlClear"),
  status,
  // Edit: the HTML source in the plain editor; Save / Ctrl S writes it like a text file.
  editorHost: $("htmlEditor"), edit: $("htmlEdit"),
  onChange: () => {
    dirty = changed = true;
    $("htmlSave").hidden = false;
    tabBar.update({ title: htmlView.name, dirty: true });
  },
  darkScript: loadDarkReader,
  // The dark theme's --canvas and --ink, also when the app itself is light.
  darkColors: () => ({ mode: 1, brightness: 100, contrast: 100, sepia: 0, darkSchemeBackgroundColor: "#15171b", darkSchemeTextColor: "#e5e8ed" }),
  onOwnDark: (own) => {
    $("htmlDark").title = own ? "Dark pages (D): this page already has a dark design, so it is left as it is" : "Dark pages: darken this page (D)";
  },
});
// Web links (web-view.js): a page in a sandboxed <webview> on the desktop, the browser elsewhere.
const webView = webViewer({
  root: $("webView"), host: $("webHost"), title: $("webTitle"), address: $("webAddress"), back: $("webBack"), reload: $("webReload"),
  external: $("webExternal"), fallback: $("webFallback"), status,
  onTitle: (name, url) => {
    $("title").textContent = name;
    document.title = `${name} — NoteComplete`;
    tabBar.update({ title: name, dirty: false });
    if (url === docMember?.url) library.rememberWeb(docMember.url, name).catch(() => {});
  },
});
$("webFallbackOpen").onclick = () => $("webExternal").click();
function htmlDarkApply() {
  const on = document.body.classList.contains("pages-dark");
  for (const id of ["htmlDark", "textDark", "webDark"]) $(id).setAttribute("aria-pressed", String(on));
  htmlView.setDark(on);
  webView.setDark(on);
}
$("htmlDark").onclick = $("textDark").onclick = $("webDark").onclick = () => setDarkPages(!document.body.classList.contains("pages-dark"));
var htmlViewReady = true;
const textView = textViewer({
  root: $("textView"), body: $("textBody"), editorHost: $("textEditor"), title: $("textTitle"), format: $("textMarkdown"), edit: $("textEdit"),
  zoom: { out: $("textZoomOut"), into: $("textZoomIn"), value: $("textZoomValue") },
  toHtml: (value) => call("markdownHtml", { text: value }),
  imageUrl: textImageUrl,
  // The Notes panel's TinyMDE, for Markdown files.
  loadEditor: () => import("./notes.js").then((m) => m.loadEditor()),
  // A relative link to another file opens it here, from this file's folder.
  openLink: (href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return status(`NoteComplete cannot open ${href.split(":")[0]}: links.`, true);
    if (docMember?.source !== "local") return status("Links to other files work in documents opened from this computer.", true);
    const target = decodeURIComponent(new URL(href, `file://${encodeURI(docMember.path)}`).pathname);
    const name = target.split("/").pop();
    openMember(localMember(target, name)).catch(() => status(`Could not open ${name}. To follow links between files, open their folder (Home → Folder).`, true));
  },
  onChange: () => {
    textFinder.refresh();
    collab?.textChanged?.();
    dirty = changed = true;
    $("textSave").hidden = false;
    tabBar.update({ title: textView.name, dirty: true });
  },
});
// Ctrl F in a text document: the formatted text, the Markdown editor or the plain editor.
const textFinder = textFind({
  bar: $("textFindBar"), input: $("textFindInput"), count: $("textFindCount"), prev: $("textFindPrev"), next: $("textFindNext"), close: $("textFindClose"),
  root: () => (textView.editing ? $("textEditor") : $("textBody")),
  plainEditor: () => (textView.editing ? $("textEditor").querySelector("textarea.doc-editor-plain") : null),
});
for (const id of ["textEdit", "textMarkdown"]) $(id).addEventListener("click", () => textFinder.refresh());
const htmlZoom = zoomControl({ key: "notecomplete-html-zoom", out: $("htmlZoomOut"), into: $("htmlZoomIn"), value: $("htmlZoomValue"), apply: (z) => htmlView.setZoom(z) });
// Save (Ctrl S) for a converted document (.docx, .odt, .xlsx, .csv…): a Markdown copy, never over
// the file it came from. The desktop app writes it beside the original (a taken name gets " (2)")
// with the pictures in "<name>_files", and the next Save in the same session updates that copy;
// the browser downloads the .md, or a .zip with the pictures folder.
async function saveConvertedCopy() {
  const name = `${textView.name}.md`, text = textView.text;
  try {
    const { linkPath } = await import("./office.js");
    const used = convertedImages.filter((image) => text.includes(linkPath(image.path)));
    const bridge = window.notecompleteFiles;
    let message;
    if (bridge?.saveCopy) {
      const original = docMember?.source === "local" ? docMember.path : null;
      const saved = await bridge.saveCopy(original, { name, text, images: used.map(({ name: file, bytes }) => ({ name: file, bytes })), folder: convertedFolder, replace: copyTarget });
      copyTarget = saved;
      await library.rememberLocal(saved.path, saved.name, saved.size).catch(() => {});
      message = `Saved a copy as ${saved.name}${original ? "" : " in your downloads folder"}${saved.folder ? `, with its pictures in ${saved.folder}` : ""}. The original is untouched.`;
    } else if (used.length) {
      const zipName = `${textView.name}.zip`;
      await download(zipFiles([{ name, bytes: new TextEncoder().encode(text) }, ...used.map((image) => ({ name: image.path, bytes: image.bytes }))]), zipName, "application/zip");
      message = `${zipName} downloaded: the .md and its ${convertedFolder} folder of pictures. Unzip it together to keep the links working.`;
    } else {
      await download(text, name, "text/markdown");
      message = `${name} saved. The original is untouched.`;
    }
    dirty = changed = false;
    tabBar.update({ title: textView.name, dirty: false });
    status(message);
  } catch (error) { status(error.message, true); }
}
// Save (Ctrl S) for an edited text document: back to its file on this device, else a download.
// Saves the edited text or HTML document over its file (a download when it has none here).
async function saveText() {
  const view = textView.hasDocument ? textView : htmlView.hasDocument ? htmlView : null;
  if (view === textView && converted) return saveConvertedCopy();
  if (!view || !changed) return;
  const html = view === htmlView, name = docMember?.name || `${view.name}${html ? ".html" : ".txt"}`;
  try {
    if (docMember?.source === "local" && window.notecompleteFiles?.writeOpened) {
      await window.notecompleteFiles.writeOpened(docMember.path, new TextEncoder().encode(view.text));
      status(`Saved ${name}.`);
    } else {
      await download(view.text, name, html ? "text/html" : "text/plain");
      status(`This file isn't on this device, so ${name} was downloaded with the changes.`);
    }
    dirty = changed = false;
    $(html ? "htmlSave" : "textSave").hidden = true;
    tabBar.update({ title: view.name, dirty: false });
    // Study material and notes are kept per content fingerprint: they follow the saved text.
    const before = sideFp, after = await noteFingerprint(new File([view.text], name)).catch(() => "");
    if (before && after && after !== before) {
      await notes?.flush();
      await carryStudy(library.store, before, after, ["decks", "quizzes", "notes", "recordings", "scratch"]);
      sideFp = after;
      rememberDocument();
      await notes?.load(sideFp, { core: false });
    }
  } catch (error) { status(error.message, true); }
}
$("textSave").onclick = $("htmlSave").onclick = () => saveText();
// A text document open instead of a note: studied by sections.
function studyText() { return !doc && textView.hasDocument; }
// The open HTML or text document, when one is open instead of a note.
function sideView() { return htmlView.hasDocument ? htmlView : textView.hasDocument ? textView : webView.hasDocument ? webView : null; }
const webZoom = zoomControl({ key: "notecomplete-web-zoom", out: $("webZoomOut"), into: $("webZoomIn"), value: $("webZoomValue"), apply: (z) => webView.setZoom(z) });
// Opens a link as a document: Recent keeps it, its group (if any) is listed beside it.
async function openWeb(member) {
  if (busy() || !canReplace()) return;
  reset({ opening: true });
  notePath = noteEntryKey = "";
  $("title").textContent = member.name;
  document.title = `${member.name} — NoteComplete`;
  tabBar.update({ title: member.name, dirty: false });
  webView.open({ url: member.url, name: member.name, darkReader: loadDarkReader });
  showDocument();
  documentControls();
  const entry = await library.rememberWeb(member.url, member.name);
  const host = linkTitle(member.url).split("/")[0], esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  if (!(await library.cover(entry.key))) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" width="240" height="320"><rect width="240" height="320" fill="#ffffff"/><g font-family="system-ui, sans-serif"><text x="22" y="150" font-size="13" font-weight="700" fill="#1d2433">${esc(member.name.slice(0, 30))}</text><text x="22" y="172" font-size="11" fill="#5b6478">${esc(host)}</text></g></svg>`;
    await library.saveCover(entry.key, `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`).catch(() => {});
  }
  setDocMember(member);
  status(window.notecompleteFiles ? `Opened ${host}.` : "Web pages open inside the desktop app; here, use Open in browser.");
}
$("openLink").onclick = () => {
  $("linkUrl").value = "";
  $("linkError").hidden = true;
  $("linkAdd").disabled = !docMember;
  $("linkDialog").showModal();
  $("linkUrl").focus();
};
function chosenLink() {
  const url = normalizeLink($("linkUrl").value);
  $("linkError").hidden = Boolean(url);
  return url ? webMember(url, linkTitle(url)) : null;
}
$("linkCancel").onclick = () => $("linkDialog").close();
$("linkOpen").onclick = () => { const m = chosenLink(); if (!m) return; $("linkDialog").close(); openWeb(m).catch((e) => status(e.message, true)); };
$("linkUrl").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("linkOpen").click(); } };
$("linkAdd").onclick = async () => {
  const m = chosenLink();
  if (!m || !docMember) return;
  $("linkDialog").close();
  const g = await groups.add(docMember, [m], docMember.name.replace(/\.[^.]+$/, ""));
  await groupList.set(docMember);
  status(`${m.name} added to ${g.name}.`);
};
htmlDarkApply();
// Internet Archive items as a notes source: documents open from the download, with no Recent entry.
const archive = archiveBrowser({
  library,
  queue: downloadQueue,
  exportRequest,
  open: async (file, entry) => {
    const opened = await openChosen(file);
    exportRequested(`archive:${entry?.id}:${entry?.path || file.name}`, opened).catch((error) => status(error.message, true));
    if (opened) { notePath = ""; noteEntryKey = ""; }
    return opened;
  },
});
var home = homeScreen({
  library,
  drive,
  archive,
  versions,
  open: openFromLibrary,
  openLink: (entry) => openWeb(webMember(entry.url, entry.name)),
  groups,
  status,
  exportStudy: exportStudyOf,
  cutHistory: cutHistoryOf,
  exportNote: exportNoteOf,
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
const groupList = groupPanel({
  root: $("groupPanel"), name: $("groupName"), list: $("groupList"), add: $("groupAdd"), groups, open: openMember, status, onChange: () => syncSideButtons(),
  // The pen on a file of this computer renames it on disk.
  rename: (member, name) => renameLocal(member, name),
  canRename: (member) => member.source === "local" && !!window.notecompleteFiles?.renameOpened,
  // × (after the row asks): the file goes to the system trash.
  trash: (member) => trashLocal(member),
});
// The file goes to the trash; it leaves Recent, its groups and stars. The open one closes.
async function trashLocal(member) {
  await window.notecompleteFiles.trashOpened(member.path);
  await library.forget(member.key);
  await groups.forget(member.key);
  if (docMember?.key === member.key) {
    dirty = changed = false;
    docMember = null;
    reset();
  } else await groupList.render();
  status(`${member.name} moved to the trash.`);
}
// Renames the file on disk; Recent, its folder, its star and the open document follow.
async function renameLocal(member, name) {
  const path = await window.notecompleteFiles.renameOpened(member.path, name);
  const newName = path.split(/[\\/]/).pop(), moved = localMember(path, newName);
  await library.moveLocal(member.path, path, newName);
  await groups.renamed(member.key, moved);
  // MD on/off is remembered per file name.
  try { const md = localStorage.getItem(`notecomplete-text-md:${member.name}`); if (md !== null) localStorage.setItem(`notecomplete-text-md:${newName}`, md); } catch { /* Optional. */ }
  if (docMember?.key === member.key) {
    if (notePath === member.path) notePath = path;
    if (textView.hasDocument) {
      const title = newName.replace(/\.[^.]+$/, "") || newName;
      textView.rename(title, newName);
      $("title").textContent = title;
      document.title = `${title} — NoteComplete`;
      tabBar.update({ title, dirty: dirty && changed });
    }
    await setDocMember(moved);
  } else await groupList.render();
  status(`Renamed to ${newName}.`);
}
// The sidebar button of HTML and text documents shows or hides the group list, like Pages in notes.
let sideListOpen = true;
try { sideListOpen = localStorage.getItem("notecomplete-group-list") !== "hidden"; } catch { /* Optional. */ }
function syncSideButtons() {
  const grouped = Boolean(groupList.group);
  for (const id of ["htmlSide", "textSide", "webSide"]) {
    $(id).disabled = !grouped;
    $(id).setAttribute("aria-expanded", String(grouped && sideListOpen));
    $(id).title = !grouped ? "Documents: File → Add documents… groups files to jump between" : sideListOpen ? "Hide the documents in this group" : "Show the documents in this group";
  }
  for (const body of document.querySelectorAll(".side-body")) body.classList.toggle("group-off", !sideListOpen);
}
$("htmlSide").onclick = $("textSide").onclick = $("webSide").onclick = () => {
  sideListOpen = !sideListOpen;
  try { localStorage.setItem("notecomplete-group-list", sideListOpen ? "" : "hidden"); } catch { /* Optional. */ }
  syncSideButtons();
};
let docMember = null;
function setDocMember(member) {
  docMember = member;
  // A Markdown file's pictures sit beside it: show them now that its place is known.
  if (textView.hasDocument && !converted && /!\[[^\]]*\]\(/.test(textView.text)) textView.rerender();
  groupList.mount(htmlView.hasDocument ? $("htmlGroupSlot") : textView.hasDocument ? $("textGroupSlot") : webView.hasDocument ? $("webGroupSlot") : $("pagesGroupSlot"));
  $("addDocuments").disabled = !member;
  // Opening a document of a folder brings that folder to the front of Home's Folders.
  return groupList.set(member).then(() => groupList.group && groups.touch(groupList.group)).catch(() => {});
}
async function openMember(member) {
  if (member.source === "web") return openWeb(member);
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
  $("openFolder").hidden = $("addDocuments").hidden = $("emptyOpenFolder").hidden = false;
  $("emptyOpenFolder").onclick = () => $("openFolder").click();
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
// The quiz and Ask AI windows live in the page editor; a text document, which can be
// studied too, takes them while it is shown (text-study.js).
function studyPanelsTo(text) {
  document.body.classList.toggle("study-text", text);
  const host = text ? $("textView").querySelector(".side-body") : $("audioBar").parentElement;
  const after = text ? null : $("audioBar");
  for (const id of ["quizPanel", "chatPanel"]) {
    const panel = $(id);
    if (panel.parentElement === host) continue;
    if (after) after.after(panel); else host.append(panel);
  }
  if (!text) $("quizPanel").after($("chatPanel"));
  const page = text ? "Section" : "Page";
  $("practiceAskPage").textContent = page;
  $("practiceAskPage").title = text ? "The card's section of the document, as text" : "The card's page as an image, with its text";
  for (const chip of document.querySelectorAll('.practice-ask-material [data-material="page"]:not(#practiceAskPage)')) chip.textContent = text ? "Section" : "Region";
}
// The Notes panel sits beside the pages, or beside an HTML page or a text document while one is shown.
function notesPanelTo(side) {
  const view = side === htmlView ? $("htmlView") : side === textView ? $("textView") : null;
  const panel = $("notesPanel"), host = view ? view.querySelector(".side-body") : $("layersPanel").parentElement;
  if (panel.parentElement === host) return;
  if (view) host.append(panel); else $("layersPanel").before(panel);
}
function showDocument() {
  home.hide();
  const side = sideView();
  studyPanelsTo(side === textView);
  notesPanelTo(side);
  if (side) {
    $("editor").hidden = true;
    side.show();
  } else {
    $("htmlView").hidden = true;
    $("textView").hidden = true;
    $("webView").hidden = true;
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
  $("findOpen").disabled = !open && !textView.hasDocument;
  for (const id of ["save", "native", "nativeMarkdown", "exportProject", "exportNotecomplete", "exportPdf", "exportImage", "importImage", "gotoPage", "ocrOpen", "insertBlank", "insertPdf", "insertHandwritten", "insertGraph", "insertTable", "resizePage", "resizeDrag", "tapeReveal", "tapeCover", "tapeNote"])
    if ($(id)) $(id).disabled = !open;
  // Noteful has no infinite page: a canvas exports to .notecomp only.
  for (const id of ["native", "nativeMarkdown"]) {
    $(id).dataset.title ??= $(id).title;
    $(id).disabled ||= !!doc?.canvas;
    $(id).title = doc?.canvas ? "An infinite canvas cannot be a .noteful file; export it as NoteComplete (.notecomp)" : $(id).dataset.title;
  }
  // A canvas is one page that grows: no inserted pages.
  for (const id of ["insertBlank", "insertPdf", "insertHandwritten"]) if ($(id)) $(id).disabled ||= !!doc?.canvas;
  // Study works on notes and on text documents.
  for (const id of ["studyCards", "studyQuiz", "studyCheck", "studyResume", "studyRetake", "studyOpenDeck", "studyExportQuiz", "exportStudy", "scratchOpen", "chatOpen", "chatToggle"])
    if ($(id)) $(id).disabled = !open && !studyText();
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
async function findItemsInGrab(p, rect) {
  if (!p?.render || !p.el) return [];
  const [gx, gy, gw, gh] = rect;
  // Boxes on screen, mapped to page units: getBBox() ignores the transforms of the page's
  // own groups (imported ink sits in scaled groups), so most items looked elsewhere.
  const pr = p.el.getBoundingClientRect();
  if (!pr.width || !pr.height) return [];
  const sx = p.size[0] / pr.width, sy = p.size[1] / pr.height;
  const seen = new Set(), found = [];
  for (const el of p.render.querySelectorAll("[data-item]")) {
    const id = el.getAttribute("data-item");
    // Nested items belong to the outermost one.
    if (!id || seen.has(id) || el.parentElement?.closest("[data-item]")) continue;
    const er = el.getBoundingClientRect();
    if (!er.width && !er.height) continue;
    const box = { x: (er.left - pr.left) * sx, y: (er.top - pr.top) * sy, width: er.width * sx, height: er.height * sy };
    const overlapX = Math.min(gx + gw, box.x + box.width) - Math.max(gx, box.x);
    const overlapY = Math.min(gy + gh, box.y + box.height) - Math.max(gy, box.y);
    if (overlapX >= 0 && overlapY >= 0) { seen.add(id); found.push({ id, el, bbox: box }); }
  }
  const matches = [];
  for (const { id, el, bbox } of found) {
    try {
      const info = await call("selection", { page: p.index, itemId: id });
      if (info) matches.push({ ...info, el, bbox });
    } catch {}
  }
  return matches;
}
async function selectGrab(targetGrab = grabbed) {
  if (!targetGrab) return;
  const currentGrab = targetGrab;
  clearGrab();

  const p = panels[currentGrab.page];
  const [gx, gy, gw, gh] = currentGrab.rect;

  if (tool !== "select") {
    const selectButton = document.querySelector('#toolbar [data-tool="select"]');
    selectButton?.click();
  }

  const members = await findItemsInGrab(p, currentGrab.rect);
  if (members.length > 0) {
    if (members.length === 1) {
      await selection.selectId(currentGrab.page, members[0].id);
      status("Selected element. Drag to move, or drag handles to resize.");
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const m of members) {
        const b = m.bbox || m.bounds;
        if (b) {
          minX = Math.min(minX, b.x ?? b[0]);
          minY = Math.min(minY, b.y ?? b[1]);
          maxX = Math.max(maxX, (b.x ?? b[0]) + (b.width ?? b[2]));
          maxY = Math.max(maxY, (b.y ?? b[1]) + (b.height ?? b[3]));
        }
      }
      const bounds = isFinite(minX) ? [minX, minY, maxX - minX, maxY - minY] : currentGrab.rect;
      selection.selectGroup(currentGrab.page, members.map(({ el, ...m }) => m), bounds);
      status(`Selected ${members.length} elements as a group. Drag to move or resize.`);
    }
    return;
  }

  try {
    status("Converting grab to editable selection…");
    const { canvas, scale } = await pageCanvas(currentGrab.page, 2200, { liftTape: true });
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, Math.round(gw * scale));
    crop.height = Math.max(1, Math.round(gh * scale));
    crop.getContext("2d").drawImage(canvas, gx * scale, gy * scale, crop.width, crop.height, 0, 0, crop.width, crop.height);
    canvas.width = canvas.height = 0;
    const dataUrl = crop.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];

    const image = {
      base64,
      mime: "image/png",
      bounds: [gx, gy, gw, gh],
      layer: activeLayer,
    };
    const result = await mutate("image", { page: currentGrab.page, image });
    dirty = changed = true;
    revision++;
    p.edits = pageEdits(p) + 1;
    doc = result;
    updateTools(result);
    savedState();
    await renderPage(p, result);

    await selection.selectId(currentGrab.page, `image:${doc.edit_count - 1}`);
    status("Grab selected. Drag to move, or drag handles to resize.");
  } catch (err) {
    status("Could not select grab: " + err.message, true);
  }
}
$("grabSelect").onclick = () => selectGrab();
// Erase: the eraser swept through the whole region (regionSweep), in one undo step.
$("grabErase").onclick = async () => {
  if (!grabbed) return;
  const { page, rect } = grabbed;
  clearGrab();
  await action("erase", { page, ...regionSweep(rect) });
};
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
let tapeAllLifted = false;
$("tapeReveal").onclick = () => { tapeAllLifted = true; setTapeMode("revealed"); };
$("tapeCover").onclick = () => { tapeAllLifted = false; setTapeMode("covered"); };
$("tapeNote").onclick = () => setTapeMode("note");
$("findOpen").onclick = () => { showDocument(); if (!doc && textView.hasDocument) textFinder.open(); else find.open(); };
$("ocrOpen").onclick = () => find.openOcr(page);
// Inserted pages (or undoing them) change the page list: rebuild it and stay on `focus`.
function restructure(result, focus, message) {
  observer?.disconnect();
  thumbnailObserver?.disconnect();
  selection.clear();
  // The old pages go as pages leaving the view do: their PDF rasters back to the cache, for the
  // new pages to take, and no drawing of theirs still on its way.
  for (const p of panels) {
    p.token++;
    p.near = false;
    placeholder(p);
  }
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
// The chosen size for a page (its view): presets that add space, and Original, are
// relative to that page's own original size.
function resizeTarget(view = panels[page]?.view) {
  const base = view?.base_size || view?.size;
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
// The new size of a page (its view) and, with "Scale the PDF", where its PDF goes; null if invalid.
function resizeChoice(view) {
  // Whole units (exact in the project file); the original size is kept as it was.
  const size = $("resizePreset").value === "original" ? resizeTarget(view) : resizeTarget(view).map((v) => Math.round(v));
  if (!view || size.some((v) => !Number.isFinite(v) || v < 10)) return null;
  let pdfRect;
  if (view.pdf_background && $("resizeFit").checked) {
    // The PDF fills the page as far as its own proportions allow, centred.
    const [, , w, h] = view.pdf_background.rect, scale = Math.min(size[0] / w, size[1] / h);
    pdfRect = [(size[0] - w * scale) / 2, (size[1] - h * scale) / 2, w * scale, h * scale];
  }
  return { size, pdfRect };
}
$("resizeConfirm").onclick = () => {
  const choice = resizeChoice(panels[page]?.view);
  if (!choice) return status("Choose a valid size.", true);
  $("resizeDialog").close();
  action("resizePage", { page, ...choice, focus: page });
};
// The same choice for every page, as one undo step. Space added and Original follow each
// page's own original size; a PDF is scaled to fill only if that is ticked.
$("resizeAll").onclick = async () => {
  if (!doc || busy()) return;
  const count = doc.pages;
  $("resizeDialog").close();
  status(`Resizing ${count} pages…`);
  const pages = [];
  for (let i = 0; i < count; i++) {
    const view = await call("view", { page: i });
    const choice = resizeChoice(view);
    if (!choice) return status(`Page ${i + 1} cannot take that size. Choose another.`, true);
    if (choice.size[0] !== view.size[0] || choice.size[1] !== view.size[1] || choice.pdfRect) pages.push({ page: i, ...choice });
  }
  if (!pages.length) return status("Every page already has that size.");
  action("resizePages", { pages, focus: page });
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
// Graphs and tables (graph.js, table.js, compound-dialogs.js): drawn as ordinary items, parts
// of one object (part.rs) so that any of it selects all of it and its editor brings back
// what it is. Insert → Graph or Table, a box dragged with the Shapes tool's Graph or Table,
// or the math keypad's graph key; Edit graph / Edit table on the selected object.
const COMPOUND_SIZE = { graph: [420, 300], table: [360, 132] };
const compoundId = (kind) => `${kind[0]}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const penStyle = () => { const pen = { ...TOOL_DEFAULTS.draw, ...toolPrefs.draw }; return { rgba: [...rgbaOf(pen.color).slice(0, 3), 1], width: Number(pen.width) || 2 }; };
function compoundItems(kind, box, spec, id = compoundId(kind)) {
  return kind === "graph" ? graphItems(box, spec, { ...penStyle(), layer: activeLayer, id }) : tableItems(box, spec, { layer: activeLayer, id });
}
// A box on the page for a new graph or table: centred on `at` (or the middle of the view),
// inside the page with room for a graph's axis names past its edges.
function compoundBox(p, kind, box = null) {
  if (box && box[2] >= 40 && box[3] >= 30) return box;
  const [w, h] = [Math.min(COMPOUND_SIZE[kind][0], p.size[0] - 60), COMPOUND_SIZE[kind][1]];
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
async function insertCompound(p, kind, box = null, spec = {}) {
  if (!doc || !p) return false;
  const layer = doc.layers.find((l) => l.id === activeLayer);
  if (!layer?.visible || layer.locked) return status("Select a visible, unlocked layer first.", true), false;
  const chosen = kind === "graph" ? await editGraph({ spec, rgba: penStyle().rgba, keypad: mathKeys }) : await editTable({ spec });
  if (!chosen) return false;
  let items;
  try { items = compoundItems(kind, compoundBox(p, kind, box), chosen); } catch (e) { return status(e.message, true), false; }
  await action("drawMany", { page: p.index, lines: items.lines, images: items.images });
  status(`${kind === "graph" ? "Graph" : "Table"} inserted. Select it to move it, resize it or edit it again; one undo removes it.`);
  return true;
}
$("insertGraph").onclick = () => doc && insertCompound(panels[page], "graph");
$("insertTable").onclick = () => doc && insertCompound(panels[page], "table");
// The box a graph or table has now: its frame's (moved or resized since it was drawn).
async function compoundFrame(item) {
  const c = item.compound, info = await call("selection", { page: item.page, itemId: c.frame });
  const [x, y, w, h] = info.bounds, a = info.adjustment, pad = info.base_width / 2;
  const cw = (w - 2 * pad) * a.scale[0], ch = (h - 2 * pad) * a.scale[1], cx = x + w / 2 + a.translation[0], cy = y + h / 2 + a.translation[1];
  return [cx - cw / 2, cy - ch / 2, cw, ch];
}
// Edit graph / Edit table: its editor with what it is, then drawn again where it is now.
async function editCompound(item) {
  const c = item?.compound;
  if (!c || !doc) return;
  let spec = {};
  try { spec = JSON.parse(c.spec || "{}"); } catch { /* Drawn again from the defaults. */ }
  const chosen = c.kind === "graph" ? await editGraph({ spec, editing: true, rgba: penStyle().rgba, keypad: mathKeys }) : await editTable({ spec, editing: true });
  if (!chosen) return;
  let items;
  try { items = compoundItems(c.kind, await compoundFrame(item), chosen, c.id); } catch (e) { return status(e.message, true); }
  selection.clear();
  await action("drawMany", { page: item.page, replace: c.items, lines: items.lines, images: items.images });
  status(`${c.kind === "graph" ? "Graph" : "Table"} changed. One undo brings back the one before.`);
}
// Any part picked selects the whole graph or table: a group of its parts, with what it is.
async function pickWhole(args) {
  const item = await call("pick", args);
  const parts = item && panels[args.page]?.view?.parts;
  const part = parts?.find((q) => q.item === item.id);
  if (!part) return item;
  const own = parts.filter((q) => q.id === part.id), frame = own.find((q) => q.spec);
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
// The keypad's graph key in a text box: the graph editor with the box's function; the graph
// goes under the box, which is kept.
async function graphFromBox(value) {
  const t = textEditor;
  if (!t) return;
  const tex = value.trim(), [, h] = tex ? await boxSize(tex, t.style) : [0, 0];
  const p = t.p, at = [t.bx, t.by + h + 24, 0, 0];
  if (tex) await commitText(); else closeText();
  await insertCompound(p, "graph", at, { functions: tex ? [tex] : [] });
}
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
async function pageCanvas(index, width = 2200, { liftTape = false, inkOnly = false, bold = false } = {}) {
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
    // Thicker strokes for one OCR pass: thin pen lines break into pieces the engine misreads.
    if (bold) for (const mark of holder.querySelectorAll("[data-item] :is(path, polyline, line, ellipse, rect, polygon)")) {
      if (mark.getAttribute("fill") && mark.getAttribute("fill") !== "none") {
        mark.setAttribute("stroke", "#000");
        mark.setAttribute("stroke-width", "0.7");
        mark.setAttribute("stroke-linejoin", "round");
      } else if (mark.getAttribute("stroke-width")) mark.setAttribute("stroke-width", String(Number(mark.getAttribute("stroke-width")) * 1.6 || 1));
    }
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
// The desktop AI tools and/or the model in this app (WebLLM, where WebGPU exists).
const ai = sharedAI();
// Scratchpad: AI conversations kept per note (View → Scratchpad…).
const scratch = scratchpad({
  store: library.store,
  key: () => (doc ? `scratch:${find.fingerprint || doc.title || "note"}` : studyText() && sideFp ? `scratch:${sideFp}` : ""),
  canNote: () => !!doc || htmlView.hasDocument,
  markdown: (text) => call("markdownHtml", { text }),
  status,
  notes: async (text) => (await notesApi()).append(text),
});
$("scratchOpen").onclick = () => { for (const m of document.querySelectorAll("details.menu")) m.open = false; scratch.open(); };
// Text documents are studied by sections (text-study.js): no page images, no PDF or MCP.
const textSource = textStudy({ body: $("textBody"), text: () => textView.text });
const studyFp = () => (studyText() ? sideFp : find.fingerprint);
const studyDeps = {
  keep: (entry) => scratch.keep(entry),
  ai,
  pageCanvas: (p, width, options) => (studyText() ? Promise.resolve(null) : pageCanvas(p, width, options)),
  // `options.recognize`: small-model mode reads a page's handwriting first (find.js).
  pageText: async (p, options) => (studyText() ? textSource.sectionText(p) : find.pageText(p, options)),
  pageWords: async (p) => (studyText() ? null : find.pageWords(p)),
  documentInfo: () => (studyText() ? { pages: textSource.count, title: textView.name || "Document", unit: "section" } : { pages: doc?.pages || 0, title: doc?.title || "Note", unit: "page" }),
  currentPage: () => (studyText() ? textSource.current() : page),
  notePath: () => (studyText() ? "" : notePath),
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
const chat = chatController({ ...studyDeps, selection, selectedText: () => textSource.selected(), providers: () => ai.providers(), markdown: (text) => call("markdownHtml", { text }), toTextBox: answerToTextBox });
const jobs = jobChip({ status });
audio.transcript.jobs = jobs;
// The scissors in the audio panel: only the text of a chosen segment (audio-trim.js).
const trim = audioTrim({ audio, status, toNotes: async (text) => (await notesApi()).append(text), toTextBox: (text) => answerToTextBox(text) });
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
  pagePdf: (index) => (studyText() ? Promise.resolve(null) : pagePdfOf(index)),
  library,
  key: () => `quizzes:${studyFp() || doc?.title || textView.name || "note"}`,
  jump: (p, quote) => { showDocument(); if (studyText()) textSource.jump(p, quote); else jump(p); },
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
    const { text } = await runAI(ai, { provider, images, notePath, tag: "check", prompt: `A student disputes a quiz question about their notes${image ? " (the attached image is the region of the notes the quiz cites)" : ""}. Using the notes, decide which option is correct, or say that none is. Write in the question's language.\nQuestion: ${q.question}\n${q.options.map((o, i) => `${i}: ${o}`).join("\n")}\nReply with ONLY JSON: {"answer": <index of the correct option, or null>, "reason": "two or three sentences that cite the notes"}` }, null, { small: smallSetting(provider, { ai }), vision: ai.capabilities?.(provider, "")?.vision !== false });
    const value = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { answer: Number.isInteger(value.answer) ? value.answer : null, reason: String(value.reason || "") };
  },
});
const study = studyController({
  ...studyDeps,
  growWindow: () => practiceWindow?.fit(),
  continueInChat,
  library,
  fingerprint: studyFp,
  jump: (p) => { showDocument(); if (studyText()) textSource.jump(p); else jump(p); },
  download,
  jobs,
  quizzes,
  markdown: (text) => call("markdownHtml", { text }),
  pagePdf: (index) => (studyText() ? Promise.resolve(null) : pagePdfOf(index)),
  // Fact check: findings go into the Markdown notes; "Open notes" shows them.
  appendNotes: async (markdown) => (await notesApi()).append(markdown),
  showNotes: async () => { const api = await notesApi(); if (!api.visible) notesButton().click(); },
  openNotes: async () => { const api = await notesApi(); if (!api.visible) notesButton().click(); api.scrollToIndex?.(api.text.length); },
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
  currentFingerprint: () => (doc && !$("editor").hidden ? find.fingerprint : studyText() && textView.visible ? sideFp : ""),
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
// The desktop app's updater, or the Android app's (it says its version: App.js).
updateNotice({ status, bridge: globalThis.notecompleteUpdates || (globalThis.notecompleteApp?.platform === "android" ? androidUpdates({ app: globalThis.notecompleteApp }) : undefined) });
// Mic buttons in the Ask AI fields: speak the question, edit it, send it.
const dictate = dictation({ status });
dictate.attach($("chatInput"), $("chatSend"));
dictate.attach($("practiceAskInput"), $("practiceAskForm").querySelector('button[type="submit"]'));
{ const box = $("quizExplainBox").querySelector(".practice-ask-form"); if (box) dictate.attach(box.querySelector("input"), box.querySelector('button[type="submit"]')); }
$("studyAllQuizzes").onclick = () => { for (const m of document.querySelectorAll("details.menu")) m.open = false; quizIndex.open(); };
// Help > Connect AI tools (desktop): the bundled note server for the user's own agents,
// offered once by itself a few seconds after start.
const agents = agentConnector({ status });
if (agents) {
  $("agentsOpen").hidden = false;
  $("agentsOpen").onclick = () => { closeMenus(); agents.open(); };
  setTimeout(() => { if (!document.querySelector("dialog[open]")) agents.offer().catch(() => {}); }, 4000);
}
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
// View → Pen button…: learns what this pen's side button sends in this browser
// (pen-button.js profileFrom), plus the opt-in long-press and an off switch.
let penSetupRun = 0, penSetupFound = null;
function openPenSetup() {
  closeMenus();
  penSetupFound = null;
  $("penSetupResult").textContent = penProfile?.v ? describeProfile(penProfile) : "";
  $("penSetupLongPress").checked = !!penProfile?.longPress;
  $("penSetupOff").checked = !!penProfile?.off;
  $("penSetupStart").textContent = "Start";
  $("penSetupDialog").showModal();
}
$("penSetupOpen").onclick = openPenSetup;
$("penSetupClose").onclick = () => { penSetupRun++; $("penSetupDialog").close(); };
$("penSetupDialog").addEventListener("close", () => { penSetupRun++; });
$("penSetupStart").onclick = async () => {
  const run = ++penSetupRun, pad = $("penSetupPad"), step = $("penSetupStep");
  const seen = { hover: [], taps: [], keys: [] };
  let phase = "baseline";
  const wait = (ms, until = () => false) => new Promise((done) => {
    const started = Date.now();
    const tick = () => (run !== penSetupRun || until() || Date.now() - started > ms ? done() : setTimeout(tick, 50));
    tick();
  });
  // Hovering means no pointerdown since the last pointerup (Android reports the button as
  // buttons 1 while hovering, the same as a touching tip).
  let touching = false;
  const down = (e) => { if (e.pointerType === "pen") touching = true; };
  const up = (e) => { if (e.pointerType === "pen") touching = false; };
  // Presses as the app will see them: a hover rising edge, or an entry with the button held.
  const probe = penButtonDetector();
  seen.presses = [];
  // What the pen sends, live, so a step that seems to do nothing says why.
  const live = (e, type) => {
    if (phase === "baseline" || phase === "press") $("penSetupResult").textContent = `Pen ${type === "pointerleave" ? "out of range" : touching ? "touching" : "hovering"} · buttons ${e.buttons} · presses seen: ${seen.presses.length}`;
  };
  const feed = (e, type = e.type) => {
    if (e.pointerType !== "pen") return;
    if (probe.pointer({ ...fields(e), type }) === "menu" && phase === "press") seen.presses.push({ buttons: e.buttons });
    live(e, type);
  };
  const move = (e) => {
    if (e.pointerType === "pen" && !touching) seen.hover.push({ phase, buttons: e.buttons, pressure: e.pressure });
    feed(e);
  };
  const over = (e) => { if (!e.relatedTarget || !pad.contains(e.relatedTarget)) feed(e); };
  const out = (e) => { if (!e.relatedTarget || !pad.contains(e.relatedTarget)) feed(e, "pointerleave"); };
  const menu = (e) => { e.preventDefault(); window.getSelection()?.removeAllRanges(); seen.taps.push({ phase, pointerType: e.pointerType || "", button: e.button }); };
  const key = (e) => seen.keys.push({ phase, key: e.key, code: e.code });
  pad.addEventListener("pointermove", move);
  pad.addEventListener("pointerover", over);
  pad.addEventListener("pointerout", out);
  pad.addEventListener("pointerdown", down);
  addEventListener("pointerup", up, true);
  addEventListener("pointercancel", up, true);
  pad.addEventListener("contextmenu", menu);
  addEventListener("keydown", key, true);
  try {
    $("penSetupStart").textContent = "Try again";
    $("penSetupResult").textContent = "";
    step.textContent = "1 of 3 · Hold your pen just above the box, without touching it.";
    await wait(2500);
    phase = "press";
    step.textContent = "2 of 3 · Press the side button while hovering, twice. If nothing happens, hold the button, lift the pen away and bring it back over the box.";
    const presses = () => seen.presses.length;
    await wait(6000, () => presses() >= 2);
    await wait(400);
    phase = "tap";
    step.textContent = "3 of 3 · Hold the side button and tap the box once.";
    await wait(6000, () => seen.taps.some((t) => t.phase === "tap"));
    if (run !== penSetupRun) return;
    penSetupFound = profileFrom({ hover: seen.hover, presses: seen.presses, taps: seen.taps.filter((t) => t.phase === "tap"), keys: seen.keys.filter((k) => k.phase !== "baseline") }, navigator.userAgent);
    step.textContent = "Done. Save to use it, or Try again.";
    $("penSetupResult").textContent = describeProfile(penSetupFound);
  } finally {
    pad.removeEventListener("pointermove", move);
    pad.removeEventListener("pointerover", over);
    pad.removeEventListener("pointerout", out);
    pad.removeEventListener("pointerdown", down);
    removeEventListener("pointerup", up, true);
    removeEventListener("pointercancel", up, true);
    pad.removeEventListener("contextmenu", menu);
    removeEventListener("keydown", key, true);
  }
};
$("penSetupSave").onclick = () => {
  const profile = { ...(penSetupFound || penProfile || { v: 1 }), v: 1, longPress: $("penSetupLongPress").checked, off: $("penSetupOff").checked };
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* Kept for this session only. */ }
  penProfile = profile;
  $("penSetupDialog").close();
  status(profile.off ? "Pen button off." : "Pen button saved.");
};
// Help → Test pen and stylus: what the browser reports for a pen (its type, buttons and
// pressure), so a pen button that does not open the quick menu can be told apart.
{
  const pad = $("penTestPad"), log = $("penTestLog"), lines = [];
  const note = (text) => {
    if (lines.at(-1)?.text === text) { lines.at(-1).count++; } else lines.push({ text, count: 1 });
    while (lines.length > 14) lines.shift();
    log.replaceChildren(...lines.map((l) => { const li = document.createElement("li"); li.textContent = l.count > 1 ? `${l.text} ×${l.count}` : l.text; return li; }));
  };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout"])
    pad.addEventListener(type, (e) => {
      // Entering and leaving between the box's own children are not the pen coming or going.
      if ((type === "pointerover" || type === "pointerout") && e.relatedTarget && pad.contains(e.relatedTarget)) return;
      e.preventDefault();
      note(`${type} · ${e.pointerType} · button ${e.button} · buttons ${e.buttons} · pressure ${e.pressure.toFixed(2)}${e.shiftKey ? " · Shift" : ""}`);
    });
  pad.addEventListener("contextmenu", (e) => { e.preventDefault(); note(`contextmenu · ${e.pointerType || "?"} · button ${e.button}`); });
  pad.addEventListener("touchstart", (e) => note(`touchstart · ${[...e.changedTouches].map((t) => t.touchType || "direct").join(", ")}`), { passive: true });
  $("penTestDialog").addEventListener("keydown", (e) => { if (e.key !== "Escape") note(`key · ${e.key} (${e.code})`); });
  $("penTestOpen").onclick = () => { closeMenus(); lines.length = 0; log.replaceChildren(); $("penTestDialog").showModal(); };
  $("penTestClose").onclick = () => $("penTestDialog").close();
  $("penTestSetup").onclick = () => { $("penTestDialog").close(); openPenSetup(); };
  $("penTestCopy").onclick = () => navigator.clipboard.writeText(lines.map((l) => l.text + (l.count > 1 ? ` ×${l.count}` : "")).join("\n")).then(() => status("Copied."), () => status("Select the lines and copy them.", true));
}
$("studyCards").onclick = () => study.cards();
$("studyQuiz").onclick = () => study.quiz();
$("studyCheck").onclick = () => study.check();
$("studyOpenDeck").onclick = () => study.saved();
$("chatOpen").onclick = $("chatToggle").onclick = () => { if (doc || studyText()) { showDocument(); chat.toggle(); } };
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

// Sharing (docs/COLLABORATION.md): Markdown notes with guests, and phones or tablets as
// drawing surfaces. Nothing of it loads until a session starts or an invite is opened.
let collabLoading = null;
const collabHost = {
  call, applyShared, status, jump, cancelGesture, pinchBy, penActive, setZoom, notesApi, download, library,
  get ready() { return ready; },
  get busy() { return busy() || !!gesture; },
  get doc() { return doc; },
  get page() { return page; },
  get panels() { return panels; },
  get tool() { return tool; },
  get fingerprint() { return (doc && find.fingerprint) || sideFp; },
  get kind() { return doc ? "note" : sideView() ? "side" : null; },
  title: () => $("title").textContent,
  // The open note's study material (decks, quizzes, notes), and keeping a pack sent by another NoteComplete.
  async studyMaterial() {
    let fingerprint = (doc && find.fingerprint) || sideFp, title = $("title").textContent;
    const { studyOf } = await import("./study-pack.js");
    // With no note open (a QR link opened this page): the newest note on this device that has study material.
    if (!fingerprint) {
      const docs = [];
      for (const key of (await library.store.keys("settings").catch(() => [])).filter((k) => String(k).startsWith("doc:"))) docs.push([key.slice(4), await library.store.get("settings", key).catch(() => null)]);
      for (const [fp, record] of docs.sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))) {
        if (Object.keys(await studyOf(library.store, fp)).length) { fingerprint = fp; title = record?.title || "Study material"; break; }
      }
      if (!fingerprint) return null;
    }
    await notes?.flush?.();
    return { title, fingerprint, study: await studyOf(library.store, fingerprint) };
  },
  importStudyFile: () => $("studyPackFile").click(),
  async importStudyPack(pack) { const { importPack } = await import("./study-pack.js"); return importPack(library.store, pack); },
  // The open text document (.txt, Markdown, a converted file), as shared with guests.
  textDocument: () => (!doc && textView.hasDocument ? { name: textView.key || textView.name, markdown: textView.markdown, content: textView.text } : null),
  get sharedText() { return sharedText; },
  // A guest's copy of the host's text document: read-only, and it follows the host's edits.
  async openSharedText({ name, markdown, content }) {
    if (sharedText && textView.hasDocument && textView.key === name) return textView.setText(content);
    reset({ opening: true });
    $("editor").hidden = true;
    await load(new File([content], name, { type: "text/plain" }), { kind: "text", title: name.replace(/\.[^.]+$/, ""), text: content, markdown, bytes: new ArrayBuffer(0) });
    sharedText = true;
    $("textEdit").hidden = $("textSave").hidden = true;
  },
  setCollab(value) { collab = value; },
  setTool(name) { document.querySelector(`[data-tool="${name}"]`)?.click(); },
  // A drawing tablet's New page: a blank page after the one in view, the same size.
  addPage: () => addBlankPage(page),
  // A tool's colours, as in its quick menu (the tablet's dock shows the tape's).
  palette: (name) => [...(palettes[name] || [])],
  // A tablet's copy of the computer's note: opened like a project, never kept in Recent.
  async openProject(project, title) {
    cancelGesture();
    await load(new File([project], `${(title || "Shared note").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}.nfedit`, { type: "application/json" }));
    dirty = changed = false;
    savedState();
  },
  closeDocument: () => reset(),
  openFile: (file) => load(file),
  // Auto-save in a session: the host's switch, followed by everyone else.
  autosaveOn: () => autosavePref,
  setSharedAutosave(on) { sharedAutosave = !!on; autosaveSwitch(); },
  // A copy of the shared note before it closes (a guest or tablet losing the session).
  async keepCopy() {
    const slot = await autosaveNow({ force: true });
    sharedAutosave = null;
    autosaveSwitch();
    return slot && { ...slot, open: () => openAutosave(slot), label: when(slot.time) };
  },
};
async function startCollab(mode) {
  try {
    const { openCollab } = await (collabLoading ||= import("./collab.js"));
    await openCollab(collabHost, mode);
  } catch (e) {
    collabLoading = null;
    status(e.message, true);
  }
}
$("studyShare").onclick = async () => {
  closeMenus();
  try { const { openStudyShare } = await (collabLoading ||= import("./collab.js")); await openStudyShare(collabHost); } catch (e) { collabLoading = null; status(e.message, true); }
};
$("studyPackFile").onchange = async () => {
  const [file] = $("studyPackFile").files;
  $("studyPackFile").value = "";
  if (!file) return;
  try {
    const { readPack, importPack, describePack } = await import("./study-pack.js");
    if (file.size > 24 * 1024 * 1024) throw Error("That file is too large to be study material.");
    const pack = readPack(await file.text());
    const { merged } = await importPack(library.store, pack);
    status(`Imported ${describePack(pack)}${merged ? ` into “${pack.title}”` : `: kept as “${pack.title}${pack.from ? ` (from ${pack.from})` : ""}” in Study → All quizzes and decks`}.`);
  } catch (e) { status(e.message, true); }
};
$("shareSession").hidden = !window.notecompleteCollab;
$("shareSession").onclick = () => startCollab("host");
$("joinTablet").onclick = () => startCollab("join-tablet");
$("joinNotes").onclick = () => startCollab("join-notes");
// Share in the bar: the desktop shares (or shows its session); elsewhere it offers the ways to join.
$("shareButton").onclick = () => startCollab(window.notecompleteCollab ? "host" : "share-menu");
// Opened from an invite (/join#… or /tablet#…, served by the host's computer).
if (/^\/(join|tablet|send)$/.test(location.pathname) && location.hash.length > 1) startCollab("link");
