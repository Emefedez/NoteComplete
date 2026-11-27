// The website (GitHub Pages): the web app with tabs opening directly on Home.
// Run after `python tools/build_web.py` and `node apps/desktop/stage.mjs`:
//   node tools/build_site.mjs [folder]   (default apps/desktop/reader)
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.resolve(process.argv[2] || path.join(root, 'apps/desktop/reader'));
// The site's address opens the tabs; the reader each tab loads is app.html.
// (Once: run again on a built site, index.html is already the tabs page.)
const built = await readFile(path.join(out, 'app.html')).then(() => true, () => false);
if (!built) await rename(path.join(out, 'index.html'), path.join(out, 'app.html'));
const tabs = (await readFile(path.join(root, 'apps/reader/tabs.html'), 'utf8')).replace('content="./index.html"', 'content="./app.html"');
await writeFile(path.join(out, 'index.html'), tabs);
// The service worker keys each file by its hash (tools/build_web.py); index.html changed.
const precache = JSON.parse(await readFile(path.join(out, 'precache.json'), 'utf8'));
for (const name of ['index.html', 'app.html']) {
  precache.files[name] = createHash('sha256').update(await readFile(path.join(out, name))).digest('hex').slice(0, 16);
  if (!precache.shell.includes(name)) precache.shell.push(name);
}
await writeFile(path.join(out, 'precache.json'), JSON.stringify(precache) + '\n');
console.log(`Website built in ${path.relative(root, out) || '.'}: tabs at index.html.`);
