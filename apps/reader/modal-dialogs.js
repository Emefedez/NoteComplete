// Dialogs that leave the tabs usable and the note visible. A dialog shown with showModal()
// is normally in the browser's top layer over a grey backdrop, and everything else is inert,
// the tab strip too: with a dialog open, the desktop app's tabs could not be switched. This
// keeps what showModal() means for the rest of the app (one dialog at a time takes the
// keyboard and the pointer, Escape cancels it) but draws no backdrop, and leaves the tab
// strip, the tab count and its list working. Everything else is made inert while it is open.
// A dialog with data-modal="native" (the picture viewer, dark on purpose) keeps the browser's.

// The tab strip's elements (tab-strip.js): kept usable over any dialog.
const TABS = ['tabStrip', 'tabCount', 'tabMenu'];

export function installModalDialogs({ doc = globalThis.document } = {}) {
  const win = doc?.defaultView;
  const proto = win?.HTMLDialogElement?.prototype;
  if (!proto || proto.showModal.ncModal) return null;
  const nativeShow = proto.showModal, nativeClose = proto.close;
  const stack = [];
  let made = [];   // elements this module made inert, to give back
  let watcher = null;

  // The space the tab bar takes at the top: full-window dialogs start under it.
  function measureTop() {
    const bar = doc.body.classList.contains('has-tabs') && doc.getElementById('commandBar');
    const top = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0;
    doc.documentElement.style.setProperty('--modal-top', `${top}px`);
  }
  function release() {
    for (const el of made) el.inert = false;
    made = [];
  }
  // Everything inert but the top dialog, the tab strip and the path down to them.
  function apply() {
    release();
    const top = stack[stack.length - 1];
    if (!top) return;
    const keep = [top, ...TABS.map((id) => doc.getElementById(id)).filter(Boolean)];
    const path = new Set();
    for (const el of keep) for (let n = el; n && n !== doc.documentElement; n = n.parentElement) path.add(n);
    for (const n of path) {
      if (keep.includes(n)) continue;
      for (const child of n.children) {
        if (path.has(child) || child.inert || /^(SCRIPT|STYLE|LINK|META|TEMPLATE)$/.test(child.tagName)) continue;
        // Menus and pickers opened from the dialog itself (added to the page after it).
        if (n === doc.body && child.compareDocumentPosition(top) & win.Node.DOCUMENT_POSITION_PRECEDING && !(child instanceof win.HTMLDialogElement)) continue;
        child.inert = true;
        made.push(child);
      }
    }
  }
  function forget(dialog) {
    const at = stack.indexOf(dialog);
    if (at < 0) return;
    stack.splice(at, 1);
    dialog.classList.remove('nc-modal');
    dialog.style.removeProperty('z-index');
    if (!stack.length) { watcher?.disconnect(); watcher = null; }
    apply();
  }
  // A dialog closed by a form, or taken out of the page while open.
  function prune() {
    for (const d of [...stack]) if (!d.open || !d.isConnected) forget(d);
  }

  proto.showModal = function showModal() {
    if (this.dataset.modal === 'native') return nativeShow.call(this);
    // A floating window (data-window): open beside the note, not over it; nothing goes inert.
    if (this.dataset.window !== undefined) { if (!this.open) this.show(); return; }
    if (this.open) return;
    // Last in the page, out of any menu it was written in (a menu bar can clip or mask what
    // it holds; the top layer did that before), so what opens from it comes after it.
    if (doc.body.lastElementChild !== this) doc.body.append(this);
    stack.push(this);
    this.classList.add('nc-modal');
    this.style.zIndex = String(1000 + stack.length);
    measureTop();
    this.show();
    apply();
    this.addEventListener('close', () => forget(this), { once: true });
    if (!watcher) {
      watcher = new win.MutationObserver(prune);
      watcher.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    }
  };
  proto.showModal.ncModal = true;
  proto.close = function close(...args) {
    nativeClose.apply(this, args);
    forget(this);
  };

  // Escape cancels the top dialog, as for a modal one, unless something in it used the key.
  doc.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (e.key !== 'Escape' || !top || e.isComposing) return;
    setTimeout(() => {
      if (e.defaultPrevented || stack[stack.length - 1] !== top || !top.open) return;
      const cancel = new win.Event('cancel', { cancelable: true });
      if (top.dispatchEvent(cancel)) top.close();
    }, 0);
  }, true);
  win.addEventListener('resize', () => stack.length && measureTop());
  return { open: () => [...stack] };
}
