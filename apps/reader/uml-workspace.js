// Workspace tabs for the UML editor, as in Visual Paradigm's diagram windows: several diagrams
// open at once, one tab each, switched with a click or Ctrl Page Up / Page Down. Each tab keeps
// its own editor (undo, selection, zoom and view): only the active one is in the page, the
// others are detached, so they draw nothing and take no keys. "+" starts a new diagram, the
// list button opens any other diagram the workspace knows (the note's other UML diagrams, or
// closed drafts on the editor's own page). Closing a tab keeps its changes; nothing is lost.
import { mountUmlEditor } from './uml-editor.js';
import { DIAGRAMS, normalizeModel, starterModel, umlName } from './uml.js';
import { icon } from './icons.js';
import { openContextMenu as openMenu } from './context-menu.js';

const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
};
const labelOf = (model) => (model?.name || '').trim() || (model?.title || '').trim() || umlName(model);
let newCount = 0;

// `tabs`: [{ key, spec, label?, isNew? }] open at the start; `active`: the key shown first.
// `options(tab)`: mountUmlEditor's options for that tab (its own onApply, project…).
// `catalog()`: diagrams that can be opened as tabs, [{ key, spec, label }].
// `onChange(ws)`: after any edit, tab opened, closed or switched (the page saves its drafts).
// Returns { tabs(), active(), open(entry), activate(key), editor(key), destroy() }.
export function mountUmlWorkspace(root, { tabs: start = [], active: startKey = null, options = () => ({}), catalog = () => [], onChange = null, onSwitch = null } = {}) {
  root.classList.add('uml-ws');
  const strip = make('div', { className: 'uml-ws-strip', role: 'tablist', ariaLabel: 'Open diagrams' });
  const addBtn = make('button', { type: 'button', className: 'uml-ws-tool', title: 'New diagram in a new tab' }, icon('plus'));
  addBtn.setAttribute('aria-label', 'New diagram');
  const listBtn = make('button', { type: 'button', className: 'uml-ws-tool uml-ws-list', title: 'Open another diagram (every diagram of this workspace)' }, icon('collapse'));
  listBtn.setAttribute('aria-label', 'Open another diagram');
  const head = make('div', { className: 'uml-ws-head' }, strip, addBtn, listBtn);
  const body = make('div', { className: 'uml-ws-body' });
  root.replaceChildren(head, body);

  const tabs = [];
  let current = null;
  const host = () => root.closest('dialog') || document.body;
  const find = (key) => tabs.find((t) => t.key === key);

  function mount(tab) {
    if (tab.editor) return;
    tab.host = make('div', { className: 'uml-ws-pane' });
    body.append(tab.host);
    const own = options(tab) || {};
    let ready = false;
    tab.editor = mountUmlEditor(tab.host, tab.spec, {
      ...own,
      onChange: (m) => {
        own.onChange?.(m);
        if (!ready) return;
        tab.touched = true;
        const next = labelOf(m);
        if (next !== tab.label) { tab.label = next; render(); } else tab.button?.classList.add('changed');
        onChange?.(api);
      },
    });
    ready = true;
  }
  function render() {
    strip.replaceChildren(...tabs.map((tab) => {
      const name = make('span', { className: 'uml-ws-name', textContent: tab.label });
      const close = tabs.length > 1 && make('span', { className: 'uml-ws-close', title: 'Close this tab (its changes are kept)', role: 'button' }, icon('close'));
      const b = make('button', { type: 'button', className: 'uml-ws-tab', title: `${tab.label}${tab.where ? ` · ${tab.where}` : ''}` }, make('span', { className: 'uml-ws-dot' }), name, close);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab === current));
      b.classList.toggle('changed', !!tab.touched || !!tab.isNew);
      b.onclick = (ev) => { if (close && close.contains(ev.target)) closeTab(tab.key); else activate(tab.key); };
      b.onauxclick = (ev) => { if (ev.button === 1 && tabs.length > 1) { ev.preventDefault(); closeTab(tab.key); } };
      tab.button = b;
      return b;
    }));
    current?.button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  function activate(key) {
    const tab = find(key);
    if (!tab || tab === current) return tab?.editor || null;
    if (current?.host) current.host.remove();
    current = tab;
    if (tab.editor) body.append(tab.host); else mount(tab);
    render();
    tab.editor.focus();
    onSwitch?.(tab);
    onChange?.(api);
    return tab.editor;
  }
  // Opens `entry` ({ key, spec, label?, where?, isNew? }) in a tab, or shows it when it is open.
  function open(entry, { show = true } = {}) {
    if (!entry) return null;
    let tab = find(entry.key);
    if (!tab) {
      const spec = normalizeModel(entry.spec);
      tab = { key: entry.key, spec, base: JSON.stringify(spec), label: entry.label || labelOf(entry.spec), where: entry.where || '', isNew: !!entry.isNew, touched: false, editor: null, host: null, button: null, data: entry.data };
      tabs.splice(current ? tabs.indexOf(current) + 1 : tabs.length, 0, tab);
    }
    if (show) activate(tab.key); else render();
    return tab;
  }
  function closeTab(key) {
    const tab = find(key);
    if (!tab || tabs.length < 2) return;
    const i = tabs.indexOf(tab);
    tab.closed = { output: tab.editor ? tab.editor.output() : tab.spec, touched: tab.touched };
    tab.editor?.destroy();
    tab.host?.remove();
    tab.editor = tab.host = tab.button = null;
    tabs.splice(i, 1);
    // A new diagram closed untouched is dropped; anything else stays, as left.
    if (!(tab.isNew && !tab.touched)) closedTabs.set(key, tab);
    if (tab === current) { current = null; activate(tabs[Math.min(i, tabs.length - 1)].key); } else render();
    onChange?.(api);
  }
  // Tabs closed in this session: their edits still count (output()), and they reopen as left.
  const closedTabs = new Map();

  addBtn.onclick = () => {
    const r = addBtn.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4, Object.entries(DIAGRAMS).map(([kind, d]) => ({
      label: d.notRecommended ? `${d.label} (not recommended)` : d.label,
      icon: 'uml',
      run: () => open({ key: `new-${Date.now().toString(36)}-${++newCount}`, spec: starterModel(kind), isNew: true }),
    })), { title: 'New diagram', host: host() });
  };
  listBtn.onclick = () => {
    const r = listBtn.getBoundingClientRect();
    const openKeys = new Set(tabs.map((t) => t.key));
    const known = [...tabs.map((t) => ({ key: t.key, label: t.label, where: t.where })), ...[...closedTabs.values()].map((t) => ({ key: t.key, label: t.label, where: t.where, reopen: t })), ...catalog().filter((e) => !openKeys.has(e.key) && !closedTabs.has(e.key))];
    const entries = known.map((e) => ({
      label: e.where ? `${e.label || labelOf(e.spec)} · ${e.where}` : e.label || labelOf(e.spec),
      icon: 'uml',
      checked: e.key === current?.key,
      run: () => {
        if (openKeys.has(e.key)) return activate(e.key);
        if (e.reopen) { closedTabs.delete(e.key); const t = e.reopen; t.spec = normalizeModel(t.closed.output); t.touched = t.closed.touched; delete t.closed; tabs.splice(tabs.indexOf(current) + 1, 0, t); return activate(t.key); }
        return open(e);
      },
    }));
    openMenu(r.left, r.bottom + 4, entries.length ? entries : [{ label: 'No other diagrams', disabled: true, run() {} }], { title: 'Diagrams', host: host() });
  };
  // Ctrl Page Up / Page Down: the tab before or after (as in browsers and Visual Paradigm).
  const keys = (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || (ev.key !== 'PageUp' && ev.key !== 'PageDown') || tabs.length < 2) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = tabs.indexOf(current) + (ev.key === 'PageDown' ? 1 : -1);
    activate(tabs[(i + tabs.length) % tabs.length].key);
  };
  root.addEventListener('keydown', keys, true);

  const all = () => [...tabs, ...closedTabs.values()];
  const api = {
    // Every diagram the workspace has touched: open tabs and the ones closed meanwhile, with
    // what each is now (`output`) and whether it differs from how it opened (`changed`).
    tabs: () => all().map((t) => {
      const output = t.closed ? t.closed.output : t.editor ? t.editor.output() : t.spec;
      const touched = t.closed ? t.closed.touched : t.touched;
      return { key: t.key, label: t.label, isNew: t.isNew, open: !t.closed, data: t.data, output, changed: t.isNew || (touched && JSON.stringify(normalizeModel(output)) !== t.base) };
    }),
    openKeys: () => tabs.map((t) => t.key),
    active: () => current?.key ?? null,
    open,
    activate,
    editor: (key) => find(key)?.editor || null,
    destroy: () => {
      root.removeEventListener('keydown', keys, true);
      for (const t of all()) t.editor?.destroy();
      root.replaceChildren();
    },
  };
  for (const entry of start) open(entry, { show: false });
  activate(find(startKey)?.key || tabs[0]?.key);
  return api;
}
