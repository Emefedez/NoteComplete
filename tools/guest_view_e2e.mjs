// Browser check of a view-only sharing session (Chromium, after a web build): the guest sees
// the note and its notes (open, read-only), and a pen on the page says why nothing is drawn.
//   node tools/guest_view_e2e.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: 'view' });
const browser = await chromium.launch();
const info = { hostUrl: server.hostUrl, hostToken: server.hostToken, guestLink: server.guestLink, tabletLink: server.tabletLink(), address: server.address, port: server.port, ...server.code() };
const hc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await hc.addInitScript((info) => { window.notecompleteCollab = { start: async () => info, info: async () => info, stop: async () => {}, minimize: async () => {}, onEnded() {} }; }, info);
const host = await hc.newPage();
await host.goto(server.origin + '/'); await host.waitForFunction(() => !document.getElementById('open').disabled);
await host.setInputFiles('#file', fileURLToPath(new URL('../samples/nota_vacia.noteful', import.meta.url))); await host.waitForSelector('.sheet .render svg');
await host.evaluate(() => document.getElementById('shareSession').click()); await host.click('#collabDialog button.primary'); await host.waitForSelector('#collabTablet svg'); await host.click('#collabDialog .dialog-actions button.primary');
const guest = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
guest.on('pageerror', (e) => console.error('guest error:', e.message));
await guest.goto(server.guestLink); await guest.waitForSelector('.collab-name input'); await guest.press('.collab-name input', 'Enter');
await guest.waitForFunction(() => document.body.classList.contains('guest-readonly') && document.querySelector('.sheet .render svg'), null, { timeout: 20000 });
await sleep(800);
const s = await guest.locator('.sheet').first().boundingBox();
const cdp = await guest.context().newCDPSession(guest);
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x + 100, y: s.y + 100, button: 'left', clickCount: 1, pointerType: 'pen', force: 0.5 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x + 100, y: s.y + 100, button: 'left', clickCount: 1, pointerType: 'pen' });
await sleep(300);
const r = await guest.evaluate(() => ({ status: document.getElementById('status').textContent, notesVisible: !!document.getElementById('notesPanel').offsetParent, closable: getComputedStyle(document.getElementById('closeNotes')).display !== 'none', editable: document.querySelector('#notesEditor .TinyMDE')?.getAttribute('contenteditable'), tool: document.querySelector('.sheet').dataset.tool, items: document.querySelectorAll('.sheet [data-item]').length }));
assert.equal(r.notesVisible, true, 'the notes are shown');
assert.equal(r.closable, false, 'and stay open');
assert.equal(r.editable, 'false', 'read-only');
assert.match(r.status, /view-only/, 'a pen on the page says why nothing is drawn');
assert.equal(r.items, 0);
assert.equal(r.tool, 'pan');
console.log('Guest view-only end to end: passed.');
await browser.close(); await server.stop?.(); process.exit(0);
