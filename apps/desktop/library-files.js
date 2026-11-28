// Main-process side of the reader's downloads folder and Recent list.
// The renderer may only read/write plain file names inside the chosen folder,
// and reopen paths the user picked through the main-process open dialog.
import { chmod, mkdir, open as openFile, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Notes, PDFs, HTML, images, media, Office/e-book/notebook files, text formats (as in the
// reader's text-types.js), and names without an extension, which open as text when their content is.
const TEXT = 'txt|md|markdown|rst|adoc|asciidoc|org|rmd|qmd|csv|tsv|log|json|ya?ml|toml|xml|ini|conf|cfg|env|properties|sh|bash|zsh|fish|ps1|bat|py|c|h|cc|cpp|hpp|cs|java|kt|swift|dart|m?js|cjs|jsx|ts|tsx|css|scss|rs|go|rb|php|sql|tex|bib|r|m|jl|hs|asm|s|lua|vhdl?|v|sv|mk|cmake|nix|proto|awk|sed|diff|patch|puml|plantuml|pu|iuml|wsd';
const NOTE = new RegExp(`(\\.(noteful|nfedit|notepart|notecomp|notecomplete|goodnotes|ntb|rnote|html?|pdf|png|jpe?g|webp|gif|bmp|avif|heic|heif|jfif|apng|ico|mp3|m4a|wav|ogg|oga|opus|flac|aac|weba|mp4|m4v|webm|mkv|mov|avi|ogv|docx|docm|dotx|doc|rtf|odt|fodt|xlsx|xlsm|xlsb|xls|ods|fods|pptx|pptm|ppt|odp|epub|ipynb|rdata|rda|rds|${TEXT})$)|^[^.]+$`, 'i');
// A file without an extension is listed only when its start has no NUL bytes (text).
async function textStart(file) {
  const handle = await openFile(file, 'r');
  try { const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0); return !buffer.subarray(0, bytesRead).includes(0); }
  finally { await handle.close(); }
}
// Recent paths stay reopenable and writable; the reader lists far fewer, so this is generous.
const RECENT = 500, FOLDERS = 50;
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

// A Goodnotes notebook kept unzipped (a folder holding index.notes.pb, schema.pb, notes/…, as
// an unpacked .goodnotes or a synced package): listed and opened as one notebook, zipped
// again here (stored, nothing compressed) since the reader reads .goodnotes files as zips.
export async function isGoodnotesFolder(dir) {
  try {
    const names = new Set(await readdir(dir));
    return names.has('index.notes.pb') && (names.has('schema.pb') || names.has('notes'));
  } catch { return false; }
}
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export async function zipFolder(dir, { max = 2048 * 1048576 } = {}) {
  const files = [];
  let total = 0;
  const walk = async (at, rel) => {
    for (const d of (await readdir(at, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(at, d.name), name = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(full, name);
      else if (d.isFile()) {
        const bytes = await readFile(full);
        if ((total += bytes.length) > max) throw Error('That notebook folder is too large to open.');
        files.push({ name: Buffer.from(name), bytes });
      }
    }
  };
  await walk(dir, '');
  const parts = [], central = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const crc = crc32(bytes), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, name, bytes); central.push(entry, name);
    offset += 30 + name.length + bytes.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}
const notebookName = (dir) => (/\.goodnotes$/i.test(path.basename(dir)) ? path.basename(dir) : `${path.basename(dir)}.goodnotes`);

// The Save dialog's file name with the chosen type's extension: GTK and some Windows
// dialogs return the name as typed, and a note saved without one would ask again next time.
export function withExtension(file, filters) {
  const ext = Array.isArray(filters) ? filters[0]?.extensions?.[0] : '';
  if (typeof file !== 'string' || typeof ext !== 'string' || !/^\w+$/.test(ext)) return file;
  return file.toLowerCase().endsWith('.' + ext.toLowerCase()) ? file : `${file}.${ext}`;
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
  // A file the user chose in the open dialog, or one inside an opened folder (including subfolders).
  // `any`: any file type inside an opened folder (handed to the system's app, never read here).
  const opened = async (file, { any = false } = {}) => {
    const s = await load();
    if (typeof file === 'string' && s.recent.includes(file)) return;
    let inFolder = false;
    const base = typeof file === 'string' ? path.basename(file) : '';
    if (typeof file === 'string' && path.resolve(file) === file && base && !base.startsWith('.') && (any || NOTE.test(base) || await isGoodnotesFolder(file))) {
      const parent = s.folders.find(f => inside(f, file));
      if (parent) {
        try {
          const [realRoot, realFile] = await Promise.all([realpath(parent), realpath(file)]);
          inFolder = inside(realRoot, realFile);
        } catch { inFolder = false; }
      }
    }
    if (!inFolder) throw Error('That file was not opened from this device.');
  };
  return {
    async assertOpened(file, options) { await opened(file, { any: options?.any === true }); },
    // A file that may be revealed in the system file manager: either opened from disk/a folder,
    // or a downloaded/imported copy stored inside NoteComplete's own downloads folder.
    async assertRevealable(file) {
      if (typeof file !== 'string' || !file || file.includes('\0') || !path.isAbsolute(file))
        throw Error('That file was not opened from this device.');
      const normalized = path.resolve(file);
      let allowed = false;
      try {
        await opened(normalized);
        allowed = true;
      } catch {
        const s = await load();
        const base = path.basename(normalized);
        if (base && !base.startsWith('.') && inside(s.folder, normalized)) {
          try {
            const [realRoot, realFile] = await Promise.all([realpath(s.folder), realpath(normalized)]);
            allowed = inside(realRoot, realFile);
          } catch (error) {
            if (error.code === 'ENOENT') throw Error('That file is no longer in its folder.');
            allowed = false;
          }
        }
      }
      if (!allowed) throw Error('That file was not opened from this device.');
      try { await stat(normalized); } catch (error) {
        if (error.code === 'ENOENT') throw Error('That file is no longer in its folder.');
        throw error;
      }
      return normalized;
    },
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
    // Saves a user-chosen file from the native Save dialog and remembers it in Recent so later
    // saves can update it in place with writeOpened.
    async saveChosen(file, bytes) {
      if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('Choose an absolute path.');
      const base = path.basename(file);
      if (!base || base.startsWith('.') || /[\\/\x00-\x1f]/.test(base) || !NOTE.test(base)) throw Error('Invalid file name.');
      if (!(bytes instanceof Uint8Array)) throw Error('Expected file bytes.');
      await mkdir(path.dirname(file), { recursive: true });
      await writeAtomic(file, bytes);
      const s = await load();
      s.recent = [file, ...s.recent.filter(p => p !== file)].slice(0, RECENT);
      await save();
      return { path: file, name: base, size: bytes.byteLength };
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
    // `all`: every file, not only the formats NoteComplete opens; those others come back with
    // `other: true` (Home lists them and hands them to the system's app).
    async listFolder(folder, { all = false } = {}) {
      const s = await load();
      if (typeof folder !== 'string' || !s.folders.includes(folder)) throw Error('That folder was not opened from this device.');
      const realRoot = await realpath(folder).catch(() => folder);
      const files = [];
      const notebook = async (full) => {
        const info = await stat(full);
        files.push({ path: full, name: path.relative(folder, full).split(path.sep).join('/').replace(/[^/]*$/, () => notebookName(full)), size: info.size, modified: info.mtimeMs, notebook: true });
      };
      if (await isGoodnotesFolder(folder)) { await notebook(folder); return files; }
      const cap = all ? 3000 : 500;
      const walk = async (dir, depth) => {
        if (depth > 8 || files.length >= cap) return;
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const d of entries) {
          if (files.length >= cap || d.name.startsWith('.')) continue;
          const full = path.join(dir, d.name);
          if (d.isDirectory()) {
            if (d.name.endsWith('_files')) continue;
            if (await isGoodnotesFolder(full)) { if (inside(realRoot, await realpath(full).catch(() => ''))) await notebook(full); continue; }
            await walk(full, depth + 1);
            continue;
          }
          if (!d.isFile()) continue;
          const note = NOTE.test(d.name);
          // Editor backups and lock files are not documents.
          if (!note && (!all || /~$|\.(lck|lock|swp|tmp|part|crdownload)$|\.bak(_\w+)?$/i.test(d.name))) continue;
          try {
            const realFile = await realpath(full);
            if (!inside(realRoot, realFile)) continue;
            const text = !note || d.name.includes('.') || await textStart(full);
            if (!text && !all) continue;
            const info = await stat(full);
            const rel = path.relative(folder, full).split(path.sep).join('/');
            files.push({ path: full, name: rel, size: info.size, modified: info.mtimeMs, ...(note && text ? {} : { other: true }) });
          } catch { /* Gone meanwhile. */ }
        }
      };
      await walk(folder, 0);
      return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    },
    // The folder a document's diagram may include files from: the opened folder holding it,
    // or its own folder (diagrams.js).
    async documentFolder(file) {
      await opened(file);
      const s = await load();
      return s.folders.filter(f => inside(f, file)).sort((a, b) => b.length - a.length)[0] || path.dirname(file);
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
      if (await isGoodnotesFolder(file)) return zipFolder(file);
      try { return new Uint8Array(await readFile(file)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async statLocalNote(file) {
      if (typeof file !== 'string' || !file || file.includes('\0') || !path.isAbsolute(file)) return null;
      if (!NOTE.test(path.basename(file))) return null;
      try {
        const info = await stat(await realpath(file));
        return info.isFile() ? { mtimeMs: info.mtimeMs, size: info.size } : null;
      } catch {
        return null;
      }
    },
    // Opens a local note/document linked from AI chat (e.g. a generated prefab .noteful file).
    async readLocalNote(file) {
      if (typeof file !== 'string' || !file || file.includes('\0') || !path.isAbsolute(file)) throw Error('Invalid note path.');
      if (!NOTE.test(path.basename(file))) throw Error('Unsupported note file type.');
      let real;
      try { real = await realpath(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      const info = await stat(real);
      if (!info.isFile() || info.size > 256 * 1048576) return null;
      const s = await load();
      s.recent = [real, ...s.recent.filter(p => p !== real)].slice(0, RECENT);
      await save(s);
      return { path: real, name: path.basename(real), bytes: new Uint8Array(await readFile(real)) };
    },
  };
}
