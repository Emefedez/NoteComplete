// End-to-end check of sharing in real browsers (docs/COLLABORATION.md): the desktop's
// sharing server, a host reader (with a stand-in for the desktop bridge), a drawing tablet
// with touch and a pressure-sensitive pen, and a notes guest. Needs a web build
// (python tools/build_web.py) and Playwright with Chromium:
//   node tools/collab_e2e.mjs [screenshots folder]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const sample = samplePath('Examen wuolah.noteful');
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const shot = (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
const step = (text) => console.log('·', text);

const server = await startReader({ notes: 'edit' });
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
  await openReader(host, server.origin);
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
  // A stand-in for the on-screen keyboard: keyboardOpens(px) takes px off the bottom of the
  // visual viewport, as a phone's keyboard does (headless Chromium shows none).
  await tabletContext.addInitScript(() => {
    const real = window.visualViewport;
    if (!real) return;
    let cut = 0;
    const fake = new EventTarget();
    for (const key of ['width', 'offsetLeft', 'offsetTop', 'pageLeft', 'pageTop', 'scale']) Object.defineProperty(fake, key, { get: () => real[key] });
    Object.defineProperty(fake, 'height', { get: () => real.height - cut });
    real.addEventListener('resize', () => fake.dispatchEvent(new Event('resize')));
    Object.defineProperty(window, 'visualViewport', { get: () => fake, configurable: true });
    window.keyboardOpens = (px) => { cut = px; fake.dispatchEvent(new Event('resize')); };
  });
  const tablet = await tabletContext.newPage();
  tablet.on('pageerror', (e) => console.error('tablet error:', e.message));
  await openReader(tablet, server.origin);
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

  // Tape from the dock: the tape's colours and widths replace the pen's while it is chosen.
  await tablet.click('#tabletDock [data-dock-tool=tape]');
  assert.equal(await tablet.isVisible('#tabletDock .dock-tape'), true, 'tape settings show');
  assert.equal(await tablet.locator('#tabletDock .dock-ink .dock-swatch').first().isHidden(), true, 'the pen colours hide for tape');
  await tablet.click('#tabletDock .dock-tape .dock-width[data-width="64"]');
  assert.equal(await tablet.inputValue('#width'), '64');
  await tablet.locator('#tabletDock .dock-tape .dock-swatch').nth(1).click();
  assert.equal(await tablet.inputValue('#color'), '#ffdf38');
  await tablet.click('#tabletDock .dock-tape [data-tape-mode=band]');
  await shot(tablet, 'tablet-tape');
  const tapes = (page) => page.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] [data-tape^="new:"]').length);
  const ty = y0 + 320;
  await pen('mousePressed', x0, ty, 0.5);
  for (let i = 1; i <= 10; i++) await pen('mouseMoved', x0 + i * 20, ty, 0.5);
  await pen('mouseReleased', x0 + 200, ty, 0.5);
  await host.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] [data-tape^="new:"]').length === 1);
  await tablet.waitForFunction(() => document.querySelector('.sheet[data-page="0"] [data-tape^="new:"]'));
  assert.equal(await tapes(tablet), 1);
  // A tap lifts it on the tablet only (a view choice, as on the computer), and draws nothing.
  await pen('mousePressed', x0 + 100, ty, 0.5);
  await pen('mouseReleased', x0 + 100, ty, 0.5);
  await tablet.waitForFunction(() => document.querySelector('.sheet[data-page="0"] [data-tape^="new:"]').getAttribute('opacity') === '0.18');
  await tablet.waitForTimeout(300);
  assert.equal(await host.evaluate(() => document.querySelector('.sheet[data-page="0"] [data-tape^="new:"]').getAttribute('opacity')), '1');
  assert.equal(await host.evaluate(() => document.querySelectorAll('.remote-ink').length), 0, 'a tap leaves no live line on the computer');
  assert.equal(await tapes(host), 1);
  await pen('mousePressed', x0 + 100, ty, 0.5);
  await pen('mouseReleased', x0 + 100, ty, 0.5);
  await tablet.waitForFunction(() => document.querySelector('.sheet[data-page="0"] [data-tape^="new:"]').getAttribute('opacity') === '1');
  step('tape from the dock, with its colour and width, reaches the computer; a tap lifts and covers it');

  // Text: a finger tap opens a box and the keyboard; the box stays above the keyboard.
  await tablet.click('#tabletDock [data-dock-tool=text]');
  assert.equal(await tablet.locator('#tabletDock .dock-ink .dock-swatch').first().isHidden(), true, 'the pen colours hide for text');
  const sheet = await tablet.locator('.sheet').first().boundingBox();
  const tx = sheet.x + sheet.width * 0.4, textY = Math.min(1180 - 120, sheet.y + sheet.height - 80);
  await tablet.touchscreen.tap(tx, textY);
  await tablet.waitForFunction(() => document.activeElement?.classList.contains('text-editor'));
  await tablet.evaluate(() => window.keyboardOpens(520));
  await tablet.waitForFunction(() => {
    const box = document.querySelector('.text-editor').getBoundingClientRect();
    return box.bottom <= visualViewport.offsetTop + visualViewport.height && box.top >= 0;
  });
  await tablet.keyboard.type('Hola tablet');
  await shot(tablet, 'tablet-text');
  // Tapping elsewhere finishes the box, as on the computer; the keyboard closes.
  await tablet.touchscreen.tap(tx, textY - 260);
  await tablet.evaluate(() => window.keyboardOpens(0));
  await host.waitForFunction(() => document.querySelector('.sheet[data-page="0"] svg')?.textContent.includes('Hola tablet'), null, { timeout: 10000 });
  await tablet.waitForFunction(() => !document.querySelector('.text-editor') && document.querySelector('.sheet[data-page="0"] svg')?.textContent.includes('Hola tablet'));
  assert.equal(await tablet.evaluate(() => document.getElementById('pages').style.marginBottom), '');
  step('text typed on the tablet stays above its keyboard and reaches the computer');

  // A new page after the one in view, the same size: the computer and the tablet both get it.
  const firstSize = await host.evaluate(() => getComputedStyle(document.querySelector('.sheet[data-page="0"]')).aspectRatio);
  await tablet.click('#tabletDock [aria-label="New page after this one"]');
  await host.waitForFunction(() => document.querySelectorAll('.sheet').length === 4);
  await tablet.waitForFunction(() => document.querySelectorAll('.sheet').length === 4 && document.querySelector('#tabletDock'));
  assert.equal(await host.evaluate(() => getComputedStyle(document.querySelector('.sheet[data-page="1"]')).aspectRatio), firstSize);
  assert.equal(await tablet.evaluate(() => getComputedStyle(document.querySelector('.sheet[data-page="1"]')).aspectRatio), firstSize);
  await tablet.waitForFunction(() => document.querySelector('.sheet[data-page="1"]').getBoundingClientRect().top < innerHeight / 2);
  // The computer shows the new page too (every copy goes to an inserted page); back to the first.
  await host.waitForFunction(() => document.querySelector('.sheet[data-page="1"]').getBoundingClientRect().top < innerHeight / 2);
  await host.evaluate(() => document.querySelector('.sheet[data-page="0"]').scrollIntoView());
  await host.waitForFunction(() => document.querySelector('.sheet[data-page="0"] [data-item]'));
  step('a new page from the tablet: the computer gets it, and the tablet shows it');
  await tablet.click('#tabletDock [data-dock-tool=draw]');
  assert.equal(await tablet.isVisible('#tabletDock .dock-ink .dock-swatch >> nth=0'), true, 'the pen colours are back');

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
  await guest.waitForFunction(() => document.querySelectorAll('.sheet').length === 4 && document.querySelector('.sheet [data-item]'), null, { timeout: 20000 });
  // ...shown with its tools, and draws on it: the stroke reaches the host.
  await guest.waitForFunction(() => !document.body.classList.contains('guest-mode'));
  assert.equal(await guest.isVisible('#viewport'), true, 'the guest sees the pages');
  assert.equal(await guest.isVisible('#toolbar [data-tool="draw"]'), true, 'the guest has the tool bar');
  const hostInk = () => host.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length);
  const before = await hostInk();
  await guest.evaluate(() => document.querySelector('#toolbar [data-tool="draw"]').click());
  const gs = await guest.locator('.sheet').first().boundingBox();
  await guest.mouse.move(gs.x + 60, gs.y + 90); await guest.mouse.down();
  for (let j = 1; j <= 12; j++) await guest.mouse.move(gs.x + 60 + j * 12, gs.y + 90 + j * 4);
  await guest.mouse.up();
  await host.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length > n, before, { timeout: 10000 });
  await guest.evaluate(() => document.querySelector('#toolbar [data-tool="pan"]').click());
  step('the guest sees the note with its tool bar and draws on it; the host gets the stroke');

  // Typed text on the PDF page, which goes through the shared order: the host's box stays
  // open while a guest's stroke redraws the page under it, its text stays on screen until
  // the host's own render has it, and the guest sees it appear once.
  const textShown = (words) => [...document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="image:"]')]
    .some((i) => i.textContent.includes(words) && getComputedStyle(i).visibility !== 'hidden');
  await host.evaluate(() => document.querySelector('#toolbar [data-tool="text"]').click());
  await host.mouse.click(hostBox.x + 300, hostBox.y + 420);
  await host.waitForSelector('.text-editor');
  await host.keyboard.type('Host typing');
  const inkNow = await hostInk();
  await guest.evaluate(() => document.querySelector('#toolbar [data-tool="draw"]').click());
  await guest.mouse.move(gs.x + 60, gs.y + 200); await guest.mouse.down();
  for (let j = 1; j <= 12; j++) await guest.mouse.move(gs.x + 60 + j * 12, gs.y + 200 + j * 3);
  await guest.mouse.up();
  await host.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] [data-item]').length > n, inkNow, { timeout: 10000 });
  await guest.evaluate(() => document.querySelector('#toolbar [data-tool="pan"]').click());
  assert.equal(await host.evaluate(() => document.activeElement?.matches('.text-editor') && document.activeElement.value), 'Host typing', 'the host’s open box stays, still typed in');
  await guest.evaluate((shownSource) => {
    const shown = new Function(`return (${shownSource})`)();
    const w = window.guestWatch = { appeared: 0, was: false };
    const frame = () => {
      const now = shown('Host typing');
      if (now && !w.was) w.appeared++;
      w.was = now;
      requestAnimationFrame(frame);
    };
    frame();
  }, textShown.toString());
  await host.evaluate((shownSource) => {
    const shown = new Function(`return (${shownSource})`)();
    const w = window.hostWatch = { gaps: 0, done: false };
    const frame = () => {
      const box = [...document.querySelectorAll('.sheet[data-page="0"] textarea')].some((a) => a.isConnected && a.value === 'Host typing');
      const rendered = shown('Host typing');
      if (!box && !rendered) w.gaps++;
      if (rendered && !box) { w.done = true; return; }
      requestAnimationFrame(frame);
    };
    frame();
  }, textShown.toString());
  await host.keyboard.press('Escape');
  await host.waitForFunction(() => window.hostWatch.done, null, { timeout: 10000 });
  assert.equal(await host.evaluate(() => window.hostWatch.gaps), 0, 'the host’s text stays on screen until its render has it');
  assert.equal(await host.locator('.text-editor, .text-placeholder').count(), 0, 'no placeholder left over');
  await guest.waitForFunction(textShown, 'Host typing', { timeout: 10000 });
  await guest.waitForTimeout(500);
  assert.equal(await guest.evaluate(() => window.guestWatch.appeared), 1, 'the text appears once on the guest');
  await host.evaluate(() => document.querySelector('#toolbar [data-tool="pan"]').click());
  step('typed text in a session: the box survives a guest’s stroke, stays until drawn, and shows once on the guest');
  await guest.click('#notesEditor .TinyMDE');
  await guest.keyboard.type('Hola desde Ana');
  await host.evaluate(() => document.getElementById('notesToggle').click());
  await host.waitForFunction(() => document.querySelector('#notesEditor .TinyMDE')?.textContent.includes('Hola desde Ana'));
  await host.waitForFunction(() => [...document.querySelectorAll('#collabPeopleBar .collab-chip')].some((c) => c.title.startsWith('Ana')));
  await host.waitForFunction(() => document.querySelector('.notes-caret span')?.textContent === 'Ana');
  await shot(host, 'host-notes');
  await shot(guest, 'guest');
  step('a guest named Ana writes the notes; the host sees the text, her chip and her cursor');

  // Auto-save follows the host: the guest's switch shows the host's choice and is locked.
  await guest.waitForFunction(() => document.getElementById('autosaveToggle').disabled && document.getElementById('autosaveToggle').getAttribute('aria-checked') === 'true');
  await host.evaluate(() => document.getElementById('autosaveToggle').click());
  await guest.waitForFunction(() => document.getElementById('autosaveToggle').getAttribute('aria-checked') === 'false');
  await host.evaluate(() => document.getElementById('autosaveToggle').click());
  await guest.waitForFunction(() => document.getElementById('autosaveToggle').getAttribute('aria-checked') === 'true');
  step('auto-save follows the host’s switch on the guest');

  // Disconnecting the tablet is clean on both sides.
  await tablet.click('#tabletDock [aria-label=Disconnect]');
  await tablet.waitForFunction(() => !document.body.classList.contains('tablet-mode') && !document.querySelector('.sheet'));
  await host.waitForFunction(() => ![...document.querySelectorAll('#collabPeopleBar .collab-chip')].some((c) => c.title.includes('drawing tablet')));
  assert.equal(await added(host), 6, 'the tablet’s strokes and tape, and the guest’s two strokes');
  step('the tablet disconnects; the computer keeps every edit');

  // Ending: the guest keeps a copy; the host keeps the notes.
  const download = guest.waitForEvent('download');
  // Share in the bar says Sharing while the session runs, and opens it.
  assert.equal((await host.textContent('#shareButton')).trim(), 'Sharing');
  await host.click('#shareButton');
  await host.click('#collabDialog button.danger');
  assert.match((await download).suggestedFilename(), /shared notes\.md$/);
  await guest.waitForSelector('#collabDialog h2:text("Session ended")');
  assert.match(await guest.textContent('#collabDialog'), /Open the automatic save/, 'the guest keeps an automatic save of the note');
  await host.waitForFunction(() => !document.getElementById('collabPeopleBar') && document.getElementById('shareButton').textContent.trim() === 'Share');
  step('ending the session saves a copy of the notes and an automatic save of the note for the guest');
  console.log('Sharing end to end: passed.');
} finally {
  await browser.close();
  await server.stop();
}
