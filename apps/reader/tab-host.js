// Tabs for the web app (tabs.html): each tab is the reader in its own frame, like the
// desktop app's views, and each frame gets the same bridge the desktop gives it
// (window.notecompleteTabs), so the reader's tab strip works unchanged.

// The tab list itself, without the page (tested in tab-host.test.mjs).
export class TabList {
  constructor() { this.tabs = []; this.current = null; this.next = 1; }
  add({ title = 'Home', activate = true } = {}) {
    const tab = { id: this.next++, title, dirty: false };
    this.tabs.push(tab);
    if (activate || this.current == null) this.current = tab.id;
    return tab;
  }
  get(id) { return this.tabs.find((t) => t.id === id) || null; }
  activate(id) { if (this.get(id)) this.current = id; }
  // Removes a tab; the one beside it becomes current. Returns false when it was the last.
  remove(id) {
    const at = this.tabs.findIndex((t) => t.id === id);
    if (at < 0) return true;
    this.tabs.splice(at, 1);
    if (!this.tabs.length) { this.current = null; return false; }
    if (this.current === id) this.current = this.tabs[Math.min(at, this.tabs.length - 1)].id;
    return true;
  }
  move(id, index) {
    const at = this.tabs.findIndex((t) => t.id === id);
    if (at < 0) return;
    const [tab] = this.tabs.splice(at, 1);
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab);
  }
  update(id, { title, dirty }) {
    const tab = this.get(id);
    if (!tab) return;
    if (typeof title === 'string' && title) tab.title = title.slice(0, 200);
    if (typeof dirty === 'boolean') tab.dirty = dirty;
  }
  list() { return this.tabs.map((t) => ({ ...t, current: t.id === this.current })); }
}

// The page: frames in `container`, the reader at `reader` (index.html, or app.html on the
// website). `params` are added to a new tab's address (open=…, notes=1).
export function tabHost({ container, reader = './index.html', documentTitle = 'NoteComplete' }) {
  const list = new TabList(), frames = new Map(), listeners = new Map(), closers = new Map();
  const broadcast = () => {
    const tabs = list.list();
    for (const [id, callback] of listeners) if (frames.has(id)) callback(tabs);
    const current = list.get(list.current);
    document.title = current && current.title !== 'Home' ? `${current.title} — ${documentTitle}` : documentTitle;
  };
  const show = () => {
    for (const [id, frame] of frames) {
      const on = id === list.current;
      frame.hidden = !on;
      if (on) frame.contentWindow?.focus();
    }
    broadcast();
  };
  function open(params = {}, { activate = true } = {}) {
    const tab = list.add({ title: params.title || 'Home', activate });
    const frame = document.createElement('iframe');
    const query = new URLSearchParams({ tab: String(tab.id) });
    for (const [k, v] of Object.entries(params)) if (k !== 'title' && v != null) query.set(k, String(v));
    frame.src = `${reader}?${query}`;
    frame.title = tab.title;
    frame.allow = 'clipboard-read; clipboard-write; fullscreen; microphone; camera';
    frame.hidden = true;
    container.append(frame);
    frames.set(tab.id, frame);
    show();
    return tab.id;
  }
  function close(id) {
    frames.get(id)?.remove();
    frames.delete(id); listeners.delete(id); closers.delete(id);
    // The last tab closed: start again from Home, as a browser keeps one tab.
    if (!list.remove(id)) open();
    show();
  }
  // What a reader frame sees as window.notecompleteTabs.
  function bridge(id) {
    id = Number(id);
    return {
      list: async () => list.list(),
      open: async () => { open(); },
      activate: async (tab) => { list.activate(Number(tab)); show(); },
      // Asks the tab first (unsaved changes, a sharing session); it closes itself.
      close: async (tab) => { const ask = closers.get(Number(tab)); if (ask) ask(); else close(Number(tab)); },
      closeSelf: async () => close(id),
      move: async (tab, index) => { list.move(Number(tab), Number(index)); broadcast(); },
      // A browser cannot hand a page to a new window: the tab stays.
      detach: async () => false,
      update: async (state) => { list.update(id, state || {}); const f = frames.get(id); if (f) f.title = list.get(id)?.title || ''; broadcast(); },
      onList: (callback) => { listeners.set(id, callback); },
      onCloseRequest: (callback) => { closers.set(id, callback); },
    };
  }
  return { open, close, bridge, list };
}
