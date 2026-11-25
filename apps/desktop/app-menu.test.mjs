import test from 'node:test';
import assert from 'node:assert/strict';
import { menuTemplate, uiZoomStep, ownPage } from './app-menu.js';

const roles = (items) => items.flatMap((item) => [item.role, ...(item.submenu ? roles(item.submenu) : [])]).filter(Boolean);

test('the native menu leaves Ctrl +/−/0 to the reader on every platform', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const all = roles(menuTemplate(platform)).map((r) => r.toLowerCase());
    for (const zoom of ['zoomin', 'zoomout', 'resetzoom', 'viewmenu']) assert.ok(!all.includes(zoom), `${platform}: ${zoom}`);
    assert.ok(all.includes('editmenu') && all.includes('reload') && all.includes('toggledevtools'));
  }
  assert.equal(menuTemplate('darwin')[0].role, 'appMenu');
});

test('Ctrl/Cmd + Shift + resize shortcuts recognize US, Spanish, and numpad keys', () => {
  assert.equal(uiZoomStep({ control: true, shift: true, key: '+' }), 1);
  assert.equal(uiZoomStep({ control: true, shift: true, key: '*' }), 1);
  assert.equal(uiZoomStep({ control: true, shift: true, key: '=' }), 1);
  assert.equal(uiZoomStep({ meta: true, shift: true, code: 'NumpadAdd', key: '+' }), 1);
  assert.equal(uiZoomStep({ control: true, shift: true, key: '_' }), -1);
  assert.equal(uiZoomStep({ control: true, shift: true, key: '-' }), -1);
  assert.equal(uiZoomStep({ control: true, shift: true, code: 'Minus', key: '-' }), -1);
  // Spanish Ctrl+Shift+0 emits key='=' with code='Digit0' — must reset (0), not zoom in (+1)!
  assert.equal(uiZoomStep({ control: true, shift: true, code: 'Digit0', key: '=' }), 0);
  assert.equal(uiZoomStep({ control: true, shift: true, key: '0' }), 0);
  assert.equal(uiZoomStep({ control: true, shift: true, key: ')' }), 0);
  // Unshifted or Alt-modified chords are ignored by UI zoom.
  assert.equal(uiZoomStep({ control: true, shift: false, key: '+' }), null);
  assert.equal(uiZoomStep({ control: true, shift: true, alt: true, key: '+' }), null);
});

test('Tools opens the UML editor page, and only the reader pages open in windows', () => {
  let opened = null;
  const tools = menuTemplate('linux', { openPage: (page) => { opened = page; } }).find((m) => m.label === 'Tools');
  tools.submenu.find((i) => i.label === 'UML diagram editor').click();
  assert.equal(opened, 'uml.html');
  tools.submenu.find((i) => i.label === 'Chart and timeline editor').click();
  assert.equal(opened, 'charts.html');
  assert.equal(ownPage('notecomplete://reader/charts.html?kind=states', 'notecomplete://reader/'), 'charts.html');
  const home = 'notecomplete://reader/';
  assert.equal(ownPage(`${home}uml.html`, home), 'uml.html');
  assert.equal(ownPage(`${home}uml.html?diagram=state`, home), 'uml.html');
  assert.equal(ownPage(`${home}index.html`, home), null);
  assert.equal(ownPage('https://example.com/uml.html', home), null);
});

test('Help ▸ Setup wizard… asks the reader to open the wizard', () => {
  let asked = 0;
  for (const platform of ['linux', 'darwin', 'win32']) {
    const help = menuTemplate(platform, { openSetup: () => { asked++; } }).find((m) => m.label === 'Help');
    help.submenu.find((i) => i.label === 'Setup wizard…').click();
  }
  assert.equal(asked, 3);
});
