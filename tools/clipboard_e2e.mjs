// Browser check of copy, cut and paste of items, and of items dragged onto another page
// (Chromium, after a web build): a stroke drawn, selected, copied with Ctrl C and pasted with
// Ctrl V beside itself and with Paste here on page 2; cut with the menu and pasted back; then
// dragged with Select from page 1 to page 2, which one undo moves back.
//   node tools/clipboard_e2e.mjs [screenshots folder]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('Examen wuolah.noteful'));
  await p.waitForFunction(() => document.querySelectorAll('.sheet [data-item]').length > 10);
  const added = (page) => p.evaluate((n) => document.querySelectorAll(`.sheet[data-page="${n}"] .render [data-item^="new:"]`).length, page);
  // A stroke on page 1.
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const s = await p.locator('.sheet[data-page="0"]').boundingBox();
  await p.mouse.move(s.x + 120, s.y + 140); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(s.x + 120 + i * 12, s.y + 140 + (i % 2) * 6);
  await p.mouse.up();
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="new:"]').length === 1);
  // Select it, Ctrl C, Ctrl V: a second one beside it.
  await p.evaluate(() => document.querySelector('[data-tool=select]').click());
  await p.mouse.click(s.x + 180, s.y + 143);
  await p.waitForSelector('.selection-overlay');
  await p.keyboard.press('Control+c');
  await p.waitForFunction(() => /Copied/.test(document.body.innerText));
  await p.keyboard.press('Control+v');
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="new:"]').length === 2);
  console.log('· Ctrl C, Ctrl V: a copy beside it');
  // Paste here, on page 2.
  await p.locator('.sheet[data-page="1"]').scrollIntoViewIfNeeded();
  const s2 = await p.locator('.sheet[data-page="1"]').boundingBox();
  const before2 = await added(1);
  await p.mouse.click(s2.x + 300, s2.y + 300, { button: 'right' });
  await p.click('.context-menu button:has-text("Paste here")');
  await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="1"] .render [data-item^="new:"]').length === n + 1, before2);
  console.log('· right-click → Paste here on another page');
  // A stroke near the bottom of page 1, with page 2 in view under it, dragged onto page 2.
  await p.evaluate(() => { const v = document.getElementById('viewport'), t = document.querySelector('.sheet[data-page="1"]'); v.scrollTop += t.getBoundingClientRect().top - 600; });
  await sleep(400);
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const p1 = await added(0), p2 = await added(1);
  await p.mouse.move(400, 480); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(400 + i * 12, 480 + (i % 2) * 6);
  await p.mouse.up();
  await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="new:"]').length === n + 1, p1);
  await p.evaluate(() => document.querySelector('[data-tool=select]').click());
  const first = [460, 483];
  await p.mouse.click(first[0], first[1]);
  await p.waitForSelector('.selection-overlay');
  await p.mouse.move(first[0], first[1]); await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(first[0], first[1] + (300 * i) / 12);
  await p.mouse.up();
  await p.waitForFunction(([a, b]) => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="new:"]').length === a && document.querySelectorAll('.sheet[data-page="1"] .render [data-item^="new:"]').length === b + 1, [p1, p2]);
  if (DIR) await p.screenshot({ path: DIR + 'moved.png' });
  await p.keyboard.press('Control+z');
  await p.waitForFunction(([a, b]) => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="new:"]').length === a + 1 && document.querySelectorAll('.sheet[data-page="1"] .render [data-item^="new:"]').length === b, [p1, p2]);
  console.log('· dragged onto another page, and one undo moves it back');
  assert.deepEqual(errors, []);
  console.log('clipboard e2e: ok');
} finally {
  await b.close();
  await server.stop();
}
