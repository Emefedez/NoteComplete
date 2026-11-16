// Browser check of editing a moved text box (Chromium): a double-click with Select types into
// it where it is now (not where it was typed), and finishing goes back to Select.
//   node tools/text_edit_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
try {
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render'); await sleep(800);
  const s = await p.locator('.sheet').first().boundingBox();
  await p.evaluate(() => document.querySelector('[data-tool=text]').click());
  await p.mouse.click(s.x + 200, s.y + 200); await p.waitForSelector('.text-editor'); await p.keyboard.type('Hello'); await p.keyboard.press('Escape');
  await sleep(1500);
  const box = () => p.evaluate(() => { const r = [...document.querySelectorAll('.sheet[data-page="0"] [data-item^="image:"]')].pop()?.getBoundingClientRect(); return r && [r.x, r.y]; });
  const editor = () => p.evaluate(() => { const r = document.querySelector('.text-editor')?.getBoundingClientRect(); return r && [r.x, r.y]; });
  const tool = () => p.evaluate(() => document.querySelector('#toolbar [aria-pressed=true][data-tool]')?.dataset.tool);
  // Where the editor sits over the box, as typed.
  await p.evaluate(() => document.querySelector('[data-tool=select]').click());
  const [x0, y0] = await box();
  await p.mouse.dblclick(x0 + 10, y0 + 8);
  await p.waitForSelector('.text-editor');
  const [ex0, ey0] = await editor();
  await p.keyboard.press('Escape'); await sleep(800);
  assert.equal(await tool(), 'select', 'back to Select');
  // Moved by (200, 150): the editor opens there.
  await p.mouse.click(x0 + 10, y0 + 8); await sleep(300);
  await p.mouse.move(x0 + 10, y0 + 8); await p.mouse.down(); await p.mouse.move(x0 + 210, y0 + 158, { steps: 8 }); await p.mouse.up(); await sleep(1500);
  const [x1, y1] = await box();
  assert.ok(Math.abs(x1 - x0 - 200) < 3 && Math.abs(y1 - y0 - 150) < 3, 'moved');
  await p.mouse.dblclick(x1 + 10, y1 + 8);
  await p.waitForSelector('.text-editor');
  assert.equal(await tool(), 'text');
  const [ex1, ey1] = await editor();
  assert.ok(Math.abs(ex1 - ex0 - 200) < 3 && Math.abs(ey1 - ey0 - 150) < 3, `edited where it is now (${ex0},${ey0} → ${ex1},${ey1})`);
  await p.keyboard.press('End'); await p.keyboard.type(' world'); await p.keyboard.press('Escape'); await sleep(1500);
  assert.equal(await tool(), 'select', 'back to Select after editing');
  const [x2, y2] = await box();
  assert.ok(Math.abs(x2 - x1) < 3 && Math.abs(y2 - y1) < 3, 'stays where it was moved');
  assert.deepEqual(errors, []);
  console.log('Text edit end to end: passed.');
} catch (e) { console.error(e); process.exitCode = 1; } finally { await b.close(); process.exit(process.exitCode || 0); }
