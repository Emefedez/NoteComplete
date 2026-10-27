// Tabs: several readers in one window. Each tab is a reader of its own (a
// WebContentsView, see main.js), so its note, edits and background jobs stay
// separate; this model only keeps the order, the active tab and what each
// tab shows in the strip.
export function tabStore() {
  const windows = new Map(); // window id -> { order: [tab id], active }
  const tabs = new Map(); // tab id -> { window, title, dirty }
  const win = id => windows.get(id) || windows.set(id, { order: [], active: null }).get(id);
  return {
    // A new tab right after the active one (or at the end), made active.
    add(windowId, tabId, { activate = true } = {}) {
      const w = win(windowId);
      const at = w.active == null ? w.order.length : w.order.indexOf(w.active) + 1;
      w.order.splice(at, 0, tabId);
      tabs.set(tabId, { window: windowId, title: 'Home', dirty: false });
      if (activate || w.active == null) w.active = tabId;
    },
    // Remove a tab; the one to its right (else left) becomes active.
    remove(tabId) {
      const tab = tabs.get(tabId);
      if (!tab) return null;
      const w = windows.get(tab.window), i = w.order.indexOf(tabId);
      w.order.splice(i, 1);
      tabs.delete(tabId);
      if (w.active === tabId) w.active = w.order[Math.min(i, w.order.length - 1)] ?? null;
      if (!w.order.length) windows.delete(tab.window);
      return { window: tab.window, active: w.active, left: w.order.length };
    },
    // Move a tab to another window (dragged out of its strip), made active there.
    transfer(tabId, windowId) {
      const tab = tabs.get(tabId);
      if (!tab || tab.window === windowId) return null;
      const { title, dirty } = tab, from = this.remove(tabId);
      this.add(windowId, tabId);
      Object.assign(tabs.get(tabId), { title, dirty });
      return from;
    },
    activate(tabId) {
      const tab = tabs.get(tabId);
      if (!tab) return false;
      windows.get(tab.window).active = tabId;
      return true;
    },
    // Move a tab to a position in its window's order (drag to reorder).
    move(tabId, index) {
      const tab = tabs.get(tabId);
      if (!tab || !Number.isInteger(index)) return false;
      const order = windows.get(tab.window).order;
      order.splice(order.indexOf(tabId), 1);
      order.splice(Math.max(0, Math.min(index, order.length)), 0, tabId);
      return true;
    },
    // The tab `step` places away from the active one, wrapping (Ctrl+Tab).
    neighbour(windowId, step) {
      const w = windows.get(windowId);
      if (!w?.order.length) return null;
      const i = w.order.indexOf(w.active);
      return w.order[(i + step + w.order.length * 2) % w.order.length];
    },
    update(tabId, { title, dirty }) {
      const tab = tabs.get(tabId);
      if (!tab) return false;
      if (typeof title === 'string') tab.title = title.trim().slice(0, 200) || 'Home';
      if (typeof dirty === 'boolean') tab.dirty = dirty;
      return true;
    },
    windowOf: tabId => tabs.get(tabId)?.window ?? null,
    active: windowId => windows.get(windowId)?.active ?? null,
    list(windowId) {
      const w = windows.get(windowId);
      return w ? w.order.map(id => ({ id, title: tabs.get(id).title, dirty: tabs.get(id).dirty, active: id === w.active })) : [];
    },
    all() {
      return [...windows.keys()].flatMap(windowId => this.list(windowId).map(t => ({ ...t, window: windowId })));
    },
  };
}
