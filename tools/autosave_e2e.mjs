// Browser check of auto-save (Chromium): an edited note is copied into an automatic slot;
// reopening its file asks whether to open the automatic save or the file, and the
// automatic save brings the edit back, unsaved; File lists the slots; a manual save stops
// the question; the switch turns it off.
//   node tools/autosave_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const server = await startReader({ port: 0 });
const b = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sample = samplePath('nota_1linea.noteful');
try {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  const items = () => p.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length);
  const open = async () => {
    await p.setInputFiles('#file', sample);
    await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length > 0);
  };
  await open();
  const before = await items();
  assert.equal(await p.getAttribute('#autosaveToggle', 'aria-checked'), 'true', 'on by default');
  // Draw a stroke, then leave the page: a copy goes into a slot.
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const s = await p.locator('.sheet').first().boundingBox();
  await p.mouse.move(s.x + 100, s.y + 100); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(s.x + 100 + i * 15, s.y + 120);
  await p.mouse.up();
  await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length > n, before);
  await p.evaluate(() => dispatchEvent(new Event('pagehide')));
  await sleep(800);
  await p.click('#fileMenu > summary');
  await p.waitForSelector('#autosaveList button');
  assert.match(await p.textContent('#autosaveList'), /Automatic saves.*Today/s);
  await p.keyboard.press('Escape');
  console.log('· an edited note is copied into an automatic slot, listed in File');
  // Reopen the file (discarding the unsaved edit): it asks; the automatic save brings it back.
  p.once('dialog', (d) => d.accept());
  await open();
  await p.waitForSelector('#recoverDialog[open]');
  assert.match(await p.textContent('#recoverText'), /newer than the file you opened/);
  assert.equal(await items(), before, 'the file as saved');
  await p.click('#recoverAuto');
  await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length > n, before);
  assert.equal(await p.evaluate(() => document.getElementById('saveState').classList.contains('dirty')), true, 'recovered, unsaved');
  console.log('· reopening asks; the automatic save brings the edit back, unsaved');
  // A manual save: no question next time.
  const download = p.waitForEvent('download');
  await p.keyboard.press('Control+s');
  await download;
  await sleep(300);
  p.once('dialog', (d) => d.accept());
  await open();
  await sleep(800);
  assert.equal(await p.locator('#recoverDialog[open]').count(), 0, 'no question after a manual save');
  console.log('· after a manual save it does not ask');
  // The switch: off, nothing is copied.
  await p.click('#fileMenu > summary');
  await p.click('#autosaveToggle');
  assert.equal(await p.getAttribute('#autosaveToggle', 'aria-checked'), 'false');
  await p.keyboard.press('Escape');
  const count = await p.evaluate(async () => (await (await import('./autosave.js')).autosaveStore().list()).length);
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  await p.mouse.move(s.x + 100, s.y + 200); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(s.x + 100 + i * 15, s.y + 220);
  await p.mouse.up();
  await sleep(400);
  await p.evaluate(() => dispatchEvent(new Event('pagehide')));
  await sleep(800);
  assert.equal(await p.evaluate(async () => (await (await import('./autosave.js')).autosaveStore().list()).length), count, 'off: no new slot');
  console.log('· turned off, nothing is copied');
  assert.deepEqual(errors, []);
  console.log('Auto-save end to end: passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
