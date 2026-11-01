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

export function handwritingConverter({ call, status, onCreate, onInsert, sourceText = () => "", hasDocument = () => false, store = globalThis.localStorage }) {
  let dialog = null, timer = 0, ask = 0;
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
          <label class="ocr-languages">Name<input id="hwName" type="text" spellcheck="false" /></label>
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
    open({ insert = false } = {}) {
      if (!dialog) build();
      const saved = remembered();
      for (const key of Object.keys(LOOK_FIELDS)) el(`hw-${key}`).value = saved[key] ?? LOOK_FIELDS[key][0][0];
      el("hwSize").value = saved.size || 11;
      const source = sourceText();
      if (source.trim() || !el("hwMarkdown").value.trim()) el("hwMarkdown").value = source.trim() ? source : SAMPLE;
      if (!el("hwName").value) el("hwName").value = "Handwritten notes";
      const canInsert = hasDocument();
      el("hwInsert").hidden = el("hwWhereLabel").hidden = !canInsert;
      el("hwCreate").classList.toggle("primary", !insert || !canInsert);
      el("hwInsert").classList.toggle("primary", insert && canInsert);
      dialog.showModal();
      el("hwMarkdown").focus();
      preview();
    },
    get visible() { return !!dialog?.open; },
  };
}
