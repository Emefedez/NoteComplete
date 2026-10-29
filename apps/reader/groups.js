// Groups: documents read together, listed in the side panel so you can jump between them.
// A group is a folder on disk (File → Open folder…), a folder made in NoteComplete (Home →
// New folder, kind 'folder'), or files added to an open document (Add documents…). Saved in the library as settings `group:<id>`; the files stay where they are.
// A member is { key, name, source: 'local', path } or a Drive note from Recent { key, name, source: 'drive' }.
import { TYPES, typeOf } from './note-facts.js';

const PREFIX = 'group:';
const dirname = (p) => String(p || '').replace(/\/[^/]*$/, '');

export function localMember(path, name) {
  return { key: 'local:' + path, name, source: 'local', path };
}
export function webMember(url, name) {
  return { key: 'web:' + url, name, source: 'web', url };
}

// Folder groups list the folder's files as they are now, then the documents added by hand.
export function mergeMembers(listed = [], added = []) {
  const seen = new Set(), out = [];
  for (const m of [...listed.map((f) => ({ ...localMember(f.path, f.name), inFolder: true })), ...added])
    if (m?.key && !seen.has(m.key)) { seen.add(m.key); out.push(m); }
  return out;
}

export function starredFirst(members, starred = []) {
  const on = new Set(starred);
  return [...members.filter((m) => on.has(m.key)).map((m) => ({ ...m, starred: true })), ...members.filter((m) => !on.has(m.key))];
}

export function groupStore({ store, bridge = globalThis.notecompleteFiles }) {
  const all = async () => {
    const keys = (await store.keys('settings').catch(() => [])).filter((k) => String(k).startsWith(PREFIX));
    return (await Promise.all(keys.map((k) => store.get('settings', k).catch(() => null)))).filter(Boolean);
  };
  const save = (group) => store.set('settings', PREFIX + group.id, group);
  return {
    all,
    save,
    // Starred documents (group.starred, keys) come first, each part in its own order.
    async members(group) {
      const listed = group.folder && bridge?.listFolder ? await bridge.listFolder(group.folder).catch(() => []) : [];
      return starredFirst(mergeMembers(listed, group.members), group.starred);
    },
    async star(group, key, on) {
      const fresh = (await store.get('settings', PREFIX + group.id).catch(() => null)) || group;
      fresh.starred = (fresh.starred || []).filter((k) => k !== key);
      if (on) fresh.starred.push(key);
      group.starred = fresh.starred;
      await save(fresh);
    },
    // A document renamed on disk keeps its place: in the members, the stars and its folder.
    async renamed(oldKey, member) {
      for (const g of await all()) {
        const listed = g.members?.some((m) => m.key === oldKey), starred = g.starred?.includes(oldKey);
        if (!listed && !starred) continue;
        if (listed) g.members = g.members.map((m) => (m.key === oldKey ? member : m));
        if (starred) g.starred = g.starred.map((k) => (k === oldKey ? member.key : k));
        await save(g);
      }
    },
    // The group a document belongs to: listed in it, or a file directly in its folder.
    async of(member) {
      if (!member?.key) return null;
      const groups = await all();
      return groups.find((g) => g.members?.some((m) => m.key === member.key))
        || (member.path && groups.find((g) => g.folder && g.folder === dirname(member.path)))
        || null;
    },
    async openFolder({ folder, name }) {
      const id = 'folder:' + folder;
      const group = (await store.get('settings', PREFIX + id).catch(() => null)) || { id, name, folder, members: [] };
      await save(group);
      return group;
    },
    // Adds documents to the current one's group; without a group, they start one with it.
    async add(current, added, name) {
      let group = await this.of(current);
      if (!group) group = { id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, members: [current] };
      else if (!group.members.some((m) => m.key === current.key) && !group.folder) group.members.unshift(current);
      for (const m of added) if (!group.members.some((x) => x.key === m.key)) group.members.push(m);
      await save(group);
      return group;
    },
    // A group left with one document by hand is dissolved; folders (on disk or made here) stay.
    async remove(group, key) {
      group.members = group.members.filter((m) => m.key !== key);
      if (!group.folder && group.kind !== 'folder' && group.members.length < 2) await store.delete('settings', PREFIX + group.id);
      else await save(group);
    },
    async create(name) {
      const group = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, kind: 'folder', members: [], openedAt: Date.now() };
      await save(group);
      return group;
    },
    async rename(group, name) { group.name = name; await save(group); },
    // Forgets the folder in NoteComplete; no file is touched.
    delete: (group) => store.delete('settings', PREFIX + group.id),
    async touch(group) { group.openedAt = Date.now(); await save(group); },
    // A document sits in one folder made here at a time: moving takes it out of the others.
    async move(member, target) {
      for (const g of await all()) if (g.id !== target.id && !g.folder && g.members?.some((m) => m.key === member.key)) await this.remove(g, member.key);
      const fresh = (await store.get('settings', PREFIX + target.id).catch(() => null)) || target;
      if (!fresh.members.some((m) => m.key === member.key)) fresh.members.push(member);
      await save(fresh);
      return fresh;
    },
    // Folders for Home, most recently opened first.
    async folders() { return (await all()).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)); },
  };
}

// The list in the side panel. `mount(slot)` moves it next to the open view's content.
// A star button (empty, filled when on) that keeps a document at the top of its folder.
export function starButton(on, label, toggle) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'star-toggle';
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', `${on ? 'Unstar' : 'Star'} ${label}`);
  b.title = on ? 'Starred: listed first in the folder (click to unstar)' : 'Star: list it first in the folder';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS(svg.namespaceURI, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z');
  svg.append(path); b.append(svg);
  b.onclick = (event) => { event.stopPropagation(); toggle(!on); };
  return b;
}

// contextMenu(member, anchor, event): right click on a document of the list (Rename… for files on disk).
export function groupPanel({ root, name, list, add, groups, open, status = () => {}, onChange = () => {}, contextMenu = null }) {
  let current = null, group = null, token = 0;
  async function render() {
    const mine = ++token;
    group = current ? await groups.of(current).catch(() => null) : null;
    const members = group ? await groups.members(group) : [];
    if (mine !== token) return;
    root.hidden = !group;
    onChange(group);
    if (!group) return;
    name.textContent = group.name;
    name.title = group.folder ? `Folder: ${group.folder}` : group.name;
    list.replaceChildren(...members.map((m) => {
      const li = document.createElement('li'), button = document.createElement('button'), kind = document.createElement('span'), label = document.createElement('span');
      button.type = 'button';
      button.className = 'group-item';
      kind.className = 'group-kind';
      kind.textContent = m.source === 'web' ? 'Web' : TYPES[typeOf(m.name)]?.[0] || 'File';
      label.className = 'group-name';
      label.textContent = m.source === 'web' ? m.name : m.name.replace(/\.[^.]+$/, '');
      button.title = m.source === 'web' ? m.url : m.name;
      button.append(kind, label);
      if (m.key === current.key) button.setAttribute('aria-current', 'page');
      button.onclick = () => m.key !== current.key && open(m).catch((error) => status(error.message, true));
      if (contextMenu) button.oncontextmenu = (event) => { event.preventDefault(); contextMenu(m, button, event); };
      li.append(starButton(!!m.starred, m.name, async (on) => { await groups.star(group, m.key, on); render(); }), button);
      if (!m.inFolder) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'group-remove';
        remove.textContent = '×';
        remove.title = `Remove ${m.name} from ${group.name} (the file is not deleted)`;
        remove.setAttribute('aria-label', remove.title);
        remove.onclick = async () => { await groups.remove(group, m.key); status(`${m.name} removed from ${group.name}.`); render(); };
        li.append(remove);
      }
      return li;
    }));
  }
  if (add) add.onclick = () => pick();
  async function pick() {
    if (!current) return status('Open a document from this device or Drive first.', true);
    const chosen = await globalThis.notecompleteFiles?.pickFiles?.();
    if (!chosen?.length) return;
    const g = await groups.add(current, chosen.map((f) => localMember(f.path, f.name)), current.name.replace(/\.[^.]+$/, ''));
    status(`${chosen.length === 1 ? chosen[0].name : `${chosen.length} documents`} added to ${g.name}.`);
    render();
  }
  return {
    // The open document (a member), or null when none can be reopened by key.
    set(member) { current = member; return render(); },
    mount(slot) { if (slot && root.parentElement !== slot) slot.append(root); },
    pick,
    get group() { return group; },
    render,
  };
}
