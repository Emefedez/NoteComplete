// The quick menu (quick-menu.js) in the chart and UML editors: Shift S opens a ring of the
// palette's brushes or tools at the pointer. Held, point at one and let go to choose it;
// tapped, click one. 1–9 choose by number, Esc closes, and an item held and dragged to
// another place on the ring reorders the palette too.
import { quickMenu } from './quick-menu.js';

// Loads quick-menu.css on the editors' own pages (over a note, style.css has these rules).
function ensureStyles() {
  if ([...document.styleSheets].some((s) => /\/(style|quick-menu)\.css$/.test(s.href || '')) || document.querySelector('link[data-quick-css]')) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./quick-menu.css', import.meta.url).href });
  link.dataset.quickCss = '';
  document.head.append(link);
}

// `root`: the editor (keys and the pointer are followed in it). `entries()`: [{ key, label,
// icon (Node) or swatch, active(), run() }] in palette order. `onReorder(keys)`.
export function editorQuickMenu(root, { entries, onReorder }) {
  ensureStyles();
  let x = innerWidth / 2, y = innerHeight / 2, openedAt = 0;
  const quick = quickMenu({ inner: entries, outer: () => ({}), onReorder: (section, keys) => section === 'inner' && onReorder(keys) });
  const typing = (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable;
  const follow = (e) => { x = e.clientX; y = e.clientY; };
  // Capture, on the document: the editor's own keys (1–9, Escape) come after the open
  // menu's, and keys pressed with nothing in the editor focused (the dialog, the page) count.
  const ours = (t) => quick.isOpen || (root.isConnected && t instanceof Node && (root.contains(t) || t.contains(root)));
  const down = (e) => {
    if (!ours(e.target)) return;
    if (quick.isOpen && quick.key(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'S' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !typing(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      if (quick.isOpen) return quick.close();
      const r = root.getBoundingClientRect();
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      quick.open(inside ? x : r.left + r.width / 2, inside ? y : r.top + r.height / 2);
      openedAt = Date.now();
    }
  };
  // Let go of S over an item: it is chosen. A quick tap leaves the ring open to click.
  const up = (e) => { if (e.key.toLowerCase() === 's' && quick.isOpen && Date.now() - openedAt > 150) quick.release(); };
  root.addEventListener('pointermove', follow, true);
  document.addEventListener('keydown', down, true);
  addEventListener('keyup', up, true);
  return {
    quick,
    destroy() {
      quick.close();
      root.removeEventListener('pointermove', follow, true);
      document.removeEventListener('keydown', down, true);
      removeEventListener('keyup', up, true);
    },
  };
}
