import test from 'node:test';
import assert from 'node:assert/strict';
import { menuTemplate, uiZoomStep } from './app-menu.js';

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
