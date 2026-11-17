// Browser check of View → Lag log…: turned on, a freeze while writing is written down with
// what was going on, the engine's slow answers too, and it is kept across a reload.
//   node tools/lag_log_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
try {
  const p = await b.newPage({ viewport: { width: 1200, height: 850 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await p.evaluate(() => document.getElementById('lagLogOpen').click());
  await p.waitForSelector('#lagLogDialog[open]');
  await p.check('#lagLogOn');
  await p.click('#lagLogClose');
  // A stroke, and the page held for 300 ms while the pen is down.
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const s = await p.locator('.sheet[data-page="0"]').boundingBox();
  await p.mouse.move(s.x + 100, s.y + 100);
  await p.mouse.down();
  await p.mouse.move(s.x + 160, s.y + 110, { steps: 4 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => { const t = performance.now(); while (performance.now() - t < 300); r(); })));
  await p.mouse.move(s.x + 220, s.y + 120, { steps: 4 });
  await p.mouse.up();
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('lagLogOpen').click());
  const text = await p.textContent('#lagLogText');
  assert.match(text, /freeze .*"writing":true/, text);
  assert.match(await p.textContent('#lagLogSummary'), /freezes over 100 ms/);
  await p.click('#lagLogClose');
  // Kept across a reload, and recording goes on.
  await p.reload();
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.evaluate(() => document.getElementById('lagLogOpen').click());
  assert.match(await p.textContent('#lagLogText'), /freeze/);
  assert.equal(await p.isChecked('#lagLogOn'), true);
  await p.uncheck('#lagLogOn');
  await p.click('#lagLogClear');
  assert.equal(await p.textContent('#lagLogText'), 'Nothing yet.');
  assert.deepEqual(errors, []);
  console.log('Lag log end to end: passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
