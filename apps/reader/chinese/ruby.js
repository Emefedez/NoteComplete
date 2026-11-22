// Pinyin over characters (docs/CHINESE-INPUT.md §6.4): a display layer, never stored in the
// text. Readings come from the dictionary (client.js annotate) at display time, with readings
// chosen for one place kept in the note (`chinese.readings`). On: View → "Pinyin over
// characters", saved in the note (`chinese.ruby`) and remembered as the default for others.
//   rubyElement(root)  Markdown preview, HTML views, cards, chat: <ruby class="zh-auto">字<rt>zì</rt></ruby>
//   rubySvg(svg)       page text boxes: a <g class="zh-ruby"> over each line, placed from the
//                      browser's own layout (getExtentOfChar), also on a detached SVG for exports
import { HAN, chineseFontReady } from "./fonts.js";
import { marksToNumbers } from "./pinyin.js";

const SVG = "http://www.w3.org/2000/svg";
const KEY = (k) => `notecomplete-zh-${k}`;
// Global choices, in settings.js's format (JSON values under notecomplete-zh-<name>).
export const RUBY_DEFAULTS = Object.freeze({ ruby: false, rubyFormat: "marks", rubyLevel: 0, toneColours: true });
export function rubySettings(patch = null) {
  const ls = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
  if (patch && ls) {
    for (const [k, v] of Object.entries(patch)) if (k in RUBY_DEFAULTS) try { ls.setItem(KEY(k), JSON.stringify(v)); } catch { /* Full or blocked. */ }
    refreshRuby();
  }
  const out = { ...RUBY_DEFAULTS };
  if (ls) for (const k of Object.keys(RUBY_DEFAULTS)) try { const v = ls.getItem(KEY(k)); if (v != null) out[k] = JSON.parse(v); } catch { /* Default. */ }
  return out;
}

// ---- The note's own settings ({mode, script, ruby, rubyMinLevel, readings}, §9) ----
let host = {};
let note = {};
export let sawHan = false;
// app.js: getNote() / setNote(chinese) through the core, changed() marks the note unsaved,
// roots() the page renders to redraw the layer on.
export function configureRuby(options) { host = { ...host, ...options }; }
export async function noteOpened() {
  note = (await host.getNote?.().catch?.(() => null)) || {};
  sawHan = false;
  refreshRuby();
}
export const noteChinese = () => structuredClone(note);
// Merges `patch` into the note's settings (null or "" removes a key) and saves them in the note.
export async function setNoteChinese(patch) {
  const next = { ...note, ...patch };
  for (const [k, v] of Object.entries(next)) if (v == null || v === "" || v === 0 || (Array.isArray(v) && !v.length)) delete next[k];
  note = next;
  await host.setNote?.(next);
  host.changed?.();
  if (["ruby", "rubyMinLevel", "readings", "script"].some((k) => k in patch)) refreshRuby();
}

// The input mode kept in the note (`chinese.mode`), for ime.js: the note's, else `fallback`
// (the device's remembered mode). Saved in the note when on, or when the note already has one.
export const noteMode = (fallback) => note.mode || fallback;
export function setNoteMode(mode) {
  if (host.getNote && (mode !== "off" || note.mode) && mode !== note.mode) setNoteChinese({ mode }).catch(() => {});
}
// The effective state: the note's own choice, else the global one.
export const rubyOn = () => (note.ruby === "on" ? true : note.ruby === "off" ? false : !!rubySettings().ruby);
export function setRuby(on) {
  rubySettings({ ruby: on });
  // Kept in a note when it has Chinese or already had a note-specific choice, so
  // switching notes does not get stuck in "off".
  if (sawHan || note.ruby) setNoteChinese({ ruby: on ? "on" : "off" }).catch(() => {});
  else refreshRuby();
}
// The Export dialog's "Pinyin over Chinese": the view's state unless changed there.
let exportChoice = null;
export const rubyForExport = () => exportChoice ?? rubyOn();
export const chooseExportRuby = (on) => { exportChoice = on; };

// ---- Pure parts ----
// Tone 1–5 of a marked syllable.
export function toneOf(syllable) {
  const d = /([1-4])$/.exec(marksToNumbers(syllable));
  return d ? Number(d[1]) : 5;
}
export const rubyLabel = (syllable, format = "marks") => (format === "numbers" ? (/[1-4]$/.test(marksToNumbers(syllable)) ? marksToNumbers(syllable) : `${syllable}5`) : syllable);
// The characters of `text` that get pinyin: [{index (UTF-16), char, pinyin}]. Words at a level
// below `minLevel` (HSK 1…) are left bare; words of no level always get it. `overrides`:
// index → pinyin chosen for that place.
export function rubyChars(text, annotations, { minLevel = 0, overrides = null } = {}) {
  const out = [];
  for (const a of annotations || []) {
    if (minLevel > 0 && a.level > 0 && a.level < minLevel) continue;
    let index = a.start;
    [...(a.text ?? text.slice(a.start, a.end))].forEach((char, k) => {
      const pinyin = overrides?.get(index) || a.pinyin?.[k];
      if (pinyin && HAN.test(char)) out.push({ index, char, pinyin });
      index += char.length;
    });
  }
  return out;
}
// `text` as plain strings and {char, pinyin} for building nodes.
export function rubySegments(text, chars) {
  const out = [];
  let at = 0;
  for (const c of chars) {
    if (c.index < at) continue;
    if (c.index > at) out.push(text.slice(at, c.index));
    out.push({ char: c.char, pinyin: c.pinyin });
    at = c.index + c.char.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
export const TONE_COLOURS = ["", "#e53935", "#ef8a00", "#2e9d3a", "#1f6fd6", "#8a8a8a"];

// ---- Readings ----
let client = null;
const cache = new Map();
const loadClient = () => (client ||= import("./client.js").then((m) => m.chinese()).catch(() => { client = null; return null; }));
const script = () => note.script || (() => { try { return JSON.parse(localStorage.getItem(KEY("script"))) || "simplified"; } catch { return "simplified"; } })();
// client.js annotate(), remembered per text; [] where there is no Chinese or no dictionary.
export function annotate(text) {
  if (!HAN.test(text)) return Promise.resolve([]);
  const key = `${script()}\u0000${text}`;
  if (!cache.has(key)) {
    cache.set(key, loadClient().then((c) => (c ? c.annotate(text, { script: script() }) : null)).then((r) => {
      if (!r) cache.delete(key);
      return r || [];
    }).catch(() => { cache.delete(key); return []; }));
    if (cache.size > 3000) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
const options = () => {
  const s = rubySettings();
  return { minLevel: note.rubyMinLevel || s.rubyLevel || 0, format: s.rubyFormat, colours: s.toneColours !== false };
};

// ---- HTML ----
const SKIP = "code, pre, rt, rp, ruby, .katex, .math, script, style, textarea, [contenteditable], .md-page";
const roots = new Set();
// Wraps the Chinese in `root` in ruby (re-run after each render); removes it when off.
export async function rubyElement(root) {
  if (!root?.querySelectorAll) return;
  for (const r of root.querySelectorAll("ruby.zh-auto")) r.replaceWith(r.firstChild?.textContent || "");
  root.normalize?.();
  const text = root.textContent || "";
  if (!HAN.test(text)) { roots.delete(root); return; }
  roots.add(root);
  sawHan = true;
  exportRow();
  chineseFontReady(text);
  if (!rubyOn()) return;
  const doc = root.ownerDocument, opts = options();
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (HAN.test(n.data) && !n.parentElement?.closest(SKIP)) nodes.push(n);
  for (const node of nodes) {
    const chars = rubyChars(node.data, await annotate(node.data), opts);
    if (!chars.length || !node.isConnected || !rubyOn()) continue;
    const fragment = doc.createDocumentFragment();
    for (const s of rubySegments(node.data, chars)) {
      if (typeof s === "string") { fragment.append(s); continue; }
      const ruby = doc.createElement("ruby"), rt = doc.createElement("rt");
      ruby.className = "zh-auto";
      rt.textContent = rubyLabel(s.pinyin, opts.format);
      if (opts.colours) rt.className = `zh-t${toneOf(s.pinyin)}`;
      ruby.append(s.char, rt);
      fragment.append(ruby);
    }
    node.replaceWith(fragment);
  }
}

// ---- Page text boxes (SVG) ----
const fontSizeAt = (text, index) => {
  let at = 0;
  for (const span of text.querySelectorAll("tspan")) {
    at += span.textContent.length;
    if (index < at) return { size: Number(span.getAttribute("font-size")) || 16, fill: span.getAttribute("fill") || "#000" };
  }
  return { size: Number(text.getAttribute("font-size")) || 16, fill: "#000" };
};
// Readings chosen for one place in a text box: item id → Map(index in its text → pinyin).
const overridesFor = (item) => {
  const list = (note.readings || []).filter((r) => r.item && r.item === item);
  return list.length ? new Map(list.map((r) => [r.index, r.pinyin])) : null;
};
const svgTokens = new WeakMap();
// Draws pinyin over the Chinese in `svg`'s text boxes (an on-screen page, or a detached copy
// for an export, measured in a hidden place in the document). Returns how many it placed.
export async function rubySvg(svg, { force = false } = {}) {
  const myToken = (svgTokens.get(svg) || 0) + 1;
  svgTokens.set(svg, myToken);
  for (const g of svg.querySelectorAll(".zh-ruby")) g.remove();
  const texts = [...svg.querySelectorAll("[data-item] text")].filter((t) => HAN.test(t.textContent));
  if (!texts.length) return 0;
  sawHan = true;
  exportRow();
  await chineseFontReady(texts.map((t) => t.textContent).join(""));
  if (svgTokens.get(svg) !== myToken) return 0;
  if (!force && !rubyOn()) return 0;
  const doc = svg.ownerDocument, opts = options();
  let placed = 0, parked = null, home = null;
  if (!svg.isConnected && doc.body) {
    home = [svg.parentNode, svg.nextSibling];
    parked = doc.createElement("div");
    parked.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
    parked.append(svg);
    doc.body.append(parked);
  }
  try {
    // Each line is a <text>; a reading chosen for a place counts in the box's text, lines
    // joined by line breaks.
    const lines = new Map();
    for (const text of texts) {
      const item = text.closest("[data-item]"), id = item.getAttribute("data-item");
      const all = [...item.querySelectorAll("text")].filter((t) => !t.closest(".zh-ruby"));
      const offset = all.slice(0, all.indexOf(text)).reduce((n, t) => n + t.textContent.length + 1, 0);
      lines.set(text, { id, offset });
    }
    for (const text of texts) {
      const { id, offset } = lines.get(text), content = text.textContent;
      const box = overridesFor(id);
      const overrides = box && new Map([...box].filter(([i]) => i >= offset).map(([i, p]) => [i - offset, p]));
      const chars = rubyChars(content, await annotate(content), { ...opts, overrides });
      if (svgTokens.get(svg) !== myToken) return placed;
      if (!chars.length || (!force && !rubyOn())) continue;
      const g = doc.createElementNS(SVG, "g");
      g.setAttribute("class", "zh-ruby");
      g.setAttribute("aria-hidden", "true");
      g.setAttribute("pointer-events", "none");
      text.after(g);
      for (const c of chars) {
        let extent;
        try { extent = text.getExtentOfChar(c.index); } catch { continue; }
        if (!extent?.width) continue;
        const { size, fill } = fontSizeAt(text, c.index);
        const label = doc.createElementNS(SVG, "text");
        label.setAttribute("x", String(extent.x + extent.width / 2));
        label.setAttribute("y", String(extent.y + size * 0.1));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", String(size * 0.45));
        label.setAttribute("font-family", "Arial, sans-serif");
        label.setAttribute("fill", opts.colours ? TONE_COLOURS[toneOf(c.pinyin)] : fill);
        label.textContent = rubyLabel(c.pinyin, opts.format);
        g.append(label);
        // Long syllables (zhuàng) over narrow characters are drawn narrower, not over the next.
        if (label.isConnected && label.getComputedTextLength() > extent.width * 0.96) {
          label.setAttribute("textLength", String(extent.width * 0.96));
          label.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }
        placed++;
      }
    }
  } finally {
    if (parked) {
      home[0] ? home[0].insertBefore(svg, home[1]) : svg.remove();
      parked.remove();
    }
  }
  return placed;
}

// ---- Redrawing and the controls ----
export function refreshRuby() {
  const on = rubyOn();
  const doc = globalThis.document;
  const toggle = doc?.getElementById?.("zhRubyToggle");
  if (toggle) toggle.setAttribute("aria-pressed", String(on));
  const viewToggle = doc?.getElementById?.("viewRubyToggle");
  if (viewToggle) viewToggle.setAttribute("aria-checked", String(on));
  exportChoice = null;
  exportRow();
  globalThis.dispatchEvent?.(new CustomEvent("zh-ruby-refresh", { detail: { on } }));
  for (const root of [...roots]) root.isConnected ? rubyElement(root) : roots.delete(root);
  for (const render of host.roots?.() || []) {
    const svg = render?.querySelector?.(":scope > svg") || render?.querySelector?.("svg");
    if (svg) rubySvg(svg).catch(() => {});
  }
}
function exportRow() {
  const doc = globalThis.document, box = doc?.getElementById?.("exportRuby");
  if (!box) return;
  box.closest("label")?.toggleAttribute("hidden", !sawHan);
  if (exportChoice == null) box.checked = rubyOn();
}
// The View menu item and the Export dialog's checkbox (index.html).
export function wireRubyControls(doc = globalThis.document) {
  const toggle = doc.getElementById("zhRubyToggle"), viewToggle = doc.getElementById("viewRubyToggle"), box = doc.getElementById("exportRuby");
  if (toggle) toggle.onclick = () => setRuby(!rubyOn());
  if (viewToggle) viewToggle.onclick = () => setRuby(!rubyOn());
  if (box) box.onchange = () => chooseExportRuby(box.checked);
  globalThis.addEventListener?.("zh-settings", () => refreshRuby());
  refreshRuby();
}
