// Browser check of files handed over by the system to the installed web app (Chromium,
// after a web build): launchQueue (file_handlers in the manifest), before and after the
// engine is ready, and the share target (a POST through sw.js).
//   node tools/open_with_e2e.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const note = readFileSync(new URL('../samples/nota_1linea.noteful', import.meta.url));
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null });
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  // Chromium calls the consumer as soon as it is set, usually before the engine is ready.
  // Chromium has its own launchQueue (a getter), so the mock is defined, not assigned.
  await p.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(consumer) {
      window.launch = consumer;
      consumer({ files: [{ kind: 'file', getFile: async () => new File(['# Apuntes\n\nTexto *abierto* desde el sistema.\n'], 'Apuntes.md', { type: 'text/markdown' }) }] });
    } } });
  });
  await p.goto(server.origin + '/');
  await p.waitForFunction(() => !document.getElementById('textView').hidden && document.getElementById('textTitle').textContent === 'Apuntes', null, { timeout: 20000 });
  assert.equal(await p.textContent('#textBody h1'), 'Apuntes');
  console.log('· a Markdown file from launchQueue opened before the engine was ready');

  // A later launch into the same window (focus-existing): a Noteful note.
  await p.evaluate((bytes) => window.launch({ files: [{ kind: 'file', getFile: async () => new File([new Uint8Array(bytes)], 'Nota.noteful') }] }), [...note]);
  await p.waitForFunction(() => document.querySelectorAll('.sheet').length > 0 && document.getElementById('textView').hidden, null, { timeout: 20000 });
  console.log('· a .noteful from a later launch opened as a note');

  // Share target: the service worker takes the POST and the page it opens shows the file.
  const share = await ctx.newPage();
  share.on('pageerror', (e) => errors.push(e.message));
  await share.goto(server.origin + '/');
  await share.evaluate(() => navigator.serviceWorker.ready);
  await share.reload();
  await share.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
  await share.waitForFunction(() => !document.getElementById('open').disabled);
  await share.evaluate(() => {
    const form = Object.assign(document.createElement('form'), { method: 'POST', action: './share-target', enctype: 'multipart/form-data' });
    const input = Object.assign(document.createElement('input'), { type: 'file', name: 'file' });
    const data = new DataTransfer();
    data.items.add(new File(['a,b\n1,2\n'], 'Tabla.csv', { type: 'text/csv' }));
    input.files = data.files;
    form.append(input);
    document.body.append(form);
    form.submit();
  });
  await share.waitForFunction(() => document.getElementById('textTitle')?.textContent === 'Tabla' && !document.getElementById('textView').hidden, null, { timeout: 20000 });
  assert.equal(new URL(share.url()).search, '', 'the ?shared=1 marker is removed');
  assert.deepEqual(await share.$$eval('#textBody th', (els) => els.map((e) => e.textContent)), ['a', 'b']);
  assert.equal(await share.evaluate(() => caches.has('notecomplete-shared')), false, 'shared files do not stay in CacheStorage');
  console.log('· a CSV shared to the app opened through the service worker');
  assert.deepEqual(errors, []);
  console.log('open_with_e2e: ok');
} finally {
  await b.close();
  await server.stop();
}
