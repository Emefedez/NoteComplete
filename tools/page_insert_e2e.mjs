// Browser check of blank pages and moving between pages (Chromium, after a web build): the
// page's right-click menu and the pages sidebar's insert a blank page before or after; an
// item dragged off its page stays drawn over the next one until it is let go there.
//   node tools/page_insert_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(500);
  const pages = () => p.locator('.sheet').count();
  const n0 = await pages();
  const s0 = await p.locator('.sheet[data-page="0"]').boundingBox();
  await p.mouse.click(s0.x + 200, s0.y + 200, { button: 'right' });
  await p.click('.context-menu button:has-text("Insert blank page after")');
  await p.waitForFunction((n) => document.querySelectorAll('.sheet').length === n + 1, n0);
  await p.evaluate(() => document.querySelector('#pageList li, #pageList > *').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 })));
  await p.click('.context-menu button:has-text("Insert blank page before")');
  await p.waitForFunction((n) => document.querySelectorAll('.sheet').length === n + 2, n0);
  console.log('· blank page after (page menu) and before (pages sidebar)');

  // Draw a stroke near the bottom of page 1, select it and drag it onto page 2.
  for (let i = 0; i < 4; i++) {
    const r = await p.locator('.sheet[data-page="1"]').boundingBox();
    await p.mouse.move(600, 400); await p.mouse.wheel(0, r.y + r.height - 550); await sleep(400);
  }
  const s1 = await p.locator('.sheet[data-page="1"]').boundingBox();
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const y = s1.y + s1.height - 160;
  await p.mouse.move(s1.x + 200, y); await p.mouse.down(); await p.mouse.move(s1.x + 300, y + 20, { steps: 6 }); await p.mouse.up();
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="1"] [data-item^="new:"]').length === 1);
  await p.evaluate(() => document.querySelector('[data-tool=select]').click());
  const st = await p.locator('.sheet[data-page="1"] [data-item^="new:"]').boundingBox();
  const [cx, cy] = [st.x + st.width / 2, st.y + st.height / 2];
  await p.mouse.click(cx, cy);
  await p.waitForFunction(() => document.querySelector('.selection-overlay polygon'), null, { timeout: 10000 });
  await p.mouse.move(cx, cy); await p.mouse.down();
  await p.mouse.move(cx, cy + 260, { steps: 10 });
  await sleep(100);
  const mid = await p.evaluate(() => {
    const sheet = document.querySelector('.sheet[data-page="1"]'), el = sheet.querySelector('[data-item^="new:"]');
    return { cls: sheet.classList.contains('moving-items'), overflow: getComputedStyle(sheet.querySelector('.render > svg')).overflow, bottom: el.getBoundingClientRect().bottom, sheetBottom: sheet.getBoundingClientRect().bottom };
  });
  assert.ok(mid.cls && mid.overflow === 'visible' && mid.bottom > mid.sheetBottom, `drawn past its page while moved: ${JSON.stringify(mid)}`);
  await p.mouse.up();
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="2"] [data-item^="new:"]').length === 1);
  await sleep(500);
  assert.equal(await p.locator('.sheet[data-page="1"] [data-item^="new:"]').count(), 0, 'gone from its page');
  assert.equal(await p.locator('.sheet.moving-items').count(), 0);
  console.log('· an item dragged onto the next page stays drawn until let go there');
  assert.deepEqual(errors, []);
  console.log('Blank pages and moving between pages: OK');
} catch (e) { console.error(e); process.exitCode = 1; } finally { await b.close(); process.exit(process.exitCode || 0); }
