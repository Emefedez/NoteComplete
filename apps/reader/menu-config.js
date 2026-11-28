// The page's right-click menu, as the user arranged it: which entries, in which order,
// dividers, and prefabs of their own choosing (`prefab:<id>`). Kept on this device.
import { icon } from './icons.js';

const KEY = 'notecomplete-page-menu';
export const PAGE_MENU_DEFAULT = ['prefab', 'shape', 'image', 'text', '-', 'export', 'undo'];

export function pageMenuOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(saved) && saved.every((id) => typeof id === 'string')) return saved;
  } catch { /* Optional. */ }
  return [...PAGE_MENU_DEFAULT];
}

function save(order) {
  try {
    if (JSON.stringify(order) === JSON.stringify(PAGE_MENU_DEFAULT)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(order));
  } catch { /* Optional. */ }
}

const make = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
};

// `actions`: [{ id, label, icon }] the built-in entries; `prefabs`: [{ id, label, icon }].
// Resolves to the new order, or null when cancelled.
export function customizePageMenu({ actions, prefabs }) {
  return new Promise((resolve) => {
    let order = pageMenuOrder();
    const describe = (id) => {
      if (id === '-') return { label: 'Divider', icon: 'minus' };
      if (id.startsWith('prefab:')) {
        const p = prefabs.find((q) => q.id === id.slice(7));
        return p ? { label: `Insert ${p.label}`, icon: p.icon || 'graph' } : null;
      }
      return actions.find((a) => a.id === id) || null;
    };
    const dialog = make('dialog', { className: 'ocr-dialog menu-config' });
    dialog.setAttribute('aria-label', 'Customize the page menu');
    const list = make('ul', { className: 'menu-config-list' });
    const add = make('select');
    add.setAttribute('aria-label', 'Entry to add');
    const addButton = make('button', { type: 'button', textContent: 'Add' });
    const close = make('button', { type: 'button', className: 'dlg-close', title: 'Close' }, icon('close'));
    close.setAttribute('aria-label', 'Close');
    const reset = make('button', { type: 'button', textContent: 'Reset' });
    const cancel = make('button', { type: 'button', textContent: 'Cancel' });
    const done = make('button', { type: 'button', className: 'primary', textContent: 'Save' });
    const small = (name, title, onclick, disabled = false) => {
      const b = make('button', { type: 'button', title, onclick, disabled }, icon(name));
      b.setAttribute('aria-label', title);
      return b;
    };
    function render() {
      order = order.filter((id) => describe(id));
      list.replaceChildren(...order.map((id, i) => {
        const d = describe(id);
        const row = make('li', { className: id === '-' ? 'divider' : '' }, icon(d.icon || 'note'), make('span', { textContent: d.label }),
          small('arrowUp', 'Move up', () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; render(); list.children[i - 1]?.querySelector('button')?.focus(); }, i === 0),
          small('arrowDown', 'Move down', () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; render(); list.children[i + 1]?.querySelectorAll('button')[1]?.focus(); }, i === order.length - 1),
          small('close', 'Remove', () => { order.splice(i, 1); render(); }));
        row.dataset.id = id;
        return row;
      }));
      const groups = [
        ['Entries', actions.filter((a) => !order.includes(a.id)).map((a) => [a.id, a.label])],
        ['Prefabs', prefabs.filter((p) => !order.includes(`prefab:${p.id}`)).map((p) => [`prefab:${p.id}`, `Insert ${p.label}`])],
        ['Other', [['-', 'Divider']]],
      ];
      add.replaceChildren(...groups.filter(([, items]) => items.length).map(([label, items]) =>
        make('optgroup', { label }, ...items.map(([value, text]) => make('option', { value, textContent: text })))));
      addButton.disabled = !add.options.length;
    }
    addButton.onclick = () => { if (add.value) { order.push(add.value); render(); list.lastElementChild?.scrollIntoView({ block: 'nearest' }); } };
    reset.onclick = () => { order = [...PAGE_MENU_DEFAULT]; render(); };
    const finish = (value) => { dialog.close(); dialog.remove(); if (value) save(value); resolve(value); };
    close.onclick = cancel.onclick = () => finish(null);
    done.onclick = () => finish(order);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    dialog.append(
      make('div', { className: 'exam-dlg-head' }, make('h2', {}, icon('menu'), ' Page menu'), close),
      make('p', { className: 'muted', textContent: 'What a right-click (or a long press) on the page offers, top to bottom. Add prefabs you use often to insert them in one step.' }),
      list,
      make('div', { className: 'menu-config-add' }, add, addButton),
      make('div', { className: 'ocr-actions' }, reset, make('span', { style: 'flex:1' }), cancel, done));
    render();
    document.body.append(dialog);
    dialog.showModal();
  });
}
