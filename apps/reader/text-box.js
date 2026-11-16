// Text tool: a text box typed in place. Its layout matches the core's text
// rendering (first baseline 8 + size, line advance size + max(8, size/5 + 8),
// 5 units of left padding), so the box does not jump when it is committed.
// A format bar sits on the box while typing, and on a selected text box with
// Select: font, size, bold, italic and colour apply at once. The last style
// used is the one new boxes start with.
import { mathSize, previewMath } from "./math-boxes.js";
import { mathKeypad } from "./math-keypad.js";
import { mathField, styleField, mounted, focusField } from "./math-field.js";

export const FONT_STACKS = {
  Helvetica: "Helvetica, Arial, sans-serif",
  "Times New Roman": "'Times New Roman', Times, serif",
  "Courier New": "'Courier New', monospace",
  Noteworthy: "Noteworthy, 'Comic Neue', 'Comic Sans MS', cursive",
  "Comic Sans MS": "'Comic Sans MS', 'Comic Sans', 'Comic Neue', cursive",
};
export const TEXT_SIZES = [10, 12, 14, 16, 18, 22, 28, 36, 48, 64, 96];
export const textAdvance = (size) => size + Math.max(8, size * 0.2 + 8);
export const cssFont = (style, size = style.size) => `${style.italic ? "italic " : ""}${style.bold ? 700 : 400} ${size}px ${FONT_STACKS[style.font] || FONT_STACKS.Helvetica}`;

export function textBoxSize(text, style, measure = null) {
  const widthOf = measure || (() => {
    const context = document.createElement("canvas").getContext("2d");
    context.font = cssFont(style);
    return (line) => context.measureText(line).width;
  })();
  const lines = text.split("\n");
  return [Math.ceil(Math.max(...lines.map((l) => widthOf(l))) + 12), Math.ceil(8 + lines.length * textAdvance(style.size))];
}

export function wrapText(text, style, width, measure = null) {
  const widthOf = measure || (() => {
    const context = document.createElement("canvas").getContext("2d");
    context.font = cssFont(style);
    return (line) => context.measureText(line).width;
  })();
  return text.split("\n").map((line) => {
    const out = [];
    let current = "";
    for (const word of line.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (current && widthOf(next) > width) { out.push(current); current = word; }
      else current = next;
    }
    return [...out, current].join("\n");
  }).join("\n");
}

export const hexColor = (rgba) => "#" + rgba.slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
export const rgbaOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1);

// `math`: the text is LaTeX, typeset by KaTeX (math-boxes.js); sent only when set.
export const textPayload = (value, style) => ({ text: value, font_size: style.size, rgba: style.rgba, bold: style.bold, italic: style.italic, font: style.font, ...(style.math ? { math: true } : {}) });
export const boxText = (existing) => existing.runs.map((r) => r.text).join("").replaceAll("​", "");

// A typed text box's drawn copy, hidden while the box over it shows its text instead.
export function hideText(p, id, hidden = true) {
  const item = id != null && p.render?.querySelector(`[data-item="${id}"]`);
  if (item) hidden ? item.setAttribute("visibility", "hidden") : item.removeAttribute("visibility");
}

// Finished strokes (this reader's, or another person's live line) stay in the page's
// overlay the same way: a redraw for any other reason, or one with only the edits the
// engine has answered so far, left them gone until a later render had them.
export function holdInk(p, ...els) {
  for (const el of els) {
    el.classList.add("pending-ink");
    if (p.overlay && el.parentNode !== p.overlay) p.overlay.append(el);
  }
  const hold = { p, els, ink: true, revision: Infinity };
  (p.held ||= []).push(hold);
  return hold;
}

// The edit was refused, or the note changed: the box goes, and the text it covered shows.
export function letGo(hold) {
  if (!hold || hold.revision !== Infinity) return;
  hold.p.held = hold.p.held.filter((h) => h !== hold);
  for (const el of hold.els) el.remove();
  if (!hold.ink) hideText(hold.p, hold.item, false);
}

// After a render of the page at `version` (strokes, `ink`, or text boxes): those whose edit
// it has go; the others stay, strokes in the new overlay and boxes over the page.
export function keepHeld(p, version, ink) {
  p.held = (p.held || []).filter((h) => {
    if (!!h.ink !== ink) return true;
    const keep = h.revision > version;
    for (const el of h.els) if (keep) (ink ? p.overlay : p.el).append(el); else el.remove();
    if (keep && !ink) hideText(p, h.item);
    return keep;
  });
}

export function textBoxController({
  call,
  action,
  status,
  selection,
  swatches = [],
  getDoc = () => null,
  getActiveLayer = () => 0,
  getTool = () => "draw",
  getPanels = () => [],
  getPage = () => 0,
  isEditing = () => false,
  isBusy = () => false,
  toolOptions = () => {},
  insertCompound = async () => {},
  $ = (id) => document.getElementById(id),
  doc = document,
}) {
  let textDefaults = { font: "Helvetica", size: 16, bold: false, italic: false, rgba: [0.12, 0.14, 0.16, 1] };
  try { textDefaults = { ...textDefaults, ...JSON.parse(localStorage.getItem("notecomplete-text-style") || "{}") }; } catch { /* Optional. */ }
  const styleOf = (run) => run ? { font: run.font_family || "Helvetica", size: run.font_size, bold: run.bold, italic: run.italic, rgba: run.rgba } : { ...textDefaults };
  // A typed box's style, with its math flag (kept by the box, not by its runs).
  const boxStyleOf = (existing) => ({ ...styleOf(existing?.runs?.[0]), ...(existing?.math ? { math: true } : {}) });
  // The size a box needs: typeset math is measured, other text from its lines.
  const boxSize = (value, style) => (style.math ? mathSize(value, style).catch(() => textBoxSize(value, style)) : Promise.resolve(textBoxSize(value, style)));

  for (const size of TEXT_SIZES) $("textSize")?.add?.(new Option(String(size), String(size)));
  for (const color of swatches) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.dataset.color = color;
    b.style.setProperty("--swatch", color);
    b.title = color;
    b.setAttribute("role", "radio");
    $("textSwatches")?.append(b);
  }
  const textFormatBar = $("textFormat");
  // Which box the bar formats: the one being typed, or a selected one.
  let textFormatTarget = null;
  let textEditor = null;

  const textFormatDocked = () => doc.body.classList.contains("text-format-docked");

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

  function hideTextFormat() {
    textFormatTarget = null;
    const docked = textFormatBar.parentElement === $("toolOptions");
    textFormatBar.hidden = true;
    doc.body.append(textFormatBar);
    if (docked) toolOptions();
  }

  function setTextFormatDocked(on) {
    doc.body.classList.toggle("text-format-docked", on);
    $("textFormatDock").setAttribute("aria-checked", String(on));
    try { localStorage.setItem("notecomplete-text-format-docked", on ? "1" : "0"); } catch { /* Optional. */ }
    // A bar showing now moves to its new place.
    const t = textFormatTarget;
    if (t) {
      hideTextFormat();
      if (textEditor) showTextFormat(t.p, [textEditor.bx, textEditor.by, 0, 0], t.style, t.apply);
      else syncFormat();
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
  function syncFormat() {
    if (textEditor) return;
    const panels = getPanels();
    const item = selection.item, p = item && panels[item.page];
    const existing = getTool() === "select" && item?.kind === "text" && (p?.view?.texts || []).find((t) => t.id === item.id);
    if (!existing) return hideTextFormat();
    const style = boxStyleOf(existing);
    showTextFormat(p, existing.bounds, style, async (next) => {
      const value = boxText(existing), [w, h] = await boxSize(value, next);
      action("editText", { page: p.index, itemId: existing.id, text: textPayload(value, next), width: w, height: h });
    });
  }

  // The math keypad: shown while a math box (∑) is typed; its Graph key draws the box's function.
  const mathKeys = mathKeypad({ onGraph: (value) => graphFromBox(value), onLayout: () => keepTextVisible(), status: (text) => status(text) });

  // Phones and tablets open the on-screen keyboard only for a focus made during a tap, and the
  // box opens after an await: a hidden field takes the focus at the tap and hands it on.
  let keyboardPrimer = null;
  function primeKeyboard() {
    if (!keyboardPrimer) {
      keyboardPrimer = Object.assign(doc.createElement("textarea"), { className: "keyboard-primer", tabIndex: -1 });
      keyboardPrimer.setAttribute("aria-hidden", "true");
    }
    doc.body.append(keyboardPrimer);
    keyboardPrimer.focus({ preventScroll: true });
  }
  function unprime() {
    if (!keyboardPrimer?.isConnected) return;
    if (doc.activeElement === keyboardPrimer) keyboardPrimer.blur();
    keyboardPrimer.remove();
  }

  // A tap with Text (finger or stylus, pointerUp): finish the open box, or start one there.
  async function typeAt(p, at) {
    if (textEditor) return commit();
    primeKeyboard();
    try { await open(p, at); } finally { if (!textEditor) unprime(); }
  }

  // The on-screen keyboard covers the bottom of the screen (the visual viewport shrinks): the
  // box being typed scrolls above it, with room added below the pages to scroll that far.
  function keepTextVisible() {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
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
  if (typeof window !== "undefined") window.visualViewport?.addEventListener("resize", keepTextVisible);

  async function open(p, [x, y], known = null) {
    if (textEditor) return commit();
    const currentDoc = getDoc(), activeLayer = getActiveLayer();
    if (!currentDoc || isEditing() || isBusy() || !p.view) return;
    const layer = currentDoc.layers.find((l) => l.id === activeLayer);
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
    const area = doc.createElement("textarea");
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
    const discard = Object.assign(doc.createElement("button"), { type: "button", className: "text-discard", textContent: "×", title: "Discard (Shift + Esc)" });
    discard.setAttribute("aria-label", "Discard this text");
    discard.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
    discard.onclick = (e) => { e.stopPropagation(); close(); };
    const placeDiscard = () => Object.assign(discard.style, { left: `calc(${area.style.left} + ${area.style.width})`, top: area.style.top });
    // Math (the ∑ button): the formula typeset live under the box while its LaTeX is typed.
    const mathPreview = Object.assign(doc.createElement("div"), { className: "math-preview" });
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
      const focused = doc.activeElement === field;
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
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) close(); else commit(); }
          else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); commit(); }
        }, true);
        mf.addEventListener("keydown", (e) => e.stopPropagation());
        mf.addEventListener("focusout", () => setTimeout(() => {
          if (textEditor?.field !== mf || doc.activeElement === mf || doc.activeElement === area || textFormatBar.contains(doc.activeElement) || Date.now() - textFormatPressed < 1000) return;
          commit();
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
      if (e.key === "Escape") { e.preventDefault(); if (e.shiftKey) close(); else commit(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { commit(); return; }
      // Typing stays in the box: no tool or study shortcuts while editing.
      e.stopPropagation();
    });
    // Leaving the box finishes it, unless the focus went to its format bar (or came back,
    // as when the page is redrawn under it: renderPage).
    area.addEventListener("blur", () => setTimeout(() => {
      if (textEditor?.area !== area || doc.activeElement === area || (textEditor.field && doc.activeElement === textEditor.field) || textFormatBar.contains(doc.activeElement) || Date.now() - textFormatPressed < 1000) return;
      commit();
    }, 0));
    requestAnimationFrame(() => { area.focus(); unprime(); keepTextVisible(); });
    status(existing ? "Editing text. Esc, Ctrl+Enter or a click outside finishes; Shift+Esc or × discards." : "Type your text. Esc, Ctrl+Enter or a click outside finishes; Shift+Esc or × discards.");
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

  function close() {
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

  async function commit() {
    const t = textEditor;
    if (!t) return;
    const value = t.area.value.replace(/\s+$/, "");
    const text = textPayload(value, t.style);
    const same = t.existing && value === boxText(t.existing) && JSON.stringify(t.style) === JSON.stringify(t.initial);
    if (same || (!t.existing && !value.trim())) return close();
    const hold = holdText();
    if (t.existing && !value.trim()) return action("remove", { page: t.p.index, itemId: t.existing.id }, hold);
    const [w, h] = await boxSize(value || " ", t.style);
    if (t.existing) return action("editText", { page: t.p.index, itemId: t.existing.id, text, width: w, height: h }, hold);
    await action("image", { page: t.p.index, image: { base64: "", mime: "", bounds: [t.bx, t.by, w, h], layer: t.layer, text } }, hold);
  }

  // The keypad's graph key in a text box: the graph editor with the box's function; the graph
  // goes under the box, which is kept.
  async function graphFromBox(value) {
    const t = textEditor;
    if (!t) return;
    const tex = value.trim(), [, h] = tex ? await boxSize(tex, t.style) : [0, 0];
    const p = t.p, at = [t.bx, t.by + h + 24, 0, 0];
    if (tex) await commit(); else close();
    await insertCompound(p, "graph", at, { functions: tex ? [tex] : [] });
  }

  // Chat answers onto the page: a text box with the answer's text, wrapped to the
  // page, near the top of what is in view; selected so it can be dragged.
  async function answerToTextBox(text) {
    const currentDoc = getDoc(), page = getPage(), activeLayer = getActiveLayer(), panels = getPanels();
    const p = panels[page], layer = currentDoc?.layers.find((l) => l.id === activeLayer);
    if (!currentDoc || !p?.view || !text.trim()) return;
    if (!layer?.visible || layer.locked) return status("Select a visible, unlocked layer first.", true);
    const style = { ...textDefaults }, wrapped = wrapText(text, style, p.size[0] * 0.8 - 12);
    const [w, h] = textBoxSize(wrapped, style);
    const rect = p.el.getBoundingClientRect(), view = $("viewport").getBoundingClientRect(), scale = rect.width / p.size[0];
    const y = Math.min(Math.max(0, (view.top - rect.top) / scale) + 40, Math.max(20, p.size[1] - h - 20));
    await action("image", { page, image: { base64: "", mime: "", bounds: [p.size[0] * 0.08, y, w, h], layer: activeLayer, text: textPayload(wrapped, style) } });
    doc.querySelector('#toolbar [data-tool="select"]')?.click();
    await selection.selectId(page, `image:${currentDoc.edit_count - 1}`);
    status("Answer added as a text box: drag it into place, double-click to edit.");
  }

  function isTypingOn(p) {
    return textEditor?.p === p && (doc.activeElement === textEditor.area || (textEditor.field && doc.activeElement === textEditor.field));
  }

  // Typed text is not lost to a redraw (another screen's edit, a zoom): finished text
  // waiting for its own render stays, and so does the box being typed in.
  function restoreOnRender(p, shows, typing) {
    keepHeld(p, shows, false);
    if (textEditor?.p === p) {
      p.el.append(textEditor.area, textEditor.discard, textEditor.mathPreview, ...(textEditor.field ? [textEditor.field] : []));
      hideText(p, textEditor.existing?.id);
      textEditor.fit();
      if (typing) (textEditor.field || textEditor.area).focus({ preventScroll: true });
    }
    if (textFormatTarget?.p === p && !textFormatDocked()) p.el.append(textFormatBar);
  }

  return {
    get active() { return Boolean(textEditor); },
    open,
    typeAt,
    commit,
    close,
    syncFormat,
    isTypingOn,
    restoreOnRender,
    answerToTextBox,
    mathKeys,
  };
}
