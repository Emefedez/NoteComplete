// Linux desktop integration for the AppImage. An AppImage is just a file: nothing tells the
// system which formats it opens, so double-clicking a .noteful file did nothing and "Open
// with" never listed it. On each launch the app writes a menu entry (MimeType + %U so file
// URLs are passed) and the shared-mime definitions for its own formats, and makes itself
// the default for them. Own formats are claimed; common files (PDF, images…) are only offered.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OTHER_TYPES, OWN_TYPES } from './open-with.js';

const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function mimeXml() {
  const types = OWN_TYPES.map(t => `  <mime-type type="${t.mimeType}">
    <comment>${xml(t.name)}</comment>
${t.ext.map(e => `    <glob pattern="*.${e}"/>`).join('\n')}
    <icon name="notecomplete"/>
  </mime-type>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">\n${types}\n</mime-info>\n`;
}

// Exec values with spaces or specials must be quoted; % is doubled.
const execQuote = p => `"${p.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%')}"`;

export function desktopEntry(appImage, icon = 'notecomplete') {
  const mimes = [...OWN_TYPES, ...OTHER_TYPES].map(t => t.mimeType);
  return `[Desktop Entry]
Version=1.0
Name=NoteComplete
GenericName=Noteful reader
Comment=Local-first reader and editor for Noteful notes
Exec=env ELECTRON_OZONE_PLATFORM_HINT=auto ${execQuote(appImage)} %U
StartupNotify=true
StartupWMClass=NoteComplete
Terminal=false
Icon=${icon}
Type=Application
Categories=Office;
MimeType=${[...new Set(mimes)].join(';')};
`;
}

const run = (file, args) => new Promise(resolve => execFile(file, args, { timeout: 15000 }, (error, stdout) => resolve(error ? null : String(stdout))));
async function writeIfChanged(file, text) {
  try { if (await readFile(file, 'utf8') === text) return false; } catch { /* Not there yet. */ }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return true;
}

export async function integrateLinux({ appImage = process.env.APPIMAGE, platform = process.platform, home = os.homedir(), exec = run } = {}) {
  if (platform !== 'linux' || !appImage || !path.isAbsolute(appImage)) return false;
  const data = process.env.XDG_DATA_HOME || path.join(home, '.local/share');
  const mimeChanged = await writeIfChanged(path.join(data, 'mime/packages/notecomplete.xml'), mimeXml());
  const entryChanged = await writeIfChanged(path.join(data, 'applications/notecomplete.desktop'), desktopEntry(appImage));
  if (mimeChanged) await exec('update-mime-database', [path.join(data, 'mime')]);
  if (entryChanged) await exec('update-desktop-database', [path.join(data, 'applications')]);
  if (mimeChanged || entryChanged) {
    await exec('xdg-mime', ['default', 'notecomplete.desktop', ...OWN_TYPES.map(t => t.mimeType)]);
  }
  return mimeChanged || entryChanged;
}
