import {
  prepareDocument,
  readImage,
  imageBounds,
  fileKind,
} from "./media-import.js";
import { driveBrowser } from "./drive-browser.js";
import { Library } from "./library.js";
import { homeScreen } from "./home.js";
import { commandPalette } from "./command-palette.js";
import { receiveNativeFiles } from "./import.js";
import { SelectionController } from "./selection.js";
import { ChromeState, highlightPoints } from "./chrome-state.js";
import { download } from "./download.js";
import { enhanceSelects, refreshSelects } from "./select.js";
import { decorateIcons } from "./icons.js";
import { qualitySettings } from "./quality.js";
import { PdfBackgrounds, backgroundPlacement } from "./pdf-background.js";
import { AudioController } from "./audio.js";
import { TranscriptController } from "./transcript.js";
import { AudioProcessing } from "./audio-processing.js";
import { indexTimedInk, updateTimedInk } from "./ink-timeline.js";
import { shapePoints } from "./shapes.js";
const $ = (id) => document.getElementById(id),
  ns = "http://www.w3.org/2000/svg";
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
  editing = false,
  doc = null,
  page = 0,
  tool = "pan",
  activeLayer = 0,
  gesture = null,
  backgrounds = null;
let mutationPending = 0;
const busy = () => editing || mutationPending > 0;
function savedState() {
  $("saveState").hidden = !doc;
  $("saveState").textContent = dirty ? "Unsaved changes" : "Project saved";
}

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
  document.documentElement.style.setProperty("--page-filter", value.contrast === 100 && value.brightness === 100 ? "none" : `contrast(${value.contrast}%) brightness(${value.brightness}%)`);
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
    !dirty ||
    confirm("You have unsaved changes. Open another document and discard them?")
  );
}
function reset() {
  selection.clear();
  cancelGesture();
  chromeState.reset();
  barState.reset();
  document.body.classList.remove("bar-compact");
  setCompact(false);
  observer?.disconnect();
  thumbnailObserver?.disconnect();
  backgrounds?.close();
  audio.reset();
  panels = [];
  doc = null;
  $("pages").replaceChildren();
  $("editor").hidden = true;
  $("title").textContent = "Home";
  dirty = false;
  documentControls();
  home?.show(false);
}
async function load(file) {
  if (!ready || busy()) {
    status("Wait for the current operation to finish.", true);
    return;
  }
  editing = true;
  status("Opening document…");
  try {
    const prepared = await prepareDocument(file);
    const result = await call("open", {
      ...prepared,
      project: prepared.kind === "project",
      page: 0,
    });
    // Both worker and UI retain the previous document until the replacement validates.
    reset();
    const token = ++epoch;
    revision++;
    doc = result;
    page = 0;
    activeLayer =
      result.layers.find((l) => l.visible && !l.locked)?.id ??
      result.layers[0]?.id ??
      0;
    dirty = ["pdf", "image"].includes(prepared.kind);
    savedState();
    backgrounds = new PdfBackgrounds((resource) => {
      if (token !== epoch) throw Error("Document closed");
      return call("pdf", { resource });
    });
    $("title").textContent = result.title || "Untitled note";
    showDocument();
    $("pageNumber").max = result.pages;
    documentControls();
    buildPages(result.page_sizes);
    updateTools(result);
    layerPanel(result.layers);
    audio.open(result.audio || [], result.recordings || []);
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
      dirty = true;
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
    el.oncontextmenu = async (event) => {
      // Right-click removes the element under the pointer; Ctrl+Z brings it back.
      event.preventDefault();
      if (!doc || editing || busy() || !p.view) return;
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
      if (!p.audioTap || tool !== "pan" || !p.view?.timings.length) return;
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
  thumbnailObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const panel = panels.find((candidate) => candidate.pageButton === entry.target);
        if (panel && !panel.thumbnailReady) renderThumbnail(panel);
      }
    },
    { root: $("pagesPanel"), rootMargin: "240px 0px" },
  );
  for (const panel of panels) thumbnailObserver.observe(panel.pageButton);
  markPage();
}
// Paper stays underneath so widened pages show blank paper beside the PDF.
function pdfImage(href, place) {
  const el = document.createElementNS(ns, "image");
  for (const [k, v] of Object.entries({ href, x: place.x, y: place.y, width: place.width, height: place.height, preserveAspectRatio: "none" }))
    el.setAttribute(k, v);
  return el;
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
    const overlay = document.createElementNS(ns, "svg");
    overlay.classList.add("overlay");
    overlay.setAttribute("viewBox", `0 0 ${p.size.join(" ")}`);
    p.render = render;
    p.overlay = overlay;
    p.el.replaceChildren(render, overlay);
    p.pdfReady = !result.pdf_background;
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
    if (result.pdf_background) {
      const displayWidth = p.el.clientWidth || p.size[0];
      const place = backgroundPlacement(result.pdf_background, p.size);
      const image = await backgrounds.image(
        result.pdf_background,
        p.size,
        displayWidth * place.share,
        displayQuality,
      );
      if (note !== epoch || token !== p.token || version !== revision) return;
      render.querySelector("[data-background]").append(pdfImage(image, place));
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
  $("textInfo").hidden = !result.texts?.length;
  $("textRuns").replaceChildren();
  for (const block of result.texts || [])
    for (const r of block.runs) {
      if (!r.text.replaceAll("\u200b", "")) continue;
      const li = document.createElement("li");
      li.textContent = `${r.text} · ${((r.font_size * 6) / 11).toLocaleString("en", { maximumFractionDigits: 2 })} pt · ${r.font_family || r.font_name || "System"}${r.bold ? " · bold" : ""}${r.italic ? " · italic" : ""}${r.underline ? " · underline" : ""}${r.strikethrough ? " · strikethrough" : ""}`;
      $("textRuns").append(li);
    }
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
}
function jump(index) {
  if (!doc || !Number.isInteger(index) || index < 0 || index >= doc.pages)
    return;
  cancelGesture();
  setPage(index);
  const viewport = $("viewport");
  viewport.scrollTop +=
    panels[index].el.getBoundingClientRect().top -
    viewport.getBoundingClientRect().top -
    24;
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
function toolOptions() {
  $("shapeOptions").hidden = tool !== "shape";
  $("highlightOptions").hidden = tool !== "highlight";
  $("drawingOptions").hidden = tool === "select";
  $("selectionOptions").hidden = tool !== "select" || !selection.item;
  $("toolOptions").hidden =
    chromeState.compact ||
    (!["draw", "highlight", "shape"].includes(tool) &&
      !(tool === "select" && selection.item));
  $("toolbarToggle").setAttribute("aria-expanded", String(!$("toolOptions").hidden));
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
    dirty = true;
    revision++;
    doc = result;
    savedState();
    if (op === "draw" && args.line.shape && !gesture) {
      document.querySelector("[data-tool=select]").click();
      selection.selectId(args.page ?? page, `new:${result.edit_count - 1}`);
    } else if (selection.item) {
      selection.selectId(selection.item.page, selection.item.id);
    }
    updateTools(result);
    layerPanel(result.layers);
    for (const p of panels) {
      p.token++;
      if (p.near || p.index === page)
        renderPage(p, p.index === result.page ? result : undefined);
    }
    status(
      op === "erase"
        ? "Erased. You can undo this change."
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
    if (e.pointerType !== "mouse") return;
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
  const layer = doc.layers.find((l) => l.id === activeLayer);
  if (tool !== "erase" && (!layer?.visible || layer.locked)) {
    status("Select a visible, unlocked layer.", true);
    return;
  }
  e.preventDefault();
  const start = point(e, p),
    width = tool === "erase" ? 20 : Number($("width").value),
    color = $("color").value;
  const el = document.createElementNS(ns, "polyline"),
    dot = document.createElementNS(ns, "circle");
  for (const [k, v] of Object.entries({
    fill: "none",
    stroke: tool === "erase" ? "#ed6b55" : color,
    "stroke-width": width,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    opacity: tool === "erase" ? 0.3 : tool === "highlight" ? 0.5 : 1,
  }))
    el.setAttribute(k, v);
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
    straight: tool === "highlight" && $("highlightMode").value === "straight",
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
  g.el.setAttribute("points", g.points.map((p) => p.join(",")).join(" "));
  g.dot.style.display = g.points.length > 1 ? "none" : "";
  g.dot.setAttribute("cx", g.points[0][0]);
  g.dot.setAttribute("cy", g.points[0][1]);
}
function appendPoint(e) {
  const g = gesture;
  if (g.tool === "shape") {
    g.points = shapePoints($("shape").value, g.start, point(e, g.panel));
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
  if (g.tool === "erase")
    action("erase", { page: g.panel.index, points: g.points, radius: 10 });
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
        tool: g.tool === "highlight" ? 1 : 0,
        layer: g.layer,
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
    if (tool === button.dataset.tool) {
      setCompact(!chromeState.compact);
      return;
    }
    tool = button.dataset.tool;
    if (tool !== "select") selection.clear();
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
    }
    toolOptions();
    refreshSelects();
    status(
      tool === "select"
        ? "Tap an item to move or edit it."
        : tool === "highlight"
          ? $("highlightMode").value === "straight"
            ? "Straight highlight: drag between the endpoints."
            : "Freehand highlight: draw on the page."
          : tool === "erase"
            ? "Drag to erase whole strokes."
            : tool === "pan"
              ? "Scroll through the pages."
              : "Draw on the selected layer.",
    );
  };
$("highlightMode").onchange = () => {
  cancelGesture();
  status(
    $("highlightMode").value === "straight"
      ? "Straight highlight: drag between the endpoints."
      : "Freehand highlight: draw on the page.",
  );
};
$("shape").onchange = () =>
  document.querySelector('[data-tool="shape"]').click();
$("pageNumber").onchange = () => jump(Number($("pageNumber").value) - 1);
$("zoomFit").onclick = () => setZoom("fit");
$("zoomOut").onclick = () => stepZoom(-1);
$("zoomIn").onclick = () => stepZoom(1);
new ResizeObserver(resize).observe($("viewport"));
$("undo").onclick = () => {
  cancelGesture();
  action("undo");
};
$("redo").onclick = () => {
  cancelGesture();
  action("redo");
};
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!$("qualityDialog").open) palette.open();
    return;
  }
  if ($("qualityDialog").open || $("paletteDialog").open) return;
  if (e.key === "Escape") {
    cancelGesture();
    setCompact(true);
    $("layersPanel").hidden = true;
    $("layersToggle").setAttribute("aria-expanded", "false");
    $("pagesPanel").classList.remove("open");
    syncPagePanel();
    for (const menu of document.querySelectorAll("details.menu")) menu.open = false;
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    openLocal();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save(false);
    return;
  }
  if (e.target.matches?.("input,select,textarea,[contenteditable=true]"))
    return;
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
  if (e.target.files[0] && !busy() && canReplace())
    load(e.target.files[0]).catch(() => {});
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
      else if (canReplace()) await load(files[0]);
    } catch (error) {
      status(error.message, true);
    }
  });
$("drop").ondragleave = () => $("drop").classList.remove("drag");
function filename() {
  return (doc?.title || "Note").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}
async function save(native) {
  if (!doc || busy()) return;
  cancelGesture();
  editing = true;
  const token = epoch;
  try {
    const data = await call(native ? "export" : "save");
    if (token !== epoch) return;
    const delivery = await download(
      data,
      filename() + (native ? ".noteful" : ".nfedit"),
      native ? "application/octet-stream" : "application/json",
    );
    if (token !== epoch) return;
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
$("save").onclick = () => save(false);
$("native").onclick = () => save(true);
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
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});

function shapeHandles(p) {
  selection.render(p);
}
async function patchItem(item, adjustment) {
  if (busy() || !doc) return null;
  editing = true;
  const token = epoch;
  try {
    const result = await call("adjust", {
      page: item.page,
      itemId: item.id,
      adjustment,
    });
    if (token !== epoch) return null;
    dirty = true;
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
  $("zoomValue").textContent = zoom === "fit" ? "Fit" : Math.round(value * 100) + "%";
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

$("audioDetails").onclick = () => {
 const expanded=$("audioBar").classList.toggle("expanded");
 $("audioDetails").setAttribute("aria-expanded",String(expanded));
};
// Desktop opens with the recording controls visible; the toggle still shrinks them at any time.
if (matchMedia("(min-width: 701px)").matches) {
 $("audioBar").classList.add("expanded");
 $("audioDetails").setAttribute("aria-expanded", "true");
}

// Opening from Drive or Recent goes through the same unsaved-changes check as local files.
async function openChosen(file) {
  if (!ready || busy()) throw Error("Wait for the current operation to finish, then choose the file again.");
  if (!canReplace()) return false;
  await load(file);
  return true;
}
const library = new Library();
const drive = driveBrowser({
  library,
  open: async (file, driveFile) => {
    const opened = await openChosen(file);
    if (opened) home.rememberCover(library.coverKey(driveFile), file);
    return opened;
  },
});
var home = homeScreen({ library, drive, open: openChosen, status });
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
    const entry = await library.rememberLocal(chosen.path, chosen.name, file.size);
    home.rememberCover(entry.key, file);
  } catch (error) {
    status(error.message, true);
  }
}
function showDocument() {
  home.hide();
  $("editor").hidden = false;
  if (panels[page]) resize();
}
function showHome() {
  if (!$("editor").hidden && doc) $("editor").hidden = true;
  home.show(!!doc);
}
$("homeButton").onclick = showHome;
$("homeBack").onclick = () => doc && showDocument();
$("driveOpen").onclick = () => {
  showHome();
  $("driveSection").scrollIntoView({ behavior: "smooth", block: "start" });
};
function documentControls() {
  const open = !!doc;
  for (const id of ["save", "native", "importImage", "gotoPage"])
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
documentControls();
home.show(false);

const palette = commandPalette({
  dialog: $("paletteDialog"),
  input: $("paletteInput"),
  list: $("paletteList"),
  commands: () => [
    ...[...document.querySelectorAll("#commandBar button[id], #commandBar .menu-content button")]
      .filter((b) => b.id !== "paletteOpen" && b.dataset.proxy !== "paletteOpen" && b.textContent.trim())
      .map((b) => ({
        id: b.id,
        title: (b.closest(".bar-menu") ? b.closest(".bar-menu").querySelector("summary").textContent.trim() + ": " : "") + [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(),
        hint: b.querySelector("kbd")?.textContent,
        group: b.closest(".bar-menu")?.querySelector("summary").textContent.trim() || "General",
        enabled: () => (b.dataset.proxy || b.dataset.proxyTool ? syncMenus() : 0, !b.disabled && !b.hidden),
        run: () => b.click(),
      })),
  ],
  dynamic: (query) => {
    const items = [];
    const number = query.trim().match(/^(?:p(?:age|ágina)?\.?\s*|:)?(\d+)$/i);
    if (number && doc) {
      const target = Math.min(doc.pages, Math.max(1, Number(number[1])));
      items.push({ id: "goto", title: `Go to page ${target} of ${doc.pages}`, group: "Navigate", run: () => { showDocument(); jump(target - 1); } });
    }
    return items;
  },
});
$("paletteOpen").onclick = () => palette.open();
