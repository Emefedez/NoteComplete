// The prefab modules folder (docs/PREFAB-MODULES.md, "The folder of modules"): the app's own
// modules are in its reader files (reader/prefabs); Settings → Prefab modules can copy them to a
// folder the user can write to, or point at one, which becomes the default. That folder is
// served to the reader at notecomplete://reader/prefabs-user/, a sibling of prefabs/, so a
// module's relative imports (../kit/…, ../../uml.js) resolve as for the app's own; its kit/ is
// always the app's. Modules there are trusted like the app (the owner's choice).
import path from 'node:path';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';

export const USER_PREFIX = 'prefabs-user/';

export function prefabFolder({ settingsFile, shipped }) {
  async function settings() {
    try { return JSON.parse(await readFile(settingsFile, 'utf8')); } catch { return {}; }
  }
  async function save(next) {
    await writeFile(settingsFile, JSON.stringify(next));
  }
  // The folder in use, or null for the app's own.
  async function folder() {
    const s = await settings();
    if (!s.folder) return null;
    try { if ((await stat(s.folder)).isDirectory()) return s.folder; } catch { /* Gone. */ }
    return null;
  }
  return {
    folder,
    async use(dir) { await save({ ...(await settings()), folder: dir ? path.resolve(dir) : null }); return folder(); },
    // The app's modules copied into `dir` (its own folder "prefabs" when `dir` is not empty),
    // never over files already there; that copy becomes the folder in use.
    async copyTo(dir) {
      let target = path.resolve(dir);
      if ((await readdir(target).catch(() => [])).length) target = path.join(target, 'prefabs');
      await copyTree(shipped, target, { skip: (rel) => rel.split(path.sep)[0] === 'kit' || rel === 'index.js' });
      await save({ ...(await settings()), folder: target });
      return target;
    },
    // What is in the folder in use: [{ folder, manifest }], and the app's own versions by id.
    async list() {
      const dir = await folder();
      return { folder: dir, shipped: await manifests(shipped), modules: dir ? await manifests(dir) : [] };
    },
  };
}

async function manifests(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.') || entry.name === 'kit') continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, entry.name, 'module.json'), 'utf8'));
      let render = false;
      try { render = (await stat(path.join(dir, entry.name, 'render.js'))).isFile(); } catch { /* None. */ }
      out.push({ folder: entry.name, manifest, render });
    } catch { /* Not a module. */ }
  }
  return out;
}

// Files only (readdir and readFile work inside Electron's app archive, where fs.cp does not);
// existing files are kept.
async function copyTree(from, to, { skip = () => false } = {}, rel = '') {
  await mkdir(path.join(to, rel), { recursive: true });
  for (const entry of await readdir(path.join(from, rel), { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (skip(child)) continue;
    if (entry.isDirectory()) await copyTree(from, to, { skip }, child);
    else {
      const target = path.join(to, child);
      try { await stat(target); continue; } catch { /* Not there yet. */ }
      await writeFile(target, await readFile(path.join(from, child)));
    }
  }
}

// The file for a reader address under prefabs-user/: the app's kit for kit/…, else the folder
// in use; null when there is no folder or the path leaves it.
export function userPrefabPath(relative, { folder, shipped }) {
  if (!relative.startsWith(USER_PREFIX)) return null;
  const rest = relative.slice(USER_PREFIX.length);
  if (rest.split(/[\\/]/).some((part) => part.startsWith('.') || part === '')) return null;
  const base = rest.split('/')[0] === 'kit' ? shipped : folder;
  if (!base) return null;
  const file = path.resolve(base, rest);
  return file.startsWith(path.resolve(base) + path.sep) ? file : null;
}
