// Edit PDF mode (docs/PDF-EDITOR.md): the printed text of a PDF page, in blocks outlined
// under the pointer; a double-click turns a block into a typed text box in its place and
// opens it for typing. The engine (worker.js → the importer's pdf_edit.rs) finds the blocks
// and makes a one-page copy of the PDF without their text; that copy becomes the page's
// background and the text box goes on top, in one undo step. Pages of any note with a PDF
// behind them work the same: PDF-only documents, mixed notes, pages inserted from a PDF.
//
// Text comes from pdf.js where it has it (every encoding and CMap), else from the engine.
// The block keeps its size, colour, line spacing and, when the PDF embeds a font the browser
// can use with every character of the block, that font (fonts.js); else the nearest of the
// built-in families.
import { backgroundPlacement } from "./pdf-background.js";
import { pdfFontName, pdfFontHash, isRegistered, registerFont } from "./fonts.js";
import { textBoxSize } from "./text-box.js";

const ns = "http://www.w3.org/2000/svg";

// A point of PDF user space through pdf.js's viewport (scale 1) onto the Noteful page.
export function toPage([x, y], transform, viewport, place) {
  const vx = transform[0] * x + transform[2] * y + transform[4];
  const vy = transform[1] * x + transform[3] * y + transform[5];
  return [place.x + (vx * place.width) / viewport.width, place.y + (vy * place.height) / viewport.height];
}
// A user-space box [x0, y0, x1, y1] as a page rect [x, y, w, h].
export function rectOnPage([x0, y0, x1, y1], transform, viewport, place) {
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map((c) => toPage(c, transform, viewport, place));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

// pdf.js's text in the engine's lines: an item belongs to the line whose baseline it sits on
// and whose span holds its start. Items are joined left to right, with a space where pdf.js
// left a gap and none was written. A line pdf.js has nothing for keeps the engine's text.
export function assignText(blocks, items) {
  const usable = (items || []).filter((i) => i?.str && Array.isArray(i.transform));
  for (const block of blocks) {
    for (const line of block.lines) {
      const tol = Math.max(1, block.size * 0.35);
      const mine = usable
        .filter((i) => Math.abs(i.transform[5] - line.base) < tol && i.transform[4] >= line.x0 - tol && i.transform[4] <= line.x1 + tol * 0.5)
        .sort((a, b) => a.transform[4] - b.transform[4]);
      if (!mine.length) continue;
      let text = "", end = null;
      for (const item of mine) {
        const gap = end == null ? 0 : item.transform[4] - end;
        if (end != null && gap > block.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
        text += item.str;
        end = item.transform[4] + (item.width || 0);
      }
      line.text = text.replace(/\s+/g, " ").trim();
    }
  }
  return blocks;
}

// The built-in family nearest a PDF font.
export function nearestFamily(block) {
  if (block.mono) return "Courier New";
  if (block.serif) return "Times New Roman";
  return "Helvetica";
}

// The text box for a block on a page: its text (the PDF's lines), style and bounds, sized
// with `measure` once the font is known. `scale`: page units per PDF unit.
export function textBoxFor(block, { origin, scale, font, layer = 0 }) {
  const text = block.lines.map((l) => l.text).join("\n");
  const size = Math.round(block.size * scale * 100) / 100;
  const lineHeight = block.lines.length > 1 && block.leading > 0 ? Math.round(block.leading * scale * 100) / 100 : 0;
  const ok = lineHeight >= size * 0.5 && lineHeight <= size * 6;
  const style = { font, size, bold: !!block.bold, italic: !!block.italic, rgba: block.rgba || [0, 0, 0, 1], ...(ok ? { lineHeight } : {}) };
  const align = block.align === 1 || block.align === 2 ? block.align : 0;
  // The core draws the first baseline 8 + size under the box's top, 5 units in.
  const [x, base] = origin;
  return { text, style, align, at: [x - 5, base - 8 - size] };
}

export function pdfEditController({ call, action, status, getPanels, getDoc, getActiveLayer, backgrounds, point, openText, isBusy = () => false }) {
  let active = false;
  // Blocks per PDF page (resource + page index), as the engine gave them, with pdf.js's text.
  const cache = new Map();
  let hovered = null, lastDown = null;

  const key = (bg) => `${bg.resource_id}#${bg.page_index}`;
  async function pageInfo(p) {
    const bg = p.view?.pdf_background;
    if (!bg) return null;
    const k = key(bg);
    if (!cache.has(k)) {
      cache.set(k, (async () => {
        const [raw, pdf] = await Promise.all([
          call("pdfBlocks", { resource: bg.resource_id, pageIndex: bg.page_index }),
          backgrounds().document(bg.resource_id),
        ]);
        const page = await pdf.getPage(bg.page_index + 1);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent().catch(() => ({ items: [] }));
          return { raw: assignText(raw.blocks, content.items), skipped: raw.skipped, viewport: { width: viewport.width, height: viewport.height, transform: viewport.transform, rotation: viewport.rotation } };
        } finally { page.cleanup(); }
      })().catch((e) => { cache.delete(k); throw e; }));
    }
    const info = await cache.get(k);
    const place = backgroundPlacement(bg, p.view.size);
    const blocks = info.raw.map((b) => ({ ...b, rect: rectOnPage(b.bbox, info.viewport.transform, info.viewport, place) }));
    return { ...info, bg, place, blocks };
  }

  // The outlines over a page: one rectangle per block, shown faintly, the one under the
  // pointer stronger.
  async function outline(p) {
    if (!active || !p?.view) return null;
    const info = await pageInfo(p).catch((e) => { status(e.message, true); return null; });
    if (!active || !info) return info;
    const stamp = `${key(info.bg)}|${p.view.size.join()}|${(info.bg.rect || []).join()}`;
    let layer = p.el.querySelector(":scope > .pdf-edit-layer");
    if (layer?.dataset.stamp === stamp) return info;
    layer?.remove();
    layer = document.createElementNS(ns, "svg");
    layer.setAttribute("class", "pdf-edit-layer");
    layer.setAttribute("viewBox", `0 0 ${p.view.size[0]} ${p.view.size[1]}`);
    layer.setAttribute("preserveAspectRatio", "none");
    layer.dataset.stamp = stamp;
    for (const b of info.blocks) {
      const r = document.createElementNS(ns, "rect");
      const pad = 3;
      r.setAttribute("x", b.rect[0] - pad);
      r.setAttribute("y", b.rect[1] - pad);
      r.setAttribute("width", b.rect[2] + pad * 2);
      r.setAttribute("height", b.rect[3] + pad * 2);
      r.setAttribute("rx", 3);
      r.dataset.block = b.id;
      layer.append(r);
    }
    p.el.append(layer);
    return info;
  }

  const blockAt = (info, [x, y]) => {
    const pad = 4;
    // The smallest block holding the point (a heading inside a wide block's span wins).
    return info.blocks
      .filter((b) => x >= b.rect[0] - pad && x <= b.rect[0] + b.rect[2] + pad && y >= b.rect[1] - pad && y <= b.rect[1] + b.rect[3] + pad)
      .sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3])[0];
  };
  function mark(p, id) {
    for (const r of p.el.querySelectorAll(":scope > .pdf-edit-layer rect")) r.classList.toggle("hover", r.dataset.block === String(id));
  }

  async function hover(e, p) {
    if (!active || !p?.view?.pdf_background) return;
    const info = await outline(p);
    if (!info) return;
    const b = blockAt(info, point(e, p));
    const id = b ? `${p.index}:${b.id}` : null;
    if (id === hovered) return;
    if (hovered && !hovered.startsWith(`${p.index}:`)) for (const q of getPanels()) mark(q, null);
    hovered = id;
    mark(p, b?.id);
  }

  // A press: the block under it is marked; a second press on it soon after converts it.
  async function down(e, p) {
    if (!active) return false;
    e.preventDefault();
    if (!p.view?.pdf_background) {
      status("This page has no PDF behind it: Edit PDF works on pages from a PDF.");
      return true;
    }
    const info = await outline(p);
    if (!info) return true;
    const b = blockAt(info, point(e, p));
    if (!b) {
      lastDown = null;
      if (!info.blocks.length) status(info.skipped?.invisible ? "This page's text is a scan with a hidden OCR layer: there is no printed text to edit." : "This page has no text to edit (a scan, or text drawn as shapes).");
      return true;
    }
    mark(p, b.id);
    const now = Date.now(), again = lastDown && lastDown.page === p.index && lastDown.block === b.id && now - lastDown.at < 450;
    lastDown = { page: p.index, block: b.id, at: now };
    if (again) {
      lastDown = null;
      await convert(p, info, b);
    } else status("Double-click the block to edit its text.");
    return true;
  }

  async function convert(p, info, b) {
    const doc = getDoc(), layerId = getActiveLayer(), layer = doc?.layers?.find((l) => l.id === layerId);
    if (!doc || isBusy()) return;
    if (!layer?.visible || layer.locked) return status("Select a visible, unlocked layer first.", true);
    if (info.viewport.rotation % 360 !== 0) return status("Pages turned in their PDF cannot be edited yet.", true);
    const { bg, place, viewport } = info;
    const scale = place.width / viewport.width;
    const text = b.lines.map((l) => l.text).join("\n");
    if (!text.trim()) return;
    // The PDF's own font when the browser takes it and it has every character of the block.
    let font = nearestFamily(b);
    if (b.program) {
      try {
        const missing = await call("pdfFontMissing", { resource: bg.resource_id, hash: b.program, text });
        const name = pdfFontName(b.font, b.program);
        if (!missing) {
          const bytes = await call("pdfFont", { resource: bg.resource_id, pageIndex: bg.page_index, hash: b.program });
          if (await registerFont(name, bytes, { weight: b.bold ? "700" : "400", style: b.italic ? "italic" : "normal" })) font = name;
        }
      } catch { /* The nearest family. */ }
    }
    const first = b.lines[0];
    const origin = toPage([first.x0, first.base], viewport.transform, viewport, place);
    const box = textBoxFor(b, { origin, scale, font, layer: layerId });
    const [w, h] = textBoxSize(box.text, box.style);
    const bounds = [box.at[0], box.at[1], Math.max(w, b.rect[2] + 12), h];
    status("Making the page without that text…");
    const bytes = await call("pdfWithout", { resource: bg.resource_id, pageIndex: bg.page_index, ops: b.ops });
    const id = `pdfedit-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const payload = {
      text: box.text, font_size: box.style.size, rgba: box.style.rgba, bold: box.style.bold, italic: box.style.italic, font: box.style.font,
      ...(box.align ? { align: box.align } : {}),
      ...(box.style.lineHeight ? { line_height: box.style.lineHeight } : {}),
    };
    await action("replacePdfText", {
      page: p.index,
      pages: [{ page: p.index, size: [...p.view.size], pdf: { resource: id, page_index: 0, ...(bg.rect ? { rect: bg.rect } : {}) } }],
      pdf: { id, base64: base64Of(bytes) },
      images: [{ base64: "", mime: "", bounds, layer: layerId, text: payload }],
    });
    status("The text is a text box now: type to change it. Undo puts the PDF's text back.");
    // Typing at once, in the box just made.
    openText?.(p, [bounds[0] + 6, bounds[1] + 8 + box.style.size * 0.6]);
  }

  function base64Of(bytes) {
    let s = "";
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function enter() {
    active = true;
    hovered = null;
    lastDown = null;
    status("Edit PDF: double-click a block of the PDF's text to edit it as a text box.");
    for (const p of getPanels()) if (p.view?.pdf_background && (p.near || p.el.getBoundingClientRect().bottom > 0)) outline(p);
  }
  function leave() {
    if (!active) return;
    active = false;
    hovered = null;
    for (const layer of document.querySelectorAll(".pdf-edit-layer")) layer.remove();
    call("pdfEditClose").catch(() => { /* Optional. */ });
  }
  // The note changed (another note opened, undo, a new background): outlines are drawn again
  // when the pointer comes back; blocks of PDF pages already read stay cached.
  function reset() {
    cache.clear();
    for (const layer of document.querySelectorAll(".pdf-edit-layer")) layer.remove();
  }
  // Text boxes made from a PDF (here or in an earlier session) in its embedded font: the font
  // registered from the PDF behind their page, once per font. Called when a page is drawn.
  const fontsAsked = new Set();
  async function fontsFor(p) {
    const bg = p?.view?.pdf_background;
    if (!bg) return;
    const wanted = new Set();
    for (const t of p.view.texts || []) for (const r of t.runs || []) if (pdfFontHash(r.font_family) && !isRegistered(r.font_family)) wanted.add(r.font_family);
    for (const family of wanted) {
      const asked = `${family}@${bg.resource_id}`;
      if (fontsAsked.has(asked)) continue;
      fontsAsked.add(asked);
      try {
        const bytes = await call("pdfFont", { resource: bg.resource_id, pageIndex: bg.page_index, hash: pdfFontHash(family) });
        const run = p.view.texts.flatMap((t) => t.runs || []).find((r) => r.font_family === family);
        await registerFont(family, bytes, { weight: run?.bold ? "700" : "400", style: run?.italic ? "italic" : "normal" });
      } catch { /* Not in this page's PDF (the box moved): the same kind of face instead. */ }
    }
  }
  // A page whose background changed (an edit here, undo, redo): its outlines again.
  function refresh(p) {
    p?.el.querySelector(":scope > .pdf-edit-layer")?.remove();
    if (active && p?.view?.pdf_background) outline(p);
  }
  return { enter, leave, reset, refresh, fontsFor, hover, down, get active() { return active; } };
}
