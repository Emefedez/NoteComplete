// The prefab modules (docs/PREFAB-MODULES.md): every prefab the picker offers comes from a
// module, a folder with a module.json (what it is, its picker cards) and, for figures drawn as
// pictures, a render.js (its spec as SVG, its name in menus). The shipped modules are listed
// in prefabs/index.js (generated from their folders) and are here at once; modules added in
// the modules folder (desktop: Settings → Prefab modules) join with addModule when the app
// starts. The picker, menus, MCP and exams all ask here.
// Modules come in packs (docs/TABLES-AND-OFFICE.md, phase 7; prefabs/packs.json): every
// manifest is known, but a module's code is loaded only when its pack is installed on this
// device (prefab-pack-state.js); the core pack's always is. A module without its code draws
// nothing (its figures already on pages stay: they are pictures) and its cards are "missing".
import { MODULES as SHIPPED, PACKS as PACK_INFO } from './prefabs/index.js';
import { readPackState, packOn } from './prefab-pack-state.js';

export const API = 1;
const modules = [];
let cardCache = null;

// What the picker calls its groups; a module's own groups add to these (manifest.groups).
const GROUP_LABELS = { basic: 'Tables and graphs', exam: 'Exam figures', diagram: 'Diagrams' };

// A module from its manifest and code; refused (with the reason) when it does not fit this app.
export function addModule(manifest, code = {}, { folder = manifest?.id, source = 'added', base = '', load = null, cards = null } = {}) {
  const problem = manifestProblem(manifest);
  if (problem) throw Error(`Prefab module ${manifest?.id || folder}: ${problem}`);
  const at = modules.findIndex((m) => m.manifest.id === manifest.id);
  // `load`: imports its code later (a shipped module of a pack not loaded yet); `cards`: the
  // names of the cards its code lists, for the picker until then.
  const entry = { manifest, code: code || {}, folder, source, base, load, lightCards: cards, ready: !load };
  // An added module with the id of a shipped one replaces it (a newer copy in the folder).
  if (at >= 0) modules[at] = entry;
  else modules.push(entry);
  cardCache = null;
  for (const listener of listeners) listener();
  return entry;
}
export function manifestProblem(m) {
  if (!m || typeof m !== 'object') return 'no module.json';
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(m.id || '')) return 'its id must be lower-case letters, digits and dashes';
  if (m.api !== API) return `it was written for api ${m.api}, this app has api ${API}`;
  if (!['type', 'custom', 'window'].includes(m.kind)) return 'its kind must be "type", "custom" or "window"';
  if (m.prefabs !== 'code' && !Array.isArray(m.prefabs)) return 'it lists no prefabs';
  return '';
}
const listeners = new Set();
// Called whenever modules are added (the picker's lists follow).
export const onModules = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const listModules = () => [...modules];
// Where a module's files are: shipped ones next to this file, added ones where the modules
// folder serves them.
export const moduleBase = (m) => m.base || new URL(`./prefabs/${m.folder}/`, import.meta.url).href;
export const moduleById = (id) => modules.find((m) => m.manifest.id === id) || null;

// ---- Packs ----
// A shipped module's pack: the one its manifest names (prefabs/packs.json), else its own. A
// module from the modules folder belongs to none and is always there.
export function packOf(m) {
  if (!m || m.source === 'folder' || m.source === 'added') return null;
  const id = String(m.manifest.pack || m.manifest.id);
  const info = PACK_INFO[id] || {};
  return { id, label: info.label || m.manifest.label || id, summary: info.summary || '', icon: info.icon || 'graph', order: info.order ?? 1000, core: !!info.core, requires: info.requires || [] };
}
// Every pack, in order, with its modules: [{ id, label, summary, icon, order, core, requires,
// modules }].
export function packs() {
  const out = new Map();
  for (const m of modules) {
    const p = packOf(m);
    if (!p) continue;
    if (!out.has(p.id)) out.set(p.id, { ...p, modules: [] });
    out.get(p.id).modules.push(m);
  }
  return [...out.values()].sort((a, b) => a.order - b.order);
}
export const packById = (id) => packs().find((p) => p.id === id) || null;
// Installed on this device (always, for modules outside packs and without a browser).
export function packInstalled(packOrId, state = readPackState()) {
  const p = typeof packOrId === 'string' ? packById(packOrId) : packOrId;
  return !p || packOn(state, p);
}
const moduleInstalled = (m, state) => packInstalled(packOf(m), state);
// Imports a module's code (its pack was installed); false when it could not be loaded.
export async function loadModule(m) {
  if (m.ready) return true;
  try {
    m.code = { ...(await m.load()) };
    m.ready = true;
  } catch (e) {
    console.warn(`Prefab module ${m.manifest.id}:`, e);
    return false;
  }
  cardCache = null;
  for (const listener of listeners) listener();
  return true;
}
// Tells the lists something changed (a pack removed, a prefab turned off).
export function packsChanged() {
  cardCache = null;
  for (const listener of listeners) listener();
}

for (const m of SHIPPED) addModule(m.manifest, m.code, { folder: m.folder, source: 'shipped', load: m.load || null, cards: m.cards || null });
// The installed packs' code, before anything draws (as the static imports did before packs).
{
  const state = readPackState();
  await Promise.all(modules.filter((m) => !m.ready && moduleInstalled(m, state)).map(async (m) => {
    try { m.code = { ...(await m.load()) }; m.ready = true; } catch (e) { console.warn(`Prefab module ${m.manifest.id}:`, e); }
  }));
}

// The kind the rest of the app knows a prefab by: "graph", "table", "prefab" (a picture with
// its spec) or "uml" (a picture edited in the diagram editor).
const kindOf = (m) => m.manifest.legacyKind || (m.manifest.output === 'items' ? m.manifest.id : 'prefab');

// Every card of every module, in the modules' order: { id, kind, module, pack, group, label,
// hint, icon, spec, missing, off }. `missing`: its pack is not installed (or its code could not
// load), so it cannot be inserted until it is; `off`: turned off in an installed pack. Without
// `all`, only the cards that can be inserted (what the menus, Recent and the rest list).
export function cards({ all = false } = {}) {
  if (!cardCache) {
    const state = readPackState();
    const out = [];
    for (const m of modules) {
      let list = m.manifest.prefabs;
      if (list === 'code') {
        if (!m.ready) list = m.lightCards || [];
        else { try { list = m.code.prefabs?.() || []; } catch (e) { console.warn(`Prefab module ${m.manifest.id}:`, e); list = []; } }
      }
      const pack = packOf(m);
      const missing = !m.ready || !moduleInstalled(m, state);
      for (const card of list) {
        if (!card?.id || out.some((c) => c.id === card.id)) continue;
        out.push({ ...card, kind: kindOf(m), module: m.manifest.id, pack: pack?.id || '', group: card.group || m.manifest.id, ...(card.spec ? { spec: structuredClone(card.spec) } : {}), missing, off: !missing && state.off.includes(card.id) });
      }
    }
    cardCache = { all: out, usable: out.filter((c) => !c.missing && !c.off) };
  }
  return all ? cardCache.all : cardCache.usable;
}

// The picker's groups, in order: [id, label].
export function groups({ all = false } = {}) {
  const seen = [];
  const list = cards({ all });
  for (const id of ['basic', 'exam', 'diagram', ...list.map((c) => c.group)]) if (!seen.includes(id)) seen.push(id);
  return seen.filter((id) => list.some((c) => c.group === id)).map((id) => [id, GROUP_LABELS[id] || modules.map((m) => m.manifest.groups?.[id]).find(Boolean) || id]);
}

// The module a spec belongs to: the one it names, else the one that owns its type (specs
// saved before modules existed name none).
export function moduleOf(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (spec.module) { const m = moduleById(spec.module); if (m) return m; }
  return modules.find((m) => (m.manifest.types || []).includes(spec.type)) || null;
}
// A spec with its module named, for what is inserted from now on.
export function stamp(spec) {
  const m = moduleOf(spec);
  return m && spec && !spec.module ? { module: m.manifest.id, ...spec } : spec;
}
// The figure as SVG ({ svg, width, height }), or null when it draws nothing or its module is
// missing.
export function renderSpec(spec) {
  let m = moduleOf(spec);
  // A type module draws with the module that owns its figure's type.
  if (m && !m.code.render) m = modules.find((q) => q.code.render && (q.manifest.types || []).includes(spec.type)) || null;
  if (!m?.code.render) return null;
  const out = m.code.render(spec);
  return out?.svg ? out : null;
}
// Its name in menus (a type module without names of its own: the type owner's).
export function nameOf(spec) {
  const m = moduleOf(spec);
  const own = (m?.code.name && m.code.name(spec)) || m?.manifest.names?.[spec?.type];
  if (own || !m) return own || 'Prefab';
  const owner = modules.find((q) => q !== m && (q.manifest.types || []).includes(spec?.type));
  return (owner?.code.name && owner.code.name(spec)) || owner?.manifest.names?.[spec?.type] || 'Prefab';
}

// The editors the host has (the manifest's "editor", or a type module's "base"): the chart
// editor, the diagram editor, the graph and table windows, and the JSON one with a live
// preview. The base editors of docs/PREFAB-MODULES.md map onto them.
export const EDITORS = ['chart-editor', 'uml-editor', 'graph', 'table', 'data'];
const BASES = { 'grid-paint': 'chart-editor', bars: 'chart-editor', plot: 'chart-editor', diagram: 'uml-editor', json: 'data' };
// Which editor a figure opens in, from its module's manifest: { editor, module }, where
// `editor` is "module" (the module's own editor.js, in `module`), one of EDITORS, or "" when
// the manifest says nothing (the host then chooses by the spec's type, as before modules).
// A "type" module edits in its `base`: one of the editors above, or another module's id (that
// module's editor).
export function editorOf(spec) {
  let m = moduleOf(spec);
  const seen = new Set();
  while (m && !seen.has(m)) {
    seen.add(m);
    const { kind, base, editor } = m.manifest;
    const name = String((kind === 'type' && base) || editor || '');
    if (!name) break;
    if (/\.js$/.test(name)) return { editor: 'module', module: m };
    if (EDITORS.includes(name)) return { editor: name, module: m };
    if (BASES[name]) return { editor: BASES[name], module: m };
    m = moduleById(name);
  }
  return { editor: '', module: m || moduleOf(spec) };
}
