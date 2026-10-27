// The tab strip in the top bar (desktop app): one tab per open note in this
// window, + for a new tab, × to close, drag to reorder, the wheel scrolls it
// sideways. With a single tab the bar shows the note title as before.
const $ = id => document.getElementById(id);

export function tabStrip(bridge, { dirty }) {
  if (!bridge) return { update() {} };
  const strip = $('tabStrip');
  let tabs = [], dragged = null;
  function render(list) {
    tabs = list;
    document.body.classList.toggle('has-tabs', tabs.length > 1);
    strip.hidden = false;
    const items = tabs.length > 1 ? tabs.map(tab => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.current ? ' current' : '') + (tab.dirty ? ' dirty' : '');
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(tab.current));
      el.draggable = true;
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
      el.ondragstart = event => { dragged = tab.id; event.dataTransfer.effectAllowed = 'move'; };
      el.ondragover = event => { if (dragged != null) { event.preventDefault(); el.classList.add('drop'); } };
      el.ondragleave = () => el.classList.remove('drop');
      el.ondrop = event => {
        event.preventDefault();
        el.classList.remove('drop');
        if (dragged != null && dragged !== tab.id) bridge.move(dragged, tabs.findIndex(t => t.id === tab.id));
        dragged = null;
      };
      el.ondragend = () => { dragged = null; };
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
  }
  strip.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { strip.scrollLeft += event.deltaY; event.preventDefault(); }
  }, { passive: false });
  bridge.onList(render);
  bridge.list().then(render).catch(() => {});
  bridge.onCloseRequest(() => {
    if (!dirty() || confirm('This tab has unsaved changes. Close it and discard them?')) bridge.closeSelf();
  });
  return { update: state => bridge.update(state).catch(() => {}) };
}
