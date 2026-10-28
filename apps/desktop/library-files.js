// Main-process side of the reader's downloads folder and Recent list.
// The renderer may only read/write plain file names inside the chosen folder,
// and reopen paths the user picked through the main-process open dialog.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const NOTE = /\.(noteful|nfedit|notepart|notecomp|notecomplete|html?|pdf|png|jpe?g|webp)$/i;
const RECENT = 50;

export function plainName(name) {
  if (typeof name !== 'string' || !name || name.length > 200 || name !== path.basename(name) || name.startsWith('.') || /[\\/\x00-\x1f]/.test(name) || !NOTE.test(name))
    throw Error('Invalid file name.');
  return name;
}

export function libraryFiles({ settingsFile, defaultFolder }) {
  let settings;
  const load = async () => {
    if (settings) return settings;
    try { settings = JSON.parse(await readFile(settingsFile, 'utf8')); } catch { settings = {}; }
    if (typeof settings.folder !== 'string' || !path.isAbsolute(settings.folder)) settings.folder = defaultFolder;
    if (!Array.isArray(settings.recent)) settings.recent = [];
    settings.recent = settings.recent.filter(p => typeof p === 'string' && path.isAbsolute(p));
    return settings;
  };
  const save = async () => {
    await mkdir(path.dirname(settingsFile), { recursive: true });
    await writeFile(settingsFile, JSON.stringify(settings), { mode: 0o600 });
  };
  return {
    async folder() { return (await load()).folder; },
    async setFolder(folder) {
      if (!path.isAbsolute(folder)) throw Error('Choose an absolute folder.');
      (await load()).folder = folder;
      await save();
      return folder;
    },
    async read(name) {
      const file = path.join((await load()).folder, plainName(name));
      try { return new Uint8Array(await readFile(file)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async write(name, bytes) {
      if (!(bytes instanceof Uint8Array)) throw Error('Expected file bytes.');
      const folder = (await load()).folder, file = path.join(folder, plainName(name));
      await mkdir(folder, { recursive: true });
      // Write beside the target, then rename, so an interrupted copy never replaces a good one.
      const partial = path.join(folder, `.${path.basename(file)}.${process.pid}.partial`);
      await writeFile(partial, bytes);
      await rename(partial, file);
    },
    async remove(name) {
      await rm(path.join((await load()).folder, plainName(name)), { force: true });
    },
    // Paths chosen in the open dialog become reopenable from Recent.
    async remember(file) {
      const s = await load();
      s.recent = [file, ...s.recent.filter(p => p !== file)].slice(0, RECENT);
      await save();
    },
    async readRecent(file) {
      const s = await load();
      if (typeof file !== 'string' || !s.recent.includes(file)) throw Error('That file was not opened from this device.');
      try { return new Uint8Array(await readFile(file)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
  };
}
