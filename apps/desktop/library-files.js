// Main-process side of the reader's downloads folder and Recent list.
// The renderer may only read/write plain file names inside the chosen folder,
// and reopen paths the user picked through the main-process open dialog.
import { chmod, mkdir, open as openFile, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Notes, PDFs, HTML, images, Word/OpenDocument/Excel files, text formats (as in the
// reader's text-types.js), and names without an extension, which open as text when their content is.
const TEXT = 'txt|md|markdown|csv|tsv|log|json|ya?ml|toml|xml|ini|conf|cfg|env|sh|bash|zsh|fish|py|c|h|cc|cpp|hpp|java|m?js|ts|rs|go|rb|php|sql|tex|bib|r|m|asm|s|lua|vhdl?|v|sv|mk|awk|sed|diff|patch';
const NOTE = new RegExp(`(\\.(noteful|nfedit|notepart|notecomp|notecomplete|html?|pdf|png|jpe?g|webp|docx|odt|xlsx|ods|${TEXT})$)|^[^.]+$`, 'i');
// A file without an extension is listed only when its start has no NUL bytes (text).
async function textStart(file) {
  const handle = await openFile(file, 'r');
  try { const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0); return !buffer.subarray(0, bytesRead).includes(0); }
  finally { await handle.close(); }
}
const RECENT = 50, FOLDERS = 50;
// Pictures a document may show from beside it, and what a saved copy may hold.
const PICTURE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const MAX_PICTURE = 25 * 1048576, MAX_PICTURES = 300;
const inside = (dir, file) => file === dir || file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
// A link path as the converter writes it, to follow a pictures folder that had to be renamed.
const linkPart = (name) => encodeURIComponent(name).replace(/[()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const exists = async (file) => { try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function writeAtomic(file, bytes) {
  const partial = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.partial`);
  await writeFile(partial, bytes);
  await rename(partial, file);
}

export function plainName(name) {
  if (typeof name !== 'string' || !name || name.length > 200 || name !== path.basename(name) || name.startsWith('.') || /[\\/\x00-\x1f]/.test(name) || !NOTE.test(name))
    throw Error('Invalid file name.');
  return name;
}

// trash(path): moves a file to the system trash (Electron's shell.trashItem).
export function libraryFiles({ settingsFile, defaultFolder, trash = async () => { throw Error('The trash is not available here.'); } }) {
  let settings;
  const load = async () => {
    if (settings) return settings;
    try { settings = JSON.parse(await readFile(settingsFile, 'utf8')); } catch { settings = {}; }
    if (typeof settings.folder !== 'string' || !path.isAbsolute(settings.folder)) settings.folder = defaultFolder;
    if (!Array.isArray(settings.recent)) settings.recent = [];
    settings.recent = settings.recent.filter(p => typeof p === 'string' && path.isAbsolute(p));
    if (!Array.isArray(settings.folders)) settings.folders = [];
    settings.folders = settings.folders.filter(p => typeof p === 'string' && path.isAbsolute(p));
    return settings;
  };
  const save = async () => {
    await mkdir(path.dirname(settingsFile), { recursive: true });
    await writeFile(settingsFile, JSON.stringify(settings), { mode: 0o600 });
  };
  // A file the user chose in the open dialog, or one directly in a chosen folder.
  const opened = async (file) => {
    const s = await load();
    const inFolder = typeof file === 'string' && path.resolve(file) === file && NOTE.test(path.basename(file)) && s.folders.includes(path.dirname(file));
    if (typeof file !== 'string' || !(s.recent.includes(file) || inFolder)) throw Error('That file was not opened from this device.');
  };
  return {
    // Saves an edited text document over its file: written beside it, then renamed, keeping its mode.
    async writeOpened(file, bytes) {
      await opened(file);
      if (!(bytes instanceof Uint8Array)) throw Error('Expected file bytes.');
      const mode = (await stat(file)).mode & 0o7777;
      const partial = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.partial`);
      await writeFile(partial, bytes, { mode });
      await chmod(partial, mode);
      await rename(partial, file);
    },
    // Renames an opened document in its own folder (Rename… in the documents list), never
    // over another file; Recent follows it. Returns the new path.
    async renameOpened(file, name) {
      await opened(file);
      const next = path.join(path.dirname(file), plainName(name));
      if (next === file) return file;
      try { await stat(next); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await rename(file, next);
        const s = await load();
        s.recent = s.recent.map(p => (p === file ? next : p));
        await save();
        return next;
      }
      throw Error(`${name} already exists in that folder.`);
    },
    // Deletes an opened document (× in the documents list): to the trash, so it can be restored.
    async trashOpened(file) {
      await opened(file);
      await trash(file);
      const s = await load();
      s.recent = s.recent.filter(p => p !== file);
      await save();
    },
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
    // Folders chosen in the open-folder dialog: their notes can be listed and opened (groups).
    async rememberFolder(folder) {
      if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw Error('Choose an absolute folder.');
      const s = await load();
      s.folders = [folder, ...s.folders.filter(p => p !== folder)].slice(0, FOLDERS);
      await save();
    },
    async listFolder(folder) {
      const s = await load();
      if (typeof folder !== 'string' || !s.folders.includes(folder)) throw Error('That folder was not opened from this device.');
      const names = (await readdir(folder, { withFileTypes: true })).filter(d => d.isFile() && !d.name.startsWith('.') && NOTE.test(d.name)).map(d => d.name);
      const files = [];
      for (const name of names) {
        try {
          if (!name.includes('.') && !await textStart(path.join(folder, name))) continue;
          const info = await stat(path.join(folder, name)); files.push({ path: path.join(folder, name), name, size: info.size, modified: info.mtimeMs });
        } catch { /* Gone meanwhile. */ }
      }
      return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    },
    // A picture a document shows from beside it ("Tema_files/image1.png"): inside the document's
    // folder (or the opened folder holding it), never through a link that leads elsewhere.
    async readSibling(file, relative) {
      await opened(file);
      if (typeof relative !== 'string' || !relative || relative.length > 500 || relative.includes('\0') || path.isAbsolute(relative) || !PICTURE.test(relative)) throw Error('Invalid picture path.');
      const s = await load();
      const root = s.folders.filter(f => inside(f, file)).sort((a, b) => b.length - a.length)[0] || path.dirname(file);
      const target = path.resolve(path.dirname(file), relative);
      if (!inside(root, target)) throw Error('That picture is outside the document\'s folder.');
      let real;
      try { real = await realpath(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (!inside(await realpath(root), real)) throw Error('That picture is outside the document\'s folder.');
      const info = await stat(real);
      if (!info.isFile() || info.size > MAX_PICTURE) return null;
      return new Uint8Array(await readFile(real));
    },
    // Saves a converted document (Word, OpenDocument, Excel, CSV) as a Markdown copy beside the
    // original (or in the downloads folder), never over any file: a taken name gets " (2)". Its
    // pictures go in a folder of their own, also never over different files. `replace` is the
    // copy made earlier from this session, which a later save updates. Returns where it went.
    async saveCopy(file, { name, text, images = [], folder = '', replace = null } = {}) {
      const dir = file ? (await opened(file), path.dirname(file)) : (await load()).folder;
      if (!/\.md$/i.test(plainName(name)) || typeof text !== 'string') throw Error('Expected a Markdown name and text.');
      if (!Array.isArray(images) || images.length > MAX_PICTURES) throw Error('Too many pictures.');
      if (images.length && !(typeof folder === 'string' && /^[^\\/\0.][^\\/\0]{0,200}_files$/.test(folder))) throw Error('Invalid pictures folder.');
      for (const image of images) {
        if (typeof image?.name !== 'string' || image.name !== path.basename(image.name) || image.name.startsWith('.') || !PICTURE.test(image.name) || !(image.bytes instanceof Uint8Array)) throw Error('Invalid picture.');
      }
      await mkdir(dir, { recursive: true });
      const s = await load();
      const again = replace && typeof replace.path === 'string' && s.recent.includes(replace.path) && path.dirname(replace.path) === dir && /\.md$/i.test(replace.path);
      let target = again ? replace.path : path.join(dir, name);
      if (!again) for (let n = 2; await exists(target); n++) target = path.join(dir, name.replace(/(\.md)$/i, ` (${n})$1`));
      let used = folder;
      if (images.length) {
        if (again && typeof replace.folder === 'string' && replace.folder.endsWith('_files') && replace.folder === path.basename(replace.folder)) used = replace.folder;
        else {
          // The first folder that is new, or holds only these same pictures.
          for (let n = 2; ; n++) {
            const taken = path.join(dir, used);
            if (!await exists(taken)) break;
            let same = true;
            for (const image of images) {
              try { same &&= Buffer.from(image.bytes).equals(await readFile(path.join(taken, image.name))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            }
            if (same) break;
            used = `${folder.replace(/_files$/, '')} (${n})_files`;
          }
        }
        await mkdir(path.join(dir, used), { recursive: true });
        for (const image of images) await writeAtomic(path.join(dir, used, image.name), image.bytes);
      }
      // Links follow the folder when it had to be renamed.
      const body = images.length && used !== folder ? text.replaceAll(`${linkPart(folder)}/`, `${linkPart(used)}/`) : text;
      await writeAtomic(target, new TextEncoder().encode(body));
      s.recent = [target, ...s.recent.filter(p => p !== target)].slice(0, RECENT);
      await save();
      return { path: target, name: path.basename(target), folder: images.length ? used : '', size: Buffer.byteLength(body) };
    },
    async readRecent(file) {
      await opened(file);
      try { return new Uint8Array(await readFile(file)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
  };
}
