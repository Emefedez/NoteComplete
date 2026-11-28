// Help > Connect AI tools: lets the user's own AI tools (Claude Code, Codex,
// Antigravity, OpenCode) read and write these notes through the note server the
// desktop app ships, with one click per tool or with the command shown. Opened
// once by itself when a tool is installed but not connected.
import { renderSuccessionEditor, renderT3StatusCard } from "./ai-failover.js";

const ASKED = "notecomplete-agents-asked";
export const PREFER_MD_KEY = "notecomplete-ai-prefer-markdown";
export const AI_FORMAT_KEY = "notecomplete-ai-document-format";
export const AI_FORMAT_OPTIONS = [
  { id: "both", label: "Both ink & Markdown (recommended — AI chooses)" },
  { id: "markdown", label: "Markdown (.md) only (+ prefabs)" },
  { id: "ink", label: "Handwritten ink only (+ prefabs)" },
];

export function normalizeAiFormat(value, legacyPreferMd = false) {
  if (value === "both" || value === "markdown" || value === "ink") return value;
  return legacyPreferMd ? "markdown" : "both";
}

export function readAiFormat(store = globalThis.localStorage) {
  try {
    const saved = store?.getItem(AI_FORMAT_KEY);
    if (saved === "both" || saved === "markdown" || saved === "ink") return saved;
    return store?.getItem(PREFER_MD_KEY) === "true" ? "markdown" : "both";
  } catch { return "both"; }
}

export async function syncAiFormat({ api = globalThis.notecompleteAgents, store = globalThis.localStorage } = {}) {
  if (typeof api?.settings === "function") {
    try {
      const s = await api.settings();
      if (s && (typeof s.aiFormat === "string" || typeof s.preferMarkdown === "boolean")) {
        const fmt = normalizeAiFormat(s.aiFormat, s.preferMarkdown === true);
        try {
          store?.setItem(AI_FORMAT_KEY, fmt);
          store?.setItem(PREFER_MD_KEY, String(fmt === "markdown"));
        } catch { /* Optional. */ }
        return fmt;
      }
    } catch { /* Fall back to local storage. */ }
  }
  return readAiFormat(store);
}

export async function writeAiFormat(format, { api = globalThis.notecompleteAgents, store = globalThis.localStorage } = {}) {
  const fmt = normalizeAiFormat(format, false);
  try {
    store?.setItem(AI_FORMAT_KEY, fmt);
    store?.setItem(PREFER_MD_KEY, String(fmt === "markdown"));
  } catch { /* Optional. */ }
  if (typeof api?.setSettings === "function") {
    try {
      const saved = await api.setSettings({ aiFormat: fmt, preferMarkdown: fmt === "markdown" });
      if (saved && (typeof saved.aiFormat === "string" || typeof saved.preferMarkdown === "boolean")) {
        return normalizeAiFormat(saved.aiFormat, saved.preferMarkdown === true);
      }
    } catch { /* Kept in local storage. */ }
  }
  return fmt;
}

export function readPreferMarkdown(store = globalThis.localStorage) {
  return readAiFormat(store) === "markdown";
}

export async function syncPreferMarkdown(opts = {}) {
  return (await syncAiFormat(opts)) === "markdown";
}

export async function writePreferMarkdown(on, opts = {}) {
  return (await writeAiFormat(on === true ? "markdown" : "both", opts)) === "markdown";
}

// One line per tool: what it is now and what the button does.
export function describe(tool) {
  if (tool.connected) {
    if (tool.bundledSkills?.length && tool.skillsInstalled === false) {
      return { text: "Connected · skills not installed", action: "Reconnect", skillsAction: "Install skills" };
    }
    return { text: tool.skillsInstalled ? "Connected · skills installed" : "Connected", action: "Reconnect" };
  }
  if (!tool.installed && tool.id !== "opencode") return { text: "Not installed", action: null };
  if (tool.elsewhere) return { text: "Set up for an older copy of NoteComplete", action: "Update" };
  return { text: tool.installed ? "Not connected" : "Not installed; can be set up now", action: "Connect" };
}
// Whether to open the dialog by itself: a tool waits, and the user was not asked yet.
export function shouldAsk(tools, asked) {
  return !asked && tools.some((t) => t.installed && !t.connected);
}

export function agentConnector({ api = globalThis.notecompleteAgents, status = () => {}, store = globalThis.localStorage } = {}) {
  if (!api) return null;
  let dialog = null;
  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "ocr-dialog agents-dialog";
    dialog.setAttribute("aria-labelledby", "agentsTitle");
    dialog.innerHTML = `
      <h2 id="agentsTitle">Connect your AI tools to your notes</h2>
      <p class="muted">NoteComplete comes with a note server. Connected tools can read your notes, make flashcards and write real handwriting or Markdown documents with embedded prefabs, using your own subscription. Notes are changed only when you ask for it, and the previous file is kept.</p>
      <div class="wizard-check" style="margin: 0 0 12px; display: block;">
        <label for="agentsAiFormat"><strong>AI-generated document format</strong></label>
        <div style="margin: 6px 0 4px;">
          <select id="agentsAiFormat" style="width: 100%; max-width: 420px;">
            ${AI_FORMAT_OPTIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join("")}
          </select>
        </div>
        <span class="wizard-check-hint">Choose whether connected AI tools (MCP) can combine handwritten ink and Markdown in the same note, or stick to one format (always using prefabs for charts, R plots, and diagrams).</span>
      </div>
      <div id="agentsT3Mount" style="margin: 0 0 12px;"></div>
      <details class="agents-manual" style="margin: 0 0 12px;">
        <summary><strong>AI document failover priority</strong> — hand off orchestrator &amp; subagents on error / usage limit</summary>
        <p class="muted" style="margin: 6px 0 8px;">Order the harnesses NoteComplete tries next if the active harness errors out or hits usage limits during AI document generation. Already-completed work is preserved.</p>
        <div id="agentsSuccessionMount"></div>
      </details>
      <ul id="agentsList" class="agents-list"></ul>
      <p id="agentsStatus" class="muted" role="status" aria-live="polite"></p>
      <div class="ocr-actions"><button id="agentsClose" type="button" class="primary">Done</button></div>`;
    document.body.append(dialog);
    dialog.querySelector("#agentsClose").onclick = () => dialog.close();
    const fmtSelect = dialog.querySelector("#agentsAiFormat");
    fmtSelect.value = readAiFormat(store);
    fmtSelect.onchange = async () => {
      const saved = await writeAiFormat(fmtSelect.value, { api, store });
      fmtSelect.value = saved;
      const note = dialog.querySelector("#agentsStatus");
      if (note) {
        note.textContent = saved === "markdown"
          ? "AI tools will use Markdown (.md) documents + prefabs (takes effect on the next MCP session)."
          : saved === "ink"
            ? "AI tools will use handwritten ink notebooks + prefabs (takes effect on the next MCP session)."
            : "AI tools can choose or combine handwritten ink and Markdown + prefabs (takes effect on the next MCP session).";
      }
    };
  }
  async function render() {
    const list = dialog.querySelector("#agentsList"), note = dialog.querySelector("#agentsStatus");
    const fmtSelect = dialog.querySelector("#agentsAiFormat");
    if (fmtSelect) syncAiFormat({ api, store }).then((v) => { fmtSelect.value = v; }, () => {});
    const t3Mount = dialog.querySelector("#agentsT3Mount");
    if (t3Mount) renderT3StatusCard(t3Mount, { ai: globalThis.notecompleteAI, onInstalled: () => render() });
    const succMount = dialog.querySelector("#agentsSuccessionMount");
    if (succMount) {
      const provs = (await globalThis.notecompleteAI?.providers?.().catch(() => [])) || [];
      renderSuccessionEditor(succMount, { providers: provs, store });
    }
    note.textContent = "Looking for your AI tools…";
    let result;
    try { result = await api.status(); } catch (e) { note.textContent = e.message; return; }
    if (!result.server) { note.textContent = "This build has no note server. Build it with cargo build --release -p noteful-cli."; list.replaceChildren(); return; }
    note.textContent = "";
    list.replaceChildren(...result.tools.map((tool) => {
      const { text, action, skillsAction } = describe(tool);
      const row = document.createElement("li");
      row.className = "agents-row";
      const name = document.createElement("strong");
      name.textContent = tool.label;
      const state = document.createElement("span");
      state.className = tool.connected ? "agents-ok" : "muted";
      state.textContent = text;
      row.append(name, state);
      if (skillsAction && typeof api.installSkills === "function") {
        const skillsBtn = document.createElement("button");
        skillsBtn.type = "button";
        skillsBtn.className = "primary";
        skillsBtn.textContent = skillsAction;
        skillsBtn.onclick = async () => {
          skillsBtn.disabled = true;
          note.textContent = `Installing NoteComplete skills for ${tool.label}…`;
          let message;
          try {
            const res = await api.installSkills(tool.id);
            message = `Installed ${res?.installed?.length || 0} NoteComplete skills for ${tool.label}. Restart it to load them.`;
            status(`NoteComplete skills installed for ${tool.label}.`);
          } catch (e) {
            message = e.message;
          }
          await render().catch((e) => console.warn("Agents status:", e));
          note.textContent = message;
        };
        row.append(skillsBtn);
      }
      if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action;
        button.onclick = async () => {
          button.disabled = true;
          note.textContent = `Connecting ${tool.label}…`;
          let message;
          try {
            const res = await api.connect(tool.id);
            const skillsNote = res?.skills?.length ? ` (${res.skills.length} skills installed)` : "";
            message = `${tool.label} is connected${skillsNote}. Restart it (or start a new session) to see the NoteComplete tools.`;
            status(`${tool.label} can now use your notes.`);
          } catch (e) {
            message = e.message;
          }
          await render().catch((e) => console.warn("Agents status:", e));
          note.textContent = message;
        };
        row.append(button);
      }
      const how = document.createElement("details");
      how.className = "agents-manual";
      const summary = document.createElement("summary");
      summary.textContent = "Run it yourself";
      const code = document.createElement("pre");
      code.textContent = tool.manual;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.onclick = () => navigator.clipboard?.writeText(tool.manual).then(() => { copy.textContent = "Copied"; }, () => {});
      how.append(summary, code, copy);
      row.append(how);
      return row;
    }));
  }
  return {
    async open() {
      if (!dialog) build();
      dialog.showModal();
      await render();
    },
    // Once, after start: when a tool is installed but not connected.
    async offer() {
      let asked = false;
      try { asked = !!store?.getItem(ASKED); } catch { /* Optional. */ }
      if (asked) return false;
      const result = await api.status().catch(() => null);
      if (!result?.server || !shouldAsk(result.tools, asked)) return false;
      try { store?.setItem(ASKED, "1"); } catch { /* Optional. */ }
      await this.open();
      return true;
    },
  };
}
