// The open documents kept across a restart for an update: before the app restarts, every tab
// says what it shows (session state from the reader: its Recent entry, page, and an automatic
// save when it had unsaved changes); after it, the same windows and tabs open again with them.
// Only a restart this app asked for is restored, and only soon after: a later, ordinary launch
// starts as usual.
import { readFile, writeFile, rm } from 'node:fs/promises';

// How long after the restart the saved session is still taken.
export const FRESH_MS = 30 * 60_000;
const MAX_TABS = 60;

// A tab's state as the reader gave it, kept only in the fields restoring uses.
export function cleanState(state) {
  if (!state || typeof state !== 'object') return null;
  const text = (v, max = 512) => (typeof v === 'string' && v.length <= max ? v : '');
  const out = {
    entryKey: text(state.entryKey),
    slot: text(state.slot, 128),
    title: text(state.title, 300),
    page: Number.isInteger(state.page) && state.page >= 0 && state.page < 100_000 ? state.page : 0,
  };
  return out.entryKey || out.slot ? out : null;
}

// What is written: the windows in order, each with its tabs' states and the active one.
// Tabs that showed nothing (Home) are left out; a window with none still opens.
export function sessionOf(windows, now = Date.now()) {
  let count = 0;
  return {
    reason: 'update',
    at: now,
    windows: windows.map((w) => {
      const tabs = [];
      let active = 0;
      for (const tab of w.tabs || []) {
        const state = cleanState(tab.state);
        if (!state || count >= MAX_TABS) continue;
        if (tab.active) active = tabs.length;
        tabs.push(state);
        count++;
      }
      return { tabs, active };
    }),
  };
}

export async function saveSession(file, windows, now = Date.now()) {
  await writeFile(file, JSON.stringify(sessionOf(windows, now)));
}

// The session left by a restart for an update, read once (the file is removed), or null when
// there is none, it is stale, or it does not hold what was written.
export async function takeSession(file, now = Date.now()) {
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
  await rm(file, { force: true }).catch(() => {});
  if (data?.reason !== 'update' || !Number.isFinite(data.at) || now - data.at > FRESH_MS || now < data.at - 60_000) return null;
  if (!Array.isArray(data.windows) || !data.windows.length) return null;
  const windows = data.windows.slice(0, 20).map((w) => {
    const tabs = (Array.isArray(w?.tabs) ? w.tabs : []).map(cleanState).filter(Boolean);
    const active = Number.isInteger(w?.active) && w.active >= 0 && w.active < tabs.length ? w.active : 0;
    return { tabs, active };
  });
  return windows.some((w) => w.tabs.length) ? { windows } : null;
}
