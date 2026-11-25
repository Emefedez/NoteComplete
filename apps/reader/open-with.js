// "Open with": which ways a file can be opened and which one is used.
//   "text"        NoteComplete's text view: office.js converts the file to Markdown (read-only,
//                 Save keeps a .md copy). Exactly the files office.js handles today.
//   "euro-office" the Euro-Office module (office-module.js), only once it is installed; it edits
//                 some formats in place, converts others to OOXML on opening, and only views the rest.
// The default for each kind of file is the choice in Setup ▸ Modules ▸ Office suite
// (open-with-pref.js), with "ask" for a chooser; a choice that cannot open the file, or is not
// installed, falls back to the other way. Pure functions; the chooser and menus are in open-with-ui.js.
import { OFFICE_FORMATS } from './office-formats.js';
import { isOfficeName, isTableName } from './text-types.js';
import { openWith } from './open-with-pref.js';

export const OPENER_LABELS = { text: 'Text view (Markdown)', 'euro-office': 'Euro-Office' };
export const KIND_NAMES = { documents: 'documents', spreadsheets: 'spreadsheets', presentations: 'presentations', pdf: 'PDF files', other: 'these files' };
const TYPE_KIND = { word: 'documents', cell: 'spreadsheets', slide: 'presentations', pdf: 'pdf', diagram: 'other' };
// Files NoteComplete opens its own way that are not office documents: PDF stays a note, plain
// text, Markdown, XML and web pages keep their own views. Euro-Office lists them, but they are
// never sent to it (a "documents: Euro-Office" choice must not take every .md file).
const NATIVE = new Set(['pdf', 'txt', 'md', 'xml', 'html', 'htm']);

export const extensionOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

// Extension → { type, actions, mime } from the built-in list ([ext, type, actions, mime] rows) or
// a module manifest ({ name, type, actions, mime } entries); entries without a type are skipped.
const tables = new WeakMap();
export function formatTable(list = OFFICE_FORMATS) {
  if (tables.has(list)) return tables.get(list);
  const table = new Map();
  for (const row of list || []) {
    const [name, type, actions, mime] = Array.isArray(row) ? row : [row?.name, row?.type, row?.actions, row?.mime];
    if (!name || !type) continue;
    table.set(String(name).toLowerCase(), { type, actions: new Set(Array.isArray(actions) ? actions : String(actions || '').split(/\s+/).filter(Boolean)), mime: mime || [] });
  }
  tables.set(list, table);
  return table;
}

// documents / spreadsheets / presentations / pdf / other, by extension.
export function fileKindOf(name, formats = OFFICE_FORMATS) {
  const ext = extensionOf(name);
  if (ext === 'csv' || ext === 'tsv') return 'spreadsheets';
  return TYPE_KIND[formatTable(formats).get(ext)?.type] || 'other';
}

// The text view opens what office.js converts (and .csv / .tsv, read as tables).
export const textViewOpens = (name) => isOfficeName(name) || isTableName(name);

// How Euro-Office opens the file, or null when it does not (or NoteComplete keeps it):
// 'edit' (saved in place), 'lossy-edit' (saved in place, some formatting may be lost),
// 'convert' (opened as OOXML, saved as a new file beside it) or 'view'.
export function euroOfficeMode(name, formats = OFFICE_FORMATS) {
  const ext = extensionOf(name);
  const format = !NATIVE.has(ext) && formatTable(formats).get(ext);
  if (!format) return null;
  const a = format.actions;
  return a.has('edit') ? 'edit' : a.has('lossy-edit') && !a.has('auto-convert') ? 'lossy-edit' : a.has('auto-convert') ? 'convert' : a.has('view') ? 'view' : null;
}

// Files only Euro-Office opens (.ppsx, .xltx, .djvu, .vsdx…): unsupported until it is installed.
export const onlyEuroOffice = (name, formats = OFFICE_FORMATS) => !textViewOpens(name) && euroOfficeMode(name, formats) !== null;
// Files that have an "Open with" choice to show (menus): any the text view or Euro-Office opens.
export const hasOpenWith = (name, formats = OFFICE_FORMATS) => textViewOpens(name) || euroOfficeMode(name, formats) !== null;

// The ways that open this file, each { id, label, available, mode? } (available: usable now).
export function openersFor(name, { installed = false, formats = OFFICE_FORMATS } = {}) {
  const list = [];
  if (textViewOpens(name)) list.push({ id: 'text', label: OPENER_LABELS.text, available: true });
  const mode = euroOfficeMode(name, formats);
  if (mode) list.push({ id: 'euro-office', label: OPENER_LABELS['euro-office'], available: installed, mode });
  return list;
}

// What opening the file does: { kind, openers, opener, ask }.
//   opener: 'text' | 'euro-office' | null (nothing installed opens it: unsupported)
//   ask: show the chooser (the kind's default is "ask" and there is more than one way); `opener`
//        is then the one to suggest.
// `pref`: the kind's default ('text' | 'euro-office' | 'ask'), read from the setting when omitted.
export function decideOpener(name, { installed = false, formats = OFFICE_FORMATS, pref = null, storage } = {}) {
  const kind = fileKindOf(name, formats);
  const openers = openersFor(name, { installed, formats });
  const usable = openers.filter((o) => o.available);
  const chosen = pref ?? (['documents', 'spreadsheets', 'presentations'].includes(kind) ? openWith(kind, storage) : 'text');
  if (!usable.length) return { kind, openers, opener: null, ask: false };
  const ask = chosen === 'ask' && openers.length > 1;
  const opener = (usable.find((o) => o.id === chosen) || usable[0]).id;
  return { kind, openers, opener, ask };
}

// What to say when a file only Euro-Office opens is chosen while it is not installed.
export const needsOfficeMessage = (name) =>
  `${extensionOf(name) ? `.${extensionOf(name)} files open` : 'This file opens'} in the Office suite (Euro-Office), a module not installed yet: see Help ▸ Setup wizard ▸ Modules.`;

// A choice made in an "Open with" menu, for the next opening of that file name only (the file
// goes through the same download and open path as a click; load() takes the choice).
const once = new Map();
export function openOnceWith(name, opener, now = Date.now()) { once.set(String(name || ''), { opener, at: now }); }
export function takeOpenOnce(name, now = Date.now()) {
  const key = String(name || ''), hit = once.get(key);
  once.delete(key);
  // Stale after ten minutes (a download that never finished): the default applies again.
  return hit && now - hit.at < 600000 ? hit.opener : null;
}
