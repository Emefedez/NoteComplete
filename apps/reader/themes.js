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
