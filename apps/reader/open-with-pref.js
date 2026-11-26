// How office files open by default (setup wizard → Office files), one choice per kind:
// "text" (the reader's own text view, office.js), "euro-office" (the separate Euro-Office
// install, once it exists) or "ask" (ask each time). Remembered on this device in one key.
export const OPEN_WITH_KEY = 'notecomplete-open-with';
export const OFFICE_KINDS = ['documents', 'spreadsheets', 'presentations'];
export const OPENERS = ['text', 'euro-office', 'ask'];
export const R_KIND = 'r-scripts';
export const R_OPENERS = ['text', 'r-studio', 'ask'];
const DEFAULT = 'text';

function readRaw(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(OPEN_WITH_KEY) || 'null');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

// The three choices, each a known opener (anything else stored falls back to the text view).
export function openWithPrefs(storage = globalThis.localStorage) {
  const saved = readRaw(storage);
  return Object.fromEntries(OFFICE_KINDS.map((kind) => [kind, OPENERS.includes(saved?.[kind]) ? saved[kind] : DEFAULT]));
}

// The opener for one kind ('documents', 'spreadsheets' or 'presentations').
export const openWith = (kind, storage = globalThis.localStorage) => openWithPrefs(storage)[kind] || DEFAULT;

export function setOpenWith(kind, opener, storage = globalThis.localStorage) {
  if (!OFFICE_KINDS.includes(kind) || !OPENERS.includes(opener)) return openWithPrefs(storage);
  const raw = readRaw(storage);
  const next = { ...openWithPrefs(storage), [kind]: opener };
  const stored = R_OPENERS.includes(raw[R_KIND]) ? { ...next, [R_KIND]: raw[R_KIND] } : next;
  try { storage?.setItem(OPEN_WITH_KEY, JSON.stringify(stored)); } catch { /* Kept for this session only. */ }
  return next;
}

// How R scripts (.R, .Rmd, .qmd) open by default: 'text' (NoteComplete code editor),
// 'r-studio' (R Commander Studio), or 'ask' (show the Open with picker).
export function rOpenWith(storage = globalThis.localStorage) {
  const saved = readRaw(storage);
  return R_OPENERS.includes(saved?.[R_KIND]) ? saved[R_KIND] : DEFAULT;
}

export function setROpenWith(opener, storage = globalThis.localStorage) {
  if (!R_OPENERS.includes(opener)) return rOpenWith(storage);
  const stored = { ...openWithPrefs(storage), [R_KIND]: opener };
  try { storage?.setItem(OPEN_WITH_KEY, JSON.stringify(stored)); } catch { /* Kept for this session only. */ }
  return opener;
}
