// Browser check of typed text boxes (Chromium): Esc keeps what was typed, Shift + Esc and
// the × at the box's corner throw it away, and finished text never leaves the screen
// before the page's render has it, on a blank page and on PDF pages.
//   node tools/text_box_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath as sample } from './e2e_common.mjs';

const server = await startReader({ port: 0 });
const b = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Messages to the engine's worker can be held back (window.slowEngine, in ms), so the
// edit and the page's render take long enough to see what is on screen meanwhile.
const slowEngine = () => {
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...args) {
    if (window.slowEngine) setTimeout(() => post.apply(this, args), window.slowEngine);
    else post.apply(this, args);
  };
};
const errors = [];
async function open(file) {
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(slowEngine);
  await openReader(p, server.origin);
  await p.setInputFiles('#file', sample(file));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(800);
  await p.evaluate(() => document.querySelector('[data-tool=text]').click());
  const s = await p.locator('.sheet').first().boundingBox();
  const type = async (x, y, words) => {
    await sleep(500);
    await p.mouse.click(s.x + x, s.y + y);
    await p.waitForSelector('.text-editor');
    await p.keyboard.press('Control+End');
    await p.keyboard.type(words);
  };
  return { p, type };
}
// Commits the box with Esc and checks every frame until the page's render shows `words`:
// the typed text (the box, or its placeholder) or the rendered text is on screen in each,
// and the text it replaces (`old`) never shows again on its own.
async function commitKept(p, words, old = null) {
  await p.evaluate(({ words, old }) => {
    const sheet = document.querySelector('.sheet[data-page="0"]');
    const shown = (el) => el.isConnected && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
    const out = window.textWatch = { frames: 0, gaps: [], done: false };
    const frame = () => {
      out.frames++;
      const box = [...sheet.querySelectorAll('textarea')].find((a) => a.value.replace(/\s+$/, '') === words && shown(a));
      const items = [...sheet.querySelectorAll('.render [data-item^="image:"]')].filter(shown);
      const rendered = items.find((i) => i.textContent.includes(words));
      if (!box && !rendered) out.gaps.push(`frame ${out.frames}: no text`);
      if (old && !box && items.some((i) => i.textContent.includes(old) && !i.textContent.includes(words))) out.gaps.push(`frame ${out.frames}: the old text`);
      if (rendered && !box) { out.done = true; return; }
      requestAnimationFrame(frame);
    };
    frame();
    window.slowEngine = 120;
  }, { words, old });
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.textWatch.done, null, { timeout: 10000 });
  await p.evaluate(() => { window.slowEngine = 0; });
  await sleep(300);
  const watch = await p.evaluate(() => window.textWatch);
  assert.deepEqual(watch.gaps, [], `“${words}” stays on screen until it is rendered`);
  assert.ok(watch.frames > 3, `the edit took several frames (${watch.frames})`);
  assert.equal(await p.locator('.text-placeholder, .text-editor').count(), 0, 'no placeholder left over');
}
try {
  const { p, type } = await open('nota_vacia.noteful');
  const texts = () => p.evaluate(() => document.querySelectorAll('.sheet[data-page="0"] [data-item^="image:"]').length);
  await type(120, 120, 'Kept by Esc');
  await commitKept(p, 'Kept by Esc');
  assert.equal(await texts(), 1);
  console.log('· Esc keeps the text, on screen until the page shows it');
  await type(120, 220, 'Thrown away');
  await p.keyboard.press('Shift+Escape');
  await p.waitForFunction(() => !document.querySelector('.text-editor, .text-placeholder'));
  await sleep(400);
  assert.equal(await texts(), 1, 'Shift + Esc discards');
  await type(120, 320, 'Also thrown away');
  assert.ok(await p.isVisible('.text-discard'), 'the × shows at the corner');
  await p.click('.text-discard');
  await p.waitForFunction(() => !document.querySelector('.text-editor, .text-discard, .text-placeholder'));
  await sleep(400);
  assert.equal(await texts(), 1, 'the × discards');
  console.log('· Shift + Esc and the × discard');
  await p.close();

  // PDF pages: the raster is a canvas under the page (little ink) or a picture in it (much
  // ink); the text stays on screen while either kind of page is redrawn.
  for (const [file, kind] of [['Practice book (vol. 1).noteful', 'canvas'], ['Examen wuolah.noteful', 'image']]) {
    const { p, type } = await open(file);
    await p.waitForSelector(kind === 'canvas' ? '.sheet[data-page="0"] .render > canvas.pdf-raster' : '.sheet[data-page="0"] [data-background] image');
    await type(120, 120, 'On the PDF');
    await commitKept(p, 'On the PDF');
    // Typing into it again: the old text stays hidden until the edited one is drawn.
    await type(130, 120, ' and more');
    await commitKept(p, 'On the PDF and more', 'On the PDF');
    console.log(`· a PDF page (raster as ${kind}): new and edited text stay until the page shows them`);
    await p.close();
  }
  assert.deepEqual(errors, []);
  console.log('Text box end to end: passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
