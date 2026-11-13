// Browser check of shapes from the pen (Chromium, after a web build; docs/SHAPES-TABLES-MATH.md):
// a rectangle drawn with the Pen and held still becomes a rectangle shape (the Pen stays the
// tool), a triangle drawn at an angle becomes a turned triangle that one undo removes, moving
// after the snap resizes the shape, a scribble held still stays ink, and a star from the
// Shapes tool is a shape with corner handles.
//   node tools/shapes_e2e.mjs [screenshots folder]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startReader({ port: 0 });
// CHROMIUM: a browser of the system's, where Playwright's own is not installed.
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
try {
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  await openReader(p, server.origin);
  await p.setInputFiles('#file', samplePath('nota_vacia.noteful'));
  await p.waitForSelector('.sheet[data-page="0"] .render');
  await sleep(600);
  const sheet = await p.locator('.sheet').first().boundingBox();
  const scale = await p.evaluate(() => { const s = document.querySelector('.sheet'); return s.getBoundingClientRect().width / Number(s.style.aspectRatio.split('/')[0]); });
  // Page units to screen.
  const at = ([x, y]) => [sheet.x + x * scale, sheet.y + y * scale];
  const added = () => p.locator('.sheet[data-page="0"] .render [data-item^="new:"]').count();
  // Draws through page points with small wobbly steps, then holds still for `hold` ms.
  async function stroke(points, { hold = 0, after = null } = {}) {
    const [x0, y0] = at(points[0]);
    await p.mouse.move(x0, y0);
    await p.mouse.down();
    let n = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], c = points[i], steps = Math.max(2, Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) / 12));
      for (let j = 1; j <= steps; j++) {
        const wob = Math.sin(++n * 1.7) * 1.2;
        const [x, y] = at([a[0] + (c[0] - a[0]) * j / steps + wob, a[1] + (c[1] - a[1]) * j / steps - wob]);
        await p.mouse.move(x, y);
      }
    }
    if (hold) await sleep(hold);
    if (after) for (const q of after) { const [x, y] = at(q); await p.mouse.move(x, y, { steps: 4 }); }
    await p.mouse.up();
    await sleep(500);
  }
  await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
  assert.equal(await p.inputValue('#shapeSnap'), 'hold', 'hold to snap by default');

  // 1. A rectangle held still: a shape, and the pen is still the tool.
  await stroke([[150, 150], [450, 152], [448, 330], [152, 328], [150, 150], [170, 151]], { hold: 800 });
  assert.equal(await added(), 1);
  assert.equal(await p.getAttribute('[data-tool=draw]', 'aria-pressed'), 'true', 'the pen stays the tool');
  const rect = await p.locator('.sheet[data-page="0"] .render [data-item^="new:"] polyline').first().getAttribute('points');
  assert.equal(rect.trim().split(/\s+/).length, 5, `a clean rectangle: ${rect}`);
  if (DIR) await p.screenshot({ path: DIR + 'rectangle.png' });

  // 2. A turned triangle: one shape, turned; one undo takes it away.
  const tri = [[600, 140], [760, 330], [520, 380]];
  await stroke([...tri, tri[0], [610, 152]], { hold: 800 });
  assert.equal(await added(), 2);
  const transform = await p.locator('.sheet[data-page="0"] .render [data-item^="new:"]').nth(1).innerHTML();
  assert.equal(transform.match(/<polyline[^>]*points="([^"]+)"/)[1].trim().split(/\s+/).length, 4, 'a clean triangle');
  if (DIR) await p.screenshot({ path: DIR + 'triangle.png' });
  await p.keyboard.press('Control+z');
  await sleep(500);
  assert.equal(await added(), 1, 'one undo removes the turned triangle');

  // 3. A circle, then moving after the snap makes it bigger.
  const circle = Array.from({ length: 34 }, (_, i) => { const t = i / 32 * 2 * Math.PI; return [300 + 80 * Math.cos(t), 600 + 80 * Math.sin(t)]; });
  await stroke(circle, { hold: 800, after: [[480, 640]] });
  assert.equal(await added(), 2);
  const box = await p.locator('.sheet[data-page="0"] .render [data-item^="new:"]').nth(1).boundingBox();
  assert.ok(box.width / scale > 200, `resized after the snap: ${box.width / scale}`);

  // 4. A scribble held still stays ink (a stroke, not a shape).
  await stroke([[600, 600], [630, 660], [660, 600], [690, 660], [720, 600]], { hold: 800 });
  assert.equal(await added(), 3);
  const ink = await p.locator('.sheet[data-page="0"] .render [data-item^="new:"]').nth(2).innerHTML();
  assert.ok((ink.match(/<polyline[^>]*points="([^"]+)"/)?.[1] || ink).length > 200, 'the scribble keeps its points');

  // 5. Without holding, a rectangle stays handwriting.
  await stroke([[150, 800], [400, 802], [398, 900], [152, 898], [150, 800]]);
  assert.equal(await added(), 4);

  // 6. A star from the Shapes tool, selected with its corner handles.
  await p.evaluate(() => document.querySelector('[data-tool=shape]').click());
  await p.evaluate(() => document.querySelector('#shapePicker [data-shape=star]').click());
  const [sx, sy] = at([700, 780]), [ex, ey] = at([900, 980]);
  await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(ex, ey, { steps: 8 }); await p.mouse.up();
  await sleep(700);
  assert.equal(await added(), 5);
  assert.equal(await p.textContent('#selectionKind'), 'Shape');
  assert.equal(await p.locator('.selection-overlay circle').count(), 5, 'four corners and the turn handle');
  if (DIR) await p.screenshot({ path: DIR + 'star.png' });
  assert.deepEqual(errors, []);
  console.log('shapes e2e: ok');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close?.();
  process.exit(process.exitCode || 0);
}
