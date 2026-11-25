import { touchGestures, palmPointer } from "./touch.js";
import { followPoint, smoothStroke, pressureRadii, runOutline, nextPressureBase } from "./stroke-smoothing.js";
import { textLines, selectedText } from "./text-layer.js";
import { readingOrder, nearestWord, bandsFor, bandLine, distanceTo } from "./text-highlight.js";
import { momentum, VelocityTracker } from "./momentum.js";
import { fractionalScroller } from "./smooth-scroll.js";
import {
  prepareDocument,
  readImage,
  imageBounds,
  centredAt,
  fileKind,
} from "./media-import.js";
import { htmlViewer } from "./html-view.js";
import { textViewer, isMarkdownName, isDiagramName, zoomControl } from "./text-view.js";
import { isRScriptName, decodeText } from "./text-types.js";
import { textStudy } from "./text-study.js";
import { textFind } from "./text-find.js";
import { groupStore, groupPanel, localMember, webMember } from "./groups.js";
import { webViewer, normalizeLink, linkTitle } from "./web-view.js";
import { driveBrowser } from "./drive-browser.js";
import { dropboxBrowser } from "./dropbox-browser.js";
import { githubBrowser, webdavBrowser, setupCloudGuideDialog } from "./cloud-collab.js";
import { Library, entryTitle } from "./library.js";
import { homeScreen, shouldSkipCoverFile, isTinyCoverSize } from "./home.js";
import { isNotebookCover } from "./note-cover.js";
import { archiveBrowser } from "./archive-browser.js";
import { archiveView } from "./archive-view.js";
import { resizablePanels } from "./panel-resize.js";
import { installMarquee } from "./marquee.js";
import { archiveFormat, unsupportedMessage, readArchive, looksLikeGoodnotes, notebookTitle, notebooksIn, extractEntry, packFolder } from "./archive.js";
import { createDownloadQueue } from "./download-queue.js";
import { queueWindow } from "./queue-controls.js";
import { commandPalette } from "./command-palette.js";
import { findController, noteFingerprint } from "./find.js";
import { rememberFingerprint } from "./content-search.js";
import { studyController, ankiDecks, studyGroups } from "./study.js";
import { allQuizzes } from "./all-quizzes.js";
import { updateNotice } from "./updates.js";
import { scratchpad } from "./scratchpad.js";
import { dictation } from "./dictate.js";
import { installNativeHoverBridge } from "./native-hover.js";
import { chatController } from "./chat.js";
import { themeController } from "./theme.js";
import { setupWizard, autoOpen as autoOpenSetup, isPhoneOrTablet } from "./setup-wizard.js";
import { chooseOpener, setOpenSetupModules, setReopenWith, reopenWith, notInstalledMenu, moduleState } from "./open-with-ui.js";
import { euroOfficeMode, openOnceWith } from "./open-with.js";
import { officeModule, setOfficeOpener } from "./office-module.js";
import { officeViewer } from "./office-view.js";
import { sharedAI as setupAI } from "./local-ai.js";
import { getAiFile } from "./rich-text.js";
import { quizController } from "./quiz.js";
import { jobChip } from "./jobs.js";
import { floatingWindow } from "./floating.js";
import { pageExporter } from "./page-export.js";
import { versionChooser, carryStudy, mergeStudy } from "./versions.js";
import { receiveNativeFiles } from "./import.js";
import { SelectionController } from "./selection.js";
import { regionSweep, matrix as itemMatrix, point as mapPoint } from "./selection-geometry.js";
import { ChromeState, highlightPoints } from "./chrome-state.js";
import { download } from "./download.js";
import { lagLog } from "./lag-log.js";
import { imageReady } from "./image-ready.js";
import { chooseNfeditExport } from "./nfedit-export.js";
import { saveDocumentInPlace } from "./save-target.js";
import { welcomeWanted, setWelcomeWanted } from "./welcome-pref.js";
import { zipFiles } from "./zip.js";
import { enhanceSelects, refreshSelects } from "./select.js";
import { decorateIcons, icon } from "./icons.js";
import { qualitySettings } from "./quality.js";
import { PdfBackgrounds, backgroundPlacement, openPdf, copyCanvas } from "./pdf-background.js";
import { PRESETS, SPACE, insertAt, unitsToMm, mmToUnits } from "./insert-pages.js";
import { handwritingConverter } from "./convert.js";
import { examController } from "./exam.js";
import { batchNotesController } from "./batch-notes.js";
import { expandController } from "./expand.js";
import { agentConnector } from "./agents.js";
import { AudioController } from "./audio.js";
import { addedAudio, AUDIO_TYPES, clock } from "./recorder.js";
import { TranscriptController } from "./transcript.js";
import { AudioProcessing } from "./audio-processing.js";
import { Engine } from "./engine.js";
import { applyDrawPatch, placeDrawnItem } from "./draw-patch.js";
import { tapeStripes, stripeTapes } from "./tape-stripes.js";
import { indexTimedInk } from "./ink-timeline.js";
import { shapePoints, CLOSED_SHAPES } from "./shapes.js";
import { recognizeShape } from "./shape-recognize.js";
import { typesetMath } from "./math-boxes.js";
import { textBoxController, holdInk, letGo, keepHeld, boxText } from "./text-box.js";
import { pdfEditController } from "./pdf-edit.js";
import { PREFABS, prefabName, recentPrefabs } from "./prefabs.js";
import { syncStickyNotes, stickyAt } from "./sticky-notes.js";
import { createMathBar } from "./math/math-bar.js";
import { openNewRDialog } from "./math/new-r-dialog.js";
import { openContextMenu, closeContextMenu } from "./context-menu.js";
import { MAX_ROWS as TABLE_MAX_ROWS, MAX_COLUMNS as TABLE_MAX_COLUMNS } from "./table.js";
import { audioTrim } from "./audio-trim.js";
import { globalAudioController } from "./global-audio.js";
import { androidUpdates } from "./android-updates.js";
import { tabStrip, tabForDigit } from "./tab-strip.js";
import { NavHistory, mouseNavDirection, keyNavDirection } from "./nav-history.js";
import { sortable } from "./reorder.js";
import { quickMenu } from "./quick-menu.js";
import { autosaveController } from "./autosave.js";
import { penButtonDetector, loadPenProfile } from "./pen-button.js";
import { sharedAI } from "./local-ai.js";
import { runAI, smallSetting } from "./small-model.js";
import { installModalDialogs } from "./modal-dialogs.js";
import { chineseField, imeMenuOpen, openSettings as openZhSettings } from "./chinese/ime.js";
import { configureRuby, noteOpened as zhNoteOpened, rubySvg, rubyForExport, wireRubyControls } from "./chinese/ruby.js";
import { configureZh, installZhContext, pageZhLongPress, pageZhSelection, hasHan, svgHit, lookUp as zhLookUp, lookUpTyped, lookupable } from "./chinese/zh-menu.js";
import { installZhSelection, showBar as showZhBar } from "./chinese/zh-select.js";
import { embedChineseFont } from "./chinese/fonts.js";
import { pageDialogs } from "./page-dialogs.js";
import { studyImport } from "./study-import.js";
import { penSetup } from "./pen-setup.js";
import { penHoverAndTips } from "./pen-hover.js";
import { figureInserts } from "./figures.js";
import { itemClipboard } from "./item-clipboard.js";
import { itemMenus } from "./item-menus.js";
import { mediaOpener } from "./media-open.js";
import { toolWidths } from "./tool-widths.js";
import { layerPanelController } from "./layer-panel.js";
import { pageThumbnails } from "./page-thumbnails.js";
import { pdfDetail } from "./pdf-detail.js";
import { ViewCache, READS } from "./view-cache.js";
import { createModelExplorer } from "./model-explorer.js";
import { buildProjectModel, extractPrefabsFromPages, planRename } from "./project-model.js";
const $ = (id) => document.getElementById(id),
  ns = "http://www.w3.org/2000/svg";
// Colour choices shared by the pen, shapes and text.
const SWATCHES = ["#1f2328", "#246bce", "#d13b2f", "#2a9d63", "#8a4fd0", "#ff9f1c", "#ffdf38", "#e3c6e6"];
enhanceSelects();
decorateIcons();
const globalAudio = globalAudioController({ bar: $("globalAudioBar"), header: $("commandBar"), status });
// Audio, video and R files opened from anywhere (media-open.js).
const { isMp3Name, isMp4Name, openExternalVideo, openMediaFile, openRStudioTarget } = mediaOpener({
  globalAudio,
  status,
  app: {
    get groups() { return groups; },
    get home() { return home; },
    get library() { return library; },
  },
});
if ($("helpGithub")) {
  $("helpGithub").onclick = () => window.open("https://github.com/Emefedez", "_blank", "noopener,noreferrer");
}
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
  const bar = $("commandBar");
  if (bar) {
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    document.documentElement.style.setProperty("--bar-bottom", `${Math.max(36, Math.round(bar.getBoundingClientRect().bottom / z))}px`);
  }
}, true);
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest("#toolbar,.select-menu")) return;
  // The settings opened as a panel from the inline strip go back into the strip.
  if (optionsPopped) { optionsPopped = false; toolOptions(); return; }
  if (!$("toolOptions").hidden && !$("toolOptions").classList.contains("inline"))
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
  spread = 1,
  activeFileName = "",
  activeDocKind = "",
  activeCoverKeyOverride = "",
  tool = "pan",
  activeLayer = 0,
  gesture = null,
  backgrounds = null;
let mutationPending = 0;
const busy = () => editing || mutationPending > 0;
// A floppy disk beside the title: a dot while there are unsaved changes,
// and a click saves like Ctrl S.
function savedState() {
  const needsSave = !!(doc && dirty && changed);
  tabBar.update({ title: doc ? $("title").textContent : "Home", dirty: needsSave });
  const label = needsSave ? "Unsaved changes. Click to save (Ctrl S)" : "Project saved";
  $("saveState").hidden = !doc;
  $("saveState").classList.toggle("dirty", needsSave);
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
const navHistory = new NavHistory();
// Dialogs leave the tabs usable and draw no grey backdrop (modal-dialogs.js).
installModalDialogs();
const tabBar = tabStrip(window.notecompleteTabs || null, {
  dirty: () => Boolean((doc || textView?.hasDocument || htmlView?.hasDocument || officeView?.hasDocument) && dirty && changed),
  beforeClose: () => collab?.beforeClose?.() ?? true,
  onCurrent: () => { if (home?.visible && (doc || sideView())) showDocument(); },
  // This tab: save it, export it, share it (as on the Export menu); another: switch or close.
  onMenu: (tab, x, y) => {
    const bridge = window.notecompleteTabs, here = tab.current && doc;
    const click = (id) => () => { const b = $(id); if (b && !b.disabled) b.click(); };
    openContextMenu(x, y, [
      !tab.current && { label: "Switch to this tab", icon: "window", run: () => bridge.activate(tab.id) },
      here && { label: "Save", icon: "save", key: "Ctrl S", run: click("save") },
      here && { label: "Export", icon: "export", submenu: [
        { label: "PDF (every page)", icon: "pages", run: click("exportPdf") },
        { label: "NoteComplete project (.nfedit)…", icon: "save", run: click("exportProject") },
        { label: "Import, export and share…", icon: "export", run: click("exportOpen") },
      ] },
      here && { label: "Share by QR or link…", icon: "qr", run: click("shareNoteQr") },
      "-",
      { label: "New tab", icon: "plus", key: "Ctrl T", run: () => bridge.open() },
      !tabParams.has("tab") && { label: "Move to a new window", icon: "window", run: () => bridge.detach(tab.id) },
      { label: "Close tab", icon: "close", run: () => bridge.close(tab.id) },
    ], { title: tab.title });
  },
});
if (window.notecompleteTabs) {
  $("newTab").hidden = false;
  $("newTab").onclick = () => window.notecompleteTabs.open();
}
const theme = themeController({ toggle: $("themeToggle"), light: $("themeLight"), system: $("themeSystem"), status });
const chromeState = new ChromeState();
let panels = [],
  observer = null,
  keepObserver = null,
  thumbnailObserver = null,
  scrollFrame = 0,
  zoom = "fit";
let displayQuality, zoomDetail = true;
// View → Lag log…: freezes written down with what was going on (lag-log.js).
lagLog.start();
{
  const dialog = $("lagLogDialog");
  const show = () => {
    const text = lagLog.report();
    $("lagLogText").textContent = text.split("\n").slice(2).join("\n") || "Nothing yet.";
    $("lagLogSummary").textContent = text.split("\n")[2] || (lagLog.on ? "Recording. Nothing slow yet." : "Off.");
    $("lagLogOn").checked = lagLog.on;
  };
  $("lagLogOpen").onclick = () => { closeMenus?.(); show(); dialog.showModal(); };
  $("lagLogOn").onchange = (e) => { lagLog.set(e.target.checked); show(); status(e.target.checked ? "Lag log on: freezes are written down (View → Lag log…)." : "Lag log off."); };
  $("lagLogClear").onclick = () => { lagLog.clear(); show(); };
  $("lagLogCopy").onclick = async () => { try { await navigator.clipboard.writeText(lagLog.report()); status("Lag log copied."); } catch { status("Could not copy: use Save instead.", true); } };
  $("lagLogSave").onclick = () => download(new Blob([lagLog.report()], { type: "text/plain" }), `NoteComplete lag log ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.txt`, "text/plain");
  $("lagLogClose").onclick = () => dialog.close();
}
function preloadMarginPx() {
  const count = Math.max(0, Math.min(20, Math.round(Number(displayQuality?.preloadPages ?? 2))));
  return count * 950;
}
function preloadMargin() {
  return `${preloadMarginPx()}px 0px`;
}
function preloadCacheSize() {
  const count = Math.max(0, Math.min(20, Math.round(Number(displayQuality?.preloadPages ?? 2))));
  return Math.max(6, Math.min(48, count * 2 + 4));
}
// A page leaving the preload band stays drawn until it is this much further away, so that
// scrolling back and forth over the band's edge does not take a heavy page apart and parse
// its ink again each time.
const KEEP_EXTRA_PX = 950;
function keepMargin() {
  return `${preloadMarginPx() + KEEP_EXTRA_PX}px 0px`;
}
// A drawn page given back to its placeholder: off screen, or no longer showing the note as it is.
function unmountPage(p) {
  p.token++;
  p.pdfMissed = false;
  p.view = null;
  p.ink = null;
  p.pdfReady = false;
  placeholder(p);
}
// Taking a heavy page apart is itself a long task (the browser lets go of every element), so
// pages far off screen are taken down when the browser is idle, not in the middle of a scroll.
const unmountDue = new Set();
let unmountTimer = 0;
const idle = globalThis.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 1000 }) : (fn) => setTimeout(fn, 200);
function unmountSoon(p) {
  unmountDue.add(p);
  if (!unmountTimer) unmountTimer = idle(unmountFar);
}
// Recently left pages kept parsed (Display quality → Recent pages kept ready): when a page is
// taken down while the note is unchanged, its ink is parsed into a template in that idle moment,
// and coming back to the same view clones it (about 3× faster than parsing again).
const parsedPages = new Map();
function keepParsed(p, deadline) {
  const limit = displayQuality?.keptPages ?? 0;
  const view = p.view;
  // Only a view the cache would hand back as it is: an edited note has a new one.
  if (!limit || !view || typeof view.svg !== "string" || viewCache.views.get(p.index) !== view) return;
  // Parsing a page with much ink is a long task: only in real idle time, never as an idle
  // callback forced by its timeout in the middle of a jump or scroll.
  if (!deadline || deadline.didTimeout || !(deadline.timeRemaining?.() > 8)) return;
  if (parsedPages.get(p.index)?.view === view) return;
  const template = document.createElement("template");
  template.innerHTML = view.svg;
  parsedPages.delete(p.index);
  parsedPages.set(p.index, { view, content: template.content });
  for (const index of parsedPages.keys()) {
    if (parsedPages.size <= limit) break;
    parsedPages.delete(index);
  }
}
function trimParsed() {
  const limit = displayQuality?.keptPages ?? 0;
  for (const index of parsedPages.keys()) {
    if (parsedPages.size <= limit) break;
    parsedPages.delete(index);
  }
}
function unmountFar(deadline) {
  unmountTimer = 0;
  let done = 0;
  for (const p of unmountDue) {
    // At least one page per idle moment, more while the browser has time to spare.
    if (done++ && !deadline?.didTimeout && !(deadline?.timeRemaining?.() > 8)) break;
    unmountDue.delete(p);
    if (panels[p.index] !== p || p.kept || p.near || gesture?.panel === p) continue;
    if (p.view || p.render || p.loading) {
      keepParsed(p, deadline);
      unmountPage(p);
    }
  }
  if (unmountDue.size) unmountTimer = idle(unmountFar);
}
function attachPageObserver() {
  observer?.disconnect();
  keepObserver?.disconnect();
  renderQueue.clear();
  unmountDue.clear();
  if (!panels.length) return;
  const viewport = $("viewport");
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const p = panels[Number(entry.target.dataset.page)];
        if (!p || p.el !== entry.target) continue;
        p.near = entry.isIntersecting;
        if (!p.near) renderQueue.delete(p);
        else if (p.view && p.pdfMissed && !p.loading) renderPage(p, p.view);
        else if (!p.view) {
          // A page in the window now is drawn at once; one only near it waits its turn
          // (pumpRenders), nearest first, so a jump shows the page asked for first.
          // The window is the observer's root less its margin: no layout read here.
          const box = entry.boundingClientRect, root = entry.rootBounds, margin = preloadMarginPx();
          if (!root || (box.bottom > root.top + margin && box.top < root.bottom - margin)) renderPage(p);
          else queueRender(p);
        }
      }
    },
    { root: viewport, rootMargin: preloadMargin() },
  );
  keepObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const p = panels[Number(entry.target.dataset.page)];
        if (!p || p.el !== entry.target) continue;
        p.kept = entry.isIntersecting;
        if (!p.kept) unmountSoon(p);
      }
    },
    { root: viewport, rootMargin: keepMargin() },
  );
  for (const p of panels) {
    observer.observe(p.el);
    keepObserver.observe(p.el);
  }
}
// Pages near the window wait here to be drawn, one at a time: the nearest to the page in view
// first, and one off screen only once the pages stop moving (or it is about to come in), with a
// frame between two, so that parsing a heavy page's ink never lands in the middle of a scroll
// or several in one long task. A page that leaves the band meanwhile is never asked for, so a
// fast scroll no longer leaves the engine a queue of pages already flown past.
const renderQueue = new Set();
let renderPumping = false;
// Page views as the engine gave them, while the note has not changed (view-cache.js, pageView).
const viewCache = new ViewCache();
const OFFSCREEN_WAIT_MAX_MS = 600;
function queueRender(p) {
  renderQueue.add(p);
  pumpRenders();
}
const wantsRender = (p) => panels[p.index] === p && p.near && !p.view && !p.loading;
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
// Until the pages have stopped moving, the page is close to the window's edge, or long enough.
async function offscreenPause(p) {
  const start = performance.now();
  for (;;) {
    if (!wantsRender(p)) return;
    const now = performance.now();
    if (now - lastScrollAt >= SCROLL_SETTLE_MS || now - start >= OFFSCREEN_WAIT_MAX_MS) return;
    const box = p.el.getBoundingClientRect(), view = $("viewport").getBoundingClientRect(), reach = view.height / 2;
    if (box.bottom > view.top - reach && box.top < view.bottom + reach) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function pumpRenders() {
  if (renderPumping) return;
  renderPumping = true;
  try {
    while (renderQueue.size) {
      const note = epoch;
      let next = null;
      for (const p of renderQueue) {
        if (!wantsRender(p)) renderQueue.delete(p);
        else if (!next || Math.abs(p.index - page) < Math.abs(next.index - page)) next = p;
      }
      if (!next) break;
      renderQueue.delete(next);
      await offscreenPause(next);
      // Another document opened meanwhile: its pages (queued since, reset() emptied the
      // rest) are drawn on, not left waiting for a scroll to queue them again.
      if (note !== epoch) continue;
      if (!wantsRender(next)) continue;
      // The view first (from the cache, or the engine), then the page drawn from it in one go.
      const version = revision;
      let view = null;
      try { view = await pageView(next.index); } catch { /* renderPage asks again and shows why. */ }
      if (note !== epoch) continue;
      if (!wantsRender(next)) continue;
      renderPage(next, view && version === revision ? view : undefined);
      await nextFrame();
    }
  } finally {
    renderPumping = false;
    // Pages queued while the last one was drawn (queueRender found the pump busy).
    if (renderQueue.size) queueMicrotask(pumpRenders);
  }
}
const quality = qualitySettings((value, rasterChanged, detail, preloadChanged) => {
  displayQuality = value;
  zoomDetail = detail;
  // A filter list (never "none"): dark pages append invert() to it, and "none invert()" is
  // invalid CSS. At 100 % there is none at all (dark pages fall back to contrast(100%)): an
  // identity filter still makes every page a filtered layer, redrawn whole on each change.
  if (value.contrast === 100 && value.brightness === 100) document.documentElement.style.removeProperty("--page-filter");
  else document.documentElement.style.setProperty("--page-filter", `contrast(${value.contrast}%) brightness(${value.brightness}%)`);
  if (preloadChanged) {
    backgrounds?.setMaxKept(preloadCacheSize());
    viewCache.setMaxEntries(preloadCacheSize() * 2);
    trimParsed();
    attachPageObserver();
  }
  if (rasterChanged) redrawPdfPages();
});
// PDF pages drawn again: another quality, or a screen with another pixel density (the window
// moved to another screen, or the browser zoom changed; see rasterTarget).
function redrawPdfPages() {
  backgrounds?.clear();
  for (const panel of panels) {
    dropDetail(panel);
    panel.token++;
    if (panel.near) renderPage(panel, panel.view);
    else if (panel.view) unmountPage(panel);
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
  (...a) => syncInk(...a),
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
  // The ⋯ circle of a selection: the item's menu.
  menu: (item, x, y) => itemMenu(item, x, y),
  // A graph, table or prefab resized: drawn again at the new size (redrawResized).
  redraw: (item, adjustment) => redrawResized(item, adjustment),
  // Let go over another page: moved there.
  dropTo: (item, target, start, client) => moveToPage(item, target, start, client),
  // Double-clicking a selected prefab, graph or table opens its editor.
  edit: (item) => editCompound(item),
});
// Status is a transient toast, not a permanent strip; errors stay up longer.
let statusTimer = 0;
// Never over the tool bars: above the lowest bar that sits at the bottom (phones, a
// tablet's dock held upright), also after the screen turns.
function uiZoom() {
  const z = parseFloat(document.documentElement.style.zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}
function placeStatus() {
  const z = uiZoom(), vh = innerHeight / z;
  let bottom = 0;
  // Looked up one by one: a selector list with a class searched every element of the drawn
  // pages (thousands on a page with much ink) each time a message showed, on every jump.
  for (const bar of [$("toolbar"), document.querySelector(".navigation"), document.getElementById("tabletDock")]) {
    if (!bar) continue;
    const r = bar.getBoundingClientRect();
    if (r.height && r.top / z > vh / 2) bottom = Math.max(bottom, vh - r.top / z);
  }
  $("status").style.setProperty("--above-bars", `${Math.round(bottom)}px`);
}
addEventListener("resize", () => { if ($("status").classList.contains("show")) placeStatus(); });
function status(text, error = false) {
  $("status").textContent = text;
  placeStatus();
  $("status").className = (error ? "error " : "") + (text ? "show" : "");
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => $("status").classList.remove("show"), error ? 8000 : 2800);
}
// A click on the message copies its text (an error to report, a path, a link), and it stays a
// moment longer to say so; the pointer over it keeps it shown.
$("status").addEventListener("click", () => {
  const box = $("status"), text = box.textContent.trim();
  if (!text || !box.classList.contains("show")) return;
  const done = () => {
    box.classList.add("copied");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => box.classList.remove("show", "copied"), 1600);
  };
  (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(done, () => {
    const area = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(area);
    area.select();
    try { if (document.execCommand("copy")) done(); } finally { area.remove(); }
  });
});
$("status").addEventListener("pointerenter", () => clearTimeout(statusTimer));
$("status").addEventListener("pointerleave", () => {
  if ($("status").classList.contains("show")) statusTimer = setTimeout(() => $("status").classList.remove("show", "copied"), 1500);
});
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
// Help → Open the welcome note at start: only on the website, which has one (site.json).
// Remembered in this browser (welcome-pref.js); tabs-main.js reads it at start.
function welcomeChecked() { $("welcomeToggle").setAttribute("aria-checked", String(welcomeWanted())); }
if ($("welcomeToggle") && !window.notecompleteUpdates && !window.ReactNativeWebView) {
  fetch("./site.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((site) => {
    if (!site?.welcome) return;
    $("welcomeToggle").hidden = false;
    welcomeChecked();
  }).catch(() => { /* No website here. */ });
  $("welcomeToggle").onclick = () => {
    closeMenus();
    const wanted = !welcomeWanted();
    setWelcomeWanted(wanted);
    welcomeChecked();
    status(wanted ? "The welcome note opens each time this site starts." : "The welcome note will not open at start any more. Help → Open the welcome note at start brings it back.");
  };
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
    // The website's welcome note, opened at start: say once how to stop that.
    if (welcomeWanted() && window.parent !== window && /^welcome\./i.test(url.pathname.split("/").pop())) {
      let told = false;
      try { told = localStorage.getItem("notecomplete-welcome-told") === "1"; localStorage.setItem("notecomplete-welcome-told", "1"); } catch { told = true; }
      if (!told) status("To stop this welcome note opening at start: Help → Open the welcome note at start.");
    }
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
const launchedHandles = new WeakMap();
let saveFileHandle = null;
window.launchQueue?.setConsumer(async (params) => {
  const files = [];
  for (const handle of params?.files || []) {
    try {
      if (handle.kind !== "directory") {
        const file = await handle.getFile();
        launchedHandles.set(file, handle);
        files.push(file);
      }
    } catch { /* Gone or not allowed. */ }
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
      if (isMp4Name(desktop.name)) return await openExternalVideo(desktop.path, desktop.name);
      const file = new File([desktop.bytes], desktop.name);
      if (await openMediaFile(file, { path: desktop.path })) return;
      if (await openArchiveFile(file, { path: desktop.path })) return;
      await load(file);
      return await openedLocal(desktop.path, desktop.name, file);
    }
    if (tabParams.get("shared") === "1" && !launchedFiles.length) launchedFiles.push(...await sharedFiles());
    const [file, ...rest] = launchedFiles.splice(0);
    if (!file || busy()) return;
    if (await openMediaFile(file)) return;
    if (await openArchiveFile(file, { origin: "Opened file" })) return;
    if (!canReplace()) return;
    await load(file);
    if (rest.length) status(`Opened ${file.name}. Open ${rest.map((f) => f.name).join(", ")} on its own; one document per window.`);
  } catch (e) { status(e.message, true); }
}
function call(op, args = {}, transfer = null) {
  const raw = Array.isArray(transfer)
    ? transfer
    : (args.bytes instanceof ArrayBuffer || ArrayBuffer.isView(args.bytes) ? [args.bytes] : []);
  const list = [...new Set(raw.map((x) => (ArrayBuffer.isView(x) ? x.buffer : x)).filter((x) => x instanceof ArrayBuffer))];
  const answered = lagLog.call(op);
  viewCache.sending(op);
  if (!READS.has(op)) parsedPages.clear();
  const reply = engine.call({ op, page, ...args }, list);
  reply.then(answered, answered);
  return reply;
}
// A sharing session (collab.js, loaded only when one starts). While it holds the open
// note, edits go into the session's shared order and come back to be applied here
// (applyShared), so every copy applies the same edits in the same order.
let collab = null, sharedText = false;
function mutate(op, args = {}) {
  if (collab?.readOnly) return Promise.reject(Error("This note is shared view-only: you can read it and follow along."));
  if (collab?.ink) return collab.submit(op, args);
  return op === "draw" ? call(op, args).then(viewAfter) : call(op, args);
}
// The engine answers a drawn line with the new item alone (worker.js `draw`), not with the
// page as it answers every other edit. Here that becomes the page's view again: the item
// put into the view the page holds, when that view shows the note just before the line
// (draw-patch.js), and otherwise the view asked from the engine, as before. `drawnItems`
// keeps, by the view made, the line's id, and the item with the view it was put into, so
// the page can add that one element instead of drawing everything again (addDrawn).
const drawnItems = new WeakMap();
async function viewAfter(reply) {
  const drawn = reply?.drawn;
  if (!drawn) return reply;
  const p = panels[drawn.page];
  // The page's newest view: the one waiting for the pen to pause (laterRender), or the
  // one on screen.
  for (const base of [p?.pendingView, p?.view]) {
    const next = base && applyDrawPatch(base, drawn);
    if (next) {
      drawnItems.set(next, { id: drawn.id, drawn, base });
      return next;
    }
  }
  const view = await call("view", { page: drawn.page });
  drawnItems.set(view, { id: drawn.id });
  return view;
}
async function pageView(index) {
  const kept = viewCache.get(index);
  if (kept) return kept;
  const generation = viewCache.generation;
  const view = await call("view", { page: index });
  viewCache.put(index, view, generation);
  return view;
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
    // Back from a restart for an update: this tab's document again; otherwise files handed over.
    restoreAfterUpdate().then((restored) => { if (!restored) openLaunched(); });
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
  keepObserver?.disconnect();
  renderQueue.clear();
  unmountDue.clear();
  viewCache.clear();
  parsedPages.clear();
  thumbnailObserver?.disconnect();
  thumbQueue.clear();
  thumbsDue.clear();
  backgrounds?.close();
  stopRecording();
  if (globalAudio.isExternal) globalAudio.detachExternal({ stop: false });
  audio.reset();
  panels = [];
  doc = null;
  projectModelController?.reset?.();
  sideFp = "";
  activeFileName = "";
  activeDocKind = "";
  activeCoverKeyOverride = "";
  saveFileHandle = null;
  embeddedExam = null;
  htmlView?.close();
  textView?.close();
  textFinder?.close();
  webView?.close();
  if (officeView?.hasDocument) void officeView.close({ save: true });
  $("pages").replaceChildren();
  $("pageList").replaceChildren();
  if (!keepSession) releaseSession();
  $("editor").hidden = true;
  $("htmlView").hidden = true;
  $("textView").hidden = true;
  $("webView").hidden = true;
  if ($("officeView")) $("officeView").hidden = true;
  $("title").textContent = "Home";
  document.title = "NoteComplete";
  tabBar.update({ title: "Home", dirty: false });
  dirty = changed = false;
  $("textSave").hidden = $("htmlSave").hidden = true;
  $("htmlBackToNote").hidden = $("htmlExportCopy").hidden = true;
  $("htmlNotes").hidden = false;
  converted = false;
  officeFile = null;
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
// That file itself, for "Open in Euro-Office" in the text view's bar.
let officeFile = null;
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
const SAVE_EXT = { project: ".nfedit", noteful: ".noteful", markdown: ".noteful" };
function saveLabel() {
  const el = $("save");
  el.querySelector(".menu-label").textContent = saveAs ? `Save (${SAVE_EXT[saveAs]})` : "Save project (.nfedit)";
  el.title = saveAs === "noteful" || saveAs === "markdown"
    ? "Save to the Noteful file (no undo history; notes, added recordings and study sets stay on this device)."
    : "Save .nfedit project: original note, full undo history, Markdown notes, handwriting text, added recordings, quizzes, flashcards and scratchpad.";
}
async function load(file, preparedDocument = null) {
  if (!ready || busy()) {
    status("Wait for the current operation to finish.", true);
    return;
  }
  // Office files open in the text view or in Euro-Office: the kind's default, a choice made in an
  // "Open with" menu, or the chooser when the default is "Ask each time" (open-with-ui.js).
  if (!preparedDocument && file?.name) {
    const way = await chooseOpener(file.name);
    if (way.cancelled) {
      status("Not opened.");
      throw new DOMException("Not opened: no way to open it was chosen.", "AbortError");
    }
    if (way.opener === "euro-office") {
      try { await officeModule.open(file, { mode: way.mode }); }
      catch (e) { status("Could not open in Euro-Office: " + e.message, true); throw e; }
      return;
    }
  }
  editing = true;
  status("Opening document…");
  try {
    // A recovered automatic save keeps the note it belongs to (its notes, recordings, slots).
    const recovering = autosave.takeRecoveringKey();
    const fingerprint = recovering ? Promise.resolve(recovering) : noteFingerprint(file).catch(() => "");
    const prepared = preparedDocument || await prepareDocument(file);
    const nextFileName = file?.name || prepared.title || "";
    const nextDocKind = prepared.kind || "";
    // HTML pages and text/Markdown files have their own views instead of the page editor.
    if (prepared.kind === "html" || prepared.kind === "text") {
      reset({ opening: true });
      activeFileName = nextFileName;
      activeDocKind = nextDocKind;
      if (prepared.converted) { convertedImages = prepared.images || []; convertedFolder = prepared.imageFolder || ""; converted = true; officeFile = file; }
      sideFp = await fingerprint;
      const sideTitle = prepared.title || file.name || "Document";
      $("title").textContent = sideTitle;
      document.title = `${sideTitle} — NoteComplete`;
      tabBar.update({ title: sideTitle, dirty: false });
      if (prepared.kind === "html") { htmlView.open({ text: prepared.text, fingerprint: sideFp, name: sideTitle }); notes?.load(sideFp, { core: false }); }
      else {
        await textView.open({ text: prepared.text, name: sideTitle, markdown: prepared.markdown ?? (isMarkdownName(file.name) || isDiagramName(file.name)), key: file.name });
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
      notebook: prepared.kind === "notebook",
      name: file?.name || "",
      page: 0,
    });
    // Both worker and UI retain the previous document until the replacement validates.
    reset({ opening: true, keepSession: true });
    if (launchedHandles.has(file)) saveFileHandle = launchedHandles.get(file);
    activeFileName = nextFileName;
    activeDocKind = nextDocKind;
    engine.opened(openedBytes);
    tapeMode = "note";
    tapeTaps.clear();
    find.reset(await fingerprint);
    // A guest keeps the session's shared notes (collab.js binds them), not the note's own.
    if (collab?.role !== "guest") notes?.load(find.fingerprint);
    const token = ++epoch;
    revision++;
  projectModelController?.invalidate?.();
    doc = result;
    page = 0;
    activeLayer =
      result.layers.find((l) => l.visible && !l.locked)?.id ??
      result.layers[0]?.id ??
      0;
    dirty = ["pdf", "image", "blank", "handwritten", "notebook"].includes(prepared.kind);
    changed = false;
    saveAs = prepared.saveAs || null;
    saveLabel();
    savedState();
    backgrounds = new PdfBackgrounds((resource) => {
      if (token !== epoch) throw Error("Document closed");
      return call("pdf", { resource });
    }, { maxKept: preloadCacheSize() });
    $("title").textContent = result.title || "Untitled note";
    document.title = `${$("title").textContent} — NoteComplete`;
    tabBar.update({ title: $("title").textContent, dirty: dirty && changed });
    showDocument();
    $("pageNumber").max = result.pages;
    documentControls();
    buildPages(result.page_sizes);
    updateTools(result);
    layerPanel(result.layers);
    // Recordings that came inside a .nfedit or legacy .notecomp join the ones kept for this note.
    const incoming = (result.added_audio || []).map((a) => ({ id: a.id, name: a.name, mime: a.mime, created: a.created, blob: new Blob([a.bytes], { type: a.mime }) }));
    audio.open(result.audio || [], result.recordings || [], await addedStore.load(find.fingerprint, incoming));
    if (prepared.kind === "project" && result.study && find.fingerprint) {
      for (const kind of ["decks", "quizzes", "scratch"]) {
        const items = result.study[kind];
        if (!Array.isArray(items) || !items.length) continue;
        const key = `${kind}:${find.fingerprint}`;
        const existing = await library.store.get("settings", key).catch(() => null);
        await library.store.set("settings", key, mergeStudy(kind, existing, items)).catch(() => {});
      }
    }
    await zhNoteOpened();
    rememberDocument();
    await renderPage(panels[0], result);
    void ensureDocumentCover({ skipExisting: true });
    // A Goodnotes or Notability notebook is now a note: it is saved as a .nfedit that keeps it.
    if (prepared.kind === "notebook") {
      const left = result.import_warnings || [];
      status(`${result.origin?.format === "notability" ? "Notability" : "Goodnotes"} notebook opened as a note. Save keeps it as a .nfedit project with the notebook inside.${left.length ? ` Not brought over: ${left.join("; ")}.` : ""}`, false);
    } else status("Document opened.");
    collab?.documentChanged();
    autosave.opened(recovering);
  } catch (e) {
    status("Could not open: " + e.message, true);
    throw e;
  } finally {
    editing = false;
  }
}
// `at`: { page, point } where a pasted picture goes (its centre); `any`: any image the browser
// reads (the clipboard's).
async function importImages(files, { at = null, any = false } = {}) {
  if (!doc || busy()) return;
  // Pictures copied from NoteComplete carry their items (png-clip.js): those come back editable.
  const plain = [];
  for (const file of files) {
    const c = await pictureClip(file);
    if (c) await pasteFromPicture(c, at);
    else plain.push(file);
  }
  if (!plain.length) return;
  files = plain;
  const targetPage = at?.page ?? page,
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
      const decoded = await readImage(file, { any });
      if (note !== epoch) return;
      const fitted = imageBounds(decoded.size, panels[targetPage].size);
      const image = {
        base64: decoded.base64,
        mime: decoded.mime,
        bounds: at?.point ? centredAt(fitted, at.point, panels[targetPage].size) : fitted,
        layer,
      };
      const result = await mutate("image", { page: targetPage, image });
      if (note !== epoch) return;
      dirty = changed = true;
      revision++;
  projectModelController?.invalidate?.();
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
async function addBlankPage(after, before = false) {
  if (!doc || busy() || doc.canvas) return;
  const size = panels[after]?.size;
  if (!size) return;
  const at = before ? after : after + 1;
  await action("insertPages", { at, pages: [{ size: [...size] }], focus: at });
}
// The right-click entries for a blank page before or after page `index`.
function blankPageEntries(index, { scroll = false } = {}) {
  // The page's size, as Pages → Page size does it, for this page: only where pages can change
  // size (not a canvas, which grows by itself; not a view-only note or a read-only guest).
  const resizable = !doc?.canvas && !$("resizePage").disabled;
  const onThisPage = (run) => () => { if (scroll) jump(index); else setPage(index); run(); };
  return [
    { label: "Insert blank page before", icon: "plus", run: () => addBlankPage(index, true) },
    { label: "Insert blank page after", icon: "plus", run: () => addBlankPage(index) },
    resizable && "-",
    resizable && { label: "Page size…", icon: "fit", run: onThisPage(() => $("resizePage").click()) },
    resizable && { label: "Resize by dragging the borders", icon: "maximize", run: onThisPage(startResizeDrag) },
  ].filter(Boolean);
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
      slot: doc?.page_order?.[index] ?? index,
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
      // A second press close by, soon after the first: a double-click (the page is redrawn
      // between the two when the first selects, so the browser's dblclick may never come).
      const last = lastPress;
      lastPress = e.button === 0 ? { p, t: e.timeStamp, x: e.clientX, y: e.clientY } : null;
      p.doublePress = last && last.p === p && e.timeStamp - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8 ? [e.clientX, e.clientY] : null;
      if (p.doublePress) lastPress = null;
      longPress.down(e, p);
      pointerDown(e, p);
    };
    el.onpointermove = (e) => {
      if (p.audioTap && Math.hypot(e.clientX - p.audioTap[0], e.clientY - p.audioTap[1]) > 6)
        p.audioTap = null;
      if (tool === "pdfedit" && !e.buttons) pdfEdit.hover(e, p);
      pagePointer = { p, clientX: e.clientX, clientY: e.clientY };
      longPress.move(e);
      pointerMove(e);
    };
    el.onpointerup = (e) => {
      longPress.end();
      pointerUp(e);
      const d = p.doublePress;
      p.doublePress = null;
      if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 8) editTextAt(p, e);
    };
    el.onpointercancel = () => { p.audioTap = null; longPress.end(); cancelGesture(); };
    el.addEventListener("pointerdown", (e) => {
      if (e.button === 2 && e.target.matches?.(".text-editor")) e.target.selectionBeforeRightClick = [e.target.selectionStart, e.target.selectionEnd];
    }, true);
    el.oncontextmenu = async (event) => {
      // Inside the text box being typed nothing is removed: right-click (Shift too) on Chinese
      // opens its panel (the selected Chinese when there is some); elsewhere the field's own menu.
      if (textBox.active && event.target.closest?.(".text-editor")) {
        // The selection from before this click (the browser may have just selected the word under it).
        const area = event.target.closest(".text-editor"), [a, b] = area.selectionBeforeRightClick || [0, 0];
        const chosen = area.value.slice(a, b).trim();
        area.setSelectionRange(a, b);
        if (lookupable(chosen)) { event.preventDefault(); zhLookUp(chosen, {}, area); return; }
        const at = textBox.typedAt(event.clientX, event.clientY);
        if (at && hasHan(String.fromCodePoint(at.text.codePointAt(at.index)))) {
          event.preventDefault();
          lookUpTyped(at.text, at.index, at.replace, area);
        }
        return;
      }
      // Right-click: a menu for what is under the pointer (or the page). Shift + right-click
      // removes it at once, as right-click did before; Ctrl+Z brings it back. On Chinese printed
      // in the PDF (its text layer), Shift + right-click opens that character's panel instead.
      event.preventDefault();
      if (!doc || editing || busy() || !p.view) return;
      // Not while text is selected: a right-click there means copy, not delete.
      const chosen = selectedText(window.getSelection());
      // Text selected in the page text layer: Translate (with favorites/search), Chinese lookup, and Copy.
      if (chosen) return pageZhSelection(chosen, event.clientX, event.clientY);
      if (!event.shiftKey) return pageMenu(p, point(event, p), event.clientX, event.clientY);
      const zh = hasHan(p.el.textContent) && svgHit(p.el, event.clientX, event.clientY);
      if (zh && !zh.item && await pageZhLongPress(p, event.clientX, event.clientY)) return;
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
      // Tapping a sticky note makes it (and the ink and text on it) see-through, or solid again.
      const sticky = stickyAt(p.render, tx, ty);
      if (sticky) {
        p.audioTap = null;
        status(sticky.toggle() ? "Sticky note see-through: tap it again to show it." : "Sticky note shown.");
        return;
      }
      if (!p.view?.timings.length && !audio.recording?.timings?.length) return;
      p.audioTap = null;
      const note = epoch, [x, y] = point(event, p);
      try {
        const directId = event.target.closest?.("[data-timed-ink]")?.dataset.item;
        const itemId = directId || await call("pickTimed", { page: p.index, x, y,
          tolerance: 8 * p.size[0] / p.el.getBoundingClientRect().width });
        if (note !== epoch || tool !== "pan") return;
        const timing = p.view?.timings.find(t => t.item_id === itemId) || audio.recording?.timings?.find(t => t.item_id === itemId);
        if (timing && await audio.seekRecording(timing.recording_id || audio.recording?.id, timing.start)) {
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
  attachPageObserver();
}
async function movePage(from, to) {
  if (!doc || doc.canvas || editing || busy()) return;
  if (from < 0 || to < 0 || from >= doc.pages || to >= doc.pages || from === to) return;
  selection.clear();
  await action("movePage", { from, to, focus: to });
}
function syncPageMoveMenus() {
  const ok = !!doc && !doc.canvas && panels.length > 1;
  if ($("movePageUp")) $("movePageUp").disabled = !ok || page <= 0;
  if ($("movePageDown")) $("movePageDown").disabled = !ok || page >= panels.length - 1;
}
function buildPageList() {
  const canReorder = !doc?.canvas && panels.length > 1;
  const fragment = document.createDocumentFragment();
  for (const panel of panels) {
    const item = document.createElement("div");
    item.className = "page-item";
    item.dataset.pageIndex = String(panel.index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-link";
    button.setAttribute("aria-label", `Page ${panel.index + 1}`);
    const thumb = document.createElement("span");
    thumb.className = "page-thumb";
    thumb.style.aspectRatio = panel.size.join(" / ");
    const fallback = document.createElement("span");
    fallback.className = "thumb-fallback";
    fallback.textContent = panel.index + 1;
    thumb.append(fallback);
    button.append(thumb);
    button.onclick = () => {
      jump(panel.index);
      $("pagesPanel").classList.remove("open");
      syncPagePanel();
    };
    const meta = document.createElement("div");
    meta.className = "page-meta";
    if (canReorder) {
      const grip = document.createElement("span");
      grip.className = "page-grip";
      grip.title = "Drag to reorder page";
      grip.append(icon("grip"));
      meta.append(grip);
    }
    const label = document.createElement("span");
    label.className = "page-label";
    label.textContent = `Page ${panel.index + 1}`;
    meta.append(label);
    if (!doc?.canvas) {
      const actions = document.createElement("div");
      actions.className = "page-actions";
      const bg = document.createElement("button");
      bg.type = "button";
      bg.className = "icon-button page-move";
      bg.title = `Change PDF background on page ${panel.index + 1}…`;
      bg.setAttribute("aria-label", `Change PDF background on page ${panel.index + 1}`);
      bg.append(icon("note"));
      bg.onclick = (e) => {
        e.stopPropagation();
        openPageBackground(String(panel.index + 1));
      };
      actions.append(bg);
      if (canReorder) {
        const up = document.createElement("button");
        up.type = "button";
        up.className = "icon-button page-move";
        up.disabled = panel.index === 0;
        up.title = "Move page up";
        up.setAttribute("aria-label", `Move page ${panel.index + 1} up`);
        up.append(icon("arrowUp"));
        up.onclick = (e) => {
          e.stopPropagation();
          movePage(panel.index, panel.index - 1);
        };
        const down = document.createElement("button");
        down.type = "button";
        down.className = "icon-button page-move";
        down.disabled = panel.index === panels.length - 1;
        down.title = "Move page down";
        down.setAttribute("aria-label", `Move page ${panel.index + 1} down`);
        down.append(icon("arrowDown"));
        down.onclick = (e) => {
          e.stopPropagation();
          movePage(panel.index, panel.index + 1);
        };
        actions.append(up, down);
      }
      meta.append(actions);
    }
    item.append(button, meta);
    if (!doc?.canvas) item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, blankPageEntries(panel.index, { scroll: true }), { title: `Page ${panel.index + 1}` });
    });
    panel.pageButton = item;
    fragment.append(item);
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
// Drag a page card vertically in #pageList (by its grip on touch/pen, or anywhere on mouse) to reorder pages.
$("pageList").addEventListener("pointerdown", (down) => {
  if (!doc || doc.canvas || panels.length < 2 || editing || busy()) return;
  const item = down.target.closest(".page-item");
  if (!item || down.button !== 0 || down.target.closest(".page-move")) return;
  const touch = down.pointerType === "touch" || down.pointerType === "pen";
  if (touch && !down.target.closest(".page-grip")) return;
  const container = $("pageList");
  const from = Number(item.dataset.pageIndex);
  const startY = down.clientY, pointer = down.pointerId;
  let dragging = false, grab = 0;
  const siblings = () => [...container.querySelectorAll(".page-item")];
  const move = (event) => {
    if (event.pointerId !== pointer) return;
    if (!dragging) {
      if (Math.abs(event.clientY - startY) < (touch ? 4 : 6)) return;
      dragging = true;
      grab = startY - item.getBoundingClientRect().top;
      item.classList.add("dragging");
      try { item.setPointerCapture(pointer); } catch { /* Released already. */ }
    }
    item.style.transform = "";
    const others = siblings().filter((el) => el !== item);
    const top = event.clientY - grab, centre = top + item.offsetHeight / 2;
    const index = others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 < centre;
    }).length;
    const ref = others[index];
    if (ref ? item.nextElementSibling !== ref : others.at(-1)?.nextElementSibling !== item) {
      if (ref) container.insertBefore(item, ref);
      else others.at(-1)?.after(item);
    }
    item.style.transform = `translateY(${top - item.getBoundingClientRect().top}px)`;
  };
  const finish = (event) => {
    if (event.pointerId !== pointer) return;
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", finish);
    removeEventListener("pointercancel", finish);
    item.classList.remove("dragging");
    item.style.transform = "";
    if (!dragging) return;
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    container.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => container.removeEventListener("click", swallow, true), 50);
    const to = siblings().indexOf(item);
    if (to >= 0 && to !== from) movePage(from, to);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", finish);
  addEventListener("pointercancel", finish);
});
// Paper stays underneath so widened pages show blank paper beside the PDF.
const textBox = textBoxController({
  call,
  action: (...a) => action(...a),
  patch: (...a) => patchItem(...a),
  status,
  selection,
  swatches: SWATCHES,
  getDoc: () => doc,
  getActiveLayer: () => ensureEditableLayer()?.id ?? activeLayer,
  getTool: () => tool,
  getPanels: () => panels,
  getPage: () => page,
  isEditing: () => editing,
  isBusy: () => busy(),
  toolOptions: () => toolOptions(),
  insertCompound: (...a) => insertCompound(...a),
  onTrace: async (chars) => {
    const p = panels[page] || (await openBlankNoteForPrefab(`Stroke order ${chars}`));
    if (!p || !ensureEditableLayer()) return;
    const spec = await figureEditor({ type: "hanzi", text: chars || "你好", show: "steps", grid: "mi", outline: true }, { editing: false });
    if (spec) await placePrefab(p, spec);
  },
  noteKey: () => { try { return find.fingerprint || ""; } catch { return ""; } },
  $,
});
// Chinese input (chinese/ime.js) in the other places text is typed; Settings → Chinese in View.
for (const id of ["chatInput", "findInput", "quizCheckText", "practiceFixFront", "practiceFixBack", "practiceExplainedArea", "practiceAskInput"]) if ($(id)) chineseField($(id));
if ($("zhSettingsOpen")) $("zhSettingsOpen").onclick = openZhSettings;
// Math Mode toolbar & R Statistics Bridge (math/math-bar.js).
const mathBar = createMathBar({
  container: $("mathModeBar"),
  status,
  onInsertMathBox: async (tex) => {
    const p = panels[page] || (await openBlankNoteForPrefab("Math Notes"));
    if (!p || !ensureEditableLayer()) return;
    await textBox.placeMath(p, tex);
  },
  onPlotFunction: async (expr) => {
    const cleaned = String(expr || "").replace(/^\s*(?:y|f\(x\))\s*=\s*/i, "").trim();
    await insertCompound(panels[page], "graph", null, { functions: [cleaned || "x^2"] });
  },
  onInsertRPrefab: async () => {
    const rCard = PREFABS.find((c) => c.id === "r-normal") || { id: "r-normal", kind: "prefab", module: "r-math", label: "Normal distribution (R)", spec: { type: "r_figure", schemaVersion: 1, preset: "normal", title: "Normal(0, 1) — 95% Interval", params: { mean: 0, sd: 1, from: -1.96, to: 1.96, region: "between", color: "#245dc4" }, width: 480, height: 300 } };
    await insertPrefab(panels[page], null, rCard);
  },
});
if ($("mathModePill")) $("mathModePill").onclick = () => mathBar.toggle();
if ($("viewMathMode")) $("viewMathMode").onclick = () => { closeMenus?.(); mathBar.toggle(); };
if ($("mathSettingsOpen")) $("mathSettingsOpen").onclick = () => { closeMenus?.(); mathBar.openSettings("math"); };
// Edit PDF (pdf-edit.js): a PDF's printed text turned into text boxes, block by block.
const pdfEdit = pdfEditController({
  call,
  action: (...a) => action(...a),
  status,
  getPanels: () => panels,
  getDoc: () => doc,
  getActiveLayer: () => ensureEditableLayer()?.id ?? activeLayer,
  backgrounds: () => backgrounds,
  point: (e, p) => point(e, p),
  openText: (p, at) => textBox.open(p, at),
  // An object taken out of the PDF: selected with Select, to drag it.
  selectNew: (p) => {
    document.querySelector('#toolbar [data-tool="select"]')?.click();
    selection.selectId(p.index, `image:${doc.edit_count - 1}`);
  },
  isBusy: () => busy(),
});
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
// The raster a page shows (a canvas, or a picture's URL), to release.
const shownRaster = (render) => render?.querySelector(":scope > canvas.pdf-raster") || render?.querySelector("[data-background] > image:not(.pdf-detail)")?.getAttribute("href");
// When the pages last scrolled or zoomed (scrollPause: PDF rasters wait for a pause).
let lastScrollAt = 0;
// Fast zoom sharpening of PDF pages (pdf-detail.js).
const { ZOOM_DETAIL_PAUSE_MS, dropDetail, pdfImage, rasterWidthFor, scheduleDetail } = pdfDetail({
  $,
  INK_HEAVY,
  ns,
  placeRaster,
  app: {
    get backgrounds() { return backgrounds; },
    get displayQuality() { return displayQuality; },
    get doc() { return doc; },
    get panels() { return panels; },
    get pinch() { return pinch; },
    get zoomDetail() { return zoomDetail; },
  },
});
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
  // A strip of tape gets its stripes as shapes (tape-stripes.js): Safari on iPad painted the
  // pattern as a solid white box. The pattern stays for anything else striped.
  if (render) stripeTapes(render);
  const pattern = render?.querySelector('pattern[id^="ncTape"]');
  if (!pattern) return;
  const id = `ncTape-p${key}`;
  pattern.id = id;
  for (const style of render.querySelectorAll("defs > style")) if (style.textContent.includes("nc-tape-pattern")) style.remove();
  for (const el of render.querySelectorAll(".nc-tape-pattern :is(path, rect, circle, polygon, polyline):not(.tape-stripes)")) {
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
// Thumbnails in the page list, and its current page (page-thumbnails.js).
const { markPage, pageEdits, queueThumbnail, refreshThumbnailsSoon, thumbQueue, thumbsDue, updatePagePreview } = pageThumbnails({
  call,
  paintTapes,
  pdfImage,
  syncPageMoveMenus,
  app: {
    get backgrounds() { return backgrounds; },
    get doc() { return doc; },
    get epoch() { return epoch; },
    get gesture() { return gesture; },
    get mutationPending() { return mutationPending; },
    get page() { return page; },
    get panels() { return panels; },
  },
});
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
// The bar is fitted again whenever its width changes: a note opening (the bar was hidden on
// Home and measured nothing), the side panels, the window. Height changes are its own doing.
{
  let fittedWidth = -1;
  new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width === fittedWidth) return;
    fittedWidth = width;
    fitTools();
  }).observe($("toolbar"));
}
function fitTools() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const bar = $("toolbar"), tools = bar.querySelector(".segmented"), actions = document.querySelector(".toolbar-actions");
    const opts = $("toolOptions");
    const wasInline = opts.classList.contains("inline");
    if (wasInline) opts.classList.remove("inline");
    bar.classList.remove("tools-icons");
    const overflowing = phoneLayout.matches
      ? tools.scrollWidth > tools.clientWidth + 1
      : tools.scrollWidth > tools.clientWidth + 1 || bar.scrollWidth > bar.clientWidth + 1 || tools.getBoundingClientRect().right > bar.getBoundingClientRect().right || actions.offsetTop > tools.offsetTop + 4;
    bar.classList.toggle("tools-icons", !toolNamesOn() || overflowing);
    toolOptions();
  });
}
// View → Hide the menu bar: the bar with File, Edit, View… slides up out of sight and peeks
// out again while the pointer is at the top edge (or a menu in it is open). Remembered here.
function setMenuBarAutoHide(on) {
  document.body.classList.toggle("menubar-autohide", on);
  $("menuBarAutoHide").setAttribute("aria-checked", String(on));
  try { localStorage.setItem("notecomplete-menubar-autohide", on ? "1" : "0"); } catch { /* Optional. */ }
  if (doc) requestAnimationFrame(resize);
}
try { setMenuBarAutoHide(localStorage.getItem("notecomplete-menubar-autohide") === "1"); } catch { /* Optional. */ }
// Escape out of one of its menus lets a hidden bar slide away again (focus would hold it out).
addEventListener("keyup", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("menubar-autohide") && $("commandBar").contains(document.activeElement) && !$("commandBar").querySelector("details[open]")) document.activeElement.blur();
});
$("menuBarAutoHide").onclick = () => {
  const on = $("menuBarAutoHide").getAttribute("aria-checked") !== "true";
  setMenuBarAutoHide(on);
  status(on ? "Menu bar hidden: move the pointer to the top edge to see it." : "Menu bar shown.");
};
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
// or the bottom, or as columns on the left or right, like the drawing tablet's dock. Every layout but a
// phone held upright uses it (style.css); remembered on this device.
function setLandscapeDock(side) {
  if (!["top", "bottom", "left", "right"].includes(side)) side = "top";
  document.body.dataset.landscapeDock = side;
  for (const b of document.querySelectorAll("[data-dock-menu]")) b.setAttribute("aria-pressed", String(b.dataset.dockMenu === side));
  // The page row's own button shows where the bar is now and moves it on: top → bottom → left → right.
  const next = DOCK_NEXT[side];
  $("dockCycle").querySelector("svg").innerHTML = document.querySelector(`[data-dock-menu="${side}"] svg`).innerHTML;
  $("dockCycle").title = `Tool bar: ${side}. Move it to the ${next} (also View → Tool bar)`;
  $("dockCycle").setAttribute("aria-label", `Move the tool bar to the ${next}`);
  try { localStorage.setItem("notecomplete-landscape-dock", side); } catch { /* Optional. */ }
  if (doc) requestAnimationFrame(() => { resize(); toolOptions(); });
}
const DOCK_NEXT = { top: "bottom", bottom: "left", left: "right", right: "top" };
$("dockCycle").onclick = () => setLandscapeDock(DOCK_NEXT[document.body.dataset.landscapeDock] || "bottom");
for (const b of document.querySelectorAll("[data-dock-menu]")) b.onclick = () => { setLandscapeDock(b.dataset.dockMenu); for (const m of document.querySelectorAll("details.menu")) m.open = false; };
try { setLandscapeDock(localStorage.getItem("notecomplete-landscape-dock")); } catch { setLandscapeDock("top"); }
phoneLayout.addEventListener("change", placeToolbarActions);
addEventListener("resize", fitTools);
placeToolbarActions();
syncPagePanel();
function placeholder(p) {
  dropDetail(p);
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
function spreadFitWidth(space, colGap, spreadMode, pageCount) {
  const gap = Number.isFinite(colGap) && colGap >= 0 ? colGap : 24;
  if (spreadMode === 2 && pageCount > 1) return Math.max(1, (space - gap) / 2);
  return Math.max(1, space);
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
  const colGap = parseFloat(styles.columnGap) || parseFloat(styles.gap) || 24;
  const fitWidth = spreadFitWidth(space, colGap, spread, panels.length);
  const reraster = [];
  // Every width first, then every read: a read right after each write laid out the whole
  // document once per page (a long note took 100 ms and more for each zoom step).
  for (const p of panels) p.el.style.width = (fit ? fitWidth : p.size[0] * zoom) + "px";
  for (const p of panels) {
    const width = rasterWidthFor(p.el.clientWidth);
    if (
      p.view?.pdf_background &&
      p.rasterWidth > 0 &&
      Math.abs(width - p.rasterWidth) / p.rasterWidth > 0.08 &&
      !p.loading
    ) {
      // One kept drawn outside the band (keepObserver) is drawn afresh when it comes back.
      if (!p.near && p.index !== page && gesture?.panel !== p) unmountPage(p);
      else reraster.push(p);
    }
  }
  updateZoom();
  selection.render(panels[selection.item?.page]);
  // A zoom step counts as motion: rasters for it wait for the zooming to pause
  // (scrollPause), and so does the sharp part on screen, so steps passed through are
  // never drawn.
  lastScrollAt = performance.now();
  for (const p of reraster) renderPage(p, p.view);
  scheduleDetail(ZOOM_DETAIL_PAUSE_MS);
}
// Decodes a page's embedded pictures (Image.decode, off the main thread) before the page goes
// in; at most a moment, so a slow picture never holds the page back. True when there were some.
async function decodePictures(render) {
  const hrefs = [...render.querySelectorAll('image[href^="data:image/"]')].map((el) => el.getAttribute("href"));
  if (!hrefs.length) return false;
  const decoding = hrefs.map((href) => { const image = new Image(); image.src = href; return image.decode(); });
  await Promise.race([Promise.allSettled(decoding), new Promise((done) => setTimeout(done, 300))]);
  return true;
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
  p.pdfMissed = false;
  p.loading = true;
  const token = ++p.token,
    version = revision,
    note = epoch;
  try {
    const result = provided || (await pageView(p.index));
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
    const parsed = parsedPages.get(p.index);
    if (parsed?.view === result) {
      render.append(document.importNode(parsed.content, true));
      // Most recently used last.
      parsedPages.delete(p.index);
      parsedPages.set(p.index, parsed);
    } else render.innerHTML = result.svg;
    paintTapes(render, p.index);
    // Pictures on the page (prefabs, photos) are decoded before it is shown, off the main
    // thread: Safari decoded them while painting the page coming into view, and a page with
    // a prefab held the scrolling for a third of a second each time it came back.
    if (await decodePictures(render) && (note !== epoch || token !== p.token || version !== revision || gesture?.panel === p)) {
      if (gesture?.panel === p) p.stale = true;
      return;
    }
    // An edit redraws the page's ink; the PDF raster under it stays the same,
    // so the existing image moves over at once instead of blinking out while
    // the background cache answers.
    // With fast zoom sharpening the page raster stays at most window-wide (drawDetail).
    const displayWidth = rasterWidthFor(p.el.clientWidth || p.size[0]);
    // At another width the old raster (placed in page units) stays as a
    // placeholder until the sharper one arrives.
    const inkItems = result.pdf_background ? inkCount(result.svg) : null;
    const kind = result.pdf_background && (inkItems > INK_HEAVY ? "url" : "canvas");
    const rasterQual = displayQuality ? { scale: displayQuality.scale, megapixels: displayQuality.megapixels } : displayQuality;
    const pdfKey = result.pdf_background && JSON.stringify([result.pdf_background, p.size, displayWidth, rasterQual, globalThis.devicePixelRatio || 1, kind]);
    const previous = result.pdf_background && p.pdfKey && JSON.stringify(JSON.parse(p.pdfKey).slice(0, 2)) === JSON.stringify([result.pdf_background, p.size])
      ? p.render?.querySelector(":scope > canvas.pdf-raster, [data-background] > image:not(.pdf-detail)") : null;
    // A canvas (this page's, or the previous one kept until the new raster is ready) lies
    // beneath the SVG, so the SVG's paper must let it through.
    if (kind === "canvas" || previous?.localName === "canvas") underPaper(render);
    let kept = pdfKey === p.pdfKey ? previous : null;
    if (kept) {
      if (kept.localName === "canvas") render.prepend(kept);
      else render.querySelector("[data-background]")?.append(kept);
    } else if (result.pdf_background) {
      // Synchronous cache hit: attach preloaded PDF raster immediately with zero scrollPause flicker.
      const place = backgroundPlacement(result.pdf_background, p.size);
      const cached = backgrounds?.peekRaster(result.pdf_background, p.size, displayWidth * place.share, displayQuality, kind);
      if (cached) {
        if (typeof cached === "string") render.querySelector("[data-background]")?.append(pdfImage(cached, place));
        else {
          underPaper(render);
          const canvas = cached.isConnected && cached.parentNode !== render ? copyCanvas(cached) : cached;
          render.prepend(placeRaster(canvas, place, p.size));
        }
        if (previous) backgrounds?.release(previous.localName === "canvas" ? previous : previous.getAttribute("href"));
        p.pdfKey = pdfKey;
        p.rasterWidth = displayWidth;
        kept = cached;
      } else if (previous) {
        if (previous.localName === "canvas") render.prepend(previous);
        else render.querySelector("[data-background]")?.append(previous);
      }
    }
    applyTapes({ ...p, view: result }, render);
    const overlay = document.createElementNS(ns, "svg");
    overlay.classList.add("overlay");
    overlay.setAttribute("viewBox", `0 0 ${p.size.join(" ")}`);
    // The new page goes in at once with what is still drawn over the old one: others' live
    // lines, and strokes waiting for a render with their edit. Nothing blinks out between.
    if (p.overlay) overlay.append(...p.overlay.querySelectorAll(":scope > .remote-ink"));
    dropDetail(p);
    p.render = render;
    p.overlay = overlay;
    keepHeld(p, shows, true);
    const typing = textBox.isTypingOn(p);
    p.el.replaceChildren(render, overlay, lockMarks(result));
    // The lag log names the page that just came in, with what it holds.
    if (lagLog.on) lagLog.mark(`page ${p.index + 1}: ${inkItems ?? inkCount(result.svg)} items, ${render.querySelectorAll("image").length} pictures, ${Math.round(result.svg.length / 1024)} KB`);
    showHeic(render, result.svg);
    // What the page now shows, for a line added to it without a redraw (addDrawn).
    p.shown = result;
    p.inkItems = inkItems;
    if (resizeMode?.page === p.index) p.el.append(resizeFrame(p));
    textBox.restoreOnRender(p, shows, typing);
    // Text boxes made from a PDF are drawn in its own font (pdf-edit.js), also in a later session.
    pdfEdit.fontsFor(p);
    typesetMath(render, result.texts);
    syncStickyNotes({ ...p, view: result }, render, `${epoch}`);
    // Pinyin over the Chinese in text boxes, when on (chinese/ruby.js).
    // Math and Chinese pinyin overlays on page text boxes, drawn on the SVG after render.
    const svgEl = render.querySelector(":scope > svg");
    if (svgEl && /\p{Script=Han}/u.test(result.svg)) rubySvg(svgEl).catch(() => {});
    find.paint(p);
    find.selectable(p);
    p.pdfReady = !result.pdf_background || !!kept;
    p.ink = indexTimedInk(render, result.timings);
    p.inkRevision = revision;
    p.addedInkKey = "";
    p.addedInk = [];
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
      // Drawing a PDF page holds the main thread for a moment (pdf.js paints on it), so
      // while the pages scroll the ones flying past wait: those in view for a pause or
      // 400 ms at most, those just outside it for the scrolling to stop. One that leaves
      // meanwhile is never drawn.
      await scrollPause(p);
      if (note !== epoch || token !== p.token || version !== revision) return;
      let raster = await backgrounds.raster(
        result.pdf_background,
        p.size,
        displayWidth * place.share,
        displayQuality,
        kind,
        () => note === epoch && token === p.token && version === revision && p.near,
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
    // A raster skipped because the page left the screen while it waited is no error.
    // Its PDF page skipped because it left the band while it waited: drawn when it is back
    // (below, or the page observer), not left blank until the page is taken down and redrawn.
    if (e?.message === "No longer shown") p.pdfMissed = true;
    else if (note === epoch && token === p.token) {
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
      else if (p.near && p.pdfMissed && p.view) renderPage(p, p.view);
      else if (p.view?.pdf_background) scheduleDetail();
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
  if (result && result.visible_imported != null) {
    $("counts").textContent =
      `${result.visible_imported} ${result.visible_imported === 1 ? "item" : "items"} · ${result.visible_added} new`;
  }
  if (Array.isArray(result?.warnings)) $("warnings").textContent = result.warnings.join(" ");
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
  if (!home?.visible && index !== page)
    navHistory.record(currentStop(), { view: "doc", key: docMember?.key || noteEntryKey || find.fingerprint || "open", member: docMember, page: index });
  cancelGesture();
  setPage(index);
  const viewport = $("viewport"), rect = panels[index].el.getBoundingClientRect();
  const within = box ? (box[1] / panels[index].size[1]) * rect.height - viewport.clientHeight / 3 : -24;
  viewport.scrollTop += rect.top - viewport.getBoundingClientRect().top + Math.max(-24, within);
  status(`Page ${index + 1}.`);
}
// Shift scrolls three times as far (fast scrolling with the keyboard).
function scrollViewport(key, fast = false) {
  if ($("editor").hidden) return false;
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
// A wait for the pages to stop scrolling or zooming (renderPage's PDF rasters).
const SCROLL_SETTLE_MS = 150, SCROLL_WAIT_MAX_MS = 400;
async function scrollPause(p) {
  const start = performance.now();
  for (;;) {
    const now = performance.now(), since = now - lastScrollAt;
    if (since >= SCROLL_SETTLE_MS) return;
    if (now - start >= SCROLL_WAIT_MAX_MS) {
      const box = p.el.getBoundingClientRect(), view = $("viewport").getBoundingClientRect();
      if (box.bottom > view.top && box.top < view.bottom) return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(16, SCROLL_SETTLE_MS - since)));
  }
}
$("viewport").onscroll = () => {
  lastScrollAt = performance.now();
  document.body.classList.toggle("bar-compact", barState.observe($("viewport").scrollTop));
  scheduleDetail();
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    if (!doc) return;
    const top = $("viewport").getBoundingClientRect().top + 80;
    const rowBottom = (i) => {
      if (spread !== 2) return panels[i].el.getBoundingClientRect().bottom;
      const start = i & ~1;
      const a = panels[start].el.getBoundingClientRect().bottom;
      const b = panels[start + 1]?.el.getBoundingClientRect().bottom ?? -Infinity;
      return Math.max(a, b);
    };
    // Usually still on the same page (or its neighbour): two reads instead of a search.
    const here = panels[page]?.el.getBoundingClientRect();
    if (spread === 2) {
      const prevRowStart = (page & ~1) - 2;
      if (here && here.bottom >= top && (prevRowStart < 0 || rowBottom(prevRowStart) < top)) return;
    } else if (here && here.bottom >= top && (page === 0 || panels[page - 1].el.getBoundingClientRect().bottom < top)) {
      return;
    }
    let low = 0,
      high = panels.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (rowBottom(mid) < top) low = mid + 1;
      else high = mid;
    }
    setPage(low);
  });
};
// Tool settings open when a tool is chosen (View menu can turn that off), and
// pressing the selected tool again toggles them.
let toolSettingsAuto = true, optionsOpen = true;
// A wide tool bar shows the tool's settings inline; pressing the selected tool opens them as
// the full panel under it too (bigger swatches and every option), until a press elsewhere.
let optionsPopped = false;
// While the full panel is open from the strip, the strip stays in the tool bar as a copy of
// the panel: what is pressed or changed in it is done on the panel's own control (by its
// place in the tree), and the copy is made again whenever the panel changes.
const toolMirror = (() => {
  let el = null, on = false, row = false, frame = 0, observer = null;
  const pathOf = (node) => { const path = []; for (let n = node; n && n !== el; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n)); return path; };
  const original = (node) => pathOf(node).reduce((n, i) => n?.children[i], $("toolOptions"));
  const build = () => {
    frame = 0;
    if (!on) { if (el) el.hidden = true; return; }
    const copy = $("toolOptions").cloneNode(true);
    copy.id = "toolOptionsMirror";
    copy.hidden = false;
    copy.removeAttribute("style");
    copy.className = `tool-options inline${row ? " inline-row" : ""}`;
    copy.setAttribute("aria-hidden", "false");
    // Its ids go (kept as data-mirror-id): the panel's own controls stay the ones found by id
    // (the View menu's "Pinyin over characters" clicks #zhRubyToggle, which the copy was).
    for (const n of copy.querySelectorAll("[id]")) { n.dataset.mirrorId = n.id; n.removeAttribute("id"); }
    // Values typed or picked are properties, not attributes: carried across by hand.
    const from = $("toolOptions").querySelectorAll("input, select"), to = copy.querySelectorAll("input, select");
    from.forEach((f, i) => { if (to[i]) { to[i].value = f.value; if ("checked" in f) to[i].checked = f.checked; } });
    if (el) el.replaceWith(copy); else $("toolOptions").after(copy);
    el = copy;
    el.addEventListener("click", (e) => {
      const target = e.target.closest("button, label, [role=radio], [role=checkbox], summary");
      if (!target || target.matches("input, select")) return;
      e.preventDefault();
      e.stopPropagation();
      original(target)?.click();
    });
    for (const type of ["input", "change"]) el.addEventListener(type, (e) => {
      const o = original(e.target);
      if (!o) return;
      if ("checked" in e.target && (e.target.type === "checkbox" || e.target.type === "radio")) o.checked = e.target.checked;
      else o.value = e.target.value;
      o.dispatchEvent(new Event(type, { bubbles: true }));
    });
  };
  const later = () => { if (!frame) frame = requestAnimationFrame(build); };
  return {
    show(next, ownRow) {
      if (next === on && ownRow === row && (!on || el)) { if (on) later(); return; }
      on = next; row = ownRow;
      if (on && !observer) {
        observer = new MutationObserver(() => { if (!el?.contains(document.activeElement) || document.activeElement.tagName !== "INPUT") later(); });
        observer.observe($("toolOptions"), { attributes: true, childList: true, subtree: true, characterData: true });
      } else if (!on && observer) { observer.disconnect(); observer = null; }
      build();
    },
  };
})();
try { toolSettingsAuto = localStorage.getItem("notecomplete-tool-settings-auto") !== "0"; } catch { /* Optional. */ }
$("toolSettingsAuto").setAttribute("aria-checked", String(toolSettingsAuto));
$("toolSettingsAuto").onclick = () => {
  toolSettingsAuto = !toolSettingsAuto;
  $("toolSettingsAuto").setAttribute("aria-checked", String(toolSettingsAuto));
  try { localStorage.setItem("notecomplete-tool-settings-auto", toolSettingsAuto ? "1" : "0"); } catch { /* Optional. */ }
  status(toolSettingsAuto ? "Tool settings open when you choose a tool." : "Press the selected tool again to see its settings.");
};
function hasToolSettings() {
  const textDock = !$("textFormat").hidden && $("textFormat").parentElement === $("toolOptions");
  return ["draw", "highlight", "shape", "tape", "erase", "text"].includes(tool) || (tool === "select" && !!selection.item) || textDock;
}
function inlineToolOptionsSpace() {
  const dock = document.body.dataset.landscapeDock;
  if (chromeState.compact || phoneLayout.matches || dock === "left" || dock === "right") return 0;
  const bar = $("toolbar"), seg = bar?.querySelector(".segmented"), act = bar?.querySelector(".toolbar-actions");
  if (!bar || !seg || !act || !bar.clientWidth) return 0;
  const cs = getComputedStyle(bar);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return bar.clientWidth - pad - seg.offsetWidth - act.offsetWidth - 24;
}
function toolOptions() {
  $("shapeOptions").hidden = tool !== "shape";
  $("highlightOptions").hidden = tool !== "highlight";
  $("tapeOptions").hidden = tool !== "tape";
  $("pressureOptions").hidden = tool !== "draw";
  $("snapOptions").hidden = tool !== "draw";
  $("drawingOptions").hidden = tool === "select" || tool === "text";
  // The eraser shows only its size; color and width do not apply to it.
  $("drawingOptions").classList.toggle("erasing", tool === "erase");
  $("drawingOptions").dataset.forTool = tool;
  $("eraseOptions").hidden = tool !== "erase";
  $("selectionOptions").hidden = tool !== "select" || !selection.item;
  textBox.syncFormat({ quiet: true });
  // The text format bar, when docked here, shows for Text tool and while a text box is typed or selected.
  const canOpen = hasToolSettings();
  const textDock = !$("textFormat").hidden && $("textFormat").parentElement === $("toolOptions");
  // Inline beside the tools when they leave room; otherwise inline too, as a row of its own
  // under them (on any screen, not only wide ones), unless the bar is docked at a side.
  const space = inlineToolOptionsSpace(), side = ["left", "right"].includes(document.body.dataset.landscapeDock);
  const ownRow = space < 220 && !chromeState.compact && !side;
  const fits = space >= 220 || ownRow;
  const useInline = !optionsPopped && fits;
  const opts = $("toolOptions");
  opts.classList.toggle("inline", useInline);
  opts.classList.toggle("inline-row", useInline && ownRow);
  if (useInline) {
    opts.style.left = "";
    opts.hidden = chromeState.compact || !canOpen;
    $("toolbarToggle").hidden = true;
  } else {
    const usual = (optionsOpen || optionsPopped) && (["draw", "highlight", "shape", "tape", "erase", "text"].includes(tool) || (tool === "select" && selection.item));
    opts.hidden = chromeState.compact || !(usual || textDock);
    $("toolbarToggle").hidden = !canOpen;
  }
  $("toolbarToggle").setAttribute("aria-expanded", String(!opts.hidden));
  syncChoices();
  placeToolOptions();
  if (!opts.hidden && !useInline && !toolOptionsPlace) {
    const anchor = document.querySelector(`#toolbar [data-tool="${tool}"]`), bar = $("toolbar").getBoundingClientRect();
    if (anchor && !matchMedia("(max-width: 700px)").matches) {
      const left = anchor.getBoundingClientRect().left - bar.left;
      opts.style.left = `${Math.max(8, Math.min(left, bar.width - opts.offsetWidth - 8))}px`;
    }
  }
  toolMirror.show(optionsPopped && fits && !opts.hidden && !chromeState.compact, ownRow);
  // The panel opens under the strip's own row, not over it.
  const mirror = $("toolOptionsMirror");
  opts.style.top = !opts.classList.contains("placed") && !useInline && mirror && !mirror.hidden && ownRow ? `calc(100% + ${mirror.offsetHeight + 4}px)` : opts.classList.contains("placed") ? opts.style.top : "";
  const settingsLabel = opts.hidden ? "Show tool settings" : "Hide tool settings";
  $("toolbarToggle").setAttribute("aria-label", settingsLabel);
  $("toolbarToggle").title = settingsLabel;
}
// Where the tool settings were dragged ({ x, y } in the window), kept on this device; none:
// under their tool.
const TOOL_PLACE_KEY = "notecomplete-tool-options-place";
let toolOptionsPlace = null;
try { const v = JSON.parse(localStorage.getItem(TOOL_PLACE_KEY) || "null"); if (Number.isFinite(v?.x) && Number.isFinite(v?.y)) toolOptionsPlace = v; } catch { /* Optional. */ }
function placeToolOptions() {
  const opts = $("toolOptions"), placed = !!toolOptionsPlace && !opts.classList.contains("inline");
  opts.classList.toggle("placed", placed);
  if (!placed) { opts.style.top = ""; if (opts.style.position) opts.style.position = ""; return; }
  // Kept inside the window, however it was resized or zoomed since.
  const z = uiZoom(), vw = innerWidth / z, vh = innerHeight / z;
  const w = opts.offsetWidth || 200, h = opts.offsetHeight || 40;
  opts.style.left = `${Math.max(4, Math.min(vw - w - 4, toolOptionsPlace.x))}px`;
  opts.style.top = `${Math.max(4, Math.min(vh - h - 4, toolOptionsPlace.y))}px`;
}
function resetToolOptionsPlace() {
  toolOptionsPlace = null;
  try { localStorage.removeItem(TOOL_PLACE_KEY); } catch { /* Optional. */ }
  $("toolOptions").style.left = "";
  toolOptions();
}
$("toolOptionsGrip").addEventListener("pointerdown", (down) => {
  if (down.button !== 0) return;
  down.preventDefault();
  const z0 = uiZoom();
  const opts = $("toolOptions"), r = opts.getBoundingClientRect(), dx = down.clientX / z0 - r.left / z0, dy = down.clientY / z0 - r.top / z0;
  const grip = $("toolOptionsGrip");
  try { grip.setPointerCapture(down.pointerId); } catch { /* Released already. */ }
  opts.classList.add("dragging");
  const move = (e) => { const z = uiZoom(); toolOptionsPlace = { x: Math.round(e.clientX / z - dx), y: Math.round(e.clientY / z - dy) }; placeToolOptions(); };
  const up = () => {
    grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
    opts.classList.remove("dragging");
    if (toolOptionsPlace) { try { localStorage.setItem(TOOL_PLACE_KEY, JSON.stringify(toolOptionsPlace)); } catch { /* Optional. */ } status("Tool settings stay here. Double-click their grip (or View → Reset tool settings position) to put them back."); }
  };
  grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
});
$("toolOptionsGrip").addEventListener("dblclick", resetToolOptionsPlace);
$("resetToolOptionsPlace").onclick = resetToolOptionsPlace;
addEventListener("resize", () => toolOptionsPlace && placeToolOptions());
function setCompact(compact) {
  const changed =
    document.body.classList.contains("compact-chrome") !== compact;
  document.body.classList.toggle("compact-chrome", compact);
  chromeState.compact = compact;
  toolOptions();
  if (changed) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        chromeState.anchor = $("viewport").scrollTop;
      }),
    );
  }
}
$("toolbarToggle").onclick = () => {
  cancelGesture();
  if (!hasToolSettings()) return;
  optionsOpen = $("toolOptions").hidden;
  if (optionsOpen && chromeState.compact) setCompact(false);
  else toolOptions();
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
    if (addedStore?.recording?.mode === "animation" && addedStore.recording.here) {
      if (op === "draw") {
        const drawnId = drawnItems.get(result)?.id ?? `new:${result.edit_count - 1}`;
        addedStore.recordTiming(drawnId, args.page ?? page);
      } else if (op === "drawMany") {
        const count = (args.lines?.length || 0) + (args.images?.length || 0);
        for (let k = count; k > 0; k--) {
          addedStore.recordTiming(`new:${result.edit_count - k}`, args.page ?? page);
        }
      }
    }
    if (edited(op, args, result)) return;
    // A new shape is selected to adjust it, except on a drawing tablet (it keeps drawing shapes).
    if (op === "draw" && args.line.shape && !args.recognized && !gesture && collab?.role !== "tablet") {
      document.querySelector("[data-tool=select]").click();
      selection.selectId(args.page ?? page, drawnItems.get(result)?.id ?? `new:${result.edit_count - 1}`);
    } else if (selection.item) {
      selection.selectId(selection.item.page, selection.item.id);
    }
    if (hold) hold.revision = revision;
    showEdit(op, args, result);
    // Ordinary edits say nothing: the save icon in the bar shows there are unsaved changes.
    if (collab?.role !== "tablet" && op === "restack") status(`${RESTACKED[args.to] || "Moved."} You can undo this change.`);
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
  const prevDoc = doc;
  // A tablet's copy is the computer's note: the computer saves it, not the tablet.
  if (collab?.role !== "tablet") dirty = changed = true;
  revision++;
  projectModelController?.invalidate?.();
  // Item-level patches (adjust/crop) only carry delta metadata, not a full document summary.
  if (!Array.isArray(result?.page_sizes)) {
    if (prevDoc && result) {
      Object.assign(prevDoc, {
        can_undo: result.can_undo ?? prevDoc.can_undo,
        can_redo: result.can_redo ?? prevDoc.can_redo,
        edit_count: result.edit_count ?? prevDoc.edit_count,
      });
    }
    doc = prevDoc;
    savedState();
    return false;
  }
  doc = result;
  savedState();
  const audioStateKey = (d) => `${d?.audio?.length || 0}:${(d?.recordings || []).map((r) => `${r.id}${r.animation ? "a" : ""}`).join(",")}`;
  if (op === "deleteAudio" || op === "stripAudioMedia" || ((op === "undo" || op === "redo") && audioStateKey(result) !== audioStateKey(prevDoc))) {
    audio.setNative(result.audio || [], result.recordings || []);
    recordingState();
  }
  // An infinite canvas that grew (or shrank on undo) keeps its place on screen: the
  // page is resized where it is and redrawn, not rebuilt.
  const size = result.page_sizes[0];
  if (result.canvas && result.pages === 1 && panels.length === 1 && (size[0] !== panels[0].size[0] || size[1] !== panels[0].size[1])) {
    panels[0].size = size;
    panels[0].el.style.aspectRatio = size.join("/");
    resize();
    return false;
  }
  const orderChanged = Array.isArray(result.page_order) && (result.page_order.length !== panels.length || result.page_order.some((slot, i) => slot !== panels[i].slot));
  if (orderChanged || result.pages !== panels.length || result.page_sizes.some((s, i) => s[0] !== panels[i].size[0] || s[1] !== panels[i].size[1])) {
    let focus = args.focus;
    if (focus === undefined) {
      const currentSlot = panels[page]?.slot;
      const movedTo = currentSlot !== undefined && Array.isArray(result.page_order) ? result.page_order.indexOf(currentSlot) : -1;
      focus = movedTo >= 0 ? movedTo : Math.min(page, result.pages - 1);
    }
    const msg = op === "resizePage" ? "Page resized. You can undo this change."
      : op === "resizePages" ? `All ${result.pages} pages resized. One undo restores them.`
      : op === "setPageBackgrounds" ? `Updated background on ${args.pages.length} page${args.pages.length === 1 ? "" : "s"}. One undo restores it.`
      : op === "movePage" ? "Page moved. You can undo this change."
      : undefined;
    restructure(result, focus, msg);
    return true;
  }
  return false;
}
function showEdit(op, args, result) {
  updateTools(result);
  if (Array.isArray(result.layers)) layerPanel(result.layers);
  // Ink edits change one page; undo, redo and layers may change any.
  const only = ["draw", "drawMany", "erase", "remove", "lock", "restack", "image", "editText", "adjust", "crop", "resize"].includes(op) ? args.page : null;
  const fullView = Boolean(result?.size && Array.isArray(result?.layers));
  const newBackground = op === "setPageBackgrounds" || op === "replacePdfText";
  const affected = newBackground && Array.isArray(args.pages) ? new Set(args.pages.map((p) => p.page)) : null;
  const bgDirty = newBackground || op === "undo" || op === "redo";
  for (const p of panels) {
    if (only != null && p.index !== only) continue;
    if (affected && !affected.has(p.index)) continue;
    p.edits = pageEdits(p) + 1;
    p.token++;
    if (bgDirty) {
      // Edit PDF's outlines were of the PDF page shown before; the next hover reads the new one.
      p.el.querySelector(":scope > .pdf-edit-layer")?.remove();
      if (!(p.near || p.index === page)) p.view = null;
      p.thumbnailReady = false;
      updatePagePreview(p, true);
    }
    if (!(p.near || p.index === page)) {
      // Kept drawn just outside the band (keepObserver): drawn again when it comes back.
      if (p.render && gesture?.panel !== p) unmountPage(p);
      continue;
    }
    // Strokes in quick succession: the page is redrawn once the pen pauses. Until then the
    // strokes stay on screen as drawn, and the next one starts at once instead of waiting
    // for the whole page to be rebuilt.
    if (op === "draw" && p.index === result.page && addDrawn(p, result)) continue;
    if (op === "draw" && !args.line?.shape && p.index === result.page) laterRender(p, result);
    else renderPage(p, fullView && p.index === result.page ? result : undefined);
  }
  if (op === "setPageBackgrounds" && Array.isArray(args.pages))
    status(`Updated background on ${args.pages.length} page${args.pages.length === 1 ? "" : "s"}. One undo restores it.`);
}
// A drawn line joins the page on screen as one element, and the page is not drawn again,
// when the page shows exactly the view the line was put into (viewAfter). False, with
// nothing changed, in every other case, and the page is then drawn from the whole view as
// before: no such view, the page being drawn or not on screen, a stroke in progress on it
// (its render waits for the pen, renderPage), the element's place not found (a layer's
// first tape, a page with no tape stripes yet), or a PDF page that with this line passes
// INK_HEAVY and changes how its PDF is shown.
function addDrawn(p, view) {
  const made = drawnItems.get(view);
  if (!made?.drawn || made.base !== p.view || p.shown !== p.view || p.loading || gesture?.panel === p) return false;
  const svg = p.render?.isConnected && p.render.parentNode === p.el ? p.render.querySelector(":scope > svg") : null;
  if (!svg || (view.pdf_background && p.inkItems === INK_HEAVY)) return false;
  const holder = document.createElementNS(ns, "g");
  holder.innerHTML = made.drawn.item;
  if (holder.childElementCount !== 1 || !placeDrawnItem(svg, made.drawn, holder.firstElementChild)) return false;
  // The view on screen becomes the new one in place: what is working from it (find.js
  // checks the page still has the view it started with) goes on.
  Object.assign(p.view, view);
  p.viewRevision = revision;
  clearTimeout(p.renderTimer);
  p.pendingView = null;
  if (p.inkItems != null) p.inkItems++;
  if (made.drawn.tape) {
    paintTapes(p.render, p.index);
    applyTapes(p);
  }
  // The stroke kept on screen as drawn gives way to the element, as after a render.
  keepHeld(p, revision, true);
  shapeHandles(p);
  updatePagePreview(p);
  return true;
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
    const result = await viewAfter(await call(op, args));
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
// Layers: the panel, the layer edits go to, and ink dimmed to the audio (layer-panel.js).
const { ensureEditableLayer, layerPanel, syncInk } = layerPanelController({
  $,
  action,
  audio,
  resize,
  status,
  app: {
    get activeLayer() { return activeLayer; }, set activeLayer(v) { activeLayer = v; },
    get doc() { return doc; },
    get panels() { return panels; },
  },
});
function cancelGesture() {
  selection.cancel();
  const g = gesture;
  gesture = null;
  if (!g) return;
  if (g.tool === "pan") pagesScroll.end();
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
// `r`: the page's box, when the caller already has it (one read for a run of samples).
function point(e, p, r = p.el.getBoundingClientRect()) {
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
// A stylus counts as in use for ten minutes after it last touched or hovered the page, so
// putting it down for a moment (to read, or to think) does not turn fingers into pens.
const PEN_ACTIVE_MS = 10 * 60_000;
installNativeHoverBridge();
let lastPen = -Infinity, lastPenWrote = -Infinity;
const notePen = (e) => {
  if (e.pointerType === "pen") {
    lastPen = performance.now();
    // Touching the page, not hovering: a stylus held near the screen sends hover moves/over
    // so fingers can still pan while the stylus hovers above the page.
    const hoverEvent = !e.buttons && (e.type === "pointermove" || e.type === "pointerover");
    if (!hoverEvent) lastPenWrote = lastPen;
  }
  // Fingers and pens never select the text over the pages (it would pick words while
  // scrolling or drawing); the mouse still does.
  if (e.type === "pointerdown") {
    const touchy = e.pointerType !== "mouse";
    document.body.classList.toggle("touch-pointer", touchy);
    if (touchy && e.target.closest?.(".sheet")) window.getSelection()?.removeAllRanges();
  }
};
for (const type of ["pointerdown", "pointermove", "pointerover", "pointerup"]) window.addEventListener(type, notePen, { capture: true, passive: true });
// Pen smoothing on or off (View menu), per device: off, the line follows the pen exactly.
let smoothingOn = true;
try { smoothingOn = localStorage.getItem("notecomplete-pen-smoothing") !== "0"; } catch { /* Optional. */ }
const smoothingSwitch = () => {
  $("penSmoothToggle").setAttribute("aria-checked", String(smoothingOn));
  $("smoothToolToggle").setAttribute("aria-pressed", String(smoothingOn));
};
$("smoothToolToggle").onclick = () => $("penSmoothToggle").click();
smoothingSwitch();
$("penSmoothToggle").onclick = () => {
  smoothingOn = !smoothingOn;
  try { localStorage.setItem("notecomplete-pen-smoothing", smoothingOn ? "1" : "0"); } catch { /* Optional. */ }
  smoothingSwitch();
  status(smoothingOn ? "Pen smoothing on." : "Pen smoothing off: strokes follow the pen exactly.");
};
// Pen hover preview and touch tooltips (pen-hover.js).
const { penHoverEnabled } = penHoverAndTips({
  $,
  closeMenus,
  status,
  uiZoom,
  app: {
    get doc() { return doc; },
    get eraserRadius() { return eraserRadius; },
    get panels() { return panels; },
    get tool() { return tool; },
  },
});
const penActive = () => performance.now() - lastPen < PEN_ACTIVE_MS;
// Select and Grab text too: with a stylus in hand, a finger drag moves the page, as in drawing apps.
const FINGER_PANS = new Set(["draw", "highlight", "erase", "tape", "shape", "select", "grab"]);
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
  if (thumbsDue.size) refreshThumbnailsSoon();
  if (gesture) {
    if (e.pointerId === gesture.id) return;
    // A stylus has one tip: a new pen-down means the last stroke's lift never arrived
    // (iPadOS can swallow it). That stroke is kept and the new one starts at once.
    // A finger while the stylus has sent nothing for a moment means the same: the pen is up
    // (hovering or away), so its stroke is kept and the finger moves the page.
    const penQuiet = e.pointerType === "touch" && e.timeStamp - (gesture.lastAt ?? -Infinity) > 250;
    if (gesture.pen && gesture.lastClient && (e.pointerType === "pen" || penQuiet)) {
      const [clientX, clientY] = gesture.lastClient;
      pointerUp({ pointerId: gesture.id, clientX, clientY, timeStamp: e.timeStamp });
    } else {
      cancelGesture();
      return;
    }
  }
  if (!doc || editing || !p.view || e.button !== 0) return;
  // A resting palm neither draws nor moves the page.
  if (palmPointer(e)) return;
  // A link written in the handwriting opens on click (Pan and Select); no drag starts.
  if (e.target.closest?.(".ink-link") && (tool === "pan" || tool === "select")) return;
  setPage(p.index);
  // While a stylus is in use, fingers move the page instead of drawing (palm and finger
  // rejection, as in drawing apps); with the stylus put away, a finger draws again. With Pan
  // a finger always moves the page, in script, so a second finger can pinch (touch.js).
  const touchPan = collab?.touchPans(e) || (e.pointerType === "touch" && (tool === "pan" || (penActive() && FINGER_PANS.has(tool))));
  // Text with a finger or stylus: the box opens when the tap lifts, since phones open the
  // keyboard only for a focus made then (not when the tap starts); a drag moves the page.
  const textTap = tool === "text" && e.pointerType !== "mouse" && !textBox.active;
  if (tool === "pdfedit" && !touchPan) {
    if (!e.target.closest?.(".text-editor, .text-discard")) pdfEdit.down(e, p);
    return;
  }
  if (!touchPan && selection.down(e, p, tool)) return;
  if (tool === "pan" || touchPan || textTap) {
    // On PDF or recognized words the mouse selects text instead of panning. A stylus pans in
    // script too: the page lets the browser scroll nothing with Pan (touch-action: none, so a
    // second finger reaches the pinch), so leaving it to the browser left a pen stuck.
    if (!touchPan && !textTap && e.pointerType === "mouse" && e.target.closest?.(".text-layer tspan")) return;
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
    pagesScroll.begin();
    p.el.setPointerCapture(e.pointerId);
    return;
  }
  if (tool === "text") {
    e.preventDefault();
    const at = point(e, p);
    if (textBox.active || e.button !== 0 || e.pointerType !== "mouse") {
      textBox.open(p, at);
      return;
    }
    // In Text mode: holding left click (≥ 220ms) or dragging (> 5px) on an existing text box moves
    // it directly without switching to Select or entering edit mode; a quick click edits it.
    const startX = e.clientX, startY = e.clientY, pointerId = e.pointerId, noteToken = epoch;
    let lastEv = e, finished = false, picked = null, startedDrag = false, holdTimer = 0;
    const cleanup = () => {
      clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
    };
    const startDrag = () => {
      if (finished || startedDrag || !picked || noteToken !== epoch || tool !== "text") return;
      startedDrag = true;
      finished = true;
      cleanup();
      selection.dragItem(lastEv, p, picked, { keepTool: true });
    };
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId || finished) return;
      lastEv = ev;
      if (picked && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) startDrag();
    };
    const onUp = (ev) => {
      if (ev.pointerId !== pointerId || finished) return;
      finished = true;
      cleanup();
      if (noteToken === epoch && tool === "text") textBox.open(p, at);
    };
    const onCancel = (ev) => {
      if (ev.pointerId !== pointerId || finished) return;
      finished = true;
      cleanup();
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    call("pick", { page: p.index, x: at[0], y: at[1], tolerance: 4 }).then((item) => {
      if (finished || noteToken !== epoch || tool !== "text") return;
      if (item?.kind !== "text") {
        finished = true;
        cleanup();
        textBox.open(p, at);
        return;
      }
      picked = item;
      if (Math.hypot(lastEv.clientX - startX, lastEv.clientY - startY) > 5) {
        startDrag();
      } else {
        holdTimer = setTimeout(startDrag, 220);
      }
    }).catch(() => {
      if (finished) return;
      finished = true;
      cleanup();
      if (noteToken === epoch && tool === "text") textBox.open(p, at);
    });
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
  if (tool !== "erase" && !ensureEditableLayer()) {
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
    sampledAt: e.timeStamp,
    // The Shapes tool's kind when the drag started (a graph or table opens its editor at the end).
    kind: tool === "shape" ? $("shape").value : null,
  };
  // A stylus stroke with pressure is drawn meanwhile as the page will draw it (runOutline):
  // the same widths along it, so nothing changes shape when the pen lifts.
  if (gesture.pen && tool === "draw" && pressureOn()) {
    gesture.ink = document.createElementNS(ns, "path");
    gesture.ink.setAttribute("fill", color);
    el.style.display = "none";
    p.overlay.append(gesture.ink);
  }
  // Tape shows its stripes while it is laid, as it will on the page.
  if (tool === "tape" && !box) {
    gesture.stripes = document.createElementNS(ns, "path");
    gesture.stripes.setAttribute("fill", "#fff");
    gesture.stripes.setAttribute("fill-opacity", "0.42");
    p.overlay.append(gesture.stripes);
  }
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
// The line drawn meanwhile is updated once a frame (a stylus reports up to 240 moves a
// second), and a freehand line only gets its new points rather than all of them again.
let previewFrame = 0;
function previewSoon() {
  if (!previewFrame) previewFrame = requestAnimationFrame(() => { previewFrame = 0; preview(); });
}
function flushPreview() {
  if (!previewFrame) return;
  cancelAnimationFrame(previewFrame);
  previewFrame = 0;
  preview();
}
function showPoints(g) {
  const list = g.el.points, svg = g.el.ownerSVGElement;
  if (g.shown?.of === g.points && list && svg && list.numberOfItems === g.shown.count && g.shown.count <= g.points.length) {
    for (let i = g.shown.count; i < g.points.length; i++) {
      const q = svg.createSVGPoint();
      q.x = g.points[i][0]; q.y = g.points[i][1];
      list.appendItem(q);
    }
  } else {
    g.el.setAttribute("points", g.points.map((p) => p.join(",")).join(" "));
  }
  g.shown = { of: g.points, count: g.points.length };
}
// The pressure stroke's outline; false when there is none to show (the plain line shows).
function showInk(g) {
  const { pressure } = stylusPressure(g);
  if (!pressure?.length) {
    g.el.style.display = "";
    g.ink.removeAttribute("d");
    return false;
  }
  g.el.style.display = "none";
  g.ink.setAttribute("d", runOutline(g.points, pressure));
  g.dot.style.display = "none";
  return true;
}
function preview() {
  const g = gesture;
  if (!g || g.tool === "pan" || g.textMode) return;
  if (g.tool === "grab") {
    const [x, y, w, h] = grabRect(g);
    for (const [k, v] of Object.entries({ x, y, width: w, height: h })) g.el.setAttribute(k, v);
    return;
  }
  showPoints(g);
  if (g.stripes) g.stripes.setAttribute("d", tapeStripes(g.points, g.width));
  if (g.ink && showInk(g)) return;
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
    const box = g.panel.el.getBoundingClientRect();
    for (const sample of samples.length ? samples : [e]) {
      // A stylus sample with no pressure is the pen off the glass: the lift (pointerup and the
      // last coalesced samples) or hovering. Drawing it left a tail where the pen came away.
      if (g.pen && !(sample.pressure > 0)) continue;
      const raw = point(sample, g.panel, box),
        last = g.points.at(-1);
      g.raw = raw;
      // An Apple Pencil's first touch often reports no pressure yet: the stroke would start as
      // a needle. It takes the first pressure the pen reports instead.
      if (g.pen && !(g.pressures[0] > 0) && sample.pressure > 0) g.pressures[0] = sample.pressure;
      const dt = g.sampledAt === undefined ? undefined : sample.timeStamp - g.sampledAt;
      g.sampledAt = sample.timeStamp;
      const p = followPoint(last, raw, g.smooth, g.smooth ? extentSoFar(g) : Infinity, dt);
      if (
        Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.3 &&
        g.points.length < 8192
      ) {
        g.points.push(p);
        g.pressures.push(sample.pressure);
        if (g.extent) grow(g.extent, p);
      }
    }
    // A stylus stroke is saved with its pressure: the line drawn meanwhile takes the
    // same average width, so it does not get thinner when it is finished.
    if (g.pen && g.tool === "draw" && !g.ink) {
      const { pressure } = stylusPressure(g);
      if (pressure?.length) g.el.setAttribute("stroke-width", (2 * pressure.reduce((s, r) => s + r, 0)) / pressure.length);
    }
    watchHold(g, e);
  }
  if (g.snapped) return collab?.drawing(g);
  previewSoon();
  collab?.drawing(g);
}
// The size of the line so far, kept as it grows instead of measured again for every point.
function extentSoFar(g) {
  if (g.extent?.of !== g.points) {
    g.extent = { of: g.points, box: [Infinity, Infinity, -Infinity, -Infinity] };
    for (const p of g.points) grow(g.extent, p);
  }
  const [x0, y0, x1, y1] = g.extent.box;
  return g.points.length ? Math.hypot(x1 - x0, y1 - y0) : 0;
}
function grow(extent, [x, y]) {
  const b = extent.box;
  if (x < b[0]) b[0] = x;
  if (y < b[1]) b[1] = y;
  if (x > b[2]) b[2] = x;
  if (y > b[3]) b[3] = y;
}
// Shape recognition (shape-recognize.js; docs/SHAPES-TABLES-MATH.md): with the Pen, a stroke
// held still for a moment becomes the shape it looks like (or, opt-in, on every lift).
const shapeSnap = () => $("shapeSnap").value;
const SNAP_HOLD_MS = 550;
// View → Shapes from the pen: on (hold, or on lift when chosen in the Pen's settings) or off.
function syncShapeSnapMenu() { $("shapeSnapMenu").setAttribute("aria-checked", String(shapeSnap() !== "off")); }
$("shapeSnap").addEventListener("change", syncShapeSnapMenu);
// Turning it back on brings the mode that was chosen before (Hold or On lift), not always Hold.
let shapeSnapLastOn = shapeSnap() === "off" ? "hold" : shapeSnap();
$("shapeSnap").addEventListener("change", () => { if (shapeSnap() !== "off") shapeSnapLastOn = shapeSnap(); });
$("shapeSnapMenu").onclick = () => {
  $("shapeSnap").value = shapeSnap() === "off" ? shapeSnapLastOn : "off";
  $("shapeSnap").dispatchEvent(new Event("change"));
  syncChoices();
  status(shapeSnap() === "off" ? "Shapes from the pen off: strokes stay as drawn." : shapeSnap() === "lift" ? "Shapes from the pen: clean shapes snap as you lift the pen." : "Shapes from the pen: hold the pen still at the end of a stroke to make it a shape.");
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
  if (g.ink) { g.ink.remove(); g.ink = null; g.el.style.display = ""; }
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
function trimLiftTail(g) {
  const peak = Math.max(0, ...g.pressures.filter(Number.isFinite));
  if (peak < 0.2) return;
  let end = g.pressures.length;
  while (end > 2 && g.pressures[end - 1] < 0.05) end--;
  if (end === g.pressures.length) return;
  g.points.length = g.pressures.length = end;
  g.raw = g.points.at(-1);
}
// Pen pressure from a stylus, as the core stores it: the drawn radius at each point
// (editor.rs). Light pressure draws about a third of the width, a firm press about 1.7×.
// The pressure this pen usually writes with is drawn at the pen's width (remembered on this
// device); harder is wider, lighter thinner. The same for the whole stroke, so its width
// follows the pressure only, not how long it has been going.
let penPressureBase = (() => { try { const v = Number(localStorage.getItem("notecomplete-pen-pressure-base")); return v > 0 ? v : NaN; } catch { return NaN; } })();
function learnPenPressure(g) {
  if (!g.pen || g.tool !== "draw") return;
  const next = nextPressureBase(penPressureBase, g.pressures);
  if (next === penPressureBase || !Number.isFinite(next)) return;
  penPressureBase = next;
  try { localStorage.setItem("notecomplete-pen-pressure-base", String(Math.round(next * 1000) / 1000)); } catch { /* Kept for this session only. */ }
}
function stylusPressure(g) {
  if (!g.pen || !pressureOn() || g.pressures.length !== g.points.length) return {};
  // A pen not learnt yet takes this stroke's own first pressures as its usual one.
  g.base ??= Number.isFinite(penPressureBase) ? penPressureBase : (g.pressures.length >= 5 ? nextPressureBase(NaN, g.pressures) : undefined);
  const radii = pressureRadii(g.pressures, g.points, g.width / 2, g.base ?? 0.5);
  return { pressure: radii.map((r) => Math.round(r * 1000) / 1000) };
}
// Mouse wheel click (middle button) drags the pages with any tool, as Pan does; text
// documents scroll the same way. It never auto-scrolls or pastes the primary selection.
let middleMouseAt = -Infinity;
for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "auxclick"]) {
  document.addEventListener(type, (e) => {
    if (e.button !== 1) return;
    middleMouseAt = performance.now();
    if ((type === "mouseup" || type === "auxclick") && !e.target?.closest?.("input, textarea, [contenteditable], .TinyMDE, math-field")) {
      e.preventDefault();
    }
  }, true);
}
function middlePan(el, fraction = null) {
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 1 || e.pointerType !== "mouse") return;
    // Editors with their own canvas (UML: a .puml file, a prefab on the page) pan it themselves.
    if (e.target.closest?.(".uml-editor")) return;
    middleMouseAt = performance.now();
    e.preventDefault();
    e.stopPropagation();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    fraction?.begin();
    el.setPointerCapture(e.pointerId);
    el.classList.add("middle-panning");
  }, true);
  // Pointer events can outnumber frames: only the latest position is written, once a frame.
  let frame = 0, latest = null;
  const apply = () => {
    frame = 0;
    if (!drag || !latest) return;
    if (fraction) return fraction.to(drag.left + drag.x - latest[0], drag.top + drag.y - latest[1]);
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
    middleMouseAt = performance.now();
    if (latest) { cancelAnimationFrame(frame); apply(); }
    fraction?.end();
    latest = null;
    drag = null;
    el.classList.remove("middle-panning");
  };
  el.addEventListener("pointerup", end, true);
  el.addEventListener("pointercancel", end, true);
  for (const type of ["mousedown", "mouseup", "auxclick"]) el.addEventListener(type, (e) => { if (e.button === 1) { middleMouseAt = performance.now(); e.preventDefault(); } }, true);
  el.addEventListener("paste", (e) => { if (performance.now() - middleMouseAt < 400) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}
// The pages scroll by fractions of a pixel while dragged or gliding (smooth-scroll.js).
const pagesScroll = fractionalScroller($("viewport"), $("pages"));
middlePan($("viewport"), pagesScroll);
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
  if (gesture.pen && e.isTrusted && e.pointerType === "pen" && !e.buttons && !e.pressure && gesture.lastClient) {
    // The stylus is hovering again, so its lift never arrived: the stroke ends where it last touched.
    const [clientX, clientY] = gesture.lastClient;
    return pointerUp({ pointerId: gesture.id, clientX, clientY, timeStamp: e.timeStamp });
  }
  gesture.lastAt = e.timeStamp;
  if (gesture.pen) gesture.lastClient = [e.clientX, e.clientY];
  e.preventDefault();
  if (gesture.tool === "pan") {
    gesture.speed?.add(e.clientX, e.clientY, e.timeStamp);
    // One write per frame, with the latest position.
    gesture.at = [e.clientX, e.clientY];
    if (!gesture.frame) gesture.frame = requestAnimationFrame(() => {
      const g = gesture;
      if (!g || g.tool !== "pan" || !g.at) return;
      g.frame = 0;
      pagesScroll.to(g.left + g.x - g.at[0], g.top + g.y - g.at[1]);
    });
  } else appendPoint(e);
}
function pointerUp(e) {
  if (selection.up(e)) return;
  if (!gesture || gesture.id !== e.pointerId) return;
  if (gesture.tool === "pan") {
    const g = gesture, v = g.speed?.velocity(e.timeStamp);
    if (g.at) { cancelAnimationFrame(g.frame); pagesScroll.to(g.left + g.x - e.clientX, g.top + g.y - e.clientY); }
    const exact = pagesScroll.exact;
    cancelGesture();
    if (exact && v) pagesScroll.to(...exact);
    if (g.text && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 10) { pagesScroll.end(); return textBox.typeAt(g.panel, g.text); }
    // A fling glides on from the exact place the drag left (fractions included).
    if (!(v && glide.fling(-v.vx, -v.vy))) pagesScroll.end();
    return;
  }
  appendPoint(e);
  flushPreview();
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
      g.stripes?.remove();
      const tape = [...(g.panel.view?.tapes || [])].reverse().find(({ bounds: [x, y, w, h] }) => a[0] >= x && a[0] <= x + w && a[1] >= y && a[1] <= y + h);
      if (tape) toggleTape(g.panel, tape);
      else status("Drag across what you want to cover with tape.");
      return;
    }
  }
  // As an Apple Pencil comes away its pressure fades and its tip slides: a stroke written
  // with some force loses those last feather-light samples, which drew a hook at its end.
  if (g.pen && g.tool === "draw") trimLiftTail(g);
  learnPenPressure(g);
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
  // The Shapes tool's Prefab and Table: the box dragged is where the object goes, after its editor.
  if (g.tool === "shape" && (g.kind === "graph" || g.kind === "table")) {
    g.el.remove();
    g.dot.remove();
    const end = point(e, g.panel), box = [Math.min(g.start[0], end[0]), Math.min(g.start[1], end[1]), Math.abs(end[0] - g.start[0]), Math.abs(end[1] - g.start[1])];
    if (g.kind === "graph") insertPrefab(g.panel, box);
    else insertCompound(g.panel, g.kind, box);
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
    if (g.ink) showInk(g);
    const hold = holdInk(g.panel, g.el, g.dot, ...[g.ink, g.stripes].filter(Boolean));
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
  // Pressing the selected tool again shows or hides its settings: with them inline in a wide
  // bar, as the full panel under the tool.
  if (tool === name && !fromMenu && (optionsPopped || $("toolOptions").classList.contains("inline"))) {
    optionsPopped = !optionsPopped;
    toolOptions();
    return;
  }
  optionsPopped = false;
  if (tool === name) {
    optionsOpen = chromeState.compact || !optionsOpen;
    setCompact(false);
    return;
  }
  const prevGrab = grabbed;
  if (tool === "pdfedit") pdfEdit.leave();
  tool = name;
  if (tool === "pdfedit") pdfEdit.enter();
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
  try { localStorage.setItem("notecomplete-last-tool", tool); } catch { /* Optional. */ }
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
        : tool === "pdfedit"
          ? "Edit PDF: double-click text to edit it, or an image or drawing to move it."
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
    if (id === "color") numberSwatches(row.children);
  }
}
// The first nine colour swatches carry their number key (1–9) inside the circle, in dark or
// light ink to stand out from the colour.
function numberSwatches(buttons) {
  [...buttons].slice(0, 9).forEach((b, i) => {
    const hex = (b.dataset.value || b.dataset.color || "").replace("#", "");
    const [r, g, bl] = [0, 2, 4].map((j) => parseInt(hex.slice(j, j + 2), 16) / 255);
    const light = 0.2126 * r + 0.7152 * g + 0.0722 * bl > 0.55;
    b.dataset.num = String(i + 1);
    b.style.setProperty("--swatch-ink", light ? "#1f2328" : "#ffffff");
    b.setAttribute("aria-keyshortcuts", String(i + 1));
    b.title = `${b.title} (${i + 1})`;
  });
}
// The swatches the number keys choose from: a selected text box's colours when its format
// bar shows, else the drawing tool's (pen, highlighter, shapes, tape); none for other tools.
function colourKeySwatches() {
  if (!$("textFormat").hidden) return [...$("textSwatches").children];
  if (!["draw", "highlight", "shape", "tape"].includes(tool)) return [];
  return [...$("drawingOptions").querySelectorAll('.choice-row[data-for="color"] button')];
}
function syncChoices() {
  for (const row of document.querySelectorAll(".choice-row[data-for]")) {
    const value = $(row.dataset.for).value.toLowerCase();
    for (const b of row.children) b.setAttribute("aria-checked", String(b.dataset.value.toLowerCase() === value));
  }
  if ($("pressureToggle")) $("pressureToggle").setAttribute("aria-pressed", String(pressureOn()));
}
// Eraser size (page units around the pointer); remembered on this device.
const eraserRadius = () => Number($("eraserSize").value) || 10;
// Whether a stylus's pressure changes the pen's width; remembered on this device.
const pressureOn = () => $("pressure").value !== "off";
try { if (localStorage.getItem("notecomplete-pressure") === "off") $("pressure").value = "off"; } catch { /* Optional. */ }
$("pressure").addEventListener("change", () => { try { localStorage.setItem("notecomplete-pressure", $("pressure").value); } catch { /* Optional. */ } });
if ($("pressureToggle")) {
  $("pressureToggle").onclick = () => {
    $("pressure").value = pressureOn() ? "off" : "on";
    $("pressure").dispatchEvent(new Event("change"));
    syncChoices();
    status(pressureOn() ? "Pen pressure on: width varies with pressure." : "Pen pressure off: even width.");
  };
}
try { const saved = localStorage.getItem("notecomplete-eraser-size"); if (saved && $("eraserSize").querySelector(`option[value="${saved}"]`)) $("eraserSize").value = saved; } catch { /* Optional. */ }
$("eraserSize").addEventListener("change", () => { try { localStorage.setItem("notecomplete-eraser-size", $("eraserSize").value); } catch { /* Optional. */ } });
buildChoices();
numberSwatches($("textSwatches").children);
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
// Each tool's widths: the tool bar's width row and its editor (tool-widths.js).
const { WIDTH_LADDER, buildWidthRow, editWidth, lineIcon, saveWidths, setWidthValue, widthLabel, widthPresetsNow } = toolWidths({
  $,
  ns,
  syncChoices,
  app: {
    get quick() { return quick; },
    get tool() { return tool; },
  },
});
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
syncChoices();
// The visible shape row drives the (hidden) select that the drawing code reads.
function syncShapePicker() {
  for (const b of document.querySelectorAll("#shapePicker [data-shape]"))
    b.setAttribute("aria-checked", String(b.dataset.shape === $("shape").value));
}
for (const b of document.querySelectorAll("#shapePicker [data-shape]"))
  b.onclick = () => {
    // Prefab (in the quick menu): its picker, at once.
    if (b.dataset.shape === "graph") return doc && insertPrefab(panels[page]);
    $("shape").value = b.dataset.shape;
    try { localStorage.setItem("notecomplete-shape", b.dataset.shape); } catch { /* Optional. */ }
    syncShapePicker();
    if (tool !== "shape") document.querySelector('[data-tool="shape"]').click();
  };
syncShapePicker();
try {
  const lastTool = localStorage.getItem("notecomplete-last-tool");
  if (lastTool && lastTool !== tool && document.querySelector(`button[data-tool="${lastTool}"]`)) {
    selectTool(lastTool, { fromMenu: !toolSettingsAuto });
  }
} catch { /* Optional. */ }
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
// Once on the page, the keys are the pages' again (N, the tools, Ctrl Z), not the box's.
$("pageNumber").onchange = () => {
  jump(Number($("pageNumber").value) - 1);
  if (document.activeElement === $("pageNumber")) $("viewport").focus({ preventScroll: true });
};
// Enter (also on the page already shown, which changes nothing) and Esc leave the box too.
$("pageNumber").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== "Escape") return;
  if (e.key === "Enter") jump(Number($("pageNumber").value) - 1);
  $("viewport").focus({ preventScroll: true });
});
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
  whole: false,
  apply: (dx, dy) => pagesScroll.by(dx, dy),
  onEnd: () => pagesScroll.end(),
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
const widthEntries = (name) => widthPresetsNow()[name].map((value, i) => ({
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
const hoverEntry = { key: "hoverPreview", label: "Pen hover preview", icon: icon("draw"), active: () => penHoverEnabled(), stay: () => true, run: () => $("penHoverToggle").click() };
const textGlyphIcon = (label, font = "Georgia, serif") => {
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  const t = document.createElementNS(ns, "text");
  t.setAttribute("x", "12");
  t.setAttribute("y", "16.5");
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("fill", "currentColor");
  t.setAttribute("font-family", font);
  t.setAttribute("font-size", label.length > 2 ? "10" : "13");
  t.setAttribute("font-weight", "600");
  t.textContent = label;
  s.append(t);
  return s;
};
const setTextColor = (value) => {
  if (!$("textColor")) return setColor(value);
  $("textColor").value = value;
  $("textColor").dispatchEvent(new Event("input", { bubbles: true }));
};
const textPaletteEntries = () => [...palettes.text.map((value, i) => ({
  key: String(i),
  label: `Text colour ${value} (hold or right-click to change it)`,
  swatch: value,
  active: () => ($("textColor")?.value || $("color").value).toLowerCase() === value.toLowerCase(),
  run: () => setTextColor(value),
  edit: () => pickColor(palettes.text[i], (val) => {
    palettes.text = palettes.text.map((c, idx) => (idx === i ? val : c));
    remember("notecomplete-palettes", palettes);
    setTextColor(val);
    quick.redraw();
  }),
  stay: () => true,
})), {
  key: "custom",
  label: "Any text colour…",
  swatch: "conic-gradient(#d13b2f, #ffdf38, #2a9d63, #246bce, #8a4fd0, #d13b2f)",
  active: () => !palettes.text.some((c) => c.toLowerCase() === ($("textColor")?.value || "").toLowerCase()),
  run: () => pickColor($("textColor")?.value || "#1f2328", (val) => { setTextColor(val); quick.redraw(); }),
  stay: () => true,
}];
const textSizeEntries = () => [14, 18, 24, 36].map((sz) => ({
  key: `sz${sz}`,
  label: `Text size ${sz}`,
  icon: textGlyphIcon(String(sz), "system-ui, sans-serif"),
  active: () => Number($("textSize")?.value) === sz,
  run: () => { if ($("textSize")) { $("textSize").value = String(sz); $("textSize").dispatchEvent(new Event("change", { bubbles: true })); } },
  stay: () => true,
}));
const textModeEntries = () => {
  const isZh = $("zhModeToggle")?.getAttribute("aria-pressed") === "true";
  return [
    { key: "bold", label: "Bold", icon: textGlyphIcon("B"), active: () => $("textBold")?.getAttribute("aria-pressed") === "true", run: () => $("textBold")?.click(), stay: () => true },
    { key: "italic", label: "Italic", icon: textGlyphIcon("I"), active: () => $("textItalic")?.getAttribute("aria-pressed") === "true", run: () => $("textItalic")?.click(), stay: () => true },
    { key: "math", label: "Math (LaTeX ∑)", icon: textGlyphIcon("∑"), active: () => $("textMath")?.getAttribute("aria-pressed") === "true", run: () => $("textMath")?.click(), stay: () => true },
    { key: "zh", label: `Chinese input (${$("zhModeToggle")?.dataset.zhMode || "off"})`, icon: textGlyphIcon($("zhModeToggle")?.textContent || "中", "sans-serif"), active: () => isZh, run: () => { $("zhModeToggle")?.click(); quick.redraw(); }, stay: () => true },
    ...(isZh ? [
      { key: "ruby", label: "Pinyin over Chinese characters", icon: textGlyphIcon("拼", "sans-serif"), active: () => $("zhRubyToggle")?.getAttribute("aria-pressed") === "true", run: () => $("zhRubyToggle")?.click(), stay: () => true },
      { key: "trace", label: "Stroke order…", icon: textGlyphIcon("笔", "sans-serif"), active: () => false, run: () => $("zhTraceToggle")?.click(), stay: () => false },
    ] : []),
  ];
};
// Every tool's settings in the same places: colours on top, sizes along the bottom (small
// to large, left to right), modes on the left, undo and redo on the right.
const QUICK_SETTINGS = {
  draw: () => ({ top: paletteEntries("draw"), bottom: widthEntries("draw"), left: [pressureEntry, snapEntry, smoothEntry, hoverEntry] }),
  highlight: () => ({ top: paletteEntries("highlight"), bottom: widthEntries("highlight"), left: fromRow("highlightMode") }),
  erase: () => ({ bottom: fromRow("eraserSize") }),
  // The shapes' widths beside undo and redo, as the bottom holds the kinds of shape.
  shape: () => ({ top: paletteEntries("shape"), bottom: fromButtons("#shapePicker [data-shape]", "shape"), left: fromButtons("#shapeFill [data-fill]", "fill"), right: widthEntries("shape") }),
  tape: () => ({ top: paletteEntries("tape"), bottom: widthEntries("tape"), left: fromRow("tapeMode") }),
  text: () => ({ top: textPaletteEntries(), bottom: textSizeEntries(), left: textModeEntries() }),
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
const quickOpen = remembered("notecomplete-quick-open", {});
function withMore(section, entries) {
  const k = `${tool}:${section}`, base = QUICK_BASE[k];
  if (!base || entries.length <= base.length) return entries;
  const open = !!quickOpen[k];
  // The basic items first, in their own order, then the rest in theirs (unless the user dragged
  // this section into an order of their own).
  const first = sectionOrder[tool]?.[section] || section === "top" ? entries : [...base.map((key) => entries.find((e) => String(e.key) === key)).filter(Boolean), ...entries.filter((e) => !base.includes(String(e.key)))];
  const list = open ? first : first.filter((e) => base.includes(String(e.key)) || e.active?.());
  if (list.length === entries.length && !open) return first;
  return [...list, { key: "__more", fixed: true, more: true, label: open ? "Fewer choices" : `More choices (${entries.length - list.length})`, icon: icon(open ? "minus" : "plus"), run: () => { quickOpen[k] = !open; try { localStorage.setItem("notecomplete-quick-open", JSON.stringify(quickOpen)); } catch { /* Optional. */ } }, stay: () => true }];
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
    } else if (section === "bottom" && widthPresetsNow()[tool] && order.every((k) => k.startsWith("w"))) {
      widthPresetsNow()[tool] = order.map((k) => widthPresetsNow()[tool][Number(k.slice(1))]);
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
// The last touch, pen or key input: auto-save waits for a pause after it (autosave.js).
let lastInputAt = 0, penSeen = false;
try { penSeen = localStorage.getItem("notecomplete-pen-seen") === "1"; } catch { /* Optional. */ }
for (const type of ["pointerdown", "keydown", "wheel"]) document.addEventListener(type, () => { lastInputAt = performance.now(); }, { passive: true, capture: true });
// A pen used on this device, kept: the chart editors then leave scrolling and zooming to
// fingers (chart-editor.js reads the same key).
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "pen" || penSeen) return;
  penSeen = true;
  try { localStorage.setItem("notecomplete-pen-seen", "1"); } catch { /* Optional. */ }
}, { passive: true, capture: true });
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
  if (e.buttons) lastInputAt = performance.now();
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
  if (button || Date.now() - penMenuAt <= 800) {
    // The pen's button: the quick menu. Our menu just opened from the
    // pen: the browser's own menu must not follow it.
    e.preventDefault();
    e.stopPropagation();
    // The button held and a tap: Chromium also selected a word there.
    window.getSelection()?.removeAllRanges();
    if (button || mouse) penMenu(e);
    return;
  }
  // Only a mouse right-click opens the item menu (Shift: removes it); a long press of a finger
  // has its own timer (longPress), and a pen's (Samsung's button + touch included) never does.
  if (!mouse) { e.preventDefault(); e.stopPropagation(); }
}, true);
function uiZoomStepForEvent(e) {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return null;
  const k = e.key, c = e.code;
  if (k === "0" || k === ")" || c === "Digit0" || c === "Numpad0") return 0;
  if (k === "-" || k === "_" || c === "Minus" || c === "NumpadSubtract") return -1;
  if (k === "+" || (k === "=" && c !== "Digit0") || (k === "*" && c !== "Digit8") || c === "Equal" || c === "NumpadAdd") return 1;
  return null;
}
// Ctrl/Cmd + 1–9: to that tab (9: the last), in the desktop app and the web's tabs page.
// Typing in a field is left alone; a browser tab may keep these keys for itself.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !/^Digit[1-9]$/.test(e.code)) return;
  const tabs = window.notecompleteTabs;
  if (!tabs?.list || !tabs.activate) return;
  e.preventDefault();
  const digit = Number(e.code.slice(5));
  tabs.list().then((list) => {
    const id = tabForDigit(list, digit);
    if (id != null) return tabs.activate(id);
  }).catch(() => { /* No tabs here. */ });
}, true);
document.addEventListener("keydown", (e) => {
  const uiStep = uiZoomStepForEvent(e);
  if (uiStep !== null) {
    e.preventDefault();
    applyUiSize(uiStep);
    return;
  }
  if (penBtn.key(e) !== "menu" || !doc) return;
  e.preventDefault();
  if (quick.isOpen) { penMenu({}, true); return; }
  const at = penHover && Date.now() - penHover.at < 1500 ? penHover : { x: innerWidth / 2, y: innerHeight / 2 };
  penMenu({ clientX: at.x, clientY: at.y });
}, true);
let quickKeyAt = 0;
const quickKeyAllowed = (e) => doc && !$("editor").hidden && !e.metaKey && !e.ctrlKey && !e.altKey && !typingIn(e.target) && !document.querySelector("dialog[open]") && !imeMenuOpen();
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
// Auto-save, recovery dialog and history compaction (autosave.js).
const autosaveCall = (op, args = {}) => (op === "save" ? syncProjectStudy().then(() => call(op, args)) : call(op, args));
const autosave = autosaveController({
  state: {
    doc: () => doc,
    editing: () => editing,
    busy,
    active: () => performance.now() - lastInputAt < 2500,
    revision: () => revision,
    epoch: () => epoch,
    collab: () => collab,
    fingerprint: () => find.fingerprint,
  },
  call: autosaveCall,
  notes: () => notes,
  status,
  closeMenus,
  canReplace,
  icon,
  $,
  openSlotFile: async (slot, bytes, { sameKey, label }) => {
    const keepSaveAs = sameKey ? saveAs : null;
    await load(new File([bytes], `${slot.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}.nfedit`, { type: "application/json" }));
    if (!doc) return;
    saveAs = keepSaveAs;
    saveLabel();
    dirty = changed = true;
    savedState();
    status(`Opened the automatic save from ${label}. Save it to keep it.`);
  },
  onCompacted: (view, message) => {
    revision++;
  projectModelController?.invalidate?.();
    dirty = changed = true;
    doc = view;
    savedState();
    restructure(view, page, message);
  },
});
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
  ["V", "Pan tool"], ["S", "Select tool"], ["P", "Pen"], ["H", "Highlighter"], ["E", "Eraser"], ["T", "Tape"], ["R", "Shapes"], ["F", "Shapes: fill none / tint / solid"], ["G", "Grab: copy text or ask AI about a region"], ["W", "Text: click to type a text box, or click a text box to edit it (Esc keeps it, Shift Esc or × discards)"], ["O", "Lock: click an item to lock or unlock it in place"], ["1–9", "Pen, highlighter, shapes, tape or a selected text box: the colour with that number on its swatch (Ctrl 1–9 change tabs)"],
  ["/", "Find in note"], ["D", "Dark pages"], ["Shift L", "Layers"], ["Shift P", "Page list"], ["Shift G", "Go to page"], ["Shift I", "Insert image"], ["Shift B", "Insert blank page"], ["Shift X", "Insert prefab: a function graph, histogram, bar chart, process states, CPU timeline, table, tree or node graph, or UML diagram (use case, class, state machine, activity, sequence)"], ["Right-click", "Menu for what is under the pointer: edit it (prefab, graph, table, text), crop, move, lock or delete; on the page, insert here. A finger held still, or a selection's ⋯, opens it too"], ["Shift + right-click", "Delete what is under the pointer at once"], ["Shift Y", "Insert table"], ["Shift O", "Recognize text (OCR)"], ["Shift E", "Export flashcards and quizzes to Anki"], ["Shift U", "Lift all tape / cover it again"], ["Shift T", "Show or hide the tool bar (the quick menu has the tools; holding its × does the same)"], ["N", "Notes (Markdown beside the pages)"], ["A", "Audio and transcript"], ["Shift A", "Go to the page where the recording starts"], ["Shift R", "Record audio into this note / stop and keep it"], ["I", "Dim ink not yet written at this point of the recording"], ["K", "Play / pause recording"], ["Shift K", "Text from part of the recording: choose a segment (scissors in the audio panel)"], ["J / L", "Back / forward 10 s"], ["[ / ]", "Audio slower / faster (0.5× to 3×)"], ["Q", "Resume quiz"], ["Shift Q", "New quiz"], ["Shift C", "New flashcards"], ["Shift F", "Fact check pages with AI (findings go into the notes)"], ["Shift D", "Saved decks and quizzes"], ["Shift S", "Quick menu: tools, and the chosen tool's colours, widths and modes (hold, point and let go, or tap and click; 1–9 choose a tool; hold a tool to move it). Also a pen's side button, or two fingers held still"], ["Shift + pen", "Quick menu at the pen: Shift held as the pen touches the page, or pressed while the pen hovers over it (a pen's button pressed again while hovering closes it)"], ["?", "Show keys on buttons (again to hide)"],
  ["Ctrl K", "Commands"], ["Ctrl F", "Find"], ["Ctrl J", "Ask AI"], ["Ctrl N", "New document"], ["Ctrl O", "Open"], ["Ctrl S", "Save"], ["Ctrl Shift N", "New window"], ["Ctrl Z / Ctrl Shift Z (or Ctrl Y)", "Undo / redo"], ["Ctrl Shift ] / Ctrl Shift [", "Selected item or group: bring to front / send to back"], ["Ctrl ] / Ctrl [", "Selected item: bring forward / send backward, past the next item it overlaps"], ["Ctrl + / − / 0", "Zoom in / out / fit"], ["Ctrl Shift + / − / 0", "Interface larger / smaller / 100% (desktop app)"], ["Ctrl + trackpad", "Zoom towards the pointer"], ["Shift + wheel", "Scroll fast"], ["Ctrl + drag on a window", "Move it (Ask AI, quiz, audio, flashcards; ⌘ on a Mac)"], ["Ctrl + right-drag on a window", "Resize it from the nearest corner"], ["Two fingers held still", "Quick menu (any touch screen; also a pen's side button)"], ["Two / three-finger tap", "Undo / redo"], ["Shift + arrows / Page Up, Down", "Scroll three times as far"],
  ["Space", "Flashcards: show answer"], ["1 / 2", "Flashcards: not yet / I knew it"], ["E / V", "Flashcards: edit / double check the card"], ["X (twice)", "Flashcards: discard the card"], ["C", "Flashcards: ask AI to explain the card (the last answer is kept)"], ["M", "Flashcards: minimize the practice window"],
  ["Shift W", "Retake wrong answers"], ["1–4", "Quiz: answer"], ["H", "Quiz: hint (1 point instead of 2)"], ["C", "Quiz: clarify with AI"], ["X (twice)", "Quiz: dispute a wrong question"], ["V", "Quiz: double check and correct"], ["Enter", "Quiz: next question"], ["M / Esc", "Quiz: minimize"],
];
// The tool row can be put in any order by dragging its buttons; remembered here.
const toolGroup = document.querySelector("#toolbar .segmented");
const toolKey = (el) => el.dataset.tool || el.id;
const toolItems = 'button[data-tool], #importImage, #mathModePill';
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
// B (borrar) erases; E edits a PDF's text and objects (Edit PDF).
const TOOL_KEYS = { v: "pan", s: "select", p: "draw", h: "highlight", b: "erase", e: "pdfedit", t: "tape", r: "shape", g: "grab", w: "text", o: "lock" };
// "?" toggles a key badge on every button with a single-key shortcut (menus already show theirs, Ctrl ones included).
const KEY_HINTS = {
  ...Object.fromEntries(Object.entries(TOOL_KEYS).map(([key, tool]) => [`button[data-tool="${tool}"]`, key.toUpperCase()])),
  "#notesToggle": "N", "#audioToggle": "A", "#audioPage": "⇧A", "#recordAudio": "⇧R", "#stopRecording": "⇧R", ".icon-toggle:has(#syncEnabled)": "I", "#layersToggle": "⇧L", "#pagesToggle": "⇧P", "#findToggle": "/", "#importImage": "⇧I", "#pagesDark": "D", "#htmlDark": "D", "#textDark": "D", "#webDark": "D", "#backAudio": "J", "#playAudio": "K", "#forwardAudio": "L",
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
  status(on ? "Keys shown on buttons; 1–9 pick the colour numbered on each swatch. Press ? again to hide them; Help lists them all." : "Key hints hidden.");
}
const studyWindowUp = () => (!$("quizPanel").hidden && !$("quizPanel").classList.contains("minimized"))
  || ($("deckDialog").open && !$("deckDialog").classList.contains("minimized"));
function shortcut(e) {
  if (home?.visible) return false;
  const k = e.key;
  // Text documents have the study keys too (flashcards, quizzes, saved decks).
  const studyKey = !doc && textView.visible && { q: resumeQuiz, Q: () => study.quiz(), C: () => study.cards(), F: () => study.check(), D: () => quizIndex.open(), W: () => quizzes.retakeWrong(), "/": () => textFinder.open() }[k];
  if (studyKey) return studyKey(), true;
  if (!doc && (htmlView.visible || textView.visible) && k === "n") return notesButton().click(), true;
  if (!doc) return sideView()?.visible && k === "d" ? ($("htmlDark").click(), true) : false;
  if (k === "f" && tool === "shape" && !$("editor").hidden) return setShapeFill({ none: "tint", tint: "solid", solid: "none" }[shapeFill]), status(`Shape fill: ${shapeFill === "none" ? "outline only" : shapeFill}.`), true;
  // 1–9: the colour with that number on the tool's swatches, as a click on it. Not while a
  // quiz or flashcards window is in front (their own number keys) or the focus is in a window.
  if (/^[1-9]$/.test(k) && !$("editor").hidden && !studyWindowUp() && !e.target.closest?.("dialog, #chatPanel, #audioBar, #quizPanel")) {
    const swatch = colourKeySwatches()[Number(k) - 1];
    if (!swatch) return false;
    swatch.click();
    if ($("toolOptions").hidden) status(`Colour ${k}: ${swatch.dataset.value || swatch.dataset.color}.`);
    return true;
  }
  const keyTool = !e.shiftKey && TOOL_KEYS[k.toLowerCase()];
  if (keyTool && !$("editor").hidden) return document.querySelector(`button[data-tool="${keyTool}"]`)?.click(), true;
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
    if (k === "k") { if (!e.repeat) $("playAudio").click(); }
    else audio.skip(k === "j" ? -1 : 1, e.repeat);
    return true;
  }
  // Playback speed one step slower / faster.
  if (!$("audioToggle").hidden && (k === "[" || k === "]")) return status(`Playback speed ${audio.stepRate(k === "]" ? 1 : -1)}×.`), true;
  if (k === "d") return $("pagesDark").click(), true;
  if (k === "q") return resumeQuiz(), true;
  if (k === "Q") return study.quiz(), true;
  if (k === "C") return study.cards(), true;
  if (k === "F") return study.check(), true;
  if (k === "D") return quizIndex.open(), true;
  if (k === "W") return showDocument(), quizzes.retakeWrong(), true;
  return false;
}
document.addEventListener("keydown", (e) => {
  if (e.key === "F11" && !e.ctrlKey && !e.metaKey && !e.altKey && !window.notecompleteUpdates && !window.ReactNativeWebView) {
    e.preventDefault();
    void toggleFullscreen();
    return;
  }
  // Ctrl B: the right side panel (notes); Ctrl Alt B: the left one (pages). In a text field
  // Ctrl B stays bold.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === "KeyB" && !typingIn(e.target)) {
    e.preventDefault();
    toggleSide(e.altKey ? "left" : "right");
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!$("qualityDialog").open) openPalette();
    return;
  }
  if ($("qualityDialog").open || $("paletteDialog").open) return;
  // Ctrl A in any text input, textarea, or contenteditable selects its text reliably
  // (including inside graph/table/prefab dialogs and Electron WebContentsView on Linux).
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyA") {
    const t = e.target;
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !["checkbox", "radio", "range", "color", "button", "submit", "reset", "file", "hidden"].includes(t.type))) {
      e.preventDefault();
      t.select();
      return;
    }
    const ce = t instanceof Element ? t.closest('[contenteditable="true"]') : null;
    if (ce) {
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(ce);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }
  // Ctrl A in a text document selects its text, not the whole window (toolbars, tabs…).
  // Inside a field or the editor the field's own select-all applies.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyA" && !typingIn(e.target)
    && textView?.visible && textView.hasDocument && !document.querySelector("dialog[open]")) {
    e.preventDefault();
    const root = textView.editing ? $("textEditor") : $("textBody");
    const plain = root.querySelector("textarea");
    if (plain) { plain.focus(); plain.select(); return; }
    const target = root.querySelector("[contenteditable='true']") || root;
    if (target !== root) target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  if (e.key === "?" &&!e.ctrlKey && !e.metaKey && !e.altKey && !typingIn(e.target)) {
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
    // Escape lets go of what is selected first.
    if (selection.item && !typingIn(e.target)) {
      e.preventDefault();
      selection.clear();
      return;
    }
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
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && doc && !$("editor").hidden && ["+", "=", "-", "_", "0"].includes(e.key)) {
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
    ($("newNoteOpen") || $("newDocument")).click();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") {
    e.preventDefault();
    $("newWindow").click();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
    e.preventDefault();
    mathBar.toggle();
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
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !doc && officeView?.visible) {
    e.preventDefault();
    void officeView.forcesave();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !doc && (textView.hasDocument || htmlView.hasDocument)) {
    e.preventDefault();
    saveText();
    return;
  }
  // Ctrl +/−/0 on a text document or HTML page: its own zoom (notes zoom their pages below).
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && sideView()?.visible && ["+", "=", "-", "_", "0"].includes(e.key)) {
    e.preventDefault();
    const dir = e.key === "0" ? 0 : e.key === "-" || e.key === "_" ? -1 : 1;
    if (textView.visible) textView.zoom(dir); else if (webView.visible) webZoom.step(dir); else htmlZoom.step(dir);
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (saveAs) save(saveAs === "noteful", saveAs, null, { inPlace: true });
    else save(false, "project", null, { inPlace: true });
    return;
  }
  if (typingIn(e.target))
    return;
  const navDir = keyNavDirection(e);
  if (navDir) {
    if (navigateHistory(navDir, e.target)) e.preventDefault();
    return;
  }
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
  // Ctrl+Y redoes too, as in most Windows and Linux apps.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "y") {
    e.preventDefault();
    action("redo");
  }
});
$("open").onclick = () => openLocal();
if ($("emptyOpenFile")) $("emptyOpenFile").onclick = () => { closeHomeFileMenu(); openLocal(); };
function closeHomeFileMenu() {
  if ($("homeFileMenu")) $("homeFileMenu").hidden = true;
  if ($("emptyOpen")) $("emptyOpen").setAttribute("aria-expanded", "false");
}
function placeHomeFileMenu() {
  const btn = $("emptyOpen"), menu = $("homeFileMenu");
  if (!btn || !menu || menu.hidden) return;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const vw = innerWidth / z, vh = innerHeight / z;
  const r = btn.getBoundingClientRect();
  const leftEdge = r.left / z, rightEdge = r.right / z, topEdge = r.top / z, bottomEdge = r.bottom / z;
  const w = Math.min(menu.offsetWidth || 260, vw - 16);
  const preferRight = rightEdge > vw * 0.55;
  const x = preferRight ? rightEdge - w : leftEdge;
  menu.style.maxWidth = `${Math.max(180, Math.round(vw - 16))}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(vw - w - 8, x)))}px`;
  menu.style.right = "auto";
  const h = menu.offsetHeight || 260;
  const below = vh - bottomEdge - 10, above = topEdge - 10;
  if (below >= h || below >= above) {
    menu.style.top = `${Math.round(bottomEdge + 6)}px`;
    menu.style.maxHeight = `${Math.max(140, Math.round(below))}px`;
  } else {
    const mh = Math.max(140, Math.round(above));
    menu.style.maxHeight = `${mh}px`;
    menu.style.top = `${Math.round(Math.max(8, topEdge - Math.min(h, mh) - 6))}px`;
  }
}
if ($("emptyOpen")) {
  $("emptyOpen").onclick = (e) => {
    const menu = $("homeFileMenu");
    if (!menu) return openLocal();
    e.stopPropagation();
    const next = menu.hidden;
    menu.hidden = !next;
    $("emptyOpen").setAttribute("aria-expanded", String(next));
    if (next) {
      placeHomeFileMenu();
      if (e.detail === 0) menu.querySelector("button:not([hidden])")?.focus();
    }
  };
  // Esc closes it (back on the File button), ↑ ↓ move between its items.
  $("homeFileMenu")?.addEventListener("keydown", (e) => {
    const items = [...$("homeFileMenu").querySelectorAll("button:not([hidden])")];
    const at = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeHomeFileMenu(); $("emptyOpen").focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if ($("homeFileMenu") && !$("homeFileMenu").hidden && !e.target.closest?.("#homeFileDropWrap")) {
      closeHomeFileMenu();
    }
  });
}
function openFileObject(file, meta = { origin: "File picker" }) {
  if (file) void openImportedFile(file, meta);
}
$("file").onchange = (e) => {
  openFileObject(e.target.files[0], { origin: "File picker" });
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
      if (archiveFormat(files[0].name, bytes)) await openImportedFile(files[0], { origin: "Dropped file" });
      else if (doc && fileKind(files[0].name, bytes) === "image")
        await importImages(files);
      else await openImportedFile(files[0], { origin: "Dropped file" });
    } catch (error) {
      status(error.message, true);
    }
  });
$("drop").ondragleave = () => $("drop").classList.remove("drag");
function filename() {
  return (doc?.title || "Note").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}
async function syncProjectStudy() {
  if (!doc) return;
  const fp = find.fingerprint || doc.title;
  const readList = async (kind, fallback = "") => {
    const primary = fp ? await library.store.get("settings", `${kind}:${fp}`).catch(() => null) : null;
    if (Array.isArray(primary)) return primary;
    if (fallback && fallback !== fp) {
      const alt = await library.store.get("settings", `${kind}:${fallback}`).catch(() => null);
      if (Array.isArray(alt)) return alt;
    }
    return [];
  };
  const study = {
    decks: await readList("decks", doc.title),
    quizzes: await readList("quizzes", doc.title || "note"),
    scratch: await readList("scratch", doc.title || "note"),
  };
  await call("study", { study }).catch((e) => console.warn("Project study:", e));
}
async function prepareProjectMetadata() {
  await notes?.flush();
  await call("recognized", { pages: find.recognizedText() }).catch((e) => console.warn("Recognized text:", e));
  await syncProjectStudy();
}
async function exportNoteBytes(as = "project", projectOptions = null) {
  if (!doc) throw Error("Open a note first.");
  if (as === "project") {
    await prepareProjectMetadata();
    const packed = await addedStore.packed();
    const raw = projectOptions
      ? await call("exportFilteredProject", { ...packed, options: projectOptions })
      : await call("saveFile", packed);
    return {
      name: filename() + SAVE_EXT.project,
      mime: "application/octet-stream",
      bytes: raw instanceof Uint8Array ? raw : new Uint8Array(raw),
      ext: SAVE_EXT.project,
    };
  }
  await notes?.flush();
  const raw = await call("export", {});
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const name = filename() + SAVE_EXT[as];
  return { name, mime: "application/octet-stream", bytes, ext: SAVE_EXT[as] };
}
// Save the project (Ctrl+S saves full .nfedit in place over the current file), or export:
// .nfedit with resource checkboxes, Noteful alone, or Noteful plus notes as Markdown.
async function save(native, as = native ? "noteful" : "project", projectOptions = null, { inPlace = false } = {}) {
  if (!doc || busy()) return;
  cancelGesture();
  editing = true;
  const token = epoch;
  try {
    let chosenOptions = projectOptions;
    let packedAudio = null;
    if (as === "project") {
      await prepareProjectMetadata();
      packedAudio = await addedStore.packed();
      if (native && !chosenOptions) {
        const breakdown = await call("projectBreakdown", packedAudio);
        if (token !== epoch) return;
        chosenOptions = await chooseNfeditExport({
          $,
          title: doc?.title || filename(),
          breakdown,
          actionLabel: "Export .nfedit",
        });
        if (!chosenOptions || token !== epoch) return;
        if ($("exportDialog")?.open) $("exportDialog").close();
      }
    } else {
      await notes?.flush();
    }
    const op = as === "project" ? (chosenOptions ? "exportFilteredProject" : "saveFile") : "export";
    const opArgs = as === "project" ? { ...(packedAudio || {}), ...(chosenOptions ? { options: chosenOptions } : {}) } : {};
    const data = await call(op, opArgs);
    if (token !== epoch) return;
    const suggestedName = filename() + SAVE_EXT[as];
    const mime = "application/octet-stream";
    let delivery;
    if (inPlace && !chosenOptions && (as === "project" || as === "noteful")) {
      delivery = await saveDocumentInPlace({
        bytes: data,
        suggestedName,
        targetExt: SAVE_EXT[as],
        mime,
        docMember,
        noteEntryKey,
        saveFileHandle,
        bridge: window.notecompleteFiles,
        library,
        showSaveFilePicker: window.showSaveFilePicker?.bind(window),
        download,
      });
    } else {
      delivery = await download(data, suggestedName, mime);
    }
    if (token !== epoch) return;
    if (delivery.cancelled) {
      status("Save cancelled.");
      return;
    }
    if (delivery.kind === "handle" && delivery.handle) {
      saveFileHandle = delivery.handle;
    }
    console.info(`[NC] save ${as}${inPlace ? " in place" : ""}: ${delivery.kind || "?"} ${delivery.path || delivery.name || ""}${delivery.cancelled ? " (cancelled)" : ""} ${doc?.pages || 0} pages`);
    if (delivery.kind === "local" && delivery.path) {
      const boundChanged = !delivery.overwritten || notePath !== delivery.path || docMember?.path !== delivery.path;
      notePath = delivery.path;
      const savedEntry = await library.rememberLocal(delivery.path, delivery.name, delivery.size).catch(() => null);
      if (boundChanged && savedEntry) {
        noteEntryKey = savedEntry.key;
        activeCoverKeyOverride = savedEntry.key;
        rememberDocument(savedEntry.key);
        await setDocMember(localMember(delivery.path, delivery.name));
      } else if (savedEntry && home?.visible) {
        home.renderRecent?.();
      }
    } else if (delivery.kind === "imported" && delivery.entry) {
      // Kept in the library (web, phone, or an imported note): this note is now that entry,
      // so Recent reopens what was saved and the next save updates it.
      const entry = delivery.entry, boundChanged = noteEntryKey !== entry.key || docMember?.name !== entry.name;
      notePath = await library.pathOf(entry).catch(() => "");
      if (boundChanged) {
        noteEntryKey = entry.key;
        activeCoverKeyOverride = entry.key;
        rememberDocument(entry.key);
        await setDocMember({ key: entry.key, name: entry.name, source: "imported" });
      }
      if (home?.visible) home.renderRecent?.();
    }
    if (as === "markdown") {
      const text = await call("exportMarkdown", { title: doc.title || filename() });
      const mdDelivery = await download(new TextEncoder().encode(text), filename() + ".md", "text/markdown");
      if (mdDelivery.cancelled) {
        status("Export cancelled.");
        return;
      }
    }
    if (!delivery.shared) {
      autosave.markManual();
      if (as === "project" || as === "noteful") void ensureDocumentCover({ skipExisting: false });
    }
    if (as === saveAs && !chosenOptions && !delivery.shared) {
      dirty = changed = false;
      savedState();
      status(delivery.created
        ? `Saved ${delivery.name || suggestedName} in NoteComplete: it is in Recent. File → Export gives a copy as a file.`
        : `Saved ${delivery.name || suggestedName}.`);
      return;
    }
    if (as === "markdown") {
      status(".noteful and .md files exported.");
      return;
    }
    if (!native && !chosenOptions && !delivery.shared) {
      dirty = changed = false;
      savedState();
    }
    status(
      delivery.shared
        ? "Choose Save in the device menu."
        : chosenOptions
          ? ".nfedit file exported."
          : native
            ? ".noteful file exported."
            : delivery.overwritten || delivery.kind === "local" || delivery.kind === "handle" || delivery.kind === "imported"
              ? `Saved ${delivery.name || suggestedName}.`
              : "Project saved.",
    );
  } catch (e) {
    status(e.message, true);
  } finally {
    if (token === epoch) editing = false;
  }
}
$("save").onclick = () => (saveAs ? save(saveAs === "noteful", saveAs, null, { inPlace: true }) : save(false, "project", null, { inPlace: true }));
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
async function openBlankNoteForPrefab(title = "Prefab") {
  let format = "project";
  try { format = newFormat(localStorage.getItem("notecomplete-new-format")); } catch { /* Optional. */ }
  const seed = crypto.getRandomValues(new Uint8Array(16));
  notePath = noteEntryKey = ""; setDocMember(null);
  await load(new File([seed], `${title}${SAVE_EXT[format]}`), { kind: "blank", title, sizes: [[595, 842]], bytes: new ArrayBuffer(0), saveAs: format, canvas: false });
  return panels[0] || null;
}
async function openNewMarkdown({ title = "Untitled", initialText = "" } = {}) {
  for (const m of document.querySelectorAll("details.menu")) m.open = false;
  if (!canReplace()) return false;
  reset({ opening: true });
  notePath = noteEntryKey = "";
  setDocMember(null);
  const key = `md-draft-${Date.now()}`;
  const fileName = `${title}.md`;
  activeFileName = fileName;
  activeDocKind = "text";
  sideFp = await noteFingerprint(new File([initialText], fileName)).catch(() => "");
  $("title").textContent = title;
  document.title = `${title} — NoteComplete`;
  tabBar.update({ title, dirty: false });
  await textView.open({ text: initialText, name: title, markdown: true, key, edit: true, split: true });
  textSource.forget();
  if (collab?.role !== "guest") notes?.load(sideFp, { core: false });
  showDocument();
  rememberDocument();
  documentControls();
  collab?.documentChanged();
  status("Chinese Markdown editor ready: click 中 (or Ctrl+Shift+Space) to type Chinese, 拼 for pinyin on top.");
  return true;
}
if ($("newNoteOpen")) {
  $("newNoteOpen").onclick = () => {
    closeMenus();
    closeHomeFileMenu();
    $("newNoteMenuDialog")?.showModal();
  };
}
if ($("newNoteMenuClose")) $("newNoteMenuClose").onclick = () => $("newNoteMenuDialog")?.close();
if ($("newNoteMenuDialog")) {
  $("newNoteMenuDialog").addEventListener("click", (e) => {
    if (e.target.closest?.("button[id]") && e.target.closest("button[id]").id !== "newNoteMenuClose") {
      $("newNoteMenuDialog").close();
    }
  });
}
if ($("newMarkdownDoc")) $("newMarkdownDoc").onclick = () => openNewMarkdown();
if ($("homeNewMarkdown")) $("homeNewMarkdown").onclick = () => { closeHomeFileMenu(); openNewMarkdown(); };
const launchNewRDialog = () => {
  if ($("newNoteMenuDialog")?.open) $("newNoteMenuDialog").close();
  closeHomeFileMenu();
  openNewRDialog({
    status,
    onOpenStudio: openRStudioTarget,
    onCreatedWorkspace: async (created) => {
      if (created?.folderPath && created?.folderListing) {
        await groups.openFolder({ folder: created.folderPath, name: created.name, files: created.folderListing });
        home?.renderRecent?.();
      }
    },
    onCreatedFile: async (created) => {
      if (created?.filePath) {
        await library.rememberLocal(created.filePath, created.name, created.size || 0).catch(() => {});
        home?.renderRecent?.();
      }
    },
  });
};
if ($("newRStudioDoc")) $("newRStudioDoc").onclick = launchNewRDialog;
if ($("homeMenuRStudio")) $("homeMenuRStudio").onclick = launchNewRDialog;
// "Open in Euro-Office" in the bar of an office file shown as text: dimmed, with how to install
// it, while the module is not installed. The way back ("Open as text") belongs to the Euro-Office
// tab (Sprint 6), which calls reopenWith(file, "text") (open-with-ui.js).
function officeButton() {
  const b = $("textOpenOffice");
  if (!b) return;
  const isOffice = Boolean(officeFile && euroOfficeMode(officeFile.name));
  const mdName = textView.name || activeFileName || "";
  const isMd = !isOffice && isMarkdownName(mdName);
  b.hidden = !(textView.hasDocument && (isOffice || isMd));
  if (b.hidden) return;
  const shown = isOffice ? officeFile : mdName;
  void moduleState().then(({ installed }) => {
    if ((isOffice ? officeFile : (textView.name || activeFileName || "")) !== shown) return;
    b.setAttribute("aria-disabled", String(!installed));
    b.title = installed
      ? (isMd ? "Turn this Markdown file into a Euro-Office document (.docx)" : "Open this file in Euro-Office, the office suite")
      : "Euro-Office is not installed: install it from Help ▸ Setup wizard ▸ Modules";
  });
}
if ($("textOpenOffice")) $("textOpenOffice").onclick = () => {
  const b = $("textOpenOffice");
  if (b.getAttribute("aria-disabled") === "true") return notInstalledMenu(b);
  if (officeFile && euroOfficeMode(officeFile.name)) {
    void reopenWith(officeFile, "euro-office");
    return;
  }
  const mdName = textView.name || activeFileName || "";
  if (textView.hasDocument && isMarkdownName(mdName)) {
    const file = new File([textView.text || ""], mdName, { type: "text/markdown" });
    void reopenWith(file, "euro-office");
  }
};
// Opening the same file again another way (the bar button above, and Sprint 6's "Open as text").
setReopenWith(async (file, opener) => {
  if (!file || busy() || !canReplace()) return false;
  openOnceWith(file.name, opener);
  await load(file).catch(() => {});
  return true;
});
// Euro-Office editor tab (office-view.js): hosts DocsAPI.DocEditor and routes saves back
// through NoteComplete's existing save paths (local, Library, Drive, or new OOXML copy).
const officeView = officeViewer({
  root: $("officeView"),
  host: $("officeHost"),
  title: $("officeTitle"),
  stateEl: $("officeState"),
  saveBtn: $("officeSave"),
  textBtn: $("officeOpenText"),
  getTheme: () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  getLang: () => navigator.language || "en",
  onOpenAsText: (file) => void reopenWith(file, "text"),
  onDirtyChange: (isDirty, name) => {
    dirty = changed = isDirty;
    tabBar.update({ title: name || activeFileName || "Document", dirty: isDirty });
  },
  onStatus: (msg, err) => status(msg, err),
  onSaveBytes: async ({ file, bytes, plan, copyTarget }) => {
    if (!plan || plan.kind === "none") return { savedName: file.name };
    const bridge = window.notecompleteFiles;
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    if (plan.kind === "copy") {
      if (copyTarget?.path && bridge?.writeOpened) {
        await bridge.writeOpened(copyTarget.path, bytes);
        await library.rememberLocal(copyTarget.path, copyTarget.name, bytes.byteLength).catch(() => {});
        return { savedName: copyTarget.name, copyTarget, message: `Saved ${copyTarget.name} (original untouched).` };
      }
      if (bridge?.saveFile) {
        const chosen = await bridge.saveFile(plan.name, bytes);
        if (chosen?.path) {
          await library.rememberLocal(chosen.path, chosen.name, chosen.size ?? bytes.byteLength).catch(() => {});
          return { savedName: chosen.name, copyTarget: chosen, message: `Saved new copy as ${chosen.name} (original untouched).` };
        }
      }
      if (library?.keepSaved) {
        const entry = await library.keepSaved(plan.name, blob);
        return { savedName: entry.name, message: `Saved new copy as ${entry.name} in Library (original untouched).` };
      }
      await download(bytes, plan.name, "application/octet-stream");
      return { savedName: plan.name, message: `Downloaded new copy ${plan.name}.` };
    }
    // In-place save (edit or confirmed lossy-edit).
    if (docMember?.source === "local" && docMember.path && bridge?.writeOpened) {
      await bridge.writeOpened(docMember.path, bytes);
      await library.rememberLocal(docMember.path, docMember.name || file.name, bytes.byteLength).catch(() => {});
      return { savedName: docMember.name || file.name, message: `Saved ${docMember.name || file.name}.` };
    }
    if (docMember?.source === "drive" && noteEntryKey && library?.entry) {
      const entry = await library.entry(noteEntryKey).catch(() => null);
      if (entry?.driveId && drive?.upload) {
        await drive.upload(entry, blob);
        await library.keepSaved(file.name, blob, { key: noteEntryKey }).catch(() => {});
        return { savedName: file.name, message: `Saved ${file.name} to Google Drive.` };
      }
    }
    if ((docMember?.source === "imported" || noteEntryKey.startsWith("imported:")) && library?.keepSaved) {
      const entry = await library.keepSaved(file.name, blob, { key: docMember?.key || noteEntryKey });
      return { savedName: entry.name, message: `Saved ${entry.name} in Library.` };
    }
    if (bridge?.saveFile) {
      const chosen = await bridge.saveFile(file.name, bytes);
      if (chosen?.path) {
        await library.rememberLocal(chosen.path, chosen.name, chosen.size ?? bytes.byteLength).catch(() => {});
        await setDocMember(localMember(chosen.path, chosen.name));
        return { savedName: chosen.name, message: `Saved ${chosen.name}.` };
      }
    }
    await download(bytes, file.name, "application/octet-stream");
    return { savedName: file.name, message: `Downloaded ${file.name}.` };
  },
});
setOfficeOpener(async (file, { mode = "edit" } = {}) => {
  reset({ opening: true });
  activeFileName = file.name || "Document";
  activeDocKind = "office";
  officeFile = file;
  $("title").textContent = activeFileName;
  document.title = `${activeFileName} — NoteComplete`;
  tabBar.update({ title: activeFileName, dirty: false });
  home.hide();
  $("editor").hidden = true;
  $("htmlView").hidden = true;
  $("textView").hidden = true;
  $("webView").hidden = true;
  const opened = await officeView.open(file, { mode });
  if (opened === false) { reset(); return false; }
  showDocument();
  rememberDocument();
  documentControls();
  status(`Opened ${activeFileName} in Euro-Office.`);
  return true;
});
if ($("textOpenRStudio")) {
  $("textOpenRStudio").onclick = async () => {
    const filePath = docMember?.source === "local" ? docMember.path : "";
    const name = docMember?.name || `${textView.name || "script"}.R`;
    const kind = /\.(rmd|qmd)$/i.test(name) ? "rmd" : "r";
    await openRStudioTarget({ filePath, title: name, code: filePath ? "" : textView.text, kind });
  };
}
// When an R script or text file opened from disk is edited externally in R Commander Studio,
// focusing NoteComplete reloads the updated file cleanly if there are no unsaved in-app edits.
// Only plain text files: a converted document (.docx, .doc, .odt, .pdf…) shows Markdown made
// from a binary file, so its bytes read as text would replace the document with garbage.
window.addEventListener("focus", async () => {
  if (!textView?.visible || !textView?.hasDocument || converted || changed) return;
  if (docMember?.source !== "local" || !docMember?.path || !window.notecompleteFiles?.readRecent) return;
  const member = docMember;
  try {
    const bytes = await window.notecompleteFiles.readRecent(member.path);
    if (!bytes) return;
    const data = new Uint8Array(bytes);
    // Binary content (a NUL byte) is never a text file's update.
    if (data.subarray(0, 4096).includes(0)) return;
    // Another document opened, or edits began, while the file was being read.
    if (docMember !== member || converted || changed || !textView.hasDocument) return;
    const diskText = decodeText(data);
    if (diskText && diskText !== textView.text) {
      await textView.open({
        text: diskText,
        name: textView.name,
        markdown: textView.markdown,
        key: docMember.name,
      });
      status(`Synced ${docMember.name} from disk.`);
    }
  } catch { /* File moved or unreadable. */ }
});
if ($("homeCreatePrefab")) $("homeCreatePrefab").onclick = () => insertPrefab(panels[page]);
if ($("homeMenuNewHub")) $("homeMenuNewHub").onclick = () => { closeHomeFileMenu(); $("newNoteOpen")?.click(); };
if ($("homeMenuBlank")) $("homeMenuBlank").onclick = () => { closeHomeFileMenu(); $("newDocument")?.click(); };
if ($("homeMenuPrefab")) $("homeMenuPrefab").onclick = () => { closeHomeFileMenu(); insertPrefab(panels[page]); };
if ($("homeMenuHandwritten")) $("homeMenuHandwritten").onclick = () => { closeHomeFileMenu(); $("newHandwritten")?.click(); };
if ($("homeMenuTakeNotesAi")) $("homeMenuTakeNotesAi").onclick = () => { closeHomeFileMenu(); $("takeNotesAi")?.click(); };
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
  // A new note is no file yet: its first save must not go to the note that was open before.
  notePath = noteEntryKey = ""; setDocMember(null);
  await load(new File([seed], `${title}${SAVE_EXT[format]}`), { kind: "blank", title, sizes: Array.from({ length: count }, () => size), bytes: new ArrayBuffer(0), saveAs: format, canvas });
};
// Markdown written as handwriting ink (the MCP ink engine): a new note, or pages in this one.
const jobs = jobChip({ status });
// The desktop AI tools and/or the model in this app (WebLLM, where WebGPU exists).
const ai = jobs.watchAi(sharedAI());
const converter = handwritingConverter({
  call,
  status,
  ai,
  hasDocument: () => !!doc,
  sourceText: () => (!doc && textView?.visible && (converted || isMarkdownName(textView.key)) ? textView.text : ""),
  onCreate: async ({ title, markdown, options }) => {
    if (!canReplace()) return;
    let format = "project";
    try { format = newFormat(localStorage.getItem("notecomplete-new-format")); } catch { /* Optional. */ }
    const seed = crypto.getRandomValues(new Uint8Array(16));
    notePath = noteEntryKey = ""; setDocMember(null);
    await load(new File([seed], `${title}${SAVE_EXT[format]}`), { kind: "handwritten", title, markdown, options, bytes: new ArrayBuffer(0), saveAs: format });
  },
  onInsert: async ({ markdown, options, where }) => {
    if (!doc || busy()) return;
    const at = insertAt(where, page, doc.pages);
    await action("insertHandwritten", { at, markdown, options, focus: at });
  },
  // Documents to base a new note on and saving to a folder, as in Create exam with AI.
  context: () => ({
    openPdf,
    library,
    groups,
    hasOpenDoc: () => !!doc || studyText(),
    openDocTitle: () => (studyText() ? (textView.name || "Document") : (doc?.title || "Note")),
    openDocPages: () => (studyText() ? textSource.count : (doc?.pages || 0)),
    openDocResource: currentDocResource,
    pageText: studyDeps.pageText,
    pageCanvas: studyDeps.pageCanvas,
    notesText: studyDeps.notesText,
    openGeneratedFile,
    refreshHome: () => home?.renderRecent?.(),
  }),
});
$("newHandwritten").onclick = () => { closeMenus(); converter.open(); };
$("newWithAi").hidden = !sharedAI();
$("newWithAi").onclick = () => { closeMenus(); converter.open({ withAi: true }); };
$("insertHandwritten").onclick = () => { closeMenus(); if (doc) converter.open({ insert: true }); };
function closeMenus() {
  for (const menu of document.querySelectorAll("details.menu")) menu.open = false;
  $("imageTypes").hidden = true;
  $("exportImage").setAttribute("aria-expanded", "false");
}
const { exportRequest, exportRequested } = pageExporter({
  pageCanvas,
  call,
  documentInfo: () => ({ pages: doc?.pages || 0, title: doc?.title || "Note" }),
  currentPage: () => page,
  currentPanel: () => panels[page],
  pdfImage,
  backgroundPlacement,
  chinese: { ruby: rubyForExport, rubySvg, embedFont: embedChineseFont },
  filename,
  download,
  jobs: { start: (...a) => jobs.start(...a) },
  status,
  save,
  busy,
  closeMenus,
  $,
});
// Chinese settings kept in the note, and pinyin over characters (chinese/ruby.js).
configureRuby({
  getNote: () => (doc ? call("getChinese") : Promise.resolve({})),
  setNote: (chinese) => doc && call("setChinese", { chinese }),
  changed: () => { if (doc && collab?.role !== "tablet") { dirty = changed = true; savedState(); } },
  roots: () => panels.map((p) => p.render).filter(Boolean),
});
wireRubyControls();
// Notes panel: Markdown beside the pages (notes.js, loaded on first use).
let notes = null, notesLoading = null;
function notesApi() {
  return notesLoading ||= import("./notes.js").then(({ notesController }) => {
    notes = notesController({
      call,
      jump,
      currentPage: () => page,
      store: library.store,
      status,
      editPrefab: (spec) => figureEditor(spec, { editing: true }),
    });
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
// The side panels hidden and shown directly: Ctrl Alt B and Ctrl B, and a tab on the window's
// edge while one is hidden (the page list on the left, the notes on the right).
function toggleSide(side) {
  if (side === "left") { if (doc) $("pagesToggle").click(); }
  else if (doc || htmlView.visible || textView.visible) notesButton().click();
}
const sideTabs = Object.fromEntries(["left", "right"].map((side) => {
  const tab = Object.assign(document.createElement("button"), { type: "button", className: `side-edge ${side}`, hidden: true });
  tab.setAttribute("aria-label", side === "left" ? "Show the pages" : "Show the notes");
  tab.title = side === "left" ? "Show the pages (Ctrl Alt B)" : "Show the notes (Ctrl B)";
  tab.append(icon(side === "left" ? "chevronRight" : "chevronLeft"));
  tab.onclick = () => toggleSide(side);
  document.querySelector(".workspace")?.append(tab);
  return [side, tab];
}));
function syncSideTabs() {
  const pagesShown = phoneLayout.matches ? $("pagesPanel").classList.contains("open") : !$("pagesPanel").hidden;
  sideTabs.left.hidden = !doc || pagesShown || $("editor").hidden;
  sideTabs.right.hidden = !(doc || htmlView.visible || textView.visible) || !$("notesPanel").hidden || document.body.classList.contains("guest-mode");
}
const sideWatch = new MutationObserver(syncSideTabs);
for (const id of ["pagesPanel", "notesPanel", "editor"]) sideWatch.observe($(id), { attributes: true, attributeFilter: ["hidden", "class"] });
for (const id of ["closePages", "closeNotes"]) $(id).title = id === "closePages" ? "Hide the pages (Ctrl Alt B)" : "Hide the notes (Ctrl B)";
// The pages panel and the documents list beside HTML, text and web documents: their inner edge
// resizes them (panel-resize.js); the width is remembered.
resizablePanels(document.querySelector("#editor .workspace"), [{ panel: $("pagesPanel"), variable: "--pages-width", side: "left", key: "pages", min: 132, max: 560 }]);
for (const slot of ["htmlGroupSlot", "textGroupSlot", "webGroupSlot"]) {
  const body = $(slot)?.closest(".side-body");
  if (body) resizablePanels(body, [{ panel: $("groupPanel"), variable: "--group-width", side: "left", key: "group", min: 150, max: 560 }]);
}
// Names cut short slide to show their end while hovered (marquee.js).
installMarquee();
// The panel's left edge resizes it; the width is remembered.
try { const w = Number(localStorage.getItem("notecomplete-notes-width")); if (w >= 240) $("notesPanel").style.width = `${w}px`; } catch { /* Optional. */ }
$("notesResize").onpointerdown = (down) => {
  down.preventDefault();
  const start = down.clientX, width = $("notesPanel").offsetWidth;
  $("notesResize").setPointerCapture(down.pointerId);
  $("notesResize").onpointermove = (e) => { const z = uiZoom(); $("notesPanel").style.width = `${Math.max(240, Math.min((innerWidth / z) * 0.7, width + (start - e.clientX) / z))}px`; };
  $("notesResize").onpointerup = () => {
    $("notesResize").onpointermove = $("notesResize").onpointerup = null;
    try { localStorage.setItem("notecomplete-notes-width", String($("notesPanel").offsetWidth)); } catch { /* Optional. */ }
    resize();
  };
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
  const register = () => navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready).then(() => import("./prefab-packs.js").then((m) => m.topUp())).catch(() => { /* Optional. */ });
  if (/^\/(join|tablet|send)$/.test(location.pathname)) {
    const later = setTimeout(register, 60000);
    addEventListener("notecomplete:joined", () => { clearTimeout(later); setTimeout(register, 2000); }, { once: true });
  } else register();
}

function shapeHandles(p) {
  selection.render(p);
}
// An iPhone photo (HEIC) in what was just put in `root` (a page, or one item drawn again):
// decoded into a picture Chromium shows (heic.js); Safari shows it as it is (heic.js finds that
// out with the first photo and then leaves them alone).
function showHeic(root, svg) {
  if (typeof svg === "string" && svg.includes('data-format="heic"')) import("./heic.js").then((m) => m.showHeicPictures(root)).catch(() => { /* The labelled box stays. */ });
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
      // A moved or resized photo comes back as the engine draws it: HEIC again, converted anew.
      showHeic(el, result.svg);
      paintTapes(p.render, p.index);
      typesetMath(p.render, p.view?.texts);
      const svgEl = p.render.querySelector(":scope > svg");
      if (svgEl) rubySvg(svgEl).catch(() => {});
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
// The Shapes bar's Prefab: a click opens the picker; resting on it shows the ones used
// last, to insert one straight away.
prefabFlyout($("shapePrefab"), () => panels[page]);
function prefabFlyout(button, panel) {
  let timer = 0, menu = null;
  const close = () => { clearTimeout(timer); if (menu?.isConnected) closeContextMenu(); menu = null; };
  button.onclick = () => { close(); insertPrefab(panel()); };
  button.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch" || !doc) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const recent = recentPrefabs(6);
      if (!recent.length || editing || figureIsOpen() || document.querySelector("dialog[open], .pk-window")) return;
      const r = button.getBoundingClientRect();
      if (!r.width && !r.height) return;
      menu = openContextMenu(r.left, r.bottom + 4, [
        ...recent.map((choice) => ({ label: choice.label, icon: choice.icon, run: () => insertPrefab(panel(), null, choice) })),
        "-",
        { label: "All prefabs…", icon: "search", key: "⇧X", run: () => insertPrefab(panel()) },
      ], { title: "Recently used" });
      // It goes when the pointer has left both the button and it.
      menu?.addEventListener("pointerleave", () => { timer = setTimeout(close, 350); });
      menu?.addEventListener("pointerenter", () => clearTimeout(timer));
    }, 300);
  });
  button.addEventListener("pointerleave", () => { clearTimeout(timer); if (menu) timer = setTimeout(close, 350); });
}
textToolFlyout(document.querySelector('#toolbar [data-tool="text"]'));
function textToolFlyout(button) {
  if (!button) return;
  let timer = 0, menu = null;
  const close = () => { clearTimeout(timer); if (menu?.isConnected) closeContextMenu(); menu = null; };
  const openMenu = () => {
    if (!doc || editing || figureIsOpen() || document.querySelector("dialog[open], .pk-window")) return;
    const r = button.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const isZh = $("zhModeToggle")?.getAttribute("aria-pressed") === "true";
    const zhMode = $("zhModeToggle")?.dataset.zhMode || "off";
    const fonts = [...($("textFont")?.options || [])].filter((o) => o.value !== "__import__");
    menu = openContextMenu(r.left, r.bottom + 4, [
      {
        label: `Font: ${$("textFont")?.selectedOptions?.[0]?.textContent || "Sans"}`,
        icon: "text",
        submenu: () => fonts.map((o) => ({
          label: o.textContent,
          checked: $("textFont")?.value === o.value,
          run: () => { if ($("textFont")) { $("textFont").value = o.value; $("textFont").dispatchEvent(new Event("change", { bubbles: true })); } },
        })),
      },
      {
        label: `Size: ${$("textSize")?.value || "16"}`,
        icon: "text",
        submenu: () => [12, 14, 16, 18, 22, 28, 36, 48].map((sz) => ({
          label: `${sz} pt`,
          checked: Number($("textSize")?.value) === sz,
          run: () => { if ($("textSize")) { $("textSize").value = String(sz); $("textSize").dispatchEvent(new Event("change", { bubbles: true })); } },
        })),
      },
      "-",
      { label: "Bold", icon: "text", checked: $("textBold")?.getAttribute("aria-pressed") === "true", run: () => $("textBold")?.click() },
      { label: "Italic", icon: "text", checked: $("textItalic")?.getAttribute("aria-pressed") === "true", run: () => $("textItalic")?.click() },
      { label: "Math (LaTeX ∑)", icon: "graph", checked: $("textMath")?.getAttribute("aria-pressed") === "true", run: () => $("textMath")?.click() },
      "-",
      {
        label: isZh ? "Chinese input (Hanzi)" : "Chinese input (中)",
        icon: "text",
        checked: isZh,
        run: () => { $("zhModeToggle")?.click(); setTimeout(openMenu, 0); },
      },
      ...(isZh ? [
        { label: "Pinyin over characters (拼)", icon: "text", checked: $("zhRubyToggle")?.getAttribute("aria-pressed") === "true", run: () => $("zhRubyToggle")?.click() },
        { label: "Stroke order (笔)…", icon: "draw", run: () => { close(); $("zhTraceToggle")?.click(); } },
      ] : []),
    ], { title: "Text options" });
    menu?.addEventListener("pointerleave", () => { timer = setTimeout(close, 350); });
    menu?.addEventListener("pointerenter", () => clearTimeout(timer));
  };
  button.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch" || !doc) return;
    clearTimeout(timer);
    timer = setTimeout(openMenu, 300);
  });
  button.addEventListener("pointerleave", () => { clearTimeout(timer); if (menu) timer = setTimeout(close, 350); });
}
$("insertShape").onclick = () => {
  if (!doc || editing) return;
  if ($("shape").value === "graph") return insertPrefab(panels[page]);
  const p = panels[page],
    r = p.el.getBoundingClientRect(),
    v = $("viewport").getBoundingClientRect();
  const cy = (((Math.max(r.top, v.top) + Math.min(r.bottom, v.bottom)) / 2 - r.top) / r.height) * p.size[1];
  insertShapeAt(p, [p.size[0] / 2, cy], $("shape").value);
};
// A shape of `kind` centred on page point `at` (kept on the page), in the Shapes tool's
// colour and thickness; the Shapes tool is chosen so it can be dragged out to size.
function insertShapeAt(p, at, kind) {
  if (!doc || editing || !p) return;
  document.querySelector('[data-tool="shape"]').click();
  const cx = Math.max(110, Math.min(p.size[0] - 110, at[0])), cy = Math.max(80, Math.min(p.size[1] - 80, at[1]));
  const start = [cx - 100, cy - 60], end = [cx + 100, cy + 60],
    shape = { kind, start, end, ...fillFor(kind, $("color").value) },
    rgba = [1, 3, 5].map((i) => parseInt($("color").value.slice(i, i + 2), 16) / 255);
  action("draw", {
    page: p.index,
    line: { points: shapePoints(kind, start, end), shape, width: Number($("width").value), rgba: [...rgba, 1], tool: 0, layer: activeLayer },
  });
}

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
  if (!p) return 1;
  // The width resize() set, read without laying the pages out (this runs on every page
  // change while scrolling, often right after a page was drawn).
  const set = parseFloat(p.el.style.width);
  // A pinch in progress scales the pages with a transform (pinchBy), which the rectangle had.
  return set > 0 ? (set * (pinch?.scale || 1)) / p.size[0] : p.el.getBoundingClientRect().width / p.size[0];
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

receiveNativeFiles({ open: openImportedFile, canReplace, isBusy: busy, status });

// Audio and transcript live in a floating panel opened from the toolbar (A).
// Closing it docks active note audio to the top global audio bar; Shift+click × (or Shift+X inside
// the Audio window, or clicking × on the top bar) stops and closes it completely.
function dockNoteAudioToGlobalBar() {
  const hasAudio = audio.entries?.length > 0 && (!audio.paused || audio.time > 0);
  if (!hasAudio) return;
  const sel = $("recording");
  globalAudio.attachExternal({
    getTitle: () => sel?.options?.[sel.selectedIndex]?.textContent?.trim() || "Note audio",
    getTime: () => audio.time,
    getDuration: () => audio.duration,
    isPaused: () => audio.paused,
    isMuted: () => Boolean(audio.muted),
    getRate: () => audio.rate,
    togglePlay: () => $("playAudio")?.click(),
    skip: (delta) => audio.seek(Math.max(0, Math.min(audio.duration || Infinity, audio.time + delta))),
    seek: (t) => audio.seek(t),
    toggleMute: () => { if (typeof audio.setMuted === "function") audio.setMuted(!audio.muted); else audio.audio.muted = !audio.audio.muted; },
    stepRate: (dir) => audio.stepRate(dir),
    onOpen: () => toggleAudio(true),
    onStop: () => {
      if (audio.virtual) { audio.virtual.paused = true; audio.update?.(); }
      else audio.audio?.pause();
    },
  });
}
function toggleAudio(open = $("audioBar").hidden, { forceStop = false } = {}) {
  if ($("audioToggle").hidden) return;
  $("audioBar").hidden = !open;
  $("audioToggle").setAttribute("aria-expanded", String(open));
  if (open) {
    if (globalAudio.isExternal) globalAudio.detachExternal({ stop: false });
    audio.transcript.lookup();
  } else if (forceStop) {
    if (globalAudio.isExternal) globalAudio.detachExternal({ stop: false });
    if (audio.virtual) { audio.virtual.paused = true; audio.update?.(); }
    else audio.audio?.pause();
  } else {
    dockNoteAudioToGlobalBar();
  }
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
// Markdown / text viewer & editor side spacing (width) and snap alignment (left, center, right); remembered.
const TEXT_WIDTHS = new Set(["480", "640", "760", "1000", "1280", "full"]);
function setTextAlign(align) {
  const next = ["left", "right"].includes(align) ? align : "center";
  const view = $("textView");
  if (view) view.dataset.textAlign = next;
  for (const b of document.querySelectorAll("#textAlign [data-align]")) b.setAttribute("aria-checked", String(b.dataset.align === next));
  try { localStorage.setItem("notecomplete-text-align", next); } catch { /* Optional. */ }
}
function setTextWidth(width) {
  const next = TEXT_WIDTHS.has(String(width)) ? String(width) : "760";
  const view = $("textView");
  if (view) {
    view.dataset.textWidth = next;
    view.style.setProperty("--text-width", next === "full" ? "100%" : `${next}px`);
  }
  const sel = $("textWidth");
  if (sel) sel.value = next;
  try { localStorage.setItem("notecomplete-text-width", next); } catch { /* Optional. */ }
}
for (const b of document.querySelectorAll("#textAlign [data-align]")) b.onclick = () => setTextAlign(b.dataset.align);
if ($("textWidth")) $("textWidth").onchange = (e) => setTextWidth(e.target.value);
try { setTextAlign(localStorage.getItem("notecomplete-text-align") || "center"); } catch { setTextAlign("center"); }
try { setTextWidth(localStorage.getItem("notecomplete-text-width") || "760"); } catch { setTextWidth("760"); }
// Side-by-side 2-up page spread toggle; remembered on this device.
function setPageSpread(value) {
  const next = Number(value) === 2 ? 2 : 1;
  const sheet = panels[page]?.el, before = sheet?.getBoundingClientRect().top;
  spread = next;
  $("pages").dataset.spread = String(next);
  if ($("pagesSpread")) $("pagesSpread").setAttribute("aria-pressed", String(next === 2));
  if ($("viewSpread")) $("viewSpread").setAttribute("aria-checked", String(next === 2));
  if (doc) resize();
  if (sheet && before !== undefined) $("viewport").scrollTop += sheet.getBoundingClientRect().top - before;
  try { localStorage.setItem("notecomplete-page-spread", String(next)); } catch { /* Optional. */ }
}
if ($("pagesSpread")) $("pagesSpread").onclick = () => setPageSpread(spread === 2 ? 1 : 2);
if ($("viewSpread")) $("viewSpread").onclick = () => { setPageSpread(spread === 2 ? 1 : 2); closeMenus(); };
// Full screen on web (tabs.html iframe hosts app.html, so target top same-origin document when available).
function fullscreenDoc() {
  try {
    if (window.top && window.top !== window && window.top.document?.documentElement?.requestFullscreen) {
      return window.top.document;
    }
  } catch { /* Cross-origin frame: stay inside document. */ }
  return document;
}
function isFullscreen() {
  const topDoc = fullscreenDoc();
  return Boolean(topDoc.fullscreenElement || document.fullscreenElement);
}
function syncFullscreen() {
  if ($("viewFullscreen")) $("viewFullscreen").setAttribute("aria-checked", String(isFullscreen()));
  fitTools();
  if (doc) requestAnimationFrame(resize);
}
async function toggleFullscreen() {
  const targetDoc = fullscreenDoc();
  try {
    if (isFullscreen()) await (targetDoc.fullscreenElement ? targetDoc : document).exitFullscreen?.();
    else await (targetDoc.documentElement.requestFullscreen ? targetDoc : document).documentElement.requestFullscreen?.();
  } catch {
    if (targetDoc !== document && !isFullscreen()) {
      try { await document.documentElement.requestFullscreen?.(); } catch { status("Full screen is unavailable in this browser view.", true); }
    } else {
      status("Full screen is unavailable in this browser view.", true);
    }
  }
  syncFullscreen();
}
if ($("viewFullscreen")) {
  if (window.notecompleteUpdates || window.ReactNativeWebView) $("viewFullscreen").hidden = true;
  $("viewFullscreen").onclick = () => { closeMenus(); void toggleFullscreen(); };
  document.addEventListener("fullscreenchange", syncFullscreen);
  const topDoc = fullscreenDoc();
  if (topDoc !== document) topDoc.addEventListener?.("fullscreenchange", syncFullscreen);
}
try { setPageSpread(localStorage.getItem("notecomplete-page-spread") === "2" ? 2 : 1); } catch { setPageSpread(1); }
// Audio for transcription: a small popover under the transport row.
$("speechSettingsToggle").onclick = () => {
  const open = $("speechSettings").hidden;
  $("speechSettings").hidden = !open;
  $("speechSettingsToggle").setAttribute("aria-expanded", String(open));
};
try { setDarkPages(localStorage.getItem("notecomplete-dark-pages") === "1"); } catch { /* Optional. */ }
$("audioToggle").onclick = () => toggleAudio();
// Floating windows may cover the whole screen below the top bar (menus stay reachable).
// Floating windows may go anywhere on the screen, over the top bar too (floating.js `.over-bar`).
const screenArea = () => { const z = uiZoom(); return { left: 0, top: 0, width: Math.round(innerWidth / z), height: Math.round(innerHeight / z) }; };
floatingWindow($("audioBar"), { screen: screenArea, key: "notecomplete-audio-window", head: $("audioBar").querySelector(".audio-head"), close: $("audioClose"), label: "Audio", compact: { cls: "compact" }, scroll: true });
floatingWindow($("chatPanel"), { screen: screenArea, key: "notecomplete-chat-window", head: $("chatPanel").querySelector(".chat-head"), close: $("chatClose"), label: "Ask AI", compact: { cls: "compact" }, minHeight: 220 });
$("audioClose").title = "Close panel (keeps audio in top bar; Shift+click or Shift+X to stop & close)";
$("audioClose").onclick = (e) => toggleAudio(false, { forceStop: Boolean(e?.shiftKey) });
$("audioBar").addEventListener("keydown", (e) => {
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "x" && !e.target.closest?.("input, textarea, [contenteditable]")) {
    e.preventDefault();
    e.stopPropagation();
    toggleAudio(false, { forceStop: true });
  }
});
$("transcriptEdit").onclick = () => audio.transcript.toggleEdit();

// Opening from Drive or Recent goes through the same unsaved-changes check as local files.
async function openChosen(file, entry = null) {
  if (!ready || busy()) throw Error("Wait for the current operation to finish, then choose the file again.");
  const localPath = entry?.source === "local" ? (entry.path || "") : "";
  if (await openMediaFile(file, { path: localPath, origin: entry?.origin || "Recent" })) return false;
  if (await openArchiveFile(file)) return false;
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
  $("audioToggle").title = r ? `${r.mode === "animation" ? "Animation" : "Recording"} ${clock(r.seconds)}: audio and animation (A)` : "Audio and animation (A)";
  if (r) {
    $("recordingClock").textContent = clock(r.seconds);
    $("recordingNote").textContent = r.paused ? "Paused" : r.mode === "animation" ? "Recording animation" : "Recording";
    const pauseBtn = $("pauseRecording");
    if (pauseBtn) {
      pauseBtn.replaceChildren(icon(r.paused ? "play" : "pause"), r.paused ? "Resume" : "Pause");
    }
  }
  clearTimeout(clockTimer);
  if (r && !r.paused) clockTimer = setTimeout(recordingState, 500);
  const selected = audio.selected;
  $("stripAudioToAnim").hidden = !(selected && selected.asset && selected.recording && !selected.added && !audio.isAnimation(selected));
  $("removeAudio").hidden = !selected;
  if (selected) {
    $("removeAudio").title = selected.added
      ? `Remove this added ${audio.isAnimation(selected) ? "animation" : "recording"} from the note`
      : `Remove this ${audio.isAnimation(selected) ? "animation" : "recording"} from the note (undoable with Ctrl Z)`;
  }
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
function startAnimationRecording() {
  if (addedStore.recording || startingRecording) return;
  addedStore.startAnimation();
  if (!audio.paused) $("playAudio")?.click();
  recordingState();
  status("Recording animation (edit history only, no audio). Draw on the page, then press Stop.");
}
async function stopRecording() {
  if (!addedStore?.recording) return;
  try {
    const take = await addedStore.stop();
    if (take) {
      const kb = Math.max(1, Math.round(take.blob.size / 1024));
      status(`${take.name} kept in this note (${kb} KB).`);
    }
  } catch (e) { status(e.message, true); }
  recordingState();
}
function disarmRemove() {
  delete $("removeAudio").dataset.armed;
  if ($("removeAudioLabel")) $("removeAudioLabel").textContent = "Remove";
  else $("removeAudio").textContent = "Remove";
}
audio.onselect = () => { disarmRemove(); recordingState(); };
$("recordAudio").onclick = startRecording;
$("recordAnimation").onclick = startAnimationRecording;
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
$("stripAudioToAnim").onclick = async () => {
  const entry = audio.selected;
  if (!entry?.asset?.id || entry.added) return;
  await action("stripAudioMedia", { assetId: entry.asset.id });
  status("Converted to animation (audio removed to save space). Ctrl Z restores audio.");
};
$("removeAudio").onclick = async () => {
  const entry = audio.selected, button = $("removeAudio");
  if (!entry) return;
  if (button.dataset.armed !== "1") {
    button.dataset.armed = "1";
    if ($("removeAudioLabel")) $("removeAudioLabel").textContent = "Confirm";
    else button.textContent = "Press again to remove";
    return;
  }
  disarmRemove();
  if (entry.added) {
    await addedStore.remove(entry.added.id).catch((e) => status(e.message, true));
    status(`${entry.added.name} removed from this note.`);
    return;
  }
  const assetId = entry.asset?.id || entry.recording?.asset_id;
  if (!assetId) return;
  await action("deleteAudio", { assetId });
  status("Removed from this note. Ctrl Z restores it.");
};
window.addEventListener("beforeunload", (e) => { if (addedStore.recording) { e.preventDefault(); e.returnValue = ""; } });
// The open note's file on disk (desktop), so AI tools can read other pages via MCP,
// and its Recent entry, so removing it can first upload unsaved changes to Drive.
let notePath = "", noteEntryKey = "";

const queueView = queueWindow({ queue: () => downloadQueue, $ });
let downloadsBusy = false;
const downloadQueue = createDownloadQueue({
  library,
  onItemDone: (item) => {
    drive?.onQueueItemDone?.(item);
    dropbox?.onQueueItemDone?.(item);
    archive?.onQueueItemDone?.(item);
  },
  onUpdate: (stats) => {
    queueView.update(stats);
    // Desktop: a tab with downloads running is not throttled while another tab is shown. Only
    // while one is actually downloading: a paused or finished queue gives the throttling back,
    // so hidden tabs cost no more than before.
    const running = !!stats.activeItem || (stats.pending > 0 && !stats.isPaused);
    if (running !== downloadsBusy) {
      downloadsBusy = running;
      window.notecompleteTabs?.busy?.(downloadsBusy)?.catch?.(() => {});
    }
  },
});

const drive = driveBrowser({
  library,
  queue: downloadQueue,
  exportRequest,
  onCards: () => home?.applyFilters(),
  open: async (file, driveFile) => {
    const opened = await openChosen(file);
    exportRequested(`drive:${driveFile.id}`, opened).catch((error) => status(error.message, true));
    if (opened) {
      const cKey = library.coverKey(driveFile);
      activeCoverKeyOverride = cKey;
      home.rememberFacts(cKey, file);
      notePath = await library.pathOf(await library.entry(driveFile)).catch(() => "");
      noteEntryKey = library.key(driveFile);
      rememberDocument(noteEntryKey);
      setDocMember({ key: noteEntryKey, name: driveFile.name, source: "drive" });
      void Promise.resolve(home.rememberCover(cKey, file)).then(() => ensureDocumentCover({ skipExisting: true }));
    }
    return opened;
  },
});
const dropbox = dropboxBrowser({
  library,
  queue: downloadQueue,
  exportRequest,
  onCards: () => home?.applyFilters(),
  open: async (file, dropboxFile) => {
    const opened = await openChosen(file);
    exportRequested(`dropbox:${dropboxFile.id}`, opened).catch((error) => status(error.message, true));
    if (opened) {
      const cKey = library.coverKey(dropboxFile);
      activeCoverKeyOverride = cKey;
      home.rememberFacts(cKey, file);
      notePath = await library.pathOf(await library.entry(dropboxFile)).catch(() => "");
      noteEntryKey = library.key(dropboxFile);
      rememberDocument(noteEntryKey);
      setDocMember({ key: noteEntryKey, name: dropboxFile.name, source: "dropbox" });
      void Promise.resolve(home.rememberCover(cKey, file)).then(() => ensureDocumentCover({ skipExisting: true }));
    }
    return opened;
  },
});
// The kept copy's MD5 (the core computes it), to match Drive's md5Checksum.
library.md5 = (bytes) => call("md5", { bytes: bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer });
function activeCoverKey() {
  return activeCoverKeyOverride || noteEntryKey || "";
}
async function coverImageDimensions(url) {
  if (!url || typeof Image !== "function") return null;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  return { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
}
// Whether a drawn page is one flat colour (nothing on it), sampled on a coarse grid.
function blankCanvas(canvas) {
  try {
    const { width, height } = canvas, data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
    const at = (x, y) => (Math.floor(y) * width + Math.floor(x)) * 4;
    const first = at(width / 2, height / 2);
    for (let y = 0; y < height; y += Math.max(1, height / 64))
      for (let x = 0; x < width; x += Math.max(1, width / 48)) {
        const i = at(x, y);
        if (Math.abs(data[i] - data[first]) + Math.abs(data[i + 1] - data[first + 1]) + Math.abs(data[i + 2] - data[first + 2]) > 24) return false;
      }
    return true;
  } catch {
    return false;
  }
}
/** Screengrab page 0 as a JPEG thumbnail when a non-text document's cover is missing or a tiny placeholder. */
async function ensureDocumentCover({ skipExisting = true } = {}) {
  try {
    if (!doc || !panels.length) return;
    if (shouldSkipCoverFile({ name: activeFileName || docMember?.name || "", kind: activeDocKind })) return;
    const key = activeCoverKey();
    if (!key) return;
    const token = epoch;
    let keepIfBlank = false;
    if (skipExisting) {
      const existing = await library.cover(key).catch(() => null);
      if (token !== epoch || !doc) return;
      // A notebook's own picture (home.js) stands in until its first page is drawn here; so
      // does a box drawn for a zip that turned out to be a notebook.
      keepIfBlank = isNotebookCover(existing);
      if (existing && !isNotebookCover(existing) && !(activeDocKind === "notebook" && existing.startsWith("data:image/svg+xml"))) {
        if (existing.startsWith("data:image/svg+xml")) return;
        const dims = await coverImageDimensions(existing);
        if (token !== epoch || !doc) return;
        if (dims && !isTinyCoverSize(dims.width, dims.height)) return;
      }
    }
    const rendered = await pageCanvas(0, 320);
    if (token !== epoch || !doc || !rendered?.canvas) return;
    // A notebook whose first page is a blank sheet keeps its own picture (its cover in Goodnotes).
    if (keepIfBlank && blankCanvas(rendered.canvas)) return;
    const dataUrl = rendered.canvas.toDataURL("image/jpeg", 0.82);
    rendered.canvas.width = rendered.canvas.height = 0;
    if (!dataUrl) return;
    await library.saveCover(key, dataUrl);
    if (home?.visible) home.renderRecent?.();
  } catch { /* Optional cover fallback. */ }
}
// A restart for an update (desktop session.js): before it, what this tab shows, for it to
// open again after: its Recent entry and page, and an automatic save of unsaved changes (or
// of a note never saved), made now even with auto-save off. Null on Home.
window.notecompleteSession = async () => {
  if (!doc && !sideView()) return null;
  const state = { entryKey: noteEntryKey || "", page: doc ? page : 0, title: $("title").textContent || "" };
  if (doc && ((dirty && changed) || !noteEntryKey)) {
    const slot = await autosave.now({ force: true, always: true }).catch(() => null);
    if (slot?.id) state.slot = slot.id;
  }
  return state;
};
// After it: the entry opened as from Recent, then its automatic save over it (the same file
// to save to, unsaved), then the page it was on. True when there was something to restore.
async function restoreAfterUpdate() {
  // Prefab modules from the folder in use (desktop), before anything asks for a prefab.
  if (window.notecompletePrefabs) await import("./prefab-modules-ui.js").then((m) => m.loadFolderModules()).catch((e) => console.warn(e));
  const state = await window.notecompleteRestore?.take?.().catch(() => null);
  if (!state) return false;
  try {
    const entry = state.entryKey ? await library.store.get("entries", state.entryKey).catch(() => null) : null;
    if (entry?.source === "web") await openWeb(webMember(entry.url, entry.name));
    else if (entry) {
      const file = await library.open(entry);
      if (file) await openFromLibrary(file, entry);
    }
    if (state.slot && !(await autosave.restore(state.slot)) && !doc) throw Error(`The unsaved changes of “${state.title || "a note"}” were not kept.`);
    if (doc && state.page > 0) jump(Math.min(state.page, (doc.pages || 1) - 1));
    if (doc || sideView()) status(state.slot ? "Updated. Your note is open again, with its unsaved changes." : "Updated. Your note is open again.");
    else status(`${state.title || "The note"} could not be opened again; it is in Recent.`, true);
  } catch (e) {
    status(e.message, true);
  }
  return true;
}
async function openFromLibrary(file, entry) {
  if (await openArchiveFile(file, { key: entry?.key || "", entry })) return false;
  const opened = await openChosen(file, entry);
  if (opened) {
    notePath = await library.pathOf(entry).catch(() => ""); noteEntryKey = entry?.key || ""; rememberDocument(noteEntryKey);
    // Search inside notes from Recent finds this note's kept text without reading it again.
    if (entry && find.fingerprint) rememberFingerprint(library, entry, find.fingerprint);
    activeCoverKeyOverride = entry?.source === "drive"
      ? library.coverKey({ id: entry.driveId, modifiedTime: entry.modifiedTime })
      : entry?.source === "dropbox"
        ? library.coverKey(entry)
        : (entry?.key || "");
    setDocMember(entry?.source === "local" ? localMember(entry.path, entry.name) : entry?.key ? { key: entry.key, name: entry.name, source: entry.source || "drive" } : null);
    void ensureDocumentCover({ skipExisting: true });
  }
  return opened;
}
// Which file a fingerprint belongs to, for All quizzes (`doc:<fingerprint>`).
async function rememberDocument(entryKey = "") {
  if (collab?.role === "tablet") return;
  const fp = (doc && find.fingerprint) || (sideView() && sideFp);
  if (!fp) return;
  const before = await library.store.get("settings", `doc:${fp}`).catch(() => null);
  await library.store.set("settings", `doc:${fp}`, { title: doc?.title || sideView()?.name || $("title").textContent, entryKey: entryKey || before?.entryKey || "", at: Date.now() }).catch(() => { /* Optional. */ });
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
  await autosave.compact(doc.edit_count || 0, "up to now");
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
const versions = versionChooser({ library, drive, dropbox, open: openFromLibrary, status, fingerprint: (file) => noteFingerprint(file).catch(() => "") });
// Dark pages (moon, D) darken HTML documents too; pages already dark are left alone.
let darkReader = null;
// Dark Reader's script, fetched once (vendor/darkreader), for HTML pages and web links.
const loadDarkReader = () => (darkReader ||= fetch("vendor/darkreader/darkreader.js").then((r) => {
  if (!r.ok) throw Error("Dark Reader is missing from this build.");
  return r.text();
}).catch((error) => { darkReader = null; status(error.message, true); throw error; }));
let embeddedExam = null;
const htmlView = htmlViewer({
  root: $("htmlView"),
  frame: $("htmlFrame"),
  title: $("htmlTitle"),
  reload: $("htmlReload"),
  clear: $("htmlClear"),
  status,
  // Edit: the HTML source in the plain editor; Save / Ctrl S writes it like a text file (or back into .nfedit).
  editorHost: $("htmlEditor"), edit: $("htmlEdit"),
  onChange: () => {
    dirty = changed = true;
    $("htmlSave").hidden = false;
    if (embeddedExam?.active && doc) {
      embeddedExam.data = { ...(embeddedExam.data || {}), html: htmlView.text };
      call("setExam", { exam: embeddedExam.data }).catch(() => {});
      savedState();
      tabBar.update({ title: doc?.title || htmlView.name, dirty: true });
      return;
    }
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
  root: $("webView"), host: $("webHost"), title: $("webTitle"), address: $("webAddress"), back: $("webBack"), forward: $("webForward"), reload: $("webReload"),
  external: $("webExternal"), fallback: $("webFallback"), status,
  onTitle: (name, url) => {
    $("title").textContent = name;
    document.title = `${name} — NoteComplete`;
    tabBar.update({ title: name, dirty: false });
    if (url === docMember?.url) library.rememberWeb(docMember.url, name).catch((e) => console.warn("Remember web:", e));
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
// PlantUML's own drawing of a diagram (desktop: the PlantUML installed there; elsewhere none).
function drawPlantuml(text) {
  return window.notecompleteDiagrams?.plantuml
    ? window.notecompleteDiagrams.plantuml(text, !converted && docMember?.source === "local" ? docMember.path : "")
    : Promise.resolve({ unavailable: true });
}
const textView = textViewer({
  root: $("textView"), body: $("textBody"), editorHost: $("textEditor"), title: $("textTitle"), format: $("textMarkdown"), edit: $("textEdit"),
  zoom: { out: $("textZoomOut"), into: $("textZoomIn"), value: $("textZoomValue") },
  editorZoom: { out: $("textEditorZoomOut"), into: $("textEditorZoomIn"), value: $("textEditorZoomValue") },
  toHtml: (value) => call("markdownHtml", { text: value }),
  imageUrl: textImageUrl,
  // PlantUML files are drawn by the desktop app's PlantUML; includes come from the file's folder.
  diagram: {
    is: isDiagramName,
    draw: drawPlantuml,
    // Class, package and use case diagrams open in the UML editor of the prefabs; N stays the
    // document's Notes (the editor's own notes have their button).
    mount: (host, text, { onText }) => import("./diagram-doc.js").then(({ mountDiagramDoc }) => mountDiagramDoc(host, {
      text, onText, draw: drawPlantuml,
      ignoreKey: (ev) => !ev.ctrlKey && !ev.metaKey && !ev.altKey && ["n", "N", "?"].includes(ev.key),
      markdown: (value) => call("markdownHtml", { text: value }),
      onError: (message) => status(message, true),
    })),
  },
  // The Notes panel's TinyMDE, for Markdown files.
  loadEditor: () => import("./notes.js").then((m) => m.loadEditor()),
  editPrefab: (spec) => figureEditor(spec, { editing: true }),
  tablePage: (info) => tablePageMenu(info),
  tableNotify: (message, error = false) => status(message, error),
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
      await library.rememberLocal(saved.path, saved.name, saved.size).catch((e) => console.warn("Remember local:", e));
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
  const html = view === htmlView, ext = html ? ".html" : view.markdown ? ".md" : ".txt";
  const name = docMember?.name || (/\.(md|markdown|txt|html?)$/i.test(view.name) ? view.name : `${view.name}${ext}`);
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
$("textSave").onclick = () => saveText();
async function insertOpenDiagramIntoNote(openTargetNote) {
  if (!textView.hasDocument || !textView.diagram) return;
  const name = textView.name || "Diagram";
  let payload = null;
  const model = textView.diagramModel?.();
  if (model && model.elements?.length) payload = { kind: "uml", spec: model };
  else {
    let svg = textView.diagramSvg?.();
    if (!svg && textView.text) {
      const res = await drawPlantuml(textView.text);
      if (res?.svg) svg = res.svg;
    }
    if (svg) payload = { kind: "image", file: await svgToPngFile(svg, name) };
    else {
      // Fallback: try parsing PlantUML in case diagramDoc wasn't mounted (e.g. text mode off).
      try { payload = { kind: "uml", spec: await importDiagramSpec(textView.text, name) }; }
      catch (e) { status(e.message, true); return; }
    }
  }
  await openTargetNote();
  if (!doc || !panels[page] || !ensureEditableLayer()) return;
  if (payload.kind === "uml") {
    const done = await placePrefab(panels[page], payload.spec);
    if (done) status(`${prefabName(payload.spec)} inserted into note. Right-click it, hold it, or tap its ⋯ to edit it; one undo removes it.`);
  } else {
    await importImages([payload.file]);
  }
}
// The notes something from the open document can go into: the last note, recent ones, a new
// blank note or a file to choose. insert(openTargetNote) opens the one picked and puts it there.
async function noteTargetEntries(insert, blankTitle) {
  const recent = (await library.recent(12).catch(() => [])).filter((e) => e && e.source !== "web" && /\.(noteful|nfedit|notecomp(lete)?|notepart)$/i.test(e.name || ""));
  const entries = [];
  if (lastNoteMember) {
    entries.push({ label: `Insert into ${lastNoteMember.name}`, icon: "note", run: () => insert(() => openMember(lastNoteMember)) });
    entries.push("-");
  }
  for (const e of recent) {
    if (lastNoteMember && (e.key === lastNoteMember.key || (e.path && e.path === lastNoteMember.path))) continue;
    entries.push({ label: entryTitle(e), icon: "note", run: () => insert(async () => { const f = await library.open(e); if (f) await openFromLibrary(f, e); }) });
  }
  if (entries.length) entries.push("-");
  entries.push({
    label: "New blank note",
    icon: "plus",
    run: () => insert(async () => {
      if (!canReplace()) return;
      let format = "project";
      try { format = newFormat(localStorage.getItem("notecomplete-new-format")); } catch { /* Optional. */ }
      const title = (textView.name || blankTitle).replace(/\.[^.]+$/, "");
      const seed = crypto.getRandomValues(new Uint8Array(16));
      notePath = noteEntryKey = ""; setDocMember(null);
      await load(new File([seed], `${title}${SAVE_EXT[format]}`), { kind: "blank", title, sizes: [PRESETS.a4.mm.map(mmToUnits)], bytes: new ArrayBuffer(0), saveAs: format, canvas: false });
    }),
  });
  entries.push({
    label: "Choose a note file…",
    icon: "open",
    run: () => insert(() => openLocal()),
  });
  return entries;
}
$("textIntoNote").onclick = async () => {
  if (!textView.hasDocument || !textView.diagram) return;
  const rect = $("textIntoNote").getBoundingClientRect();
  openContextMenu(rect.left, rect.bottom + 4, await noteTargetEntries(insertOpenDiagramIntoNote, "Diagram"), { title: "Insert diagram into note" });
};
// A table of the open document on a page of a note (table-filter.js: the rows shown, in their
// order, cut to what a page table holds). The table editor opens with it, to check and insert.
// Gives the menu's title and entries (the table's bar and its right-click menu show them).
async function tablePageMenu({ value, total, kept, head = 1, filtered, filter }) {
  const cut = kept.rows < total.rows || kept.columns < total.columns;
  // Rows counted without the header, as the table's bar counts them.
  const rows = (n) => `${n} ${filtered ? "rows shown" : "rows"}`;
  const title = cut
    ? `A page table holds up to ${TABLE_MAX_ROWS} rows and ${TABLE_MAX_COLUMNS} columns. Put the header and the first ${rows(kept.rows - head)} of ${total.rows - head}${kept.columns < total.columns ? `, the first ${kept.columns} of ${total.columns} columns,` : ""} on a page of:`
    : `Put this table (${rows(total.rows - head)}) on a page of:`;
  const insert = async (openTargetNote) => {
    await openTargetNote();
    if (!doc || !panels[page] || !ensureEditableLayer()) return;
    await insertCompound(panels[page], "table", null, value);
  };
  const entries = await noteTargetEntries(insert, "Table");
  if (cut && filter) entries.unshift({ label: "Choose the rows with the filter first", icon: "search", run: filter }, "-");
  return { title, entries };
}
$("htmlSave").onclick = async () => {
  if (embeddedExam?.active && doc) {
    await save(false, saveAs === "noteful" ? "noteful" : "project", null, { inPlace: true });
    $("htmlSave").hidden = true;
    return;
  }
  await saveText();
};
async function openEmbeddedExamHtml() {
  if (!doc) return;
  const data = await call("getExam").catch(() => null);
  if (!data?.html) { status("No embedded interactive HTML is saved inside this note.", true); return; }
  embeddedExam = { active: true, data };
  const name = doc.title || $("title").textContent || "Exam";
  htmlView.open({ text: data.html, fingerprint: find.fingerprint || docMember?.name || name, name });
  $("htmlBackToNote").hidden = false;
  $("htmlExportCopy").hidden = false;
  $("htmlSave").hidden = !(dirty && changed);
  $("htmlNotes").hidden = true;
  if (docMember) groupList.mount($("htmlGroupSlot"));
  showDocument();
  documentControls();
}
function closeEmbeddedExamHtml() {
  if (!embeddedExam?.active) return;
  embeddedExam = null;
  htmlView.close();
  $("htmlBackToNote").hidden = true;
  $("htmlExportCopy").hidden = true;
  $("htmlNotes").hidden = false;
  if (doc) groupList.mount($("pagesGroupSlot"));
  showDocument();
  documentControls();
}
$("htmlBackToNote").onclick = () => closeEmbeddedExamHtml();
$("htmlExportCopy").onclick = async () => {
  const html = htmlView.text || embeddedExam?.data?.html;
  if (!html) return;
  const base = (doc?.title || "Exam").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "Exam";
  await download(html, `${base}.html`, "text/html");
};
// A text document open instead of a note: studied by sections.
function studyText() { return !doc && textView.hasDocument; }
// The open HTML or text document, when one is open instead of a note.
function sideView() { return htmlView.hasDocument ? htmlView : textView.hasDocument ? textView : webView.hasDocument ? webView : officeView?.hasDocument ? officeView : null; }
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
  noteEntryKey = entry.key;
  const host = linkTitle(member.url).split("/")[0], esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  if (!(await library.cover(entry.key))) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" width="240" height="320"><rect width="240" height="320" fill="#ffffff"/><g font-family="system-ui, sans-serif"><text x="22" y="150" font-size="13" font-weight="700" fill="#1d2433">${esc(member.name.slice(0, 30))}</text><text x="22" y="172" font-size="11" fill="#5b6478">${esc(host)}</text></g></svg>`;
    await library.saveCover(entry.key, `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`).catch(() => { /* Optional. */ });
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
async function exportOpenNoteFile() {
  if (doc) {
    // The .nfedit archive, as File → Save writes it.
    const { bytes } = await exportNoteBytes("project");
    const rawTitle = ($("title")?.textContent || "Note").trim().replace(/[^\w.\- ]+/g, "_") || "Note";
    const fileName = /\.(nfedit|noteful)$/i.test(rawTitle) ? rawTitle : `${rawTitle}.nfedit`;
    return new File([bytes], fileName, { type: "application/octet-stream" });
  }
  if (textView.hasDocument) {
    const rawName = textView.name || `${($("title")?.textContent || "Note").trim() || "Note"}.md`;
    return new File([textView.text || ""], rawName, { type: "text/markdown" });
  }
  return null;
}
const github = githubBrowser({
  library,
  open: openFromLibrary,
  status,
  exportOpenNote: exportOpenNoteFile,
});
const webdav = webdavBrowser({
  library,
  open: openFromLibrary,
  status,
  exportOpenNote: exportOpenNoteFile,
});
var home = homeScreen({
  library,
  drive,
  dropbox,
  github,
  webdav,
  archive,
  versions,
  open: openFromLibrary,
  openLink: (entry) => openWeb(webMember(entry.url, entry.name)),
  openArchive: (member) => openArchiveMember(member).catch((error) => status(error.message, true)),
  groups,
  status,
  jobs,
  exportStudy: exportStudyOf,
  cutHistory: cutHistoryOf,
  exportNote: exportNoteOf,
  // Batch OCR and the search inside notes read other notes' pages like the open one's.
  pageCanvas,
  findIn: (query) => { if (doc && !$("editor").hidden) find.find(query); },
  onContentKept: (fingerprint, data) => find.adopt(fingerprint, data),
  // Home → Recent → Share: several notes in one .zip, sent like one note (collab.js).
  shareZip: async (file) => {
    try {
      const { openShareNoteQr } = await (collabLoading ||= import("./collab.js"));
      await openShareNoteQr(collabHost, { file, title: "Share notes" });
    } catch (e) {
      collabLoading = null;
      status(e.message, true);
    }
  },
  current: () => ({
    entryKey: noteEntryKey,
    webUrl: webView.hasDocument ? webView.url : "",
    dirty: Boolean((doc || textView.hasDocument || htmlView.hasDocument) && dirty && changed),
    show: () => (doc || sideView()) && showDocument(),
    exportBlob: async () => new Blob([await call("export")], { type: "application/octet-stream" }),
  }),
});
setupCloudGuideDialog({
  drive,
  dropbox,
  github,
  webdav,
  archive,
  status,
  onSelectProvider: (provider) => {
    showHome();
    home.showCloudProvider?.(provider);
  },
});
// The desktop bridge opens files itself so Recent can reopen them by path.
async function openLocal() {
  const bridge = window.notecompleteFiles;
  if (!bridge?.openFile) return $("file").click();
  try {
    const chosen = await bridge.openFile();
    if (!chosen) return;
    if (chosen.external || isMp4Name(chosen.name)) {
      await openExternalVideo(chosen.path, chosen.name);
      return;
    }
    const file = new File([chosen.bytes], chosen.name);
    if (await openMediaFile(file, { path: chosen.path })) return;
    if (busy()) return;
    if (await openArchiveFile(file, { path: chosen.path })) return;
    if (!canReplace()) return;
    await load(file);
    await openedLocal(chosen.path, chosen.name, file);
  } catch (error) {
    status(error.message, true);
  }
}
async function openedLocal(path, name, file) {
  notePath = path;
  const entry = await library.rememberLocal(path, name, file.size);
  noteEntryKey = entry.key;
  activeCoverKeyOverride = entry.key;
  rememberDocument(entry.key);
  home.rememberFacts(entry.key, file);
  setDocMember(localMember(path, name));
  void Promise.resolve(home.rememberCover(entry.key, file)).then(() => ensureDocumentCover({ skipExisting: true }));
}
// Archives (.zip, .tar, .tar.gz/.tgz, .gz; archive.js): opened, they show what they hold in
// the archive window (archive-view.js), checked entry by entry, and each entry NoteComplete
// reads opens from there as a document. Nothing is extracted to disk. A zipped Goodnotes
// notebook opens as the notebook; a zip of several notebooks (a Goodnotes folder export) as a
// group of documents beside the open one, each unpacked and converted when it is opened.
// The last archive read stays in memory for its notebooks (one at a time: they can be large).
let archiveCache = { key: "", name: "", bytes: null };
const zipWin = archiveView({ open: (file, title) => openFromArchive(file, title), save: saveFromArchive, status });
function showArchiveTitle(title) {
  $("title").textContent = title;
  document.title = `${title} — NoteComplete`;
  tabBar.update({ title });
}
async function openFromArchive(file, title, member = null) {
  if (!ready || busy()) { status("Wait for the current operation to finish.", true); return false; }
  if (await openMediaFile(file)) return true;
  if (!canReplace()) return false;
  notePath = noteEntryKey = "";
  await load(file);
  await setDocMember(member);
  showArchiveTitle(title);
  return true;
}
async function saveFromArchive(bytes, name) {
  const bridge = window.notecompleteFiles;
  if (bridge?.saveEntry) {
    const chosen = await bridge.saveEntry(name, bytes);
    if (chosen) status(`Saved ${chosen.name}.`);
    return;
  }
  await download(bytes, name, "application/octet-stream");
  status(`${name} downloaded.`);
}
// Returns true when `file` is an archive (shown, or reported when it cannot be read here).
// `path`: its place on this computer (desktop); `origin`: kept in the library as imported;
// `key`: its Recent entry when it already has one.
async function openArchiveFile(file, { path = "", origin = "", key = "" } = {}) {
  if (!file) return false;
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const format = archiveFormat(file.name, head);
  if (!format) return false;
  if (format === "7z" || format === "rar") { status(unsupportedMessage(format), true); return true; }
  status(`Reading ${file.name}…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Recent keeps the archive: reopened from there, it shows again.
  if (!key && path) key = (await library.rememberLocal(path, file.name, file.size).catch(() => null))?.key || "";
  else if (!key && origin) key = (await library.rememberImported(file, { origin }).catch(() => null))?.key || "";
  else if (key) await library.touch(key).catch(() => {});
  if (home?.visible) home.renderRecent();
  if (format === "zip") {
    const listing = await readArchive(bytes, { name: file.name, verify: false }).catch(() => null);
    if (listing && looksLikeGoodnotes(listing.entries)) {
      const notebook = new File([bytes], `${notebookTitle(file.name)}.goodnotes`);
      if (busy() || !canReplace()) return true;
      notePath = noteEntryKey = "";
      await load(notebook);
      if (path) await openedLocal(path, file.name, notebook);
      else if (key) {
        noteEntryKey = key; activeCoverKeyOverride = key; rememberDocument(key);
        await setDocMember({ key, name: file.name, source: "imported" });
        // Its Recent card: the notebook's own picture, then its first page.
        void Promise.resolve(home.rememberCover(key, notebook)).then(() => ensureDocumentCover({ skipExisting: true }));
      }
      return true;
    }
    if (listing && await openNotebookPack(listing, key || `temp:${file.name}`, file.name)) return true;
  }
  archiveCache = { key, name: file.name, bytes };
  await zipWin.show(bytes, file.name);
  const checked = zipWin.current?.summary;
  if (checked) status(`${file.name}: ${checked.text}.`, checked.broken);
  return true;
}
// The notebooks in an archive and in the zips inside it (three levels at most), with their
// folders. Two or more: a group of documents, the first one opened.
async function openNotebookPack(archive, key, name) {
  const found = [];
  const walk = async (arch, trail, depth) => {
    for (const nb of notebooksIn(arch)) {
      if (nb.kind !== "archive") { found.push({ trail: [...trail, nb.path], kind: nb.kind }); continue; }
      if (depth >= 3 || nb.entry.size > 512 * 1048576) continue;
      const inner = await extractEntry(arch, nb.entry).catch(() => null);
      const sub = inner && await readArchive(inner, { name: nb.name, verify: false }).catch(() => null);
      if (!sub) continue;
      if (looksLikeGoodnotes(sub.entries)) found.push({ trail: [...trail, nb.path], kind: "file" });
      else await walk(sub, [...trail, nb.path], depth + 1);
    }
  };
  await walk(archive, [], 0);
  if (found.length < 2) return false;
  archiveCache = { key, name, bytes: archive.bytes };
  const members = found.map((f) => ({ key: `archive:${key}#${f.trail.join("#")}`, name: f.trail.join(" › "), source: "archive", archive: key, archiveName: name, trail: f.trail, kind: f.kind }));
  const id = `archive:${key}`, before = await library.store.get("settings", `group:${id}`).catch(() => null);
  await groups.save({ id, name: notebookTitle(name), kind: "folder", archive: key, members, starred: before?.starred || [], openedAt: Date.now() });
  await openArchiveMember(members[0]);
  status(`${name}: ${members.length} notebooks, listed beside the document. Each one is converted when you open it.`);
  return true;
}
// A notebook of a pack: unpacked from its archive (read again from Recent when it is not the
// one in memory), through the zips it is inside, and opened.
async function openArchiveMember(member) {
  if (!ready || busy()) return;
  if (!canReplace()) return;
  let bytes = archiveCache.key === member.archive ? archiveCache.bytes : null;
  if (!bytes) {
    const entry = await library.store.get("entries", member.archive).catch(() => null);
    const file = entry && await library.open(entry).catch(() => null);
    if (!file) throw Error(`${member.archiveName || "Its archive"} is no longer where it was: open it again.`);
    bytes = new Uint8Array(await file.arrayBuffer());
    archiveCache = { key: member.archive, name: entry.name, bytes };
  }
  const leafPath = member.trail[member.trail.length - 1];
  const progress = (done, total) => status(`Unpacking ${leafPath}… ${Math.round((done / Math.max(1, total)) * 100)}%`);
  status(`Unpacking ${leafPath}…`);
  let arch = await readArchive(bytes, { name: member.archiveName, verify: false });
  for (let i = 0; i < member.trail.length; i++) {
    const path = member.trail[i], last = i === member.trail.length - 1;
    if (last && member.kind === "folder") { bytes = await packFolder(arch, path, { zipFiles, onProgress: progress }); break; }
    const entry = arch.entries.find((e) => e.path === path && e.kind === "file");
    if (!entry) throw Error(`${path} is no longer in ${member.archiveName}.`);
    bytes = await extractEntry(arch, entry);
    if (!last) arch = await readArchive(bytes, { name: path, verify: false });
  }
  const leaf = leafPath.split("/").pop().replace(/\.zip$/i, "");
  const file = new File([bytes], /\.(goodnotes|ntb)$/i.test(leaf) ? leaf : `${leaf}.goodnotes`);
  notePath = noteEntryKey = "";
  await load(file);
  await setDocMember(member);
  showArchiveTitle(`${member.archiveName} › ${member.trail.join(" › ")}`);
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
let docMember = null, lastNoteMember = null;
const isNoteMemberName = (name) => /\.(noteful|nfedit|notecomp(lete)?|notepart|goodnotes|ntb)$/i.test(name || "");
function setDocMember(member) {
  docMember = member;
  if (doc && member && isNoteMemberName(member.name)) lastNoteMember = member;
  // A Markdown file's pictures sit beside it: show them now that its place is known.
  if (textView.hasDocument && !converted && /!\[[^\]]*\]\(/.test(textView.text)) textView.rerender();
  // A diagram's !include files sit beside it too.
  else if (textView.hasDocument && textView.diagram && textView.markdown && /^\s*!include/m.test(textView.text)) textView.rerender();
  groupList.mount(htmlView.hasDocument ? $("htmlGroupSlot") : textView.hasDocument ? $("textGroupSlot") : webView.hasDocument ? $("webGroupSlot") : $("pagesGroupSlot"));
  $("addDocuments").disabled = !member;
  // Opening a document of a folder brings that folder to the front of Home's Folders.
  return groupList.set(member).then(() => groupList.group && groups.touch(groupList.group)).catch((e) => console.warn("Group panel:", e));
}
async function openMember(member) {
  if (member.source === "local" && isMp4Name(member.name)) {
    return openExternalVideo(member.path, member.name);
  }
  if (member.source === "local" && isMp3Name(member.name)) {
    const bytes = await window.notecompleteFiles?.readRecent(member.path);
    if (!bytes) throw Error(`${member.name} is no longer in its folder.`);
    return openMediaFile(new File([bytes], member.name), { path: member.path });
  }
  if ((doc || sideView()) && docMember && docMember.key !== member.key)
    navHistory.record(currentStop(), { view: "doc", key: member.key, member, page: 0 });
  if (member.source === "web") return openWeb(member);
  if (member.source === "archive") return openArchiveMember(member);
  if (busy()) return;
  if (member.source === "local") {
    const bytes = await window.notecompleteFiles?.readRecent(member.path);
    if (!bytes) throw Error(`${member.name} is no longer in its folder.`);
    const file = new File([bytes], member.name);
    if (await openMediaFile(file, { path: member.path })) return;
    if (await openArchiveFile(file, { path: member.path })) return;
    if (!canReplace()) return;
    await load(file);
    return openedLocal(member.path, member.name, file);
  }
  const entry = await library.store.get("entries", member.key).catch(() => null);
  const file = entry && await library.open(entry);
  if (!file) throw Error(`${member.name} is not kept on this device any more. Open it again from Drive.`);
  if (await openMediaFile(file)) return;
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
      if (!chosen.files.length) return status(`${chosen.name} has no notes, PDFs, HTML, text, media or images.`, true);
      const firstDoc = chosen.files.find((f) => !isMp3Name(f.name) && !isMp4Name(f.name)) || chosen.files[0];
      await openMember(localMember(firstDoc.path, firstDoc.name));
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
function currentStop() {
  if (home?.visible) return { view: "home", folderId: home.folder?.id || null };
  if (doc || sideView()) return { view: "doc", key: docMember?.key || noteEntryKey || find.fingerprint || sideFp || "open", member: docMember, page: doc ? page : 0, scrollTop: doc ? $("viewport").scrollTop : 0 };
  return { view: "home", folderId: home?.folder?.id || null };
}
function showDocument() {
  if (home?.visible && (doc || sideView()))
    navHistory.record(currentStop(), { view: "doc", key: docMember?.key || noteEntryKey || find.fingerprint || sideFp || "open", member: docMember, page: doc ? page : 0 });
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
    if ($("officeView")) $("officeView").hidden = true;
    $("editor").hidden = false;
    if (panels[page]) resize();
  }
}
function showHome() {
  if (!home?.visible && (doc || sideView()))
    navHistory.record(currentStop(), { view: "home", folderId: home?.folder?.id || null });
  if (!$("editor").hidden && doc) $("editor").hidden = true;
  sideView()?.hide();
  home.show(Boolean(doc || sideView()));
}
$("homeButton").onclick = () => (home.visible && (doc || sideView()) ? showDocument() : showHome());
$("homeBack").onclick = () => (doc || sideView()) && showDocument();
let lastNavAt = 0;
function navigateHistory(direction, target = null) {
  const now = Date.now();
  if (now - lastNavAt < 60) return true;
  lastNavAt = now;
  if (direction < 0) {
    if ($("migrateDialog")?.open && !$("migrateBack")?.hidden) return $("migrateBack").click(), true;
    if ($("practiceDialog")?.open && !$("practiceBackToList")?.hidden) return $("practiceBackToList").click(), true;
  }
  if (document.querySelector("dialog[open]:not(.floating)")) return false;
  if (webView.visible) {
    if (direction < 0 && webView.back()) return true;
    if (direction > 0 && webView.forward()) return true;
  }
  if (home.visible) {
    if (target?.closest?.("#driveSection")) {
      if (direction < 0 && drive.back()) return true;
      if (direction > 0 && drive.forward()) return true;
    } else if (target?.closest?.("#dropboxSection")) {
      if (direction < 0 && dropbox.back()) return true;
      if (direction > 0 && dropbox.forward()) return true;
    } else if (target?.closest?.("#githubSection")) {
      if (direction < 0 && github.back()) return true;
      if (direction > 0 && github.forward()) return true;
    } else if (target?.closest?.("#webdavSection")) {
      if (direction < 0 && webdav.back()) return true;
      if (direction > 0 && webdav.forward()) return true;
    } else if (target?.closest?.("#archiveSection")) {
      if (direction < 0 && archive.back()) return true;
      if (direction > 0 && archive.forward()) return true;
    }
    if (direction < 0 && home.back()) return true;
    if (direction > 0 && home.forward()) return true;
    if (!$("cloudContent")?.hidden && !$("driveSection")?.hidden && (direction < 0 ? drive.back() : drive.forward())) return true;
    if (!$("cloudContent")?.hidden && !$("dropboxSection")?.hidden && (direction < 0 ? dropbox.back() : dropbox.forward())) return true;
    if (!$("cloudContent")?.hidden && !$("githubSection")?.hidden && (direction < 0 ? github.back() : github.forward())) return true;
    if (!$("cloudContent")?.hidden && !$("webdavSection")?.hidden && (direction < 0 ? webdav.back() : webdav.forward())) return true;
    if (!$("cloudContent")?.hidden && !$("archiveSection")?.hidden && (direction < 0 ? archive.back() : archive.forward())) return true;
  }
  const stop = direction < 0 ? navHistory.back(currentStop()) : navHistory.forward(currentStop());
  if (stop) {
    navHistory.navigating = true;
    try {
      if (stop.view === "home") {
        showHome();
      } else if (stop.view === "doc") {
        const activeKey = docMember?.key || noteEntryKey || find.fingerprint || sideFp || "open";
        if (stop.member && stop.key && stop.key !== activeKey && (!doc && !sideView() || stop.member.key !== docMember?.key)) {
          openMember(stop.member).then(() => {
            if (doc && Number.isInteger(stop.page)) jump(stop.page);
          }).catch((e) => status(e.message, true));
        } else if (doc || sideView()) {
          showDocument();
          if (doc && Number.isInteger(stop.page) && stop.page !== page) jump(stop.page);
          if (doc && Number.isFinite(stop.scrollTop)) $("viewport").scrollTop = stop.scrollTop;
        }
      }
    } finally {
      navHistory.navigating = false;
    }
    return true;
  }
  if (direction < 0 && !home.visible && (doc || sideView())) return showHome(), true;
  if (direction > 0 && home.visible && (doc || sideView())) return showDocument(), true;
  return false;
}
for (const type of ["mousedown", "mouseup", "auxclick"]) {
  window.addEventListener(type, (e) => {
    const dir = mouseNavDirection(e);
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    if (type === "mouseup") navigateHistory(dir, e.target);
  }, true);
}
$("driveOpen").onclick = () => {
  if ($("exportDialog")?.open) $("exportDialog").close();
  showHome();
  home.showCloudProvider?.("drive");
  $("driveSection").scrollIntoView({ behavior: "smooth", block: "start" });
};
if ($("dropboxOpen")) $("dropboxOpen").onclick = () => {
  if ($("exportDialog")?.open) $("exportDialog").close();
  showHome();
  home.showCloudProvider?.("dropbox");
  $("dropboxSection").scrollIntoView({ behavior: "smooth", block: "start" });
};
if ($("githubOpen")) $("githubOpen").onclick = () => {
  if ($("exportDialog")?.open) $("exportDialog").close();
  showHome();
  home.showCloudProvider?.("github");
  $("githubSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
};
if ($("webdavOpen")) $("webdavOpen").onclick = () => {
  if ($("exportDialog")?.open) $("exportDialog").close();
  showHome();
  home.showCloudProvider?.("webdav");
  $("webdavSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
};
function documentControls() {
  const open = !!doc;
  $("findOpen").disabled = !open && !textView.hasDocument;
  if ($("textIntoNote")) $("textIntoNote").hidden = !(textView.hasDocument && textView.diagram);
  if ($("textOpenRStudio")) $("textOpenRStudio").hidden = !(textView.hasDocument && isRScriptName(docMember?.name || textView.key || textView.name));
  officeButton();
  for (const id of ["save", "native", "nativeMarkdown", "exportProject", "shareNoteQr", "exportPdf", "exportImage", "importImage", "gotoPage", "ocrOpen", "insertBlank", "insertPdf", "insertHandwritten", "resizePage", "resizeDrag", "changePageBg", "pagesChangeBg", "tapeReveal", "tapeCover", "tapeNote"])
    if ($(id)) $(id).disabled = !open;
  // Noteful has no infinite page: a canvas exports to .nfedit only.
  for (const id of ["native", "nativeMarkdown"]) {
    $(id).dataset.title ??= $(id).title;
    $(id).disabled ||= !!doc?.canvas;
    $(id).title = doc?.canvas ? "An infinite canvas cannot be a .noteful file; export it as NoteComplete (.nfedit)" : $(id).dataset.title;
  }
  // A canvas is one page that grows: no inserted pages.
  for (const id of ["insertBlank", "insertPdf", "insertHandwritten", "studyExpandAi", "changePageBg", "pagesChangeBg"]) if ($(id)) $(id).disabled ||= !!doc?.canvas;
  // Study works on notes and on text documents.
  for (const id of ["studyCards", "studyQuiz", "studyCheck", "studyResume", "studyRetake", "studyExportQuiz", "exportStudy", "chatOpen", "chatToggle"])
    if ($(id)) $(id).disabled = !open && !studyText();
  const canViewHtml = open && !!doc?.has_exam;
  if ($("viewExamHtml")) {
    $("viewExamHtml").hidden = !canViewHtml;
    $("viewExamHtml").disabled = !canViewHtml;
  }
  if ($("navExamHtml")) {
    $("navExamHtml").hidden = !canViewHtml;
    $("navExamHtml").disabled = !canViewHtml;
  }
  if ($("studyExpandAi")) $("studyExpandAi").disabled = !open || !!doc?.canvas;
  if ($("studyOpenDeck")) $("studyOpenDeck").disabled = false;
  if (!open) $("svg").disabled = true;
  syncPageMoveMenus();
}
// Menu items that mirror toolbar controls share their handler and state.
const proxies = [...document.querySelectorAll("#commandBar [data-proxy], #commandBar [data-proxy-tool]")];
function proxyTarget(item) {
  return item.dataset.proxy
    ? $(item.dataset.proxy)
    : document.querySelector(`button[data-tool="${item.dataset.proxyTool}"]`);
}
function syncMenus() {
  syncPageMoveMenus();
  for (const item of proxies) {
    const target = proxyTarget(item);
    const inEditor = target?.closest("#editor");
    item.disabled = !target || target.disabled || target.hidden || (!!inEditor && (!doc || $("editor").hidden));
    if (item.dataset.proxyTool) item.setAttribute("aria-checked", String(target?.getAttribute("aria-pressed") === "true"));
  }
}
for (const item of proxies) item.onclick = () => proxyTarget(item)?.click();
$("exportOpen").addEventListener("click", () => syncMenus());
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
  // 中 when the region holds Chinese (text layer, text boxes or recognized text).
  $("grabZh").hidden = true;
  const asked = grabbed;
  find.wordsIn(p.index, rect).then((text) => { if (grabbed === asked && hasHan(text)) { $("grabZh").hidden = false; grabbed.text = text; } }).catch(() => {});
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
  projectModelController?.invalidate?.();
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
// The items in the region to the front or the back, keeping their own order: one undo step.
for (const [id, to] of [["grabFront", "front"], ["grabBack", "back"]]) $(id).onclick = async () => {
  if (!grabbed) return;
  const { page, rect } = grabbed;
  clearGrab();
  const ids = (await findItemsInGrab(panels[page], rect)).map((m) => m.id);
  if (!ids.length) return status("Nothing that can be moved there.", true);
  await action("restack", { page, ids, to });
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
// The Chinese in the region: its own bar (translate, look up, stroke order, listen).
$("grabZh").onclick = () => {
  if (!grabbed?.text) return;
  const text = grabbed.text.replace(/\s+/g, hasHan(grabbed.text) ? "" : " ").trim();
  const r = $("grabMenu").getBoundingClientRect();
  clearGrab();
  showZhBar(text, r);
};
$("grabKeep").onclick = async () => {
  if (!grabbed) return;
  try {
    exerciseRefs.push({ name: `Snippet, page ${grabbed.page + 1}`, src: await grabImage(), kind: "image" });
    syncKeptRefsUi();
    status(`Kept for exercises (${exerciseRefs.length}) — open from ★ Kept in the top bar or Study → Kept for exercises…`);
    clearGrab();
  } catch (e) { status(e.message, true); }
};
let tapeAllLifted = false;
$("tapeReveal").onclick = () => { tapeAllLifted = true; setTapeMode("revealed"); };
$("tapeCover").onclick = () => { tapeAllLifted = false; setTapeMode("covered"); };
$("tapeNote").onclick = () => setTapeMode("note");
$("findOpen").onclick = () => { showDocument(); if (!doc && textView.hasDocument) textFinder.open(); else find.open(); };
$("findToggle").onclick = () => { if (!doc) return; showDocument(); if ($("findBar").hidden) find.open(); else find.close(); };
$("textFindToggle").onclick = () => { if (!textView.hasDocument) return; if ($("textFindBar").hidden) textFinder.open(); else textFinder.close(); };
$("movePageUp").onclick = () => movePage(page, page - 1);
$("movePageDown").onclick = () => movePage(page, page + 1);
$("ocrOpen").onclick = () => find.openOcr(page);
// Inserted pages (or undoing them) change the page list: rebuild it and stay on `focus`.
function restructure(result, focus, message) {
  observer?.disconnect();
  keepObserver?.disconnect();
  renderQueue.clear();
  unmountDue.clear();
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
// Pages → Insert and Pages → Change PDF background (page-dialogs.js).
const { openPageBackground } = pageDialogs({
  $,
  action,
  busy,
  call,
  status,
  app: {
    get backgrounds() { return backgrounds; },
    get doc() { return doc; },
    get page() { return page; },
    get panels() { return panels; },
  },
});
// Model Explorer & cross-diagram project model (project-model.js, model-explorer.js).
let projectModelPrefabs = [];
let projectModelCache = buildProjectModel([]);
let projectModelRev = -1;
let projectModelRefreshTimer = 0;
let editPrefabByPartRef = null;
let replacePrefabSpecRef = null;
async function scanNotePrefabs() {
  if (!doc || !panels.length) return [];
  const pages = [];
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const v = p?.view || await call("view", { page: i }).catch(() => null);
    if (v?.parts?.length) pages.push({ pageIndex: i, parts: v.parts });
  }
  return extractPrefabsFromPages(pages);
}
async function refreshProjectModel(force = false) {
  const panel = $("modelExplorerPanel");
  if (!doc) {
    projectModelPrefabs = [];
    projectModelCache = buildProjectModel([]);
    projectModelRev = -1;
    modelExplorer?.update(projectModelCache);
    return projectModelCache;
  }
  if (!force && projectModelRev === revision) return projectModelCache;
  const rev = revision, token = epoch;
  const prefabs = await scanNotePrefabs();
  if (token !== epoch) return projectModelCache;
  projectModelPrefabs = prefabs;
  projectModelCache = buildProjectModel(prefabs);
  projectModelRev = rev;
  if (panel && !panel.hidden) modelExplorer?.update(projectModelCache);
  return projectModelCache;
}
function setModelExplorerOpen(open) {
  const panel = $("modelExplorerPanel");
  const toggle = $("modelExplorerToggle");
  if (!panel) return;
  panel.hidden = !open;
  if (toggle) toggle.setAttribute("aria-checked", String(open));
  if (open) refreshProjectModel(true);
}
async function jumpToProjectOccurrence(occ) {
  if (!occ || !doc) return;
  if (Number.isInteger(occ.pageIndex) && occ.pageIndex >= 0 && occ.pageIndex < panels.length) {
    jump(occ.pageIndex);
  }
  if (occ.partId && editPrefabByPartRef) {
    await editPrefabByPartRef(occ.pageIndex, occ.partId, { focusElementId: occ.elementId || null });
  }
}
async function applyProjectRename(modelId, newName, { excludePartId = null, onlyDiagramKey = null } = {}) {
  await refreshProjectModel();
  const plan = planRename(projectModelPrefabs, projectModelCache, modelId, newName, { onlyDiagramKey });
  const updates = excludePartId ? plan.updates.filter((u) => u.partId !== excludePartId) : plan.updates;
  if (!updates.length || !replacePrefabSpecRef) return 0;
  let count = 0;
  for (const u of updates) {
    const ok = await replacePrefabSpecRef(u.pageIndex, u.partId, u.afterSpec);
    if (ok) count++;
  }
  await refreshProjectModel(true);
  if (count > 0) {
    const total = excludePartId ? count + 1 : count;
    status(`Renamed “${plan.oldName}” to “${plan.newName}” in ${total} ${total === 1 ? "diagram" : "diagrams"}.`);
  }
  return count;
}
const modelExplorer = $("modelExplorerPanel") ? createModelExplorer($("modelExplorerPanel"), {
  onJump: (occ) => jumpToProjectOccurrence(occ),
  onRename: (el, nextName) => applyProjectRename(el.modelId, nextName),
  onRefresh: () => refreshProjectModel(true),
  onClose: () => setModelExplorerOpen(false),
}) : null;
if ($("modelExplorerToggle")) {
  $("modelExplorerToggle").onclick = () => {
    closeMenus();
    if (!doc) return status("Open a note first to inspect its Model Explorer.");
    setModelExplorerOpen($("modelExplorerPanel").hidden);
  };
}
const projectModelController = {
  getModel: () => projectModelCache,
  getPrefabs: () => projectModelPrefabs,
  ensureLoaded: () => refreshProjectModel(),
  refresh: () => {
    projectModelRev = -1;
    clearTimeout(projectModelRefreshTimer);
    if ($("modelExplorerPanel") && !$("modelExplorerPanel").hidden) {
      projectModelRefreshTimer = setTimeout(() => refreshProjectModel(true), 120);
    }
  },
  invalidate: () => {
    projectModelRev = -1;
    clearTimeout(projectModelRefreshTimer);
    if ($("modelExplorerPanel") && !$("modelExplorerPanel").hidden) {
      projectModelRefreshTimer = setTimeout(() => refreshProjectModel(true), 180);
    }
  },
  reset: () => {
    clearTimeout(projectModelRefreshTimer);
    projectModelPrefabs = [];
    projectModelCache = buildProjectModel([]);
    projectModelRev = -1;
    modelExplorer?.update(projectModelCache);
  },
  jumpTo: (occ) => jumpToProjectOccurrence(occ),
  applyRename: (modelId, newName, opts) => applyProjectRename(modelId, newName, opts),
};
// Graphs, tables, prefabs, UML and the figure editors on the page (figures.js).
const { editCompound, editPrefabByPart, exerciseRefs, figureEditor, figureIsOpen, importDiagramSpec, insertCompound, insertPrefab, insertUml, pickWhole, placePrefab, redrawResized, replacePrefabSpec, svgToPngFile, syncKeptRefsUi } = figureInserts({
  $,
  TOOL_DEFAULTS,
  action,
  call,
  canReplace,
  closeMenus,
  drawPlantuml,
  ensureEditableLayer,
  importImages,
  library,
  openBlankNoteForPrefab,
  pageCanvas,
  projectModel: projectModelController,
  selection,
  status,
  textBox,
  app: {
    get activeLayer() { return activeLayer; },
    get doc() { return doc; },
    get editing() { return editing; },
    get epoch() { return epoch; },
    get page() { return page; },
    get panels() { return panels; },
    get statusTimer() { return statusTimer; },
    get toolPrefs() { return toolPrefs; },
  },
});
editPrefabByPartRef = editPrefabByPart;
replacePrefabSpecRef = replacePrefabSpec;
// The menu at the pointer (context-menu.js): right-click on a page, a finger held still, or a
// selection's ⋯ circle. What is under it can be edited without changing tools first.
const ITEM_NAMES = { ink: "Ink", shape: "Shape", image: "Image", text: "Text box", group: "Group" };
function compoundLabel(c) {
  if (c.kind === "prefab") { try { return prefabName(JSON.parse(c.spec || "{}")); } catch { return "Prefab"; } }
  return c.kind === "graph" ? "Graph" : "Table";
}
// Double-clicking a prefab, graph or table edits it; double-clicking a typed text box (with
// Select or Pan) types into it, where it is now, and finishing it goes back to the tool it came from.
let lastPress = null;
async function editTextAt(p, event) {
  if (!["select", "pan", "pdfedit", "shape", "text"].includes(tool) || !doc || editing || !p.view) return;
  const at = point(event, p);
  if (selection.item?.compound && selection.item.page === p.index) {
    const [bx, by, bw, bh] = selection.item.bounds || [0, 0, 0, 0];
    if (at[0] >= bx - 8 && at[0] <= bx + bw + 8 && at[1] >= by - 8 && at[1] <= by + bh + 8) {
      return editCompound(selection.item);
    }
  }
  const item = await pickWhole({ page: p.index, x: at[0], y: at[1], tolerance: 8 * p.size[0] / p.el.getBoundingClientRect().width }).catch(() => null);
  if (item?.compound) return editCompound(item);
  if (item?.kind === "text" && ["select", "pan", "pdfedit"].includes(tool)) editTextItem(item, at);
}
function editTextItem(item, at = null) {
  const p = panels[item.page], existing = (p?.view?.texts || []).find((t) => t.id === item.id);
  if (!existing) return status("This text box cannot be edited here.", true);
  const back = tool;
  document.querySelector('#toolbar [data-tool="text"]').click();
  // The box where the item is drawn now: its bounds are where it was typed, and a move
  // since is an adjustment on top.
  let box = existing.bounds;
  try { if (item.adjustment) box = mapPoint(itemMatrix(item), [item.bounds[0], item.bounds[1]]); } catch { /* As typed. */ }
  const here = { ...existing, bounds: [box[0], box[1], existing.bounds[2], existing.bounds[3]] };
  textBox.open(p, at || [box[0] + 2, box[1] + 2], here, {
    after: () => { if (back !== "text" && tool === "text") document.querySelector(`#toolbar [data-tool="${back}"]`)?.click(); },
  });
}
async function removeItem(item) {
  if (selection.item?.page === item.page && selection.item?.id === item.id) selection.clear();
  if (item.compound) await action("drawMany", { page: item.page, replace: item.compound.items, lines: [], images: [] });
  else if (item.kind === "group") for (const m of item.members) await action("remove", { page: item.page, itemId: m.id }).catch(() => {});
  else await action("remove", { page: item.page, itemId: item.id });
  status("Removed. Press Ctrl+Z to bring it back.");
}
// Bring to front, Send to back (a group or graph as a whole, keeping its own order), or one
// item one step past the next item it overlaps: one undo step, the page drawn again.
const RESTACKED = { front: "Brought to front.", back: "Sent to back.", forward: "Brought forward.", backward: "Sent backward." };
async function restackItem(item, to) {
  if (!item || !doc || busy()) return;
  const ids = item.compound ? item.compound.items : item.kind === "group" ? item.members.map((m) => m.id) : [item.id];
  if (ids.length > 1 && !(to === "front" || to === "back")) return status("A group moves to the front or the back; one item at a time moves a step.", true);
  const group = item.kind === "group" && selection.item?.id === item.id;
  await action("restack", { page: item.page, ids, to });
  // A group is not an item the engine knows: it stays selected as it was.
  if (group) selection.show(item);
}
// Ctrl ] / Ctrl [ one step forward or backward, with Shift to the front or the back, for what
// is selected (by key code: Shift turns the keys into braces).
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || !["BracketRight", "BracketLeft"].includes(e.code)) return;
  if (!selection.item || !doc || typingIn(e.target) || editing) return;
  e.preventDefault();
  const up = e.code === "BracketRight";
  restackItem(selection.item, e.shiftKey ? (up ? "front" : "back") : (up ? "forward" : "backward"));
});
// The pointer's last place over a page (set by the pointer handlers; paste puts things there).
let pagePointer = null;
// Copy, cut and paste of items (item-clipboard.js).
const { copyItem, currentClip, moveToPage, pasteClip, pasteFromPicture, pasteUmlIntoPage, pictureClip, typingIn } = itemClipboard({
  $,
  action,
  call,
  drawPlantuml,
  ensureEditableLayer,
  importImages,
  itemPicture: (...a) => itemPicture(...a),
  placePrefab,
  point,
  removeItem,
  renderPage,
  selection,
  status,
  textBox,
  app: {
    get activeLayer() { return activeLayer; },
    get doc() { return doc; },
    get editing() { return editing; },
    get middleMouseAt() { return middleMouseAt; },
    get page() { return page; },
    get pagePointer() { return pagePointer; },
    get panels() { return panels; },
  },
});
// The item and page menus at the pointer, and pictures of items (item-menus.js).
const { itemMenu, itemPicture, longPress, pageMenu } = itemMenus({
  $,
  ITEM_NAMES,
  SHAPE_NAMES,
  SWATCHES,
  WIDTH_LADDER,
  action,
  blankPageEntries,
  busy,
  call,
  cancelGesture,
  compoundLabel,
  copyItem,
  currentClip,
  editCompound,
  editTextItem,
  insertCompound,
  insertPrefab,
  insertShapeAt,
  insertUml,
  pageCanvas,
  palettes,
  pasteClip,
  pasteUmlIntoPage,
  patchItem,
  pickColor,
  pickWhole,
  point,
  quick,
  removeItem,
  restackItem,
  selection,
  setTapeMode,
  status,
  tapeOpen,
  textBox,
  toggleTape,
  app: {
    get doc() { return doc; },
    get editing() { return editing; },
    get gesture() { return gesture; },
    get panels() { return panels; },
    get tapeMode() { return tapeMode; },
    get widthPresets() { return widthPresetsNow(); },
  },
});
// Page pixels for OCR: the PDF at about 2200 px wide under the ink and images.
// `inkOnly` keeps just the handwriting, in black on white: no PDF, images,
// typed text or highlighter, so recognition sees the ink alone (null when there is none).
async function pageCanvas(index, width = 2200, { liftTape = false, inkOnly = false, bold = false, exporting = false } = {}, source = null) {
  const view = source ? await source.view(index) : await call("view", { page: index });
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
    const href = await (source ? source.backgrounds : backgrounds).image(view.pdf_background, view.size, (width * place.share) / 2);
    svg.querySelector("[data-background]").append(pdfImage(href, place));
  }
  const height = Math.round(h * scale);
  // Chinese: pinyin over it in exports when chosen, and the font, which a picture cannot fetch.
  if (exporting && rubyForExport()) await rubySvg(svg, { force: true }).catch(() => {});
  const fonts = await embedChineseFont(svg);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    let image = new Image();
    await imageReady(image, url);
    // An SVG picture is ready before the fonts inside it the first time (Chromium): its text
    // would be missing. Drawn once to start them, then loaded again once they are there.
    if (fonts) {
      document.createElement("canvas").getContext("2d").drawImage(image, 0, 0, 1, 1);
      await new Promise((r) => setTimeout(r, 150));
      image = new Image();
      await imageReady(image, url);
    }
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
// Scratchpad: AI conversations kept per note (View → Scratchpad…).
const scratch = scratchpad({
  store: library.store,
  key: () => (doc ? `scratch:${find.fingerprint || doc.title || "note"}` : studyText() && sideFp ? `scratch:${sideFp}` : ""),
  canNote: () => !!doc || htmlView.hasDocument,
  markdown: (text) => call("markdownHtml", { text }),
  status,
  notes: async (text) => (await notesApi()).append(text),
});
if ($("scratchOpen")) $("scratchOpen").onclick = () => { for (const m of document.querySelectorAll("details.menu")) m.open = false; scratch.open(); };
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
async function reloadNoteFromDisk(targetPath) {
  if (!targetPath || !window.notecompleteFiles?.readLocalNote) return;
  if (targetPath !== notePath && targetPath !== docMember?.path) return;
  const opened = await window.notecompleteFiles.readLocalNote(targetPath).catch(() => null);
  if (!opened) return;
  const diskFile = new File([opened.bytes], opened.name);
  if (dirty || busy()) {
    try {
      const { bytes: localBytes } = await exportNoteBytes(opened.name.endsWith(".nfedit") ? "project" : "noteful");
      if (localBytes) {
        const localFile = new File([localBytes], opened.name);
        const choice = await versions.compareFiles({
          title: opened.name,
          leftLabel: "Your copy (current work)",
          rightLabel: "Updated on disk (AI)",
          localFile,
          remoteFile: diskFile,
          remoteName: "AI update",
        });
        if (choice === "both") {
          await library.add(diskFile).catch(() => null);
          home?.renderRecent?.();
          status("Kept your copy open and saved the AI update to Recent.");
          return;
        }
        if (choice !== "drive") return;
      } else {
        status("Note updated on disk by AI. Reopen it to see changes.", true);
        return;
      }
    } catch {
      status("Note updated on disk by AI. Reopen it to see changes.", true);
      return;
    }
  }
  const keepPage = page;
  await load(diskFile);
  if (docMember?.source === "local") {
    await openedLocal(opened.path, opened.name, diskFile);
  } else {
    notePath = opened.path;
    const entry = await library.rememberLocal(opened.path, opened.name, diskFile.size);
    noteEntryKey = entry.key;
    home.rememberFacts(entry.key, diskFile);
    void home.rememberCover(entry.key, diskFile);
  }
  if (doc && keepPage > 0) jump(Math.min(doc.pages - 1, keepPage));
  home?.renderRecent?.();
  status("Note updated with AI changes.");
}
const chat = chatController({ ...studyDeps, selection, selectedText: () => textSource.selected(), providers: () => ai.providers(), markdown: (text) => call("markdownHtml", { text }), toTextBox: (text) => textBox.answerToTextBox(text), onNoteChanged: reloadNoteFromDisk });
audio.transcript.jobs = jobs;
audio.transcript.ai = ai;
// The scissors in the audio panel: only the text of a chosen segment (audio-trim.js).
audioTrim({ audio, status, toNotes: async (text) => (await notesApi()).append(text), toTextBox: (text) => textBox.answerToTextBox(text) });
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
// The stroke order editor for `target`, put on the page (or in the Markdown being edited/viewed).
async function openTracePrefab(target) {
  const inTextDoc = textView.visible && !textView.diagram;
  const chosen = await figureEditor({ type: "hanzi", text: target || "你好", show: "steps", grid: "mi", outline: true }, { editing: false });
  if (!chosen) return;
  if (inTextDoc && textView.insertTraceSpec) {
    await textView.insertTraceSpec(chosen);
    status(`${prefabName(chosen)} inserted into Markdown.`);
    return;
  }
  let p = panels[page];
  if (!doc) p = await openBlankNoteForPrefab(prefabName(chosen) || "Stroke order");
  if (!p || !ensureEditableLayer()) return;
  if (await placePrefab(p, chosen)) status(`${prefabName(chosen)} inserted. Double-click or right-click it to edit; one undo removes it.`);
}
// Chinese: the character panel, conversion and vocabulary cards (chinese/zh-menu.js).
configureZh({
  status,
  decks: () => study.decks(),
  addCards: (cards, opts) => study.addCards(cards, opts),
  openDeck: (d) => study.showDeck(d),
  boxText: (p, id) => { const t = (p?.view?.texts || []).find((x) => String(x.id) === String(id)); return t ? boxText(t) : ""; },
  editBox: (p, id, value) => textBox.replaceText(p, id, value),
  insertFigure: async (spec) => {
    let p = panels[page];
    if (!doc) p = await openBlankNoteForPrefab(spec?.text || spec?.char ? `Stroke order ${spec.text || spec.char}` : "Stroke order");
    if (!p || !ensureEditableLayer()) throw new Error("Open a note to insert the stroke order.");
    const { prepareWithDict } = await import("./prefabs/hanzi/render.js");
    const full = await prepareWithDict(spec);
    if (await placePrefab(p, full)) status(`${prefabName(full)} inserted. Double-click or right-click it to edit; one undo removes it.`);
  },
  openTracePrefab,
});
installZhContext();
// Chinese selected anywhere: Translate, Look up, Stroke order and Listen beside it (chinese/zh-select.js).
installZhSelection({ pageText: (sel) => selectedText(sel), openTracePrefab, status });
const openGeneratedFile = async (file, entry) => {
  if (entry) return openFromLibrary(file, entry);
  if (!canReplace()) return false;
  await load(file, { entry });
  return true;
};
const examMaker = examController({
  call,
  openPdf,
  library,
  groups,
  hasOpenDoc: () => !!doc || studyText(),
  openDocTitle: () => (studyText() ? (textView.name || "Document") : (doc?.title || "Note")),
  openDocPages: () => (studyText() ? textSource.count : (doc?.pages || 0)),
  openDocResource: currentDocResource,
  pageText: studyDeps.pageText,
  pageCanvas: studyDeps.pageCanvas,
  notesText: studyDeps.notesText,
  jobs,
  ai,
  status,
  download,
  openGeneratedFile,
  refreshHome: () => home?.renderRecent?.(),
});
const batchNotes = batchNotesController({
  call,
  openPdf,
  library,
  groups,
  hasOpenDoc: () => !!doc || studyText(),
  openDocTitle: () => (studyText() ? (textView.name || "Document") : (doc?.title || "Note")),
  openDocPages: () => (studyText() ? textSource.count : (doc?.pages || 0)),
  openDocResource: currentDocResource,
  pageText: studyDeps.pageText,
  pageCanvas: studyDeps.pageCanvas,
  notesText: studyDeps.notesText,
  jobs,
  ai,
  status,
  openGeneratedFile,
  refreshHome: () => home?.renderRecent?.(),
});
const expandMaker = expandController({
  call,
  openPdf,
  library,
  groups,
  hasOpenDoc: () => !!doc && !doc?.canvas,
  canInsertPdf: () => !!doc && !doc?.canvas,
  openDocTitle: () => doc?.title || $("title").textContent || "Note",
  openDocPages: () => doc?.pages || 0,
  currentPage: () => page,
  openDocResource: currentDocResource,
  openDocHasTape: () => panels.some((p) => (p.view?.tapes || []).length > 0),
  pageText: studyDeps.pageText,
  pageCanvas: studyDeps.pageCanvas,
  notesText: studyDeps.notesText,
  insertHandwrittenPages: async ({ at, markdown, options, focus }) => {
    await action("insertHandwritten", { at, markdown, options, focus });
  },
  insertPdfPagesWithTapes: async ({ at, pages, pdf, tapes }) => {
    // action() skips silently while the note is busy; Expand must not then report pages it never added.
    const before = doc?.pages || 0;
    console.info(`[NC] insertPages at ${at}: ${pages.length} page(s) into "${doc?.title || "?"}" (${before} pages, editing=${editing}, pending=${mutationPending}, dirty=${dirty})`);
    await action("insertPages", { at, pages, pdf, focus: at });
    console.info(`[NC] insertPages done: ${doc?.pages || 0} pages now`);
    if (!doc || (doc.pages || 0) < before + pages.length) throw Error("The new exam pages could not be inserted (the note was busy or closed). Nothing was added; try again.");
    const byPage = new Map();
    for (const t of tapes || []) {
      const targetPage = at + t.page;
      if (!byPage.has(targetPage)) byPage.set(targetPage, []);
      byPage.get(targetPage).push({
        points: [[t.x, t.y + t.h / 2], [t.x + t.w, t.y + t.h / 2]],
        width: t.h,
        rgba: t.rgba,
        tool: 2,
        layer: activeLayer,
      });
    }
    for (const [targetPage, pageLines] of byPage) {
      await action("drawMany", { page: targetPage, lines: pageLines });
    }
  },
  // The merged exam lives in the note: mark it unsaved so it is written, and refresh an open HTML exam view.
  markEmbeddedExamUpdated: async () => {
    if (!doc) return;
    doc.has_exam = true;
    dirty = changed = true;
    savedState();
    tabBar.update({ title: doc.title || $("title").textContent, dirty: true });
    if (embeddedExam?.active) await openEmbeddedExamHtml();
    documentControls();
  },
  jobs,
  ai,
  status,
});
if ($("viewExamHtml")) $("viewExamHtml").onclick = () => { closeMenus(); openEmbeddedExamHtml(); };
if ($("navExamHtml")) $("navExamHtml").onclick = () => openEmbeddedExamHtml();
// Help → Keep a diagnostic log / Open the log (desktop app only; apps/desktop/app-log.js).
if (window.notecompleteLog && $("logItems")) {
  $("logItems").hidden = false;
  const showLog = (s) => $("logToggle").setAttribute("aria-checked", String(!!s?.on));
  window.notecompleteLog.get().then(showLog).catch(() => {});
  $("logToggle").onclick = async () => {
    const s = await window.notecompleteLog.set($("logToggle").getAttribute("aria-checked") !== "true").catch((e) => { status(e.message, true); return null; });
    if (!s) return;
    showLog(s);
    status(s.on ? `Diagnostic log on: ${s.file}` : "Diagnostic log off.");
  };
  $("logOpen").onclick = async () => {
    closeMenus();
    const had = await window.notecompleteLog.open().catch((e) => { status(e.message, true); return true; });
    if (!had) status("Nothing logged yet. Turn on Help → Keep a diagnostic log first.");
  };
}
$("takeNotesAi").onclick = () => { closeMenus(); batchNotes.open({ preselectOpen: !!doc || studyText() }); };
$("studyCreateExam").onclick = () => { closeMenus(); examMaker.open({ preselectOpen: !!doc || studyText(), mode: "create" }); };
$("studySolveExam").onclick = () => { closeMenus(); examMaker.open({ preselectOpen: !!doc || studyText(), mode: "solve" }); };
if ($("studyExpandAi")) $("studyExpandAi").onclick = () => { closeMenus(); expandMaker.open({ mode: panels.some((p) => (p.view?.tapes || []).length > 0) ? "exam" : undefined }); };
// The quiz and the flashcard practice are floating windows too.
quizWindow = floatingWindow($("quizPanel"), { screen: screenArea, key: "notecomplete-quiz-window", head: $("quizPanel").querySelector(".quiz-panel-head"), close: $("quizPanelClose"), label: "Quiz", compact: { cls: "minimized", button: $("quizMinimize") }, minWidth: 300, minHeight: 200 });
// Scratchpad, saved resources, shortcuts and pen hover settings stay open beside the note.
for (const [id, x, key, label, w, h] of [["scratchDialog", "scratchX", "scratch", "Scratchpad", 380, 240], ["allQuizzesDialog", "allQuizzesX", "saved", "Saved resources", 520, 320], ["shortcutsDialog", "shortcutsX", "shortcuts", "Shortcuts", 320, 220], ["hoverToolsDialog", "hoverToolsX", "hover-tools", "Pen hover", 340, 220], ["zipWindow", "zipX", "zip", "Archive", 420, 260]]) {
  const dlg = $(id);
  $(x).onclick = () => dlg.close();
  floatingWindow(dlg, { screen: screenArea, key: `notecomplete-${key}-window`, head: dlg.querySelector(".float-head"), close: $(x), label, compact: { cls: "minimized" }, minWidth: w, minHeight: h, scroll: true });
}
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
$("quizQr").onclick = () => study.qrQuiz(quizzes.current);
$("quizAnki").onclick = () => study.exportQuiz(quizzes.current);
$("exportStudy").onclick = () => { for (const m of document.querySelectorAll("details.menu")) m.open = false; study.exportAll(); };
function currentDocResource() {
  if (doc && !$("editor").hidden) {
    return {
      entryKey: noteEntryKey || "",
      fingerprint: find.fingerprint || "",
      title: doc.title || "",
      name: docMember?.name || doc.title || "",
    };
  }
  if (studyText() && textView.visible) {
    return {
      entryKey: noteEntryKey || "",
      fingerprint: sideFp || "",
      title: textView.name || "",
      name: textView.name || "",
    };
  }
  return null;
}
// Study -> Saved resources...: unified hub for quizzes, flashcard decks, exams, and AI scratchpad conversations.
const quizIndex = allQuizzes({
  library, status,
  // The note on screen (not one left loaded behind Home).
  currentFingerprint: () => (doc && !$("editor").hidden ? find.fingerprint : studyText() && textView.visible ? sideFp : ""),
  currentResource: currentDocResource,
  openEntry: async (key) => {
    const entry = await library.store.get("entries", key).catch(() => null);
    const file = entry && await library.open(entry).catch(() => null);
    if (!file) { status("That note is no longer kept on this device. Open it again from Drive or your files.", true); return false; }
    return openFromLibrary(file, entry);
  },
  openExam: async (exam) => {
    if (!exam?.entryKey) return false;
    const entry = await library.store.get("entries", exam.entryKey).catch(() => null);
    const file = entry && await library.open(entry).catch(() => null);
    if (!file) { status("That exam is no longer kept on this device.", true); return false; }
    return openFromLibrary(file, entry);
  },
  openItem: async (kind, id, fp = "") => {
    const targetFp = fp || quizIndexFp();
    if (fp && fp === quizIndexFp()) showDocument();
    if (kind === "decks") return study.openDeck(id, fp);
    const list = (await library.store.get("settings", `quizzes:${targetFp}`).catch(() => null)) || [];
    const quiz = list.find((q) => q.id === id);
    if (!quiz) return status("That quiz is no longer saved on this device.", true);
    quizzes.open(quiz, fp ? `quizzes:${fp}` : null);
  },
  exportItem: (kind, item) => (kind === "decks" ? study.exportDeck(item) : study.exportQuiz(item)),
  qrItem: (kind, item) => (kind === "decks" ? study.qrDeck(item) : study.qrQuiz(item)),
  importStudy: () => { $("studyPackFile").click(); },
  appendNotes: async (markdown) => (await notesApi()).append(markdown),
  canNote: () => !!doc || htmlView.hasDocument,
  markdown: (text) => call("markdownHtml", { text }),
  onOpenScratchChat: (entry) => {
    if (doc || studyText()) showDocument();
    return chat.openThread({ id: entry.id, title: entry.title, messages: entry.messages, text: entry.text, big: true });
  },
});
// The desktop app's updater, or the Android app's (it says its version: App.js).
updateNotice({ status, bridge: globalThis.notecompleteUpdates || (globalThis.notecompleteApp?.platform === "android" ? androidUpdates({ app: globalThis.notecompleteApp }) : undefined) });
// Mic buttons in the Ask AI fields: speak the question, edit it, send it.
const dictate = dictation({ status });
dictate.attach($("chatInput"), $("chatSend"));
dictate.attach($("practiceAskInput"), $("practiceAskForm").querySelector('button[type="submit"]'));
{ const box = $("quizExplainBox").querySelector(".practice-ask-form"); if (box) dictate.attach(box.querySelector("input"), box.querySelector('button[type="submit"]')); }
if ($("studyAllQuizzes")) $("studyAllQuizzes").onclick = () => { closeMenus(); quizIndex.open(); };
// Help > Connect AI tools (desktop): the bundled note server for the user's own agents,
// offered once by itself a few seconds after start.
const agents = agentConnector({ status });
if (agents) {
  $("agentsOpen").hidden = false;
  $("agentsOpen").onclick = () => { closeMenus(); agents.open(); };
  setTimeout(() => { if (!document.querySelector("dialog[open]")) agents.offer().catch(() => { /* Optional. */ }); }, 4000);
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
// View → Pen button… and the pen test (pen-setup.js).
penSetup({
  $,
  closeMenus,
  fields,
  status,
  app: {
    get penProfile() { return penProfile; }, set penProfile(v) { penProfile = v; },
  },
});
$("studyCards").onclick = () => study.cards();
$("studyQuiz").onclick = () => study.quiz();
$("studyCheck").onclick = () => study.check();
$("studyOpenDeck").onclick = () => { closeMenus(); quizIndex.open(); };
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
    const q = query.trim().toLowerCase();
    if (!q || "find & combine duplicates".includes(q) || "dedupe".includes(q)) {
      items.push({ id: "find-duplicates", title: "Home: Find & combine duplicates…", group: "General", run: () => home.findDuplicates() });
    }
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
// Interface size (desktop zoom IPC + browser zoom fallback so Ctrl+Shift+-/0/+ works everywhere).
let webUiZoom = 1;
try {
  const savedUiZoom = Number(localStorage.getItem("notecomplete-ui-zoom"));
  if (Number.isFinite(savedUiZoom) && savedUiZoom >= 0.7 && savedUiZoom <= 1.6) webUiZoom = savedUiZoom;
} catch { /* Optional. */ }
function syncWebUiZoom(z) {
  document.documentElement.style.zoom = z === 1 ? "" : String(z);
  if (z === 1) document.documentElement.style.removeProperty("--ui-zoom");
  else document.documentElement.style.setProperty("--ui-zoom", String(z));
  syncBarWidth();
}
// The bar's width steps with the web's interface size (style.css bar-le-*): media queries see
// the window, but a zoomed page has the window's width over the zoom to lay the bar out in.
// The desktop's interface size is the browser's own zoom, which media queries already follow.
function syncBarWidth() {
  const root = document.documentElement, z = uiZoom(), zoomed = z !== 1, room = innerWidth / z;
  root.classList.toggle("ui-zoomed", zoomed);
  for (const step of [1080, 960, 920]) root.classList.toggle(`bar-le-${step}`, zoomed && room <= step);
}
addEventListener("resize", syncBarWidth);
if (!windows?.zoom && webUiZoom !== 1) syncWebUiZoom(webUiZoom);
function applyUiSize(step) {
  if (windows?.zoom) {
    windows.zoom(step).then((z) => status(`Interface size ${Math.round(z * 100)}%`)).catch((e) => status(e.message, true));
    return;
  }
  webUiZoom = step === 0 ? 1 : Math.round(Math.min(1.6, Math.max(0.7, webUiZoom + step * 0.1)) * 100) / 100;
  syncWebUiZoom(webUiZoom);
  try { localStorage.setItem("notecomplete-ui-zoom", String(webUiZoom)); } catch { /* Optional. */ }
  status(`Interface size ${Math.round(webUiZoom * 100)}%`);
}
$("uiSizeItems").hidden = false;
$("uiSmaller").onclick = () => applyUiSize(-1);
$("uiLarger").onclick = () => applyUiSize(1);
$("uiReset").onclick = () => applyUiSize(0);

// Help ▸ Setup wizard… (setup-wizard.js): each choice goes through the setter the menus use.
// A switch kept by a menu item is turned by that item, so its status and side effects stay one.
{
  const checked = (id) => $(id)?.getAttribute("aria-checked") === "true";
  const flip = (id, on) => { if (checked(id) !== on) $(id).click(); };
  const wizard = setupWizard({
    status,
    ai: setupAI(),
    mobile: isPhoneOrTablet({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches }),
    openExternal: (url) => window.open(url, "_blank", "noopener,noreferrer"),
    settings: {
      theme: { get: () => { try { return localStorage.getItem("notecomplete-theme") || "system"; } catch { return "system"; } }, set: (v) => theme.set(v) },
      darkPages: { get: () => document.body.classList.contains("pages-dark"), set: (on) => setDarkPages(on) },
      uiSize: {
        get: () => (windows?.zoom ? null : webUiZoom),
        step: async (n) => {
          if (windows?.zoom) { const z = await windows.zoom(n); status(`Interface size ${Math.round(z * 100)}%`); return z; }
          applyUiSize(n);
          return webUiZoom;
        },
      },
      quality: { get: () => quality.get(), set: (value, detail) => quality.set(value, detail) },
      pressure: { get: () => pressureOn(), set: (on) => { $("pressure").value = on ? "on" : "off"; $("pressure").dispatchEvent(new Event("change")); } },
      smoothing: { get: () => smoothingOn, set: (on) => { if (on !== smoothingOn) $("penSmoothToggle").click(); } },
      toolNames: { get: () => toolNamesOn(), set: (on) => { if (on !== toolNamesOn()) $("toolNames").click(); } },
      newFormat: {
        get: () => { try { return newFormat(localStorage.getItem("notecomplete-new-format")); } catch { return "project"; } },
        set: (v) => { try { localStorage.setItem("notecomplete-new-format", newFormat(v)); } catch { /* Optional. */ } },
      },
      menuBarAutoHide: { get: () => checked("menuBarAutoHide"), set: (on) => setMenuBarAutoHide(on) },
      dock: { get: () => document.body.dataset.landscapeDock || "top", set: (side) => setLandscapeDock(side) },
      spread: { get: () => spread === 2, set: (on) => setPageSpread(on ? 2 : 1) },
      welcome: { available: () => !!$("welcomeToggle") && !$("welcomeToggle").hidden, get: () => welcomeWanted(), set: (on) => { if (on !== welcomeWanted()) $("welcomeToggle").click(); } },
      updateChecks: { available: () => !$("updateItems").hidden, get: () => checked("updateOnOpen"), set: (on) => flip("updateOnOpen", on) },
    },
  });
  $("setupWizardOpen").onclick = () => { closeMenus(); wizard.open(); };
  // "Install from Setup ▸ Modules…" in the Open with menus and chooser.
  setOpenSetupModules(() => { closeMenus(); wizard.open("modules"); });
  // The desktop app's own Help menu asks the tab in front.
  window.notecompleteWindows?.onSetupWizard?.(() => wizard.open());
  // ?setup=1 (or =<step>) opens it at once: for checking it, and for links from the docs.
  const asked = new URLSearchParams(location.search).get("setup");
  if (asked) setTimeout(() => wizard.open(asked === "1" ? "" : asked), 300);
  else autoOpenSetup(wizard);
}

// Links in AI answers: page links jump to the page, attached images open large;
// web links open through the desktop app's window handler (target=_blank).
document.addEventListener("click", async (e) => {
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
  if (a.dataset.localFile) {
    e.preventDefault();
    const filePath = a.dataset.localFile;
    if (!window.notecompleteFiles?.readLocalNote) {
      status("Opening local file links is only available in the desktop app.", true);
      return;
    }
    if (busy() || !canReplace()) return;
    try {
      const opened = await window.notecompleteFiles.readLocalNote(filePath);
      if (!opened) return status(`File not found: ${filePath}`, true);
      for (const d of document.querySelectorAll("dialog[open]:not(.floating)")) d.close();
      const file = new File([opened.bytes], opened.name);
      await load(file);
      await openedLocal(opened.path, opened.name, file);
    } catch (err) {
      status(err?.message || `Could not open ${filePath}`, true);
    }
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
  call: autosaveCall, applyShared, status, jump, cancelGesture, pinchBy, penActive, setZoom, notesApi, download, library,
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
  async importStudyPack(pack) { return importStudyWithChoice(pack, { openAfter: true }); },
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
  openFile: (file, meta) => openImportedFile(file, meta),
  // Auto-save in a session: the host's switch, followed by everyone else.
  autosaveOn: () => autosave.pref(),
  // Keeping the live notes and copy helper on the sharing host.
  async pickProjectOptions(currentOptions = null) {
    if (!doc || busy()) return null;
    await prepareProjectMetadata();
    const packed = await addedStore.packed();
    const breakdown = await call("projectBreakdown", packed);
    return chooseNfeditExport({ $, title: doc?.title || filename(), breakdown, initialOptions: currentOptions || {}, actionLabel: "Use for QR share" });
  },
  exportNote: (as = "project", options = null) => exportNoteBytes(as, options),
  exportAndDownload: (as = "project", options = null) => save(as === "noteful" || (as === "project" && !!options), as, options),
  // Keeps any active collaboration autosave flag aligned.
  setSharedAutosave: (on) => autosave.setShared(on),
  // A copy of the shared note before it closes (a guest or tablet losing the session).
  keepCopy: () => autosave.keepCopy(),
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
$("shareNoteQr").onclick = async () => {
  closeMenus();
  try {
    const { openShareNoteQr } = await (collabLoading ||= import("./collab.js"));
    await openShareNoteQr(collabHost);
  } catch (e) {
    collabLoading = null;
    status(e.message, true);
  }
};
$("hubReceive").onclick = async () => {
  closeMenus();
  try {
    const { openReceiveNoteQr } = await (collabLoading ||= import("./collab.js"));
    await openReceiveNoteQr(collabHost);
  } catch (e) {
    collabLoading = null;
    status(e.message, true);
  }
};
$("hubOpen").onclick = () => $("open").click();
{
  const tabs = [...document.querySelectorAll("#exportDialog [data-export-tab]")];
  const panels = [...document.querySelectorAll("#exportDialog [data-export-panel]")];
  const subTabs = [...document.querySelectorAll("#exportDialog [data-export-subtab]")];
  const subPanels = [...document.querySelectorAll("#exportDialog [data-export-subpanel]")];
  const setExportSubTab = (name) => {
    const active = name === "resources" ? "resources" : "notes";
    for (const t of subTabs) t.setAttribute("aria-selected", String(t.dataset.exportSubtab === active));
    for (const p of subPanels) p.hidden = p.dataset.exportSubpanel !== active;
    numberExportItems();
  };
  const setExportTab = (name) => {
    const mapped = (name === "notes" || name === "resources") ? "export" : name;
    const active = mapped === "export" ? "export" : "open";
    for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.exportTab === active));
    for (const p of panels) p.hidden = p.dataset.exportPanel !== active;
    if (name === "notes" || name === "resources") setExportSubTab(name);
    try { localStorage.setItem("notecomplete-export-tab", active); } catch { /* Optional. */ }
    numberExportItems();
  };
  // The view shown: Open & Import, or Export's Notes or Resources; Tab and Shift Tab go round them.
  const VIEWS = ["open", "notes", "resources"];
  const currentView = () => ($("exportTabOpen").getAttribute("aria-selected") === "true" ? "open"
    : subTabs.find((t) => t.getAttribute("aria-selected") === "true")?.dataset.exportSubtab || "notes");
  const viewTab = (view) => (view === "open" ? $("exportTabOpen") : subTabs.find((t) => t.dataset.exportSubtab === view));
  // The items of the view on screen, in reading order; the first nine have keys 1–9.
  const exportItems = () => [...$("exportDialog").querySelectorAll(".export-item")].filter((b) => !b.closest("[hidden]"));
  function numberExportItems() {
    for (const b of $("exportDialog").querySelectorAll(".export-item[data-num]")) { delete b.dataset.num; b.removeAttribute("aria-keyshortcuts"); }
    exportItems().slice(0, 9).forEach((b, i) => { b.dataset.num = String(i + 1); b.setAttribute("aria-keyshortcuts", String(i + 1)); });
  }
  for (const t of tabs) t.onclick = () => setExportTab(t.dataset.exportTab);
  for (const t of subTabs) t.onclick = () => setExportSubTab(t.dataset.exportSubtab);
  // Export opens on Notes; whether Open & Import or Export shows is remembered.
  setExportSubTab("notes");
  try { setExportTab(localStorage.getItem("notecomplete-export-tab") || "open"); } catch { setExportTab("open"); }
  $("exportOpen").addEventListener("click", () => {
    setExportSubTab("notes");
    requestAnimationFrame(() => { if ($("exportDialog").open) viewTab(currentView())?.focus(); });
  });
  $("exportDialog").addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const at = VIEWS.indexOf(currentView());
      const next = VIEWS[(at + (e.shiftKey ? VIEWS.length - 1 : 1)) % VIEWS.length];
      setExportTab(next);
      viewTab(next)?.focus();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const item = exportItems()[Number(e.key) - 1];
      if (!item) return;
      e.preventDefault();
      if (item.disabled) { status(`${item.querySelector("b")?.textContent || "That"} needs a note open.`); return; }
      item.focus();
      item.click();
      return;
    }
    // Arrows move between the items of the view (Enter or Space chooses).
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step && !e.target.closest?.("[role=menu]")) {
      const items = exportItems().filter((b) => !b.disabled);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(e.target);
      items[i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length].focus();
    }
  });
}
$("studyShare").onclick = async () => {
  closeMenus();
  try { const { openStudyShare } = await (collabLoading ||= import("./collab.js")); await openStudyShare(collabHost); } catch (e) { collabLoading = null; status(e.message, true); }
};
// The note on screen (the same one Study → All quizzes calls current).
const quizIndexFp = () => (doc && !$("editor").hidden ? find.fingerprint : studyText() && textView.visible ? sideFp : "");
// Importing study material into a note (study-import.js).
const { importStudyFile, importStudyWithChoice } = studyImport({
  $,
  library,
  quizIndex,
  quizIndexFp,
  quizzes,
  sideView,
  status,
  study,
  app: {
    get doc() { return doc; },
    get noteEntryKey() { return noteEntryKey; },
  },
});

async function openImportedFile(file, meta = {}) {
  if (!file) return;
  if (await openMediaFile(file)) return;
  if (busy()) return;
  try {
    const { classifyImport } = await import("./import-route.js");
    const kind = await classifyImport(file);
    if (kind === "study-pack" || kind === "quiz-markdown" || kind === "deck") {
      return importStudyFile(file, kind);
    }
  } catch { /* Fall through to opening as a document. */ }
  try {
    if (await openArchiveFile(file, { origin: meta?.origin || "Imported" })) return;
  } catch (error) { return status(error.message, true); }
  if (!canReplace()) return;
  notePath = noteEntryKey = "";
  try {
    await load(file);
    const entry = await library.rememberImported(file, {
      origin: meta?.origin || "Imported",
      folder: meta?.folder || "",
    }).catch(() => null);
    if (entry) {
      noteEntryKey = entry.key;
      activeCoverKeyOverride = entry.key;
      rememberDocument(entry.key);
      home.rememberFacts(entry.key, file);
      setDocMember({ key: entry.key, name: entry.name, source: "imported" });
      void Promise.resolve(home.rememberCover(entry.key, file)).then(() => ensureDocumentCover({ skipExisting: true }));
      if (home.visible) home.renderRecent();
    } else {
      setDocMember(null);
    }
  } catch { /* Reported by load(). */ }
}

$("studyPackFile").onchange = () => {
  const [file] = $("studyPackFile").files;
  $("studyPackFile").value = "";
  if (file) openImportedFile(file);
};
// File → Import…: whatever the file is, it goes where it belongs (import-route.js).
$("importAny").onclick = () => { closeMenus(); $("importAnyFile").click(); };
$("importAnyFile").onchange = async () => {
  const [file] = $("importAnyFile").files;
  $("importAnyFile").value = "";
  if (file) await openImportedFile(file);
};
$("shareSession").hidden = !window.notecompleteCollab;
$("shareSession").onclick = () => startCollab("host");
$("joinTablet").onclick = () => startCollab("join-tablet");
$("joinNotes").onclick = () => startCollab("join-notes");
// Opened from an invite (/join#… or /tablet#…, served by the host's computer).
if (/^\/(join|tablet|send)$/.test(location.pathname) && location.hash.length > 1) startCollab("link");

// A tap on the grey around the pages lets go of the selection too.
$("viewport").addEventListener("pointerdown", (e) => {
  if (selection.item && e.button === 0 && !e.target.closest?.(".sheet, [data-selection-handle], .selection-options, .context-menu")) selection.clear();
});
