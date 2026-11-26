// Colour themes on top of Light, Dark and Follows the system, lifted from R Commander Studio
// (shared/themes.js there): the same presets with the same token names, so a theme made for
// one app drops into the other. A theme is plain data; `themeVars` turns it into the app's CSS
// variables (style.css's --ink, --surface… and code-highlight.css's --tk-*), which theme.js
// sets on <html> over the light or dark colours. Nothing is loaded or drawn until one is chosen.

export const PRESETS = [
  { id: 'dracula', name: 'Dracula', isLight: false,
    tokens: { bgEditor: '#282a36', bgSidebar: '#21222c', bgChrome: '#191a21', bgActivity: '#343746', fg: '#f8f8f2', fgMuted: '#7f8bba', accent: '#bd93f9', border: '#44475a', selection: '#44475a' },
    syntax: { keyword: '#ff79c6', type: '#8be9fd', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', fn: '#50fa7b', operator: '#ff79c6', error: '#ff5555', warn: '#ffb86c' } },
  { id: 'vscode-dark', name: 'VS Code Dark+', isLight: false,
    tokens: { bgEditor: '#1e1e1e', bgSidebar: '#252526', bgChrome: '#181818', bgActivity: '#333333', fg: '#d4d4d4', fgMuted: '#858585', accent: '#3794ff', border: '#3c3c3c', selection: '#264f78' },
    syntax: { keyword: '#569cd6', type: '#4ec9b0', string: '#ce9178', number: '#b5cea8', comment: '#6a9955', fn: '#dcdcaa', operator: '#d4d4d4', error: '#f14c4c', warn: '#cca700' } },
  { id: 'one-dark', name: 'One Dark Pro', isLight: false,
    tokens: { bgEditor: '#282c34', bgSidebar: '#21252b', bgChrome: '#181a1f', bgActivity: '#2c313a', fg: '#abb2bf', fgMuted: '#8a909b', accent: '#61afef', border: '#3e4451', selection: '#3e4451' },
    syntax: { keyword: '#c678dd', type: '#e5c07b', string: '#98c379', number: '#d19a66', comment: '#7f848e', fn: '#61afef', operator: '#56b6c2', error: '#e06c75', warn: '#e5c07b' } },
  { id: 'nord', name: 'Nord', isLight: false,
    tokens: { bgEditor: '#2e3440', bgSidebar: '#272c36', bgChrome: '#222630', bgActivity: '#3b4252', fg: '#d8dee9', fgMuted: '#8a94a8', accent: '#88c0d0', border: '#434c5e', selection: '#434c5e' },
    syntax: { keyword: '#81a1c1', type: '#8fbcbb', string: '#a3be8c', number: '#b48ead', comment: '#8a94a8', fn: '#88c0d0', operator: '#81a1c1', error: '#bf616a', warn: '#ebcb8b' } },
  { id: 'tokyo-night', name: 'Tokyo Night', isLight: false,
    tokens: { bgEditor: '#1a1b26', bgSidebar: '#16161e', bgChrome: '#13131a', bgActivity: '#24283b', fg: '#c0caf5', fgMuted: '#7a84b0', accent: '#7aa2f7', border: '#2f3549', selection: '#33467c' },
    syntax: { keyword: '#bb9af7', type: '#2ac3de', string: '#9ece6a', number: '#ff9e64', comment: '#7a84b0', fn: '#7aa2f7', operator: '#89ddff', error: '#f7768e', warn: '#e0af68' } },
  { id: 'vscode-light', name: 'VS Code Light+', isLight: true,
    tokens: { bgEditor: '#ffffff', bgSidebar: '#f3f3f3', bgChrome: '#e8e8e8', bgActivity: '#e0e0e0', fg: '#1e1e1e', fgMuted: '#616161', accent: '#005fb8', border: '#cccccc', selection: '#add6ff' },
    syntax: { keyword: '#af00db', type: '#267f99', string: '#a31515', number: '#098658', comment: '#008000', fn: '#795e26', operator: '#000000', error: '#e51400', warn: '#bf8803' } },
  { id: 'solarized-light', name: 'Solarized Light', isLight: true,
    tokens: { bgEditor: '#fdf6e3', bgSidebar: '#eee8d5', bgChrome: '#e4dec9', bgActivity: '#ddd6c1', fg: '#586e75', fgMuted: '#687b81', accent: '#1f6fa8', border: '#d3ccb6', selection: '#d5e2ea' },
    syntax: { keyword: '#859900', type: '#b58900', string: '#2aa198', number: '#d33682', comment: '#7b8b8f', fn: '#268bd2', operator: '#cb4b16', error: '#dc322f', warn: '#b58900' } },
];

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
export const getPreset = (id) => BY_ID.get(id) || null;

// `a` moved toward `b` by t (0…1), as #rrggbb.
export function mix(a, b, t) {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// The CSS variables a theme sets. Variables it leaves out (--ok, shadows) keep the light or
// dark value underneath, which the theme picks with `isLight`.
export function themeVars(preset) {
  const t = preset.tokens, s = preset.syntax, light = preset.isLight;
  return {
    '--ink': t.fg,
    '--muted': t.fgMuted,
    '--accent': t.accent,
    '--accent-soft': mix(t.bgEditor, t.accent, light ? 0.12 : 0.2),
    '--accent-hover': mix(t.bgEditor, t.accent, light ? 0.2 : 0.3),
    '--line': t.border,
    '--surface': t.bgEditor,
    '--menu': light ? t.bgEditor : mix(t.bgEditor, t.fg, 0.04),
    '--chrome': t.bgSidebar,
    '--canvas': light ? t.bgActivity : t.bgChrome,
    '--fill': light ? t.bgChrome : t.bgActivity,
    '--danger': s.error,
    '--warn': s.warn,
    '--danger-soft': mix(t.bgEditor, s.error, light ? 0.1 : 0.18),
    '--tk-kw': s.keyword,
    '--tk-type': s.type,
    '--tk-str': s.string,
    '--tk-num': s.number,
    '--tk-com': s.comment,
    '--tk-fn': s.fn,
    '--tk-op': s.operator,
    '--tk-anno': s.error,
  };
}

// ---- Theme editor (View ▸ More themes… ▸ Edit colours), as in R Commander Studio ----
// The colours it edits, by the app's own variable; each change lies over the chosen theme.
export const EDITABLE = [
  { name: '--surface', label: 'Panels and dialogs' },
  { name: '--chrome', label: 'Bars' },
  { name: '--menu', label: 'Menus' },
  { name: '--canvas', label: 'Behind the pages' },
  { name: '--fill', label: 'Buttons and fields' },
  { name: '--ink', label: 'Text' },
  { name: '--muted', label: 'Secondary text' },
  { name: '--accent', label: 'Accent' },
  { name: '--accent-soft', label: 'Chosen items' },
  { name: '--accent-hover', label: 'Pointed-at items' },
  { name: '--line', label: 'Lines and borders' },
];
const EDITABLE_NAMES = new Set(EDITABLE.map((e) => e.name));
const HEX = /^#[0-9a-f]{6}$/i;

// Any CSS colour this app writes (#rgb, #rrggbb, #rrggbbaa, rgb()) as #rrggbb, else ''.
export function toHex(value) {
  const v = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{3,4}$/.test(v)) return `#${[1, 2, 3].map((i) => v[i] + v[i]).join('')}`;
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return v.slice(0, 7);
  const m = v.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  return m ? `#${m.slice(1, 4).map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')}` : '';
}
// Only editable variables with a #rrggbb value are kept.
export function cleanColors(colors) {
  const out = {};
  if (colors && typeof colors === 'object') for (const [k, v] of Object.entries(colors)) if (EDITABLE_NAMES.has(k) && HEX.test(v)) out[k] = v.toLowerCase();
  return out;
}

// R Commander Studio's token for each variable, for its exported JSON ({ preset, overrides }).
const FROM_STUDIO = { bgEditor: '--surface', bgSidebar: '--chrome', fg: '--ink', fgMuted: '--muted', accent: '--accent', border: '--line', selection: '--accent-hover' };

// A theme file: NoteComplete's own ({ theme, colors }) or R Commander Studio's ({ preset,
// overrides }). Returns { theme, colors } or null. `known(id)` says whether a theme id exists.
export function parseThemeJson(text, known = (id) => !!getPreset(id) || ['light', 'dark', 'system'].includes(id)) {
  let data; try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  if (typeof data.theme === 'string' || data.colors) {
    const theme = known(data.theme) ? data.theme : 'system';
    return { theme, colors: cleanColors(data.colors) };
  }
  if (typeof data.preset === 'string') {
    const overrides = data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
    const preset = getPreset(data.preset);
    if (preset) {
      // The theme's own colours with the overrides in, kept where they differ from the theme.
      const tokens = { ...preset.tokens };
      for (const [k, v] of Object.entries(overrides)) if (k in tokens && HEX.test(v)) tokens[k] = v.toLowerCase();
      const before = themeVars(preset), after = themeVars({ ...preset, tokens });
      const colors = {};
      for (const name of EDITABLE_NAMES) if (after[name] !== before[name]) colors[name] = after[name];
      return { theme: preset.id, colors };
    }
    // A theme NoteComplete does not have (R Commander Studio's NoteComplete Light is Light).
    const light = /light/i.test(data.preset);
    const colors = {};
    for (const [k, v] of Object.entries(overrides)) if (FROM_STUDIO[k] && HEX.test(v)) colors[FROM_STUDIO[k]] = v.toLowerCase();
    if (HEX.test(overrides.bgChrome || '')) colors[light ? '--fill' : '--canvas'] = overrides.bgChrome.toLowerCase();
    if (HEX.test(overrides.bgActivity || '')) colors[light ? '--canvas' : '--fill'] = overrides.bgActivity.toLowerCase();
    return { theme: light ? 'light' : 'dark', colors };
  }
  return null;
}
export const themeJson = (theme, colors) => JSON.stringify({ app: 'NoteComplete', theme, colors: cleanColors(colors) }, null, 2);
