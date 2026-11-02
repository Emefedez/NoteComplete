// Package the same audited asset list used by the reader's offline cache.
import { readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../reader/', import.meta.url));
const destination = fileURLToPath(new URL('./reader/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(source, 'precache.json'), 'utf8'));
await rm(destination, { recursive: true, force: true });
for (const relative of [...Object.keys(manifest.files), 'precache.json']) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..')) throw Error('Invalid asset path');
  const output = path.join(destination, relative);
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(path.join(source, relative), output);
}
// The version on Home: the app's own (package.json), not the one written into index.html by
// hand, which only the desktop app corrected at runtime (the website kept showing it).
const { version } = JSON.parse(await readFile(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'));
const page = path.join(destination, 'index.html');
const html = await readFile(page, 'utf8');
const stamped = html.replace(/(id="homeVersion"[^>]*>)v[^<]*</, `$1v${version}<`);
if (stamped === html && !html.includes(`>v${version}<`)) throw Error('Home version badge not found in index.html');
await writeFile(page, stamped);
// The service worker keys its copy of each file by hash (tools/build_web.py): the stamped page's.
manifest.files['index.html'] = createHash('sha256').update(stamped).digest('hex').slice(0, 16);
await writeFile(path.join(destination, 'precache.json'), JSON.stringify(manifest) + '\n');
console.log('Staged reader assets; original notes and development dependencies excluded.');
