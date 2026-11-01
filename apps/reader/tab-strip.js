// The tab strip in the top bar (desktop app): one tab per open note in this
// window, + for a new tab, × to close, drag to reorder, the wheel scrolls it
// sideways, and a tab dragged out of the strip opens in a window of its own.
// A single tab is shown as a tab too: the bar never switches to a centred title.
// (Without a tab bridge there are no tabs and #title stays.) Narrow windows, where the
// strip has no room, show the number of tabs instead; it opens a list of them.
import { sortable } from './reorder.js';

const $ = id => document.getElementById(id);

export function tabStrip(bridge, { dirty, beforeClose = () => true }) {
  if (!bridge) return { update() {} };
  const strip = $('tabStrip');
  let tabs = [];
  function render(list) {
    tabs = list;
    document.body.classList.toggle('has-tabs', tabs.length > 0);
    strip.hidden = false;
    const items = tabs.length > 0 ? tabs.map(tab => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.current ? ' current' : '') + (tab.dirty ? ' dirty' : '');
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(tab.current));
      el.dataset.id = String(tab.id);
      el.title = tab.dirty ? `${tab.title} (unsaved changes)` : tab.title;
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.title;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.textContent = '×';
      close.setAttribute('aria-label', `Close ${tab.title}`);
      close.onclick = event => { event.stopPropagation(); bridge.close(tab.id); };
      el.append(label, close);
      el.onclick = () => tab.current || bridge.activate(tab.id);
      el.onauxclick = event => event.button === 1 && bridge.close(tab.id);
      return el;
    }) : [];
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tab-new';
    add.textContent = '+';
    add.title = 'New tab (Ctrl T)';
    add.setAttribute('aria-label', 'New tab');
    add.onclick = () => bridge.open();
    strip.replaceChildren(...items, add);
    strip.querySelector('.tab.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    count.hidden = !tabs.length;
    count.textContent = String(tabs.length);
    count.title = `${tabs.length} open ${tabs.length === 1 ? 'tab' : 'tabs'}`;
    if (!menu.hidden) fillMenu();
  }
  // Narrow windows: the count opens the list (switch, close, new tab).
  const count = $('tabCount'), menu = $('tabMenu');
  const closeMenu = () => { menu.hidden = true; count.setAttribute('aria-expanded', 'false'); };
  function fillMenu() {
    const rows = tabs.map(tab => {
      const row = document.createElement('div');
      row.className = 'tab-menu-row' + (tab.current ? ' current' : '');
      const go = document.createElement('button');
      go.type = 'button';
      go.setAttribute('role', 'menuitemradio');
      go.setAttribute('aria-checked', String(tab.current));
      go.textContent = (tab.dirty ? '• ' : '') + tab.title;
      go.onclick = () => { closeMenu(); if (!tab.current) bridge.activate(tab.id); };
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tab-close';
      x.textContent = '×';
      x.setAttribute('aria-label', `Close ${tab.title}`);
      x.onclick = () => bridge.close(tab.id);
      row.append(go, x);
      return row;
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tab-menu-new';
    add.textContent = '+ New tab';
    add.onclick = () => { closeMenu(); bridge.open(); };
    menu.replaceChildren(...rows, add);
  }
  count.onclick = () => {
    if (!menu.hidden) return closeMenu();
    fillMenu();
    menu.hidden = false;
    count.setAttribute('aria-expanded', 'true');
  };
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target) && event.target !== count) closeMenu(); }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) closeMenu(); });
  // Drag a tab along the strip; the others slide aside, and it lands where dropped.
  // Dragged out of the strip, it moves to a new window, note and edits included.
  sortable(strip, { items: '.tab', ignore: '.tab-close', key: el => Number(el.dataset.id),
    onReorder: (order, id) => bridge.move(id, order.indexOf(id)), onDetach: id => bridge.detach(id) });
  strip.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { strip.scrollLeft += event.deltaY; event.preventDefault(); }
  }, { passive: false });
  bridge.onList(render);
  bridge.list().then(render).catch(() => {});
  // beforeClose: a sharing session asks first (it may end the session or cancel).
  bridge.onCloseRequest(async () => {
    if (!(await beforeClose())) return;
    if (!dirty() || confirm('This tab has unsaved changes. Close it and discard them?')) bridge.closeSelf();
  });
  return { update: state => bridge.update(state).catch(() => {}) };
}
