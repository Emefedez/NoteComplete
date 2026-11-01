// Browser check of handwriting from Markdown and shapes (Chromium, after a web build):
// New note with AI (a stand-in AI tool streams the Markdown), its text found by Find at
// once (no OCR), a filled rectangle (F cycles the fill), and a drawing tablet drawing a
// solid ellipse from its dock that appears on the computer.
//   node tools/ink_features_e2e.mjs [screenshots folder]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
(async () => {
  const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  const info = { hostUrl: server.hostUrl, hostToken: server.hostToken, guestLink: '', tabletLink: server.tabletLink(), address: server.address, port: server.port, ...server.code() };
  await ctx.addInitScript((info) => {
    window.notecompleteCollab = { start: async () => info, info: async () => info, stop: async () => {}, minimize: async () => {}, onEnded() {} };
    // A stand-in AI tool that streams a note.
    const answer = '```markdown\n# THE **CARDIAC** CYCLE\n_Physiology · week 2_\n## Phases\n- **Systole**: the ventricles contract\n- **Diastole**: they relax and fill\n> [sky] KEY IDEA: blood moves from high to low pressure\n```';
    window.notecompleteAI = {
      providers: async () => [{ id: 'claude', label: 'Claude Code', available: true }],
      models: async () => [],
      cancel() {},
      run: async (request, onDelta) => { window.__aiPrompt = request.prompt; for (let i = 0; i < answer.length; i += 40) { onDelta?.(answer.slice(i, i + 40)); await new Promise(r => setTimeout(r, 20)); } return { text: answer }; },
    };
  }, info);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(server.origin + '/');
  await p.waitForFunction(() => !document.getElementById('open').disabled);
  // 1. New note with AI.
  assert.equal(await p.evaluate(() => document.getElementById('newWithAi').hidden), false);
  await p.evaluate(() => document.getElementById('newWithAi').click());
  await p.waitForSelector('.handwriting-dialog[open] #hwRequest:focus');
  await p.fill('#hwRequest', 'the cardiac cycle for a first-year exam');
  await p.click('#hwWrite');
  await p.waitForFunction(() => document.getElementById('hwAiStatus').textContent.startsWith('Written'));
  // The written Markdown stays editable, and the Markdown tab can make your own text richer.
  assert.equal(await p.isVisible('#hwMarkdown'), true);
  assert.match(await p.inputValue('#hwMarkdown'), /^# THE \*\*CARDIAC\*\* CYCLE/);
  assert.equal(await p.inputValue('#hwName'), 'THE CARDIAC CYCLE');
  assert.match(await p.evaluate(() => window.__aiPrompt), /the cardiac cycle for a first-year exam$/);
  await p.waitForFunction(() => document.querySelectorAll('#hwPages svg').length >= 1);
  if (DIR) await p.screenshot({ path: DIR + 'ai.png' });
  await p.click('#hwModeMarkdown');
  assert.equal(await p.isVisible('#hwRequest'), false);
  assert.equal(await p.isVisible('#hwEnrich'), true);
  await p.click('#hwEnrich');
  await p.waitForFunction(() => document.getElementById('hwAiStatus').textContent.startsWith('Done'));
  assert.match(await p.evaluate(() => window.__aiPrompt), /Rewrite the Markdown note below[\s\S]*The note:\n# THE \*\*CARDIAC\*\* CYCLE/);
  if (DIR) await p.screenshot({ path: DIR + 'enrich.png' });
  await p.fill('#hwMarkdown', '# Mine');
  await p.click('#hwEnrich');
  await p.waitForFunction(() => document.getElementById('hwAiStatus').textContent.startsWith('Done'));
  await p.click('#hwRevert');
  assert.equal(await p.inputValue('#hwMarkdown'), '# Mine');
  await p.click('#hwModePrompt');
  await p.click('#hwWrite');
  await p.waitForFunction(() => document.getElementById('hwAiStatus').textContent.startsWith('Written'));
  await p.click('#hwCreate');
  await p.waitForFunction(() => document.querySelectorAll('.sheet').length >= 1 && document.getElementById('title').textContent.includes('CARDIAC'));
  console.log('· AI wrote the note and it was created');
  // 2. Its handwriting is searchable at once (no OCR run).
  await p.keyboard.press('Control+f');
  await p.fill('#findInput', 'ventricles');
  await p.waitForFunction(() => /1 of|1\//.test(document.getElementById('findCount')?.textContent || '') || document.querySelectorAll('.find-hit, .find-mark').length > 0, null, { timeout: 15000 });
  console.log('· Find:', await p.textContent('#findCount'));
  if (DIR) await p.screenshot({ path: DIR + 'find.png' });
  await p.keyboard.press('Escape');
  // 3. A filled shape on the desktop: F cycles the fill, the inside is drawn.
  await p.evaluate(() => document.querySelector('[data-tool=shape]').click());
  await p.evaluate(() => document.querySelector('#shapePicker [data-shape=rectangle]').click());
  await p.evaluate(() => { document.activeElement?.blur(); document.getElementById('viewport').focus(); });
  await p.keyboard.press('f');
  assert.equal(await p.getAttribute('#shapeFill [data-fill=tint]', 'aria-checked'), 'true');
  const sheet = await p.locator('.sheet').first().boundingBox();
  await p.mouse.move(sheet.x + 200, sheet.y + 500); await p.mouse.down();
  await p.mouse.move(sheet.x + 420, sheet.y + 620, { steps: 6 });
  await p.mouse.up();
  await p.waitForFunction(() => document.querySelector('.sheet polygon[fill-opacity="0.25"]'));
  console.log('· filled rectangle drawn');
  if (DIR) await p.screenshot({ path: DIR + 'filled.png' });
  // 4. Tablet: shapes in the dock, filled, appear on the computer.
  await p.evaluate(() => document.getElementById('shareSession').click());
  await p.click('#collabDialog button.primary');
  await p.waitForSelector('#collabTablet svg');
  if (DIR) await p.screenshot({ path: DIR + 'share.png' });
  await p.click('#collabDialog .dialog-actions button.primary');
  const tc = await b.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  const t = await tc.newPage();
  t.on('pageerror', e => errors.push('tablet: ' + e.message));
  await t.goto(server.tabletLink());
  await t.waitForFunction(() => document.body.classList.contains('tablet-mode') && document.querySelector('.sheet [data-item]'));
  assert.equal(await t.isHidden('#tabletDock .dock-shapes'), true);
  await t.click('#tabletDock [data-dock-tool=shape]');
  assert.equal(await t.isVisible('#tabletDock .dock-shapes'), true);
  await t.click('#tabletDock [data-mirror="shape:ellipse"]');
  await t.click('#tabletDock [data-mirror="fill:solid"]');
  const tb = await t.locator('.sheet').first().boundingBox();
  await t.mouse.move(tb.x + 150, tb.y + 300); await t.mouse.down();
  await t.mouse.move(tb.x + 300, tb.y + 400, { steps: 6 });
  await t.mouse.up();
  await p.waitForFunction(() => document.querySelector('.sheet polygon[fill-opacity="1"]'));
  console.log('· tablet drew a solid ellipse; it is on the computer');
  if (DIR) await t.screenshot({ path: DIR + 'tablet.png' });
  assert.deepEqual(errors, []);
  await b.close(); await server.stop();
  console.log('Handwriting and shapes end to end: passed.');
})().catch(e => { console.error(e); process.exit(1); });
