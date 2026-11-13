// Browser check of deleting the edit history from the File menu (Chromium, after a web
// build): strokes are drawn and erased, an automatic save is made, more strokes follow;
// ✂ beside that save deletes the history up to it (the page draws the same, only the
// later strokes can be undone), and "Delete history up to now" deletes the rest.
//   node tools/history_compact_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
await openReader(p, server.origin);
await p.evaluate(() => localStorage.setItem('notecomplete-autosave', '1'));
await p.setInputFiles('#file', samplePath('Examen wuolah.noteful'));
await p.waitForSelector('.sheet[data-page="0"] .render svg');
const sheet = await p.locator('.sheet[data-page="0"]').boundingBox();
const settle = () => p.waitForFunction(() => !document.querySelector('.pending-ink'), null, { timeout: 20000 }).then(() => p.waitForTimeout(900));
const draw = async (n, y0) => {
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  for (let k = 0; k < n; k++) {
    const y = sheet.y + y0 + k * 14;
    await p.mouse.move(sheet.x + 600, y); await p.mouse.down();
    for (let j = 1; j <= 8; j++) await p.mouse.move(sheet.x + 600 + j * 20, y + (j % 2) * 4);
    await p.mouse.up();
  }
  await settle();
};
// The page's drawing without item names (deleting the history renumbers them).
const drawing = () => p.evaluate(() => document.querySelector('.sheet[data-page="0"] .render svg').outerHTML.replace(/ data-item="[^"]*"/g, ''));
const canUndo = () => p.evaluate(() => !document.getElementById('undo').disabled);
const fileMenu = async () => {
  await p.evaluate(() => { const m = document.getElementById('fileMenu'); m.open = false; m.open = true; });
  await p.waitForTimeout(600);
};

// Strokes drawn, most of them erased again: history that no longer shapes the note.
await draw(12, 120);
await p.evaluate(() => document.querySelector('[data-tool=erase]').click());
await p.mouse.move(sheet.x + 590, sheet.y + 110); await p.mouse.down();
for (let k = 0; k <= 20; k++) await p.mouse.move(sheet.x + 590 + (k % 2) * 180, sheet.y + 110 + k * 7);
await p.mouse.up();
await settle();
// An automatic save (made when the page is hidden), then three more strokes.
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(1500);
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
await draw(3, 500);
const before = await drawing();

await fileMenu();
assert.equal(await p.locator('#autosaveList .autosave-slot').count() >= 1, true, 'the automatic save is listed');
assert.equal(await p.locator('#autosaveList .autosave-trim').count(), 1, '✂ beside the save');
await p.click('#autosaveList .autosave-trim');
await p.waitForFunction(() => /History deleted/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
console.log('·', await p.textContent('#status'));
assert.match(dialogs.at(-1), /You will not be able to undo past this point/);
await settle();
assert.equal(await drawing(), before, 'the page draws the same');
// The three later strokes can still be undone, then nothing more.
for (let k = 0; k < 3; k++) { assert.equal(await canUndo(), true, `undo ${k + 1}`); await p.evaluate(() => document.getElementById('undo').click()); await p.waitForTimeout(400); }
assert.equal(await canUndo(), false, 'undo stops at the save');
for (let k = 0; k < 3; k++) { await p.evaluate(() => document.getElementById('redo').click()); await p.waitForTimeout(400); }
await settle();
assert.equal(await drawing(), before, 'redo brings the strokes back');
console.log('· up to the save: the page is the same; only the 3 later strokes undo');

await fileMenu();
assert.equal(await p.locator('#autosaveList .autosave-trim').count(), 0, 'the old save is no longer a point of this history');
await p.click('#autosaveList .autosave-now');
await p.waitForFunction(() => /History deleted up to now|Nothing to delete up to now/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
console.log('·', await p.textContent('#status'));
await settle();
assert.equal(await drawing(), before, 'the page draws the same');
assert.equal(await canUndo(), false, 'nothing to undo');
// Drawing goes on as usual, and the new stroke undoes.
await draw(1, 700);
assert.equal(await canUndo(), true);
console.log('· up to now: no undo left; new edits undo as usual');
assert.deepEqual(errors, []);
await b.close(); await server.stop();
console.log('History compacting end to end: passed.');
