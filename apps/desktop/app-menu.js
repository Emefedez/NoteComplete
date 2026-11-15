// The native menu (Alt shows it; the reader draws its own File/Edit/View bar). It has no
// zoom items: Electron's default View menu puts Zoom In on Ctrl+Plus, which on layouts with
// a + key (Spanish) took that key before the reader, so Ctrl + stopped zooming the document
// while Ctrl − still did. Ctrl +/−/0 belong to the reader and Ctrl Shift +/−/0 to the
// interface size (main.js), on every layout.
export function menuTemplate(platform = process.platform) {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
}

/** Maps Ctrl/Cmd+Shift+zoom shortcuts to -1, 1, or 0 across US/ES/international keyboard layouts. */
export function uiZoomStep(input) {
  if (!(input.control || input.meta) || !input.shift || input.alt) return null;
  if (input.key === '_' || input.key === '-' || input.code === 'Minus' || input.code === 'NumpadSubtract') return -1;
  if (input.key === '+' || input.key === '*' || (input.key === '=' && input.code !== 'Digit0') || input.code === 'Equal' || input.code === 'NumpadAdd') return 1;
  if (input.key === '0' || input.key === ')' || input.code === 'Digit0' || input.code === 'Numpad0') return 0;
  return null;
}
