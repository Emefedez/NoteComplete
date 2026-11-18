// Browser check of copied items as a picture that keeps them (Chromium, after a web build): a
// prefab is inserted, selected and copied with Ctrl C; the desktop's clipboard bridge (stubbed
// here, as the desktop app hands it the PNG) gets a PNG carrying the prefab (png-clip.js). In a
// fresh reader, with no copy of its own, that PNG pasted, dropped and imported with Insert
// image comes back as an editable prefab each time (its menu has "Edit number line…").
//   node tools/png_clip_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
import { readClipChunk } from '../apps/reader/png-clip.js';

const DIR = process.argv[2] || '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const images = (p) => p.locator('.sheet[data-page="0"] .render [data-item^="image:"]');
async function openNote(p) {
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.locator('.sheet[data-page="0"] .render').waitFor(); await sleep(500);
}
async function editEntry(p, n) {
  const box = await images(p).nth(n).boundingBox();
  await p.keyboard.press('Escape');
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await p.locator('.context-menu').waitFor();
  const entries = await p.locator('.context-menu button span').allTextContents();
  await p.keyboard.press('Escape');
  await p.locator('.context-menu').waitFor({ state: 'detached' });
  return entries;
}
try {
  // The copy, with the desktop's bridge stubbed.
  const a = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  await a.addInitScript(() => { window.notecompleteClipboard = { writePng: async (bytes, text) => { window.__clipPng = { bytes: Array.from(bytes), text }; } }; });
  await openNote(a);
  await a.evaluate(() => document.getElementById('insertGraph').click());
  await a.locator('.prefab-grid').waitFor();
  await a.click('.prefab-card:has(strong:text-is("Number line"))');
  await a.locator('.pk-dialog .pk-canvas svg').waitFor();
  await a.fill('.pk-panel .pk-field:has-text("Title") input', 'Copiada');
  await a.click('.pk-dialog button:has-text("Insert")');
  await a.locator('.pk-dialog').waitFor({ state: 'detached' });
  await images(a).first().locator('image').waitFor({ state: 'attached' });
  await sleep(300);
  await a.evaluate(() => document.querySelector('[data-tool=select]').click());
  const box = await images(a).first().boundingBox();
  await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await a.waitForSelector('.selection-overlay');
  await a.keyboard.press('Control+c');
  await a.waitForFunction(() => window.__clipPng && /Copied/.test(document.body.innerText));
  const sent = await a.evaluate(() => window.__clipPng);
  assert.equal(sent.text, 'NoteComplete items (paste them in NoteComplete)');
  const png = Uint8Array.from(sent.bytes);
  const carried = await readClipChunk(png);
  assert.equal(carried.images.length, 1);
  assert.equal(carried.images[0].part?.kind, 'prefab');
  assert.match(carried.lines.find((l) => l.part?.spec)?.part.spec || '', /Copiada/, 'the spec, on its frame');
  console.log(`· Ctrl C: a ${png.length}-byte PNG carrying the prefab, with the marker text, to the desktop clipboard`);

  // A fresh reader: no copy of its own.
  const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
  await openNote(p);
  const s = await p.locator('.sheet[data-page="0"]').boundingBox();
  await p.mouse.move(s.x + 300, s.y + 300);
  const b64 = Buffer.from(png).toString('base64');
  // Pasted (as from another app: the picture only).
  await p.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, b64);
  await p.waitForFunction(() => /Pasted from a NoteComplete picture/.test(document.body.innerText));
  await images(p).first().waitFor({ state: 'attached' });
  assert.equal(await images(p).count(), 1);
  assert.ok((await editEntry(p, 0)).includes('Edit number line…'), 'an editable prefab');
  console.log('· pasted in a fresh reader: an editable prefab again');
  if (DIR) await p.screenshot({ path: DIR + '/pasted.png' });
  // Dropped.
  await p.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), data = new DataTransfer();
    data.items.add(new File([bytes], 'copied.png', { type: 'image/png' }));
    document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, b64);
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="image:"]').length === 2);
  assert.ok((await editEntry(p, 1)).includes('Edit number line…'));
  console.log('· dropped: an editable prefab');
  // Insert image.
  await p.setInputFiles('#imageFile', { name: 'copied.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="image:"]').length === 3);
  assert.ok((await editEntry(p, 2)).includes('Edit number line…'));
  // Its spec came back: the editor shows the title.
  const last = await images(p).nth(2).boundingBox();
  await p.mouse.click(last.x + last.width / 2, last.y + last.height / 2, { button: 'right' });
  await p.click('.context-menu button:has-text("Edit number line")');
  await p.locator('.pk-dialog .pk-canvas svg').waitFor();
  assert.equal(await p.inputValue('.pk-panel .pk-field:has-text("Title") input'), 'Copiada');
  await p.keyboard.press('Escape');
  console.log('· imported with Insert image: an editable prefab, its spec intact');
  // A plain PNG still imports as a picture.
  const plain = await p.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 40, height: 20 });
    c.getContext('2d').fillRect(0, 0, 40, 20);
    return Array.from(new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer()));
  });
  await p.setInputFiles('#imageFile', { name: 'plain.png', mimeType: 'image/png', buffer: Buffer.from(plain) });
  await p.waitForFunction(() => /Image imported/.test(document.body.innerText));
  assert.equal(await images(p).count(), 4);
  console.log('· a PNG without the chunk imports as a picture');
  assert.deepEqual(errors, []);
  console.log('PNG clip: OK');
} finally {
  await b.close();
  await server.stop();
}
