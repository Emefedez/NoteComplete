// Text tool: a text box typed in place. Its layout matches the core's text
// rendering (first baseline 8 + size, line advance size + max(8, size/5 + 8),
// 5 units of left padding), so the box does not jump when it is committed.
// A format bar sits on the box while typing, and on a selected text box with
// Select: font, size, bold, italic and colour apply at once. The last style
// used is the one new boxes start with.
import { mathSize, previewMath } from "./math-boxes.js";
import { matrix as itemMatrix, point as mapPoint } from "./selection-geometry.js";
import { mathKeypad } from "./math-keypad.js";
import { mathField, styleField, mounted, focusField } from "./math-field.js";
import { fontStack, importFont, loadImportedFonts, pdfFontHash, CJK_SANS, CJK_SERIF } from "./fonts.js";
import { fromRuns, remapSpans, withoutKeys, spansFor } from "./rich-spans.js";
import { attachIme, zhButton } from "./chinese/ime.js";
import { imeMenuPressedAt } from "./chinese/ime-menu.js";
import { fieldMode, setFieldMode } from "./chinese/settings.js";
import { noteMode, setNoteMode, rubyOn, rubyElement } from "./chinese/ruby.js";

const HAN_SCRIPT = /\p{Script=Han}/u;
export const isLightInk = (rgba) => {
  if (!Array.isArray(rgba)) return false;
  const [r = 0, g = 0, b = 0, a = 1] = rgba;
  return a > 0.05 && (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.62;
};

export const FONT_STACKS = {
  Helvetica: `Helvetica, Arial, sans-serif, ${CJK_SANS}`,
  "Times New Roman": `'Times New Roman', Times, serif, ${CJK_SERIF}`,
  "Courier New": `'Courier New', monospace, ${CJK_SANS}`,
  Noteworthy: `Noteworthy, 'Comic Neue', 'Comic Sans MS', cursive, ${CJK_SANS}`,
  "Comic Sans MS": `'Comic Sans MS', 'Comic Sans', 'Comic Neue', cursive, ${CJK_SANS}`,
};
export const TEXT_SIZES = [10, 12, 14, 16, 18, 22, 28, 36, 48, 64, 96];
// Text sizes the core takes (imports.rs TextBox::valid), and how the size field shows one.
export const clampSize = (n) => Math.min(4000, Math.max(0.5, n));
export const sizeText = (n) => String(Math.round(n * 100) / 100);
export const textAdvance = (size) => size + Math.max(8, size * 0.2 + 8);
// From one baseline to the next: the box's own line height (text from a PDF), else the usual.
export const lineAdvance = (style) => (style.lineHeight > 0 ? style.lineHeight : textAdvance(style.size));
// Any font: the five built in by their stacks, others (imported, from a PDF) by name first.
export const cssFont = (style, size = style.size) => `${style.italic ? "italic " : ""}${style.bold ? 700 : 400} ${size}px ${FONT_STACKS[style.font] || (style.font ? fontStack(style.font) : FONT_STACKS.Helvetica)}`;
// What the font menu calls a font: a PDF's font by its own name.
export const fontLabel = (font) => (pdfFontHash(font) ? `${font.replace(/ pdf[0-9a-f]{8}$/, "")} (PDF)` : font);

export function textBoxSize(text, style, measure = null) {
  const widthOf = measure || (() => {
    const context = document.createElement("canvas").getContext("2d");
    context.font = cssFont(style);
    return (line) => context.measureText(line).width;
  })();
  const lines = text.split("\n");
  // With a line height the last line needs its size and descent below its baseline, not a
  // whole advance.
  const height = style.lineHeight > 0 ? 8 + style.size * 1.3 + (lines.length - 1) * style.lineHeight : 8 + lines.length * textAdvance(style.size);
  return [Math.ceil(Math.max(...lines.map((l) => widthOf(l))) + 12), Math.ceil(height)];
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
      // Chinese has no spaces: a word may also break between its characters (wrapPieces).
      wrapPieces(word).forEach((piece, i) => {
        const next = !current ? piece : i ? current + piece : `${current} ${piece}`;
        if (current && widthOf(next) > width) { out.push(current); current = piece; }
        else current = next;
      });
    }
    return [...out, current].join("\n");
  }).join("\n");
}
// CJK characters, kana and full-width punctuation; a line may break before or after one, except
// before closing punctuation and after opening punctuation (basic kinsoku).
const CJK = /[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]|[\ud840-\ud87f][\udc00-\udfff]/u;
const NO_START = "，。、．,.!?！？：；:;）)」』》〉】〕｝’”…‥・ー々〜%％";
const NO_END = "（(「『《〈【〔｛‘“";
export function wrapPieces(word) {
  const chars = [...word], pieces = [];
  let piece = "";
  chars.forEach((c, i) => {
    const before = chars[i - 1];
    if (piece && (CJK.test(c) || CJK.test(before)) && !NO_START.includes(c) && !NO_END.includes(before)) { pieces.push(piece); piece = ""; }
    piece += c;
  });
  return piece ? [...pieces, piece] : pieces.length ? pieces : [""];
}

export const hexColor = (rgba) => "#" + rgba.slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
export const rgbaOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1);

// `math`: the text is LaTeX, typeset by KaTeX (math-boxes.js); sent only when set.
// `line_height`: the box's own spacing (text from a PDF), sent only when it has one.
// `spans`: parts in their own style (rich-spans.js), sent only when they cover the text.
export const textPayload = (value, style, spans = []) => {
  const parts = spansFor(value, spans);
  return { text: value, font_size: style.size, rgba: style.rgba, bold: style.bold, italic: style.italic, font: style.font, ...(style.math ? { math: true } : {}), ...(style.lineHeight > 0 ? { line_height: style.lineHeight } : {}), ...(parts.length ? { spans: parts } : {}) };
};
// The fields a span can override that changed for the whole box (the format bar).
export const changedKeys = (before, after) => ["bold", "italic", "font", "rgba"].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
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
  onTrace = null,
  // The open note's id: its text boxes share one Chinese input mode (docs/CHINESE-INPUT.md §5.1).
  noteKey = () => "",
  $ = (id) => document.getElementById(id),
  doc = document,
}) {
  let textDefaults = { font: "Helvetica", size: 16, bold: false, italic: false, rgba: [0.12, 0.14, 0.16, 1] };
  try { textDefaults = { ...textDefaults, ...JSON.parse(localStorage.getItem("notecomplete-text-style") || "{}") }; } catch { /* Optional. */ }
  const styleOf = (run) => run ? { font: run.font_family || "Helvetica", size: run.font_size, bold: run.bold, italic: run.italic, rgba: run.rgba, ...(run.line_height > 0 ? { lineHeight: run.line_height } : {}) } : { ...textDefaults };
  // A typed box's style, with its math flag (kept by the box, not by its runs).
  // A typed box's style (the one most of its characters have) and the parts in another.
  const boxStyleOf = (existing) => ({ ...(existing ? fromRuns(existing.runs, styleOf).base : styleOf(null)), ...(existing?.math ? { math: true } : {}) });
  const boxSpansOf = (existing) => (existing ? fromRuns(existing.runs, styleOf).spans : []);
  // The size a box needs: typeset math is measured, other text from its lines.
  const boxSize = (value, style) => (style.math ? mathSize(value, style).catch(() => textBoxSize(value, style)) : Promise.resolve(textBoxSize(value, style)));

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
  const zhKey = () => `note-${noteKey() || "none"}`;
  const currentZhMode = () => textEditor?.ime?.mode || noteMode(fieldMode(zhKey())) || "off";
  // 中: Chinese input for the box being typed (click cycles the mode; right-click: the mode menu).
  const zhToggle = zhButton(() => textEditor?.area, { doc });
  zhToggle.id = "zhModeToggle";
  const zhSubOptions = $("zhTextSubOptions");
  if (zhSubOptions && zhSubOptions.parentElement === textFormatBar) {
    textFormatBar.insertBefore(zhToggle, zhSubOptions);
  } else if ($("textSwatches") && $("textSwatches").parentElement === textFormatBar) {
    textFormatBar.insertBefore(zhToggle, $("textSwatches"));
  } else {
    textFormatBar.append(zhToggle);
  }
  function syncZhSubOptions() {
    const mode = currentZhMode();
    const isZh = mode !== "off";
    zhToggle.textContent = mode === "pinyin" ? "ā" : "中";
    zhToggle.setAttribute("aria-pressed", String(isZh));
    zhToggle.dataset.zhMode = mode;
    // 拼 stays for a box with Chinese in it (to read it), 笔 only while typing Chinese.
    if (zhSubOptions) zhSubOptions.hidden = !isZh && !/\p{Script=Han}/u.test(textEditor?.area?.value || "");
    if ($("zhTraceToggle")) $("zhTraceToggle").hidden = !isZh;
  }
  zhToggle.addEventListener("click", () => {
    if (!textEditor?.area) {
      const cur = currentZhMode();
      const next = cur === "off" ? "hanzi" : cur === "hanzi" ? "pinyin" : "off";
      setFieldMode(zhKey(), next);
      setNoteMode(next);
    }
    syncZhSubOptions();
    if (placing) placeTextFormat();
  });
  if ($("zhTraceToggle")) {
    $("zhTraceToggle").onclick = () => {
      const area = textEditor?.area;
      const sel = area && area.selectionStart !== area.selectionEnd ? area.value.slice(area.selectionStart, area.selectionEnd) : area?.value || "";
      const han = (sel.match(/\p{Script=Han}/gu) || []).join("") || "你好";
      onTrace?.(han);
    };
  }
  syncZhSubOptions();

  const textFormatDocked = () => doc.body.classList.contains("text-format-docked");

  function syncTextFormatControls(style) {
    fontOption(style.font);
    $("textFont").value = style.font || "Helvetica";
    $("textSize").value = sizeText(style.size);
    $("textBold").setAttribute("aria-pressed", String(!!style.bold));
    $("textItalic").setAttribute("aria-pressed", String(!!style.italic));
    $("textMath").setAttribute("aria-pressed", String(!!style.math));
    const hex = hexColor(style.rgba);
    $("textColor").value = hex;
    for (const b of $("textSwatches").children) b.setAttribute("aria-checked", String(b.dataset.color.toLowerCase() === hex));
    syncZhSubOptions();
  }

  // `box`: the element being typed in (its size follows the text), else the selected box's
  // bounds in page units. The bar never covers it: above it, else below it, else (no room
  // either way in the window) in the tool bar's settings row for as long as it would.
  let placing = null;
  function showTextFormat(p, bounds, style, apply, box = null) {
    textFormatTarget = { p, style, apply };
    syncTextFormatControls(style);
    placing = { p, bounds, box };
    placeTextFormat();
  }
  function placeTextFormat() {
    const bar = textFormatBar, at = placing;
    if (!at || !textFormatTarget) return;
    const dock = () => {
      if (bar.parentElement !== $("toolOptions")) $("toolOptions").append(bar);
      bar.classList.remove("below", "placed");
      bar.style.left = bar.style.top = "";
      bar.hidden = false;
      toolOptions();
    };
    // Docked (View → Text format bar in the tool bar): in the tool bar's settings row, never a
    // bar of its own over the page.
    if (textFormatDocked()) return dock();
    const { p, bounds, box } = at;
    const page = p.el.getBoundingClientRect();
    const scale = page.width / p.size[0];
    const r = box?.isConnected ? box.getBoundingClientRect() : {
      left: page.left + bounds[0] * scale, top: page.top + bounds[1] * scale,
      right: page.left + (bounds[0] + bounds[2]) * scale, bottom: page.top + (bounds[1] + bounds[3]) * scale,
    };
    const wasDocked = bar.parentElement === $("toolOptions");
    if (bar.parentElement !== p.el) p.el.append(bar);
    bar.classList.add("placed");
    bar.classList.remove("below");
    bar.hidden = false;
    if (wasDocked) toolOptions();
    const view = $("viewport").getBoundingClientRect(), gapAbove = 24, gapBelow = 10;
    // Across first: kept inside the window (a box near its right edge, or a phone, moves the
    // bar left; it wraps onto a second row when even that is not enough, style.css). Its
    // height is measured where it will be, since wrapping changes it.
    bar.style.top = `${r.top - page.top}px`;
    bar.style.left = `${r.left - page.left}px`;
    const width = bar.getBoundingClientRect().width;
    const left = Math.max(view.left + 8, Math.min(r.left, view.right - 8 - width));
    bar.style.left = `${left - page.left}px`;
    const height = bar.getBoundingClientRect().height;
    const above = r.top - gapAbove - height, below = r.bottom + gapBelow;
    let top;
    if (above >= view.top + 4) top = above;
    else if (below + height <= view.bottom - 4) { top = below; bar.classList.add("below"); }
    else return dock();
    bar.style.top = `${top - page.top}px`;
  }

  function hideTextFormat(quiet = false) {
    textFormatTarget = null;
    placing = null;
    const docked = textFormatBar.parentElement === $("toolOptions");
    textFormatBar.hidden = true;
    doc.body.append(textFormatBar);
    if (!quiet && docked) toolOptions();
  }

  function setTextFormatDocked(on) {
    doc.body.classList.toggle("text-format-docked", on);
    $("textFormatDock").setAttribute("aria-checked", String(on));
    try { localStorage.setItem("notecomplete-text-format-docked", on ? "1" : "0"); } catch { /* Optional. */ }
    // A bar showing now moves to its new place.
    const t = textFormatTarget;
    if (t) {
      hideTextFormat();
      if (textEditor) showTextFormat(t.p, [textEditor.bx, textEditor.by, 0, 0], t.style, t.apply, textEditor.area);
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
    // Math and a PDF's line spacing are the box's own: new boxes start as plain text, with
    // the usual spacing, and in the last font that is not one PDF's subset.
    const { math: _math, lineHeight: _lineHeight, ...defaults } = t.style;
    if (pdfFontHash(defaults.font)) defaults.font = textDefaults.font;
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
  // The font menu: the five built in, the fonts imported on this device, a box's own font
  // (from a PDF, or imported elsewhere), and Import font… at the end.
  const IMPORT = "__import__";
  function fontOption(font, label = fontLabel(font)) {
    const select = $("textFont");
    if (!select || !font || [...select.options].some((o) => o.value === font)) return;
    const option = new Option(label, font);
    const importer = [...select.options].find((o) => o.value === IMPORT);
    select.add(option, importer || null);
  }
  if ($("textFont")) {
    const choose = new Option("Import font…", IMPORT);
    $("textFont").add(choose);
    loadImportedFonts().then((families) => families.forEach((f) => fontOption(f))).catch(() => { /* No storage. */ });
  }
  let lastFont = "Helvetica";
  $("textFont").onfocus = () => { lastFont = $("textFont").value; };
  $("textFont").onchange = () => {
    if ($("textFont").value !== IMPORT) return changeTextStyle({ font: $("textFont").value });
    $("textFont").value = textFormatTarget?.style.font || lastFont;
    const input = Object.assign(doc.createElement("input"), { type: "file", accept: ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const family = await importFont(file);
        fontOption(family);
        status(`Font ${family} imported: it is in the font menu on this device.`);
        if (textFormatTarget) changeTextStyle({ font: family });
        else $("textFont").value = family;
      } catch (e) {
        status(e.message, true);
      }
    };
    input.click();
  };
  // The size: typed (any number above 0; Enter or leaving the field applies it), or a step
  // with the arrows inside the field or ↑ ↓ in it: 1 at a time, half a unit under 2.
  const typedSize = () => {
    const n = Number(String($("textSize").value).replace(",", ".").trim());
    if (Number.isFinite(n) && n > 0) changeTextStyle({ size: clampSize(n) });
    else if (textFormatTarget) $("textSize").value = sizeText(textFormatTarget.style.size);
  };
  const stepSize = (dir) => {
    const now = textFormatTarget?.style.size;
    if (!now) return;
    const step = now < 2 || (now === 2 && dir < 0) ? 0.5 : 1;
    changeTextStyle({ size: clampSize(Math.round((now + dir * step) * 2) / 2) });
  };
  $("textSize").onchange = typedSize;
  $("textSize").onkeydown = (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); stepSize(e.key === "ArrowUp" ? 1 : -1); }
    else if (e.key === "Enter") { e.preventDefault(); typedSize(); textEditor?.area.focus(); }
  };
  if ($("textSizeUp")) $("textSizeUp").onclick = () => stepSize(1);
  if ($("textSizeDown")) $("textSizeDown").onclick = () => stepSize(-1);
  $("textColor").oninput = () => changeTextStyle({ rgba: rgbaOf($("textColor").value) });
  $("textSwatches").onclick = (e) => { const c = e.target.closest("[data-color]")?.dataset.color; if (c) changeTextStyle({ rgba: rgbaOf(c) }); };
  textFormatBar.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape" && textEditor) { e.preventDefault(); textEditor.area.focus(); }
  });

  // With Select: the bar follows a selected typed text box and restyles it at once.
  // With Text: the bar is docked in tool options so defaults and Chinese/ruby toggles are ready.
  function syncFormat({ quiet = false } = {}) {
    if (textEditor) return;
    const panels = getPanels();
    const item = selection.item, p = item && panels[item.page];
    const existing = getTool() === "select" && item?.kind === "text" && (p?.view?.texts || []).find((t) => t.id === item.id);
    if (existing) {
      const style = boxStyleOf(existing);
      return showTextFormat(p, existing.bounds, style, async (next) => {
        const value = boxText(existing), [w, h] = await boxSize(value, next);
        // A change from the bar is for the whole box: parts give up what changed.
        const spans = withoutKeys(boxSpansOf(existing), changedKeys(style, next));
        action("editText", { page: p.index, itemId: existing.id, text: textPayload(value, next, spans), width: w, height: h });
      });
    }
    if (getTool() === "text") {
      textFormatTarget = { p: null, style: textDefaults, apply: () => {} };
      placing = null;
      syncTextFormatControls(textDefaults);
      if (textFormatBar.parentElement !== $("toolOptions")) $("toolOptions")?.append(textFormatBar);
      textFormatBar.classList.remove("below", "placed");
      textFormatBar.style.left = textFormatBar.style.top = "";
      textFormatBar.hidden = false;
      if (!quiet) toolOptions();
      return;
    }
    hideTextFormat(quiet);
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
    const box = (textEditor.field || textEditor.area).getBoundingClientRect(), bottom = Math.min(vv.offsetTop + vv.height, mathKeys.open ? mathKeys.top : Infinity) - 16;
    const by = Math.min(box.bottom - bottom, box.top - vv.offsetTop - 56);
    if (by > 0) $("viewport").scrollTop += by;
    const right = vv.offsetLeft + vv.width - 16;
    const dx = Math.min(box.right - right, box.left - vv.offsetLeft - 16);
    if (dx > 0) $("viewport").scrollLeft += dx;
  }
  if (typeof window !== "undefined") window.visualViewport?.addEventListener("resize", keepTextVisible);

  // `after`: called once the box is finished or thrown away (a double-click's way back).
  async function open(p, [x, y], known = null, { after = null } = {}) {
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
        // Where it is now: moved since it was typed, its bounds are where it was typed.
        if (item.adjustment && item.bounds) try {
          const [mx, my] = mapPoint(itemMatrix(item), [item.bounds[0], item.bounds[1]]);
          existing = { ...existing, bounds: [mx, my, existing.bounds[2], existing.bounds[3]] };
        } catch { /* As typed. */ }
      }
    } catch { /* Nothing under the pointer. */ }
    if (!existing && (!layer?.visible || layer.locked)) return status("Select a visible, unlocked layer.", true);
    const style = existing ? boxStyleOf(existing) : styleOf(null);
    let [bx, by] = existing ? existing.bounds : [x - 5, y - 8 - style.size * 0.8];
    const origBx = bx, origBy = by;
    const area = doc.createElement("textarea");
    area.className = "text-editor";
    area.wrap = "off";
    area.placeholder = "Type text…";
    area.value = existing ? boxText(existing) : "";
    area.setAttribute("aria-label", "Text box");
    const fit = () => {
      const s = p.el.clientWidth / p.size[0], [w, h] = textBoxSize(area.value || " ", style);
      const minW = area.value ? Math.max(56, Math.ceil(style.size * 1.5)) : Math.max(112, Math.ceil(style.size * 5.6));
      const lightInk = isLightInk(style.rgba);
      area.classList.toggle("light-ink", lightInk);
      Object.assign(area.style, {
        left: `${(bx / p.size[0]) * 100}%`, top: `${(by / p.size[1]) * 100}%`,
        width: `${Math.max(w, minW) * s}px`, height: `${h * s}px`,
        font: `${cssFont(style, style.size * s).replace(/px /, `px/${lineAdvance(style) * s}px `)}`,
        padding: `${Math.max(0, 8 + 0.2 * style.size - (lineAdvance(style) - style.size) / 2) * s}px 0 0 ${5 * s}px`,
        color: `rgba(${style.rgba.slice(0, 3).map((c) => Math.round(c * 255)).join(",")},${style.rgba[3]})`,
      });
    };
    // The ⋮⋮ grip at the top-left corner lets the box be dragged into place while typing.
    const drag = Object.assign(doc.createElement("button"), { type: "button", className: "text-drag", textContent: "⋮⋮", title: "Drag to move text box" });
    drag.setAttribute("aria-label", "Move text box");
    drag.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      down.stopPropagation();
      const s = p.el.clientWidth / p.size[0] || 1;
      const startX = down.clientX, startY = down.clientY, startBx = bx, startBy = by;
      const move = (ev) => {
        bx = Math.max(0, Math.min(p.size[0] - 24, startBx + (ev.clientX - startX) / s));
        by = Math.max(0, Math.min(p.size[1] - 16, startBy + (ev.clientY - startY) / s));
        if (textEditor?.area === area) { textEditor.bx = bx; textEditor.by = by; }
        if (placing) placing.bounds = [bx, by, 0, 0];
        refit();
      };
      const done = () => {
        globalThis.removeEventListener("pointermove", move);
        globalThis.removeEventListener("pointerup", done);
        globalThis.removeEventListener("pointercancel", done);
        (textEditor?.field || area).focus({ preventScroll: true });
      };
      globalThis.addEventListener("pointermove", move);
      globalThis.addEventListener("pointerup", done);
      globalThis.addEventListener("pointercancel", done);
    });
    // The × at the box's top-right corner discards the typing.
    const discard = Object.assign(doc.createElement("button"), { type: "button", className: "text-discard", textContent: "×", title: "Discard (Shift + Esc)" });
    discard.setAttribute("aria-label", "Discard this text");
    discard.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
    discard.onclick = (e) => { e.stopPropagation(); close(); };
    const placeDiscard = () => {
      Object.assign(drag.style, { left: area.style.left, top: area.style.top });
      Object.assign(discard.style, { left: `calc(${area.style.left} + ${area.style.width})`, top: area.style.top });
    };
    // Live Pinyin-on-top preview under plain-text boxes whenever Pinyin over characters is on.
    const rubyPreview = Object.assign(doc.createElement("div"), { className: "text-ruby-preview", hidden: true });
    rubyPreview.setAttribute("aria-hidden", "true");
    const showRuby = () => {
      const value = area.value;
      const show = !style.math && rubyOn() && HAN_SCRIPT.test(value);
      rubyPreview.hidden = !show;
      if (!show) { rubyPreview.textContent = ""; return; }
      const s = p.el.clientWidth / p.size[0];
      rubyPreview.classList.toggle("light-ink", isLightInk(style.rgba));
      Object.assign(rubyPreview.style, {
        left: area.style.left,
        top: `calc(${area.style.top} + ${area.style.height} + 6px)`,
        fontSize: `${Math.max(12, style.size * s)}px`,
        color: area.style.color,
      });
      rubyPreview.textContent = value;
      rubyElement(rubyPreview).catch(() => {});
    };
    const onRubyChange = () => { if (textEditor?.area === area) { showRuby(); placeTextFormat(); } };
    globalThis.addEventListener?.("zh-ruby-refresh", onRubyChange);
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
      const lightInk = isLightInk(style.rgba);
      field.classList.toggle("light-ink", lightInk);
      styleField(field, { ...style, size: style.size * s });
      Object.assign(field.style, { left: area.style.left, top: area.style.top, minWidth: `${Math.max(72, 56 * s)}px`, minHeight: area.style.height });
      discard.style.left = `calc(${area.style.left} + ${Math.max(field.offsetWidth, area.offsetWidth)}px)`;
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
      mathPreview.classList.toggle("light-ink", isLightInk(style.rgba));
      Object.assign(mathPreview.style, { left: area.style.left, top: `calc(${area.style.top} + ${area.style.height} + 6px)` });
      previewMath(mathPreview, area.value, { ...style, size: style.size * s }).catch(() => { mathPreview.textContent = "Math needs KaTeX, which could not load."; });
    };
    const refit = () => { fit(); placeDiscard(); showRuby(); showMath(); placeTextFormat(); if (textEditor?.area === area) keepTextVisible(); };
    refit();
    area.oninput = refit;
    hideText(p, existing?.id);
    p.el.append(area, drag, discard, rubyPreview, mathPreview);
    selection.clear();
    textEditor = { p, area, drag, discard, rubyPreview, mathPreview, existing, style, initial: { ...style }, spans: boxSpansOf(existing), initialText: area.value, bx, by, origBx, origBy, layer: activeLayer, fit: refit, after, cleanup: () => globalThis.removeEventListener?.("zh-ruby-refresh", onRubyChange) };
    showTextFormat(p, [bx, by, 0, 0], style, () => { refit(); area.focus(); }, area);
    // Chinese input (its keys come first, in the capture phase: Esc with pinyin typed only clears it).
    textEditor.ime = attachIme(area, { kind: "pagebox", getMode: () => noteMode(fieldMode(zhKey())), setMode: (m) => { setFieldMode(zhKey(), m); setNoteMode(m); syncZhSubOptions(); placeTextFormat(); } });
    textEditor.ime.addButton(zhToggle);
    syncZhSubOptions();
    area.addEventListener("keydown", (e) => {
      // A system input method composing: its Esc and Enter are its own.
      if (e.isComposing || e.keyCode === 229) return e.stopPropagation();
      if (e.key === "Tab") {
        e.preventDefault();
        const start = area.selectionStart ?? area.value.length, end = area.selectionEnd ?? start;
        if (e.shiftKey) {
          const lineStart = area.value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
          const match = area.value.slice(lineStart).match(/^ {1,2}/);
          if (match) {
            area.setRangeText("", lineStart, lineStart + match[0].length, "end");
            const n = match[0].length;
            area.setSelectionRange(Math.max(lineStart, start - n), Math.max(lineStart, end - n));
          }
        } else {
          area.setRangeText("  ", start, end, "end");
        }
        refit();
      } else if (e.key === "Escape") { e.preventDefault(); if (e.shiftKey) close(); else commit(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { commit(); return; }
      // Typing stays in the box: no tool or study shortcuts while editing.
      e.stopPropagation();
    });
    // Leaving the box finishes it, unless the focus went to its format bar (or came back,
    // as when the page is redrawn under it: renderPage).
    area.addEventListener("blur", () => setTimeout(() => {
      if (textEditor?.area !== area || doc.activeElement === area || (textEditor.field && doc.activeElement === textEditor.field) || textFormatBar.contains(doc.activeElement) || Date.now() - textFormatPressed < 1000 || Date.now() - imeMenuPressedAt() < 1000) return;
      commit();
    }, 0));
    requestAnimationFrame(() => { area.focus(); unprime(); keepTextVisible(); });
    status(existing ? "Editing text. Esc, Ctrl+Enter or a click outside finishes; Shift+Esc or × discards." : "Type your text. Esc, Ctrl+Enter or a click outside finishes; Shift+Esc or × discards.");
  }

  function endText() {
    const t = textEditor;
    t?.ime?.detach();
    t?.cleanup?.();
    textEditor = null;
    t?.drag?.remove();
    t?.discard.remove();
    t?.rubyPreview?.remove();
    t?.mathPreview.remove();
    mathKeys.detach();
    $("pages").style.marginBottom = "";
    hideTextFormat();
    if (t?.after) setTimeout(t.after, 0);
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
    // Parts keep their style through the typing; a style changed from the bar is the box's.
    const spans = remapSpans(t.initialText, value, withoutKeys(t.spans, changedKeys(t.initial, t.style)));
    const text = textPayload(value, t.style, spans);
    const same = t.existing && value === boxText(t.existing) && JSON.stringify(t.style) === JSON.stringify(t.initial);
    const dx = t.existing ? t.bx - t.origBx : 0, dy = t.existing ? t.by - t.origBy : 0;
    const moved = t.existing && (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25);
    if ((same && !moved) || (!t.existing && !value.trim())) return close();
    const hold = holdText();
    if (t.existing && !value.trim()) return action("remove", { page: t.p.index, itemId: t.existing.id }, hold);
    if (t.existing) {
      if (same && moved) return action("adjust", { page: t.p.index, itemId: t.existing.id, adjustment: { translation: [dx, dy], scale: [1, 1], rotation: 0 } }, hold);
      const [w, h] = await boxSize(value || " ", t.style);
      if (!moved) return action("editText", { page: t.p.index, itemId: t.existing.id, text, width: w, height: h }, hold);
      await action("editText", { page: t.p.index, itemId: t.existing.id, text, width: w, height: h });
      return action("adjust", { page: t.p.index, itemId: t.existing.id, adjustment: { translation: [dx, dy], scale: [1, 1], rotation: 0, joined: true } }, hold);
    }
    const [w, h] = await boxSize(value || " ", t.style);
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

  // Text pasted onto a page (from another app): a text box at `at` in the last style used,
  // wrapped to a readable width, kept inside the page and selected so it can be dragged.
  async function placeText(p, at, text) {
    const currentDoc = getDoc(), activeLayer = getActiveLayer();
    const layer = currentDoc?.layers.find((l) => l.id === activeLayer);
    if (!currentDoc || !p?.view || !text.trim() || isEditing() || isBusy()) return;
    if (!layer?.visible || layer.locked) return status("Select a visible, unlocked layer first.", true);
    const style = { ...textDefaults }, wrapped = wrapText(text.slice(0, 20000), style, p.size[0] * 0.6 - 12);
    const [w, h] = textBoxSize(wrapped, style);
    const x = Math.min(Math.max(0, at[0] - 5), Math.max(0, p.size[0] - w)), y = Math.min(Math.max(0, at[1] - 8 - style.size * 0.8), Math.max(0, p.size[1] - h));
    await action("image", { page: p.index, image: { base64: "", mime: "", bounds: [x, y, w, h], layer: activeLayer, text: textPayload(wrapped, style) } });
    doc.querySelector('#toolbar [data-tool="select"]')?.click();
    await selection.selectId(p.index, `image:${getDoc().edit_count - 1}`);
    status("Pasted as a text box: drag it into place, double-click to edit.");
  }

  function isTypingOn(p) {
    return textEditor?.p === p && (doc.activeElement === textEditor.area || (textEditor.field && doc.activeElement === textEditor.field));
  }

  // Typed text is not lost to a redraw (another screen's edit, a zoom): finished text
  // waiting for its own render stays, and so does the box being typed in.
  function restoreOnRender(p, shows, typing) {
    keepHeld(p, shows, false);
    if (textEditor?.p === p) {
      p.el.append(textEditor.area, textEditor.drag, textEditor.discard, textEditor.rubyPreview, textEditor.mathPreview, ...(textEditor.field ? [textEditor.field] : []));
      hideText(p, textEditor.existing?.id);
      textEditor.fit();
      if (typing) (textEditor.field || textEditor.area).focus({ preventScroll: true });
    }
    if (textFormatTarget?.p === p && !textFormatDocked()) p.el.append(textFormatBar);
  }

  // A typed box's text replaced (Chinese conversion, chinese/zh-menu.js), its style and its
  // styled parts kept; one undo brings it back.
  // The box being typed under client (x, y): its text, the UTF-16 index of the character there
  // (lines as typed, no wrapping) and how to put other text in a range. Null elsewhere.
  let measureContext = null;
  function typedAt(clientX, clientY) {
    const area = textEditor?.area;
    if (!area || textEditor.field) return null;
    const r = area.getBoundingClientRect(), cs = getComputedStyle(area), px = (v) => parseFloat(v) || 0;
    const lineHeight = px(cs.lineHeight) || px(cs.fontSize) * 1.2;
    const x = clientX - r.left - px(cs.paddingLeft) - px(cs.borderLeftWidth) + area.scrollLeft;
    const y = clientY - r.top - px(cs.paddingTop) - px(cs.borderTopWidth) + area.scrollTop;
    const lines = area.value.split("\n"), line = Math.floor(y / lineHeight);
    if (x < 0 || line < 0 || line >= lines.length) return null;
    measureContext ||= doc.createElement("canvas").getContext("2d");
    measureContext.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let index = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0), left = 0;
    for (const ch of lines[line]) {
      const w = measureContext.measureText(ch).width;
      if (x < left + w) {
        const value = area.value;
        return { text: value, index, area, replace: (start, end, from, to) => {
          if (textEditor?.area !== area || area.value.slice(start, end) !== from) throw new Error("The text changed; look it up again.");
          area.focus();
          area.setRangeText(to, start, end, "end");
          area.dispatchEvent(new Event("input", { bubbles: true }));
        } };
      }
      left += w;
      index += ch.length;
    }
    return null;
  }
  async function replaceText(p, id, value) {
    const existing = (p?.view?.texts || []).find((t) => String(t.id) === String(id));
    if (!existing) throw new Error("This text box cannot be changed here.");
    const style = boxStyleOf(existing), [w, h] = await boxSize(value, style);
    return action("editText", { page: p.index, itemId: existing.id, text: textPayload(value, style, remapSpans(boxText(existing), value, boxSpansOf(existing))), width: w, height: h });
  }

  return {
    get active() { return Boolean(textEditor); },
    replaceText,
    typedAt,
    open,
    typeAt,
    commit,
    close,
    syncFormat,
    isTypingOn,
    restoreOnRender,
    answerToTextBox,
    placeText,
    mathKeys,
  };
}
