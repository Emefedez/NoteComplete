// Light/dark theme: follows the system until the user picks one. View has the three choices
// (Light, Dark, Follows the system) as one radio group, and More themes… for the colour themes
// of themes.js (Dracula, Nord, Solarized…), which the Setup wizard offers too.
// The stylesheet's dark rules sit in `prefers-color-scheme: dark` media blocks; a chosen
// theme switches those blocks on or off, so there is a single source of colours. A colour
// theme turns on its light or dark base, then sets its colours as variables on <html>.
import { getPreset, themeVars, cleanColors } from './themes.js';

const KEY = 'notecomplete-theme';
// The theme editor's colours: { theme, colors }, used only while that theme is the chosen one.
const COLORS_KEY = 'notecomplete-theme-colors';
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
// The edited colours of `choice` (none when they were made for another theme).
export function savedColors(choice, storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage?.getItem(COLORS_KEY) || 'null');
    return data && data.theme === choice ? cleanColors(data.colors) : {};
  } catch { return {}; }
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
  let colors = savedColors(choice);
  let vars = [];
  const saveColors = () => {
    try { Object.keys(colors).length ? localStorage.setItem(COLORS_KEY, JSON.stringify({ theme: choice, colors })) : localStorage.removeItem(COLORS_KEY); } catch { /* Optional. */ }
  };
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
    for (const [name, value] of Object.entries(colors)) { root.style.setProperty(name, value); vars.push(name); }
    toggle.setAttribute('aria-checked', String(choice === 'dark'));
    light?.setAttribute('aria-checked', String(choice === 'light'));
    system.setAttribute('aria-checked', String(choice === 'system'));
    more?.setAttribute('aria-checked', String(!!preset));
  }
  // Another theme starts from its own colours, as a new preset does in R Commander Studio.
  function set(next) {
    const before = choice;
    choice = validTheme(next);
    if (choice !== before) { colors = {}; saveColors(); }
    try { choice === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice); } catch { /* Optional. */ }
    apply();
    status(choice === 'system' ? 'Theme follows the system.' : `${themeName(choice)} theme.`);
  }
  toggle.onclick = () => set('dark');
  if (light) light.onclick = () => set('light');
  system.onclick = () => set('system');
  query?.addEventListener?.('change', apply);
  apply();
  // The theme editor: one colour (`save` false while a picker is dragged), all of them back,
  // or a theme file's theme and colours.
  function setColor(name, value, save = true) {
    const next = cleanColors({ ...colors, [name]: value });
    if (!(name in next)) return;
    colors = next;
    root.style.setProperty(name, value);
    if (!vars.includes(name)) vars.push(name);
    if (save) saveColors();
  }
  function resetColors() { colors = {}; saveColors(); apply(); }
  function load(theme, next) {
    set(theme);
    colors = cleanColors(next);
    saveColors();
    apply();
  }
  return { set, setColor, resetColors, load, get colors() { return { ...colors }; }, get choice() { return choice; }, get theme() { return root.dataset.theme; } };
}
