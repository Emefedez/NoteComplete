// The page dialogs: Pages → Insert (blank pages of a chosen size, or the pages of another
// PDF at their own scale) and Pages → Change PDF background (swap, reuse or clear the PDF
// behind chosen pages, extracting only the pages used when that saves space).
// app.js wires them in with pageDialogs(); `app` gives the open note's current state.
import { PRESETS, SPACE, UNITS_PER_POINT, blankSize, insertAt, pdfPages, unitsToMm } from "./insert-pages.js";
import { backgroundPlacement, openPdf } from "./pdf-background.js";
import { packPages } from "./page-export.js";
import { buildPageBackgroundChanges, bytesToBase64, formatBytes, parsePageSelection, shouldSuggestCompact, usedPdfPageIndices } from "./page-background.js";
import { refreshSelects } from "./select.js";

export function pageDialogs({ $, action, busy, call, status, app }) {
  // Pages → Insert: blank pages of a chosen size, or pages of another PDF at native scale.
  let insertPdfSource = null;
  for (const [value, { label }] of Object.entries(PRESETS)) $("insertPreset").add(new Option(label, value));
  for (const [value, { label }] of Object.entries(SPACE)) $("insertSpace").add(new Option(label, value));
  $("insertPreset").onchange = () => {
    $("insertCustom").hidden = $("insertPreset").value !== "custom";
  };
  function openInsert(pdf) {
    insertPdfSource = pdf;
    $("insertTitle").textContent = pdf ? "Insert PDF pages" : "Insert blank pages";
    $("insertSource").textContent = pdf ? `${pdf.name}: ${pdf.sizes.length} ${pdf.sizes.length === 1 ? "page" : "pages"}. The PDF keeps its scale; extra space is blank paper beside it.` : "New pages use white paper.";
    $("insertBlankOptions").hidden = !!pdf;
    $("insertPdfOptions").hidden = !pdf;
    const [w, h] = app.panels[app.page].size.map(unitsToMm);
    $("insertWidth").value = Math.round(w);
    $("insertHeight").value = Math.round(h);
    $("insertCustom").hidden = $("insertPreset").value !== "custom";
    if (pdf) {
      $("insertFrom").max = $("insertTo").max = pdf.sizes.length;
      $("insertFrom").value = 1;
      $("insertTo").value = pdf.sizes.length;
    }
    $("insertStatus").textContent = "";
    $("insertDialog").showModal();
  }
  $("insertBlank").onclick = () => app.doc && openInsert(null);
  $("insertPdf").onclick = () => app.doc && $("pdfPagesFile").click();
  $("pdfPagesFile").onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file || !app.doc) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await openPdf(bytes.slice());
      const sizes = [];
      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i), viewport = p.getViewport({ scale: 1 });
          sizes.push([viewport.width, viewport.height]);
          p.cleanup();
        }
      } finally {
        await pdf.loadingTask.destroy();
      }
      openInsert({ name: file.name, bytes, sizes });
    } catch (error) {
      status(`Could not read that PDF: ${error.message}`, true);
    }
  };
  // Units per PDF point in this note: from the current page's PDF when it has one.
  async function noteUnitsPerPoint() {
    const view = app.panels[app.page]?.view;
    if (!view?.pdf_background || !app.backgrounds) return UNITS_PER_POINT;
    try {
      const pdf = await app.backgrounds.document(view.pdf_background.resource_id);
      const p = await pdf.getPage(view.pdf_background.page_index + 1);
      const width = p.getViewport({ scale: 1 }).width;
      p.cleanup();
      const ratio = backgroundPlacement(view.pdf_background, view.size).width / width;
      return Number.isFinite(ratio) && ratio > 0 ? ratio : UNITS_PER_POINT;
    } catch {
      return UNITS_PER_POINT;
    }
  }
  $("insertCancel").onclick = () => $("insertDialog").close();
  $("insertConfirm").onclick = async () => {
    if (!app.doc || busy()) return;
    const at = insertAt($("insertWhere").value, app.page, app.doc.pages);
    let pages, pdf;
    if (insertPdfSource) {
      const count = insertPdfSource.sizes.length;
      const from = Math.max(1, Math.min(count, Number($("insertFrom").value) || 1)) - 1;
      const to = Math.max(from + 1, Math.min(count, Number($("insertTo").value) || count)) - 1;
      const id = "pdf-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
      pages = pdfPages(id, insertPdfSource.sizes, from, to, $("insertSpace").value, await noteUnitsPerPoint());
      let binary = "";
      for (let i = 0; i < insertPdfSource.bytes.length; i += 0x8000)
        binary += String.fromCharCode(...insertPdfSource.bytes.subarray(i, i + 0x8000));
      pdf = { id, base64: btoa(binary) };
    } else {
      const size = blankSize($("insertPreset").value, app.panels[app.page].size, [Number($("insertWidth").value), Number($("insertHeight").value)]);
      if (size.some((v) => !(v >= 10))) {
        $("insertStatus").textContent = "Enter a width and height of at least 20 mm.";
        return;
      }
      const count = Math.max(1, Math.min(100, Number($("insertCount").value) || 1));
      pages = Array.from({ length: count }, () => ({ size }));
    }
    $("insertDialog").close();
    await action("insertPages", { at, pages, pdf, focus: at });
  };
  // Pages -> Change PDF background: swap, reuse, or clear the PDF on selected pages while keeping size sane.
  let pageBgState = { existing: [], uploaded: null, sizesCache: new Map(), compactTouched: false };
  async function readPdfSizes(bytes) {
    const pdf = await openPdf(bytes.slice());
    const sizes = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i), viewport = p.getViewport({ scale: 1 });
        sizes.push([viewport.width, viewport.height]);
        p.cleanup();
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
    return sizes;
  }
  async function ensureBgPdfSizes(sourceKey) {
    if (sourceKey === "none") return [];
    if (sourceKey === "uploaded") return pageBgState.uploaded?.sizes || [];
    if (pageBgState.sizesCache.has(sourceKey)) return pageBgState.sizesCache.get(sourceKey);
    if (!app.backgrounds) return [];
    const pdf = await app.backgrounds.document(sourceKey);
    const sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i), viewport = p.getViewport({ scale: 1 });
      sizes.push([viewport.width, viewport.height]);
      p.cleanup();
    }
    pageBgState.sizesCache.set(sourceKey, sizes);
    return sizes;
  }
  async function extractPdfPagesAsCompactPdf(bytes, indices, title) {
    const src = await openPdf(bytes.slice());
    const drawn = [];
    try {
      for (const i of indices) {
        const p = await src.getPage(i + 1);
        const vp1 = p.getViewport({ scale: 1 });
        const scale = Math.min(2.2, Math.max(1, 2200 / Math.max(vp1.width, vp1.height)));
        const viewport = p.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await p.render({ canvasContext: ctx, viewport }).promise;
        p.cleanup();
        const blob = await new Promise((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(Error("Could not render PDF page."))), "image/jpeg", 0.86),
        );
        drawn.push({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          widthPx: canvas.width,
          heightPx: canvas.height,
          widthPt: vp1.width,
          heightPt: vp1.height,
        });
        canvas.width = canvas.height = 0;
      }
    } finally {
      await src.loadingTask.destroy();
    }
    const { data, layout } = packPages(drawn);
    return await call("jpegPagesPdf", { data, layout, title });
  }
  function updatePageBgDialog() {
    const sourceVal = $("pageBgSource").value;
    const isNone = sourceVal === "none";
    const isUploaded = sourceVal === "uploaded" && !!pageBgState.uploaded;
    $("pageBgPdfOptions").hidden = isNone;
    $("pageBgPicked").hidden = !isUploaded;
    if (isUploaded) {
      const up = pageBgState.uploaded;
      $("pageBgPicked").textContent = `${up.name} (${up.sizes.length} page${up.sizes.length === 1 ? "" : "s"}, ${formatBytes(up.bytes.length)})`;
    }
    const parsed = parsePageSelection($("pageBgTarget").value, app.doc?.pages || 0);
    $("pageBgError").hidden = !parsed.error;
    $("pageBgError").textContent = parsed.error || "";
    const sizes = isNone ? [] : isUploaded ? pageBgState.uploaded.sizes : pageBgState.sizesCache.get(sourceVal) || [];
    if (!isNone && sizes.length) $("pageBgFrom").max = String(sizes.length);
    const noteEl = $("pageBgSizeNote");
    noteEl.classList.remove("warn");
    if (isNone) {
      $("pageBgCompactRow").hidden = true;
      noteEl.textContent = parsed.indices
        ? `Clears PDF background on ${parsed.indices.length} page${parsed.indices.length === 1 ? "" : "s"}. Unused PDFs are pruned when exporting or compacting.`
        : "Clears the PDF background to plain paper.";
      $("pageBgApply").disabled = !!parsed.error;
      return;
    }
    if (!sizes.length) {
      $("pageBgCompactRow").hidden = true;
      noteEl.textContent = isUploaded ? "" : "Loading PDF info…";
      $("pageBgApply").disabled = !!parsed.error || (sourceVal === "uploaded" && !isUploaded);
      return;
    }
    const startPdf = Math.max(0, Math.min(sizes.length - 1, (Number($("pageBgFrom").value) || 1) - 1));
    const used = usedPdfPageIndices({
      noteCount: parsed.indices?.length || 1,
      pdfPageCount: sizes.length,
      startPdfPage: startPdf,
      mode: $("pageBgMode").value,
    });
    if (isUploaded) {
      const up = pageBgState.uploaded;
      const suggest = shouldSuggestCompact(up.bytes.length, up.sizes.length, used.length);
      $("pageBgCompactRow").hidden = used.length >= up.sizes.length;
      if (!pageBgState.compactTouched) $("pageBgCompact").checked = suggest;
      const compact = !$("pageBgCompactRow").hidden && $("pageBgCompact").checked;
      if (compact) {
        noteEl.textContent = `Extracts ${used.length} of ${up.sizes.length} pages (~${formatBytes(used.length * 160 * 1024)} est. instead of ${formatBytes(up.bytes.length)}).`;
      } else if (suggest) {
        noteEl.textContent = `Warning: keeping full PDF embeds ${formatBytes(up.bytes.length)} even though only ${used.length} of ${up.sizes.length} pages are used.`;
        noteEl.classList.add("warn");
      } else {
        noteEl.textContent = `Embeds ${formatBytes(up.bytes.length)}${$("pageBgMode").value === "sequence" && parsed.indices && startPdf + parsed.indices.length > sizes.length ? " (PDF reaches its last page and repeats it)" : ""}.`;
        if (up.bytes.length >= 4 * 1024 * 1024) noteEl.classList.add("warn");
      }
    } else {
      $("pageBgCompactRow").hidden = true;
      const existing = pageBgState.existing.find((e) => e.id === sourceVal);
      noteEl.textContent = `Reuses PDF already in note (${existing ? formatBytes(existing.bytes) : "in note"}, +0 B added).`;
    }
    $("pageBgApply").disabled = !!parsed.error;
  }
  async function openPageBackground(initialTarget = String(app.page + 1)) {
    if (!app.doc || app.doc.canvas || busy()) return;
    pageBgState = {
      existing: await call("pdfResources").catch(() => []),
      uploaded: null,
      sizesCache: pageBgState.sizesCache,
      compactTouched: false,
    };
    const select = $("pageBgSource");
    select.replaceChildren();
    const currentRes = app.panels[app.page]?.view?.pdf_background?.resource_id;
    for (const [idx, item] of pageBgState.existing.entries()) {
      const label = `${item.id === currentRes ? "Current PDF in note" : `PDF #${idx + 1} in note`} (${formatBytes(item.bytes)}, +0 B)`;
      select.add(new Option(label, item.id));
    }
    select.add(new Option("Plain white paper (clear PDF)", "none"));
    if (currentRes && pageBgState.existing.some((e) => e.id === currentRes)) select.value = currentRes;
    $("pageBgTarget").value = initialTarget;
    $("pageBgFrom").value = String((app.panels[app.page]?.view?.pdf_background?.page_index ?? 0) + 1);
    $("pageBgMode").value = "sequence";
    $("pageBgSizeMode").value = "fit";
    $("pageBgCompact").checked = false;
    refreshSelects($("pageBgDialog"));
    updatePageBgDialog();
    if (select.value !== "none") {
      ensureBgPdfSizes(select.value).then(() => { if ($("pageBgDialog").open) updatePageBgDialog(); }).catch(() => {});
    }
    $("pageBgDialog").showModal();
  }
  $("changePageBg").onclick = () => openPageBackground(String(app.page + 1));
  $("pagesChangeBg").onclick = () => openPageBackground(String(app.page + 1));
  $("pageBgTargetCurrent").onclick = () => { $("pageBgTarget").value = String(app.page + 1); updatePageBgDialog(); };
  $("pageBgTargetAll").onclick = () => { $("pageBgTarget").value = app.doc?.pages > 1 ? `1-${app.doc.pages}` : "1"; updatePageBgDialog(); };
  $("pageBgTarget").oninput = updatePageBgDialog;
  $("pageBgFrom").oninput = updatePageBgDialog;
  $("pageBgMode").onchange = updatePageBgDialog;
  $("pageBgSizeMode").onchange = updatePageBgDialog;
  $("pageBgCompact").onchange = () => { pageBgState.compactTouched = true; updatePageBgDialog(); };
  $("pageBgSource").onchange = () => {
    const val = $("pageBgSource").value;
    updatePageBgDialog();
    if (val !== "none" && val !== "uploaded") {
      ensureBgPdfSizes(val).then(() => { if ($("pageBgDialog").open) updatePageBgDialog(); }).catch((e) => status(e.message, true));
    }
  };
  $("pageBgPick").onclick = () => $("pdfBgFile").click();
  $("pdfBgFile").onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file || !app.doc) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sizes = await readPdfSizes(bytes);
      pageBgState.uploaded = { name: file.name, bytes, sizes };
      pageBgState.compactTouched = false;
      const select = $("pageBgSource");
      let opt = select.querySelector('option[value="uploaded"]');
      if (!opt) {
        opt = new Option("", "uploaded");
        select.prepend(opt);
      }
      opt.textContent = `${file.name} (${formatBytes(bytes.length)})`;
      select.value = "uploaded";
      refreshSelects($("pageBgDialog"));
      $("pageBgFrom").value = "1";
      updatePageBgDialog();
    } catch (error) {
      status(`Could not read that PDF: ${error.message}`, true);
    }
  };
  $("pageBgCancel").onclick = () => $("pageBgDialog").close();
  $("pageBgApply").onclick = async () => {
    if (!app.doc || busy()) return;
    const parsed = parsePageSelection($("pageBgTarget").value, app.doc.pages);
    if (parsed.error) return updatePageBgDialog();
    const noteIndices = parsed.indices;
    const currentSizes = app.panels.map((p) => p.size);
    const sourceVal = $("pageBgSource").value;
    if (sourceVal === "none") {
      $("pageBgDialog").close();
      const pages = buildPageBackgroundChanges({ noteIndices, currentSizes, source: { kind: "none" } });
      await action("setPageBackgrounds", { pages, focus: noteIndices[0] });
      return;
    }
    const startPdf = Math.max(0, (Number($("pageBgFrom").value) || 1) - 1);
    const mode = $("pageBgMode").value;
    const sizeMode = $("pageBgSizeMode").value;
    const upp = await noteUnitsPerPoint();
    if (sourceVal === "uploaded") {
      const up = pageBgState.uploaded;
      if (!up) return;
      const used = usedPdfPageIndices({ noteCount: noteIndices.length, pdfPageCount: up.sizes.length, startPdfPage: startPdf, mode });
      const useCompact = !$("pageBgCompactRow").hidden && $("pageBgCompact").checked && used.length < up.sizes.length;
      let pdfBytes = up.bytes;
      let remap = null;
      if (useCompact) {
        $("pageBgApply").disabled = true;
        $("pageBgSizeNote").textContent = `Extracting ${used.length} page${used.length === 1 ? "" : "s"}…`;
        try {
          pdfBytes = await extractPdfPagesAsCompactPdf(up.bytes, used, up.name);
          remap = new Map(used.map((srcIdx, i) => [srcIdx, i]));
        } catch (error) {
          updatePageBgDialog();
          return status(`Could not extract PDF pages: ${error.message}`, true);
        }
      }
      const id = "pdf-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
      const pages = buildPageBackgroundChanges({
        noteIndices,
        currentSizes,
        source: { kind: "pdf", resourceId: id },
        pdfSizesPt: up.sizes,
        startPdfPage: startPdf,
        mode,
        sizeMode,
        unitsPerPoint: upp,
        remapIndices: remap,
      });
      $("pageBgDialog").close();
      await action("setPageBackgrounds", { pages, pdf: { id, base64: bytesToBase64(pdfBytes) }, focus: noteIndices[0] });
      return;
    }
    const sizesPt = await ensureBgPdfSizes(sourceVal);
    const pages = buildPageBackgroundChanges({
      noteIndices,
      currentSizes,
      source: { kind: "pdf", resourceId: sourceVal },
      pdfSizesPt: sizesPt,
      startPdfPage: startPdf,
      mode,
      sizeMode,
      unitsPerPoint: upp,
    });
    $("pageBgDialog").close();
    await action("setPageBackgrounds", { pages, focus: noteIndices[0] });
  };
  // A PDF's pages added after the last page, at its own scale (a file sent to this note from the
  // browser extension, send-in.js): what Insert PDF pages does with its defaults.
  async function appendPdf(bytes, name = "PDF") {
    if (!app.doc) throw Error("No note is open.");
    const sizes = await readPdfSizes(bytes);
    if (!sizes.length) throw Error(`${name} has no pages.`);
    const id = "pdf-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    const at = app.doc.pages;
    const pages = pdfPages(id, sizes, 0, sizes.length - 1, "none", await noteUnitsPerPoint());
    await action("insertPages", { at, pages, pdf: { id, base64: bytesToBase64(bytes) }, focus: at });
    return sizes.length;
  }
  return { openPageBackground, appendPdf };
}
