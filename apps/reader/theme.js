// Light/dark theme: follows the system until the user picks one (View → Dark theme).
// The stylesheet's dark rules sit in `prefers-color-scheme: dark` media blocks; a chosen
// theme switches those blocks on or off, so there is a single source of colours.
const KEY = 'notecomplete-theme';
const DARK = /\(prefers-color-scheme:\s*dark\)/;

export const effectiveTheme = (choice, systemDark) => (choice === 'dark' || choice === 'light' ? choice : systemDark ? 'dark' : 'light');

export function themeController({ toggle, system, status = () => {}, onChange = () => {} }) {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list; try { list = sheet.cssRules; } catch { continue; }
    for (const rule of list) if (rule.media && DARK.test(rule.media.mediaText)) rules.push({ rule, original: rule.media.mediaText });
  }
  let choice = 'system';
  try { choice = localStorage.getItem(KEY) || 'system'; } catch { /* Optional. */ }
  function apply() {
    const theme = effectiveTheme(choice, !!query?.matches);
    for (const { rule, original } of rules) rule.media.mediaText = choice === 'system' ? original : choice === 'dark' ? 'all' : 'not all';
    document.documentElement.style.colorScheme = choice === 'system' ? '' : choice;
    document.documentElement.dataset.theme = theme;
    toggle.setAttribute('aria-checked', String(theme === 'dark'));
    system.setAttribute('aria-checked', String(choice === 'system'));
  }
  function set(next) {
    choice = next;
    try { next === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, next); } catch { /* Optional. */ }
    apply();
    onChange(document.documentElement.dataset.theme);
    status(next === 'system' ? 'Theme follows the system.' : `${next === 'dark' ? 'Dark' : 'Light'} theme.`);
  }
  toggle.onclick = () => set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  system.onclick = () => set('system');
  query?.addEventListener?.('change', () => { apply(); onChange(document.documentElement.dataset.theme); });
  apply();
  return { set, get theme() { return document.documentElement.dataset.theme; } };
}
