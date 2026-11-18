// Browser check (Chromium, after a web build): with the pen's colour picker still focused after
// a colour is chosen, Ctrl Z undoes and the tool keys (H) work; only text fields take the keys.
//   node tools/shortcut_focus_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
await p.locator('.sheet[data-page="0"] .render').waitFor(); await sleep(500);
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press('p'); await sleep(200);
const s = await p.locator('.sheet[data-page="0"]').boundingBox();
await p.mouse.move(s.x + 100, s.y + 100); await p.mouse.down();
for (let i = 1; i < 8; i++) await p.mouse.move(s.x + 100 + i * 15, s.y + 120);
await p.mouse.up(); await sleep(800);
const strokes = () => p.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] [data-item^="new:"]').length);
// The pen's colour picker keeps the focus after a colour is chosen.
await p.evaluate(() => { const c = document.getElementById('color'); c.focus(); c.value = '#246bce'; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); });
await p.keyboard.press('Control+z'); await sleep(600);
assert.equal(await strokes(), 0, 'Ctrl Z undoes with the colour picker focused');
await p.keyboard.press('h'); await sleep(200);
assert.equal(await p.evaluate(() => document.querySelector('button[data-tool][aria-pressed=true]')?.dataset.tool), 'highlight', 'H picks Highlight');
console.log('Keys after choosing a colour: OK');
await b.close(); process.exit(0);
