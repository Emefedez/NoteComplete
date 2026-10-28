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
