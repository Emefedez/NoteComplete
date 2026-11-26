import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTheme } from './theme.js';
test('a chosen theme wins over the system', () => {
  assert.equal(effectiveTheme('system', true), 'dark');
  assert.equal(effectiveTheme('system', false), 'light');
  assert.equal(effectiveTheme('light', true), 'light');
  assert.equal(effectiveTheme('dark', false), 'dark');
});
import { validTheme, baseTheme, themeName, savedTheme } from './theme.js';
import { PRESETS, getPreset, themeVars, mix } from './themes.js';
test('a colour theme has a light or dark base', () => {
  assert.equal(baseTheme('dracula'), 'dark');
  assert.equal(baseTheme('solarized-light'), 'light');
  assert.equal(effectiveTheme('nord', false), 'dark');
  assert.equal(effectiveTheme('vscode-light', true), 'light');
  assert.equal(themeName('tokyo-night'), 'Tokyo Night');
});
test('an unknown saved theme falls back to the system', () => {
  assert.equal(validTheme('neon'), 'system');
  assert.equal(validTheme('one-dark'), 'one-dark');
  const store = (v) => ({ getItem: () => v });
  assert.equal(savedTheme(store('gone')), 'system');
  assert.equal(savedTheme(store('dracula')), 'dracula');
  assert.equal(savedTheme(store(null)), 'system');
});
test('every colour theme gives every variable a #rrggbb colour', () => {
  const ids = new Set();
  for (const p of PRESETS) {
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    assert.equal(getPreset(p.id), p);
    const vars = themeVars(p);
    for (const name of ['--ink', '--muted', '--accent', '--accent-soft', '--line', '--surface', '--chrome', '--canvas', '--fill', '--tk-kw']) assert.match(vars[name], /^#[0-9a-f]{6}$/, `${p.id} ${name}`);
  }
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});
import { parseThemeJson, themeJson, toHex, cleanColors } from './themes.js';
import { savedColors } from './theme.js';
test('theme JSON goes out and comes back', () => {
  const json = themeJson('nord', { '--accent': '#AABBCC', '--nope': '#000000', '--ink': 'red' });
  assert.deepEqual(parseThemeJson(json), { theme: 'nord', colors: { '--accent': '#aabbcc' } });
  assert.equal(parseThemeJson('not json'), null);
  assert.equal(parseThemeJson('[1]'), null);
  assert.deepEqual(parseThemeJson('{"theme":"gone","colors":{}}'), { theme: 'system', colors: {} });
});
test("R Commander Studio's theme JSON is read", () => {
  const dracula = parseThemeJson(JSON.stringify({ preset: 'dracula', overrides: { accent: '#00FF00' } }));
  assert.equal(dracula.theme, 'dracula');
  assert.equal(dracula.colors['--accent'], '#00ff00');
  assert.ok(dracula.colors['--accent-soft'], 'the colours made from the accent follow it');
  assert.deepEqual(parseThemeJson(JSON.stringify({ preset: 'notecomplete-light', overrides: { bgEditor: '#FAFAFA', bgActivity: '#E0E0E0' } })),
    { theme: 'light', colors: { '--surface': '#fafafa', '--canvas': '#e0e0e0' } });
});
test('colours are kept only for the theme they were made for', () => {
  const store = { getItem: () => JSON.stringify({ theme: 'nord', colors: { '--ink': '#ffffff' } }) };
  assert.deepEqual(savedColors('nord', store), { '--ink': '#ffffff' });
  assert.deepEqual(savedColors('dracula', store), {});
  assert.equal(toHex('#fff'), '#ffffff');
  assert.equal(toHex(' #0002'), '#000000');
  assert.equal(toHex('rgb(1, 2, 255)'), '#0102ff');
  assert.deepEqual(cleanColors(null), {});
});
