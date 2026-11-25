// How office files open by default (setup wizard → Office files), one choice per kind:
// "text" (the reader's own text view, office.js), "euro-office" (the separate Euro-Office
// install, once it exists) or "ask" (ask each time). Remembered on this device in one key.
export const OPEN_WITH_KEY = 'notecomplete-open-with';
export const OFFICE_KINDS = ['documents', 'spreadsheets', 'presentations'];
export const OPENERS = ['text', 'euro-office', 'ask'];
const DEFAULT = 'text';

// The three choices, each a known opener (anything else stored falls back to the text view).
export function openWithPrefs(storage = globalThis.localStorage) {
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(OPEN_WITH_KEY) || 'null'); } catch { /* Optional. */ }
  return Object.fromEntries(OFFICE_KINDS.map((kind) => [kind, OPENERS.includes(saved?.[kind]) ? saved[kind] : DEFAULT]));
}

// The opener for one kind ('documents', 'spreadsheets' or 'presentations').
export const openWith = (kind, storage = globalThis.localStorage) => openWithPrefs(storage)[kind] || DEFAULT;

export function setOpenWith(kind, opener, storage = globalThis.localStorage) {
  if (!OFFICE_KINDS.includes(kind) || !OPENERS.includes(opener)) return openWithPrefs(storage);
  const next = { ...openWithPrefs(storage), [kind]: opener };
  try { storage?.setItem(OPEN_WITH_KEY, JSON.stringify(next)); } catch { /* Kept for this session only. */ }
  return next;
}
