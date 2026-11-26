// A cheat sheet for an editor: a window that floats over it (dragged by its head, resized from
// its edges, put away and brought back like Ask AI or the quiz), listing what the mouse and the
// keys do. Opened by the editor's round ? button.
import { floatingWindow } from './floating.js';
import { icon } from './icons.js';

const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
};

// "Ctrl Shift Z" → <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd>; "A / B" keeps the slash between.
const mac = typeof navigator !== 'undefined' && /Mac|iPad|iPhone/.test(navigator.platform || '');
function keysOf(text) {
  return String(text).split(' / ').flatMap((alt, i) => [
    i ? make('span', { className: 'cheat-or', textContent: '/' }) : null,
    ...alt.split(' ').filter(Boolean).map((k) => make('kbd', { textContent: mac && k === 'Ctrl' ? '⌘' : k })),
  ]);
}

// Its stylesheet, once (the editors' own pages do not carry the app's).
function ensureStyles() {
  if (document.querySelector('link[data-cheat-css]')) return;
  const link = make('link', { rel: 'stylesheet', href: new URL('./cheat-sheet.css', import.meta.url).href });
  link.dataset.cheatCss = '';
  document.head.append(link);
}
// sections: [{ title, icon?, rows: [{ keys?: 'Ctrl Z', icon?: 'name' | svg, does: 'Undo' }] }]
// `button`: the ? that opens it, shown pressed while it is open however it is closed (its ×,
// Escape, the ? again).
export function cheatSheet(host, { key, title = 'Cheat sheet', sections, button = null }) {
  ensureStyles();
  const close = make('button', { type: 'button', className: 'icon-button cheat-close', title: 'Close (Esc)' }, icon('close'));
  close.setAttribute('aria-label', 'Close');
  const head = make('div', { className: 'float-head cheat-head' }, make('h2', {}, icon('help'), ` ${title}`), close);
  const body = make('div', { className: 'cheat-body' }, ...sections.map((s) => make('section', {},
    make('h3', {}, s.icon ? icon(s.icon) : null, ` ${s.title}`),
    make('div', { className: 'cheat-rows' }, ...s.rows.map((r) => make('div', { className: 'cheat-row' },
      make('span', { className: 'cheat-keys' }, r.icon ? (typeof r.icon === 'string' ? icon(r.icon) : r.icon.cloneNode(true)) : null, ...(r.keys ? keysOf(r.keys) : [])),
      make('span', { className: 'cheat-does', textContent: r.does })))))));
  const dialog = make('dialog', { className: 'cheat-window' }, head, body);
  dialog.setAttribute('aria-label', title);
  host.append(dialog);
  const pressed = () => button?.setAttribute('aria-pressed', String(dialog.open));
  dialog.addEventListener('close', pressed);
  close.onclick = () => dialog.close();
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dialog.close(); } });
  floatingWindow(dialog, { key: `notecomplete-${key}-cheat`, head, close, label: title, compact: { cls: 'minimized' }, minWidth: 300, minHeight: 220, scroll: true });
  return {
    toggle() { if (dialog.open) dialog.close(); else dialog.show(); pressed(); return dialog.open; },
    get open() { return dialog.open; },
    destroy() { dialog.close(); dialog.remove(); },
  };
}
