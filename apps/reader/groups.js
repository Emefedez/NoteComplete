// Groups: documents read together, listed in the side panel so you can jump between them.
// A group is a folder (File → Open folder…) or files added to an open document (Add
// documents…). Saved in the library as settings `group:<id>`; the files stay where they are.
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

export function groupStore({ store, bridge = globalThis.notecompleteFiles }) {
  const all = async () => {
    const keys = (await store.keys('settings').catch(() => [])).filter((k) => String(k).startsWith(PREFIX));
    return (await Promise.all(keys.map((k) => store.get('settings', k).catch(() => null)))).filter(Boolean);
  };
  const save = (group) => store.set('settings', PREFIX + group.id, group);
  return {
    all,
    save,
    async members(group) {
      const listed = group.folder && bridge?.listFolder ? await bridge.listFolder(group.folder).catch(() => []) : [];
      return mergeMembers(listed, group.members);
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
    // A group left with one document by hand (and no folder) is dissolved.
    async remove(group, key) {
      group.members = group.members.filter((m) => m.key !== key);
      if (!group.folder && group.members.length < 2) await store.delete('settings', PREFIX + group.id);
      else await save(group);
    },
  };
}

// The list in the side panel. `mount(slot)` moves it next to the open view's content.
export function groupPanel({ root, name, list, add, groups, open, status = () => {}, onChange = () => {} }) {
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
      li.append(button);
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
  };
}
