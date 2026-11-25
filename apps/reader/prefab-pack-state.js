// Which prefab packs this device has (docs/TABLES-AND-OFFICE.md, phase 7), kept in
// localStorage `notecomplete-prefab-packs` (the desktop app's lives in its own profile, like
// the rest of the reader's settings):
//   { v: 1, all, packs: { id: true | false }, off: [card ids], hideMissing }
// - `all`: packs it says nothing about are installed (true until someone chooses: existing
//   users keep everything they had, and new ones start from Everything, as the wizard does);
// - `packs`: the packs chosen one by one, installed (true) or removed (false);
// - `off`: prefabs turned off in an installed pack (the wizard's tree), out of the picker
//   until turned on again;
// - `hideMissing`: the picker's eye, which hides what is not installed.
// The core pack is always installed. Pure functions over a storage, so they are tested in Node;
// without a browser (MCP, tests) everything shipped counts as installed.
export const PACKS_KEY = 'notecomplete-prefab-packs';
const DEFAULT = { v: 1, all: true, packs: {}, off: [], hideMissing: false };

const browserStorage = () => {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
};
export function readPackState(storage = browserStorage()) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(PACKS_KEY) || 'null'); } catch { /* Defaults. */ }
  if (!saved || typeof saved !== 'object') return structuredClone(DEFAULT);
  return {
    v: 1,
    all: saved.all !== false,
    packs: saved.packs && typeof saved.packs === 'object' ? { ...saved.packs } : {},
    off: Array.isArray(saved.off) ? saved.off.filter((id) => typeof id === 'string') : [],
    hideMissing: !!saved.hideMissing,
  };
}
export function writePackState(state, storage = browserStorage()) {
  try { storage?.setItem(PACKS_KEY, JSON.stringify(state)); } catch { /* Kept for this session only. */ }
  return state;
}
// Whether a pack ({ id, core }) is installed in `state`.
export const packOn = (state, pack) => !!pack && (!!pack.core || (state.packs[pack.id] ?? state.all) === true);
// The state with one pack installed or removed (its prefabs turned on again when installed).
export function withPack(state, packId, on, cardIds = []) {
  const next = { ...state, packs: { ...state.packs, [packId]: !!on } };
  if (on) next.off = state.off.filter((id) => !cardIds.includes(id));
  return next;
}
export const withCard = (state, cardId, on) => ({ ...state, off: on ? state.off.filter((id) => id !== cardId) : [...new Set([...state.off, cardId])] });

// ---- The wizard's tree: Everything ▸ packs ▸ prefabs ----
// `packs`: [{ id, core, requires: [ids], cards: [ids] }]; `selected`: a Set of card ids (and
// the ids of packs with no cards). A parent is "on", "off" or "some" from its leaves.
const leaves = (pack) => (pack.cards?.length ? pack.cards : [pack.id]);
export function treeState(packs, selected) {
  const out = { packs: {} };
  let on = 0, total = 0;
  for (const pack of packs) {
    const list = leaves(pack);
    const n = list.filter((id) => selected.has(id)).length;
    on += n; total += list.length;
    out.packs[pack.id] = n === 0 ? 'off' : n === list.length ? 'on' : 'some';
  }
  out.all = on === 0 ? 'off' : on === total ? 'on' : 'some';
  return out;
}
// Ticks or clears a node ("all", a pack id, or a card id) and what it holds; a pack that
// another ticked pack needs is ticked too, and clearing a needed pack clears what needs it.
export function toggleNode(packs, selected, node, on) {
  const next = new Set(selected);
  const set = (ids, value) => { for (const id of ids) value ? next.add(id) : next.delete(id); };
  if (node === 'all') for (const p of packs) set(leaves(p), on);
  else {
    const pack = packs.find((p) => p.id === node);
    if (pack) set(leaves(pack), on);
    else next[on ? 'add' : 'delete'](node);
  }
  // Needs, until nothing changes (a chain of packs that need packs).
  for (let changed = true; changed;) {
    changed = false;
    for (const p of packs) {
      const any = leaves(p).some((id) => next.has(id));
      for (const need of p.requires || []) {
        const dep = packs.find((q) => q.id === need);
        if (!dep) continue;
        const depAny = leaves(dep).some((id) => next.has(id));
        if (any && !depAny) {
          // Just cleared the needed pack: what needs it goes too; otherwise the need is ticked.
          if (!on && (node === dep.id || leaves(dep).includes(node))) set(leaves(p), false);
          else set(leaves(dep), true);
          changed = true;
        }
      }
    }
  }
  return next;
}
// The tree's ticks from what is installed now.
export function selectionFrom(packs, state) {
  const out = new Set();
  for (const p of packs) if (packOn(state, p)) for (const id of leaves(p)) if (!state.off.includes(id)) out.add(id);
  return out;
}
// What Finish does with the tree: the packs to install and to remove, and the state to keep
// (with `all` when Everything is ticked, so packs added later come installed too).
export function planFrom(packs, selected, state) {
  const tree = treeState(packs, selected);
  const install = [], remove = [];
  const keep = new Set(packs.filter((p) => p.core || tree.packs[p.id] !== 'off').map((p) => p.id));
  const next = { ...state, all: tree.all === 'on', packs: {}, off: [] };
  for (const p of packs) {
    const wanted = keep.has(p.id);
    if (!p.core) next.packs[p.id] = wanted;
    if (wanted && !packOn(state, p)) install.push(p.id);
    if (!wanted && packOn(state, p)) remove.push(p.id);
    if (wanted && p.cards?.length) for (const id of p.cards) if (!selected.has(id)) next.off.push(id);
  }
  return { install, remove, state: next };
}
