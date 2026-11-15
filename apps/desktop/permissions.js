const READER_MEDIA_TYPES = new Set(['audio', 'video', 'unknown']);

/** Whether the reader shell (`home` origin) may receive a requested Chromium permission. */
export function readerPermissionAllowed(home, permission, url = '', media = []) {
  const value = String(url);
  const normalized = value.endsWith('/') ? value : `${value}/`;
  if (!normalized.startsWith(home)) return false;
  if (permission === 'clipboard-sanitized-write') return true;
  if (permission !== 'media') return false;
  return media.length === 0 || media.every((type) => READER_MEDIA_TYPES.has(type));
}
