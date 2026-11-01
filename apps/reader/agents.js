// Help > Connect AI tools: lets the user's own AI tools (Claude Code, Codex,
// Antigravity, OpenCode) read and write these notes through the note server the
// desktop app ships, with one click per tool or with the command shown. Opened
// once by itself when a tool is installed but not connected.

const ASKED = "notecomplete-agents-asked";

// One line per tool: what it is now and what the button does.
export function describe(tool) {
  if (tool.connected) return { text: "Connected", action: "Reconnect" };
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
      <p class="muted">NoteComplete comes with a note server. Connected tools can read your notes, make flashcards and write real handwriting into copies of your notes, using your own subscription. Notes are changed only when you ask for it, and the previous file is kept.</p>
      <ul id="agentsList" class="agents-list"></ul>
      <p id="agentsStatus" class="muted" role="status" aria-live="polite"></p>
      <div class="ocr-actions"><button id="agentsClose" type="button" class="primary">Done</button></div>`;
    document.body.append(dialog);
    dialog.querySelector("#agentsClose").onclick = () => dialog.close();
  }
  async function render() {
    const list = dialog.querySelector("#agentsList"), note = dialog.querySelector("#agentsStatus");
    note.textContent = "Looking for your AI tools…";
    let result;
    try { result = await api.status(); } catch (e) { note.textContent = e.message; return; }
    if (!result.server) { note.textContent = "This build has no note server. Build it with cargo build --release -p noteful-cli."; list.replaceChildren(); return; }
    note.textContent = "";
    list.replaceChildren(...result.tools.map((tool) => {
      const { text, action } = describe(tool);
      const row = document.createElement("li");
      row.className = "agents-row";
      const name = document.createElement("strong");
      name.textContent = tool.label;
      const state = document.createElement("span");
      state.className = tool.connected ? "agents-ok" : "muted";
      state.textContent = text;
      row.append(name, state);
      if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action;
        button.onclick = async () => {
          button.disabled = true;
          note.textContent = `Connecting ${tool.label}…`;
          let message;
          try {
            await api.connect(tool.id);
            message = `${tool.label} is connected. Restart it (or start a new session) to see the NoteComplete tools.`;
            status(`${tool.label} can now use your notes.`);
          } catch (e) {
            message = e.message;
          }
          await render().catch(() => {});
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
