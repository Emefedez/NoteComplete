// The prefab modules (docs/PREFAB-MODULES.md): every prefab the picker offers comes from a
// module, a folder with a module.json (what it is, its picker cards) and, for figures drawn as
// pictures, a render.js (its spec as SVG, its name in menus). The shipped modules are listed
// in prefabs/index.js (generated from their folders) and are here at once; modules added in
// the modules folder (desktop: Settings → Prefab modules) join with addModule when the app
// starts. The picker, menus, MCP and exams all ask here.
import { MODULES as SHIPPED } from './prefabs/index.js';

export const API = 1;
const modules = [];
let cardCache = null;

// What the picker calls its groups; a module's own groups add to these (manifest.groups).
const GROUP_LABELS = { basic: 'Tables and graphs', exam: 'Exam figures', diagram: 'Diagrams' };

// A module from its manifest and code; refused (with the reason) when it does not fit this app.
export function addModule(manifest, code = {}, { folder = manifest?.id, source = 'added', base = '' } = {}) {
  const problem = manifestProblem(manifest);
  if (problem) throw Error(`Prefab module ${manifest?.id || folder}: ${problem}`);
  const at = modules.findIndex((m) => m.manifest.id === manifest.id);
  const entry = { manifest, code, folder, source, base };
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
export const moduleById = (id) => modules.find((m) => m.manifest.id === id) || null;

for (const m of SHIPPED) addModule(m.manifest, m.code, { folder: m.folder, source: 'shipped' });

// The kind the rest of the app knows a prefab by: "graph", "table", "prefab" (a picture with
// its spec) or "uml" (a picture edited in the diagram editor).
const kindOf = (m) => m.manifest.legacyKind || (m.manifest.output === 'items' ? m.manifest.id : 'prefab');

// Every card of every module, in the modules' order: { id, kind, module, group, label, hint,
// icon, spec }.
export function cards() {
  if (cardCache) return cardCache;
  const out = [];
  for (const m of modules) {
    let list = m.manifest.prefabs;
    if (list === 'code') { try { list = m.code.prefabs?.() || []; } catch (e) { console.warn(`Prefab module ${m.manifest.id}:`, e); list = []; } }
    for (const card of list) {
      if (!card?.id || out.some((c) => c.id === card.id)) continue;
      out.push({ ...card, kind: kindOf(m), module: m.manifest.id, group: card.group || m.manifest.id, ...(card.spec ? { spec: structuredClone(card.spec) } : {}) });
    }
  }
  return (cardCache = out);
}

// The picker's groups, in order: [id, label].
export function groups() {
  const seen = [];
  for (const id of ['basic', 'exam', 'diagram', ...cards().map((c) => c.group)]) if (!seen.includes(id)) seen.push(id);
  return seen.filter((id) => cards().some((c) => c.group === id)).map((id) => [id, GROUP_LABELS[id] || modules.map((m) => m.manifest.groups?.[id]).find(Boolean) || id]);
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
  const m = moduleOf(spec);
  if (!m?.code.render) return null;
  const out = m.code.render(spec);
  return out?.svg ? out : null;
}
// Its name in menus.
export function nameOf(spec) {
  const m = moduleOf(spec);
  return (m?.code.name && m.code.name(spec)) || m?.manifest.names?.[spec?.type] || 'Prefab';
}
// The text a module gives AI tools about its spec (ai.md), shipped modules' in order.
export const aiNotes = () => modules.map((m) => m.code.ai || '').filter(Boolean);
