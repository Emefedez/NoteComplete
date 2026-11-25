// The prefab packs' files, for precache.json (tools/build_web.py; docs/TABLES-AND-OFFICE.md,
// phase 7): every file of each pack's module folders (not their tests) with its size, and
// which of them the service worker caches at install anyway. The core pack's files are always
// cached; another pack's are cached when the pack is installed on the device
// (prefab-packs.js), except the files the app itself imports from outside the prefab folders
// (exams draw with prefabs/charts/render.js), which load at start whatever is installed.
//   node tools/prefab_packs.mjs [reader dir]   → JSON { packs, shell }
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { shippedModules, readPacks, packIdOf } from './prefab_index.mjs';

const READER = fileURLToPath(new URL('../apps/reader/', import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const shipped = (name) => !name.includes('/test/') && !name.endsWith('.test.mjs');
const posix = (p) => p.split(path.sep).join('/');
// Static imports and re-exports of a module (not import(): those load when used).
const IMPORTS = /(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]/gm;
export function staticImports(text) {
  const out = [];
  for (const m of text.matchAll(IMPORTS)) out.push(m[1] || m[2]);
  return out;
}

export function prefabPacks(reader = READER) {
  const root = path.join(reader, 'prefabs');
  const info = readPacks(root);
  const packs = {};
  const owner = new Map();
  for (const m of shippedModules(root)) {
    const id = packIdOf(m.manifest);
    const pack = (packs[id] ||= { core: !!info[id]?.core, files: {}, bytes: 0 });
    for (const file of walk(path.join(root, m.folder)).map((f) => posix(path.relative(reader, f))).filter(shipped).sort()) {
      const size = statSync(path.join(reader, file)).size;
      pack.files[file] = size;
      pack.bytes += size;
      owner.set(file, id);
    }
  }
  // What the app imports from a pack outside the prefab folders, and what that imports.
  const outside = readdirSync(reader, { withFileTypes: true })
    .flatMap((d) => (d.isFile() && /\.(m?js)$/.test(d.name) ? [d.name] : d.isDirectory() && ['chinese', 'math'].includes(d.name) ? walk(path.join(reader, d.name)).map((f) => posix(path.relative(reader, f))).filter((f) => /\.m?js$/.test(f)) : []))
    .filter((f) => !f.endsWith('.test.mjs'));
  const keep = new Set();
  const todo = [];
  const follow = (from, spec) => {
    if (!spec.startsWith('.')) return;
    const target = posix(path.normalize(path.join(path.dirname(from), spec)));
    if (owner.has(target) && !keep.has(target)) { keep.add(target); todo.push(target); }
  };
  for (const file of outside) for (const spec of staticImports(readFileSync(path.join(reader, file), 'utf8'))) follow(file, spec);
  while (todo.length) {
    const file = todo.pop();
    if (existsSync(path.join(reader, file))) for (const spec of staticImports(readFileSync(path.join(reader, file), 'utf8'))) follow(file, spec);
  }
  // The pack files the service worker leaves out of its install.
  const lazy = [...owner.keys()].filter((f) => !packs[owner.get(f)].core && !keep.has(f)).sort();
  return { packs, lazy };
}
// The shell (the files the service worker caches at install) without the lazy pack files.
export const shellWithoutPacks = (shell, lazy) => { const out = new Set(lazy); return shell.filter((name) => !out.has(name)); };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(prefabPacks(process.argv[2] ? path.resolve(process.argv[2]) : READER)) + '\n');
}
