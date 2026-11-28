// Browser check of animated pictures (Chromium, after a web build): a GIF opened as a document
// is drawn from its own GIF bytes (so it still moves), and the same GIF pasted into a Markdown
// document goes in as a data:image/gif picture.
//   node tools/gif_import_e2e.mjs path/to/animated.gif
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, startReader, openReader } from './e2e_common.mjs';
const gifPath = process.argv[2];
if (!gifPath) throw Error('usage: node tools/gif_import_e2e.mjs animated.gif');
const gif = await readFile(gifPath);
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
await openReader(p, server.origin);
await p.setInputFiles('#file', gifPath);
await p.waitForFunction(() => document.querySelector('.sheet image')?.getAttribute('href')?.length > 0, null, { timeout: 20000 });
const href = await p.evaluate(() => document.querySelector('.sheet image').getAttribute('href'));
assert.equal(href, 'data:image/gif;base64,' + gif.toString('base64'));
console.log('· the opened GIF is drawn from its own bytes');
const md = await p.evaluate(async (b64) => {
  const { pictureMarkdown } = await import('./md-pictures.js');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return pictureMarkdown(new File([bytes], 'moving.gif', { type: 'image/gif' }));
}, gif.toString('base64'));
assert.equal(md, `![moving](data:image/gif;base64,${gif.toString('base64')})`);
console.log('· a GIF put into Markdown keeps its bytes');
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('GIF import end to end: passed.');
