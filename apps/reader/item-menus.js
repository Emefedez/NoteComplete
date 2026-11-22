// The menus at the pointer (context-menu.js): right-click on a page, a finger held still, or
// a selection's ⋯ circle. The item menu restyles, edits, copies or exports what is under it;
// the page menu inserts, pastes and acts on the page. Also pictures of items and pages
// (PNG, JPEG, SVG, or sent by QR). app.js wires it in with itemMenus().
import { rgbaOf } from "./text-box.js";
import { imageReady } from "./image-ready.js";
import { download } from "./download.js";
import { canBeExercise, editorKind } from "./chart-model.js";
import { openContextMenu } from "./context-menu.js";
import { moduleOf } from "./prefab-registry.js";
import { PREFABS, recentPrefabs } from "./prefabs.js";
import { pageZhEntries, pageZhLongPress } from "./chinese/zh-menu.js";
import { getSharedUmlClip } from "./uml-clipboard.js";

export function itemMenus({ $, ITEM_NAMES, SHAPE_NAMES, SWATCHES, WIDTH_LADDER, action, blankPageEntries, busy, call, cancelGesture, compoundLabel, copyItem, currentClip, editCompound, editTextItem, insertCompound, insertPrefab, insertShapeAt, insertUml, pageCanvas, palettes, pasteClip, pasteUmlIntoPage, patchItem, pickColor, pickWhole, point, quick, removeItem, selection, setTapeMode, status, tapeOpen, textBox, toggleTape, app }) {
  // Colours and thickness of a shape or stroke, from its menu: the same change as the selection's
  // fields (one undo step). A closed shape's fill (rectangle, ellipse, triangle, star) changes too.
  const hexOf = (rgba) => "#" + rgba.slice(0, 3).map((n) => Math.round(n * 255).toString(16).padStart(2, "0")).join("");
  const COLOUR_NAMES = { "#1f2328": "Black", "#246bce": "Blue", "#d13b2f": "Red", "#2a9d63": "Green", "#8a4fd0": "Purple", "#ff9f1c": "Orange", "#ffdf38": "Yellow", "#e3c6e6": "Pink" };
  async function restyle(item, change) {
    const adjustment = { ...structuredClone(item.adjustment), ...change };
    if (selection.item?.page === item.page && selection.item?.id === item.id) return selection.commit(adjustment);
    return patchItem(item, adjustment);
  }
  function styleEntries(item) {
    if (!item.styled) return [];
    const rgba = item.adjustment?.rgba || item.base_rgba, width = item.adjustment?.width ?? item.base_width, now = hexOf(rgba);
    const tool = item.kind === "ink" ? "draw" : "shape";
    const colours = [...new Set([...palettes[tool], ...SWATCHES].map((c) => c.toLowerCase()))].slice(0, 10);
    const widths = [...new Set([...app.widthPresets[tool], ...WIDTH_LADDER.slice(0, 5)])].sort((a, b) => a - b);
    return [
      { label: "Colour", icon: "draw", submenu: () => [
        ...colours.map((c) => ({ label: COLOUR_NAMES[c] || c.toUpperCase(), swatch: c, checked: c === now, run: () => restyle(item, { rgba: [...rgbaOf(c).slice(0, 3), rgba[3]] }) })),
        "-",
        { label: "Other colour…", icon: "settings", run: () => pickColor(now, (v) => restyle(item, { rgba: [...rgbaOf(v).slice(0, 3), rgba[3]] })) },
      ] },
      { label: "Thickness", icon: "minus", submenu: () => widths.map((w) => ({ label: `${w} px`, icon: "minus", checked: Math.abs(w - width) < 0.01, run: () => restyle(item, { width: w }) })) },
      { label: "Opacity", icon: "eye", submenu: () => [100, 75, 50, 25].map((o) => ({ label: `${o}%`, icon: "eye", checked: Math.round(rgba[3] * 100) === o, run: () => restyle(item, { rgba: [...rgba.slice(0, 3), o / 100] }) })) },
      "fill" in item && { label: "Fill", icon: "shape", submenu: () => fillEntries(item, rgba, colours) },
    ];
  }
  // A closed shape's inside: none, a light tint or solid, in its colour or another one.
  function fillEntries(item, rgba, colours) {
    const fill = item.fill || null, base = fill ? fill.slice(0, 3) : rgba.slice(0, 3), now = fill && hexOf(fill);
    const tint = !!fill && fill[3] < 0.6, set = (rgb, alpha) => restyle(item, { fill: [...rgb, alpha] });
    return [
      { label: "No fill", icon: "close", checked: !fill, run: () => set([0, 0, 0], 0) },
      { label: "Light tint", icon: "shape", checked: tint, run: () => set(base, 0.25) },
      { label: "Solid", icon: "shape", checked: !!fill && !tint, run: () => set(base, 1) },
      "-",
      ...colours.map((c) => ({ label: COLOUR_NAMES[c] || c.toUpperCase(), swatch: c, checked: c === now, run: () => set(rgbaOf(c).slice(0, 3), fill ? fill[3] : 0.25) })),
      { label: "Other colour…", icon: "settings", run: () => pickColor(now || hexOf(rgba), (v) => set(rgbaOf(v).slice(0, 3), fill ? fill[3] : 0.25)) },
    ];
  }
  // The tape under page point `at`, the top one.
  function tapeAt(p, at) {
    return [...(p.view?.tapes || [])].reverse().find(({ bounds: [x, y, w, h] }) => at[0] >= x && at[0] <= x + w && at[1] >= y && at[1] <= y + h) || null;
  }
  function tapeEntries(p, tape) {
    if (!tape) return [];
    const open = tapeOpen(p, tape);
    return [
      { label: open ? "Cover with this tape" : "Lift this tape", icon: open ? "eyeOff" : "eye", run: () => toggleTape(p, tape) },
      { label: "All tape", icon: "tape", submenu: [
        { label: "Lift all", icon: "eye", checked: app.tapeMode === "revealed", run: () => setTapeMode("revealed") },
        { label: "Cover all", icon: "eyeOff", checked: app.tapeMode === "covered", run: () => setTapeMode("covered") },
        { label: "As saved in the note", icon: "tape", checked: app.tapeMode === "note", run: () => setTapeMode("note") },
      ] },
    ];
  }
  // A picture of an item (as drawn, on nothing) or of a page, to download, copy, share or send by
  // QR. `make(scale, type, quality)` draws it.
  const safeName = (name) => String(name || "NoteComplete").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80);
  async function itemPicture(item, scale = 3, type = "image/png", quality, out = null) {
    const p = app.panels[item.page];
    const ids = new Set(item.compound ? item.compound.items : item.kind === "group" ? item.members.map((m) => m.id) : [item.id]);
    const svgNow = p?.render?.querySelector("svg");
    if (!svgNow) throw Error("The page is not shown.");
    // Where it is now, from what is drawn (moves, turns and crops included).
    const frame = svgNow.getBoundingClientRect(), k = p.size[0] / frame.width;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const r = p.render.querySelector(`[data-item="${CSS.escape(String(id))}"]`)?.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) continue;
      x0 = Math.min(x0, (r.left - frame.left) * k); y0 = Math.min(y0, (r.top - frame.top) * k);
      x1 = Math.max(x1, (r.right - frame.left) * k); y1 = Math.max(y1, (r.bottom - frame.top) * k);
    }
    if (!(x1 > x0 && y1 > y0)) throw Error("Nothing to export here.");
    const pad = 4, box = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
    if (out) out.box = box;
    const view = await call("view", { page: item.page });
    const holder = document.createElement("div");
    holder.innerHTML = view.svg;
    for (const el of holder.querySelectorAll("[data-item]")) if (!ids.has(el.dataset.item)) el.remove();
    holder.querySelector("[data-background]")?.replaceChildren();
    // Tape as it is on the page now (lifted or covering).
    for (const tape of holder.querySelectorAll("[data-tape]")) tape.setAttribute("opacity", p.render.querySelector(`[data-tape="${CSS.escape(tape.dataset.tape)}"]`)?.dataset.revealed === "1" ? "0.18" : "1");
    const svg = holder.querySelector("svg"), w = Math.max(1, Math.round(box[2] * scale)), h = Math.max(1, Math.round(box[3] * scale));
    svg.setAttribute("viewBox", box.join(" "));
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await imageReady(image, url);
      const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
      const context = canvas.getContext("2d");
      if (type !== "image/png") { context.fillStyle = "#fff"; context.fillRect(0, 0, w, h); }
      context.drawImage(image, 0, 0, w, h);
      return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(Error("Could not draw the picture."))), type, quality));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function pagePicture(index, scale = 1, type = "image/png", quality) {
    const { canvas } = await pageCanvas(index, Math.round(Math.min(2200, app.panels[index].size[0] * 2) * scale));
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(Error("Could not draw the page."))), type, quality));
  }
  const QR_MAX = 48 * 1024;
  function exportEntries(name, make) {
    const file = safeName(name), fail = (e) => e?.name !== "AbortError" && status(e?.message || String(e), true);
    return { label: "Export", icon: "export", subtitle: name, submenu: () => [
      { label: "Download PNG", icon: "save", run: () => make(3).then((b) => download(b, `${file}.png`, "image/png")).then(() => status(`Saved “${file}.png”.`)).catch(fail) },
      navigator.clipboard?.write && window.ClipboardItem && { label: "Copy picture", icon: "copy", run: () => navigator.clipboard.write([new ClipboardItem({ "image/png": make(2) })]).then(() => status("Copied as a picture: paste it anywhere.")).catch(fail) },
      navigator.share && { label: "Share…", icon: "share", run: async () => {
        try {
          const picture = new File([await make(2)], `${file}.png`, { type: "image/png" });
          if (!navigator.canShare?.({ files: [picture] })) return status("This browser cannot share pictures. Download it instead.", true);
          await navigator.share({ files: [picture], title: name });
        } catch (e) { fail(e); }
      } },
      { label: "Send by QR…", icon: "qr", run: () => sendPictureByQr(name, file, make).catch(fail) },
    ] };
  }
  // Offline, as a stream of QR codes: small pictures only (the smallest of a few renderings).
  async function sendPictureByQr(name, file, make) {
    let blob = null, ext = "png";
    for (const [scale, type, quality] of [[1.5, "image/png"], [1, "image/png"], [1, "image/jpeg", 0.8], [0.7, "image/jpeg", 0.65]]) {
      blob = await make(scale, type, quality);
      ext = type === "image/png" ? "png" : "jpg";
      if (blob.size <= QR_MAX) break;
    }
    if (blob.size > QR_MAX) return status(`Too big to send by QR (${Math.round(blob.size / 1024)} KB). Download or share it instead.`, true);
    const { showQrTransfer, base64UrlEncode } = await import("./qr-transfer.js");
    await showQrTransfer({
      title: `Send “${name}” by QR`,
      subtitle: "On the other device: Import, export and share → Receive note via QR / P2P → Scan QR stream.",
      payload: { kind: "file", name: `${file}.${ext}`, mime: blob.type, base64: base64UrlEncode(new Uint8Array(await blob.arrayBuffer())) },
      onDownloadFallback: () => download(blob, `${file}.${ext}`, blob.type),
      fallbackLabel: "Save the picture instead",
      status,
    });
  }
  function itemMenu(item, x, y, { tape = null, zh = [] } = {}) {
    if (!app.doc || !item) return;
    const p = app.panels[item.page];
    // The tape itself, or something under (or over) it.
    const isTape = tape && (p.render?.querySelector(`[data-tape="${CSS.escape(String(tape.id))}"]`)?.closest("[data-item]")?.dataset.item === String(item.id));
    const c = item.compound, name = c ? compoundLabel(c) : isTape ? "Tape" : ITEM_NAMES[item.kind] || "Item";
    let figure = null;
    if (c?.kind === "prefab") { try { figure = JSON.parse(c.spec || "{}"); } catch { /* Not one. */ } }
    const chart = Boolean(editorKind(figure)), solvable = chart && canBeExercise(figure), exercise = solvable && Boolean(figure.exercise);
    const uml = c?.kind === "prefab" && /"type":\s*"uml"/.test(c.spec || "");
    // "Edit histogram…", "Edit UML class diagram…": words in capitals stay so; a "Topic: Name"
    // (an algorithm, "Greedy: Dijkstra") is kept as it is.
    const lower = name.includes(": ") ? name : name.split(" ").map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(" ");
    openContextMenu(x, y, [
      ...zh,
      ...tapeEntries(p, tape),
      tape && "-",
      solvable && { label: `${exercise ? "Fill in" : "Solve"} ${lower}…`, icon: "draw", run: () => editCompound(item, "answer") },
      // A module's own entries (module.json "menu": [{ label, icon, mode }]): its editor opens
      // in that mode (host.mode), as "Play…" for an algorithm.
      ...((figure && moduleOf(figure)?.manifest.menu) || []).filter((m) => m?.label && m.mode).map((m) => ({ label: String(m.label), icon: m.icon || "graph", run: () => editCompound(item, String(m.mode)) })),
      c && { label: `Edit ${lower}…`, icon: uml ? "uml" : c.kind === "table" ? "table" : "graph", run: () => editCompound(item) },
      chart && { label: "Edit its data as JSON…", icon: "note", run: () => editCompound(item, "json") },
      item.kind === "text" && { label: "Edit text", icon: "text", run: () => editTextItem(item) },
      item.kind === "image" && !c && { label: "Crop", icon: "crop", run: () => { selection.show(item); selection.startCrop(); } },
      ...styleEntries(item),
      { label: "Move, resize or rotate", icon: "select", key: "S", run: () => { document.querySelector('#toolbar [data-tool="select"]')?.click(); selection.show(item); } },
      { label: "Cut", icon: "scissors", key: "Ctrl X", run: () => copyItem(item, { cut: true }) },
      { label: "Copy", icon: "copy", key: "Ctrl C", run: () => copyItem(item) },
      !c && item.kind !== "group" && { label: "Lock in place", icon: "lock", run: () => action("lock", { page: item.page, itemId: item.id, locked: true }).then(() => status("Locked: Select passes over it. Right-click it to unlock it.")) },
      "-",
      exportEntries(`${app.doc.title || "Note"} - ${name}`, (scale, type, quality) => itemPicture(item, scale, type, quality)),
      "-",
      { label: "Delete", icon: "trash", danger: true, key: "⇧ Right-click", run: () => removeItem(item).catch((e) => status(e.message, true)) },
    ], { title: name });
  }
  // The page menu's entries (menu-config.js keeps which, and their order).
  const PAGE_ACTIONS = [
    { id: "prefab", label: "Insert prefab here…", icon: "graph" },
    { id: "shape", label: "Insert shape", icon: "shape" },
    { id: "text", label: "Type text here", icon: "text" },
    { id: "image", label: "Insert image…", icon: "image" },
    { id: "uml", label: "Insert UML diagram here…", icon: "uml" },
    { id: "table", label: "Insert table here…", icon: "table" },
    { id: "export", label: "Export this page", icon: "export" },
    { id: "tape", label: "Tape (lift or cover all)", icon: "tape" },
    { id: "quick", label: "Quick menu", icon: "menu" },
    { id: "undo", label: "Undo", icon: "undo" },
    { id: "redo", label: "Redo", icon: "redo" },
  ];
  function pageEntry(id, p, at, x, y) {
    const box = [at[0], at[1], 0, 0];
    if (id === "-") return "-";
    if (id.startsWith("prefab:")) {
      const choice = PREFABS.find((q) => q.id === id.slice(7));
      return choice && { label: `Insert ${choice.label}`, icon: choice.icon || "graph", run: () => insertPrefab(p, box, choice) };
    }
    switch (id) {
      case "prefab": return { label: "Insert prefab here…", icon: "graph", key: "⇧X", run: () => insertPrefab(p, box), subtitle: "Recently used", submenu: () => {
        const recent = recentPrefabs(6);
        return [...recent.map((choice) => ({ label: choice.label, icon: choice.icon || "graph", run: () => insertPrefab(p, box, choice) })), recent.length && "-", { label: "All prefabs…", icon: "search", run: () => insertPrefab(p, box) }];
      } };
      case "shape": return { label: "Insert shape", icon: "shape", submenu: () => Object.entries(SHAPE_NAMES).map(([kind, label]) => ({
        label, icon: "shape", iconEl: document.querySelector(`#shapePicker [data-shape="${kind}"] svg`), run: () => insertShapeAt(p, at, kind),
      })) };
      case "text": return { label: "Type text here", icon: "text", run: () => { document.querySelector('#toolbar [data-tool="text"]').click(); textBox.open(p, at); } };
      case "image": return { label: "Insert image…", icon: "image", key: "⇧I", run: () => $("importImage").click() };
      case "uml": return { label: "Insert UML diagram here…", icon: "uml", run: () => insertUml(p, box) };
      case "table": return { label: "Insert table here…", icon: "table", run: () => insertCompound(p, "table", box) };
      case "export": return { ...exportEntries(`${app.doc.title || "Note"} - page ${p.index + 1}`, (scale, type, quality) => pagePicture(p.index, scale, type, quality)), label: "Export this page" };
      case "tape": return p.view?.tapes?.length ? { label: "Tape", icon: "tape", submenu: tapeEntries(p, p.view.tapes[0])[1].submenu } : null;
      case "quick": return { label: "Quick menu", icon: "menu", key: "⇧S", run: () => quick.open(x, y) };
      case "undo": return { label: "Undo", icon: "undo", key: "Ctrl Z", disabled: $("undo").disabled, run: () => $("undo").click() };
      case "redo": return { label: "Redo", icon: "redo", key: "Ctrl Shift Z", disabled: $("redo").disabled, run: () => $("redo").click() };
    }
    return null;
  }
  function customizePageMenuNow() {
    import("./menu-config.js").then(({ customizePageMenu }) => customizePageMenu({
      actions: PAGE_ACTIONS,
      prefabs: PREFABS.map((q) => ({ id: q.id, label: q.label, icon: q.icon })),
    })).then((order) => order && status("Page menu saved. Right-click the page to see it.")).catch((e) => status(e.message, true));
  }
  // What is at page point `at` of `p`: its menu (and it selected), or the page's.
  async function pageMenu(p, at, x, y) {
    if (!app.doc || !p?.view) return;
    const args = { page: p.index, x: at[0], y: at[1], tolerance: 8 * p.size[0] / p.el.getBoundingClientRect().width };
    const tape = tapeAt(p, at);
    // "Look up 你好" on top for Chinese under the pointer (chinese/zh-menu.js).
    const zh = await pageZhEntries(p, x, y).catch(() => []);
    try {
      const item = await pickWhole(args);
      if (item) { selection.show(item); return itemMenu(item, x, y, { tape, zh }); }
      const locked = await call("pickLock", args);
      if (locked?.locked) {
        return openContextMenu(x, y, [...tapeEntries(p, tape), tape && "-", { label: "Unlock", icon: "unlock", run: () => action("lock", { page: p.index, itemId: locked.id, locked: false }).then(() => status("Unlocked.")) }], { title: `${ITEM_NAMES[locked.kind] || "Item"} (locked)` });
      }
    } catch (e) { return status(e.message, true); }
    const { pageMenuOrder } = await import("./menu-config.js");
    const sharedUml = getSharedUmlClip();
    const canPastePage = Boolean(currentClip() || sharedUml);
    const runPagePaste = () => (currentClip() && (!sharedUml || (currentClip().at || 0) >= (sharedUml.at || 0)) ? pasteClip(p, at) : pasteUmlIntoPage(sharedUml, p, at));
    openContextMenu(x, y, [
      ...zh,
      ...tapeEntries(p, tape),
      tape && "-",
      canPastePage && { label: "Paste here", icon: "copy", key: "Ctrl V", run: runPagePaste },
      canPastePage && "-",
      ...pageMenuOrder().map((id) => pageEntry(id, p, at, x, y)),
      "-",
      ...(app.doc.canvas ? [] : [...blankPageEntries(p.index), "-"]),
      { label: "Customize this menu…", icon: "settings", run: customizePageMenuNow },
    ], { title: tape ? "Tape" : `Page ${p.index + 1}` });
  }
  // A finger held still for a moment opens the menu (as a right-click). Not while it draws: a
  // finger that pans, selects or types does; a second finger (two-finger hold, pinch) cancels it.
  const longPress = (() => {
    let timer = 0, at = null;
    const end = () => { clearTimeout(timer); timer = 0; at = null; };
    return {
      end,
      down(e, p) {
        if (timer) return end();
        if (e.pointerType !== "touch" || !app.doc || app.editing) return;
        at = { x: e.clientX, y: e.clientY, id: e.pointerId, p };
        timer = setTimeout(() => {
          const a = at;
          end();
          if (!a || app.editing || busy()) return;
          if (app.gesture && !(app.gesture.id === a.id && app.gesture.tool === "pan")) return;
          cancelGesture();
          selection.cancel?.();
          navigator.vibrate?.(12);
          // On a Chinese character: its panel at once (chinese/zh-menu.js); else the menu.
          pageZhLongPress(a.p, a.x, a.y).catch(() => false).then((opened) => opened || pageMenu(a.p, point({ clientX: a.x, clientY: a.y }, a.p), a.x, a.y));
        }, 550);
      },
      move(e) {
        if (at && e.pointerId === at.id && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 10) end();
      },
    };
  })();
  return { itemMenu, itemPicture, longPress, pageMenu };
}
