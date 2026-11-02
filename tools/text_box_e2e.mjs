// Browser check of typed text boxes (Chromium): Esc keeps what was typed, Shift + Esc and
// the × at the box's corner throw it away.
//   node tools/text_box_e2e.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null, port: 0 });
const b = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(server.origin + '/');
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.setInputFiles('#file', fileURLToPath(new URL('../samples/nota_vacia.noteful', import.meta.url)));
  await p.waitForSelector('.sheet');
  await sleep(500);
  const texts = () => p.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] [data-item^="image:"]').length);
  await p.evaluate(() => document.querySelector('[data-tool=text]').click());
  const s = await p.locator('.sheet').first().boundingBox();
  const type = async (y, words) => {
    await sleep(500);
    await p.mouse.click(s.x + 120, s.y + y);
    await p.waitForSelector('.text-editor');
    await p.keyboard.type(words);
  };
  await type(120, 'Kept by Esc');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('.text-editor'));
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] [data-item^="image:"]').length === 1);
  console.log('· Esc keeps the text');
  await type(220, 'Thrown away');
  await p.keyboard.press('Shift+Escape');
  await p.waitForFunction(() => !document.querySelector('.text-editor'));
  await sleep(400);
  assert.equal(await texts(), 1, 'Shift + Esc discards');
  await type(320, 'Also thrown away');
  assert.ok(await p.isVisible('.text-discard'), 'the × shows at the corner');
  await p.click('.text-discard');
  await p.waitForFunction(() => !document.querySelector('.text-editor, .text-discard'));
  await sleep(400);
  assert.equal(await texts(), 1, 'the × discards');
  console.log('· Shift + Esc and the × discard');
  assert.deepEqual(errors, []);
  console.log('Text box end to end: passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
