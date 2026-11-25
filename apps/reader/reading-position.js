// Remembers the last reading position (page + scroll offset for notes/PDFs, scroll offset for
// text/Markdown documents) per file key so reopening a file from Recents restores where you left off.
export const POSITIONS_KEY = 'notecomplete-reading-positions';
const MAX_ENTRIES = 200;

function readAll(storage = globalThis.localStorage) {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(POSITIONS_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function readPosition(key, storage = globalThis.localStorage) {
  if (!key) return null;
  const entry = readAll(storage)[String(key)];
  return entry && typeof entry === 'object' ? entry : null;
}

export function savePosition(key, pos, storage = globalThis.localStorage) {
  if (!key || !pos || !storage) return false;
  const all = readAll(storage);
  const next = { at: Date.now() };
  if (Number.isInteger(pos.page) && pos.page >= 0) next.page = pos.page;
  if (Number.isFinite(pos.scrollTop) && pos.scrollTop >= 0) next.scrollTop = Math.round(pos.scrollTop);
  if (Number.isFinite(pos.textScroll) && pos.textScroll >= 0) next.textScroll = Math.round(pos.textScroll);
  all[String(key)] = next;
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => (all[b]?.at || 0) - (all[a]?.at || 0));
    for (const k of keys.slice(MAX_ENTRIES)) delete all[k];
  }
  try {
    storage.setItem(POSITIONS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
