// Two small hover aids over the pages and toolbar:
// - the pen hover preview, a ring at the pen's tip as wide as it would draw, while it hovers
//   (View → Pen hover preview, and which tools show it in Hover tools…);
// - tooltips for touch and pen, which have no mouse hover: a long press on a button shows its title.
// app.js wires them in with penHoverAndTips().
import { icon } from "./icons.js";

export function penHoverAndTips({ $, closeMenus, status, uiZoom, app }) {
  // Pen hover preview: a ring at the pen's tip, as wide as it would draw, while it hovers (pointer
  // events with no button held). Enabled by default on iOS and Android so stylus hover detection
  // is immediately visible; can be toggled off per device in View → Pen hover preview.
  const appleDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const HOVER_TOOLS = [
    ["pan", "Pan"],
    ["select", "Select"],
    ["text", "Text"],
    ["draw", "Pen"],
    ["highlight", "Highlighter"],
    ["erase", "Eraser"],
    ["shape", "Shapes"],
    ["tape", "Tape"],
    ["grab", "Grab text"],
  ];
  let penHoverOn = appleDevice || /Android/i.test(navigator.userAgent);
  try { const saved = localStorage.getItem("notecomplete-pen-hover"); if (saved === "1" || saved === "0") penHoverOn = saved === "1"; } catch { /* Optional. */ }
  const penHoverEnabled = () => penHoverOn;
  let penHoverTools = new Set(HOVER_TOOLS.map(([id]) => id));
  try {
    const savedTools = JSON.parse(localStorage.getItem("notecomplete-pen-hover-tools") || "null");
    if (Array.isArray(savedTools)) {
      const valid = new Set(HOVER_TOOLS.map(([id]) => id));
      penHoverTools = new Set(savedTools.filter((id) => valid.has(id)));
    }
  } catch { /* Optional. */ }
  function savePenHoverTools() {
    try { localStorage.setItem("notecomplete-pen-hover-tools", JSON.stringify([...penHoverTools])); } catch { /* Optional. */ }
  }
  const penHoverRing = document.createElement("div");
  penHoverRing.id = "penHover"; penHoverRing.hidden = true; penHoverRing.setAttribute("aria-hidden", "true");
  document.body.append(penHoverRing);
  let penHoverTimer = 0, penHoverLast = 0, penHoverFrame = 0, penHoverEvent = null;
  const penHoverShown = { size: 0, tool: "", color: "" };
  const hidePenHover = () => {
    penHoverEvent = null;
    if (penHoverFrame) { cancelAnimationFrame(penHoverFrame); penHoverFrame = 0; }
    if (penHoverTimer) { clearTimeout(penHoverTimer); penHoverTimer = 0; }
    if (!penHoverRing.hidden) penHoverRing.hidden = true;
  };
  // Leaving hover range is not always reported (the pen-out event can be lost, or name another
  // element): a ring with no pen move for a while is taken away. One timer checks the time
  // of the last move, rather than a timer started again on every move.
  const PEN_HOVER_IDLE_MS = 1200;
  const penHoverIdle = () => {
    const left = PEN_HOVER_IDLE_MS - (performance.now() - penHoverLast);
    penHoverTimer = left > 0 ? setTimeout(penHoverIdle, left) : 0;
    if (left <= 0) hidePenHover();
  };
  // A pen reports moves far more often than the screen draws (up to 240 a second on an
  // iPad): the ring is placed once a frame, from the latest move, and only what changed is
  // written, so hovering costs next to nothing.
  function showPenHover(e) {
    if (!penHoverOn || !app.doc || e.pointerType !== "pen" || e.buttons) return penHoverRing.hidden && !penHoverFrame ? undefined : hidePenHover();
    penHoverEvent = e;
    penHoverLast = performance.now();
    if (!penHoverFrame) penHoverFrame = requestAnimationFrame(placePenHover);
  }
  function placePenHover() {
    penHoverFrame = 0;
    const e = penHoverEvent;
    if (!e) return;
    const sheet = e.target.closest?.(".sheet"), p = sheet && app.panels[Number(sheet.dataset.page)];
    if (!p || !penHoverTools.has(app.tool)) return hidePenHover();
    const scale = p.el.getBoundingClientRect().width / p.size[0];
    const strokeTool = ["draw", "highlight", "erase", "tape"].includes(app.tool);
    const size = Math.round(strokeTool
      ? Math.max(6, (app.tool === "erase" ? app.eraserRadius() * 2 : Number($("width").value) || 2) * scale)
      : app.tool === "shape"
        ? Math.max(8, (Number($("width").value) || 2) * scale)
        : 12);
    const style = penHoverRing.style;
    if (size !== penHoverShown.size) { style.width = style.height = `${size}px`; penHoverShown.size = size; }
    style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size / 2}px)`;
    if (app.tool !== penHoverShown.tool) { penHoverRing.dataset.tool = app.tool; penHoverShown.tool = app.tool; }
    const color = app.tool === "erase" ? "#ed6b55" : strokeTool || app.tool === "shape" ? $("color").value : "var(--accent)";
    if (color !== penHoverShown.color) { style.setProperty("--hover-color", color); penHoverShown.color = color; }
    if (penHoverRing.hidden) penHoverRing.hidden = false;
    if (!penHoverTimer) penHoverTimer = setTimeout(penHoverIdle, PEN_HOVER_IDLE_MS);
  }
  window.addEventListener("pointermove", showPenHover, { capture: true, passive: true });
  window.addEventListener("pointerdown", hidePenHover, { capture: true, passive: true });
  // Out of range or off the page: no element under the pen, or one outside the document.
  window.addEventListener("pointerout", (e) => { if (e.pointerType === "pen" && !document.documentElement.contains(e.relatedTarget)) hidePenHover(); }, { capture: true, passive: true });
  document.documentElement.addEventListener("pointerleave", (e) => { if (e.pointerType === "pen") hidePenHover(); }, { passive: true });
  window.addEventListener("pointercancel", hidePenHover, { capture: true, passive: true });
  window.addEventListener("blur", hidePenHover);
  document.addEventListener("visibilitychange", () => { if (document.hidden) hidePenHover(); });
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
    const z = uiZoom(), r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(innerWidth / z - w - 8, (r.left + r.width / 2) / z - w / 2))}px`;
    tip.style.top = `${r.top / z - h - 8 > 4 ? r.top / z - h - 8 : r.bottom / z + 8}px`;
    clearTimeout(tipHide); tipHide = setTimeout(hideTip, 2800);
  }
  document.addEventListener("pointerdown", (e) => {
    hideTip();
    // A pen shows the name by hovering; its press, however long, is a click.
    if (e.pointerType !== "touch") return;
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
  const penHoverSwitch = () => {
    $("penHoverToggle").setAttribute("aria-checked", String(penHoverOn));
    if ($("hoverToolsMaster")) $("hoverToolsMaster").checked = penHoverOn;
  };
  penHoverSwitch();
  $("penHoverToggle").onclick = () => {
    penHoverOn = !penHoverOn;
    try { localStorage.setItem("notecomplete-pen-hover", penHoverOn ? "1" : "0"); } catch { /* Optional. */ }
    if (!penHoverOn) hidePenHover();
    penHoverSwitch();
    status(penHoverOn ? "Pen hover preview on: a cursor shows over the page." : "Pen hover preview off.");
  };
  function renderHoverToolsDialog() {
    $("hoverToolsMaster").checked = penHoverOn;
    $("hoverToolsList").replaceChildren(...HOVER_TOOLS.map(([id, label]) => {
      const row = document.createElement("label");
      row.className = "hover-tool-opt";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = penHoverTools.has(id);
      cb.onchange = () => {
        if (cb.checked) penHoverTools.add(id);
        else penHoverTools.delete(id);
        savePenHoverTools();
        if (!penHoverTools.has(app.tool)) hidePenHover();
      };
      const ic = icon(id);
      const span = document.createElement("span");
      span.textContent = label;
      row.append(cb, ic, span);
      return row;
    }));
  }
  $("hoverToolsOpen").onclick = () => {
    closeMenus();
    renderHoverToolsDialog();
    $("hoverToolsDialog").showModal();
  };
  $("hoverToolsMaster").onchange = () => {
    penHoverOn = $("hoverToolsMaster").checked;
    try { localStorage.setItem("notecomplete-pen-hover", penHoverOn ? "1" : "0"); } catch { /* Optional. */ }
    if (!penHoverOn) hidePenHover();
    penHoverSwitch();
  };
  $("hoverToolsReset").onclick = () => {
    penHoverTools = new Set(HOVER_TOOLS.map(([id]) => id));
    savePenHoverTools();
    if (!penHoverOn) {
      penHoverOn = true;
      try { localStorage.setItem("notecomplete-pen-hover", "1"); } catch { /* Optional. */ }
      penHoverSwitch();
    }
    renderHoverToolsDialog();
  };
  $("hoverToolsClose").onclick = () => $("hoverToolsDialog").close();
  return { penHoverEnabled };
}
