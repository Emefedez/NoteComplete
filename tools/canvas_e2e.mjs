// Browser check of the infinite canvas (Chromium, after a web build): New document →
// Infinite canvas, ink near the right edge grows the page (undo shrinks it back after
// the stroke), it is never a .noteful (Noteful is off in the dialog and the NF exports),
// and a .notecomp keeps it a canvas.
//   node tools/canvas_e2e.mjs [screenshots folder]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
(async () => {
  const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(server.origin + '/');
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  await p.evaluate(() => document.getElementById('newDocument').click());
  await p.waitForSelector('#newDialog[open]');
  await p.fill('#newName', 'Mapa');
  await p.check('[name="newFormat"][value="noteful"]');
  await p.check('[name="newKind"][value="canvas"]');
  // Noteful has no infinite page: that format is off, and the choice moves to NoteComplete.
  assert.equal(await p.isDisabled('[name="newFormat"][value="noteful"]'), true);
  assert.equal(await p.isChecked('[name="newFormat"][value="notecomplete"]'), true);
  assert.equal(await p.isVisible('#newCount'), false);
  assert.equal(await p.isVisible('#newPreset'), false);
  if (DIR) await p.screenshot({ path: DIR + 'new.png' });
  await p.click('#newCreate');
  await p.waitForFunction(() => document.querySelectorAll('.sheet').length === 1 && document.getElementById('title').textContent === 'Mapa');
  const width = () => p.evaluate(() => { const r = document.querySelector('.sheet').getBoundingClientRect(); return r.width / r.height; });
  const before = await width();
  // Ink near the right edge.
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const s = await p.locator('.sheet').first().boundingBox();
  await p.mouse.move(s.x + s.width * 0.5, s.y + s.height * 0.3); await p.mouse.down();
  await p.mouse.move(s.x + s.width * 0.97, s.y + s.height * 0.35, { steps: 8 });
  await p.mouse.up();
  await p.waitForFunction((r) => { const b = document.querySelector('.sheet').getBoundingClientRect(); return b.width / b.height > r + 0.1; }, before);
  assert.equal(await p.locator('.sheet [data-item]').count() >= 1, true);
  console.log('· the canvas grew to the right');
  if (DIR) await p.screenshot({ path: DIR + 'grown.png' });
  // Undo takes the stroke away first, then the growth.
  await p.evaluate(() => document.getElementById('undo').click());
  await p.waitForFunction(() => document.querySelectorAll('.sheet [data-item]').length === 0);
  assert.ok(await width() > before + 0.1);
  await p.evaluate(() => document.getElementById('undo').click());
  await p.waitForFunction((r) => { const b = document.querySelector('.sheet').getBoundingClientRect(); return Math.abs(b.width / b.height - r) < 0.01; }, before);
  await p.evaluate(() => document.getElementById('redo').click());
  await p.evaluate(() => document.getElementById('redo').click());
  await p.waitForFunction(() => document.querySelectorAll('.sheet [data-item]').length >= 1);
  console.log('· undo/redo step through the stroke and the growth');
  // Ink near the bottom, scrolled down: the canvas grows down and the view stays put.
  await p.evaluate(() => { const v = document.getElementById('viewport'); v.scrollTop = v.scrollHeight; });
  const top = await p.evaluate(() => document.getElementById('viewport').scrollTop);
  const tall = await p.evaluate(() => document.getElementById('pages').scrollHeight);
  const t = await p.locator('.sheet').first().boundingBox();
  await p.mouse.move(t.x + t.width * 0.2, t.y + t.height * 0.9); await p.mouse.down();
  await p.mouse.move(t.x + t.width * 0.3, t.y + t.height * 0.97, { steps: 6 });
  await p.mouse.up();
  await p.waitForFunction((h) => document.getElementById('pages').scrollHeight > h + 50, tall);
  assert.equal(await p.evaluate(() => document.getElementById('viewport').scrollTop), top);
  assert.doesNotMatch(await p.textContent('#status'), /pages\./);
  console.log('· the canvas grew down without moving the view');
  if (DIR) await p.screenshot({ path: DIR + 'down.png' });
  // No Noteful export for a canvas; NoteComplete keeps it infinite.
  assert.equal(await p.isDisabled('#native'), true);
  assert.equal(await p.isDisabled('#nativeMarkdown'), true);
  assert.equal(await p.isDisabled('#insertBlank'), true);
  const [download] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => document.getElementById('exportNotecomplete').click())]);
  assert.match(download.suggestedFilename(), /\.notecomp$/);
  const bytes = readFileSync(await download.path());
  await p.evaluate(async (data) => {
    document.querySelector('.sheet').dataset.old = '1';
    const input = document.getElementById('file');
    const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(data)], 'Mapa 2.notecomp')); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [...bytes]);
  await p.waitForFunction(() => !document.querySelector('.sheet[data-old]') && document.querySelectorAll('.sheet [data-item]').length >= 2, null, { timeout: 15000 });
  assert.equal(await p.locator('.sheet').count(), 1);
  assert.equal(await p.isDisabled('#native'), true);
  console.log('· a .notecomp reopens as a canvas; Noteful exports stay off');
  assert.deepEqual(errors, []);
  await b.close(); await server.stop();
  console.log('Infinite canvas end to end: passed.');
})().catch(e => { console.error(e); process.exit(1); });
