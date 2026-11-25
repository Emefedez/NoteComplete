// Installing and removing prefab packs on this device (docs/TABLES-AND-OFFICE.md, phase 7).
// "Installed" means the pack is enabled and its files are here:
// - desktop and Android apps: the files ship inside the app, so installing only enables it
//   (instant) and removing only hides it;
// - web reader: installing fetches the pack's files through the service worker, which keeps
//   them in its cache (sw.js, under the hashes of precache.json), so they work offline;
//   removing deletes them from that cache. The service worker's install leaves out the
//   packs that are not core (tools/build_web.py), and topUp() keeps the installed ones cached
//   after an update.
// The file lists and sizes come from precache.json's `packs` (tools/prefab_packs.mjs); where
// there is none (a development server), a pack's files are its modules' render.js and
// editor.js, fetched as they are imported.
import { packs, packById, packOf, loadModule, packsChanged, cards, moduleOf } from './prefab-registry.js';
import { readPackState, writePackState, withPack, withCard, packOn } from './prefab-pack-state.js';

const base = new URL('./', import.meta.url);
// The app's files are on this device (desktop app, Android app, a file): nothing to download.
const local = () => typeof location === 'undefined' || !/^https?:$/.test(location.protocol);
let manifest = null;
// precache.json, once per session (null when there is none or it cannot be read).
async function precache() {
  if (manifest) return manifest;
  try {
    const r = await fetch(new URL('precache.json', base), { cache: 'no-cache' });
    manifest = r.ok ? await r.json() : {};
  } catch { manifest = {}; }
  return manifest;
}
// A pack's files: { name: bytes }, from precache.json or, without one, from its modules.
export async function packFiles(id) {
  const m = await precache();
  if (m.packs?.[id]?.files) return m.packs[id].files;
  const out = {};
  for (const mod of packById(id)?.modules || []) {
    if (mod.load) out[`prefabs/${mod.folder}/render.js`] = 0;
    if (/\.js$/.test(mod.manifest.editor || '')) out[`prefabs/${mod.folder}/${mod.manifest.editor}`] = 0;
  }
  return out;
}
// Each pack's download size in bytes (0 when not known), for the wizard and the picker.
export async function packSizes() {
  const m = await precache();
  return Object.fromEntries(packs().map((p) => [p.id, m.packs?.[p.id]?.bytes || 0]));
}
export const formatSize = (bytes) => (!bytes ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// The pack's state now: [{ ...pack, installed, needs (installed packs that need it) }].
export function packList(state = readPackState()) {
  const all = packs();
  return all.map((p) => ({ ...p, installed: packOn(state, p), neededBy: all.filter((q) => q.requires.includes(p.id) && packOn(state, q)).map((q) => q.id) }));
}
export const isInstalled = (id) => packOn(readPackState(), packById(id));
// The pack a spec's figure needs, when it is not installed (null when it is, or has none).
export function missingPackFor(spec) {
  const p = packOf(moduleOf(spec));
  return p && !packOn(readPackState(), p) ? packById(p.id) : null;
}
// Plain-English reason a spec cannot be drawn (missing pack or unknown module/type), or null
// when it is available. Used by prefabPng, placePrefab, AI features and MCP add_prefab.
export function missingPackMessage(spec) {
  const missing = missingPackFor(spec);
  if (missing) return `The "${missing.label}" prefab pack is not installed on this device. Install it from Insert prefab or Help ▸ Setup wizard ▸ Prefabs.`;
  const m = moduleOf(spec);
  if (m && !m.ready) {
    const p = packOf(m);
    return `The "${p?.label || m.manifest.label || m.manifest.id}" prefab pack is not installed or its files are missing.`;
  }
  if (!m && spec?.module) return `Prefab module "${spec.module}" is not installed.`;
  if (!m && spec?.type) return `No installed prefab pack provides "${spec.type}".`;
  return null;
}
const listeners = new Set();
// Called when packs are installed or removed, or prefabs turned on or off.
export const onPacks = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { packsChanged(); for (const fn of listeners) fn(); };

// Fetches files through the service worker (which keeps them), with progress by bytes.
async function download(files, onProgress, label) {
  const names = Object.keys(files);
  const total = names.reduce((n, f) => n + (files[f] || 0), 0);
  let done = 0, count = 0;
  const report = () => onProgress?.({ fraction: total ? done / total : count / Math.max(1, names.length), text: total ? `Downloading ${label}: ${formatSize(done) || '0 KB'} of ${formatSize(total)}` : `Downloading ${label}: ${count} of ${names.length} files` });
  report();
  const queue = [...names];
  const worker = async () => {
    for (let name; (name = queue.shift());) {
      const r = await fetch(new URL(name, base), { cache: 'no-cache' });
      if (!r.ok) throw Error(`${name} could not be downloaded (${r.status})`);
      await r.arrayBuffer();
      done += files[name] || 0; count++;
      report();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
// Installs a pack (and the packs it needs): downloads its files on the web, loads its code,
// and turns its prefabs on. `onProgress({ fraction, text })`.
export async function installPack(id, onProgress = () => {}) {
  const pack = packById(id);
  if (!pack) throw Error(`There is no prefab pack "${id}".`);
  for (const need of pack.requires) if (!isInstalled(need)) await installPack(need, onProgress);
  if (!local()) await download(await packFiles(id), onProgress, pack.label);
  onProgress({ fraction: 1, text: `Starting ${pack.label}…` });
  for (const m of pack.modules) if (!(await loadModule(m))) throw Error(`The ${pack.label} pack could not start (${m.manifest.id}).`);
  const ids = cards({ all: true }).filter((c) => c.pack === id).map((c) => c.id);
  writePackState(withPack(readPackState(), id, true, ids));
  changed();
  return pack;
}
// Removes a pack: its prefabs leave the picker, its files leave the offline cache. Figures
// already on pages stay (they are pictures); editing one asks to install it again. A pack
// that an installed pack needs is not removed.
export async function removePack(id) {
  const pack = packById(id);
  if (!pack) return;
  if (pack.core) throw Error(`${pack.label} is always installed.`);
  const needs = packList().find((p) => p.id === id)?.neededBy || [];
  if (needs.length) throw Error(`${pack.label} is needed by ${needs.map((n) => packById(n)?.label || n).join(', ')}: remove that first.`);
  writePackState(withPack(readPackState(), id, false));
  changed();
  if (!local()) await forget(Object.keys(await packFiles(id))).catch(() => {});
}
// Turns one prefab on or off (its pack stays installed).
export function setPrefabOn(cardId, on) {
  writePackState(withCard(readPackState(), cardId, on));
  changed();
}
// The picker's eye: hide what is not installed.
export const hideMissing = () => readPackState().hideMissing;
export function setHideMissing(on) { writePackState({ ...readPackState(), hideMissing: !!on }); }
// Applies the wizard's plan (prefab-pack-state.js planFrom): installs, then removes, then keeps
// its state (the prefabs turned off, `all`).
export async function applyPlan(plan, onProgress = () => {}) {
  const errors = [], packsNow = { ...plan.state.packs };
  for (const id of plan.install) { try { await installPack(id, onProgress); } catch (e) { errors.push(e.message); packsNow[id] = false; } }
  for (const id of plan.remove) { try { await removePack(id); } catch (e) { errors.push(e.message); packsNow[id] = true; } }
  writePackState({ ...plan.state, packs: packsNow, all: plan.state.all && !errors.length, hideMissing: readPackState().hideMissing });
  changed();
  return errors;
}

// The cache the service worker keeps app files in (sw.js: `${name}?v=${hash}` in the
// noteful-reader-* cache).
async function forget(names) {
  if (typeof caches === 'undefined') return;
  for (const key of await caches.keys()) {
    if (!key.startsWith('noteful-reader-')) continue;
    const cache = await caches.open(key);
    for (const request of await cache.keys()) {
      const name = decodeURIComponent(new URL(request.url).pathname.slice(base.pathname.length));
      if (names.includes(name)) await cache.delete(request);
    }
  }
}
// After an update the service worker drops a pack's old copies and caches only what is used:
// fetches the installed packs' files it does not have, so they still work offline.
export async function topUp() {
  if (local() || typeof caches === 'undefined' || !navigator.serviceWorker?.controller) return 0;
  const m = await precache();
  if (!m.packs || !m.files) return 0;
  const state = readPackState();
  let fetched = 0;
  for (const p of packs()) {
    if (p.core || !packOn(state, p) || !m.packs[p.id]) continue;
    for (const name of Object.keys(m.packs[p.id].files)) {
      if (await caches.match(new URL(`${name}?v=${m.files[name]}`, base).href)) continue;
      try { const r = await fetch(new URL(name, base), { cache: 'no-cache' }); if (r.ok) { await r.arrayBuffer(); fetched++; } } catch { return fetched; }
    }
  }
  return fetched;
}
