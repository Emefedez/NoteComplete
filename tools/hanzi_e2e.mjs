// Browser check of the hanzi prefab module (docs/CHINESE-INPUT.md §7): Insert prefab → Stroke
// order opens the player in a movable window, plays (a frame mid-stroke), steps with the keys,
// puts a step on the page; practice accepts the right stroke traced with the mouse and refuses a
// wrong one; Insert puts it on the page. Needs the stroke shards
// (node tools/build_chinese_strokes.mjs) and a web build.
//   node tools/hanzi_e2e.mjs [screenshots folder]
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const DIR = process.argv[2] || '';
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
const fetched = []; p.on('request', (r) => { if (r.url().includes('/vendor/chinese/')) fetched.push(r.url()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => DIR && p.screenshot({ path: `${DIR}/${name}.png` });
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
await p.locator('.sheet[data-page="0"] .render').waitFor(); await sleep(500);
assert.deepEqual(fetched, [], 'no stroke data at start');

await p.evaluate(() => document.getElementById('insertGraph').click());
await p.locator('.prefab-grid').waitFor();
await p.click('.prefab-card:has(strong:text-is("Stroke order"))');
const win = p.locator('.pk-module-window');
await win.locator('.hz-stage svg [data-i]').first().waitFor({ state: 'attached' });
const count = () => win.locator('.pk-step-count').textContent();
assert.match(await count(), /^\d+ \/ 13$/, 'a new figure plays its 13 strokes');
assert.equal(await win.locator('.hz-stage svg [data-i]').count(), 13);
// Play from the start; a frame in the middle of a stroke.
await win.locator('.pk-step-player').focus();
await p.keyboard.press('Home');
assert.equal(await count(), '0 / 13');
await p.keyboard.press('Space');
await p.waitForFunction(() => /^[3-5] \/ 13$/.test(document.querySelector('.pk-module-window .pk-step-count').textContent), null, { timeout: 15000 });
await sleep(180);
await shot('hanzi-playing');
const mid = await win.locator('.hz-stage svg [data-i]').evaluateAll((els) => els.map((e) => [Number(e.getAttribute('stroke-dashoffset')), Number(e.dataset.len)]));
assert.ok(mid.some(([o, l]) => o > 0 && o < l), 'a stroke part drawn');
await p.keyboard.press('Space');
// Steps.
await p.keyboard.press('Home');
for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight');
await p.waitForFunction(() => document.querySelector('.pk-module-window .pk-step-count').textContent === '3 / 13');
await p.keyboard.press('ArrowLeft');
assert.equal(await count(), '2 / 13');
await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');
await p.waitForFunction(() => document.querySelector('.pk-module-window .pk-step-count').textContent === '9 / 13');
assert.match(await win.locator('.pk-step-caption').textContent(), /好 · stroke 2 of 6/);
await shot('hanzi-step9');
console.log('· the player: plays, steps with ← →, Home; caption', await win.locator('.pk-step-caption').textContent());
const images = () => p.locator('.sheet[data-page="0"] .render [data-item^="image:"]').count();
await win.locator('button:has-text("Show this step on the page")').click();
await win.waitFor({ state: 'detached' });
await p.waitForFunction(() => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="image:"]').length > 0);
console.log('· step 9 put on the page');

// Practice: the first stroke of 你 traced along its median, then a wrong one.
await p.evaluate(() => document.getElementById('insertGraph').click());
await p.locator('.prefab-grid').waitFor();
await p.click('.prefab-card:has(strong:text-is("Stroke order"))');
await win.locator('.hz-stage svg').first().waitFor();
await win.locator('button:has-text("Practise")').click();
const svg = win.locator('.hz-practice svg');
await svg.waitFor();
const trace = async (median) => {
  const pts = await svg.evaluate((s, m) => {
    const size = s.viewBox.baseVal.width, ctm = s.getScreenCTM();
    return m.map(([x, y]) => new DOMPoint((x * size) / 1024, ((900 - y) * size) / 1024).matrixTransform(ctm)).map((q) => [q.x, q.y]);
  }, median);
  await p.mouse.move(...pts[0]); await p.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const [a, c] = [pts[i - 1], pts[i]];
    for (let k = 1; k <= 6; k++) await p.mouse.move(a[0] + ((c[0] - a[0]) * k) / 6, a[1] + ((c[1] - a[1]) * k) / 6);
  }
  await p.mouse.up(); await sleep(350);
};
const medians = await p.evaluate(async () => (await (await import('./chinese/strokes.js')).strokeData('你')).medians);
await trace(medians[0]);
assert.match(await win.locator('.hz-practice-status').textContent(), /Stroke 2 of 7/, 'the right stroke is accepted');
await trace([...medians[1]].reverse());
assert.match(await win.locator('.hz-practice-status').textContent(), /Not quite/, 'a reversed stroke is not');
await trace(medians[1]);
await shot('hanzi-practice');
assert.match(await win.locator('.hz-practice-status').textContent(), /Stroke 3 of 7/);
console.log('· practice: a traced stroke accepted, a reversed one refused');
await p.keyboard.press('Escape');
await win.waitFor({ state: 'detached' });

// Inserted with Insert.
await p.evaluate(() => document.getElementById('insertGraph').click());
await p.locator('.prefab-grid').waitFor();
await p.click('.prefab-card:has(strong:text-is("Stroke order"))');
await win.locator('.hz-stage svg').first().waitFor();
const before = await images();
await win.locator('.pk-bar button:has-text("Insert")').click();
await win.waitFor({ state: 'detached' });
await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] .render [data-item^="image:"]').length > n, before);
await sleep(400);
await shot('hanzi-page');
console.log('· inserted');
const shards = fetched.filter((u) => u.includes('/strokes/'));
assert.ok(shards.some((u) => u.endsWith('/index.json')) && shards.length <= 3, `only the stroke index and a shard or two: ${shards}`);
assert.deepEqual(errors, []);
console.log('Hanzi stroke order: OK');
await b.close(); process.exit(0);
