// Copy, cut and paste of items: Ctrl C / X / V, the item and page menus, and items let go
// over another page. A copy is kept as lines and pictures (the engine's copyItems, as they
// are drawn now); the system clipboard gets a picture of the items that carries them
// (png-clip.js), so a paste here brings them back editable and elsewhere shows how they look.
// app.js wires it in with itemClipboard().
import { addClipChunk, isPng, readClipChunk, validClip } from "./png-clip.js";
import { getSharedUmlClip, readUmlClipFromText, saveNoteUmlClip } from "./uml-clipboard.js";
import { prefabName } from "./prefabs.js";

export function itemClipboard({ $, action, call, drawPlantuml, ensureEditableLayer, importImages, itemPicture, placePrefab, point, removeItem, renderPage, selection, status, textBox, app }) {
  // Copy, cut and paste of items (Ctrl C / X / V, and the item and page menus), and items let go
  // over another page. A copy is kept here as lines and pictures (the engine's copyItems, as
  // they are drawn now); Noteful's own pictures and text go as a picture of how they look. The
  // system clipboard gets a marker, so a paste knows the copy is still the last thing copied.
  const CLIP_MARK = "NoteComplete items (paste them in NoteComplete)";
  let clip = null; // { page, lines, images, box, pastes }
  const currentClip = () => clip;
  // Whether keys pressed in `t` are typing: text fields, lists and editable text. A colour
  // picker, slider, check box or button keeps the focus after it is used (the pen's colour),
  // and the shortcuts and Ctrl Z must still work there.
  const NOT_TYPED = new Set(["color", "range", "checkbox", "radio", "button", "submit", "reset", "file", "image"]);
  function typingIn(t) {
    if (t instanceof HTMLInputElement) return !NOT_TYPED.has(t.type);
    return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || !!t?.isContentEditable;
  }
  const itemIds = (item) => (item.compound ? item.compound.items : item.kind === "group" ? item.members.map((m) => m.id) : [item.id]);
  const blobBase64 = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] || ""); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  // The items of `item` as lines and pictures that can go on any page.
  async function copiedItems(item) {
    const copied = await call("copyItems", { page: item.page, ids: itemIds(item) });
    if (copied.others.length) {
      const out = {};
      const blob = await itemPicture({ page: item.page, kind: "group", members: copied.others.map((id) => ({ id })) }, 3, "image/png", undefined, out);
      copied.images.push({ base64: await blobBase64(blob), mime: "image/png", bounds: out.box, layer: app.activeLayer });
    }
    return copied;
  }
  // Lines and pictures moved by [dx, dy]; a graph's or prefab's parts get an id of their own
  // (`fresh`), so the copy is a figure apart from the one it came from.
  function shifted({ lines, images }, [dx, dy], fresh = true) {
    const ids = new Map(), rename = (part) => {
      if (!part || !fresh) return part;
      if (!ids.has(part.id)) ids.set(part.id, `${part.kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
      return { ...part, id: ids.get(part.id) };
    };
    const at = ([x, y]) => [x + dx, y + dy];
    return {
      lines: lines.map((l) => ({ ...l, points: l.points.map(at), ...(l.shape ? { shape: { ...l.shape, start: at(l.shape.start), end: at(l.shape.end) } } : {}), ...(l.part ? { part: rename(l.part) } : {}) })),
      images: images.map((i) => ({ ...i, bounds: [i.bounds[0] + dx, i.bounds[1] + dy, i.bounds[2], i.bounds[3]], ...(i.part ? { part: rename(i.part) } : {}) })),
    };
  }
  function clipBox({ lines, images }) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of lines) for (const [x, y] of l.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (const { bounds: [x, y, w, h] } of images) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }
    return Number.isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, 0, 0];
  }
  // The system clipboard after a copy: a picture of the items that carries them (png-clip.js),
  // so it pastes as a picture in other apps and as the items again in NoteComplete, and the
  // marker text. On the desktop the PNG goes as it is (desktop png-clipboard.js); a browser
  // re-encodes it, so there other apps get the picture only (the copy here still pastes).
  async function clipToSystem(item, c) {
    let png = null;
    try {
      const blob = await itemPicture(item, 2);
      const { page: _page, pastes: _pastes, ...kept } = c;
      png = await addClipChunk(new Uint8Array(await blob.arrayBuffer()), kept);
    } catch { /* Not drawn (page off screen…): the marker only. */ }
    try {
      if (png && window.notecompleteClipboard?.writePng) return void await window.notecompleteClipboard.writePng(png, CLIP_MARK);
      if (png && navigator.clipboard?.write && window.ClipboardItem)
        return void await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }), "text/plain": new Blob([CLIP_MARK], { type: "text/plain" }) })]);
    } catch { /* Fall back to the marker. */ }
    try { await navigator.clipboard?.writeText?.(CLIP_MARK); } catch { /* The copy is still kept here. */ }
  }
  // The copy carried by a picture (pasted, dropped or imported), or null.
  async function pictureClip(file) {
    try {
      if (!file || file.size > 96 * 1024 * 1024) return null;
      if (!(file.type === "image/png" || /\.png$/i.test(file.name || "") || isPng(new Uint8Array(await file.slice(0, 8).arrayBuffer())))) return null;
      const c = await readClipChunk(new Uint8Array(await file.arrayBuffer()));
      return validClip(c) ? c : null;
    } catch { return null; }
  }
  // Items from a picture: this tab's own copy pastes as Ctrl V does; one from elsewhere goes
  // with its parts given new ids, centred on `at` ({ page, point }) or where it was.
  async function pasteFromPicture(c, at = null) {
    if (clip && c.id && c.id === clip.id) return pasteClip(at ? app.panels[at.page] : app.panels[app.page]);
    const restored = { lines: c.lines, images: c.images, box: clipBox(c), pastes: 0 };
    const p = at ? app.panels[at.page] : app.panels[app.page];
    const done = await pasteClip(p, at?.point ? cornerFor(restored.box, at.point) : null, restored);
    if (done) status("Pasted from a NoteComplete picture: editable again.");
  }
  const cornerFor = ([, , w, h], [x, y]) => [x - w / 2, y - h / 2];
  async function copyItem(item, { cut = false } = {}) {
    if (!app.doc || !item) return;
    try {
      const copied = await copiedItems(item);
      clip = { page: item.page, lines: copied.lines, images: copied.images, box: clipBox(copied), pastes: 0, at: Date.now(), id: Math.random().toString(36).slice(2, 12) };
      // A prefab's spec is on its frame line's part (the core), or on its picture in older copies.
      const parts = [...copied.lines.map((l) => l.part), ...copied.images.map((i) => i.part || i.prefab)].filter((q) => q?.spec);
      const specRaw = new Set(parts.map((q) => q.id)).size === 1 ? parts[0].spec : null;
      if (specRaw) { try { const spec = typeof specRaw === "string" ? JSON.parse(specRaw) : specRaw; if (spec?.type === "uml") saveNoteUmlClip(spec); } catch { /* Ignored. */ } }
      await clipToSystem(item, clip);
      if (cut) { await removeItem(item); status("Cut. Ctrl V (or right-click → Paste) puts it back, on any page."); }
      else status("Copied. Ctrl V (or right-click → Paste) puts a copy on any page.");
    } catch (e) { status(e.message, true); }
  }
  async function pasteUmlIntoPage(parsedClip, p = app.panels[app.page], at = null) {
    if (!app.doc || !p || app.editing || !ensureEditableLayer() || !parsedClip?.elements?.length) return false;
    let spec = { type: "uml", diagram: parsedClip.diagram || "class", elements: parsedClip.elements, connectors: parsedClip.connectors || [], ...(parsedClip.preamble?.length ? { preamble: parsedClip.preamble } : {}) };
    if (parsedClip.laidOut === false) {
      try {
        const { toPlantUml, layoutFromPlantuml } = await import("./uml-plantuml.js");
        const drawn = await drawPlantuml(toPlantUml(spec, { preamble: spec.preamble || [], layout: false }));
        if (drawn?.svg) layoutFromPlantuml(spec, drawn.svg);
      } catch { /* Auto-layout fallback. */ }
    }
    const done = await placePrefab(p, spec, at);
    if (done) status(`${prefabName(spec)} pasted on page ${p.index + 1}. Right-click it to edit; one undo takes it away.`);
    return done;
  }
  // The copy on page `p`: at page point `at` (its top left corner), else where it was (a little
  // lower and to the right on its own page, again with each paste), kept on the page.
  async function pasteClip(p = app.panels[app.page], at = null, c = clip) {
    if (!app.doc || !c || !p || app.editing || !ensureEditableLayer()) return false;
    const [x, y, w, h] = c.box;
    let to;
    if (at) to = at;
    else { const step = p.index === c.page ? 16 * ++c.pastes : 0; to = [x + step, y + step]; }
    to = [Math.max(0, Math.min(p.size[0] - w, to[0])), Math.max(0, Math.min(p.size[1] - h, to[1]))];
    const moved = shifted(c, [to[0] - x, to[1] - y]);
    const layer = app.activeLayer;
    await action("drawMany", { page: p.index, lines: moved.lines.map((l) => ({ ...l, layer })), images: moved.images.map((i) => ({ ...i, layer })) });
    status(`Pasted on page ${p.index + 1}. One undo takes it away.`);
    return true;
  }
  // Items let go over another page (selection.js): taken off theirs and put where they were
  // let go, in one undo step.
  async function moveToPage(item, target, start, client) {
    const from = app.panels[item.page], to = app.panels[target];
    if (!app.doc || !from || !to || app.editing) return from && renderPage(from);
    try {
      const copied = await copiedItems(item);
      const r = to.el.getBoundingClientRect();
      const there = [((client[0] - r.left) / r.width) * to.size[0], ((client[1] - r.top) / r.height) * to.size[1]];
      const moved = shifted(copied, [there[0] - start[0], there[1] - start[1]], false);
      await action("drawMany", { page: target, cut: { page: item.page, ids: itemIds(item) }, lines: moved.lines, images: moved.images });
      status(`Moved to page ${target + 1}. One undo moves it back.`);
    } catch (e) { status(e.message, true); } finally { await renderPage(from); }
  }
  // Ctrl C / X with an item selected, Ctrl V with a copy kept. The keys do it (Safari sends no
  // copy or paste event when nothing on the page is selected or editable); the clipboard
  // events, where they come, only carry the marker.
  let clipKeyAt = -Infinity, pastedAt = -Infinity;
  // Where pasted pictures and text go: the pointer's place on a page, when it was last over one
  // still on screen, else the middle of what is shown of the current page.
  function pasteSpot() {
    const q = app.pagePointer?.p;
    if (q?.el?.isConnected && q.view) {
      const r = q.el.getBoundingClientRect(), vp = $("viewport").getBoundingClientRect();
      if (r.bottom > vp.top && r.top < vp.bottom) return { page: q.index, point: point(app.pagePointer, q) };
    }
    const p = app.panels[app.page];
    if (!p) return null;
    const r = p.el.getBoundingClientRect(), vp = $("viewport").getBoundingClientRect(), k = p.size[0] / r.width;
    const top = Math.max(r.top, vp.top), bottom = Math.min(r.bottom, vp.bottom);
    return { page: p.index, point: [p.size[0] / 2, Math.min(p.size[1], Math.max(0, ((top + bottom) / 2 - r.top) * k))] };
  }
  const itemKeys = (e) => !e.defaultPrevented && !typingIn(e.target) && !window.getSelection()?.toString() && app.doc && !app.editing;
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !itemKeys(e)) return;
    const key = e.key.toLowerCase();
    // Whatever the tool: a selection (left from Select, or a long press) copies; a copy pastes.
    if ((key === "c" || key === "x") && selection.item) {
      if (key === "x" && !selection.editable()) return;
      clipKeyAt = e.timeStamp;
      copyItem(selection.item, { cut: key === "x" });
    } else if (key === "v") {
      // The paste event says whether the copy is still the last thing copied; without one
      // (Safari), fall back to the local page clip or shared UML clip.
      const at = e.timeStamp;
      setTimeout(async () => {
        if (pastedAt >= at) return;
        const shared = getSharedUmlClip();
        if (clip && (!shared || (clip.at || 0) >= (shared.at || 0))) return pasteClip();
        if (shared) return pasteUmlIntoPage(shared);
        try {
          const txt = await navigator.clipboard?.readText?.();
          const uml = readUmlClipFromText(txt);
          if (uml) return pasteUmlIntoPage(uml);
        } catch { /* Unavailable. */ }
        if (clip) pasteClip();
      }, 60);
    }
  });
  for (const type of ["copy", "cut"]) document.addEventListener(type, (event) => {
    if (performance.now() - clipKeyAt > 1000 || !itemKeys(event)) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", CLIP_MARK);
  });
  document.addEventListener("paste", (event) => {
    if (!itemKeys(event)) return;
    // Middle-click (click wheel) on Linux fires a primary-selection paste event on mouseup;
    // never turn an accidental wheel click into a text box on the page.
    if (performance.now() - app.middleMouseAt < 400) {
      event.preventDefault();
      return;
    }
    const text = event.clipboardData?.getData("text/plain") || "";
    const images = [...(event.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    // A copy made in NoteComplete: this tab's own, or (its picture carrying another copy) one
    // made in another tab or window.
    if (text === CLIP_MARK && (clip || images.length)) {
      pastedAt = event.timeStamp;
      event.preventDefault();
      const spot = pasteSpot();
      (async () => {
        const c = images.length ? await pictureClip(images[0]) : null;
        if (c && c.id !== clip?.id) return pasteFromPicture(c, spot);
        if (clip) return pasteClip();
        if (images.length) return importImages(images, { at: spot, any: true });
      })().catch((e) => status(e.message, true));
      return;
    }
    const umlClip = readUmlClipFromText(text);
    if (umlClip) {
      pastedAt = event.timeStamp;
      event.preventDefault();
      pasteUmlIntoPage(umlClip);
      return;
    }
    // From other apps: a picture goes on the page where the pointer is (selected, to move it);
    // plain text becomes a text box there. A picture copied from NoteComplete brings its items.
    if (images.length) {
      pastedAt = event.timeStamp;
      event.preventDefault();
      importImages(images, { at: pasteSpot(), any: true });
      return;
    }
    if (text.trim() && text !== CLIP_MARK) {
      const spot = pasteSpot();
      if (!spot) return;
      pastedAt = event.timeStamp;
      event.preventDefault();
      textBox.placeText(app.panels[spot.page], spot.point, text.replace(/\r\n?/g, "\n").trimEnd());
    }
  });
  return { copyItem, currentClip, moveToPage, pasteClip, pasteFromPicture, pasteUmlIntoPage, pictureClip, typingIn };
}
