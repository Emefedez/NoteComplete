// "One of each" for the web providers (Drive, Dropbox): items with the same name in a list
// (a Noteful backup leaves several folders and notes called the same) show as one card with
// a ×N count; choosing it lists every copy (when it changed, its size) to pick from.
// The switch is one setting for every provider, on by default; flipping it fires
// `notecomplete:duplicates` on window so open lists redraw.
import { openContextMenu } from './context-menu.js';

const KEY = 'notecomplete-hide-duplicates';
export function hideDuplicates(storage = globalThis.localStorage) {
  try { return storage?.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setHideDuplicates(on, { storage = globalThis.localStorage, target = globalThis } = {}) {
  try { storage?.setItem(KEY, on ? 'on' : 'off'); } catch { /* Optional. */ }
  try { target.dispatchEvent?.(new CustomEvent('notecomplete:duplicates', { detail: { on } })); } catch { /* Optional. */ }
}

export const copyKey = (name, folder) => `${folder ? 'd' : 'f'}:${String(name || '').normalize('NFC').trim().toLocaleLowerCase()}`;

// Groups items as they arrive (pages of a listing come one after another). add() returns the
// new group for the first of a name, or null when the item joined an earlier card.
export function copyGroups() {
  const groups = new Map();
  return {
    clear: () => groups.clear(),
    add(key, item) {
      const known = groups.get(key);
      if (known) { known.copies.push(item); known.changed?.(); return null; }
      const group = { copies: [item], changed: null };
      groups.set(key, group);
      return group;
    },
  };
}

const day = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'date unknown');
const megabytes = (n) => (Number(n) ? `${(Number(n) / 1048576).toFixed(1)} MB` : '');
// Newest first; the menu's rows: when it changed, its size, where it is when known.
export function copyRows(copies, { where = () => '' } = {}) {
  return [...copies]
    .sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')))
    .map((item, i) => ({ item, label: [day(item.modifiedTime), megabytes(item.size), where(item), i === 0 ? 'newest' : ''].filter(Boolean).join(' · ') }));
}

// The ×N count on a card, kept up to date as more copies arrive.
export function copyCount(group, meta) {
  const badge = document.createElement('span');
  badge.className = 'note-badge copies-badge';
  const update = () => {
    const n = group.copies.length;
    badge.hidden = n < 2;
    badge.textContent = `×${n}`;
    badge.title = `${n} items with this name: choose one when opening`;
  };
  group.changed = update;
  update();
  meta.append(badge);
}

// Opens `pick(item)` at once for a single copy, else a menu of the copies at the card.
export function chooseCopy(group, anchor, pick, { name = '', where } = {}) {
  if (group.copies.length < 2) return pick(group.copies[0]);
  const box = anchor.getBoundingClientRect();
  openContextMenu(box.left + 12, box.bottom - 6, copyRows(group.copies, { where }).map(({ item, label }) => ({
    label, icon: item.mimeType?.endsWith('folder') || item.isFolder ? 'folder' : 'open', run: () => pick(item),
  })), { title: `${group.copies.length} copies of ${name}` });
}
