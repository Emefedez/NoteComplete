// Browser check of a tab's right-click menu in the web app's tabs (tabs.html): on the open
// note's tab it offers save, export and share; on another tab, switching to it; and New tab
// and Close tab work from it.
//   node tools/tab_menu_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { chromium, startReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
try {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${server.origin}/tabs.html`);
  const reader = async () => {
    await p.waitForFunction(() => [...document.querySelectorAll('iframe')].some((f) => f.offsetParent && f.contentDocument?.getElementById('file')));
    const handle = await p.evaluateHandle(() => [...document.querySelectorAll('iframe')].find((f) => f.offsetParent));
    return handle.asElement().contentFrame();
  };
  let f = await reader();
  f.page().on('pageerror', (e) => errors.push(e.message));
  await f.waitForFunction(() => !document.getElementById('open').disabled);
  await f.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await f.waitForSelector('.sheet[data-page="0"] .render');
  await f.waitForSelector('#tabStrip .tab.current');
  const entries = async () => (await f.locator('.context-menu button span').allTextContents());
  await f.click('#tabStrip .tab.current', { button: 'right' });
  await f.waitForSelector('.context-menu');
  const own = await entries();
  for (const e of ['Save', 'Export', 'Share by QR or link…', 'New tab', 'Close tab']) assert.ok(own.includes(e), `this tab: ${own}`);
  assert.ok(!own.includes('Switch to this tab'), 'no switching to itself');
  await f.hover('.context-menu:not(.context-submenu) button:has-text("Export")');
  await f.waitForSelector('.context-submenu');
  const exp = await f.locator('.context-submenu button span').allTextContents();
  assert.ok(exp.some((e) => /PDF/.test(e)) && exp.some((e) => /nfedit/.test(e)), `export: ${exp}`);
  if (DIR) await p.screenshot({ path: DIR + 'tab-menu.png' });
  // New tab from the menu: two tabs.
  await f.click('.context-menu:not(.context-submenu) button:has-text("New tab")');
  await p.waitForFunction(() => document.querySelectorAll('iframe').length === 2);
  f = await reader();
  await f.waitForFunction(() => document.querySelectorAll('#tabStrip .tab').length === 2);
  // Ctrl + 1 and Ctrl + 2 go to the first and the second tab.
  const shown = () => p.evaluate(() => [...document.querySelectorAll('iframe')].findIndex((fr) => fr.offsetParent));
  assert.equal(await shown(), 1, 'the new tab is shown');
  await f.locator('body').press('Control+1');
  await p.waitForFunction(() => [...document.querySelectorAll('iframe')].findIndex((fr) => fr.offsetParent) === 0);
  f = await reader();
  await f.locator('body').press('Control+9');
  await p.waitForFunction(() => [...document.querySelectorAll('iframe')].findIndex((fr) => fr.offsetParent) === 1);
  f = await reader();
  console.log('· Ctrl + 1 goes to the first tab, Ctrl + 9 to the last');
  // In the new tab, the other tab's menu: switch to it, and no save or export for it.
  await f.click('#tabStrip .tab:not(.current)', { button: 'right' });
  await f.waitForSelector('.context-menu');
  const other = await entries();
  assert.ok(other.includes('Switch to this tab') && !other.includes('Save') && !other.includes('Export'), `other tab: ${other}`);
  await f.click('.context-menu button:has-text("Close tab")');
  await f.waitForFunction(() => document.querySelectorAll('#tabStrip .tab').length === 1);
  assert.deepEqual(errors, []);
  console.log('tab right-click menu: OK');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
