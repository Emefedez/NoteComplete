// Light/dark theme: follows the system until the user picks one. View has the three choices
// (Light, Dark, Follows the system) as one radio group, and More themes… for the colour themes
// of themes.js (Dracula, Nord, Solarized…), which the Setup wizard offers too.
// The stylesheet's dark rules sit in `prefers-color-scheme: dark` media blocks; a chosen
// theme switches those blocks on or off, so there is a single source of colours. A colour
// theme turns on its light or dark base, then sets its colours as variables on <html>.
import { getPreset, themeVars } from './themes.js';

const KEY = 'notecomplete-theme';
const DARK = /\(prefers-color-scheme:\s*dark\)/;
const BASE = new Set(['light', 'dark', 'system']);

// A saved choice that is no longer known (a theme removed) falls back to the system.
export const validTheme = (choice) => (BASE.has(choice) || getPreset(choice) ? choice : 'system');
// The light or dark base of a choice: a colour theme has its own.
export const baseTheme = (choice) => { const p = getPreset(choice); return p ? (p.isLight ? 'light' : 'dark') : choice; };
export const effectiveTheme = (choice, systemDark) => { const b = baseTheme(choice); return b === 'dark' || b === 'light' ? b : systemDark ? 'dark' : 'light'; };
export const themeName = (choice) => getPreset(choice)?.name || (choice === 'dark' ? 'Dark' : choice === 'light' ? 'Light' : 'Follows the system');
export function savedTheme(storage = globalThis.localStorage) {
  try { return validTheme(storage?.getItem(KEY) || 'system'); } catch { return 'system'; }
}

export function themeController({ toggle, system, light = null, more = null, status = () => {} }) {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list; try { list = sheet.cssRules; } catch { continue; }
    for (const rule of list) if (rule.media && DARK.test(rule.media.mediaText)) rules.push({ rule, original: rule.media.mediaText });
  }
  const root = document.documentElement;
  let choice = savedTheme();
  let vars = [];
  function apply() {
    const base = baseTheme(choice);
    const theme = effectiveTheme(choice, !!query?.matches);
    for (const { rule, original } of rules) rule.media.mediaText = base === 'system' ? original : base === 'dark' ? 'all' : 'not all';
    root.style.colorScheme = base === 'system' ? '' : base;
    root.dataset.theme = theme;
    for (const name of vars) root.style.removeProperty(name);
    vars = [];
    const preset = getPreset(choice);
    if (preset) {
      for (const [name, value] of Object.entries(themeVars(preset))) { root.style.setProperty(name, value); vars.push(name); }
      root.dataset.themePreset = preset.id;
    } else delete root.dataset.themePreset;
    toggle.setAttribute('aria-checked', String(choice === 'dark'));
    light?.setAttribute('aria-checked', String(choice === 'light'));
    system.setAttribute('aria-checked', String(choice === 'system'));
    more?.setAttribute('aria-checked', String(!!preset));
  }
  function set(next) {
    choice = validTheme(next);
    try { choice === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice); } catch { /* Optional. */ }
    apply();
    status(choice === 'system' ? 'Theme follows the system.' : `${themeName(choice)} theme.`);
  }
  toggle.onclick = () => set('dark');
  if (light) light.onclick = () => set('light');
  system.onclick = () => set('system');
  query?.addEventListener?.('change', apply);
  apply();
  return { set, get choice() { return choice; }, get theme() { return root.dataset.theme; } };
}
