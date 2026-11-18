// Browser check of a prefab module with its own editor (Chromium, after a web build): the
// number line module (apps/reader/prefabs/numberline) is in Insert prefab, its editor (built
// with the kit) edits and undoes, it is inserted as a picture, and its menu edits it again; the
// truth table module (prefabs/truthtable) computes its rows, says a broken expression, inserts.
//   node tools/prefab_module_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const DIR = process.argv[2] || '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); 
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
await p.locator('.sheet[data-page="0"] .render').waitFor(); await sleep(500);
await p.evaluate(() => document.getElementById('insertGraph').click());
await p.locator('.prefab-grid').waitFor();
if (DIR) await p.screenshot({ path: DIR + '/picker.png' });
await p.click('.prefab-card:has(strong:text-is("Number line"))');
await p.locator('.pk-dialog .pk-canvas svg').waitFor();
await sleep(300);
if (DIR) await p.screenshot({ path: DIR + '/editor.png' });
// Change the title, add a point, undo it.
await p.fill('.pk-panel .pk-field:has-text("Title") input', 'Soluciones');
await p.click('.pk-panel button:has-text("Add point")');
const pts = () => p.locator('.pk-canvas svg circle[r="5"]').count();
assert.equal(await pts(), 2);
await p.keyboard.press('Control+z'); await sleep(100);
assert.equal(await pts(), 1, 'undo removes the point');
await p.click('.pk-dialog button:has-text("Insert")');
await p.locator('.pk-dialog').waitFor({ state: 'detached' });
await p.locator('.sheet[data-page="0"] .render [data-item^="image:"] image').first().waitFor({ state: 'attached' });
console.log('· the number line module: picked, edited with the kit (undo too), inserted');
// Edit it again from its menu.
const img = await p.locator('.sheet[data-page="0"] .render [data-item^="image:"]').first().boundingBox();
await p.mouse.click(img.x + img.width / 2, img.y + img.height / 2, { button: 'right' });
await p.locator('.context-menu').waitFor();
const entries = await p.locator('.context-menu button span').allTextContents();
assert.ok(entries.includes('Edit number line…'), `its menu: ${entries}`);
await p.click('.context-menu button:has-text("Edit number line")');
await p.locator('.pk-dialog .pk-canvas svg').waitFor();
assert.equal(await p.inputValue('.pk-panel .pk-field:has-text("Title") input'), 'Soluciones', 'its spec came back');
assert.equal(await p.textContent('.pk-dialog .pk-button.primary'), 'Apply');
await p.keyboard.press('Escape');
await p.locator('.pk-dialog').waitFor({ state: 'detached' });
console.log('· edited again from its menu, with its spec; Esc leaves it as it was');
// The truth table (prefabs/truthtable), built only from docs/PREFAB-MODULES-GUIDE.md.
await p.evaluate(() => document.getElementById('insertGraph').click());
await p.locator('.prefab-grid').waitFor();
await p.click('.prefab-card:has(strong:text-is("Truth table"))');
await p.locator('.pk-dialog .pk-canvas svg').waitFor();
const outputs = () => p.locator('.pk-canvas svg text[fill="#1d4ed8"]').allTextContents();
assert.deepEqual(await outputs(), ['0', '0', '1', '0'], 'A and not B');
await p.fill('.pk-panel .pk-field:has-text("Expression") input', 'A and');
assert.match(await p.textContent('.pk-dialog .pk-status'), /ends too soon/, 'a broken expression is said');
await p.fill('.pk-panel .pk-field:has-text("Expression") input', 'A xor B');
assert.equal(await p.textContent('.pk-dialog .pk-status'), '', 'and goes once it is fixed');
await p.fill('.pk-panel .pk-field:has-text("Variables") input', 'A, B, C');
assert.equal((await outputs()).length, 8, 'three variables, eight rows');
await p.selectOption('.pk-panel .pk-field:has-text("Write") select', 'VF');
assert.deepEqual(await outputs(), ['F', 'F', 'V', 'V', 'V', 'V', 'F', 'F']);
if (DIR) await p.screenshot({ path: DIR + '/truthtable.png' });
const before = await p.locator('.sheet[data-page="0"] .render [data-item^="image:"]').count();
await p.click('.pk-dialog button:has-text("Insert")');
await p.locator('.pk-dialog').waitFor({ state: 'detached' });
await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="image:"]').length > n, before);
console.log('· the truth table module: picked, its expression checked, variables and notation changed, inserted');
assert.deepEqual(errors, []);
console.log('Prefab module from its own folder: OK');
await b.close(); process.exit(0);
