import { modelPicker } from "./model-picker.js";
import { compactDialect } from "./small-model.js";
import { createDocOrchestrator } from "./ai-failover.js";
import { icon } from "./icons.js";
import { createSourcePicker } from "./source-picker.js";
import { resolveSources, formatSourceBundle } from "./source-extract.js";
import { buildContinuationPrompt, saveAiDraft, loadAiDraft, clearAiDraft } from "./ai-context.js";

// Markdown into handwritten pages, with the same engine as the MCP ink tools:
// a dialog with the Markdown, the look and a live preview, that creates a new
// note or inserts the pages into the open one. The dialog is built here so the
// page markup stays as it is until it is first opened.

export const LOOK_FIELDS = {
  look: [["study", "Study notes"], ["classic", "Plain notebook"]],
  theme: [["light", "Ivory page"], ["dark", "Black page"]],
  paper: [["dot", "Dots"], ["grid", "Squares"], ["ruled", "Lines"], ["blank", "Blank"]],
  font: [["patrick", "Patrick Hand"], ["caveat", "Caveat"], ["readability", "Readability"], ["felix", "Felix"], ["allure", "Allure"], ["elfin", "Elfin"], ["nixish", "Nixish"]],
  hand: [["", "Default"], ["neat", "Neat"], ["natural", "Natural"], ["messy", "Messy"]],
  pen: [["", "Default"], ["fineliner", "Fineliner"], ["ballpoint", "Ballpoint (pressure)"]],
  accent: [["sky", "Sky"], ["coral", "Coral"], ["amber", "Amber"], ["purple", "Purple"], ["teal", "Teal"], ["pink", "Pink"]],
};
const LABELS = { look: "Look", theme: "Page", paper: "Paper", font: "Handwriting", hand: "Hand", pen: "Pen", accent: "Colour" };
const STORE = "notecomplete-handwriting";
export const SAMPLE = "# MY **TOPIC**\n_Subject · week 1_\n## First idea\nWrite **key terms** in colour and ==highlight== what matters.\n- a point\n- another point\n> [sky] DEFINITION: a card for the main idea ((a detail in grey))\n!stat 42 a number worth remembering";

export const CHEATSHEET = [
  {
    group: "Headings & Doodles",
    items: [
      { label: "Title + doodle", code: "# **CARDIAC** CYCLE :heart:", hint: "sun, star, atom, drop, bolt, cloud, leaf" },
      { label: "Two-line title", code: "# SOLAR & TERRESTRIAL // RADIATION", hint: "Second line on marker band" },
      { label: "Subtitle", code: "_Subject · week 1_", hint: "Thin rule below title" },
      { label: "Section", code: "## **SMOOTH** MUSCLE", hint: "Coloured capitals + rule" },
      { label: "Sub-label", code: "### Key step", hint: "Small accent heading" },
    ],
  },
  {
    group: "Text & Emphasis",
    items: [
      { label: "Accent term", code: "**important term**", hint: "Active accent colour" },
      { label: "Highlight", code: "=={pink}key phrase==", hint: "pastel fill behind text" },
      { label: "Tag pill & grey", code: "[[tag]] ((grey detail))", hint: "Pill badge & note aside" },
      { label: "Math & symbols", code: "CO_2 · T^4 · λ_{max} → ∞ ± 5%", hint: "Greek letters, sub/superscript" },
      { label: "Bullets & arrows", code: "- dot\n* star\n-> implies\n1. step one\n[ ] task", hint: "List markers" },
    ],
  },
  {
    group: "Cards, Zones & Diagrams",
    items: [
      { label: "Card", code: "> [sky] IDEA: main takeaway ((detail))", hint: "Pastel card box" },
      { label: "2-col cards", code: ">> CAUSE: X happened || EFFECT: Y followed", hint: "Side-by-side cards" },
      { label: "Sticky note", code: "!sticky [yellow] EXAM TIP: check units!", hint: "Taped tilted sticky" },
      { label: "Big stat", code: "!stat 30 % reflected (albedo)", hint: "Hero metric" },
      { label: "Band zone", code: "!zone [teal]\n## Topic\n- summary\n!end", hint: "Full-width tinted band" },
      { label: "Two columns", code: "!columns 55\nLeft text\n!col\nRight text\n!end", hint: "55% / 45% split" },
      { label: "Tree map", code: "!map TOPIC | Main branch\n- Subtopic A\n  - Detail 1", hint: "Branching concept map" },
      { label: "Ink SVG diagram", code: '!draw 480\n<svg viewBox="0 0 400 220">\n  <rect x="20" y="30" width="140" height="80" rx="10" fill="#bae6fd" stroke="#1f2233" stroke-width="2"/>\n  <text x="90" y="75" font-size="20" text-anchor="middle">Input</text>\n  <line x1="160" y1="70" x2="230" y2="70" stroke="#1f2233" stroke-width="2"/>\n  <rect x="230" y="30" width="140" height="80" rx="10" fill="#fde68a" stroke="#1f2233" stroke-width="2"/>\n  <text x="300" y="75" font-size="20" text-anchor="middle">Output</text>\n</svg>\n!end', hint: "Hand-drawn SVG diagram" },
      { label: "Tape & break", code: "!tape [mint]\n---\n\\pagebreak", hint: "Washi tape, rule, new page" },
    ],
  },
];

// The choices of New note with AI: [id, label, what the AI tool is told].
export const NOTE_LENGTHS = [
  ["standard", "Standard · 1–2 pages", "Keep it to one or two pages unless the material needs more"],
  ["short", "Short · 1 page", "Fit it on one page: only the essentials"],
  ["detailed", "Detailed · 3–5 pages", "Write three to five pages that cover every important point"],
  ["full", "As long as needed", "Cover all of the material, however many pages it takes"],
];
export const NOTE_FOCUS = [
  ["overview", "Overview", ""],
  ["exam", "Exam prep", "Aim it at exam revision: definitions, key facts, typical questions and common mistakes, each easy to find."],
  ["steps", "Worked examples", "Explain processes step by step, with a short worked example for each method."],
  ["formulas", "Formulas & methods", "Centre it on formulas, rules and methods: each one in a card with what its symbols mean and when to use it."],
  ["compare", "Compare & contrast", "Organise it around comparisons: side-by-side cards or columns of similarities and differences."],
];
export const NOTE_LEVELS = [
  ["course", "Course level", ""],
  ["intro", "Introductory", "Write for a beginner: plain words, every term explained the first time."],
  ["advanced", "Advanced", "Write for an advanced student: precise terms, no basics, the subtle points."],
];
export const NOTE_LANGUAGES = [["auto", "Match the request"], ["English", "English"], ["Spanish", "Español"], ["French", "Français"], ["German", "Deutsch"]];
const hint = (list, id) => list.find(([key]) => key === id)?.[2] || "";

// What the AI tool is asked for: study notes about a topic (or from pasted material and
// chosen documents) in the handwriting dialect, so the answer goes straight into the preview.
// Without the New note options it asks what Take notes with AI has always asked.
export function aiPrompt({ request = "", dialect, look = "study", documents = "", length = "", focus = "", level = "", language = "", diagrams = true, strict = false, instructions = "" }) {
  const lengthHint = hint(NOTE_LENGTHS, length) || NOTE_LENGTHS[0][2];
  const languageLine = language && language !== "auto" ? `Write every word in ${language}.` : documents && !request.trim() ? "Write in the language of the documents." : "Write in the language of the request.";
  const sourcesLine = !documents ? "If the request includes data or notes, use them faithfully and do not invent facts."
    : strict ? "Use only what the documents below say: do not add facts from elsewhere. If the request asks for something they do not cover, say so in a short ((grey note)) instead of inventing it."
    : "Base the note on the documents below and follow what they say; add well-known background only where it makes them clearer, never against them. Use the request's data or notes faithfully.";
  return [
    "Write a note about the request below as Handwriting Markdown for NoteComplete, which writes it as real handwriting ink on A4 pages.",
    "Answer with the Markdown only: no code fences, no comments before or after it.",
    `Use the ${look === "classic" ? "classic (plain notebook)" : "study (composed study notes)"} look. ${languageLine}`,
    `${lengthHint} (\\pagebreak starts a page). Prefer short lines, key terms in **bold**, ==highlights==, cards and lists over long paragraphs; ${diagrams ? "add a !draw diagram only when it explains something." : "do not add !draw diagrams."}`,
    [hint(NOTE_FOCUS, focus), hint(NOTE_LEVELS, level)].filter(Boolean).join(" "),
    sourcesLine,
    instructions.trim() ? "The student's instructions (follow them):\n" + instructions.trim() : "",
    "The dialect:\n" + dialect,
    documents ? "The documents:\n" + documents : "",
    "The request:\n" + (request.trim() || "A study note that covers the documents above."),
  ].filter(Boolean).join("\n\n");
}
// Your own Markdown, rewritten in the full handwriting syntax (highlights, cards, colours,
// drawings) without changing what it says.
export function aiEnrichPrompt({ markdown, dialect, look = "study" }) {
  return [
    "Rewrite the Markdown note below as Handwriting Markdown for NoteComplete, which writes it as real handwriting ink on A4 pages.",
    "Keep every fact, term and section of the original, in its language and order; do not add new facts. Change only the form: a title and subtitle, coloured section headings, key terms in **bold**, ==highlights==, [[tags]], ((grey details)), cards (> [colour] TITLE: text), side-by-side cards, columns, zones, sticky notes, !stat numbers, and a !draw diagram where a picture explains something better than words.",
    `Use the ${look === "classic" ? "classic (plain notebook)" : "study (composed study notes)"} look. Keep \\pagebreak where the original has page breaks, and keep <!-- page N --> markers if there are any.`,
    "Answer with the Markdown only: no code fences, no comments before or after it.",
    "The dialect:\n" + dialect,
    "The note:\n" + markdown.trim(),
  ].join("\n\n");
}
// The Markdown in an answer: code fences some tools add anyway are taken off.
export function answerMarkdown(text) {
  const fenced = String(text).match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return (fenced ? fenced[1] : String(text)).trim();
}
// A name for the note from its first heading.
export function titleOf(markdown) {
  const line = String(markdown).split("\n").find((l) => /^#\s/.test(l));
  return line ? line.replace(/^#\s+/, "").replace(/[*_=]+|\[\[|\]\]|:[a-z]+:/g, "").replace(/\s*\/\/\s*/, " ").trim().slice(0, 80) : "";
}

// The options the core expects, from the dialog's values (empty means default).
export function optionsFrom(values) {
  const out = {};
  for (const key of Object.keys(LOOK_FIELDS)) {
    const v = String(values[key] ?? "").trim();
    if (v && LOOK_FIELDS[key].some(([id]) => id === v)) out[key] = v;
  }
  const size = Number(values.size);
  if (Number.isFinite(size) && size >= 4 && size <= 60 && size !== 11) out.size = size;
  return out;
}

const PROMPT_STORE = "notecomplete-note-ai-prefs";
const DRAFT_KEY = "notecomplete-note-draft";
const optionList = (list) => list.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");

// The handwriting dialog. Two tabs: "From a prompt" (New note with AI: a request, documents
// to base it on, length, focus, level, language and instructions) and "From Markdown" (your
// own Markdown, which the AI tool can make richer). Both stream into the same Markdown, with
// undo and a live preview, and end in a new note (saved to a folder if you choose one) or
// pages inserted into the open note.
export function handwritingConverter({
  call, status, onCreate, onInsert, sourceText = () => "", hasDocument = () => false, store = globalThis.localStorage, ai = null,
  // What documents and saving need, asked for on first open (the app makes some of it later):
  // { openPdf, library, groups, hasOpenDoc, openDocTitle, openDocPages, openDocResource,
  //   pageText, pageCanvas, notesText, openGeneratedFile, refreshHome } — the same sources as
  // Create exam with AI, and a note saved straight to Recent or a folder.
  context = () => ({}),
}) {
  let dialog = null, timer = 0, ask = 0, writing = null, model = null, typing = 0, picker = null, insertFirst = false;
  let openPdf = null, library = null, groups = null, pageText = null, pageCanvas = null, notesText = null, openGeneratedFile = null, refreshHome = null;
  let hasOpenDoc = () => false, openDocTitle = () => "Current note", openDocPages = () => 0, openDocResource = () => ({});
  // The Markdown's history: past versions and the position in them.
  let versions = [], at = -1;
  function snapshot() {
    const text = el("hwMarkdown").value;
    if (versions[at] === text) return;
    versions = versions.slice(0, at + 1).concat(text).slice(-50);
    at = versions.length - 1;
    buttons();
  }
  function step(by) {
    clearTimeout(typing);
    snapshot();
    const next = at + by;
    if (next < 0 || next >= versions.length) return;
    at = next;
    el("hwMarkdown").value = versions[at];
    buttons();
    schedule();
  }
  function buttons() {
    el("hwUndo").disabled = at <= 0;
    el("hwRedo").disabled = at >= versions.length - 1;
  }
  const el = (id) => dialog.querySelector(`#${id}`);
  const load = (key) => { try { return JSON.parse(store?.getItem(key) || "{}"); } catch { return {}; } };
  const save = (key, v) => { try { store?.setItem(key, JSON.stringify(v)); } catch { /* Optional. */ } };
  const remembered = () => load(STORE);
  const remember = (v) => save(STORE, v);
  const canSave = () => !!(library?.rememberImported && openGeneratedFile);
  function values() {
    const v = { size: el("hwSize").value };
    for (const key of Object.keys(LOOK_FIELDS)) v[key] = el(`hw-${key}`).value;
    return v;
  }
  // The New note choices, remembered for next time (not the request or the documents).
  function noteOptions() {
    return {
      length: el("hwLength").value, focus: el("hwFocus").value, level: el("hwLevel").value, language: el("hwLanguage").value,
      diagrams: el("hwDiagrams").checked, strict: el("hwStrict").checked, instructions: el("hwInstructions").value,
    };
  }
  function build() {
    ({ openPdf = null, library = null, groups = null, pageText = null, pageCanvas = null, notesText = null, openGeneratedFile = null, refreshHome = null,
      hasOpenDoc = hasOpenDoc, openDocTitle = openDocTitle, openDocPages = openDocPages, openDocResource = openDocResource } = context() || {});
    dialog = document.createElement("dialog");
    dialog.className = "ocr-dialog handwriting-dialog";
    dialog.setAttribute("aria-labelledby", "hwTitleLabel");
    const selects = Object.entries(LOOK_FIELDS).map(([key, options]) =>
      `<label class="ocr-languages">${LABELS[key]}<select id="hw-${key}" data-native>${options.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label>`).join("");
    dialog.innerHTML = `
      <div class="exam-dlg-head">
        <h2 id="hwTitleLabel"></h2>
        <button id="hwCloseX" type="button" class="dlg-close" aria-label="Close" title="Close (Esc)"></button>
      </div>
      <p id="hwLead" class="muted"></p>
      <div class="hw-layout">
        <div class="hw-source">
          <div class="hw-modes" role="tablist" aria-label="Create from">
            <button id="hwModePrompt" type="button" role="tab" aria-selected="false"></button
            ><button id="hwModeMarkdown" type="button" role="tab" aria-selected="true"></button>
          </div>
          <div id="hwPromptPanel" class="hw-prompt" role="tabpanel" hidden>
            <label class="hw-field">What the note is about
              <textarea id="hwRequest" rows="3" placeholder="A topic (“the cardiac cycle for a first-year exam”), or paste data, notes or a text to turn into a note. Leave it empty to write about the documents."></textarea>
            </label>
            <details id="hwDocs" class="hw-docs">
              <summary><span id="hwDocsTitle" class="hw-docs-title"></span><span id="hwDocsCount" class="hw-docs-count">Optional</span></summary>
              <div id="hwSourceMount" class="hw-docs-body"></div>
              <label class="sp-check hw-strict"><input id="hwStrict" type="checkbox" /><span>Only facts from these documents</span></label>
            </details>
            <div class="hw-opts">
              <label class="hw-field"><span class="hw-label">Length</span><select id="hwLength" data-native>${optionList(NOTE_LENGTHS)}</select></label>
              <label class="hw-field"><span class="hw-label">Focus</span><select id="hwFocus" data-native>${optionList(NOTE_FOCUS)}</select></label>
              <label class="hw-field"><span class="hw-label">Level</span><select id="hwLevel" data-native>${optionList(NOTE_LEVELS)}</select></label>
              <label class="hw-field"><span class="hw-label">Language</span><select id="hwLanguage" data-native>${optionList(NOTE_LANGUAGES)}</select></label>
            </div>
            <label class="sp-check hw-diagrams"><input id="hwDiagrams" type="checkbox" checked /><span>Draw diagrams where they explain something</span></label>
            <label class="hw-field">Extra instructions
              <textarea id="hwInstructions" rows="2" placeholder="Optional: a summary card per section, mnemonics, formulas in cards, a timeline…"></textarea>
            </label>
          </div>
          <div id="hwMarkdownPanel" class="hw-import" role="tabpanel">
            <button id="hwOpenFile" type="button"></button><input id="hwFile" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden />
            <button id="hwEnrich" type="button" title="Your AI tool rewrites this Markdown with highlights, cards, colours and drawings, keeping what it says"></button>
          </div>
          <div id="hwAiTools" class="hw-ai-row hw-tools"${ai ? "" : " hidden"}><select id="hwTool" data-native aria-label="AI tool"></select><select id="hwModel" data-native aria-label="Model"></select><input id="hwModelOther" type="text" placeholder="Model name" aria-label="Model name" hidden /><button id="hwWrite" type="button" class="primary" title="Write the note (Ctrl Enter)"></button></div>
          <p id="hwAiStatus" class="muted hw-ai-status" role="status"></p>
          <div id="hwDraftBar" class="exam-ready hw-draft" hidden>
            <strong id="hwDraftLabel"></strong>
            <div class="exam-ready-btns">
              <button id="hwContinue" type="button" class="primary"></button>
              <button id="hwDiscardDraft" type="button"></button>
            </div>
          </div>
          <div id="hwMarkdownBlock" class="hw-markdown-block">
            <label class="ocr-languages">Name<input id="hwName" type="text" spellcheck="false" /></label>
            <div class="hw-edit-bar"><span class="muted">Markdown</span><button id="hwCheatsheetBtn" type="button" class="hw-cheat-btn" aria-expanded="false" title="Show interactive Markdown syntax cheatsheet (click any snippet to insert)"></button><button id="hwUndo" type="button" disabled aria-label="Undo" title="Undo the last change to the Markdown (an AI write, an opened file or your typing)"></button><button id="hwRedo" type="button" disabled aria-label="Redo" title="Redo the change"></button></div>
            <div id="hwCheatsheet" class="hw-cheatsheet" hidden></div>
            <textarea id="hwMarkdown" spellcheck="false" aria-label="Markdown" rows="16"></textarea>
          </div>
          <details id="hwLook" class="hw-look" open>
            <summary><span id="hwLookTitle" class="hw-docs-title"></span></summary>
            <div class="hw-fields">${selects}<label class="ocr-languages">Text size<input id="hwSize" type="number" min="4" max="60" step="0.5" value="11" /></label></div>
          </details>
        </div>
        <div class="hw-preview" aria-live="polite"><div id="hwPages" class="hw-pages"></div><p id="hwStatus" class="muted" role="status"></p></div>
      </div>
      <div class="ocr-actions">
        <label id="hwWhereLabel" class="hw-where">Insert<select id="hwWhere" data-native><option value="after">after this page</option><option value="before">before this page</option><option value="end">at the end</option></select></label>
        <label id="hwSaveLabel" class="hw-where hw-save" title="Where the new note is kept: Recent, one of your folders, or nowhere yet (it opens unsaved)">Save to<select id="hwSaveTo" data-native><option value="">Not yet (open unsaved)</option><option value="recent">Recent</option></select></label>
        <button id="hwCancel" type="button">Cancel</button>
        <button id="hwInsert" type="button"></button>
        <button id="hwCreate" type="button" class="primary"></button>
      </div>`;
    document.body.append(dialog);
    const setBtnIcon = (id, name, label) => el(id).replaceChildren(icon(name), document.createTextNode(" " + label));
    setBtnIcon("hwModePrompt", "spark", "From a prompt");
    setBtnIcon("hwModeMarkdown", "code", "From Markdown");
    setBtnIcon("hwOpenFile", "open", "Open Markdown…");
    setBtnIcon("hwEnrich", "spark", "Make it richer with AI");
    setBtnIcon("hwWrite", "spark", "Write the note");
    setBtnIcon("hwCheatsheetBtn", "help", "Cheatsheet");
    setBtnIcon("hwInsert", "plus", "Insert page into this note");
    setBtnIcon("hwCreate", "note", "Create note");
    setBtnIcon("hwContinue", "forward", "Continue writing");
    setBtnIcon("hwDiscardDraft", "trash", "Discard");
    setBtnIcon("hwDocsTitle", "attach", "Documents to base it on");
    setBtnIcon("hwLookTitle", "draw", "Page look");
    el("hwCloseX").replaceChildren(icon("close"));
    // Each option row gets its icon, as in the exam dialog's sections.
    const glyphs = { hwLength: "pages", hwFocus: "eye", hwLevel: "graph", hwLanguage: "text" };
    for (const [id, name] of Object.entries(glyphs)) el(id).parentElement.querySelector(".hw-label").prepend(icon(name));

    // Interactive Markdown cheatsheet: click any snippet to insert at cursor.
    const sheet = el("hwCheatsheet");
    sheet.replaceChildren(...CHEATSHEET.map((sec) => {
      const box = document.createElement("div");
      box.className = "hw-cheat-sec";
      const h = document.createElement("strong");
      h.textContent = sec.group;
      const grid = document.createElement("div");
      grid.className = "hw-cheat-grid";
      for (const item of sec.items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hw-cheat-chip";
        b.title = `${item.hint}\n\nClick to insert:\n${item.code}`;
        const t = document.createElement("span");
        t.textContent = item.label;
        const c = document.createElement("code");
        c.textContent = item.code.split("\n")[0];
        b.append(t, c);
        b.onclick = () => {
          const area = el("hwMarkdown");
          snapshot();
          const start = area.selectionStart ?? area.value.length;
          const end = area.selectionEnd ?? start;
          const before = area.value.slice(0, start);
          const prefix = before && !before.endsWith("\n") ? "\n" : "";
          const suffix = area.value.slice(end).startsWith("\n") || !area.value.slice(end) ? "" : "\n";
          const insert = `${prefix}${item.code}${suffix}`;
          area.value = before + insert + area.value.slice(end);
          area.selectionStart = area.selectionEnd = before.length + insert.length;
          area.focus();
          snapshot();
          schedule();
        };
        grid.append(b);
      }
      box.append(h, grid);
      return box;
    }));
    el("hwCheatsheetBtn").onclick = () => {
      const open = sheet.hidden;
      sheet.hidden = !open;
      el("hwCheatsheetBtn").setAttribute("aria-expanded", String(open));
    };
    el("hwCancel").onclick = () => dialog.close();
    el("hwCloseX").onclick = () => dialog.close();
    dialog.addEventListener("close", () => stopWriting());
    // Undo and redo for the Markdown: every AI write, opened file and pause in typing is a step.
    el("hwUndo").replaceChildren(icon("undo"));
    el("hwRedo").replaceChildren(icon("redo"));
    el("hwUndo").onclick = () => step(-1);
    el("hwRedo").onclick = () => step(1);
    el("hwMarkdown").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => snapshot(), 800); });
    el("hwModePrompt").onclick = () => mode("prompt");
    el("hwModeMarkdown").onclick = () => mode("markdown");
    // Your own Markdown from a file: it replaces the text and names the note.
    el("hwOpenFile").onclick = () => el("hwFile").click();
    el("hwFile").onchange = async () => {
      const file = el("hwFile").files[0];
      el("hwFile").value = "";
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) { el("hwStatus").textContent = "That file is too large for one note."; return; }
      snapshot();
      el("hwMarkdown").value = await file.text();
      snapshot();
      el("hwName").value = titleOf(el("hwMarkdown").value) || file.name.replace(/\.[^.]+$/, "");
      schedule();
    };
    // Documents: the same picker as Create exam with AI, without its Topics tab (the request is the topic).
    if (library || groups || hasOpenDoc()) {
      picker = createSourcePicker(el("hwSourceMount"), {
        library, groups, hasOpenDoc, openDocTitle, openDocPages,
        openDocKey: () => openDocResource?.()?.entryKey || "",
        allowTopics: false,
        onChange: (items) => {
          el("hwDocsCount").textContent = items.length ? `${items.length} selected` : "Optional";
          el("hwDocs").classList.toggle("has-docs", items.length > 0);
          el("hwStrict").disabled = !items.length;
        },
      });
    } else {
      el("hwDocs").hidden = true;
    }
    if (ai) {
      model = modelPicker(el("hwModel"), el("hwModelOther"), ai);
      el("hwTool").onchange = () => { try { store?.setItem("notecomplete-ai-provider", el("hwTool").value); } catch { /* Optional. */ } model.load(el("hwTool").value); };
      el("hwWrite").onclick = () => (writing ? stopWriting() : write("prompt"));
      el("hwEnrich").onclick = () => (writing ? stopWriting() : write("enrich"));
      el("hwContinue").onclick = () => (writing ? stopWriting() : write("continue"));
      el("hwDiscardDraft").onclick = () => { clearAiDraft(store, DRAFT_KEY); syncDraft(); };
      for (const id of ["hwRequest", "hwInstructions"]) el(id).addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!writing) write("prompt"); } });
    } else {
      el("hwModePrompt").hidden = el("hwEnrich").hidden = true;
    }
    for (const id of ["hwLength", "hwFocus", "hwLevel", "hwLanguage", "hwDiagrams", "hwStrict", "hwInstructions"]) el(id).addEventListener("change", () => save(PROMPT_STORE, noteOptions()));
    for (const input of el("hwMarkdownBlock").querySelectorAll("textarea, input")) input.addEventListener("input", schedule);
    for (const input of el("hwLook").querySelectorAll("select, input")) input.addEventListener("input", schedule);
    el("hwSaveTo").onchange = () => { try { store?.setItem("notecomplete-note-save-to", el("hwSaveTo").value); } catch { /* Optional. */ } };
    el("hwCreate").onclick = async () => {
      const job = read();
      if (!job) return;
      const target = el("hwSaveTo").value;
      dialog.close();
      if (target && canSave()) await saveNote(job, target);
      else await onCreate(job);
    };
    el("hwInsert").onclick = async () => {
      const job = read();
      if (!job) return;
      dialog.close();
      await onInsert({ ...job, where: el("hwWhere").value });
    };
  }
  // Saved straight to Recent (and a folder): written by the core as a Noteful project, then opened.
  async function saveNote({ title, markdown, options }, target) {
    try {
      const folder = target === "recent" ? null : (await groups?.folders?.().catch(() => []))?.find((g) => g.id === target) || null;
      const composed = await call("composeNoteFile", { title, markdown, options });
      const name = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().slice(0, 80) || "Note";
      const file = new File([composed.project], `${name}.nfedit`, { type: "application/octet-stream" });
      const entry = await library.rememberImported(file, { origin: "AI Notes", folder: folder?.name || "" });
      if (folder && groups?.move && entry) await groups.move({ key: entry.key, name: entry.name, source: "imported" }, folder);
      refreshHome?.();
      status?.(folder ? `Saved “${title}” to ${folder.name}.` : `Saved “${title}” to Recent.`);
      await openGeneratedFile(file, entry);
    } catch (e) {
      status?.(e?.message || String(e), true);
    }
  }
  // Recent, then your folders (not the disk folders, which hold their own files).
  async function fillSaveTo() {
    const select = el("hwSaveTo");
    let saved = select.value;
    try { saved = store?.getItem("notecomplete-note-save-to") ?? saved; } catch { /* Optional. */ }
    while (select.options.length > 2) select.remove(2);
    for (const g of (await groups?.folders?.().catch(() => [])) || []) if (!g.folder) select.add(new Option(g.name || "Folder", g.id));
    select.value = select.querySelector(`option[value="${CSS.escape(saved || "")}"]`) ? saved : "";
  }
  // The AI tools found on this computer, the last one used first.
  async function tools() {
    const select = el("hwTool");
    if (select.options.length) return;
    for (const p of await ai.providers()) {
      const option = new Option(p.available ? p.label : `${p.label} (not installed)`, p.id);
      option.disabled = !p.available;
      select.add(option);
    }
    let saved = "";
    try { saved = store?.getItem("notecomplete-ai-provider") || ""; } catch { /* Optional. */ }
    if (saved && select.querySelector(`option[value="${saved}"]:not([disabled])`)) select.value = saved;
    else select.value = select.querySelector("option:not([disabled])")?.value || "";
    if (select.value) await model.load(select.value);
    else el("hwAiStatus").textContent = "No AI tool found. Install Claude Code, Antigravity, Codex or OpenCode and sign in.";
  }
  // From a prompt, or from your Markdown made richer: the tool writes the Markdown, it
  // streams into the editor and the preview follows.
  function mode(which) {
    const prompt = which === "prompt" && !!ai;
    el("hwModePrompt").setAttribute("aria-selected", String(prompt));
    el("hwModeMarkdown").setAttribute("aria-selected", String(!prompt));
    el("hwPromptPanel").hidden = !prompt;
    el("hwMarkdownPanel").hidden = prompt;
    el("hwWrite").hidden = !prompt;
    // The Markdown is what a prompt produces: it shows in its own tab, the preview follows it here.
    el("hwMarkdownBlock").hidden = prompt;
    el("hwLook").open = !prompt;
    el("hwTitleLabel").replaceChildren(icon(prompt ? "spark" : "note"), document.createTextNode(prompt ? " New note with AI" : " Handwritten pages from Markdown"));
    el("hwLead").textContent = prompt
      ? "Your AI tool writes the note from your request and the documents you add; it comes out as real pen and highlighter strokes you can edit, here and in Noteful."
      : "Written as real pen and highlighter strokes you can erase, recolour and move, here and in Noteful.";
    el("hwAiStatus").textContent = "";
    // One main action at a time: Write the note while there is nothing written yet.
    el("hwCreate").classList.toggle("primary", !insertFirst && !(prompt && !el("hwMarkdown").value.trim()));
    syncDraft();
    (prompt ? el("hwRequest") : el("hwMarkdown")).focus();
  }
  // An interrupted write (stopped, failed, or the dialog closed) is kept, to continue later.
  function syncDraft() {
    const draft = loadAiDraft(store, DRAFT_KEY);
    const show = !!draft?.partialText && !writing && el("hwModePrompt").getAttribute("aria-selected") === "true";
    el("hwDraftBar").hidden = !show;
    if (show) el("hwDraftLabel").textContent = `“${draft.title || "Note"}” stopped after ${draft.partialText.length.toLocaleString()} characters. Continue where it stopped, or discard it.`;
  }
  async function documents(run, caps) {
    const sources = picker?.list() || [];
    if (!sources.length) return { promptText: "", images: [] };
    const resolved = await resolveSources(sources, {
      call, openPdf, library, groups, openDocResource, pageText, pageCanvas, notesText,
      documentInfo: () => ({ pages: openDocPages(), title: openDocTitle() }),
      onProgress: (i, n, label) => { if (!run.stopped) el("hwAiStatus").textContent = `Reading document ${i + 1} of ${n}: ${label}`; },
    });
    if (!resolved.length) throw Error("Nothing readable was found in the chosen documents.");
    const length = el("hwLength").value;
    const bundle = formatSourceBundle(resolved, { maxChars: length === "short" ? 40000 : 72000 });
    return { ...bundle, images: caps.vision === false ? [] : bundle.images, titles: resolved.map((d) => d.title) };
  }
  async function write(kind) {
    const request = el("hwRequest").value, source = el("hwMarkdown").value;
    const draft = kind === "continue" ? loadAiDraft(store, DRAFT_KEY) : null;
    if (kind === "continue" && !draft?.partialText) { syncDraft(); return; }
    const hasDocs = (picker?.list() || []).length > 0;
    if (kind === "prompt" && !request.trim() && !hasDocs) { el("hwAiStatus").textContent = "Say what the note is about, paste the material, or add documents to base it on."; el("hwRequest").focus(); return; }
    if (kind === "enrich" && !source.trim()) { el("hwAiStatus").textContent = "Write, paste or open some Markdown first."; el("hwMarkdown").focus(); return; }
    const provider = el("hwTool").value;
    if (!provider) return;
    const run = (writing = { stopped: false, ac: new AbortController() });
    const button = kind === "enrich" ? el("hwEnrich") : kind === "continue" ? el("hwContinue") : el("hwWrite");
    const label = [...button.childNodes].map((n) => n.cloneNode(true));
    button.replaceChildren(icon("stop"), document.createTextNode(" Stop"));
    el("hwDraftBar").hidden = kind !== "continue";
    el("hwDiscardDraft").disabled = true;
    const before = el("hwMarkdown").value;
    snapshot();
    // A continued note keeps what was written and adds to it.
    const kept = kind === "continue" ? answerMarkdown(draft.partialText) : "";
    let streamed = "", prompt = "", fallbackName = "";
    const shown = () => (kept ? `${kept}\n\n${answerMarkdown(streamed)}`.trim() : answerMarkdown(streamed));
    try {
      const m = model.value, caps = ai.capabilities?.(provider, m) || {};
      // Small model: only the core of the dialect, so the prompt stays short.
      const raw = await call("dialect");
      const dialect = model?.small || caps.small ? compactDialect(raw) : raw;
      const look = el("hw-look").value;
      let images = [];
      if (kind === "continue") {
        prompt = buildContinuationPrompt({ basePrompt: draft.prompt, partialText: draft.partialText, kind: "note" });
        el("hwMarkdown").value = kept;
      } else if (kind === "prompt") {
        el("hwAiStatus").textContent = hasDocs ? "Reading the documents…" : "";
        const docs = await documents(run, caps);
        if (run.stopped) return;
        images = docs.images;
        prompt = aiPrompt({ request, dialect, look, documents: docs.promptText, ...noteOptions() });
        fallbackName = docs.titles?.[0] || "";
      } else {
        prompt = aiEnrichPrompt({ markdown: source, dialect, look });
      }
      const verb = kind === "enrich" ? "Making it richer" : kind === "continue" ? "Continuing the note" : "Writing";
      el("hwAiStatus").textContent = `${verb}… (your AI tool can take a minute)`;
      const orch = await createDocOrchestrator({
        ai,
        primaryProvider: provider,
        primaryModel: m,
        store,
        signal: run.ac.signal,
        onStatus: (msg) => { if (!run.stopped) el("hwAiStatus").textContent = msg; },
        onSwitch: (info) => { status?.(`${info.fromLabel} failed — handing off to ${info.toLabel}.`); },
      });
      const res = await orch.runStage({
        prompt,
        images,
        tag: "handwriting",
        label: kind === "enrich" ? "Note · richer" : "New note with AI",
        kind: "note",
        initialPartialText: kept,
        small: model.small,
        vision: caps.vision !== false,
        onDelta: (delta, { totalStreamed }) => {
          if (run.stopped) return;
          streamed += delta;
          el("hwMarkdown").value = shown();
          el("hwAiStatus").textContent = `${verb}… ${totalStreamed.toLocaleString()} characters`;
          schedule();
        },
      });
      if (run.stopped) return;
      const mergedPartial = res.partialText ? answerMarkdown(res.partialText) : kept;
      const finalChunk = answerMarkdown(res.text || streamed);
      const markdown = mergedPartial && res.handedOff
        ? `${mergedPartial}\n\n${finalChunk}`.trim()
        : (kept ? `${kept}\n\n${finalChunk}`.trim() : finalChunk);
      if (!markdown) throw Error("The AI tool gave no answer.");
      el("hwMarkdown").value = markdown;
      const name = el("hwName").value.trim();
      if (!name || name === "Handwritten notes") el("hwName").value = titleOf(markdown) || fallbackName || name || "Handwritten notes";
      if (kind !== "enrich") clearAiDraft(store, DRAFT_KEY);
      snapshot();
      // The note written from a prompt is now its Markdown: show it there, ready to edit or enrich.
      if (kind !== "enrich") { mode("markdown"); el("hwMarkdown").scrollTop = 0; }
      el("hwAiStatus").textContent = kind === "enrich" ? "Done: your Markdown now uses highlights, cards and colours. Check the preview; Undo brings back your version." : "Written. Check the preview, change anything, then create the note.";
      schedule();
    } catch (e) {
      if (!run.stopped) {
        // A note that stopped half-way is kept to continue; anything else goes back as it was.
        if (kind !== "enrich" && streamed.trim()) keepDraft(prompt, kept, streamed);
        else el("hwMarkdown").value = before;
        el("hwAiStatus").textContent = e?.message || String(e);
        schedule();
      }
    } finally {
      if (run.stopped && kind !== "enrich" && streamed.trim()) keepDraft(prompt, kept, streamed);
      if (writing === run) writing = null;
      button.replaceChildren(...label);
      el("hwDiscardDraft").disabled = false;
      if (dialog?.open) syncDraft();
    }
  }
  function keepDraft(prompt, kept, streamed) {
    if (!prompt) return;
    const partialText = kept ? `${kept}\n\n${answerMarkdown(streamed)}` : streamed;
    saveAiDraft(store, DRAFT_KEY, { prompt, partialText, title: titleOf(answerMarkdown(partialText)) || el("hwName").value.trim() || "Note" });
  }
  function stopWriting() {
    if (!writing) return;
    writing.stopped = true;
    writing.ac.abort();
    writing = null;
    ai?.cancel?.("handwriting");
    if (dialog) el("hwAiStatus").textContent = "Stopped.";
  }
  function read() {
    const markdown = el("hwMarkdown").value;
    if (!markdown.trim()) { el("hwStatus").textContent = "Write or paste some Markdown first."; return null; }
    const v = values();
    remember(v);
    return { title: el("hwName").value.trim() || "Handwritten notes", markdown, options: optionsFrom(v) };
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(preview, 350);
  }
  async function preview() {
    const markdown = el("hwMarkdown").value, n = ++ask;
    if (!markdown.trim()) { el("hwPages").replaceChildren(); el("hwStatus").textContent = ""; return; }
    el("hwStatus").textContent = "Writing…";
    try {
      const result = await call("composePreview", { markdown, options: optionsFrom(values()), max: 3 });
      if (n !== ask) return;
      // The pages are SVG made by the core from the strokes it wrote; text never appears as markup.
      el("hwPages").replaceChildren(...result.pages.map((svg) => {
        const page = document.createElement("div");
        page.className = "hw-page";
        page.innerHTML = svg;
        return page;
      }));
      const more = result.total > result.pages.length ? ` (showing ${result.pages.length})` : "";
      el("hwStatus").textContent = `${result.total} page${result.total === 1 ? "" : "s"}${more}.` + (result.warnings.length ? ` ${result.warnings.join(" ")}` : "");
    } catch (e) {
      if (n === ask) el("hwStatus").textContent = e.message;
    }
  }
  return {
    // withAi: open on "From a prompt" (File → New note with AI…).
    async open({ insert = false, withAi = false } = {}) {
      if (!dialog) build();
      const saved = remembered();
      for (const key of Object.keys(LOOK_FIELDS)) el(`hw-${key}`).value = saved[key] ?? LOOK_FIELDS[key][0][0];
      el("hwSize").value = saved.size || 11;
      const prefs = load(PROMPT_STORE);
      for (const [id, list, key] of [["hwLength", NOTE_LENGTHS, "length"], ["hwFocus", NOTE_FOCUS, "focus"], ["hwLevel", NOTE_LEVELS, "level"], ["hwLanguage", NOTE_LANGUAGES, "language"]]) {
        el(id).value = list.some(([v]) => v === prefs[key]) ? prefs[key] : list[0][0];
      }
      el("hwDiagrams").checked = prefs.diagrams !== false;
      el("hwStrict").checked = !!prefs.strict;
      if (typeof prefs.instructions === "string" && !el("hwInstructions").value) el("hwInstructions").value = prefs.instructions;
      const source = sourceText();
      if (source.trim() || !el("hwMarkdown").value.trim()) el("hwMarkdown").value = source.trim() ? source : withAi ? "" : SAMPLE;
      if (!el("hwName").value) el("hwName").value = "Handwritten notes";
      versions = [el("hwMarkdown").value];
      at = 0;
      buttons();
      const canInsert = hasDocument();
      el("hwInsert").hidden = el("hwWhereLabel").hidden = !canInsert;
      el("hwSaveLabel").hidden = !canSave() || (insert && canInsert);
      insertFirst = insert && canInsert;
      el("hwInsert").classList.toggle("primary", insertFirst);
      dialog.showModal();
      if (ai) tools().catch((e) => { el("hwAiStatus").textContent = e.message; });
      mode(withAi ? "prompt" : "markdown");
      preview();
      if (canSave()) fillSaveTo().catch(() => {});
      await picker?.refresh({ preselectOpen: false });
    },
    get visible() { return !!dialog?.open; },
  };
}
