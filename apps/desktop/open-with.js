// Files the operating system hands over ("Open with…", double-click, dock drop): which
// ones NoteComplete accepts, and how to find them in a launch's arguments.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// NoteComplete's own formats: the app is their owner and default handler.
export const OWN_TYPES = [
  { ext: ['noteful'], name: 'Noteful note', mimeType: 'application/x-noteful', uti: 'com.notecomplete.noteful' },
  { ext: ['nfedit'], name: 'NoteComplete project', mimeType: 'application/x-nfedit', uti: 'com.notecomplete.nfedit' },
  { ext: ['notecomp', 'notecomplete'], name: 'NoteComplete package', mimeType: 'application/x-notecomp', uti: 'com.notecomplete.notecomp' },
  { ext: ['notepart'], name: 'NoteComplete part', mimeType: 'application/x-notepart', uti: 'com.notecomplete.notepart' },
];
// Common files it can show: offered in "Open with", never made the default.
export const OTHER_TYPES = [
  { ext: ['pdf'], name: 'PDF document', mimeType: 'application/pdf' },
  { ext: ['png'], name: 'PNG image', mimeType: 'image/png' },
  { ext: ['jpg', 'jpeg'], name: 'JPEG image', mimeType: 'image/jpeg' },
  { ext: ['webp'], name: 'WebP image', mimeType: 'image/webp' },
  { ext: ['tar'], name: 'Tar archive (NoteComplete package)', mimeType: 'application/x-tar' },
  { ext: ['md', 'markdown'], name: 'Markdown document', mimeType: 'text/markdown' },
  { ext: ['txt'], name: 'Plain text', mimeType: 'text/plain' },
  { ext: ['html', 'htm'], name: 'HTML page', mimeType: 'text/html' },
  { ext: ['docx'], name: 'Word document', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { ext: ['odt'], name: 'OpenDocument text', mimeType: 'application/vnd.oasis.opendocument.text' },
  { ext: ['xlsx'], name: 'Excel workbook', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { ext: ['ods'], name: 'OpenDocument spreadsheet', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' },
  { ext: ['csv'], name: 'CSV table', mimeType: 'text/csv' },
  { ext: ['tsv'], name: 'TSV table', mimeType: 'text/tab-separated-values' },
];
export const SYSTEM_EXTENSIONS = [...OWN_TYPES, ...OTHER_TYPES].flatMap(t => t.ext);
const SYSTEM_NAME = new RegExp(`\\.(${SYSTEM_EXTENSIONS.join('|')})$`, 'i');

// Only names with a supported extension: the OS may pass anything (a folder, a stray flag).
export const openablePath = (file) => typeof file === 'string' && path.isAbsolute(file) && SYSTEM_NAME.test(file);

// The files in a launch's arguments. argv[0] is the executable; an unpackaged run (electron .)
// also has the app folder. Flags are skipped: Chromium adds its own to a second instance's
// argv. Linux desktop entries pass file:// URLs (%U), relative paths come from a terminal.
export function launchFiles(argv, { cwd = process.cwd(), packaged = true } = {}) {
  if (!Array.isArray(argv)) return [];
  const found = [];
  for (const arg of argv.slice(packaged ? 1 : 2)) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    let file = arg;
    if (/^file:\/\//i.test(arg)) { try { file = fileURLToPath(arg); } catch { continue; } }
    else if (/^[a-z][\w+.-]*:\/\//i.test(arg)) continue;
    file = path.resolve(cwd, file);
    if (openablePath(file) && !found.includes(file)) found.push(file);
  }
  return found;
}
