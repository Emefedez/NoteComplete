import { modelPicker } from "./model-picker.js";

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

// What the AI tool is asked for: study notes about a topic (or from pasted material) in
// the handwriting dialect, so the answer goes straight into the preview.
export function aiPrompt({ request, dialect, look = "study" }) {
  return [
    "Write a note about the request below as Handwriting Markdown for NoteComplete, which writes it as real handwriting ink on A4 pages.",
    "Answer with the Markdown only: no code fences, no comments before or after it.",
    `Use the ${look === "classic" ? "classic (plain notebook)" : "study (composed study notes)"} look. Write in the language of the request.`,
    "Keep it to one or two pages unless the material needs more (\\pagebreak starts a page). Prefer short lines, key terms in **bold**, ==highlights==, cards and lists over long paragraphs; add a !draw diagram only when it explains something.",
    "If the request includes data or notes, use them faithfully and do not invent facts.",
    "The dialect:\n" + dialect,
    "The request:\n" + request.trim(),
  ].join("\n\n");
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

export function handwritingConverter({ call, status, onCreate, onInsert, sourceText = () => "", hasDocument = () => false, store = globalThis.localStorage, ai = null }) {
  let dialog = null, timer = 0, ask = 0, writing = null, model = null, typing = 0;
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
  const remembered = () => { try { return JSON.parse(store?.getItem(STORE) || "{}"); } catch { return {}; } };
  const remember = (v) => { try { store?.setItem(STORE, JSON.stringify(v)); } catch { /* Optional. */ } };
  function values() {
    const v = { size: el("hwSize").value };
    for (const key of Object.keys(LOOK_FIELDS)) v[key] = el(`hw-${key}`).value;
    return v;
  }
  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "ocr-dialog handwriting-dialog";
    dialog.setAttribute("aria-labelledby", "hwTitleLabel");
    const selects = Object.entries(LOOK_FIELDS).map(([key, options]) =>
      `<label class="ocr-languages">${LABELS[key]}<select id="hw-${key}" data-native>${options.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label>`).join("");
    dialog.innerHTML = `
      <h2 id="hwTitleLabel">Handwritten pages from Markdown</h2>
      <p class="muted">Written as real pen and highlighter strokes you can erase, recolour and move, here and in Noteful.</p>
      <div class="hw-layout">
        <div class="hw-source">
          <div class="hw-modes" role="tablist" aria-label="Create from">
            <button id="hwModePrompt" type="button" role="tab" aria-selected="false">From a prompt</button
            ><button id="hwModeMarkdown" type="button" role="tab" aria-selected="true">From Markdown</button>
          </div>
          <div id="hwPromptPanel" class="hw-ai" role="tabpanel" hidden>
            <textarea id="hwRequest" rows="4" aria-label="What the note is about" placeholder="A topic (“the cardiac cycle for a first-year exam”), or paste data, notes or a text to turn into a note."></textarea>
            <div class="hw-ai-row"><button id="hwWrite" type="button" class="primary">Write the note</button></div>
          </div>
          <div id="hwMarkdownPanel" class="hw-import" role="tabpanel">
            <button id="hwOpenFile" type="button">Open a Markdown file…</button><input id="hwFile" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden />
            <button id="hwEnrich" type="button" title="Your AI tool rewrites this Markdown with highlights, cards, colours and drawings, keeping what it says">Make it richer with AI</button>
          </div>
          <div id="hwAiTools" class="hw-ai-row hw-tools"${ai ? "" : " hidden"}><select id="hwTool" data-native aria-label="AI tool"></select><select id="hwModel" data-native aria-label="Model"></select><input id="hwModelOther" type="text" placeholder="Model name" aria-label="Model name" hidden /></div>
          <p id="hwAiStatus" class="muted hw-ai-status" role="status"></p>
          <label class="ocr-languages">Name<input id="hwName" type="text" spellcheck="false" /></label>
          <div class="hw-edit-bar"><span class="muted">Markdown</span><button id="hwUndo" type="button" disabled title="Undo the last change to the Markdown (an AI write, an opened file or your typing)">Undo</button><button id="hwRedo" type="button" disabled title="Redo">Redo</button></div>
          <textarea id="hwMarkdown" spellcheck="false" aria-label="Markdown" rows="14"></textarea>
          <details class="hw-help"><summary>Markdown for handwriting</summary><p class="muted"><code># TITLE</code>, <code>## Section</code>, <code>**term**</code>, <code>==highlight==</code>, <code>[[tag]]</code>, <code>((grey detail))</code>, <code>- item</code>, <code>1. step</code>, <code>&gt; [sky] CARD: text</code>, <code>&gt;&gt; A: … || B: …</code>, <code>!columns 55</code> … <code>!col</code> … <code>!end</code>, <code>!zone [mint]</code> … <code>!end</code>, <code>!sticky [yellow] TITLE: text</code>, <code>!stat 42 label</code>, <code>!draw 480</code> &lt;svg…&gt; <code>!end</code>, <code>\\pagebreak</code>. Greek letters, <code>T^4</code> and <code>CO_2</code> are drawn by hand.</p></details>
          <div class="hw-fields">${selects}<label class="ocr-languages">Text size<input id="hwSize" type="number" min="4" max="60" step="0.5" value="11" /></label></div>
        </div>
        <div class="hw-preview" aria-live="polite"><div id="hwPages" class="hw-pages"></div><p id="hwStatus" class="muted" role="status"></p></div>
      </div>
      <div class="ocr-actions">
        <label id="hwWhereLabel" class="hw-where">Insert<select id="hwWhere" data-native><option value="after">after this page</option><option value="before">before this page</option><option value="end">at the end</option></select></label>
        <button id="hwCancel" type="button">Cancel</button>
        <button id="hwInsert" type="button">Insert into this note</button>
        <button id="hwCreate" type="button" class="primary">Create note</button>
      </div>`;
    document.body.append(dialog);
    el("hwCancel").onclick = () => dialog.close();
    dialog.addEventListener("close", () => stopWriting());
    // Undo and redo for the Markdown: every AI write, opened file and pause in typing is a step.
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
    if (ai) {
      model = modelPicker(el("hwModel"), el("hwModelOther"), ai);
      el("hwTool").onchange = () => { try { store?.setItem("notecomplete-ai-provider", el("hwTool").value); } catch { /* Optional. */ } model.load(el("hwTool").value); };
      el("hwWrite").onclick = () => (writing ? stopWriting() : write("prompt"));
      el("hwEnrich").onclick = () => (writing ? stopWriting() : write("enrich"));
      el("hwRequest").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); write("prompt"); } });
    } else {
      el("hwModePrompt").hidden = el("hwEnrich").hidden = true;
    }
    for (const input of dialog.querySelectorAll("textarea, select, input")) input.addEventListener("input", schedule);
    el("hwCreate").onclick = async () => {
      const job = read();
      if (!job) return;
      dialog.close();
      await onCreate(job);
    };
    el("hwInsert").onclick = async () => {
      const job = read();
      if (!job) return;
      dialog.close();
      await onInsert({ ...job, where: el("hwWhere").value });
    };
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
    el("hwAiStatus").textContent = "";
    (prompt ? el("hwRequest") : el("hwMarkdown")).focus();
  }
  async function write(kind) {
    const request = el("hwRequest").value, source = el("hwMarkdown").value;
    if (kind === "prompt" && !request.trim()) { el("hwAiStatus").textContent = "Say what the note is about, or paste the material."; el("hwRequest").focus(); return; }
    if (kind === "enrich" && !source.trim()) { el("hwAiStatus").textContent = "Write, paste or open some Markdown first."; el("hwMarkdown").focus(); return; }
    const provider = el("hwTool").value;
    if (!provider) return;
    const run = (writing = { stopped: false });
    const button = kind === "prompt" ? el("hwWrite") : el("hwEnrich"), label = button.textContent;
    button.textContent = "Stop";
    el("hwAiStatus").textContent = kind === "prompt" ? "Writing… (your AI tool can take a minute)" : "Making it richer… (your AI tool can take a minute)";
    const before = el("hwMarkdown").value;
    snapshot();
    let streamed = "";
    try {
      const dialect = await call("dialect");
      const look = el("hw-look").value;
      const prompt = kind === "prompt" ? aiPrompt({ request, dialect, look }) : aiEnrichPrompt({ markdown: source, dialect, look });
      const { text } = await ai.run({ provider, model: model.value, prompt, tag: "handwriting" }, (delta) => {
        if (run.stopped) return;
        streamed += delta;
        el("hwMarkdown").value = answerMarkdown(streamed);
        schedule();
      });
      if (run.stopped) return;
      const markdown = answerMarkdown(text || streamed);
      if (!markdown) throw Error("The AI tool gave no answer.");
      el("hwMarkdown").value = markdown;
      const name = el("hwName").value.trim();
      if (!name || name === "Handwritten notes") el("hwName").value = titleOf(markdown) || name || "Handwritten notes";
      snapshot();
      // The note written from a prompt is now its Markdown: show it there, ready to edit or enrich.
      if (kind === "prompt") { mode("markdown"); el("hwMarkdown").scrollTop = 0; }
      el("hwAiStatus").textContent = kind === "prompt" ? "Written. Check the preview, change anything, then create the note." : "Done: your Markdown now uses highlights, cards and colours. Check the preview; Undo brings back your version.";
      schedule();
    } catch (e) {
      if (!run.stopped) {
        el("hwMarkdown").value = before;
        el("hwAiStatus").textContent = e.message;
        schedule();
      }
    } finally {
      if (writing === run) { writing = null; button.textContent = label; }
    }
  }
  function stopWriting() {
    if (!writing) return;
    writing.stopped = true;
    writing = null;
    ai?.cancel?.("handwriting");
    if (dialog) { el("hwWrite").textContent = "Write the note"; el("hwEnrich").textContent = "Make it richer with AI"; el("hwAiStatus").textContent = "Stopped."; }
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
    // withAi: open on "Write it with AI" (File → New note with AI…).
    open({ insert = false, withAi = false } = {}) {
      if (!dialog) build();
      const saved = remembered();
      for (const key of Object.keys(LOOK_FIELDS)) el(`hw-${key}`).value = saved[key] ?? LOOK_FIELDS[key][0][0];
      el("hwSize").value = saved.size || 11;
      const source = sourceText();
      if (source.trim() || !el("hwMarkdown").value.trim()) el("hwMarkdown").value = source.trim() ? source : withAi ? "" : SAMPLE;
      if (!el("hwName").value) el("hwName").value = "Handwritten notes";
      versions = [el("hwMarkdown").value];
      at = 0;
      buttons();
      const canInsert = hasDocument();
      el("hwInsert").hidden = el("hwWhereLabel").hidden = !canInsert;
      el("hwCreate").classList.toggle("primary", !insert || !canInsert);
      el("hwInsert").classList.toggle("primary", insert && canInsert);
      dialog.showModal();
      if (ai) tools().catch((e) => { el("hwAiStatus").textContent = e.message; });
      mode(withAi ? "prompt" : "markdown");
      preview();
    },
    get visible() { return !!dialog?.open; },
  };
}
