import test from 'node:test';
import assert from 'node:assert/strict';
import { menuTemplate } from './app-menu.js';

const roles = (items) => items.flatMap((item) => [item.role, ...(item.submenu ? roles(item.submenu) : [])]).filter(Boolean);

test('the native menu leaves Ctrl +/−/0 to the reader on every platform', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const all = roles(menuTemplate(platform)).map((r) => r.toLowerCase());
    for (const zoom of ['zoomin', 'zoomout', 'resetzoom', 'viewmenu']) assert.ok(!all.includes(zoom), `${platform}: ${zoom}`);
    assert.ok(all.includes('editmenu') && all.includes('reload') && all.includes('toggledevtools'));
  }
  assert.equal(menuTemplate('darwin')[0].role, 'appMenu');
});
