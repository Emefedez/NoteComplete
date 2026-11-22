// Each tool's widths (in px): the presets shown in the tool bar and the quick menu, the
// width row that picks one, and the dialog that sets a preset's value (hold one, or
// right-click it; any width from 0.5 to 100 px). Remembered in notecomplete-widths.
// app.js wires it in with toolWidths(); widthPresetsNow() is the current set.

export function toolWidths({ $, ns, syncChoices, app }) {
  // Each tool's widths (in px): the presets shown in the tool bar and the quick menu. Hold
  // one (or right-click it) to set its value; any width from 0.5 to 100 px. Remembered.
  const WIDTH_DEFAULTS = {
    // The pen: 4 px is the width that reads right next to Noteful's, with a slightly thicker
    // finest and a gentle ramp around it.
    draw: [2, 3, 4, 7, 11, 16],
    // Six for the pen, the highlighter and shapes: a 2 × 3 grid beside the colours.
    highlight: [8, 12, 16, 24, 32, 40],
    tape: [20, 40, 64],
    shape: [1, 2, 3, 4, 6, 8],
  };
  const WIDTH_LADDER = [1, 2, 4, 8, 16, 24, 40, 64];
  let widthPresets = { ...WIDTH_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem("notecomplete-widths") || "{}");
    // The pen's earlier untouched presets (1, 2, 4, 8) give way to the new ones; edited ones stay.
    if (["[1,2,4,8]", "[2,4,7,11]"].includes(JSON.stringify(saved.draw))) delete saved.draw;
    // Untouched four-width pens, highlighters and shapes get the six widths.
    if (JSON.stringify(saved.highlight) === "[8,16,24,40]") delete saved.highlight;
    if (JSON.stringify(saved.shape) === "[1,2,4,8]") delete saved.shape;
    widthPresets = { ...WIDTH_DEFAULTS, ...saved };
  } catch { /* Optional. */ }
  const widthPresetsNow = () => widthPresets;
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
    // A gentle (log) scale, so the thin widths (1, 2, 3 px) still look different from each other.
    const stroke = Math.min(12, 0.7 + 2.6 * Math.log1p(Number(value) / 2));
    svg.innerHTML = `<path d="M3 12h18" stroke-width="${stroke.toFixed(2)}"/>`;
    return svg;
  }
  // The tool bar's width row: this tool's presets, each held (or right-clicked) to change it.
  function buildWidthRow() {
    const row = document.querySelector('.choice-row[data-for="width"]');
    if (!row) return;
    const presets = widthPresets[app.tool], values = presets || WIDTH_LADDER;
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
        b.oncontextmenu = (e) => { e.preventDefault(); editWidth(app.tool, index); };
        b.addEventListener("pointerdown", (down) => {
          if (down.button !== 0) return;
          const timer = setTimeout(() => { held = true; editWidth(app.tool, index); }, 450);
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
    if (app.tool === name) { setWidthValue(v); $("width").dispatchEvent(new Event("change")); }
    $("widthDialog").close();
  };
  function saveWidths() {
    try { localStorage.setItem("notecomplete-widths", JSON.stringify(widthPresets)); } catch { /* Optional. */ }
    buildWidthRow();
    try { app.quick.redraw(); } catch { /* The menu is not made yet. */ }
  }
  buildWidthRow();
  return { WIDTH_LADDER, buildWidthRow, editWidth, lineIcon, saveWidths, setWidthValue, widthLabel, widthPresetsNow };
}
