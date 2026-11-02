// Browser check that ink never blinks out (Chromium): quick strokes, like handwriting, stay
// on screen from the moment they are drawn until the page's render has them, while the
// engine answers slowly. Alone, on a PDF page and on a blank one; and in a sharing session,
// where each side also watches the other's strokes go from live line to render.
//   node tools/ink_continuity_e2e.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../apps/reader/', import.meta.url));
const sample = (name) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log('·', text);
const errors = [];
const STROKES = 15;
// Messages to the engine's worker are held back (window.slowEngine, in ms), so edits and
// renders take long enough for strokes to queue up, as on a slow device.
const slowEngine = () => {
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) {
    if (window.slowEngine) setTimeout(() => post.apply(this, args), window.slowEngine);
    else post.apply(this, args);
  };
};
// Cells on page 0, in fractions of the page: one stroke each, apart from one another.
const cells = (row) => Array.from({ length: STROKES }, (_, i) => [0.08 + (i % 8) * 0.1, row + Math.floor(i / 8) * 0.07]);
// Every frame, which cells show ink: a line in the overlay (own pending, being drawn, or
// another person's live line) or a rendered new stroke. A cell that showed ink and then
// shows none is a gap. Stops once every cell is rendered and nothing waits in the overlay.
function watch(cells) {
  const sheet = () => document.querySelector('.sheet[data-page="0"]');
  const w = window.inkWatch = { frames: 0, seen: new Set(), gaps: [], done: false };
  const frame = () => {
    w.frames++;
    const s = sheet(), box = s.getBoundingClientRect();
    const shown = [...s.querySelectorAll('.overlay polyline, .render [data-item^="new:"]')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
    const rendered = [...s.querySelectorAll('.render [data-item^="new:"]')].map((el) => el.getBoundingClientRect());
    const inside = (r, x, y) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2;
    let done = true;
    cells.forEach(([fx, fy], i) => {
      const x = box.left + fx * box.width, y = box.top + fy * box.height;
      const now = shown.some((r) => inside(r, x, y));
      if (now) w.seen.add(i);
      else if (w.seen.has(i)) w.gaps.push(`frame ${w.frames}: stroke ${i + 1} gone`);
      if (!rendered.some((r) => inside(r, x, y))) done = false;
    });
    if (done && !s.querySelector('.pending-ink, .remote-ink')) { w.done = true; w.seen = [...w.seen]; return; }
    requestAnimationFrame(frame);
  };
  frame();
}
// Quick strokes in the cells, like handwriting: short zigzags, in words with pauses of
// different lengths between them (a pause is when the page is redrawn).
async function write(p, cellList) {
  const box = await p.locator('.sheet[data-page="0"]').boundingBox();
  const pauses = [40, 40, 40, 40, 330, 30, 30, 260, 380, 30, 30, 300, 30, 420, 30];
  for (let i = 0; i < cellList.length; i++) {
    const [fx, fy] = cellList[i];
    const x = box.x + fx * box.width, y = box.y + fy * box.height;
    await p.mouse.move(x - 12, y - 10);
    await p.mouse.down();
    for (let j = 1; j <= 6; j++) await p.mouse.move(x - 12 + j * 4, y + (j % 2 ? 10 : -10));
    await p.mouse.up();
    await sleep(pauses[i % pauses.length]);
  }
}
async function settle(p, what) {
  await p.waitForFunction(() => window.inkWatch.done, null, { timeout: 20000 });
  const w = await p.evaluate(() => window.inkWatch);
  assert.deepEqual(w.gaps.slice(0, 5), [], `${what}: no stroke leaves the screen before it is rendered (${w.gaps.length} gaps)`);
  assert.ok(w.frames > 10, `${what}: watched over many frames (${w.frames})`);
  return w;
}
const pen = (p) => p.evaluate(() => document.querySelector('#toolbar [data-tool="draw"], [data-tool="draw"]').click());

const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', notes: 'edit', port: 0 });
const browser = await chromium.launch();
try {
  // Alone: a PDF page and a blank page.
  for (const file of ['Examen wuolah.noteful', 'nota_vacia.noteful']) {
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript(slowEngine);
    await p.goto(server.origin + '/');
    await p.waitForFunction(() => !document.getElementById('open').disabled);
    await p.setInputFiles('#file', sample(file));
    await p.waitForSelector('.sheet[data-page="0"] .render');
    await sleep(800);
    await pen(p);
    const mine = cells(0.2);
    await p.evaluate((c) => { window.slowEngine = 150; (new Function(`return (${c.watch})`)())(c.cells); }, { watch: watch.toString(), cells: mine });
    await write(p, mine);
    await settle(p, file);
    await p.evaluate(() => { window.slowEngine = 0; });
    assert.equal(await p.locator('.sheet[data-page="0"] .render [data-item^="new:"]').count(), STROKES, `${file}: every stroke saved`);
    step(`${file}: ${STROKES} quick strokes stay on screen until rendered`);
    await p.close();
  }

  // A sharing session: a host and a guest who can draw.
  const info = { hostUrl: server.hostUrl, hostToken: server.hostToken, guestLink: server.guestLink, tabletLink: server.tabletLink(), address: server.address, port: server.port, ...server.code() };
  const hostContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await hostContext.addInitScript((info) => {
    window.notecompleteCollab = { start: async () => info, info: async () => info, stop: async () => {}, minimize: async () => {}, onEnded() {} };
  }, info);
  await hostContext.addInitScript(slowEngine);
  const host = await hostContext.newPage();
  host.on('pageerror', (e) => errors.push('host: ' + e.message));
  await host.goto(server.origin + '/');
  await host.waitForFunction(() => !document.getElementById('open').disabled);
  await host.setInputFiles('#file', sample('Examen wuolah.noteful'));
  await host.waitForFunction(() => document.querySelectorAll('.sheet').length === 3);
  await host.evaluate(() => document.getElementById('shareSession').click());
  await host.click('#collabDialog button.primary');
  await host.waitForSelector('#collabTablet svg');
  await host.click('#collabDialog .dialog-actions button.primary');
  const guestContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await guestContext.addInitScript(slowEngine);
  const guest = await guestContext.newPage();
  guest.on('pageerror', (e) => errors.push('guest: ' + e.message));
  await guest.goto(server.guestLink);
  await guest.waitForSelector('.collab-name input');
  await guest.press('.collab-name input', 'Enter');
  await guest.waitForFunction(() => document.querySelectorAll('.sheet').length === 3 && document.querySelector('.sheet [data-item]') && !document.body.classList.contains('guest-mode'), null, { timeout: 20000 });
  // The notes panel opens for a guest; closed, the page has room for both rows of cells.
  await guest.evaluate(() => document.querySelector('.sheet[data-page="0"]').scrollIntoView());
  await host.evaluate(() => document.querySelector('.sheet[data-page="0"]').scrollIntoView());
  await sleep(1000);
  await pen(host);
  await pen(guest);
  step('a guest joined the host’s note');

  const start = async (p, all) => p.evaluate((c) => { window.slowEngine = 150; (new Function(`return (${c.watch})`)())(c.cells); }, { watch: watch.toString(), cells: all });
  const rows = [[0.12, 0.3], [0.45, 0.6]];
  // The guest writes while the host watches; then the host writes while the guest watches.
  for (const [writer, watcher, name, row] of [[guest, host, 'guest', rows[0][0]], [host, guest, 'host', rows[0][1]]]) {
    const list = cells(row);
    await start(watcher, list);
    await start(writer, list);
    await write(writer, list);
    await settle(writer, `${name}, writing`);
    await settle(watcher, `${name === 'guest' ? 'host' : 'guest'}, watching the ${name} write`);
    step(`the ${name} writes quickly: no stroke blinks out on either side`);
  }
  // Both at once, each in its own row.
  const hostCells = cells(rows[1][0]), guestCells = cells(rows[1][1]), both = [...hostCells, ...guestCells];
  await start(host, both);
  await start(guest, both);
  await Promise.all([write(host, hostCells), write(guest, guestCells)]);
  await settle(host, 'host, both writing');
  await settle(guest, 'guest, both writing');
  for (const p of [host, guest]) await p.evaluate(() => { window.slowEngine = 0; });
  const counts = await Promise.all([host, guest].map((p) => p.locator('.sheet[data-page="0"] .render [data-item^="new:"]').count()));
  assert.deepEqual(counts, [STROKES * 4, STROKES * 4], 'both copies have every stroke');
  step('host and guest write at once: every stroke stays on both screens until rendered');
  assert.deepEqual(errors, []);
  console.log('Ink continuity end to end: passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
