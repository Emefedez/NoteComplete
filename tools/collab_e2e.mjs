// End-to-end check of sharing in real browsers (docs/COLLABORATION.md): the desktop's
// sharing server, a host reader (with a stand-in for the desktop bridge), a drawing tablet
// with touch and a pressure-sensitive pen, and a notes guest. Needs a web build
// (python tools/build_web.py) and Playwright with Chromium:
//   node tools/collab_e2e.mjs [screenshots folder]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../apps/reader/', import.meta.url));
const sample = fileURLToPath(new URL('../samples/Examen wuolah.noteful', import.meta.url));
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const shot = (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
const step = (text) => console.log('·', text);

const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', notes: 'edit' });
const browser = await chromium.launch();
try {
  const info = { hostUrl: server.hostUrl, hostToken: server.hostToken, guestLink: server.guestLink, tabletLink: server.tabletLink(), address: server.address, port: server.port, ...server.code() };
  // The host: the reader with the desktop's sharing bridge.
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await hostContext.addInitScript((info) => {
    window.notecompleteCollab = { start: async () => info, info: async () => info, stop: async () => {}, minimize: async () => {}, onEnded() {} };
  }, info);
  const host = await hostContext.newPage();
  host.on('pageerror', (e) => console.error('host error:', e.message));
  await host.goto(server.origin + '/');
  await host.waitForFunction(() => !document.getElementById('open').disabled);
  await host.setInputFiles('#file', sample);
  await host.waitForFunction(() => document.querySelectorAll('.sheet').length === 3);
  step('host opened the note');
  await host.evaluate(() => document.getElementById('shareSession').click());
  await host.click('#collabDialog button.primary');
  await host.waitForSelector('#collabTablet svg');
  const code = (await host.textContent('.collab-code dd.code')).replace(/\D/g, '');
  assert.equal(code, info.code);
  await shot(host, 'host-share');
  await host.click('#collabDialog .dialog-actions button.primary');
  step('host shares: QR code and code ' + code);

  // The tablet: joins with the address and code, like the app does.
  const tabletContext = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const tablet = await tabletContext.newPage();
  tablet.on('pageerror', (e) => console.error('tablet error:', e.message));
  await tablet.goto(server.origin + '/');
  await tablet.waitForFunction(() => !document.getElementById('open').disabled);
  await tablet.evaluate(() => document.getElementById('joinTablet').click());
  await tablet.fill('.collab-join input[type=text]', `127.0.0.1:${server.port}`);
  await tablet.fill('.collab-join input[inputmode=numeric]', `${code.slice(0, 3)} ${code.slice(3)}`);
  await tablet.click('.collab-join button[type=submit]');
  await tablet.waitForFunction(() => document.body.classList.contains('tablet-mode') && document.querySelectorAll('.sheet').length === 3 && !document.body.classList.contains('tablet-waiting'));
  await tablet.waitForFunction(() => document.querySelector('.sheet [data-item]'));
  assert.equal(await tablet.isVisible('#commandBar'), false);
  assert.equal(await tablet.isVisible('#tabletDock'), true);
  await shot(tablet, 'tablet-joined');
  await host.waitForFunction(() => document.querySelectorAll('#collabPeopleBar .collab-chip').length === 2);
  step('tablet joined with the code; host shows it in the bar');

  const added = (page) => page.evaluate(() => document.querySelectorAll('.sheet [data-item^="new:"]').length);
  const box = await tablet.locator('.sheet').first().boundingBox();
  const cdp = await tabletContext.newCDPSession(tablet);
  const pen = (type, x, y, force) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force });
  const x0 = box.x + box.width * 0.3, y0 = box.y + 160;
  await pen('mousePressed', x0, y0, 0.2);
  for (let i = 1; i <= 12; i++) await pen('mouseMoved', x0 + i * 12, y0 + Math.sin(i / 2) * 10, 0.2 + i * 0.05);
  // Live: the stroke shows on the computer while it is being drawn.
  await host.waitForFunction(() => document.querySelector('.remote-ink')?.getAttribute('points')?.split(' ').length > 3);
  await shot(host, 'host-live');
  await pen('mouseReleased', x0 + 150, y0, 0.6);
  await host.waitForFunction(() => document.querySelectorAll('.sheet [data-item^="new:"]').length === 1);
  await tablet.waitForFunction(() => document.querySelectorAll('.sheet [data-item^="new:"]').length === 1);
  assert.equal(await host.evaluate(() => document.querySelectorAll('.remote-ink').length), 0);
  // The pen's pressure was kept: the stroke is drawn as a filled run of varying width.
  const variable = await host.evaluate(() => document.querySelector('.sheet [data-item^="new:"]').innerHTML);
  assert.match(variable, /<path|<polygon/);
  step('pen stroke with pressure: live on the computer, then saved there as an edit');

  // Highlighter and eraser from the dock; undo through the shared history.
  await tablet.click('#tabletDock [data-dock-tool=highlight]');
  await pen('mousePressed', x0, y0 + 80, 0.5);
  for (let i = 1; i <= 8; i++) await pen('mouseMoved', x0 + i * 15, y0 + 80, 0.5);
  await pen('mouseReleased', x0 + 120, y0 + 80, 0.5);
  await host.waitForFunction(() => document.querySelectorAll('.sheet [data-item^="new:"]').length === 2);
  await tablet.click('#tabletDock [data-dock-tool=erase]');
  await pen('mousePressed', x0 + 60, y0 + 60, 0.5);
  for (let i = 1; i <= 6; i++) await pen('mouseMoved', x0 + 60, y0 + 60 + i * 8, 0.5);
  await pen('mouseReleased', x0 + 60, y0 + 110, 0.5);
  await host.waitForFunction(() => document.querySelectorAll('.sheet [data-item^="new:"]').length === 1);
  await tablet.click('#tabletDock [aria-label=Undo]');
  await host.waitForFunction(() => document.querySelectorAll('.sheet [data-item^="new:"]').length === 2);
  step('highlighter, eraser and undo from the tablet reach the computer');

  // The computer keeps its own tools and view; its strokes reach the tablet.
  await host.evaluate(() => document.querySelector('[data-tool=draw]').click());
  const hostBox = await host.locator('.sheet').first().boundingBox();
  await host.mouse.move(hostBox.x + 100, hostBox.y + 300);
  await host.mouse.down();
  await host.mouse.move(hostBox.x + 200, hostBox.y + 320, { steps: 8 });
  await host.mouse.up();
  await tablet.waitForFunction(() => document.querySelectorAll('.sheet [data-item^="new:"]').length === 3);
  step('a stroke drawn on the computer appears on the tablet');

  // The tablet zooms its own view; the computer's stays where it was.
  const hostZoom = await host.inputValue('#zoomValue');
  await tablet.evaluate(() => {
    const viewport = document.getElementById('viewport');
    const touch = (id, x) => new Touch({ identifier: id, target: viewport, clientX: x, clientY: 500 });
    viewport.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(1, 300), touch(2, 400)], bubbles: true, cancelable: true }));
    viewport.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(1, 250), touch(2, 450)], bubbles: true, cancelable: true }));
    viewport.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
  });
  await tablet.waitForTimeout(400);
  assert.notEqual(await tablet.inputValue('#zoomValue'), 'Fit');
  assert.equal(await host.inputValue('#zoomValue'), hostZoom);
  step('pinch zooms the tablet only');

  assert.equal(await tablet.locator('.tablet-loader').count(), 0, 'the loading screen is gone once the note is on the tablet');
  await tablet.click('#tabletDock [aria-label="Move this bar to the other side"]');
  assert.equal(await tablet.getAttribute('#tabletDock', 'data-side'), 'right');
  await shot(tablet, 'tablet-right');
  await tablet.setViewportSize({ width: 390, height: 844 });
  await shot(tablet, 'phone');
  // Held upright the dock is a row: "the other side" is the bottom edge.
  const dock = await tablet.locator('#tabletDock').boundingBox();
  assert.ok(dock.y + dock.height <= 845 && dock.y > 700 && dock.width > 380, `dock along the bottom of an upright phone (${JSON.stringify(dock)})`);
  // Sideways it is a column on the right.
  await tablet.setViewportSize({ width: 844, height: 390 });
  const side = await tablet.locator('#tabletDock').boundingBox();
  assert.ok(side.x + side.width <= 845 && side.x > 700 && side.height > 380, `dock on the right of a sideways phone (${JSON.stringify(side)})`);
  // The pressure switch is in the dock and follows the Pen's setting.
  await tablet.click('#tabletDock .dock-pressure');
  assert.equal(await tablet.inputValue('#pressure'), 'off');
  assert.equal(await tablet.getAttribute('#tabletDock .dock-pressure', 'aria-pressed'), 'false');
  await tablet.click('#tabletDock .dock-pressure');
  await tablet.setViewportSize({ width: 390, height: 844 });
  step('the dock moves to the other side, lies along the long edge, and switches pressure');

  // A notes guest: name prompt, typing together, presence.
  const guestContext = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const guest = await guestContext.newPage();
  guest.on('pageerror', (e) => console.error('guest error:', e.message));
  await guest.goto(server.guestLink);
  await guest.waitForSelector('.collab-name input');
  assert.equal(await guest.inputValue('.collab-name input'), 'Guest 1');
  await guest.fill('.collab-name input', 'Ana');
  await guest.press('.collab-name input', 'Enter');
  await guest.waitForSelector('#notesEditor .TinyMDE');
  // The guest sees the note itself too, live, not only its notes.
  await guest.waitForFunction(() => document.querySelectorAll('.sheet').length === 3 && document.querySelector('.sheet [data-item]'), null, { timeout: 20000 });
  await guest.click('#notesEditor .TinyMDE');
  await guest.keyboard.type('Hola desde Ana');
  await host.evaluate(() => document.getElementById('notesToggle').click());
  await host.waitForFunction(() => document.querySelector('#notesEditor .TinyMDE')?.textContent.includes('Hola desde Ana'));
  await host.waitForFunction(() => [...document.querySelectorAll('#collabPeopleBar .collab-chip')].some((c) => c.title.startsWith('Ana')));
  await host.waitForFunction(() => document.querySelector('.notes-caret span')?.textContent === 'Ana');
  await shot(host, 'host-notes');
  await shot(guest, 'guest');
  step('a guest named Ana writes the notes; the host sees the text, her chip and her cursor');

  // Disconnecting the tablet is clean on both sides.
  await tablet.click('#tabletDock [aria-label=Disconnect]');
  await tablet.waitForFunction(() => !document.body.classList.contains('tablet-mode') && !document.querySelector('.sheet'));
  await host.waitForFunction(() => ![...document.querySelectorAll('#collabPeopleBar .collab-chip')].some((c) => c.title.includes('drawing tablet')));
  assert.equal(await added(host), 3);
  step('the tablet disconnects; the computer keeps every edit');

  // Ending: the guest keeps a copy; the host keeps the notes.
  const download = guest.waitForEvent('download');
  // Share in the bar says Sharing while the session runs, and opens it.
  assert.equal((await host.textContent('#shareButton')).trim(), 'Sharing');
  await host.click('#shareButton');
  await host.click('#collabDialog button.danger');
  assert.match((await download).suggestedFilename(), /shared notes\.md$/);
  await guest.waitForSelector('#collabDialog h2:text("Session ended")');
  await host.waitForFunction(() => !document.getElementById('collabPeopleBar') && document.getElementById('shareButton').textContent.trim() === 'Share');
  step('ending the session saves a copy for the guest');
  console.log('Sharing end to end: passed.');
} finally {
  await browser.close();
  await server.stop();
}
