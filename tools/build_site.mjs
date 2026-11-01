// The website (GitHub Pages): the web app with tabs, opening a welcome notebook written in
// handwriting from docs/site/welcome.md by the app's own engine, its Markdown notes from
// docs/site/welcome-notes.md, and Home beside it. Run after `python tools/build_web.py`
// and `node apps/desktop/stage.mjs`:
//   node tools/build_site.mjs [folder]   (default apps/desktop/reader)
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import init, { EditorSession } from '../apps/reader/pkg/noteful_wasm.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.resolve(process.argv[2] || path.join(root, 'apps/desktop/reader'));
await init({ module_or_path: await readFile(path.join(root, 'apps/reader/pkg/noteful_wasm_bg.wasm')) });
const markdown = await readFile(path.join(root, 'docs/site/welcome.md'), 'utf8');
const notes = await readFile(path.join(root, 'docs/site/welcome-notes.md'), 'utf8');
const note = EditorSession.create_handwritten('Welcome to NoteComplete', markdown, JSON.stringify({ paper: 'dot', theme: 'light' }));
note.set_markdown(notes);
const pages = JSON.parse(note.view(0)).pages;
await writeFile(path.join(out, 'welcome.notecomp'), note.export_notecomplete(new Uint8Array(), ''));
await writeFile(path.join(out, 'site.json'), JSON.stringify({ title: 'Welcome', welcome: './welcome.notecomp', notes: true }) + '\n');
// The site's address opens the tabs; the reader each tab loads is app.html.
// (Once: run again on a built site, index.html is already the tabs page.)
const built = await readFile(path.join(out, 'app.html')).then(() => true, () => false);
if (!built) await rename(path.join(out, 'index.html'), path.join(out, 'app.html'));
const tabs = (await readFile(path.join(root, 'apps/reader/tabs.html'), 'utf8')).replace('content="./index.html"', 'content="./app.html"');
await writeFile(path.join(out, 'index.html'), tabs);
// Offline: the service worker caches these too.
const precache = JSON.parse(await readFile(path.join(out, 'precache.json'), 'utf8'));
for (const name of ['app.html', 'welcome.notecomp', 'site.json']) if (!precache.includes(name)) precache.push(name);
await writeFile(path.join(out, 'precache.json'), JSON.stringify(precache) + '\n');
console.log(`Website built in ${path.relative(root, out) || '.'}: welcome notebook of ${pages} pages, tabs at index.html.`);
