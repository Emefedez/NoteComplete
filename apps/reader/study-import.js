// Importing study material (.ncstudy packs, flashcard deck JSON, Quiz Toolkit Markdown):
// choose which note it belongs to (the open one, a recent one, or kept on its own), merge
// it with what that note already has, and open it. app.js wires it in with studyImport().
import { entrySourceLabel } from "./library.js";
import { noteFingerprint } from "./find.js";

export function studyImport({ $, library, quizIndex, quizIndexFp, quizzes, sideView, status, study, app }) {
  // Study material (.ncstudy, flashcard deck JSON, or Quiz Toolkit Markdown) kept on this device.
  async function pickImportTarget(pack, { preferOpen = false } = {}) {
    const { describePack } = await import("./study-pack.js");
    const openFp = quizIndexFp();
    const options = [];
    const seenKeys = new Set();
    const seenFps = new Set();

    if (openFp) {
      const openTitle = app.doc?.title || sideView()?.name || $("title").textContent || "Current note";
      seenFps.add(openFp);
      if (app.noteEntryKey) seenKeys.add(app.noteEntryKey);
      options.push({
        id: `fp:${openFp}`,
        fingerprint: openFp,
        title: openTitle,
        entryKey: app.noteEntryKey || "",
        meta: pack.fingerprint === openFp ? "Open now · matches this pack" : "Open now",
        matched: pack.fingerprint === openFp,
      });
    }

    const settingKeys = (await library.store.keys("settings").catch(() => [])) || [];
    const storedDocs = [];
    for (const key of settingKeys) {
      if (typeof key !== "string" || !key.startsWith("doc:")) continue;
      const fp = key.slice(4);
      if (!fp || fp.startsWith("general:") || fp.startsWith("received:") || seenFps.has(fp)) continue;
      const rec = await library.store.get("settings", key).catch(() => null);
      if (!rec?.title) continue;
      storedDocs.push({ fp, rec });
    }
    storedDocs.sort((a, b) => (b.fp === pack.fingerprint ? 1 : 0) - (a.fp === pack.fingerprint ? 1 : 0) || (b.rec.at || 0) - (a.rec.at || 0));
    for (const { fp, rec } of storedDocs) {
      seenFps.add(fp);
      if (rec.entryKey) seenKeys.add(rec.entryKey);
      options.push({
        id: `fp:${fp}`,
        fingerprint: fp,
        title: rec.title,
        entryKey: rec.entryKey || "",
        meta: fp === pack.fingerprint ? "Matches this pack" : "Saved note on this device",
        matched: fp === pack.fingerprint,
      });
    }

    for (const entry of await library.recent(60).catch(() => [])) {
      if (!entry?.key || seenKeys.has(entry.key)) continue;
      seenKeys.add(entry.key);
      const cleanTitle = String(entry.name || "Note").replace(/\.(noteful|nfedit|notecomp(lete)?|notepart|goodnotes|ntb)$/i, "");
      options.push({
        id: `entry:${entry.key}`,
        entry,
        title: cleanTitle,
        entryKey: entry.key,
        meta: entrySourceLabel(entry) + (entry.modifiedTime ? ` · ${new Date(entry.modifiedTime).toLocaleDateString()}` : ""),
        matched: false,
      });
    }

    options.push({
      id: "__general__",
      general: true,
      title: "General (not tied to a note)",
      meta: "Always playable in Study → All quizzes and decks…",
      matched: false,
    });

    const defaultChoice =
      options.find((o) => o.matched) ||
      (preferOpen && openFp ? options.find((o) => o.fingerprint === openFp) : null) ||
      options.find((o) => o.general);

    return new Promise((resolve) => {
      const dialogEl = $("importTargetDialog");
      const listEl = $("importTargetList");
      const filterEl = $("importTargetFilter");
      const statusEl = $("importTargetStatus");
      const confirmBtn = $("importTargetConfirm");
      let chosen = defaultChoice;

      $("importTargetTitle").textContent = `Import “${pack.title}”`;
      $("importTargetSummary").textContent = `${describePack(pack)}. Pick which note this belongs to, or keep it as a general study set.`;
      filterEl.value = "";
      statusEl.textContent = "";
      confirmBtn.disabled = false;

      const renderList = () => {
        const q = filterEl.value.trim().toLowerCase();
        const shown = options.filter((o) => o.general || !q || o.title.toLowerCase().includes(q) || o.meta.toLowerCase().includes(q));
        listEl.replaceChildren(...shown.map((opt) => {
          const row = document.createElement("label");
          row.className = "migrate-row";
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = "importTargetChoice";
          radio.value = opt.id;
          radio.checked = chosen?.id === opt.id;
          radio.onchange = () => { chosen = opt; statusEl.textContent = ""; };
          const name = document.createElement("span");
          name.textContent = opt.title;
          const meta = document.createElement("span");
          meta.className = "muted";
          meta.textContent = opt.meta;
          row.append(radio, name, meta);
          return row;
        }));
      };
      filterEl.oninput = renderList;
      renderList();

      const finish = (value) => {
        dialogEl.oncancel = null;
        if (dialogEl.open) dialogEl.close();
        resolve(value);
      };
      $("importTargetCancel").onclick = () => finish(null);
      dialogEl.oncancel = (event) => { event.preventDefault(); finish(null); };
      confirmBtn.onclick = async () => {
        if (!chosen) return;
        if (chosen.general) return finish({ general: true, title: pack.title });
        if (chosen.fingerprint) return finish({ fingerprint: chosen.fingerprint, title: chosen.title, entryKey: chosen.entryKey || "" });
        confirmBtn.disabled = true;
        statusEl.textContent = `Reading “${chosen.title}”…`;
        try {
          const file = await library.open(chosen.entry);
          if (!file) throw Error(`${chosen.title} is no longer kept on this device. Open it once first.`);
          const fp = await noteFingerprint(file);
          if (!fp) throw Error(`Could not identify “${chosen.title}”.`);
          finish({ fingerprint: fp, title: chosen.title, entryKey: chosen.entryKey });
        } catch (err) {
          confirmBtn.disabled = false;
          statusEl.textContent = err.message;
        }
      };
      if (!dialogEl.open) dialogEl.showModal();
    });
  }

  async function importStudyWithChoice(pack, { preferOpen = false, openAfter = true, extraNote = "" } = {}) {
    const { importPack, describePack } = await import("./study-pack.js");
    const target = await pickImportTarget(pack, { preferOpen });
    if (!target) return { cancelled: true };
    const result = await importPack(library.store, pack, { target });
    const where = result.general
      ? `as “${pack.title}${pack.from ? ` (from ${pack.from})` : ""}” (General) in Study → All quizzes and decks`
      : `into “${target.title}”`;
    status(`Imported ${describePack(pack)} ${where}.${extraNote}`);
    if (openAfter) {
      if (pack.quizzes?.length === 1 && !pack.decks?.length) {
        quizzes.open(pack.quizzes[0], `quizzes:${result.fingerprint}`);
      } else if (!pack.quizzes?.length && pack.decks?.length === 1) {
        await study.openDeck(pack.decks[0].id, result.fingerprint);
      } else {
        const inCurrent = !result.general && result.fingerprint === quizIndexFp();
        await quizIndex.open({ scope: inCurrent ? "note" : "all" });
      }
    }
    return { ...result, targetTitle: target.title };
  }

  async function importStudyFile(file, kindHint = null) {
    try {
      const { readPack } = await import("./study-pack.js");
      if (file.size > 24 * 1024 * 1024) throw Error("That file is too large to be study material.");
      const text = await file.text();
      let pack;
      let preferOpen = false;
      let extraNote = "";
      const effectiveKind = kindHint || (/\.(md|markdown)$/i.test(file.name) ? "quiz-markdown" : null);
      if (effectiveKind === "quiz-markdown") {
        const { packFromMarkdown } = await import("./quiz-import.js");
        let skipped = 0, skippedNoAnswer = 0, missingImages = 0;
        ({ pack, skipped, skippedNoAnswer, missingImages } = packFromMarkdown(text, file.name.replace(/\.[^.]+$/, "")));
        pack = readPack(pack);
        // One file is one battery: all its tests together as a single quiz, named after the file.
        if (pack.quizzes.length > 1) pack.quizzes = [{ ...pack.quizzes[0], title: pack.title, questions: pack.quizzes.flatMap((z) => z.questions) }];
        preferOpen = true;
        extraNote = `${skipped ? ` ${skipped} skipped${skippedNoAnswer ? `: ${skippedNoAnswer} have no recorded answer, ${skipped - skippedNoAnswer} are matching, blanks, numeric or short answer` : ": not multiple choice"}.` : ""}${missingImages ? ` ${missingImages} picture${missingImages === 1 ? "" : "s"} left out: they were separate files; use “For NoteComplete .md” in Quiz Toolkit.` : ""}`;
      } else if (effectiveKind === "deck") {
        const value = JSON.parse(text);
        const decks = (Array.isArray(value) ? value : [value])
          .map((d, i) => ({
            id: `${Date.now()}-${i}`,
            title: String(d?.title || file.name.replace(/\.[^.]+$/, "") || "Flashcards"),
            created: Number(d?.created) || Date.now(),
            cards: (Array.isArray(d?.cards) ? d.cards : [])
              .map((c) => ({ front: String(c?.front || "").trim(), back: String(c?.back || "").trim(), ...(c?.page ? { page: c.page } : {}) }))
              .filter((c) => c.front && c.back),
          }))
          .filter((d) => d.cards.length);
        if (!decks.length) throw Error("No flashcards found in that file.");
        pack = readPack({ format: "notecomplete-study", version: 1, title: decks[0].title, created: Date.now(), decks });
        preferOpen = true;
      } else {
        pack = readPack(text);
      }
      await importStudyWithChoice(pack, { preferOpen, openAfter: true, extraNote });
    } catch (e) { status(e.message, true); }
  }
  return { importStudyFile, importStudyWithChoice };
}
